import { describe, expect, mock, test } from "bun:test"
import type { CanvasId, Digest, Id128, ProjectId } from "@convax/collaboration"
import {
  NodeProjectCanvasManager,
  ProjectCanvasRouteCommandRejectedErrorV2,
  type ProjectCanvasCatalogProjection,
  type ProjectIndexCanvasApplicationPort,
} from "./project-canvas-manager"

const projectId = "project-a" as ProjectId
const liveId = `cv_${"a".repeat(64)}` as CanvasId
const deletedId = `cv_${"b".repeat(64)}` as CanvasId
const digest = "c".repeat(64) as Digest
const epoch = Buffer.alloc(16, 1).toString("base64url") as Id128

describe("NodeProjectCanvasManager", () => {
  test("retains tombstones in the authoritative catalog while exposing only live routes", async () => {
    const catalog = projection()
    const queryCatalog = mock(async () => catalog)
    const manager = new NodeProjectCanvasManager({
      queryCatalog,
      submitRouteCommand: mock(),
    } as ProjectIndexCanvasApplicationPort)

    const result = await manager.getCanvasCatalog({ projectId })

    expect(result.routes.map((route) => [route.canvasId, route.state])).toEqual([
      [liveId, "live"],
      [deletedId, "tombstoned"],
    ])
    expect(result.visibleCanvases.map((route) => route.canvasId)).toEqual([liveId])
    expect(queryCatalog).toHaveBeenCalledWith({ projectId })
  })

  test("surfaces tombstone rejection without inventing a local catalog mutation", async () => {
    const queryCatalog = mock(async () => projection())
    let submittedKind = ""
    const submitRouteCommand: ProjectIndexCanvasApplicationPort["submitRouteCommand"] = mock(async (input) => {
      submittedKind = input.command.kind
      return { status: "rejected", code: "route-tombstoned" } as const
    })
    const manager = new NodeProjectCanvasManager({ queryCatalog, submitRouteCommand })

    await expect(manager.renameCanvas({ projectId, canvasId: deletedId, name: "Revive" })).rejects.toBeInstanceOf(
      ProjectCanvasRouteCommandRejectedErrorV2,
    )
    expect(queryCatalog).not.toHaveBeenCalled()
    expect(submittedKind).toBe("project.canvas.route.rename")
  })

  test("rejects a projection that duplicates a route", async () => {
    const bad = projection()
    const manager = new NodeProjectCanvasManager({
      queryCatalog: async () => ({ ...bad, routes: [...bad.routes, bad.routes[0]!] }),
      submitRouteCommand: mock(),
    })
    await expect(manager.getCanvasCatalog({ projectId })).rejects.toThrow("duplicate route")
  })
})

function projection(): ProjectCanvasCatalogProjection {
  const live = {
    canvasId: liveId,
    state: "live" as const,
    title: "Main",
    shardEpoch: epoch,
    activationDigest: digest,
    routeProjectionDigest: digest,
  }
  const tombstone = {
    canvasId: deletedId,
    state: "tombstoned" as const,
    title: null,
    shardEpoch: null,
    activationDigest: null,
    routeProjectionDigest: digest,
  }
  return {
    format: "convax.project-canvas-catalog-projection",
    creationAvailability: "available",
    projectId,
    projectEpoch: epoch,
    routes: [live, tombstone],
    visibleCanvases: [live],
  }
}
