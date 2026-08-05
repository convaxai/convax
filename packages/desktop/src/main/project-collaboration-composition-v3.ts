import type {
  CanvasApplicationCommandRequest,
  CanvasDocumentRef,
} from "@convax/canvas/application"
import { parseId128V2, parseProjectIdV2, type Id128V2, type ProjectIdV2 } from "@convax/collaboration"
import type { ProjectIndexCurrentBlobReferencePortV2 } from "@convax/project"
import type {
  ProjectIndexCanvasApplicationPortV2,
  ProjectIndexFileApplicationPortV2,
  ProjectIndexFileMaterializationProjectionPortV2,
} from "@convax/project/canvas"

import type {
  CanvasCollaborationSessionOwnerV2,
  CanvasSessionInvalidationDtoV2,
} from "./canvas-collaboration-session-owner"

export type MainProjectProtocolSelectionV3 = "v10-r5" | "v11-r1-local-owner" | "v11-r1-team-replica"

export interface MainSelectedProjectCollaborationPortsV3 {
  readonly projectId: ProjectIdV2
  readonly protocol: MainProjectProtocolSelectionV3
  readonly projectIndexes: ProjectIndexCanvasApplicationPortV2 &
    ProjectIndexCurrentBlobReferencePortV2 &
    ProjectIndexFileApplicationPortV2 &
    ProjectIndexFileMaterializationProjectionPortV2
  readonly canvasSessions: CanvasCollaborationSessionOwnerV2
  /** Flushes ProjectIndex and Canvas runtime state before a writer transition. */
  quiesce?(): Promise<void>
  /** Releases only this resolved Project runtime. */
  dispose?(): Promise<void> | void
}

export type MainProjectCollaborationResolutionV3 =
  | Readonly<{ status: "ready"; ports: MainSelectedProjectCollaborationPortsV3 }>
  | Readonly<{
      status: "unavailable"
      reason: "owner-key-missing" | "evidence-corrupt" | "promotion-ambiguous" | "protocol-unavailable"
    }>

export interface MainProjectCollaborationPortResolverV3 {
  /** Selection must use only Project-owned persisted protocol state. */
  resolve(projectId: ProjectIdV2): Promise<MainProjectCollaborationResolutionV3>
}

export class MainProjectCollaborationUnavailableErrorV3 extends Error {
  readonly code = "local-authority-unavailable" as const

  constructor(readonly reason: Extract<MainProjectCollaborationResolutionV3, { status: "unavailable" }>["reason"]) {
    super(`Project collaboration runtime is unavailable: ${reason}`)
    this.name = "MainProjectCollaborationUnavailableErrorV3"
  }
}

export interface MainProjectCollaborationCompositionFacadeV3 {
  readonly projectIndexes: MainSelectedProjectCollaborationPortsV3["projectIndexes"]
  readonly canvasSessions: CanvasCollaborationSessionOwnerV2
  /** Resolve and resume the persisted protocol selection before renderer access. */
  prepareProject(projectId: string): Promise<MainProjectProtocolSelectionV3>
  /** Stop new opens, flush both document families and release session bindings. */
  quiesceProject(projectId: string): Promise<void>
  dispose(): Promise<void>
}

interface BoundSessionV3 {
  readonly ref: CanvasDocumentRef
  readonly owner: CanvasCollaborationSessionOwnerV2
}

/**
 * Protocol-neutral Main routing facade. It never decodes frames, creates an
 * authority, or manufactures an operation receipt. Every result is returned by
 * the already-selected V10/V11 owner port unchanged.
 */
export function createMainProjectCollaborationCompositionFacadeV3(
  resolver: MainProjectCollaborationPortResolverV3,
): MainProjectCollaborationCompositionFacadeV3 {
  const runtimes = new Map<ProjectIdV2, Promise<MainSelectedProjectCollaborationPortsV3>>()
  const ready = new Map<ProjectIdV2, MainSelectedProjectCollaborationPortsV3>()
  const sessions = new Map<Id128V2, BoundSessionV3>()
  const listeners = new Set<(event: CanvasSessionInvalidationDtoV2) => void>()
  const ownerSubscriptions = new Map<CanvasCollaborationSessionOwnerV2, () => void>()
  const quiescing = new Set<ProjectIdV2>()
  let disposed = false

  const projectIndexes: MainSelectedProjectCollaborationPortsV3["projectIndexes"] = {
    async queryCatalog(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.queryCatalog(input)
    },
    async submitRouteCommand(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.submitRouteCommand(input)
    },
    async queryCurrentBlobDigests(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.queryCurrentBlobDigests(input)
    },
    async createDirectory(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.createDirectory(input)
    },
    async publishFile(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.publishFile(input)
    },
    async relocateEntry(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.relocateEntry(input)
    },
    async tombstoneEntry(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.tombstoneEntry(input)
    },
    async queryFileMaterializationPlan(input) {
      return (await runtimeFor(input.projectId)).projectIndexes.queryFileMaterializationPlan(input)
    },
  }
  Object.freeze(projectIndexes)

  const canvasSessions: CanvasCollaborationSessionOwnerV2 = {
    async open(input) {
      const runtime = await runtimeFor(parseProjectIdV2(input.ref.scopeId))
      subscribeOwner(runtime.canvasSessions)
      const projection = await runtime.canvasSessions.open(input)
      const sessionId = parseId128V2(projection.sessionId)
      if (sessions.has(sessionId)) {
        runtime.canvasSessions.close({ ref: input.ref, sessionId })
        throw new Error("Selected Canvas owner reused a live session identity")
      }
      sessions.set(sessionId, Object.freeze({ ref: normalizeRef(input.ref), owner: runtime.canvasSessions }))
      return projection
    },
    close(input) {
      const bound = requireSession(input.ref, input.sessionId)
      sessions.delete(parseId128V2(input.sessionId))
      bound.owner.close(input)
    },
    queryRenderer(ref, sessionId) {
      return requireSession(ref, sessionId).owner.queryRenderer(ref, sessionId)
    },
    submitRenderer(input) {
      return requireSession(input.ref, input.sessionId).owner.submitRenderer(input)
    },
    undo(input) {
      return requireSession(input.ref, input.sessionId).owner.undo(input)
    },
    redo(input) {
      return requireSession(input.ref, input.sessionId).owner.redo(input)
    },
    flush(ref, sessionId) {
      return sessionId === undefined
        ? runtimeFor(parseProjectIdV2(ref.scopeId)).then((runtime) => runtime.canvasSessions.flush(ref))
        : requireSession(ref, sessionId).owner.flush(ref, sessionId)
    },
    async query(ref, query) {
      return (await runtimeFor(parseProjectIdV2(ref.scopeId))).canvasSessions.query(ref, query)
    },
    async submit(request: CanvasApplicationCommandRequest) {
      return (await runtimeFor(parseProjectIdV2(request.scopeId))).canvasSessions.submit(request)
    },
    async queryAuthoritative(ref) {
      return (await runtimeFor(parseProjectIdV2(ref.scopeId))).canvasSessions.queryAuthoritative(ref)
    },
    async submitAuthoritative(input) {
      return (await runtimeFor(parseProjectIdV2(input.ref.scopeId))).canvasSessions.submitAuthoritative(input)
    },
    async quiesceProject(projectId) {
      await quiesceProject(projectId)
    },
    resumeProject(projectIdInput) {
      const projectId = parseProjectIdV2(projectIdInput)
      const runtime = ready.get(projectId)
      if (!runtime || quiescing.has(projectId)) {
        throw new Error("Project runtime must be prepared before it can resume")
      }
      runtime.canvasSessions.resumeProject(projectId)
    },
    subscribe(listener) {
      requireLive()
      if (typeof listener !== "function") throw new TypeError("Canvas session listener is required")
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      void dispose()
    },
  }
  Object.freeze(canvasSessions)

  return Object.freeze({
    projectIndexes,
    canvasSessions,
    async prepareProject(projectIdInput: string) {
      const projectId = parseProjectIdV2(projectIdInput)
      const runtime = await runtimeFor(projectId)
      runtime.canvasSessions.resumeProject(projectId)
      return runtime.protocol
    },
    quiesceProject,
    dispose,
  })

  async function runtimeFor(projectIdInput: ProjectIdV2): Promise<MainSelectedProjectCollaborationPortsV3> {
    requireLive()
    const projectId = parseProjectIdV2(projectIdInput)
    if (quiescing.has(projectId)) throw new Error("Project collaboration runtime is quiescing")
    let promised = runtimes.get(projectId)
    if (!promised) {
      promised = resolveRuntime(projectId)
      runtimes.set(projectId, promised)
      void promised.then(
        (runtime) => ready.set(projectId, runtime),
        () => { if (runtimes.get(projectId) === promised) runtimes.delete(projectId) },
      )
    }
    return promised
  }

  async function resolveRuntime(projectId: ProjectIdV2): Promise<MainSelectedProjectCollaborationPortsV3> {
    const resolved = await resolver.resolve(projectId)
    if (resolved.status === "unavailable") throw new MainProjectCollaborationUnavailableErrorV3(resolved.reason)
    if (parseProjectIdV2(resolved.ports.projectId) !== projectId) {
      throw new Error("Resolved collaboration runtime crossed its Project binding")
    }
    return Object.freeze(resolved.ports)
  }

  async function quiesceProject(projectIdInput: string): Promise<void> {
    requireLive()
    const projectId = parseProjectIdV2(projectIdInput)
    if (quiescing.has(projectId)) throw new Error("Project collaboration runtime is already quiescing")
    quiescing.add(projectId)
    try {
      const runtime = ready.get(projectId) ?? await runtimes.get(projectId)
      if (!runtime) return
      await runtime.canvasSessions.quiesceProject(projectId)
      await runtime.quiesce?.()
      for (const [sessionId, bound] of sessions) {
        if (bound.ref.scopeId === projectId) sessions.delete(sessionId)
      }
      runtimes.delete(projectId)
      ready.delete(projectId)
      await runtime.dispose?.()
    } finally {
      quiescing.delete(projectId)
    }
  }

  function requireSession(refInput: CanvasDocumentRef, sessionIdInput: Id128V2): BoundSessionV3 {
    requireLive()
    const ref = normalizeRef(refInput)
    const sessionId = parseId128V2(sessionIdInput)
    const bound = sessions.get(sessionId)
    if (!bound || !sameRef(bound.ref, ref)) throw new Error("Canvas session is stale or belongs to another Project runtime")
    return bound
  }

  function subscribeOwner(owner: CanvasCollaborationSessionOwnerV2): void {
    if (ownerSubscriptions.has(owner)) return
    ownerSubscriptions.set(owner, owner.subscribe((event) => {
      const bound = sessions.get(parseId128V2(event.sessionId))
      if (!bound || bound.owner !== owner || !sameRef(bound.ref, event.ref)) return
      for (const listener of listeners) {
        try { listener(event) } catch { /* Projection listeners cannot affect durable state. */ }
      }
    }))
  }

  async function dispose(): Promise<void> {
    if (disposed) return
    disposed = true
    listeners.clear()
    sessions.clear()
    for (const unsubscribe of ownerSubscriptions.values()) unsubscribe()
    ownerSubscriptions.clear()
    const settled = await Promise.allSettled(runtimes.values())
    runtimes.clear()
    ready.clear()
    const unique = new Set<MainSelectedProjectCollaborationPortsV3>()
    for (const result of settled) if (result.status === "fulfilled") unique.add(result.value)
    for (const runtime of unique) await runtime.dispose?.()
  }

  function requireLive(): void {
    if (disposed) throw new Error("Project collaboration composition is disposed")
  }
}

function normalizeRef(ref: CanvasDocumentRef): CanvasDocumentRef {
  return Object.freeze({ scopeId: parseProjectIdV2(ref.scopeId), canvasId: String(ref.canvasId) })
}

function sameRef(left: CanvasDocumentRef, right: CanvasDocumentRef): boolean {
  return left.scopeId === right.scopeId && left.canvasId === right.canvasId
}
