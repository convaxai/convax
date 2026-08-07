import type { CanvasDocumentRef } from "@convax/canvas/application"
import {
  parseCanvasId,
  parseProjectId,
  type CollaborationKernelOptions,
  type DocumentScope,
  type Id128,
  type OwnerValidatedState,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import {
  parseProjectCanvasCatalogProjection,
  type ProjectCanvasCatalogProjection,
} from "@convax/project/canvas"
import type {
  NodeProjectCollaborationRuntimeCoordinator,
  ProjectCollaborationRuntimeLease,
} from "@convax/project/node"

import {
  createMainCollaborationLatencyDiagnosticsPort,
  createKernelBackedMainCollaborationDocumentSession,
  type MainCollaborationDocumentSession,
} from "./collaboration-document-session"
import {
  createMainCollaborationProductionRuntime,
  type OpenProjectCollaborationDocument,
  type ProjectCollaborationMaterializerRegistry,
} from "./collaboration-production-runtime"
import type {
  CurrentLocalReplicaAuthoritySource,
  IncomingReplicaAuthoritySource,
} from "./collaboration-authority-ports"

export interface ProjectCanvasCatalogResolver {
  queryCatalog(input: { readonly projectId: ReturnType<typeof parseProjectId> }): Promise<ProjectCanvasCatalogProjection>
}

export interface CanvasRouteRuntimeHandle {
  readonly session: MainCollaborationDocumentSession<"canvas">
  dispose(): void
}

export interface CanvasRouteRuntimeOpener {
  open(input: {
    readonly ref: CanvasDocumentRef
    readonly scope: DocumentScope & { readonly docKind: "canvas" }
    readonly project: ProjectCollaborationRuntimeLease
  }): Promise<CanvasRouteRuntimeHandle>
}

export type ProjectCanvasRouteRuntimeErrorCode =
  | "inactive-project"
  | "route-not-live"
  | "route-changed"
  | "runtime-disposed"

export class ProjectCanvasRouteRuntimeError extends Error {
  constructor(readonly code: ProjectCanvasRouteRuntimeErrorCode, message: string) {
    super(message)
    this.name = "ProjectCanvasRouteRuntimeError"
  }
}

interface ExactRouteIdentity {
  readonly projectId: ReturnType<typeof parseProjectId>
  readonly projectEpoch: Id128
  readonly canvasId: ReturnType<typeof parseCanvasId>
  readonly shardEpoch: Id128
  readonly activationDigest: string
  readonly routeProjectionDigest: string
}

interface OpenRouteEntry {
  readonly generation: object
  readonly identity: ExactRouteIdentity
  readonly scope: DocumentScope & { readonly docKind: "canvas" }
  readonly project: ProjectCollaborationRuntimeLease
  readonly runtime: CanvasRouteRuntimeHandle
  references: number
  revoked: boolean
}

/**
 * Main-only route authority adapter. It never accepts a caller-selected epoch and
 * never caches a route past an explicit reconciliation boundary.
 */
export class MainProjectCanvasRouteRuntimeRegistry {
  private readonly entries = new Map<string, OpenRouteEntry>()
  private readonly lanes = new Map<string, Promise<void>>()
  private activeProjectId: ReturnType<typeof parseProjectId> | null = null
  private disposed = false

  constructor(private readonly options: {
    readonly catalogs: ProjectCanvasCatalogResolver
    readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinator, "acquire">
    readonly runtime: CanvasRouteRuntimeOpener
  }) {}

  /** Project switch is a revocation barrier, not a hint for a later open. */
  async switchProject(projectId: string | null): Promise<void> {
    this.requireLive()
    const next = projectId === null ? null : parseProjectId(projectId)
    this.activeProjectId = next
    await Promise.all([...this.entries.entries()]
      .filter(([, entry]) => entry.identity.projectId !== next)
      .map(([key]) => this.serialize(key, async () => this.revokeCurrent(key))))
  }

  /** Main-only Project reset barrier; revokes the exact Project without touching others. */
  async quiesceProject(projectIdInput: string): Promise<void> {
    this.requireLive()
    const projectId = parseProjectId(projectIdInput)
    if (this.activeProjectId === projectId) this.activeProjectId = null
    await Promise.all([...this.entries.entries()]
      .filter(([, entry]) => entry.identity.projectId === projectId)
      .map(([key]) => this.serialize(key, async () => this.revokeCurrent(key))))
  }

  /**
   * Returns a lease-shaped session compatible with CanvasCollaborationSessionOwner.
   * Disposing an obsolete wrapper cannot close a newer reset incarnation.
   */
  async openDocumentSession(
    ref: CanvasDocumentRef,
  ): Promise<MainCollaborationDocumentSession<"canvas">> {
    this.requireLive()
    const projectId = parseProjectId(ref.scopeId)
    const canvasId = parseCanvasId(ref.canvasId)
    const key = routeKey(projectId, canvasId)
    return this.serialize(key, async () => {
      this.requireLive()
      this.requireActive(projectId)
      const identity = await this.resolveLiveRoute(projectId, canvasId)
      let entry = this.entries.get(key)
      if (entry && !sameRoute(entry.identity, identity)) {
        this.revoke(entry)
        this.entries.delete(key)
        entry = undefined
      }
      if (!entry) {
        const project = await this.options.projects.acquire(projectId)
        let runtime: CanvasRouteRuntimeHandle | undefined
        try {
          const scope = Object.freeze({
            projectId,
            projectEpoch: identity.projectEpoch,
            docKind: "canvas" as const,
            docId: canvasId,
            shardEpoch: identity.shardEpoch,
          })
          runtime = await this.options.runtime.open({ ref: { scopeId: projectId, canvasId }, scope, project })
          this.requireLive()
          this.requireActive(projectId)
          const current = await this.resolveLiveRoute(projectId, canvasId)
          if (!sameRoute(identity, current)) {
            throw new ProjectCanvasRouteRuntimeError("route-changed", "Canvas route changed while its runtime was opening")
          }
          entry = {
            generation: {}, identity, project, references: 0, revoked: false, runtime, scope,
          }
          this.entries.set(key, entry)
        } catch (error) {
          runtime?.dispose()
          project.release()
          throw error
        }
      }
      entry.references += 1
      return leaseRouteSession(entry, () => this.release(key, entry!.generation))
    })
  }

  /** Re-read ProjectIndex and synchronously revoke every non-exact route. */
  async reconcileProject(projectIdInput: string): Promise<void> {
    this.requireLive()
    const projectId = parseProjectId(projectIdInput)
    const catalog = parseProjectCanvasCatalogProjection(
      await this.options.catalogs.queryCatalog({ projectId }), projectId,
    )
    const identities = new Map(catalog.routes
      .filter((route) => route.state === "live")
      .map((route) => [route.canvasId, routeIdentity(catalog, route)] as const))
    await Promise.all([...this.entries.entries()]
      .filter(([, entry]) => entry.identity.projectId === projectId)
      .map(([key, entry]) => this.serialize(key, async () => {
        const current = identities.get(entry.identity.canvasId)
        if (!current || !sameRoute(entry.identity, current)) this.revokeCurrent(key)
      })))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const keys = [...this.entries.keys()]
    await Promise.all(keys.map((key) => this.serialize(key, async () => this.revokeCurrent(key))))
  }

  private async resolveLiveRoute(
    projectId: ReturnType<typeof parseProjectId>,
    canvasId: ReturnType<typeof parseCanvasId>,
  ): Promise<ExactRouteIdentity> {
    const catalog = parseProjectCanvasCatalogProjection(
      await this.options.catalogs.queryCatalog({ projectId }), projectId,
    )
    const route = catalog.routes.find((candidate) => candidate.canvasId === canvasId)
    if (!route || route.state !== "live") {
      throw new ProjectCanvasRouteRuntimeError("route-not-live", "ProjectIndex route is not live")
    }
    return routeIdentity(catalog, route)
  }

  private async release(key: string, generation: object): Promise<void> {
    await this.serialize(key, async () => {
      const entry = this.entries.get(key)
      if (!entry || entry.generation !== generation || entry.revoked) return
      entry.references -= 1
      if (entry.references === 0) this.revokeCurrent(key)
    })
  }

  private revokeCurrent(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.revoke(entry)
  }

  private revoke(entry: OpenRouteEntry): void {
    if (entry.revoked) return
    entry.revoked = true
    entry.runtime.dispose()
    entry.project.release()
  }

  private requireActive(projectId: ReturnType<typeof parseProjectId>): void {
    if (this.activeProjectId !== projectId) {
      throw new ProjectCanvasRouteRuntimeError("inactive-project", "Canvas route does not belong to the active Project")
    }
  }

  private requireLive(): void {
    if (this.disposed) throw new ProjectCanvasRouteRuntimeError("runtime-disposed", "Canvas route runtime registry is disposed")
  }

  private async serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => { release = resolve })
    const lane = previous.then(() => next)
    this.lanes.set(key, lane)
    await previous
    try { return await operation() } finally {
      release()
      if (this.lanes.get(key) === lane) this.lanes.delete(key)
    }
  }
}

/** Production opener: exact scope is supplied only by the route registry above. */
export function createProductionCanvasRouteRuntimeOpener(input: {
  readonly authority: CurrentProtocolAuthority
  readonly localAuthority: CurrentLocalReplicaAuthoritySource
  readonly incomingAuthority: IncomingReplicaAuthoritySource
  readonly materializers: ProjectCollaborationMaterializerRegistry
  readonly signatureVerifier: CollaborationKernelOptions["signatureVerifier"]
  readonly createOperationId: () => Id128
  readonly describeCanvas: (input: {
    readonly ref: CanvasDocumentRef
    readonly scope: DocumentScope & { readonly docKind: "canvas" }
  }) => Omit<OpenProjectCollaborationDocument<"canvas">, "scope">
}): CanvasRouteRuntimeOpener {
  return Object.freeze({
    async open({ ref, scope, project }: Parameters<CanvasRouteRuntimeOpener["open"]>[0]) {
      const descriptor = input.describeCanvas({ ref, scope })
      const runtime = await createMainCollaborationProductionRuntime({
        authority: input.authority,
        scope,
        owner: descriptor.owner,
        actorId: project.localActorId,
        localAuthority: input.localAuthority,
        incomingAuthority: input.incomingAuthority,
        incomingFacts: descriptor.incomingFacts,
        createDocument: descriptor.createDocument,
        requiredBlobDigests: descriptor.requiredBlobDigests,
        persistence: project.persistence,
        materializers: input.materializers,
        ...(descriptor.prepareShard ? { prepareShard: descriptor.prepareShard } : {}),
      })
      try {
        const session = await createKernelBackedMainCollaborationDocumentSession({
          authority: input.authority,
          scope,
          owner: descriptor.owner,
          ports: runtime.ports,
          signatureVerifier: input.signatureVerifier,
          createOperationId: input.createOperationId,
          diagnostics: createMainCollaborationLatencyDiagnosticsPort({
            recordAll: process.env.CONVAX_COLLABORATION_LATENCY_RECORD_ALL === "1",
            // Record-all is a benchmark mode. Avoid letting an O(outbox) sampler
            // contend with the following root and perturb the latency distribution.
            sample: process.env.CONVAX_COLLABORATION_LATENCY_RECORD_ALL === "1"
              ? () => ({})
              : () => runtime.persistence.sampleLatencyDiagnostics(scope),
          }),
        })
        return Object.freeze({ session, dispose() { session.dispose(); runtime.dispose() } })
      } catch (error) {
        runtime.dispose()
        throw error
      }
    },
  })
}

function routeIdentity(
  catalog: ProjectCanvasCatalogProjection,
  route: ProjectCanvasCatalogProjection["routes"][number],
): ExactRouteIdentity {
  if (route.shardEpoch === null || route.activationDigest === null) {
    throw new ProjectCanvasRouteRuntimeError("route-not-live", "Live Canvas route is incomplete")
  }
  return Object.freeze({
    projectId: catalog.projectId,
    projectEpoch: catalog.projectEpoch,
    canvasId: route.canvasId,
    shardEpoch: route.shardEpoch,
    activationDigest: route.activationDigest,
    routeProjectionDigest: route.routeProjectionDigest,
  })
}

function sameRoute(left: ExactRouteIdentity, right: ExactRouteIdentity): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.canvasId === right.canvasId && left.shardEpoch === right.shardEpoch &&
    left.activationDigest === right.activationDigest && left.routeProjectionDigest === right.routeProjectionDigest
}

function routeKey(projectId: string, canvasId: string): string {
  return `${projectId}\0${canvasId}`
}

function leaseRouteSession(
  entry: OpenRouteEntry,
  release: () => Promise<void>,
): MainCollaborationDocumentSession<"canvas"> {
  return leaseSession(entry, entry.runtime.session, release)
}

function leaseSession(
  entry: OpenRouteEntry,
  session: MainCollaborationDocumentSession<"canvas">,
  release: () => Promise<void>,
): MainCollaborationDocumentSession<"canvas"> {
  let live = true
  const requireLive = () => {
    if (!live || entry.revoked) throw new ProjectCanvasRouteRuntimeError("route-changed", "Canvas route session was revoked")
  }
  return Object.freeze({
    scope: entry.scope,
    query<T>(project: (state: OwnerValidatedState<"canvas">) => T): Promise<T> {
      requireLive(); return session.query(project)
    },
    submit(input: Parameters<MainCollaborationDocumentSession<"canvas">["submit"]>[0]) {
      requireLive(); return session.submit(input)
    },
    flush() { requireLive(); return session.flush() },
    subscribe(listener: Parameters<MainCollaborationDocumentSession<"canvas">["subscribe"]>[0]) {
      requireLive(); return session.subscribe(listener)
    },
    dispose() {
      if (!live) return
      live = false
      void release()
    },
  })
}
