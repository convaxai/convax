import { afterAll, expect, mock, test } from "bun:test"
import { Window as HappyDOMWindow } from "happy-dom"
import { StrictMode, type ReactNode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { CanvasDocument, CanvasNode } from "../types"

const testWindow = new HappyDOMWindow({ url: "https://convax.test/" })
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
const globals = {
  DOMRect: testWindow.DOMRect,
  Element: testWindow.Element,
  Event: testWindow.Event,
  HTMLElement: testWindow.HTMLElement,
  MouseEvent: testWindow.MouseEvent,
  Node: testWindow.Node,
  PointerEvent: testWindow.PointerEvent,
  ResizeObserver: testWindow.ResizeObserver,
  SVGElement: testWindow.SVGElement,
  document: testWindow.document,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
  navigator: testWindow.navigator,
  window: testWindow,
}

for (const [name, value] of Object.entries(globals)) {
  originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
}
originalDescriptors.set(
  "IS_REACT_ACT_ENVIRONMENT",
  Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
)
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true })

const animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrame = 0
Object.defineProperty(testWindow, "requestAnimationFrame", {
  configurable: true,
  value(callback: FrameRequestCallback) {
    const id = ++nextAnimationFrame
    animationFrames.set(id, callback)
    return id
  },
})
Object.defineProperty(testWindow, "cancelAnimationFrame", {
  configurable: true,
  value(id: number) {
    animationFrames.delete(id)
  },
})
for (const name of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: testWindow[name].bind(testWindow),
    writable: true,
  })
}

function Passthrough(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

mock.module("@convax/ui", () => ({
  Button: (props: {
    children?: ReactNode
    className?: string
    disabled?: boolean
    onClick?: React.MouseEventHandler<HTMLButtonElement>
    onPointerDown?: React.PointerEventHandler<HTMLButtonElement>
    type?: "button" | "submit" | "reset"
  }) => (
    <button
      className={props.className}
      disabled={props.disabled}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      type={props.type}
    >
      {props.children}
    </button>
  ),
  ContextMenu: Passthrough,
  ContextMenuContent: Passthrough,
  ContextMenuItem: Passthrough,
  ContextMenuLabel: Passthrough,
  ContextMenuSeparator: () => null,
  ContextMenuTrigger: Passthrough,
  Input: () => <input />,
  Select: Passthrough,
  SelectContent: Passthrough,
  SelectItem: Passthrough,
  SelectTrigger: Passthrough,
  SelectValue: Passthrough,
  Shortcut: Passthrough,
  ToolInputForm: () => null,
  Tooltip: Passthrough,
  TooltipProvider: Passthrough,
  cn: (...values: unknown[]) => values.filter((value) => typeof value === "string").join(" "),
  createToolInputDefaultValues: () => ({}),
  validateToolInputValues: () => ({ input: {}, invalidFieldIds: [], missingRequiredFieldIds: [], valid: true }),
}))

const { createCanvasDocument, createTextNode } = await import("../document")
const { createCanvasFileRendererRegistry } = await import("../file-renderer-registry")
const {
  finishCanvasNodeGenerationRun,
  markCanvasNodeGenerationRunRunning,
  startCanvasNodeGenerationRun,
} = await import("../generation-run")
const { useCanvasEditor } = await import("../editor-context")
const { createCanvasNodeRegistry } = await import("../node-registry")
const { createCanvasServices } = await import("../services")
const { CanvasEditor } = await import("./canvas-editor")
const { useStoreApi } = await import("@xyflow/react")

afterAll(async () => {
  await testWindow.happyDOM.close()
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function rect(left: number, top: number, width: number, height: number) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  } as DOMRect
}

let observedSelection = { edgeIds: [] as string[], nodeIds: [] as string[] }
let emitConnectedEdgeSelection: (() => void) | undefined

function SelectionProbeNode() {
  const editor = useCanvasEditor()
  const store = useStoreApi()
  observedSelection = {
    edgeIds: [...editor.selection.edgeIds],
    nodeIds: [...editor.selection.nodeIds],
  }
  emitConnectedEdgeSelection = () =>
    store.getState().triggerEdgeChanges([{ id: "connected", selected: true, type: "select" }])
  return <div />
}

test("box-selects connected nodes without feeding controlled selection back into React Flow", async () => {
  // Test files are isolated at module scope, but another DOM suite can restore
  // process globals after this file was loaded and before this test executes.
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  for (const name of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: testWindow[name].bind(testWindow),
      writable: true,
    })
  }
  const errors: Error[] = []
  observedSelection = { edgeIds: [], nodeIds: [] }
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList.contains("react-flow__node")) {
      const id = this.getAttribute("data-id")
      return id === "first" ? rect(80, 80, 120, 80) : rect(360, 80, 120, 80)
    }
    return rect(0, 0, 1000, 800)
  }
  let root: Root | undefined
  let focusProbe: HTMLInputElement | undefined

  try {
    const first = {
      ...createTextNode({
        id: "first",
        metadata: {},
        position: { x: 80, y: 80 },
        resourceState: { status: "ready" },
      }),
      measured: { height: 80, width: 120 },
    }
    const second = {
      ...createTextNode({
        id: "second",
        metadata: {},
        position: { x: 360, y: 80 },
        resourceState: { status: "ready" },
      }),
      measured: { height: 80, width: 120 },
    }
    const initialDocument = createCanvasDocument({
      edges: [{ id: "connected", source: first.id, target: second.id }],
      id: "box-selection",
      nodes: [first, second],
    })
    const nodeRegistry = createCanvasNodeRegistry([
      {
        component: SelectionProbeNode,
        create: ({ position }) => createTextNode({ metadata: {}, position, resourceState: { status: "ready" } }),
        label: "File",
        type: "file",
      },
    ])
    const container = document.createElement("div")
    container.className = "nodrag"
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })

    await act(async () => {
      root?.render(
        <StrictMode>
          <CanvasEditor
            fileRendererRegistry={createCanvasFileRendererRegistry()}
            initialDocument={initialDocument}
            nodeRegistry={nodeRegistry}
            onlyRenderVisibleElements={false}
            services={createCanvasServices()}
          />
        </StrictMode>,
      )
    })

    expect(errors).toEqual([])
    const canvasRoot = container.querySelector<HTMLElement>(".convax-canvas")
    const pane = container.querySelector<HTMLElement>(".react-flow__pane")
    const firstNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="first"]')
    expect(canvasRoot).not.toBeNull()
    expect(pane).not.toBeNull()
    expect(firstNode).not.toBeNull()
    expect(emitConnectedEdgeSelection).toBeFunction()

    focusProbe = document.createElement("input")
    document.body.append(focusProbe)
    const pointerDown = (target: Element, pointerId: number, button = 0) =>
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button,
          clientX: 20,
          clientY: 20,
          isPrimary: true,
          pointerId,
        }),
      )
    const editableTarget = document.createElement("div")
    editableTarget.contentEditable = "true"
    const noDragTarget = document.createElement("div")
    noDragTarget.className = "nodrag"
    const shortcutIgnoredTarget = document.createElement("div")
    shortcutIgnoredTarget.dataset.canvasShortcuts = "ignore"
    const interactiveTargets = [
      document.createElement("button"),
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      document.createElement("a"),
      document.createElement("audio"),
      document.createElement("video"),
      document.createElement("iframe"),
      editableTarget,
      noDragTarget,
      shortcutIgnoredTarget,
    ]
    for (const [index, target] of interactiveTargets.entries()) {
      canvasRoot?.append(target)
      focusProbe.focus()
      pointerDown(target, 20 + index)
      expect(document.activeElement).toBe(focusProbe)
      target.remove()
    }
    const passiveTarget = document.createElement("div")
    canvasRoot?.append(passiveTarget)
    focusProbe.focus()
    pointerDown(passiveTarget, 40)
    expect(document.activeElement).toBe(canvasRoot)
    focusProbe.focus()
    pointerDown(passiveTarget, 41, 1)
    expect(document.activeElement).toBe(focusProbe)
    passiveTarget.remove()

    await act(async () => {
      firstNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(observedSelection).toEqual({ edgeIds: [], nodeIds: ["first"] })
    focusProbe.focus()
    await act(async () => {
      pane?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 20,
          isPrimary: true,
          pointerId: 1,
        }),
      )
      pane?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          clientX: 600,
          clientY: 240,
          isPrimary: true,
          pointerId: 1,
        }),
      )
    })
    expect(document.activeElement).toBe(canvasRoot)
    await act(async () => {
      pane?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 600,
          clientY: 240,
          isPrimary: true,
          pointerId: 1,
        }),
      )
      pane?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(errors).toEqual([])
    expect(container.querySelectorAll(".react-flow__node.selected")).toHaveLength(2)
    expect(observedSelection).toEqual({ edgeIds: [], nodeIds: ["first", "second"] })

    await act(async () => {
      emitConnectedEdgeSelection?.()
    })
    expect(observedSelection).toEqual({ edgeIds: ["connected"], nodeIds: ["first", "second"] })

    await act(async () => {
      pane?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 700,
          clientY: 500,
          isPrimary: true,
          pointerId: 3,
        }),
      )
      pane?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 700,
          clientY: 500,
          isPrimary: true,
          pointerId: 3,
        }),
      )
    })
    expect(observedSelection).toEqual({ edgeIds: [], nodeIds: [] })

    await act(async () => {
      pane?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 20,
          isPrimary: true,
          pointerId: 2,
        }),
      )
      pane?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          clientX: 40,
          clientY: 40,
          isPrimary: true,
          pointerId: 2,
        }),
      )
      pane?.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          button: 0,
          clientX: 40,
          clientY: 40,
          isPrimary: true,
          pointerId: 2,
        }),
      )
      emitConnectedEdgeSelection?.()
    })
    expect(errors).toEqual([])
    expect(observedSelection).toEqual({ edgeIds: ["connected"], nodeIds: [] })
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect
    if (root) await act(async () => root?.unmount())
    focusProbe?.remove()
  }
})

test("drags a generating card from its overlay while generation controls keep the node fixed", async () => {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  for (const name of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: testWindow[name].bind(testWindow),
      writable: true,
    })
  }

  const errors: Error[] = []
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList.contains("react-flow__node")) {
      return this.getAttribute("data-id") === "generating"
        ? rect(80, 80, 240, 160)
        : rect(400, 80, 240, 160)
    }
    return rect(0, 0, 1000, 800)
  }

  const generatingNode: CanvasNode = {
    data: { kind: "image", label: "Generating image", metadata: {} },
    id: "generating",
    measured: { height: 160, width: 240 },
    position: { x: 80, y: 80 },
    type: "file",
  }
  const blockedNode: CanvasNode = {
    data: { kind: "image", label: "Interrupted image", metadata: {} },
    id: "blocked",
    measured: { height: 160, width: 240 },
    position: { x: 400, y: 80 },
    type: "file",
  }
  let initialDocument = createCanvasDocument({
    id: "generation-overlay-drag",
    nodes: [generatingNode, blockedNode],
  })
  initialDocument = markCanvasNodeGenerationRunRunning(
    startCanvasNodeGenerationRun(initialDocument, generatingNode.id, {
      operationId: "generating-operation",
      prompt: "Generate",
      toolId: "plugin.example:image",
    }),
    generatingNode.id,
    "generating-operation",
    "generating-task",
  )
  initialDocument = markCanvasNodeGenerationRunRunning(
    startCanvasNodeGenerationRun(initialDocument, blockedNode.id, {
      operationId: "blocked-operation",
      prompt: "Generate",
      toolId: "plugin.example:image",
    }),
    blockedNode.id,
    "blocked-operation",
    "blocked-task",
  )
  initialDocument = finishCanvasNodeGenerationRun(
    initialDocument,
    blockedNode.id,
    "blocked-operation",
    "interrupted",
    "unknown",
  )

  const container = document.createElement("div")
  document.body.append(container)
  let latestDocument: CanvasDocument = initialDocument
  let root: Root | undefined

  const dragWithMouse = async (
    target: Element,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) => {
    const eventWindow = window
    const thresholdPoint = {
      x: start.x + (end.x - start.x) / 2,
      y: start.y + (end.y - start.y) / 2,
    }
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: start.x,
          clientY: start.y,
          view: eventWindow,
        }),
      )
      eventWindow.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: thresholdPoint.x,
          clientY: thresholdPoint.y,
          view: eventWindow,
        }),
      )
      eventWindow.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: end.x,
          clientY: end.y,
          view: eventWindow,
        }),
      )
      eventWindow.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: end.x,
          clientY: end.y,
          view: eventWindow,
        }),
      )
      await Promise.resolve()
    })
  }

  try {
    root = createRoot(container, {
      onCaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={initialDocument}
          onlyRenderVisibleElements={false}
          onDocumentChange={(document) => {
            latestDocument = document
          }}
          services={createCanvasServices()}
        />,
      )
    })

    expect(errors).toEqual([])
    const activeOverlay = container.querySelector<HTMLElement>(
      '[data-canvas-file-generation-activity="running"]',
    )
    const cancelButton = [...(activeOverlay?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "取消",
    )
    const blockedWrapper = container.querySelector<HTMLElement>(
      '[data-canvas-generation-retry-blocked="true"]',
    )
    expect(activeOverlay).not.toBeNull()
    expect(cancelButton).toBeDefined()
    expect(blockedWrapper).not.toBeNull()
    expect(blockedWrapper?.classList.contains("nodrag")).toBe(true)
    expect(blockedWrapper?.querySelector("button")?.disabled).toBe(true)
    const generatingNodeElement = activeOverlay?.closest<HTMLElement>(".react-flow__node")
    expect(generatingNodeElement?.classList.contains("draggable")).toBe(true)

    await dragWithMouse(activeOverlay!, { x: 120, y: 120 }, { x: 184, y: 168 })
    const movedPosition = latestDocument.nodes.find((node) => node.id === generatingNode.id)?.position
    expect(movedPosition).not.toEqual(generatingNode.position)

    const positionBeforeCancelDrag = { ...movedPosition! }
    await dragWithMouse(cancelButton!, { x: 184, y: 168 }, { x: 248, y: 216 })
    expect(latestDocument.nodes.find((node) => node.id === generatingNode.id)?.position).toEqual(
      positionBeforeCancelDrag,
    )

    const blockedPosition = latestDocument.nodes.find((node) => node.id === blockedNode.id)?.position
    await dragWithMouse(blockedWrapper!, { x: 440, y: 120 }, { x: 504, y: 168 })
    expect(latestDocument.nodes.find((node) => node.id === blockedNode.id)?.position).toEqual(blockedPosition)
    expect(errors).toEqual([])
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect
    if (root) await act(async () => root?.unmount())
    container.remove()
  }
})
