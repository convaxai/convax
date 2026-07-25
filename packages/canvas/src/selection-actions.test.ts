import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode, createTextNode } from "./document"
import {
  CanvasSelectionActionExecutor,
  createCanvasSelectionActionContext,
  getVisibleCanvasSelectionActions,
  type CanvasSelectionAction,
} from "./selection-actions"

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe("Canvas selection actions", () => {
  test("leaves media-only eligibility to a host predicate and isolates faulty predicates", () => {
    const image = createMediaNode({
      id: "image",
      position: { x: 0, y: 0 },
      resource: { id: "image", kind: "image", metadata: {}, state: { status: "ready", url: "asset://image" } },
    })
    const video = createMediaNode({
      id: "video",
      position: { x: 20, y: 20 },
      resource: { id: "video", kind: "video", metadata: {}, state: { status: "ready", url: "asset://video" } },
    })
    const text = createTextNode({ id: "text", metadata: {}, position: { x: 40, y: 40 }, resourceState: { status: "ready" } })
    const document = createCanvasDocument({ nodes: [image, video, text] })
    const controller = new AbortController()
    const mediaOnly: CanvasSelectionAction = {
      execute: () => undefined,
      id: "media-only",
      label: "Export media",
      visible: ({ selectedNodeIds, selectedNodes }) =>
        selectedNodes.length === selectedNodeIds.length &&
        selectedNodes.every((node) => node.data.kind === "image" || node.data.kind === "video"),
    }
    const faulty: CanvasSelectionAction = {
      execute: () => undefined,
      id: "faulty",
      label: "Faulty",
      visible: () => {
        throw new Error("host predicate failed")
      },
    }

    const mediaContext = createCanvasSelectionActionContext(
      document,
      [video.id, image.id],
      ["edge-a"],
      controller.signal,
    )
    const mixedContext = createCanvasSelectionActionContext(document, [image.id, text.id], [], controller.signal)

    expect(mediaContext.selectedNodes.map((node) => node.id)).toEqual([video.id, image.id])
    expect(mediaContext.selectedEdgeIds).toEqual(["edge-a"])
    expect(getVisibleCanvasSelectionActions([mediaOnly, faulty], mediaContext).map((action) => action.id)).toEqual([
      mediaOnly.id,
    ])
    expect(getVisibleCanvasSelectionActions([mediaOnly, faulty], mixedContext)).toEqual([])
  })

  test("marks an action pending synchronously and ignores a duplicate execution", async () => {
    const pendingChanges: boolean[] = []
    const gate = deferred()
    const action: CanvasSelectionAction = {
      execute: () => gate.promise,
      id: "export",
      label: "Export",
    }
    const executor = new CanvasSelectionActionExecutor({
      onPendingChange: () => pendingChanges.push(executor.isPending(action.id)),
    })
    const context = createCanvasSelectionActionContext(createCanvasDocument(), [], [], new AbortController().signal)

    const first = executor.execute(action, context)
    expect(executor.isPending(action.id)).toBeTrue()
    expect(await executor.execute(action, context)).toBe("ignored")
    gate.resolve()

    expect(await first).toBe("completed")
    expect(executor.isPending(action.id)).toBeFalse()
    expect(pendingChanges).toEqual([true, false])
  })

  test("does not expose pending work from a replaced selection snapshot", async () => {
    const pendingChanges: boolean[] = []
    const gate = deferred()
    const action: CanvasSelectionAction = {
      execute: () => gate.promise,
      id: "export",
      label: "Export",
    }
    const executor = new CanvasSelectionActionExecutor({
      onPendingChange: () => pendingChanges.push(executor.isPending(action.id)),
    })
    const document = createCanvasDocument()
    const firstController = new AbortController()
    const first = createCanvasSelectionActionContext(document, [], [], firstController.signal)
    const replacement = createCanvasSelectionActionContext(document, [], [], new AbortController().signal)

    const execution = executor.execute(action, first)
    expect(executor.isPending(action.id)).toBeTrue()
    expect(executor.isPending(action.id, first.signal)).toBeTrue()
    expect(executor.isPending(action.id, replacement.signal)).toBeFalse()

    firstController.abort()
    executor.reset({ notify: false })
    gate.resolve()

    expect(await execution).toBe("aborted")
    expect(executor.isPending(action.id)).toBeFalse()
    expect(pendingChanges).toEqual([true])
  })

  test("reports execution failures but treats an aborted context as cancellation", async () => {
    const errors: unknown[] = []
    const executor = new CanvasSelectionActionExecutor({ onError: (_action, error) => errors.push(error) })
    const failed = createCanvasSelectionActionContext(createCanvasDocument(), [], [], new AbortController().signal)
    const failure = new Error("export failed")

    expect(
      await executor.execute(
        {
          execute: () => {
            throw failure
          },
          id: "failure",
          label: "Failure",
        },
        failed,
      ),
    ).toBe("failed")
    expect(errors).toEqual([failure])

    const gate = deferred()
    const controller = new AbortController()
    const canceled = createCanvasSelectionActionContext(createCanvasDocument(), [], [], controller.signal)
    const execution = executor.execute({ execute: () => gate.promise, id: "cancel", label: "Cancel" }, canceled)
    controller.abort()
    gate.resolve()

    expect(await execution).toBe("aborted")
    expect(errors).toEqual([failure])
  })
})
