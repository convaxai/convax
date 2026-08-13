import { createCanvasDocument, createCanvasSelectionActionContext, createMediaNode } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MediaOperationDialog } from "./media-operation-dialog"
import type { MediaOperationDialogRequest } from "./media-operation-selection-action"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    MouseEvent: testWindow.MouseEvent,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

function request(): MediaOperationDialogRequest {
  const source = createMediaNode({
    id: "source-video",
    position: { x: 0, y: 0 },
    resource: {
      id: "source-resource",
      kind: "video",
      metadata: {
        [projectResourceReferenceKey]: {
          kind: "project-file",
          path: "Media/source.mp4",
        },
      },
      mimeType: "video/mp4",
      name: "source.mp4",
      state: { status: "ready", url: "convax-project://Media/source.mp4" },
    },
  })
  const document = createCanvasDocument({ id: "canvas", nodes: [source], title: "Canvas" })
  return {
    action: {
      delivery: "canvas",
      description: { default: "Create independent video and audio results." },
      editor: "confirmation",
      id: "separate",
      pluginId: "media-tools",
      steps: [
        { output: "video", toolId: "media-tools/video.silent" },
        { output: "audio", toolId: "media-tools/audio.extract" },
      ],
      target: "video",
      title: { default: "Separate audio and video" },
    },
    canvasId: document.id,
    context: createCanvasSelectionActionContext(document, [source.id], [], new AbortController().signal),
    projectId: "project",
  }
}

test("ends button loading and closes after admission without waiting for terminal media work", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  try {
    let resolveAdmission!: () => void
    const admission = new Promise<void>((resolve) => {
      resolveAdmission = resolve
    })
    const onConfirm = mock(async () => admission)
    const onClose = mock(() => undefined)
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<MediaOperationDialog locale="en" onClose={onClose} onConfirm={onConfirm} request={request()} />)
    })
    const form = container.querySelector("form")
    if (!form) throw new Error("Expected media operation form")

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Processing…")
    expect(onClose).toHaveBeenCalledTimes(0)

    await act(async () => {
      resolveAdmission()
      await admission
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root?.unmount())
    await restoreWindow()
  }
})
