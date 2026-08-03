import type { CanvasDocumentRef } from "@convax/canvas/application"
import {
  parseCanvasIdV2,
  parseProjectIdV2,
  type CollaborationKernelOptionsV2,
  type DocumentScopeV2,
  type Id128V2,
  type OwnerValidatedStateV2,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"
import {
  parseProjectCanvasCatalogProjectionV2,
  type ProjectCanvasCatalogProjectionV2,
} from "@convax/project/canvas"
import type {
  NodeProjectCollaborationRuntimeCoordinatorV2,
  ProjectCollaborationRuntimeLeaseV2,
} from "@convax/project/node"

import {
  createKernelBackedMainCollaborationDocumentSessionV2,
  type MainCollaborationDocumentSessionV2,
} from "./collaboration-document-session"
import {
  createMainCollaborationProductionRuntimeV2,
  type OpenProjectCollaborationDocumentV2,
  type ProjectCollaborationMaterializerRegistryV2,
} from "./collaboration-production-runtime"
import type {
  CurrentLocalReplicaAuthoritySourceV2,
  IncomingReplicaAuthoritySourceV2,
} from "./collaboration-authority-ports"

export interface ProjectCanvasCatalogResolverV2 {
  queryCatalog(input: { readonly projectId: ReturnType<typeof parseProjectIdV2> }): Promise<ProjectCanvasCatalogProjectionV2>
}

export interface CanvasRouteRuntimeHandleV2 {
  readonly session: MainCollaborationDocumentSessionV2<"canvas">
  dispose(): void
}

export interface CanvasRouteRuntimeOpenerV2 {
  open(input: {
    readonly ref: CanvasDocumentRef
    readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
    readonly project: ProjectCollaborationRuntimeLeaseV2
  }): Promise<CanvasRouteRuntimeHandleV2>
}

export type ProjectCanvasRouteRuntimeErrorCodeV2 =
  | "inactive-project"
  | "route-not-live"
  | "route-changed"
  | "runtime-disposed"

export class ProjectCanvasRouteRuntimeErrorV2 extends Error {
  constructor(readonly code: ProjectCanvasRouteRuntimeErrorCodeV2, message: string) {
    super(message)
    this.name = "ProjectCanvasRouteRuntimeErrorV2"
  }
}

interface ExactRouteIdentityV2 {
  readonly projectId: ReturnType<typeof parseProjectIdV2>
  readonly projectEpoch: Id128V2
  readonly canvasId: ReturnType<typeof parseCanvasIdV2>
  readonly shardEpoch: Id128V2
  readonly activationDigest: string
  readonly routeProjectionDigest: string
}

interface OpenRouteEntryV2 {
  readonly generation: object
  readonly identity: ExactRouteIdentityV2
  readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
  readonly project: ProjectCollaborationRuntimeLeaseV2
  readonly runtime: CanvasRouteRuntimeHandleV2
  references: number
  revoked: boolean
}

/**
 * Main-only route authority adapter. It never accepts a caller-selected epoch and
 * never caches a route past an explicit reconciliation boundary.
 */
export class MainProjectCanvasRouteRuntimeRegistryV2 {
  private readonly entries = new Map<string, OpenRouteEntryV2>()
  private readonly lanes = new Map<string, Promise<void>>()
  private activeProjectId: ReturnType<typeof parseProjectIdV2> | null = null
  private disposed = false

  constructor(private readonly options: {
    readonly catalogs: ProjectCanvasCatalogResolverV2
    readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinatorV2, "acquire">
    readonly runtime: CanvasRouteRuntimeOpenerV2
  }) {}

  /** Project switch is a revocation barrier, not a hint for a later open. */
  async switchProject(projectId: string | null): Promise<void> {
    this.requireLive()
    const next = projectId === null ? null : parseProjectIdV2(projectId)
    this.activeProjectId = next
    await Promise.all([...this.entries.entries()]
      .filter(([, entry]) => entry.identity.projectId !== next)
      .map(([key]) => this.serialize(key, async () => this.revokeCurrent(key))))
  }

  /** Main-only Project reset barrier; revokes the exact Project without touching others. */
  async quiesceProject(projectIdInput: string): Promise<void> {
    this.requireLive()
    const projectId = parseProjectIdV2(projectIdInput)
    if (this.activeProjectId === projectId) this.activeProjectId = null
    await Promise.all([...this.entries.entries()]
      .filter(([, entry]) => entry.identity.projectId === projectId)
      .map(([key]) => this.serialize(key, async () => this.revokeCurrent(key))))
  }

  /**
   * Returns a lease-shaped session compatible with CanvasCollaborationSessionOwner.
   * Disposing an obsolete wrapper cannot close a newer reset incarnation.
   */
  async openDocumentSession(ref: CanvasDocumentRef): Promise<MainCollaborationDocumentSessionV2<"canvas">> {
    this.requireLive()
    const projectId = parseProjectIdV2(ref.scopeId)
    const canvasId = parseCanvasIdV2(ref.canvasId)
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
        let runtime: CanvasRouteRuntimeHandleV2 | undefined
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
            throw new ProjectCanvasRouteRuntimeErrorV2("route-changed", "Canvas route changed while its runtime was opening")
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
      return leaseSession(entry, () => this.release(key, entry!.generation))
    })
  }

  /** Re-read ProjectIndex and synchronously revoke every non-exact route. */
  async reconcileProject(projectIdInput: string): Promise<void> {
    this.requireLive()
    const projectId = parseProjectIdV2(projectIdInput)
    const catalog = parseProjectCanvasCatalogProjectionV2(
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
    projectId: ReturnType<typeof parseProjectIdV2>,
    canvasId: ReturnType<typeof parseCanvasIdV2>,
  ): Promise<ExactRouteIdentityV2> {
    const catalog = parseProjectCanvasCatalogProjectionV2(
      await this.options.catalogs.queryCatalog({ projectId }), projectId,
    )
    const route = catalog.routes.find((candidate) => candidate.canvasId === canvasId)
    if (!route || route.state !== "live") {
      throw new ProjectCanvasRouteRuntimeErrorV2("route-not-live", "ProjectIndex route is not live")
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

  private revoke(entry: OpenRouteEntryV2): void {
    if (entry.revoked) return
    entry.revoked = true
    entry.runtime.dispose()
    entry.project.release()
  }

  private requireActive(projectId: ReturnType<typeof parseProjectIdV2>): void {
    if (this.activeProjectId !== projectId) {
      throw new ProjectCanvasRouteRuntimeErrorV2("inactive-project", "Canvas route does not belong to the active Project")
    }
  }

  private requireLive(): void {
    if (this.disposed) throw new ProjectCanvasRouteRuntimeErrorV2("runtime-disposed", "Canvas route runtime registry is disposed")
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
export function createProductionCanvasRouteRuntimeOpenerV2(input: {
  readonly authority: VerifiedProtocolAuthorityV2
  readonly localAuthority: CurrentLocalReplicaAuthoritySourceV2
  readonly incomingAuthority: IncomingReplicaAuthoritySourceV2
  readonly materializers: ProjectCollaborationMaterializerRegistryV2
  readonly signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  readonly createOperationId: () => Id128V2
  readonly describeCanvas: (input: {
    readonly ref: CanvasDocumentRef
    readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
  }) => Omit<OpenProjectCollaborationDocumentV2<"canvas">, "scope">
}): CanvasRouteRuntimeOpenerV2 {
  return Object.freeze({
    async open({ ref, scope, project }: Parameters<CanvasRouteRuntimeOpenerV2["open"]>[0]) {
      const descriptor = input.describeCanvas({ ref, scope })
      const runtime = await createMainCollaborationProductionRuntimeV2({
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
        const session = await createKernelBackedMainCollaborationDocumentSessionV2({
          authority: input.authority,
          scope,
          owner: descriptor.owner,
          ports: runtime.ports,
          signatureVerifier: input.signatureVerifier,
          createOperationId: input.createOperationId,
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
  catalog: ProjectCanvasCatalogProjectionV2,
  route: ProjectCanvasCatalogProjectionV2["routes"][number],
): ExactRouteIdentityV2 {
  if (route.shardEpoch === null || route.activationDigest === null) {
    throw new ProjectCanvasRouteRuntimeErrorV2("route-not-live", "Live Canvas route is incomplete")
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

function sameRoute(left: ExactRouteIdentityV2, right: ExactRouteIdentityV2): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.canvasId === right.canvasId && left.shardEpoch === right.shardEpoch &&
    left.activationDigest === right.activationDigest && left.routeProjectionDigest === right.routeProjectionDigest
}

function routeKey(projectId: string, canvasId: string): string {
  return `${projectId}\0${canvasId}`
}

function leaseSession(
  entry: OpenRouteEntryV2,
  release: () => Promise<void>,
): MainCollaborationDocumentSessionV2<"canvas"> {
  let live = true
  const requireLive = () => {
    if (!live || entry.revoked) throw new ProjectCanvasRouteRuntimeErrorV2("route-changed", "Canvas route session was revoked")
  }
  return Object.freeze({
    scope: entry.scope,
    query<T>(project: (state: OwnerValidatedStateV2<"canvas">) => T): Promise<T> {
      requireLive(); return entry.runtime.session.query(project)
    },
    submit(input: Parameters<MainCollaborationDocumentSessionV2<"canvas">["submit"]>[0]) {
      requireLive(); return entry.runtime.session.submit(input)
    },
    flush() { requireLive(); return entry.runtime.session.flush() },
    subscribe(listener: Parameters<MainCollaborationDocumentSessionV2<"canvas">["subscribe"]>[0]) {
      requireLive(); return entry.runtime.session.subscribe(listener)
    },
    dispose() {
      if (!live) return
      live = false
      void release()
    },
  })
}
