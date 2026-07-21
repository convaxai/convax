import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const fitView = mock(async () => undefined)
const setCenter = mock(async () => undefined)
const zoomIn = mock(async () => undefined)
const zoomOut = mock(async () => undefined)
const zoomTo = mock(async () => undefined)
const buttonActions = new Map<string, () => void>()
let dropOnCanvas:
  | ((event: {
      clientX: number
      clientY: number
      dataTransfer: {
        files: File[]
        getData(type: string): string
        types: string[]
      }
      preventDefault(): void
    }) => void)
  | undefined
let keyDownOnCanvas:
  | ((event: {
      altKey: boolean
      ctrlKey: boolean
      key: string
      metaKey: boolean
      preventDefault(): void
      shiftKey: boolean
      stopPropagation(): void
      target: null
    }) => void)
  | undefined

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
      const canvas = props.children as ReactElement<{
        onDrop?: typeof dropOnCanvas
        onKeyDown?: typeof keyDownOnCanvas
      }>
      dropOnCanvas = canvas.props.onDrop
      keyDownOnCanvas = canvas.props.onKeyDown
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
const { getCanvasNodeInsertionItems } = await import("./insertion-items")
const { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } = await import("../builtin-registry")
const { createCanvasServices } = await import("../services")

beforeEach(() => {
  buttonActions.clear()
  dropOnCanvas = undefined
  keyDownOnCanvas = undefined
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

function renderEditor(
  services = createCanvasServices(),
  options: {
    selectionDragSource?: Parameters<typeof CanvasEditor>[0]["selectionDragSource"]
  } = {},
) {
  renderToStaticMarkup(
    <CanvasEditor
      initialDocument={createCanvasDocument({ id: "canvas-viewport" })}
      selectionDragSource={options.selectionDragSource}
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
    renderEditor(
      createCanvasServices({
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
      }),
    )

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

describe("CanvasEditor insertion surfaces", () => {
  test("offers concrete built-in cards and plugin cards without generic file or agent roles", () => {
    const fileRenderers = createDefaultCanvasFileRendererRegistry()
    const nodes = createDefaultCanvasNodeRegistry()
    fileRenderers.register({
      component: () => null,
      create: (input) => ({
        data: { kind: "diagram", label: "Diagram" },
        id: "diagram-node",
        position: input.position,
        type: "file",
      }),
      id: "diagram",
      label: "Diagram",
      matches: (data) => data.kind === "diagram",
    })

    expect(getCanvasNodeInsertionItems(fileRenderers, nodes).map((item) => item.type)).toEqual([
      "audio",
      "diagram",
      "image",
      "text",
      "video",
    ])
  })

  test("shows concrete media actions in the top bar without Agent or Generate", () => {
    renderEditor(
      createCanvasServices({
        generate: {
          describeTool: async (toolId) => ({ fields: [], toolId }),
          generate: async () => ({ createdNodeIds: [], revision: 0, toolId: "unused", warnings: [] }),
          listTools: async () => [],
        },
      }),
    )

    expect(buttonActions.get("Text")).toBeFunction()
    expect(buttonActions.get("Image")).toBeFunction()
    expect(buttonActions.get("Video")).toBeFunction()
    expect(buttonActions.get("Audio")).toBeFunction()
    expect(buttonActions.get("Agent")).toBeUndefined()
    expect(buttonActions.get("Generate")).toBeUndefined()
  })
})

describe("CanvasEditor external drag mode", () => {
  test("does not prepare until command-shift is held for a visible drag source", () => {
    const prepare = mock(
      () =>
        new Promise<{
          dispose(): void
          start(): void
        }>(() => undefined),
    )
    renderEditor(createCanvasServices(), {
      selectionDragSource: {
        id: "native-files",
        label: "Drag outside Convax",
        prepare,
        visible: () => true,
      },
    })
    const preventDefault = mock(() => undefined)
    const stopPropagation = mock(() => undefined)

    expect(prepare).not.toHaveBeenCalled()
    expect(keyDownOnCanvas).toBeFunction()
    keyDownOnCanvas?.({
      altKey: false,
      ctrlKey: false,
      key: "Shift",
      metaKey: true,
      preventDefault,
      shiftKey: true,
      stopPropagation,
      target: null,
    })

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
  })

  test("holds without preparing when the current selection is not eligible", () => {
    const prepare = mock(async () => ({ dispose: () => undefined, start: () => undefined }))
    renderEditor(createCanvasServices(), {
      selectionDragSource: {
        id: "native-files",
        label: "Drag outside Convax",
        prepare,
        visible: () => false,
      },
    })
    const preventDefault = mock(() => undefined)

    keyDownOnCanvas?.({
      altKey: false,
      ctrlKey: false,
      key: "Shift",
      metaKey: true,
      preventDefault,
      shiftKey: true,
      stopPropagation: () => undefined,
      target: null,
    })

    expect(prepare).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
