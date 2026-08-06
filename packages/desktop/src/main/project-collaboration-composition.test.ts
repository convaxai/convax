import { describe, expect, mock, test } from "bun:test"
import type {
  CanvasApplicationCommandRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
} from "@convax/canvas/application"
import { encodeBase64url, parseId128, parseProjectId, type Digest } from "@convax/collaboration"
import type { ProjectCanvasCatalogProjection, ProjectCanvasRouteCommandResult } from "@convax/project/canvas"

import type { CanvasCollaborationSessionOwner } from "./canvas-collaboration-session-owner"
import { createMainProjectCollaborationComposition } from "./project-collaboration-composition"

const PROJECT_A = parseProjectId(`project_${"a".repeat(64)}`)
const PROJECT_B = parseProjectId(`project_${"b".repeat(64)}`)
const SESSION_A = parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => 1)))

describe("Project collaboration composition", () => {
  test("routes catalog and document calls to the one current runtime without replacing results", async () => {
    const harness = composition()

    await harness.composition.prepareProject(PROJECT_A)
    expect(await harness.composition.projectIndexes.queryCatalog({ projectId: PROJECT_A })).toBe(harness.catalog)
    expect(await harness.composition.projectIndexes.submitRouteCommand({ projectId: PROJECT_A, command: {
      format: "convax.project-canvas-route-command", kind: "project.canvas.route.create", title: "Canvas",
    } })).toBe(harness.routeResult)
    expect(await harness.composition.projectIndexes.queryCurrentBlobDigests({ projectId: PROJECT_A })).toEqual(new Set())
    expect(await harness.composition.projectIndexes.queryFileMaterializationPlan({ projectId: PROJECT_A })).toEqual({
      projectId: PROJECT_A,
      entries: [],
    })
    expect(await harness.composition.canvasSessions.query({ scopeId: PROJECT_A, canvasId: "canvas-main" }))
      .toBe(harness.queryResult)
    expect(await harness.composition.canvasSessions.submit(harness.commandRequest)).toBe(harness.commandResult)
    expect(harness.canvasRoutes.switchProject).toHaveBeenCalledWith(PROJECT_A)
    expect(harness.canvasRoutes.switchProject).toHaveBeenCalledTimes(1)
    expect(harness.resume).toHaveBeenCalledWith(PROJECT_A)
    expect(harness.events).toEqual(["route:switch", "canvas:resume"])
    await harness.composition.dispose()
  })

  test("selects the Project route once per Project and never negotiates a protocol", async () => {
    const harness = composition()

    await harness.composition.prepareProject(PROJECT_A)
    await harness.composition.prepareProject(PROJECT_B)
    await harness.composition.prepareProject(PROJECT_A)

    expect(harness.canvasRoutes.switchProject.mock.calls).toEqual([[PROJECT_A], [PROJECT_B]])
    await harness.composition.dispose()
  })

  test("binds renderer sessions to the runtime owner and forwards only matching invalidations", async () => {
    const harness = composition()
    const events: unknown[] = []
    harness.composition.canvasSessions.subscribe((event) => events.push(event))
    const ref = { scopeId: PROJECT_A, canvasId: "canvas-main" }
    const opened = await harness.composition.canvasSessions.open({ ref, actor: { id: "renderer", kind: "renderer" } })

    await harness.composition.canvasSessions.queryRenderer(ref, opened.sessionId)
    expect(harness.queryRenderer).toHaveBeenCalledTimes(1)

    harness.emit({ format: "convax.canvas-session-invalidation", ref, sessionId: opened.sessionId })
    harness.emit({
      format: "convax.canvas-session-invalidation",
      ref: { scopeId: PROJECT_B, canvasId: "other" },
      sessionId: opened.sessionId,
    })
    expect(events).toHaveLength(1)

    harness.composition.canvasSessions.close({ ref, sessionId: opened.sessionId })
    expect(harness.close).toHaveBeenCalledTimes(1)
    await harness.composition.dispose()
  })

  test("quiesces both port families in order and drops session bindings", async () => {
    const harness = composition()
    const ref = { scopeId: PROJECT_A, canvasId: "canvas-main" }
    const opened = await harness.composition.canvasSessions.open({ ref, actor: { id: "renderer", kind: "renderer" } })

    await harness.composition.quiesceProject(PROJECT_A)

    expect(harness.quiesceSessions).toHaveBeenCalledWith(PROJECT_A)
    expect(harness.quiesceSessions).toHaveBeenCalledTimes(1)
    expect(harness.canvasRoutes.quiesceProject).toHaveBeenCalledTimes(1)
    expect(harness.projectIndexes.quiesceProject).toHaveBeenCalledTimes(1)
    expect(harness.events.slice(-3)).toEqual(["canvas:quiesce", "route:quiesce", "index:quiesce"])
    expect(() => harness.composition.canvasSessions.close({ ref, sessionId: opened.sessionId })).toThrow("stale")

    await harness.composition.prepareProject(PROJECT_A)
    expect(harness.canvasRoutes.switchProject).toHaveBeenCalledTimes(2)
    await harness.composition.dispose()
  })

  test("rejects renderer access after disposal instead of reopening a runtime", async () => {
    const harness = composition()

    await harness.composition.prepareProject(PROJECT_A)
    await harness.composition.dispose()

    await expect(harness.composition.prepareProject(PROJECT_A)).rejects.toThrow("disposed")
    expect(harness.canvasRoutes.switchProject).toHaveBeenCalledTimes(1)
  })
})

function composition() {
  const events: string[] = []
  const catalog = Object.freeze({ marker: "catalog" }) as unknown as ProjectCanvasCatalogProjection
  const routeResult = Object.freeze({ marker: "route" }) as unknown as ProjectCanvasRouteCommandResult
  const queryResult = Object.freeze({ marker: "query" }) as unknown as CanvasApplicationQueryResult
  const commandResult = Object.freeze({ marker: "command" }) as unknown as CanvasApplicationCommandResult
  const commandRequest = Object.freeze({
    scopeId: PROJECT_A,
    canvasId: "canvas-main",
  }) as unknown as CanvasApplicationCommandRequest
  const listeners = new Set<(event: Parameters<Parameters<CanvasCollaborationSessionOwner["subscribe"]>[0]>[0]) => void>()
  const resume = mock(() => {
    events.push("canvas:resume")
  })
  const close = mock(() => undefined)
  const queryRenderer = mock(async () => Object.freeze({ sessionId: SESSION_A }) as never)
  const quiesceSessions = mock(async () => {
    events.push("canvas:quiesce")
  })
  const projectIndexes = Object.freeze({
    queryCatalog: mock(async () => catalog),
    submitRouteCommand: mock(async () => routeResult),
    queryCurrentBlobDigests: mock(async () => new Set<Digest>()),
    queryCurrentResources: mock(async () => []),
    admitManagedBlob: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
    createDirectory: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
    publishFile: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
    relocateEntry: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
    tombstoneEntry: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
    queryFileMaterializationPlan: mock(async ({ projectId }: { projectId: string }) =>
      Object.freeze({ projectId, entries: Object.freeze([]) })),
    quiesceProject: mock(async () => {
      events.push("index:quiesce")
    }),
  })
  const canvasSessions: CanvasCollaborationSessionOwner = {
    open: mock(async () => Object.freeze({ sessionId: SESSION_A }) as never),
    close,
    queryRenderer,
    submitRenderer: mock(async () => Object.freeze({ marker: "renderer-submit" }) as never),
    queryAuthoritative: mock(async () => Object.freeze({ marker: "authoritative-query" }) as never),
    submitAuthoritative: mock(async () => Object.freeze({ marker: "authoritative-submit" }) as never),
    undo: mock(async () => null),
    redo: mock(async () => null),
    flush: mock(async () => undefined),
    quiesceProject: quiesceSessions,
    resumeProject: resume,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    query: mock(async () => queryResult),
    submit: mock(async () => commandResult),
    dispose: mock(() => undefined),
  }
  const canvasRoutes = Object.freeze({
    switchProject: mock(async (_projectId: string) => {
      events.push("route:switch")
    }),
    quiesceProject: mock(async (_projectId: string) => {
      events.push("route:quiesce")
    }),
  })
  return {
    canvasRoutes,
    catalog,
    close,
    commandRequest,
    commandResult,
    composition: createMainProjectCollaborationComposition({
      projectIndexes: projectIndexes as never,
      canvasSessions,
      canvasRoutes,
    }),
    events,
    projectIndexes,
    queryRenderer,
    queryResult,
    quiesceSessions,
    resume,
    routeResult,
    emit(event: Parameters<Parameters<CanvasCollaborationSessionOwner["subscribe"]>[0]>[0]) {
      for (const listener of listeners) listener(event)
    },
  }
}
