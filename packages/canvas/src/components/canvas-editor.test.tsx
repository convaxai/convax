import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const fitView = mock(async () => undefined)
const setCenter = mock(async () => undefined)
const zoomIn = mock(async () => undefined)
const zoomOut = mock(async () => undefined)
const zoomTo = mock(async () => undefined)
const buttonActions = new Map<string, () => void>()
let dropOnCanvas: ((event: {
  clientX: number
  clientY: number
  dataTransfer: {
    files: File[]
    getData(type: string): string
    types: string[]
  }
  preventDefault(): void
}) => void) | undefined

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    requestAnimationFrame(callback: FrameRequestCallback) {
      callback(0)
      return 1
    },
  },
})

afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
  else Reflect.deleteProperty(globalThis, "window")
})

function Passthrough(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

mock.module("@convax/ui", () => ({
  Button: (props: { "aria-label"?: string; children?: ReactNode; onClick?: () => void }) => {
    if (props["aria-label"] && props.onClick) buttonActions.set(props["aria-label"], props.onClick)
    return <button>{props.children}</button>
  },
  ContextMenu: Passthrough,
  ContextMenuContent: Passthrough,
  ContextMenuItem: Passthrough,
  ContextMenuLabel: Passthrough,
  ContextMenuSeparator: () => null,
  ContextMenuTrigger: (props: { children?: ReactNode }) => {
    if (isValidElement(props.children)) {
      dropOnCanvas = (props.children as ReactElement<{ onDrop?: typeof dropOnCanvas }>).props.onDrop
    }
    return <>{props.children}</>
  },
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

mock.module("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  BaseEdge: () => null,
  EdgeLabelRenderer: Passthrough,
  Handle: () => null,
  MiniMap: () => null,
  NodeResizer: () => null,
  NodeToolbar: Passthrough,
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  ReactFlow: Passthrough,
  ReactFlowProvider: Passthrough,
  SelectionMode: { Partial: "partial" },
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
  useInternalNode: () => undefined,
  useReactFlow: () => ({
    fitView,
    getNodes: () => [],
    getViewport: () => ({ x: 17, y: 29, zoom: 1.35 }),
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    setCenter,
    zoomIn,
    zoomOut,
    zoomTo,
  }),
  useViewport: () => ({ x: 17, y: 29, zoom: 1.35 }),
}))

const { createCanvasDocument } = await import("../document")
const { CanvasEditor } = await import("./canvas-editor")
const { createCanvasServices } = await import("../services")

beforeEach(() => {
  buttonActions.clear()
  dropOnCanvas = undefined
  fitView.mockClear()
  setCenter.mockClear()
  zoomIn.mockClear()
  zoomOut.mockClear()
  zoomTo.mockClear()
})

function expectViewportUnchanged() {
  expect(fitView).not.toHaveBeenCalled()
  expect(setCenter).not.toHaveBeenCalled()
  expect(zoomIn).not.toHaveBeenCalled()
  expect(zoomOut).not.toHaveBeenCalled()
  expect(zoomTo).not.toHaveBeenCalled()
}

function renderEditor(services = createCanvasServices()) {
  renderToStaticMarkup(
    <CanvasEditor
      initialDocument={createCanvasDocument({ id: "canvas-viewport" })}
      services={services}
    />,
  )
}

describe("CanvasEditor viewport ownership", () => {
  test("does not fit the viewport after adding a regular node", () => {
    renderEditor()

    expect(buttonActions.get("Text")).toBeFunction()
    buttonActions.get("Text")?.()

    expectViewportUnchanged()
  })

  test("does not fit the viewport after a dropped file finishes uploading", async () => {
    let uploadFinished!: () => void
    const finished = new Promise<void>((resolve) => {
      uploadFinished = resolve
    })
    renderEditor(createCanvasServices({
      notify: {
        show(notification) {
          if (notification.kind === "success") uploadFinished()
        },
      },
      upload: {
        async upload() {
          return [{ id: "brief", kind: "text", name: "brief.txt", text: "Brief" }]
        },
      },
    }))

    expect(dropOnCanvas).toBeFunction()
    dropOnCanvas?.({
      clientX: 400,
      clientY: 260,
      dataTransfer: {
        files: [new File(["Brief"], "brief.txt", { type: "text/plain" })],
        getData: () => "",
        types: ["Files"],
      },
      preventDefault: () => undefined,
    })
    await finished

    expectViewportUnchanged()
  })
})
