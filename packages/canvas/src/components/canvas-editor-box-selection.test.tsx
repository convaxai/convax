import { afterAll, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { StrictMode, type ReactNode, act } from "react"
import { createRoot, type Root } from "react-dom/client"

const testWindow = new Window({ url: "https://convax.test/" })
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
  Button: (props: { children?: ReactNode }) => <button>{props.children}</button>,
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
  Tooltip: Passthrough,
  TooltipProvider: Passthrough,
  cn: (...values: unknown[]) => values.filter((value) => typeof value === "string").join(" "),
}))

const { createCanvasDocument, createTextNode } = await import("../document")
const { createCanvasFileRendererRegistry } = await import("../file-renderer-registry")
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

    const pane = container.querySelector<HTMLElement>(".react-flow__pane")
    const firstNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="first"]')
    expect(pane).not.toBeNull()
    expect(firstNode).not.toBeNull()
    expect(emitConnectedEdgeSelection).toBeFunction()
    await act(async () => {
      firstNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(observedSelection).toEqual({ edgeIds: [], nodeIds: ["first"] })
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
  }
})
