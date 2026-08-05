import { describe, expect, mock, test } from "bun:test"
import {
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  type DocumentScopeV2,
} from "@convax/collaboration"
import type { ProjectCanvasCatalogProjectionV2 } from "@convax/project/canvas"

import type { MainCollaborationDocumentSessionV2 } from "./collaboration-document-session"
import {
  MainProjectCanvasRouteRuntimeRegistryV2,
  ProjectCanvasRouteRuntimeErrorV2,
  type CanvasRouteRuntimeHandleV2,
} from "./project-canvas-route-runtime-registry"

const projectId = parseProjectIdV2("project-a")
const otherProjectId = parseProjectIdV2("project-b")
const canvasId = parseCanvasIdV2(`cv_${"1".repeat(64)}`)
const projectEpoch = id(1)
const shardEpoch = id(2)

describe("MainProjectCanvasRouteRuntimeRegistryV2", () => {
  test("concurrent lazy opens attach one exact live-route runtime", async () => {
    const fixture = createFixture()
    await fixture.registry.switchProject(projectId)

    const [left, right] = await Promise.all([
      fixture.registry.openDocumentSession({ scopeId: projectId, canvasId }),
      fixture.registry.openDocumentSession({ scopeId: projectId, canvasId }),
    ])

    expect(fixture.acquire).toHaveBeenCalledTimes(1)
    expect(fixture.open).toHaveBeenCalledTimes(1)
    expect(left.scope).toEqual({ projectId, projectEpoch, docKind: "canvas", docId: canvasId, shardEpoch })
    expect(await right.query(() => "ok")).toBe("ok")

    left.dispose()
    expect(fixture.runtimeDisposals()).toBe(0)
    right.dispose()
    await fixture.registry.switchProject(null)
    expect(fixture.runtimeDisposals()).toBe(1)
    expect(fixture.projectReleases()).toBe(1)
  })

  test("reset incarnation revokes old session and stale dispose cannot close the replacement", async () => {
    const fixture = createFixture()
    await fixture.registry.switchProject(projectId)
    const oldSession = await fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })

    fixture.catalog = liveCatalog({ projectEpoch: id(3), shardEpoch: id(4), activation: digest("c"), route: digest("d") })
    await fixture.registry.reconcileProject(projectId)
    expect(() => oldSession.query(() => "stale")).toThrow(ProjectCanvasRouteRuntimeErrorV2)

    const current = await fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })
    expect(current.scope.projectEpoch).toBe(id(3))
    expect(current.scope.shardEpoch).toBe(id(4))
    oldSession.dispose()
    expect(await current.query(() => "current")).toBe("current")
    expect(fixture.runtimeDisposals()).toBe(1)

    current.dispose()
    await fixture.registry.switchProject(null)
    expect(fixture.runtimeDisposals()).toBe(2)
  })

  test("tombstone and Project switch are immediate revocation barriers", async () => {
    const fixture = createFixture()
    await fixture.registry.switchProject(projectId)
    const tombstoned = await fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })
    fixture.catalog = tombstoneCatalog()
    await fixture.registry.reconcileProject(projectId)
    expect(() => tombstoned.flush()).toThrow("revoked")
    await expect(fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })).rejects.toMatchObject({ code: "route-not-live" })

    fixture.catalog = liveCatalog()
    const switched = await fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })
    await fixture.registry.switchProject(otherProjectId)
    expect(() => switched.flush()).toThrow("revoked")
    await expect(fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })).rejects.toMatchObject({ code: "inactive-project" })
  })

  test("route changing during lazy open never publishes the stale runtime", async () => {
    let unblock!: () => void
    const blocked = new Promise<void>((resolve) => { unblock = resolve })
    const fixture = createFixture({ beforeOpen: () => blocked })
    await fixture.registry.switchProject(projectId)
    const opening = fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })
    await Promise.resolve()
    fixture.catalog = liveCatalog({ shardEpoch: id(9), activation: digest("9"), route: digest("8") })
    unblock()

    await expect(opening).rejects.toMatchObject({ code: "route-changed" })
    expect(fixture.runtimeDisposals()).toBe(1)
    expect(fixture.projectReleases()).toBe(1)
    const current = await fixture.registry.openDocumentSession({ scopeId: projectId, canvasId })
    expect(current.scope.shardEpoch).toBe(id(9))
  })
})

function createFixture(options: { beforeOpen?: () => Promise<void> } = {}) {
  let runtimeDisposals = 0
  let projectReleases = 0
  const acquire = mock(async (requestedProjectId: string) => ({
    projectId: requestedProjectId,
    projectRoot: "/project",
    collaborationDirectory: "/project/.convax/collaboration",
    persistence: {} as never,
    release() { projectReleases += 1 },
  }))
  const open = mock(async ({ scope }: { scope: DocumentScopeV2 & { docKind: "canvas" } }): Promise<CanvasRouteRuntimeHandleV2> => {
    await options.beforeOpen?.()
    const session = fakeSession(scope)
    return Object.freeze({ protocol: "v2" as const, session, dispose() { runtimeDisposals += 1; session.dispose() } })
  })
  const fixture = {
    catalog: liveCatalog(), acquire, open,
    runtimeDisposals: () => runtimeDisposals,
    projectReleases: () => projectReleases,
    registry: undefined as unknown as MainProjectCanvasRouteRuntimeRegistryV2,
  }
  fixture.registry = new MainProjectCanvasRouteRuntimeRegistryV2({
    catalogs: { async queryCatalog() { return fixture.catalog } },
    projects: { acquire: acquire as never },
    runtime: { open: open as never },
  })
  return fixture
}

function fakeSession(scope: DocumentScopeV2 & { readonly docKind: "canvas" }): MainCollaborationDocumentSessionV2<"canvas"> {
  let live = true
  return {
    scope,
    async query(project) { if (!live) throw new Error("disposed"); return project({} as never) },
    async submit() { throw new Error("unused") },
    async flush() { if (!live) throw new Error("disposed") },
    subscribe() { return () => undefined },
    dispose() { live = false },
  }
}

function liveCatalog(input: {
  projectEpoch?: ReturnType<typeof id>
  shardEpoch?: ReturnType<typeof id>
  activation?: ReturnType<typeof digest>
  route?: ReturnType<typeof digest>
} = {}): ProjectCanvasCatalogProjectionV2 {
  const route = {
    canvasId,
    state: "live" as const,
    title: "Canvas",
    shardEpoch: input.shardEpoch ?? shardEpoch,
    activationDigest: input.activation ?? digest("a"),
    routeProjectionDigest: input.route ?? digest("b"),
  }
  return {
    format: "convax.project-canvas-catalog-projection/2",
    creationAvailability: "available",
    projectId,
    projectEpoch: input.projectEpoch ?? projectEpoch,
    routes: [route],
    visibleCanvases: [route],
  }
}

function tombstoneCatalog(): ProjectCanvasCatalogProjectionV2 {
  return {
    format: "convax.project-canvas-catalog-projection/2",
    creationAvailability: "available",
    projectId,
    projectEpoch,
    routes: [{
      canvasId,
      state: "tombstoned",
      title: null,
      shardEpoch: null,
      activationDigest: null,
      routeProjectionDigest: digest("f"),
    }],
    visibleCanvases: [],
  }
}

function id(byte: number) {
  return parseId128V2(Buffer.alloc(16, byte).toString("base64url"))
}

function digest(character: string) {
  return parseDigestV2(character.repeat(64))
}
