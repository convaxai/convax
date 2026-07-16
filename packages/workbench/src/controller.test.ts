import { describe, expect, mock, test } from "bun:test"
import { WorkbenchController } from "./controller"

describe("WorkbenchController", () => {
  test("derives the primary surface from the active project and input", async () => {
    const controller = new WorkbenchController()
    expect(controller.getSnapshot().surface).toEqual({ kind: "empty", reason: "no-project" })

    controller.setProject("project-1")
    expect(controller.getSnapshot().surface).toEqual({ kind: "empty", reason: "no-input" })

    const input = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    await controller.open(input)
    expect(controller.getSnapshot().surface).toEqual({ input, kind: "canvas" })
  })

  test("keeps selection scoped to its input and clears it when the input changes", async () => {
    const controller = new WorkbenchController()
    controller.setProject("project-1")
    const canvas = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    await controller.open(canvas)
    controller.setSelection(canvas, { kind: "canvas-nodes", nodeIds: ["node-1"] })
    expect(controller.getSnapshot().selection?.selection).toEqual({ kind: "canvas-nodes", nodeIds: ["node-1"] })

    await controller.open({ kind: "file", path: "notes/brief.md", projectId: "project-1" }, { preview: true })
    expect(controller.getSnapshot().selection).toBeNull()
    expect(controller.getSnapshot().inputMode).toBe("preview")
    expect(controller.getSnapshot().surface.kind).toBe("file")
  })

  test("reveals a selection without forbidding focus and fit-view effects", async () => {
    const controller = new WorkbenchController()
    const requests: unknown[] = []
    controller.setProject("project-1")
    controller.onDidRequestReveal((request) => requests.push(request))
    const input = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    const selection = { kind: "canvas-nodes", nodeIds: ["node-7"] } as const

    await controller.revealSelection(input, selection, { fitView: true, focus: true })

    expect(controller.getSnapshot().activeInput).toEqual(input)
    expect(controller.getSnapshot().selection).toEqual({ input, selection })
    expect(requests).toEqual([{ input, options: { fitView: true, focus: true }, selection }])
  })

  test("waits for the input-change guard before committing the only active input", async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    const beforeInputChange = mock(async (_current, next) => {
      if (next?.kind === "canvas" && next.canvasId === "canvas-2") await pending
    })
    const controller = new WorkbenchController({ beforeInputChange })
    controller.setProject("project-1")
    const first = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    const second = { canvasId: "canvas-2", kind: "canvas", projectId: "project-1" } as const
    await controller.open(first)

    const switching = controller.open(second)

    expect(controller.getSnapshot()).toMatchObject({ activeInput: first, changingInput: true, error: null })
    release?.()
    expect(await switching).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ activeInput: second, changingInput: false, error: null })
    expect(beforeInputChange).toHaveBeenLastCalledWith(first, second)
  })

  test("keeps the current input when a guarded reveal fails", async () => {
    const onInputChangeCanceled = mock(() => undefined)
    const controller = new WorkbenchController({
      beforeInputChange: async (_current, next) => {
        if (next?.kind === "file") throw new Error("Save failed.")
      },
      onInputChangeCanceled,
    })
    const requests: unknown[] = []
    controller.setProject("project-1")
    controller.onDidRequestReveal((request) => requests.push(request))
    const canvas = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    const file = { kind: "file", path: "notes/brief.md", projectId: "project-1" } as const
    await controller.open(canvas)
    controller.setSelection(canvas, { kind: "canvas-nodes", nodeIds: ["node-1"] })

    expect(await controller.revealSelection(file, { kind: "file-range", startLine: 4 })).toBeUndefined()

    expect(controller.getSnapshot()).toMatchObject({ activeInput: canvas, changingInput: false, error: "Save failed." })
    expect(controller.getSnapshot().selection?.input).toEqual(canvas)
    expect(requests).toEqual([])
    expect(onInputChangeCanceled).toHaveBeenCalledTimes(1)
    controller.clearError()
    expect(controller.getSnapshot().error).toBeNull()
  })

  test("guards close before clearing the active input", async () => {
    const beforeInputChange = mock(async () => undefined)
    const controller = new WorkbenchController({ beforeInputChange })
    controller.setProject("project-1")
    const input = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    await controller.open(input)

    expect(await controller.close(input)).toBe(true)

    expect(beforeInputChange).toHaveBeenLastCalledWith(input, null)
    expect(controller.getSnapshot()).toMatchObject({ activeInput: null, changingInput: false })
  })

  test("updates a stable file input after rename without losing its selection", async () => {
    const controller = new WorkbenchController()
    controller.setProject("project-1")
    const before = { kind: "file", path: "draft.md", projectId: "project-1", resourceId: "file-1" } as const
    const after = { kind: "file", path: "final.md", projectId: "project-1", resourceId: "file-1" } as const
    await controller.open(before, { preview: true })
    controller.setSelection(before, { kind: "file-range", startLine: 3 })

    await controller.open(after)

    expect(controller.getSnapshot()).toMatchObject({ activeInput: after, inputMode: "pinned" })
    expect(controller.getSnapshot().selection).toEqual({ input: after, selection: { kind: "file-range", startLine: 3 } })
  })

  test("changes projects atomically and ignores a targeted close for another input", async () => {
    const controller = new WorkbenchController()
    const input = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    controller.setProject("project-1", input)
    controller.setSelection(input, { kind: "canvas-nodes", nodeIds: ["node-1"] })
    expect(await controller.close({ canvasId: "canvas-other", kind: "canvas", projectId: "project-1" })).toBe(false)
    expect(() => controller.setProject("project-2", input)).toThrow()
    expect(controller.getSnapshot().activeInput).toEqual(input)

    controller.setProject(null)
    expect(controller.getSnapshot()).toMatchObject({ activeInput: null, projectId: null, selection: null })
    expect(controller.getSnapshot().surface).toEqual({ kind: "empty", reason: "no-project" })
  })

  test("rejects cross-project inputs and incompatible selections", async () => {
    const controller = new WorkbenchController()
    controller.setProject("project-1")
    await expect(controller.open({ canvasId: "canvas-1", kind: "canvas", projectId: "project-2" })).rejects.toThrow()
    const input = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    await controller.open(input)
    expect(() => controller.setSelection(input, { kind: "file-range", startLine: 1 })).toThrow()
  })
})
