import { describe, expect, mock, test } from "bun:test"
import type {
  CanvasApplicationCommandRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
} from "@convax/canvas/application"
import { encodeBase64urlV2, parseId128V2, parseProjectIdV2, type DigestV2 } from "@convax/collaboration"
import type { ProjectCanvasCatalogProjectionV2, ProjectCanvasRouteCommandResultV2 } from "@convax/project/canvas"

import type { CanvasCollaborationSessionOwnerV2 } from "./canvas-collaboration-session-owner"
import {
  MainProjectCollaborationUnavailableErrorV3,
  createMainProjectCollaborationCompositionFacadeV3,
  type MainSelectedProjectCollaborationPortsV3,
} from "./project-collaboration-composition-v3"

const PROJECT_A = parseProjectIdV2(`project_${"a".repeat(64)}`)
const PROJECT_B = parseProjectIdV2(`project_${"b".repeat(64)}`)
const SESSION_A = parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => 1)))

describe("V3 selected Project collaboration composition facade", () => {
  test("routes catalog and document calls to one persisted selection without replacing results", async () => {
    const runtime = fakeRuntime(PROJECT_A, "v11-r1-local-owner")
    const resolve = mock(async () => ({ status: "ready" as const, ports: runtime.ports }))
    const facade = createMainProjectCollaborationCompositionFacadeV3({ resolve })

    expect(await facade.prepareProject(PROJECT_A)).toBe("v11-r1-local-owner")
    expect(await facade.projectIndexes.queryCatalog({ projectId: PROJECT_A })).toBe(runtime.catalog)
    expect(await facade.projectIndexes.submitRouteCommand({ projectId: PROJECT_A, command: {
      format: "convax.project-canvas-route-command/2", kind: "project.canvas.route.create/2", title: "Canvas",
    } })).toBe(runtime.routeResult)
    expect(await facade.projectIndexes.queryCurrentBlobDigests({ projectId: PROJECT_A })).toEqual(new Set())
    expect(await facade.projectIndexes.queryFileMaterializationPlan({ projectId: PROJECT_A })).toEqual({
      projectId: PROJECT_A,
      entries: [],
    })
    expect(await facade.canvasSessions.query({ scopeId: PROJECT_A, canvasId: "canvas-main" })).toBe(runtime.queryResult)
    expect(await facade.canvasSessions.submit(runtime.commandRequest)).toBe(runtime.commandResult)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(runtime.resume).toHaveBeenCalledWith(PROJECT_A)
    await facade.dispose()
  })

  test("binds renderer sessions to the selected owner and forwards only matching invalidations", async () => {
    const first = fakeRuntime(PROJECT_A, "v11-r1-local-owner")
    const second = fakeRuntime(PROJECT_B, "v10-r5", parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => 2))))
    const facade = createMainProjectCollaborationCompositionFacadeV3({
      async resolve(projectId) { return { status: "ready", ports: projectId === PROJECT_A ? first.ports : second.ports } },
    })
    const events: unknown[] = []
    facade.canvasSessions.subscribe((event) => events.push(event))
    const ref = { scopeId: PROJECT_A, canvasId: "canvas-main" }
    const opened = await facade.canvasSessions.open({ ref, actor: { id: "renderer", kind: "renderer" } })
    await facade.prepareProject(PROJECT_B)
    await facade.canvasSessions.queryRenderer(ref, opened.sessionId)
    expect(first.queryRenderer).toHaveBeenCalledTimes(1)
    expect(second.queryRenderer).not.toHaveBeenCalled()

    first.emit({ format: "convax.canvas-session-invalidation/2", ref, sessionId: SESSION_A })
    second.emit({ format: "convax.canvas-session-invalidation/2", ref: { scopeId: PROJECT_B, canvasId: "other" }, sessionId: opened.sessionId })
    expect(events).toHaveLength(1)
    facade.canvasSessions.close({ ref, sessionId: opened.sessionId })
    expect(first.close).toHaveBeenCalledTimes(1)
    await facade.dispose()
  })

  test("quiesces both port families, drops session bindings and never falls back on unavailable state", async () => {
    const runtime = fakeRuntime(PROJECT_A, "v11-r1-local-owner")
    const facade = createMainProjectCollaborationCompositionFacadeV3({
      async resolve(projectId) {
        return projectId === PROJECT_A
          ? { status: "ready", ports: runtime.ports }
          : { status: "unavailable", reason: "owner-key-missing" }
      },
    })
    const ref = { scopeId: PROJECT_A, canvasId: "canvas-main" }
    const opened = await facade.canvasSessions.open({ ref, actor: { id: "renderer", kind: "renderer" } })
    await facade.quiesceProject(PROJECT_A)
    expect(runtime.quiesceSessions).toHaveBeenCalledWith(PROJECT_A)
    expect(runtime.quiesceRuntime).toHaveBeenCalledTimes(1)
    expect(() => facade.canvasSessions.close({ ref, sessionId: opened.sessionId })).toThrow("stale")
    expect(await facade.prepareProject(PROJECT_A)).toBe("v11-r1-local-owner")
    await expect(facade.prepareProject(PROJECT_B)).rejects.toBeInstanceOf(MainProjectCollaborationUnavailableErrorV3)
    await facade.dispose()
  })

  test("rejects a resolver that crosses the requested Project binding", async () => {
    const runtime = fakeRuntime(PROJECT_B, "v11-r1-local-owner")
    const facade = createMainProjectCollaborationCompositionFacadeV3({
      async resolve() { return { status: "ready", ports: runtime.ports } },
    })
    await expect(facade.prepareProject(PROJECT_A)).rejects.toThrow("crossed its Project")
    await facade.dispose()
  })
})

function fakeRuntime(
  projectId: typeof PROJECT_A | typeof PROJECT_B,
  protocol: MainSelectedProjectCollaborationPortsV3["protocol"],
  sessionId = SESSION_A,
) {
  const catalog = Object.freeze({ marker: "catalog" }) as unknown as ProjectCanvasCatalogProjectionV2
  const routeResult = Object.freeze({ marker: "route" }) as unknown as ProjectCanvasRouteCommandResultV2
  const queryResult = Object.freeze({ marker: "query" }) as unknown as CanvasApplicationQueryResult
  const commandResult = Object.freeze({ marker: "command" }) as unknown as CanvasApplicationCommandResult
  const commandRequest = Object.freeze({ scopeId: projectId, canvasId: "canvas-main" }) as unknown as CanvasApplicationCommandRequest
  const listeners = new Set<(event: Parameters<Parameters<CanvasCollaborationSessionOwnerV2["subscribe"]>[0]>[0]) => void>()
  const resume = mock(() => undefined)
  const close = mock(() => undefined)
  const queryRenderer = mock(async () => Object.freeze({ sessionId }) as never)
  const quiesceSessions = mock(async () => undefined)
  const quiesceRuntime = mock(async () => undefined)
  const owner: CanvasCollaborationSessionOwnerV2 = {
    open: mock(async () => Object.freeze({ sessionId }) as never),
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
  const ports: MainSelectedProjectCollaborationPortsV3 = Object.freeze({
    projectId,
    protocol,
    projectIndexes: Object.freeze({
      queryCatalog: mock(async () => catalog),
      submitRouteCommand: mock(async () => routeResult),
      queryCurrentBlobDigests: mock(async () => new Set<DigestV2>()),
      createDirectory: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
      publishFile: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
      relocateEntry: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
      tombstoneEntry: mock(async () => Object.freeze({ status: "partial-success", code: "entry-not-found" }) as never),
      queryFileMaterializationPlan: mock(async () => Object.freeze({ projectId, entries: Object.freeze([]) })),
    }),
    canvasSessions: owner,
    quiesce: quiesceRuntime,
  })
  return {
    ports,
    catalog,
    routeResult,
    queryResult,
    commandResult,
    commandRequest,
    resume,
    close,
    queryRenderer,
    quiesceSessions,
    quiesceRuntime,
    emit(event: Parameters<Parameters<CanvasCollaborationSessionOwnerV2["subscribe"]>[0]>[0]) {
      for (const listener of listeners) listener(event)
    },
  }
}
