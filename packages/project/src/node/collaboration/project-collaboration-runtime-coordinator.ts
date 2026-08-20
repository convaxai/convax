import path from "node:path"
import { parseActorId, type ActorId } from "@convax/collaboration"
import {
  NodeCollaborationPersistence,
  type NodeLocalCommitDurabilityDiagnostics,
  type NodeReplicaHeadMaterializer,
} from "./persistence-store"
import type {
  ProjectClosedMutationGate,
  ProjectRecoveryRootPort,
} from "./project-collaboration-recovery-service"

export interface ProjectCollaborationRuntimeRootPort {
  resolveProjectRoot(input: { readonly projectId: string }): Promise<string>
}

export interface ProjectCollaborationRuntimeQuiescencePort {
  /**
   * Synchronously withdraw new Project UI/Agent/Plugin work, cancel in-flight
   * sessions, and release every lease returned by this coordinator before the
   * promise resolves.
   */
  quiesceProject(input: {
    readonly projectId: string
    readonly projectRoot: string
  }): Promise<void>
}

export interface ProjectCollaborationRuntimeIdentityPort {
  /** Resolves the exact local replica actor for this bound Project/epoch. */
  resolveLocalActorId(input: {
    readonly projectId: string
    readonly projectRoot: string
    /** Opaque process-local identity of this one open runtime incarnation. */
    readonly runtimeIdentity: object
  }): Promise<ActorId>
  /** Releases adapter-owned identity material when the runtime incarnation closes. */
  releaseRuntimeIdentity?(input: {
    readonly projectId: string
    readonly projectRoot: string
    readonly runtimeIdentity: object
  }): void
}

export interface ProjectCollaborationWriterFactory {
  open(input: {
    readonly collaborationDirectory: string
    readonly durabilityDiagnostics?: NodeLocalCommitDurabilityDiagnostics
    readonly localActorId: ActorId
    readonly materializer: NodeReplicaHeadMaterializer
  }): Promise<NodeCollaborationPersistence>
}

export interface ProjectCollaborationRuntimeLease {
  readonly projectId: string
  readonly projectRoot: string
  readonly collaborationDirectory: string
  readonly persistence: NodeCollaborationPersistence
  readonly localActorId: ActorId
  /** Opaque Main-only identity shared only by leases of this runtime incarnation. */
  readonly runtimeIdentity: object
  /** Rejects use after this exact lease has been released. */
  assertLive(): void
  release(): void
}

export type ProjectCollaborationRuntimeCoordinatorErrorCode =
  | "project-binding-changed"
  | "project-sessions-still-active"
  | "runtime-disposed"

export class ProjectCollaborationRuntimeCoordinatorError extends Error {
  constructor(
    readonly code: ProjectCollaborationRuntimeCoordinatorErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ProjectCollaborationRuntimeCoordinatorError"
  }
}

export interface NodeProjectCollaborationRuntimeCoordinatorOptions {
  readonly durabilityDiagnostics?: NodeLocalCommitDurabilityDiagnostics
  readonly identity: ProjectCollaborationRuntimeIdentityPort
  readonly materializer: NodeReplicaHeadMaterializer
  readonly projects: ProjectCollaborationRuntimeRootPort
  readonly quiescence: ProjectCollaborationRuntimeQuiescencePort
  readonly writerFactory?: ProjectCollaborationWriterFactory
}

interface OpenProjectRuntime {
  readonly collaborationDirectory: string
  readonly persistence: NodeCollaborationPersistence
  readonly projectRoot: string
  readonly localActorId: ActorId
  readonly runtimeIdentity: object
  leaseCount: number
}

interface ProjectRuntimeBinding {
  readonly projectRoot: string
  readonly localActorId: ActorId
}

/**
 * Project-owned native collaboration lifecycle.
 *
 * One coordinator instance is the Main-process composition for all Projects. It
 * shares exactly one persistence writer per bound Project, and its close gate is
 * the only legal bridge into Project reset. The host may quiesce product surfaces,
 * but it cannot choose the collaboration directory or dispose a writer directly.
 */
export class NodeProjectCollaborationRuntimeCoordinator
  implements ProjectClosedMutationGate, ProjectRecoveryRootPort
{
  private readonly bindings = new Map<string, ProjectRuntimeBinding>()
  private readonly openProjects = new Map<string, OpenProjectRuntime>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly writerFactory: ProjectCollaborationWriterFactory
  private disposed = false

  constructor(private readonly options: NodeProjectCollaborationRuntimeCoordinatorOptions) {
    this.writerFactory =
      options.writerFactory ??
      Object.freeze({
        open: (input: Parameters<typeof NodeCollaborationPersistence.open>[0]) =>
          NodeCollaborationPersistence.open(input),
      })
  }

  async resolveProjectRoot(projectId: string): Promise<string> {
    this.requireLive()
    return this.options.projects.resolveProjectRoot({ projectId })
  }

  acquire(projectId: string): Promise<ProjectCollaborationRuntimeLease> {
    this.requireLive()
    return this.serialize(projectId, async () => {
      this.requireLive()
      const open = this.openProjects.get(projectId)
      if (open) return this.leaseRuntime(projectId, open)

      const projectRoot = await this.resolveCanonicalProjectRoot(projectId)
      const runtimeIdentity = Object.freeze({})
      let localActorId: ActorId
      try {
        localActorId = parseActorId(await this.options.identity.resolveLocalActorId({
          projectId,
          projectRoot,
          runtimeIdentity,
        }))
      } catch (error) {
        this.releaseRuntimeIdentity(projectId, projectRoot, runtimeIdentity)
        throw error
      }
      const collaborationDirectory = path.join(projectRoot, ".convax", "collaboration")
      const binding = this.bindings.get(projectId)
      if (binding && (binding.projectRoot !== projectRoot || binding.localActorId !== localActorId)) {
        this.releaseRuntimeIdentity(projectId, projectRoot, runtimeIdentity)
        throw new ProjectCollaborationRuntimeCoordinatorError(
          "project-binding-changed",
          "Project root or local actor binding changed without a successful close/reset barrier",
        )
      }
      let persistence: NodeCollaborationPersistence
      try {
        persistence = await this.writerFactory.open({
          collaborationDirectory,
          ...(this.options.durabilityDiagnostics === undefined
            ? {}
            : { durabilityDiagnostics: this.options.durabilityDiagnostics }),
          localActorId,
          materializer: this.options.materializer,
        })
      } catch (error) {
        this.releaseRuntimeIdentity(projectId, projectRoot, runtimeIdentity)
        throw error
      }
      const runtime: OpenProjectRuntime = {
        collaborationDirectory,
        leaseCount: 0,
        persistence,
        projectRoot,
        localActorId,
        runtimeIdentity,
      }
      this.openProjects.set(projectId, runtime)
      this.bindings.set(projectId, Object.freeze({ projectRoot, localActorId }))
      return this.leaseRuntime(projectId, runtime)
    })
  }

  private leaseRuntime(projectId: string, runtime: OpenProjectRuntime): ProjectCollaborationRuntimeLease {
    runtime.leaseCount += 1
    let released = false
    const leasedRuntime = runtime
    return Object.freeze({
      collaborationDirectory: leasedRuntime.collaborationDirectory,
      persistence: leasedRuntime.persistence,
      localActorId: leasedRuntime.localActorId,
      projectId,
      projectRoot: leasedRuntime.projectRoot,
      runtimeIdentity: leasedRuntime.runtimeIdentity,
      assertLive: () => {
        if (released || this.disposed || this.openProjects.get(projectId) !== leasedRuntime) {
          throw new ProjectCollaborationRuntimeCoordinatorError(
            "runtime-disposed",
            "Project collaboration runtime lease is no longer live",
          )
        }
      },
      release: () => {
        if (released) return
        released = true
        leasedRuntime.leaseCount -= 1
        if (leasedRuntime.leaseCount === 0) {
          this.closeRuntime(projectId, leasedRuntime)
        }
      },
    })
  }

  runClosed<Result>(input: {
    readonly projectId: string
    readonly projectRoot: string
    readonly operation: () => Promise<Result>
  }): Promise<Result> {
    this.requireLive()
    return this.serialize(input.projectId, async () => {
      this.requireLive()
      const projectRoot = await this.resolveCanonicalProjectRoot(input.projectId)
      if (
        !path.isAbsolute(input.projectRoot) ||
        path.resolve(input.projectRoot) !== input.projectRoot ||
        projectRoot !== input.projectRoot
      ) {
        throw new ProjectCollaborationRuntimeCoordinatorError(
          "project-binding-changed",
          "Project reset root no longer matches the bound Project",
        )
      }
      await this.options.quiescence.quiesceProject({
        projectId: input.projectId,
        projectRoot,
      })
      const runtime = this.openProjects.get(input.projectId)
      if (runtime?.leaseCount) {
        throw new ProjectCollaborationRuntimeCoordinatorError(
          "project-sessions-still-active",
          "Project reset cannot start while collaboration sessions remain active",
        )
      }
      if (runtime) {
        this.closeRuntime(input.projectId, runtime)
      }
      const result = await input.operation()
      this.bindings.delete(input.projectId)
      return result
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const failures: unknown[] = []
    for (const [projectId, runtime] of this.openProjects) {
      if (runtime.leaseCount > 0) {
        failures.push(
          new ProjectCollaborationRuntimeCoordinatorError(
            "project-sessions-still-active",
            `Project ${projectId} still has active collaboration sessions`,
          ),
        )
        continue
      }
      this.closeRuntime(projectId, runtime)
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Project collaboration runtime could not close cleanly")
    }
  }

  private async resolveCanonicalProjectRoot(projectId: string): Promise<string> {
    const resolved = await this.options.projects.resolveProjectRoot({ projectId })
    if (!path.isAbsolute(resolved) || path.resolve(resolved) !== resolved) {
      throw new ProjectCollaborationRuntimeCoordinatorError(
        "project-binding-changed",
        "Project root must be an absolute canonical path",
      )
    }
    return resolved
  }

  private closeRuntime(projectId: string, runtime: OpenProjectRuntime): void {
    try {
      runtime.persistence.dispose()
    } finally {
      if (this.openProjects.get(projectId) === runtime) this.openProjects.delete(projectId)
      this.releaseRuntimeIdentity(projectId, runtime.projectRoot, runtime.runtimeIdentity)
    }
  }

  private releaseRuntimeIdentity(projectId: string, projectRoot: string, runtimeIdentity: object): void {
    this.options.identity.releaseRuntimeIdentity?.({ projectId, projectRoot, runtimeIdentity })
  }

  private requireLive(): void {
    if (this.disposed) {
      throw new ProjectCollaborationRuntimeCoordinatorError(
        "runtime-disposed",
        "Project collaboration runtime is disposed",
      )
    }
  }

  private serialize<Result>(projectId: string, operation: () => Promise<Result>): Promise<Result> {
    const prior = this.queues.get(projectId) ?? Promise.resolve()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = prior.catch(() => undefined).then(() => barrier)
    this.queues.set(projectId, current)
    return prior
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        release()
        if (this.queues.get(projectId) === current) this.queues.delete(projectId)
      })
  }
}
