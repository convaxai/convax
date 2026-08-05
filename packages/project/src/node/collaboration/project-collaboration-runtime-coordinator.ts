import path from "node:path"
import { parseActorIdV2, type ActorIdV2 } from "@convax/collaboration"
import {
  NodeCollaborationPersistenceV2,
  type NodeReplicaHeadMaterializerV2,
} from "./persistence-store"
import type {
  ProjectClosedMutationGateV1,
  ProjectRecoveryRootPortV1,
} from "./project-collaboration-recovery-service"

export interface ProjectCollaborationRuntimeRootPortV2 {
  resolveProjectRoot(input: { readonly projectId: string }): Promise<string>
}

export interface ProjectCollaborationRuntimeQuiescencePortV2 {
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

export interface ProjectCollaborationRuntimeIdentityPortV2 {
  /** Resolves the exact local replica actor for this bound Project/epoch. */
  resolveLocalActorId(input: {
    readonly projectId: string
    readonly projectRoot: string
  }): Promise<ActorIdV2>
}

export interface ProjectCollaborationWriterFactoryV2 {
  open(input: {
    readonly collaborationDirectory: string
    readonly localActorId: ActorIdV2
    readonly materializer: NodeReplicaHeadMaterializerV2
  }): Promise<NodeCollaborationPersistenceV2>
}

export interface ProjectCollaborationRuntimeLeaseV2 {
  readonly projectId: string
  readonly projectRoot: string
  readonly collaborationDirectory: string
  readonly persistence: NodeCollaborationPersistenceV2
  readonly localActorId: ActorIdV2
  release(): void
}

export type ProjectCollaborationRuntimeCoordinatorErrorCodeV2 =
  | "project-binding-changed"
  | "project-sessions-still-active"
  | "runtime-disposed"

export class ProjectCollaborationRuntimeCoordinatorErrorV2 extends Error {
  constructor(
    readonly code: ProjectCollaborationRuntimeCoordinatorErrorCodeV2,
    message: string,
  ) {
    super(message)
    this.name = "ProjectCollaborationRuntimeCoordinatorErrorV2"
  }
}

export interface NodeProjectCollaborationRuntimeCoordinatorOptionsV2 {
  readonly identity: ProjectCollaborationRuntimeIdentityPortV2
  readonly materializer: NodeReplicaHeadMaterializerV2
  readonly projects: ProjectCollaborationRuntimeRootPortV2
  readonly quiescence: ProjectCollaborationRuntimeQuiescencePortV2
  readonly writerFactory?: ProjectCollaborationWriterFactoryV2
}

interface OpenProjectRuntimeV2 {
  readonly collaborationDirectory: string
  readonly persistence: NodeCollaborationPersistenceV2
  readonly projectRoot: string
  readonly localActorId: ActorIdV2
  leaseCount: number
}

interface ProjectRuntimeBindingV2 {
  readonly projectRoot: string
  readonly localActorId: ActorIdV2
}

/**
 * Project-owned native collaboration lifecycle.
 *
 * One coordinator instance is the Main-process composition for all Projects. It
 * shares exactly one persistence writer per bound Project, and its close gate is
 * the only legal bridge into Project reset. The host may quiesce product surfaces,
 * but it cannot choose the collaboration directory or dispose a writer directly.
 */
export class NodeProjectCollaborationRuntimeCoordinatorV2
  implements ProjectClosedMutationGateV1, ProjectRecoveryRootPortV1
{
  private readonly bindings = new Map<string, ProjectRuntimeBindingV2>()
  private readonly openProjects = new Map<string, OpenProjectRuntimeV2>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly writerFactory: ProjectCollaborationWriterFactoryV2
  private disposed = false

  constructor(private readonly options: NodeProjectCollaborationRuntimeCoordinatorOptionsV2) {
    this.writerFactory =
      options.writerFactory ??
      Object.freeze({
        open: (input: Parameters<typeof NodeCollaborationPersistenceV2.open>[0]) =>
          NodeCollaborationPersistenceV2.open(input),
      })
  }

  async resolveProjectRoot(projectId: string): Promise<string> {
    this.requireLive()
    return this.options.projects.resolveProjectRoot({ projectId })
  }

  acquire(projectId: string): Promise<ProjectCollaborationRuntimeLeaseV2> {
    this.requireLive()
    return this.serialize(projectId, async () => {
      this.requireLive()
      const projectRoot = await this.resolveCanonicalProjectRoot(projectId)
      const localActorId = parseActorIdV2(await this.options.identity.resolveLocalActorId({ projectId, projectRoot }))
      const collaborationDirectory = path.join(projectRoot, ".convax", "collaboration")
      const binding = this.bindings.get(projectId)
      if (binding && (binding.projectRoot !== projectRoot || binding.localActorId !== localActorId)) {
        throw new ProjectCollaborationRuntimeCoordinatorErrorV2(
          "project-binding-changed",
          "Project root or local actor binding changed without a successful close/reset barrier",
        )
      }
      let runtime = this.openProjects.get(projectId)
      if (runtime && (runtime.projectRoot !== projectRoot || runtime.localActorId !== localActorId)) {
        throw new ProjectCollaborationRuntimeCoordinatorErrorV2(
          "project-binding-changed",
          "Project root or local actor binding changed while its collaboration runtime exists",
        )
      }
      if (!runtime) {
        const persistence = await this.writerFactory.open({
          collaborationDirectory,
          localActorId,
          materializer: this.options.materializer,
        })
        runtime = {
          collaborationDirectory,
          leaseCount: 0,
          persistence,
          projectRoot,
          localActorId,
        }
        this.openProjects.set(projectId, runtime)
        this.bindings.set(projectId, Object.freeze({ projectRoot, localActorId }))
      }
      runtime.leaseCount += 1
      let released = false
      const leasedRuntime = runtime
      return Object.freeze({
        collaborationDirectory: leasedRuntime.collaborationDirectory,
        persistence: leasedRuntime.persistence,
        localActorId: leasedRuntime.localActorId,
        projectId,
        projectRoot: leasedRuntime.projectRoot,
        release: () => {
          if (released) return
          released = true
          leasedRuntime.leaseCount -= 1
          if (leasedRuntime.leaseCount === 0) {
            leasedRuntime.persistence.dispose()
            if (this.openProjects.get(projectId) === leasedRuntime) {
              this.openProjects.delete(projectId)
            }
          }
        },
      })
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
        throw new ProjectCollaborationRuntimeCoordinatorErrorV2(
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
        throw new ProjectCollaborationRuntimeCoordinatorErrorV2(
          "project-sessions-still-active",
          "Project reset cannot start while collaboration sessions remain active",
        )
      }
      if (runtime) {
        runtime.persistence.dispose()
        this.openProjects.delete(input.projectId)
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
          new ProjectCollaborationRuntimeCoordinatorErrorV2(
            "project-sessions-still-active",
            `Project ${projectId} still has active collaboration sessions`,
          ),
        )
        continue
      }
      runtime.persistence.dispose()
      this.openProjects.delete(projectId)
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Project collaboration runtime could not close cleanly")
    }
  }

  private async resolveCanonicalProjectRoot(projectId: string): Promise<string> {
    const resolved = await this.options.projects.resolveProjectRoot({ projectId })
    if (!path.isAbsolute(resolved) || path.resolve(resolved) !== resolved) {
      throw new ProjectCollaborationRuntimeCoordinatorErrorV2(
        "project-binding-changed",
        "Project root must be an absolute canonical path",
      )
    }
    return resolved
  }

  private requireLive(): void {
    if (this.disposed) {
      throw new ProjectCollaborationRuntimeCoordinatorErrorV2(
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
