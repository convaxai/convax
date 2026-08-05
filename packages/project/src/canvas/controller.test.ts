import { describe, expect, mock, test } from "bun:test"
import type { ProjectCanvasCatalog, ProjectCanvasChangeEvent, ProjectCanvasClient, ProjectCanvas } from "./contracts"
import { ProjectCanvasController } from "./controller"

function canvas(id: string, name = id): ProjectCanvas {
  return { createdAt: 1, id, name, updatedAt: 1 }
}

function catalog(projectId: string, canvases = [canvas("canvas-main")]): ProjectCanvasCatalog {
  return { canvases, creationAvailability: "available", projectId }
}

function harness() {
  let current = catalog("one")
  let listener: ((event: ProjectCanvasChangeEvent) => void) | undefined
  const client: ProjectCanvasClient = {
    createCanvas: mock(async (input) => {
      const created = canvas("canvas-created", input.name ?? "Canvas 2")
      current = catalog(input.projectId, [...current.canvases, created])
      return { canvas: created, catalog: current }
    }),
    deleteCanvas: mock(async (input) => {
      const canvases = current.canvases.filter((item) => item.id !== input.canvasId)
      current = catalog(input.projectId, canvases)
      return { deleted: true, catalog: current }
    }),
    getCanvasCatalog: mock(async ({ projectId }) => (projectId === current.projectId ? current : catalog(projectId))),
    onDidChange: (next) => {
      listener = next
      return () => {
        listener = undefined
      }
    },
    renameCanvas: mock(async (input) => {
      const renamed = { ...current.canvases.find((item) => item.id === input.canvasId)!, name: input.name }
      current = catalog(
        input.projectId,
        current.canvases.map((item) => (item.id === input.canvasId ? renamed : item)),
      )
      return { canvas: renamed, catalog: current }
    }),
  }
  return { client, emit: (event: ProjectCanvasChangeEvent) => listener?.(event) }
}

describe("ProjectCanvasController", () => {
  test("owns only Project Canvas catalog CRUD state", async () => {
    const { client } = harness()
    const controller = new ProjectCanvasController(client)
    await controller.setProject("one")
    expect(controller.getSnapshot()).toEqual({
      busy: false,
      canvases: [canvas("canvas-main")],
      creationAvailability: "available",
      error: null,
      projectId: "one",
    })

    const creating = controller.createCanvas("Storyboard")
    expect(controller.getSnapshot().busy).toBe(true)
    expect((await creating)?.id).toBe("canvas-created")
    await controller.renameCanvas("canvas-created", "Final")
    expect(controller.getSnapshot().canvases[1]?.name).toBe("Final")
    await controller.deleteCanvas("canvas-created")
    expect(controller.getSnapshot().canvases).toEqual([canvas("canvas-main")])
    expect(controller.getSnapshot()).not.toHaveProperty("activeCanvasId")
    expect(controller.getSnapshot()).not.toHaveProperty("changingActiveCanvas")
    controller.dispose()
  })

  test("surfaces unavailable local Project authority without inventing a Canvas", async () => {
    const { client } = harness()
    client.getCanvasCatalog = mock(async ({ projectId }): Promise<ProjectCanvasCatalog> => ({
      ...catalog(projectId, []),
      creationAvailability: "local-authority-unavailable",
    }))
    const controller = new ProjectCanvasController(client)

    await controller.setProject("one")
    await controller.createCanvas()

    expect(controller.getSnapshot()).toMatchObject({
      canvases: [],
      creationAvailability: "local-authority-unavailable",
      error: "Canvas creation is waiting for local Project authority.",
      projectId: "one",
    })
    expect(client.createCanvas).not.toHaveBeenCalled()
    controller.dispose()
  })

  test("drops stale Project Canvas catalog responses when the host project changes", async () => {
    let resolveOne: ((value: ProjectCanvasCatalog) => void) | undefined
    const pending = new Promise<ProjectCanvasCatalog>((resolve) => {
      resolveOne = resolve
    })
    const { client } = harness()
    client.getCanvasCatalog = mock(async ({ projectId }) =>
      projectId === "one" ? pending : catalog("two", [canvas("canvas-two")]),
    )
    const controller = new ProjectCanvasController(client)
    const first = controller.setProject("one")
    await controller.setProject("two")
    resolveOne?.(catalog("one", [canvas("canvas-stale")]))
    await first
    expect(controller.getSnapshot()).toMatchObject({ canvases: [canvas("canvas-two")], projectId: "two" })
    controller.dispose()
  })

  test("refreshes through its own change channel", async () => {
    const { client, emit } = harness()
    const controller = new ProjectCanvasController(client)
    await controller.setProject("one")
    emit({ projectId: "one" })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(client.getCanvasCatalog).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  test("defers change-channel refreshes until an in-flight catalog mutation completes", async () => {
    let finishCreate: ((value: Awaited<ReturnType<ProjectCanvasClient["createCanvas"]>>) => void) | undefined
    const pending = new Promise<Awaited<ReturnType<ProjectCanvasClient["createCanvas"]>>>((resolve) => {
      finishCreate = resolve
    })
    const { client, emit } = harness()
    client.createCanvas = mock(async () => pending)
    const controller = new ProjectCanvasController(client)
    await controller.setProject("one")

    const creating = controller.createCanvas()
    emit({ projectId: "one" })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(client.getCanvasCatalog).toHaveBeenCalledTimes(1)

    const created = canvas("canvas-created")
    finishCreate?.({ canvas: created, catalog: catalog("one", [canvas("canvas-main"), created]) })
    await creating
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(client.getCanvasCatalog).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  test("lets a catalog mutation supersede an in-flight background refresh", async () => {
    let finishRefresh: ((value: ProjectCanvasCatalog) => void) | undefined
    const pendingRefresh = new Promise<ProjectCanvasCatalog>((resolve) => {
      finishRefresh = resolve
    })
    const { client, emit } = harness()
    const controller = new ProjectCanvasController(client)
    await controller.setProject("one")
    await controller.createCanvas()
    client.getCanvasCatalog = mock(async () => pendingRefresh)

    emit({ projectId: "one" })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(controller.getSnapshot().busy).toBe(true)

    expect(await controller.deleteCanvas("canvas-created")).toBe(true)
    finishRefresh?.(catalog("one", [canvas("canvas-main"), canvas("canvas-created")]))
    await pendingRefresh
    expect(controller.getSnapshot()).toMatchObject({ busy: false, canvases: [canvas("canvas-main")] })
    controller.dispose()
  })
})
