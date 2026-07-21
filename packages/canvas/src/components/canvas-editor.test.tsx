import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const fitView = mock(async () => undefined)
const setViewport = mock(async () => undefined)
const setCenter = mock(async () => undefined)
const zoomIn = mock(async () => undefined)
const zoomOut = mock(async () => undefined)
const zoomTo = mock(async () => undefined)
const buttonActions = new Map<string, () => void>()
const buttonContents = new Map<string, ReactNode>()
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
let copyOnCanvas: ((event: unknown) => void) | undefined
let pasteOnCanvas: ((event: unknown) => void) | undefined

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
    if (props["aria-label"]) {
      buttonContents.set(props["aria-label"], props.children)
      if (props.onClick) buttonActions.set(props["aria-label"], props.onClick)
    }
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
        onCopy?: typeof copyOnCanvas
        onDrop?: typeof dropOnCanvas
        onKeyDown?: typeof keyDownOnCanvas
        onPaste?: typeof pasteOnCanvas
      }>
      copyOnCanvas = canvas.props.onCopy
      dropOnCanvas = canvas.props.onDrop
      keyDownOnCanvas = canvas.props.onKeyDown
      pasteOnCanvas = canvas.props.onPaste
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
    setViewport,
    zoomIn,
    zoomOut,
    zoomTo,
  }),
  useViewport: () => ({ x: 17, y: 29, zoom: 1.35 }),
}))

const { createCanvasDocument, createTextNode } = await import("../document")
const { CanvasEditor } = await import("./canvas-editor")
const { getCanvasNodeInsertionItems } = await import("./insertion-items")
const { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } = await import("../builtin-registry")
const { createCanvasServices } = await import("../services")

beforeEach(() => {
  buttonActions.clear()
  buttonContents.clear()
  copyOnCanvas = undefined
  dropOnCanvas = undefined
  keyDownOnCanvas = undefined
  pasteOnCanvas = undefined
  fitView.mockClear()
  setCenter.mockClear()
  setViewport.mockClear()
  zoomIn.mockClear()
  zoomOut.mockClear()
  zoomTo.mockClear()
})

function expectViewportUnchanged() {
  expect(fitView).not.toHaveBeenCalled()
  expect(setCenter).not.toHaveBeenCalled()
  expect(setViewport).not.toHaveBeenCalled()
  expect(zoomIn).not.toHaveBeenCalled()
  expect(zoomOut).not.toHaveBeenCalled()
  expect(zoomTo).not.toHaveBeenCalled()
}

function renderEditor(
  services = createCanvasServices(),
  options: {
    initialDocument?: ReturnType<typeof createCanvasDocument>
    readOnly?: boolean
    selectionDragSource?: Parameters<typeof CanvasEditor>[0]["selectionDragSource"]
  } = {},
) {
  renderToStaticMarkup(
    <CanvasEditor
      initialDocument={options.initialDocument ?? createCanvasDocument({ id: "canvas-viewport" })}
      readOnly={options.readOnly}
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

  test("fits only as an explicit view effect after the user tidies the canvas", () => {
    renderEditor(createCanvasServices(), {
      initialDocument: createCanvasDocument({
        edges: [{ id: "edge", source: "first", target: "second" }],
        id: "canvas-layout",
        nodes: [
          createTextNode({ id: "first", position: { x: 400, y: 200 } }),
          createTextNode({ id: "second", position: { x: 0, y: 0 } }),
        ],
      }),
    })

    expect(buttonActions.get("Tidy canvas")).toBeFunction()
    buttonActions.get("Tidy canvas")?.()

    expect(fitView).toHaveBeenCalledWith({ duration: 220, maxZoom: 1, padding: 0.18 })
  })

  test("lets the explicit Fit view use the Canvas zoom ceiling", () => {
    renderEditor(createCanvasServices(), {
      initialDocument: createCanvasDocument({
        nodes: [createTextNode({ id: "small", position: { x: 0, y: 0 } })],
      }),
    })

    buttonActions.get("Fit view")?.()

    expect(fitView).toHaveBeenCalledWith({ duration: 220, maxZoom: 2.5, padding: 0.18 })
  })

  test("keeps edge visibility and tidy as distinct toolbar actions", () => {
    renderEditor(createCanvasServices(), {
      initialDocument: createCanvasDocument({
        nodes: [
          createTextNode({ id: "first", position: { x: 0, y: 0 } }),
          createTextNode({ id: "second", position: { x: 400, y: 0 } }),
        ],
      }),
    })

    const edgeIcon = renderToStaticMarkup(<>{buttonContents.get("Hide edges")}</>)
    const tidyIcon = renderToStaticMarkup(<>{buttonContents.get("Tidy canvas")}</>)
    expect(buttonActions.get("Choose tidy direction")).toBeFunction()
    expect(edgeIcon).toContain('data-canvas-toolbar-icon="edge-visibility"')
    expect(edgeIcon).not.toContain("lucide-eye")
    expect(tidyIcon).toContain("lucide-layout-grid")
    expect(tidyIcon).not.toBe(edgeIcon)
  })

  test("does not tidy or move the viewport while the Canvas is read-only", () => {
    renderEditor(createCanvasServices(), {
      initialDocument: createCanvasDocument({
        nodes: [
          createTextNode({ id: "first", position: { x: 0, y: 0 } }),
          createTextNode({ id: "second", position: { x: 400, y: 0 } }),
        ],
      }),
      readOnly: true,
    })

    buttonActions.get("Tidy canvas")?.()
    expectViewportUnchanged()
  })
})

describe("CanvasEditor insertion surfaces", () => {
  test("wires native copy and paste events on the active Canvas surface", () => {
    renderEditor()

    expect(copyOnCanvas).toBeFunction()
    expect(pasteOnCanvas).toBeFunction()
  })

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
  test("offers a persistent drag-to-other-apps mode when the host supplies labels", () => {
    renderEditor(createCanvasServices(), {
      selectionDragSource: {
        id: "native-files",
        label: "Keep holding Command-Shift",
        mode: {
          description: "Drag selected media to another app.",
          exitLabel: "Exit",
          label: "Drag to Other Apps",
          preparingLabel: "Preparing selected media",
        },
        prepare: async () => ({ dispose: () => undefined, start: () => undefined }),
        visible: () => true,
      },
    })

    expect(buttonActions.get("Drag to Other Apps")).toBeFunction()
  })

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
