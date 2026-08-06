import type {
  CanvasApplicationCommandRequest,
  CanvasDocumentRef,
} from "@convax/canvas/application"
import { parseId128, parseProjectId, type Id128, type ProjectId } from "@convax/collaboration"
import type { ProjectIndexCurrentBlobReferencePort } from "@convax/project"
import type {
  ProjectIndexCanvasApplicationPort,
  ProjectIndexFileApplicationPort,
  ProjectIndexFileMaterializationProjectionPort,
} from "@convax/project/canvas"

import type {
  CanvasCollaborationSessionOwner,
  CanvasSessionInvalidationDto,
} from "./canvas-collaboration-session-owner"
import type { MainProjectIndexRuntimeRegistry } from "./main-project-index-runtime-registry"
import type { MainProjectCanvasRouteRuntimeRegistry } from "./project-canvas-route-runtime-registry"

/** Owner ports of one Project runtime in the single current collaboration protocol. */
export interface MainProjectCollaborationPorts {
  readonly projectId: ProjectId
  readonly projectIndexes: ProjectIndexCanvasApplicationPort &
    ProjectIndexCurrentBlobReferencePort &
    ProjectIndexFileApplicationPort &
    ProjectIndexFileMaterializationProjectionPort
  readonly canvasSessions: CanvasCollaborationSessionOwner
  /** Flushes ProjectIndex and Canvas runtime state before a writer transition. */
  quiesce(): Promise<void>
}

export interface MainProjectCollaborationComposition {
  readonly projectIndexes: MainProjectCollaborationPorts["projectIndexes"]
  readonly canvasSessions: CanvasCollaborationSessionOwner
  /** Open and resume the Project runtime before renderer access. */
  prepareProject(projectId: string): Promise<void>
  /** Stop new opens, flush both document families and release session bindings. */
  quiesceProject(projectId: string): Promise<void>
  dispose(): Promise<void>
}

interface BoundSession {
  readonly ref: CanvasDocumentRef
  readonly owner: CanvasCollaborationSessionOwner
}

/**
 * The one Main collaboration composition. New, open, recover and share resolve
 * through these same owner ports: there is no protocol selection, release pair,
 * conflictCopy bridge, parallel runtime, or caller-selected authority. It never
 * decodes frames, creates an authority, or manufactures an operation receipt;
 * every result is returned by the owner port unchanged.
 */
export function createMainProjectCollaborationComposition(input: Readonly<{
  projectIndexes: MainProjectIndexRuntimeRegistry
  canvasSessions: CanvasCollaborationSessionOwner
  canvasRoutes: Pick<MainProjectCanvasRouteRuntimeRegistry, "switchProject" | "quiesceProject">
}>): MainProjectCollaborationComposition {
  const runtimes = new Map<ProjectId, Promise<MainProjectCollaborationPorts>>()
  const ready = new Map<ProjectId, MainProjectCollaborationPorts>()
  const sessions = new Map<Id128, BoundSession>()
  const listeners = new Set<(event: CanvasSessionInvalidationDto) => void>()
  const ownerSubscriptions = new Map<CanvasCollaborationSessionOwner, () => void>()
  const quiescing = new Set<ProjectId>()
  let disposed = false

  const projectIndexes: MainProjectCollaborationPorts["projectIndexes"] = {
    async queryCatalog(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.queryCatalog(request)
    },
    async submitRouteCommand(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.submitRouteCommand(request)
    },
    async queryCurrentBlobDigests(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.queryCurrentBlobDigests(request)
    },
    async queryCurrentResources(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.queryCurrentResources(request)
    },
    async createDirectory(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.createDirectory(request)
    },
    async admitManagedBlob(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.admitManagedBlob(request)
    },
    async publishFile(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.publishFile(request)
    },
    async relocateEntry(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.relocateEntry(request)
    },
    async tombstoneEntry(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.tombstoneEntry(request)
    },
    async queryFileMaterializationPlan(request) {
      return (await runtimeFor(request.projectId)).projectIndexes.queryFileMaterializationPlan(request)
    },
  }
  Object.freeze(projectIndexes)

  const canvasSessions: CanvasCollaborationSessionOwner = {
    async open(request) {
      const runtime = await runtimeFor(parseProjectId(request.ref.scopeId))
      subscribeOwner(runtime.canvasSessions)
      const projection = await runtime.canvasSessions.open(request)
      const sessionId = parseId128(projection.sessionId)
      if (sessions.has(sessionId)) {
        runtime.canvasSessions.close({ ref: request.ref, sessionId })
        throw new Error("Canvas owner reused a live session identity")
      }
      sessions.set(sessionId, Object.freeze({ ref: normalizeRef(request.ref), owner: runtime.canvasSessions }))
      return projection
    },
    close(request) {
      const bound = requireSession(request.ref, request.sessionId)
      sessions.delete(parseId128(request.sessionId))
      bound.owner.close(request)
    },
    queryRenderer(ref, sessionId) {
      return requireSession(ref, sessionId).owner.queryRenderer(ref, sessionId)
    },
    submitRenderer(request) {
      return requireSession(request.ref, request.sessionId).owner.submitRenderer(request)
    },
    undo(request) {
      return requireSession(request.ref, request.sessionId).owner.undo(request)
    },
    redo(request) {
      return requireSession(request.ref, request.sessionId).owner.redo(request)
    },
    flush(ref, sessionId) {
      return sessionId === undefined
        ? runtimeFor(parseProjectId(ref.scopeId)).then((runtime) => runtime.canvasSessions.flush(ref))
        : requireSession(ref, sessionId).owner.flush(ref, sessionId)
    },
    async query(ref, query) {
      return (await runtimeFor(parseProjectId(ref.scopeId))).canvasSessions.query(ref, query)
    },
    async submit(request: CanvasApplicationCommandRequest) {
      return (await runtimeFor(parseProjectId(request.scopeId))).canvasSessions.submit(request)
    },
    async queryAuthoritative(ref) {
      return (await runtimeFor(parseProjectId(ref.scopeId))).canvasSessions.queryAuthoritative(ref)
    },
    async submitAuthoritative(request) {
      return (await runtimeFor(parseProjectId(request.ref.scopeId))).canvasSessions.submitAuthoritative(request)
    },
    async quiesceProject(projectId) {
      await quiesceProject(projectId)
    },
    resumeProject(projectIdInput) {
      const projectId = parseProjectId(projectIdInput)
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
      const projectId = parseProjectId(projectIdInput)
      const runtime = await runtimeFor(projectId)
      runtime.canvasSessions.resumeProject(projectId)
    },
    quiesceProject,
    dispose,
  })

  async function runtimeFor(projectIdInput: ProjectId): Promise<MainProjectCollaborationPorts> {
    requireLive()
    const projectId = parseProjectId(projectIdInput)
    if (quiescing.has(projectId)) throw new Error("Project collaboration runtime is quiescing")
    let promised = runtimes.get(projectId)
    if (!promised) {
      promised = openProjectPorts(projectId)
      runtimes.set(projectId, promised)
      void promised.then(
        (runtime) => ready.set(projectId, runtime),
        () => { if (runtimes.get(projectId) === promised) runtimes.delete(projectId) },
      )
    }
    return promised
  }

  /** Selects the Project route before publication and binds the owner ports. */
  async function openProjectPorts(projectId: ProjectId): Promise<MainProjectCollaborationPorts> {
    await input.canvasRoutes.switchProject(projectId)
    let quiesced = false
    return Object.freeze({
      projectId,
      projectIndexes: input.projectIndexes,
      canvasSessions: input.canvasSessions,
      async quiesce() {
        if (quiesced) return
        quiesced = true
        await input.canvasSessions.quiesceProject(projectId)
        await input.canvasRoutes.quiesceProject(projectId)
        await input.projectIndexes.quiesceProject(projectId)
      },
    })
  }

  async function quiesceProject(projectIdInput: string): Promise<void> {
    requireLive()
    const projectId = parseProjectId(projectIdInput)
    if (quiescing.has(projectId)) throw new Error("Project collaboration runtime is already quiescing")
    quiescing.add(projectId)
    try {
      const runtime = ready.get(projectId) ?? await runtimes.get(projectId)
      if (!runtime) return
      await runtime.quiesce()
      for (const [sessionId, bound] of sessions) {
        if (bound.ref.scopeId === projectId) sessions.delete(sessionId)
      }
      runtimes.delete(projectId)
      ready.delete(projectId)
    } finally {
      quiescing.delete(projectId)
    }
  }

  function requireSession(refInput: CanvasDocumentRef, sessionIdInput: Id128): BoundSession {
    requireLive()
    const ref = normalizeRef(refInput)
    const sessionId = parseId128(sessionIdInput)
    const bound = sessions.get(sessionId)
    if (!bound || !sameRef(bound.ref, ref)) throw new Error("Canvas session is stale or belongs to another Project runtime")
    return bound
  }

  function subscribeOwner(owner: CanvasCollaborationSessionOwner): void {
    if (ownerSubscriptions.has(owner)) return
    ownerSubscriptions.set(owner, owner.subscribe((event) => {
      const bound = sessions.get(parseId128(event.sessionId))
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
    await Promise.allSettled(runtimes.values())
    runtimes.clear()
    ready.clear()
  }

  function requireLive(): void {
    if (disposed) throw new Error("Project collaboration composition is disposed")
  }
}

function normalizeRef(ref: CanvasDocumentRef): CanvasDocumentRef {
  return Object.freeze({ scopeId: parseProjectId(ref.scopeId), canvasId: String(ref.canvasId) })
}

function sameRef(left: CanvasDocumentRef, right: CanvasDocumentRef): boolean {
  return left.scopeId === right.scopeId && left.canvasId === right.canvasId
}
