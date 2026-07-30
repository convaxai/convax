import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { CanvasEdge, CanvasNode } from "../types"
import type { CanvasAppearanceInput } from "../appearance"

const fitView = mock(async () => undefined)
const setViewport = mock(async () => undefined)
const setCenter = mock(async () => undefined)
const zoomIn = mock(async () => undefined)
const zoomOut = mock(async () => undefined)
const zoomTo = mock(async () => undefined)
const buttonActions = new Map<string, () => void>()
const buttonContents = new Map<string, ReactNode>()
const contextMenuActions = new Map<string, () => void>()
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
let renderedCanvasEdges: CanvasEdge[] = []
let renderedCanvasNodes: CanvasNode[] = []
let renderedBackground: { color?: string; gap?: number; size?: number; variant?: string } | undefined
let renderedColorMode: string | undefined
let renderedReactFlowOptions:
  | {
      connectionRadius?: number
      multiSelectionKeyCode?: readonly string[]
      snapToGrid?: boolean
    }
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

function reactNodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(reactNodeText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return reactNodeText(node.props.children)
  return ""
}

function MockReactFlow(props: {
  children?: ReactNode
  colorMode?: string
  connectionRadius?: number
  edges?: CanvasEdge[]
  multiSelectionKeyCode?: readonly string[]
  nodes?: CanvasNode[]
  snapToGrid?: boolean
}) {
  renderedCanvasEdges = props.edges ?? []
  renderedCanvasNodes = props.nodes ?? []
  renderedColorMode = props.colorMode
  renderedReactFlowOptions = props
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
  ContextMenuItem: (props: { children?: ReactNode; onSelect?: () => void }) => {
    const label = reactNodeText(props.children).replace(/\s+/g, " ").trim()
    if (label && props.onSelect) contextMenuActions.set(label, props.onSelect)
    return <>{props.children}</>
  },
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
  Input: (props: { className?: string }) => <input className={props.className} />,
  Loading: (props: {
    className?: string
    description?: ReactNode
    label?: ReactNode
    reducedMotion?: boolean
  }) => (
    <div
      aria-live="polite"
      className={props.className}
      data-slot="loading"
      data-ui-loading-motion={
        props.reducedMotion === true ? "reduce" : props.reducedMotion === false ? "animate" : undefined
      }
      role="status"
    >
      <span aria-hidden="true" data-slot="loading-spinner" data-ui-loading-spinner="" />
      <span data-slot="loading-label">{props.label}</span>
      {props.description != null ? <span data-slot="loading-description">{props.description}</span> : null}
    </div>
  ),
  LoadingSkeleton: (props: { className?: string }) => (
    <div aria-hidden="true" className={props.className} data-slot="loading-skeleton" data-ui-loading-skeleton="" />
  ),
  LoadingSpinner: (props: { className?: string; reducedMotion?: boolean; size?: string }) => (
    <span
      aria-hidden="true"
      className={props.className}
      data-slot="loading-spinner"
      data-ui-loading-motion={
        props.reducedMotion === true ? "reduce" : props.reducedMotion === false ? "animate" : undefined
      }
      data-ui-loading-size={props.size}
      data-ui-loading-spinner=""
    />
  ),
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

mock.module("@xyflow/react", () => ({
  Background: (props: typeof renderedBackground) => {
    renderedBackground = props
    return null
  },
  BackgroundVariant: { Dots: "dots", Lines: "lines" },
  BaseEdge: () => null,
  EdgeLabelRenderer: Passthrough,
  Handle: () => null,
  MiniMap: () => null,
  NodeResizer: () => null,
  NodeToolbar: Passthrough,
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  ReactFlow: MockReactFlow,
  ReactFlowProvider: Passthrough,
  SelectionMode: { Partial: "partial" },
  ViewportPortal: Passthrough,
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
const { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } = await import("../connections")
const { canvasHistoryReducer, createCanvasHistory } = await import("../history")
const {
  abortCanvasReload,
  abortCanvasReloadBeforeWait,
  CanvasEditor,
  CanvasResourceRefreshController,
  completeCanvasResourceMutation,
  handleCanvasResourceMutationFailure,
  handleCanvasResourceRelinkSelection,
  handleCanvasResourceUploadSelection,
  linkCanvasReloadAbortSignal,
  replaceCanvasNodeResourceState,
  runCanvasReloadScopeEffect,
  settleCanvasReloadFailure,
} = await import("./canvas-editor")
const { getCanvasNodeInsertionItems } = await import("./insertion-items")
const { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } = await import("../builtin-registry")
const { createCanvasServices } = await import("../services")

beforeEach(() => {
  buttonActions.clear()
  buttonContents.clear()
  contextMenuActions.clear()
  copyOnCanvas = undefined
  dropOnCanvas = undefined
  keyDownOnCanvas = undefined
  pasteOnCanvas = undefined
  renderedCanvasEdges = []
  renderedCanvasNodes = []
  renderedBackground = undefined
  renderedColorMode = undefined
  renderedReactFlowOptions = undefined
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
    appearance?: CanvasAppearanceInput
    onGenerateRequest?: Parameters<typeof CanvasEditor>[0]["onGenerateRequest"]
    readOnly?: boolean
    selectionDragSource?: Parameters<typeof CanvasEditor>[0]["selectionDragSource"]
  } = {},
) {
  return renderToStaticMarkup(
    <CanvasEditor
      initialDocument={options.initialDocument ?? createCanvasDocument({ id: "canvas-viewport" })}
      appearance={options.appearance}
      onGenerateRequest={options.onGenerateRequest}
      readOnly={options.readOnly}
      selectionDragSource={options.selectionDragSource}
      services={services}
    />,
  )
}

describe("CanvasEditor edge port projection", () => {
  test("uses one bounded connection radius and explicit multi-selection chord", () => {
    renderEditor()
    expect(renderedReactFlowOptions).toMatchObject({
      connectionRadius: 120,
      multiSelectionKeyCode: ["Meta", "Shift"],
      snapGrid: [8, 8],
      snapToGrid: true,
    })
  })

  test("projects handleless and legacy edges onto fixed ports without mutating the document", () => {
    const source = createTextNode({
      id: "source",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const target = createTextNode({
      id: "target",
      metadata: {},
      position: { x: 0, y: 400 },
      resourceState: { status: "ready" },
    })
    const initialDocument = createCanvasDocument({
      edges: [
        { id: "handleless", source: source.id, target: target.id },
        {
          id: "legacy",
          source: target.id,
          sourceHandle: "source-bottom",
          target: source.id,
          targetHandle: "target-top",
        },
      ],
      id: "canvas-legacy-edges",
      nodes: [source, target],
    })

    renderEditor(createCanvasServices(), { initialDocument, readOnly: true })

    expect(renderedCanvasEdges).toEqual([
      expect.objectContaining({
        id: "handleless",
        sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
        targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
      }),
      expect.objectContaining({
        id: "legacy",
        sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
        targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
      }),
    ])
    expect(initialDocument.edges).toEqual([
      { id: "handleless", source: source.id, target: target.id },
      {
        id: "legacy",
        source: target.id,
        sourceHandle: "source-bottom",
        target: source.id,
        targetHandle: "target-top",
      },
    ])
  })
})

describe("CanvasEditor node dimension projection", () => {
  test("projects persisted numeric style dimensions without mutating the Canvas document", () => {
    const styleOnly = createTextNode({
      id: "style-only",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const measured = {
      ...createTextNode({
        id: "measured",
        metadata: {},
        position: { x: 300, y: 0 },
        resourceState: { status: "ready" },
      }),
      measured: { height: 222, width: 333 },
      style: { height: 888, width: 999 },
    }
    const explicit = {
      ...createTextNode({
        id: "explicit",
        metadata: {},
        position: { x: 600, y: 0 },
        resourceState: { status: "ready" },
      }),
      height: 234,
      width: 345,
      style: { height: 876, width: 987 },
    }
    const initialized = {
      ...createTextNode({
        id: "initialized",
        metadata: {},
        position: { x: 900, y: 0 },
        resourceState: { status: "ready" },
      }),
      initialHeight: 456,
      initialWidth: 567,
      style: { height: 765, width: 876 },
    }
    const stringStyle = {
      ...createTextNode({
        id: "string-style",
        metadata: {},
        position: { x: 1_200, y: 0 },
        resourceState: { status: "ready" },
      }),
      style: { height: "auto", width: "50%" },
    }
    const initialDocument = createCanvasDocument({
      id: "canvas-dimensions",
      nodes: [styleOnly, measured, explicit, initialized, stringStyle],
    })

    renderEditor(createCanvasServices(), { initialDocument })

    expect(renderedCanvasNodes.find((node) => node.id === "style-only")).toMatchObject({
      initialHeight: 160,
      initialWidth: 280,
    })
    expect(styleOnly).not.toHaveProperty("initialHeight")
    expect(styleOnly).not.toHaveProperty("initialWidth")
    expect(renderedCanvasNodes.find((node) => node.id === "measured")).not.toHaveProperty("initialWidth")
    expect(renderedCanvasNodes.find((node) => node.id === "measured")).not.toHaveProperty("initialHeight")
    expect(renderedCanvasNodes.find((node) => node.id === "explicit")).not.toHaveProperty("initialWidth")
    expect(renderedCanvasNodes.find((node) => node.id === "explicit")).not.toHaveProperty("initialHeight")
    expect(renderedCanvasNodes.find((node) => node.id === "initialized")).toMatchObject({
      initialHeight: 456,
      initialWidth: 567,
    })
    expect(renderedCanvasNodes.find((node) => node.id === "string-style")).not.toHaveProperty("initialWidth")
    expect(renderedCanvasNodes.find((node) => node.id === "string-style")).not.toHaveProperty("initialHeight")
  })
})

describe("CanvasEditor resource mutation", () => {
  test("announces blocking authoritative hydration without relying on spinner motion", () => {
    const initialDocument = createCanvasDocument({ id: "loading-canvas" })
    const markup = renderEditor(
      createCanvasServices({
        persistence: {
          load: async () => initialDocument,
          save: async (document) => document,
        },
      }),
      { initialDocument },
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain("Loading canvas…")
    expect(markup).toContain('data-slot="loading"')
    expect(markup).toContain('data-slot="loading-spinner"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup.match(/role="status"/g)?.length).toBe(1)
  })

  test("keeps a cancelled relink selection isolated from the next ordinary multi-file upload", () => {
    const uploaded: File[][] = []
    const relinked: Array<{ file: File; nodeId: string }> = []
    const first = new File(["first"], "first.png", { type: "image/png" })
    const second = new File(["second"], "second.png", { type: "image/png" })

    // Cancelling the dedicated relink picker produces no change event. The next
    // ordinary picker selection must still route every file through Add.
    handleCanvasResourceUploadSelection([first, second], (files) => uploaded.push([...files]))

    expect(uploaded).toEqual([[first, second]])
    expect(relinked).toEqual([])

    handleCanvasResourceRelinkSelection("missing-image", [first, second], (nodeId, file) => {
      relinked.push({ file, nodeId })
    })
    expect(relinked).toEqual([{ file: first, nodeId: "missing-image" }])

    const markup = renderEditor()
    expect(markup).toContain('data-canvas-resource-picker="upload"')
    expect(markup).toContain('data-canvas-resource-picker="relink"')
    expect(markup).toMatch(/data-canvas-resource-picker="upload"[^>]*multiple=""/)
    expect(markup).not.toMatch(/data-canvas-resource-picker="relink"[^>]*multiple/)
  })

  test("replaces only transient resource state without changing the Canvas revision", () => {
    const document = createCanvasDocument({
      id: "canvas-runtime-refresh",
      nodes: [
        {
          id: "note",
          data: {
            kind: "text",
            label: "Note",
            metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/a.md" } },
            resourceState: { contentRevision: "a".repeat(64), status: "ready", text: "before" },
          },
          position: { x: 0, y: 0 },
          type: "file",
        },
      ],
    })

    const updated = replaceCanvasNodeResourceState(document, "note", {
      contentRevision: "b".repeat(64),
      editableText: true,
      status: "ready",
      text: "after",
    })

    expect(updated.revision).toBe(document.revision)
    expect(updated.nodes[0]!.data.resourceState).toEqual({
      contentRevision: "b".repeat(64),
      editableText: true,
      status: "ready",
      text: "after",
    })
    expect(updated.nodes[0]!.data.metadata).toBe(document.nodes[0]!.data.metadata)
  })

  test("marks mounted resources stale synchronously and single-flights one trailing runtime refresh", async () => {
    const initial = createCanvasDocument({
      id: "canvas-watcher-refresh",
      nodes: [
        {
          id: "note",
          data: {
            kind: "text",
            label: "Note",
            metadata: { resource: "Notes/a.md" },
            resourceState: { status: "ready", text: "before" },
          },
          position: { x: 0, y: 0 },
          type: "file",
        },
      ],
    })
    const older = createCanvasDocument({ id: "older" })
    const newer = createCanvasDocument({ id: "newer" })
    let history = { ...createCanvasHistory(initial), future: [newer], past: [older] }
    const selection = { nodeIds: ["note"] }
    const viewport = { x: 17, y: 29, zoom: 1.35 }
    const persist = mock(() => undefined)
    const pending: Array<{ resolve(document: typeof initial): void; promise: Promise<typeof initial> }> = []
    const hydrateStale = mock((_input: { document: typeof initial }) => {
      let resolve!: (document: typeof initial) => void
      const promise = new Promise<typeof initial>((next) => {
        resolve = next
      })
      pending.push({ promise, resolve })
      return promise
    })
    const controller = new CanvasResourceRefreshController({
      current: () => ({
        document: history.document,
        scope: { documentId: history.document.id, generation: 0, scopeId: "project-one" },
      }),
      replace(document) {
        history = canvasHistoryReducer(history, { document, type: "replace" })
      },
      service: {
        hydrateStale,
        markStale(document) {
          return {
            ...document,
            nodes: document.nodes.map((node) => ({
              ...node,
              data: {
                ...node.data,
                resourceState: {
                  ...(node.data.resourceState as Record<string, unknown>),
                  status: "stale",
                },
              },
            })),
          }
        },
      },
    })

    const first = controller.invalidateResources()
    expect((history.document.nodes[0]!.data.resourceState as { status: string }).status).toBe("stale")
    const second = controller.invalidateResources()
    expect(hydrateStale).toHaveBeenCalledTimes(1)

    pending[0]!.resolve({
      ...initial,
      nodes: initial.nodes.map((node) => ({
        ...node,
        data: { ...node.data, resourceState: { status: "ready", text: "first" } },
      })),
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(hydrateStale).toHaveBeenCalledTimes(2)

    const trailingInput = hydrateStale.mock.calls[1]![0].document
    pending[1]!.resolve({
      ...trailingInput,
      nodes: trailingInput.nodes.map((node) => ({
        ...node,
        data: { ...node.data, resourceState: { status: "ready", text: "second" } },
      })),
    })
    await Promise.all([first, second])

    expect(history.document.nodes[0]!.data.resourceState).toEqual({ status: "ready", text: "second" })
    expect(history.document.revision).toBe(initial.revision)
    expect(history.past).toEqual([older])
    expect(history.future).toEqual([newer])
    expect(selection).toEqual({ nodeIds: ["note"] })
    expect(viewport).toEqual({ x: 17, y: 29, zoom: 1.35 })
    expect(persist).not.toHaveBeenCalled()
  })

  test("discards a stale hydration result and schedules a trailing pass after scope, revision, or reference changes", async () => {
    const initial = {
      ...createCanvasDocument({
        id: "canvas-stale-result",
        nodes: [
          {
            id: "note",
            data: {
              kind: "text" as const,
              label: "Note",
              metadata: { resource: "Notes/a.md" },
              resourceState: { status: "ready" as const },
            },
            position: { x: 0, y: 0 },
            type: "file" as const,
          },
        ],
      }),
      revision: 4,
    }
    let document = initial
    let scopeId = "project-one"
    const requests: Array<{ input: typeof initial; resolve(document: typeof initial): void }> = []
    const hydrateStale = mock(
      (input: { document: typeof initial }) =>
        new Promise<typeof initial>((resolve) => requests.push({ input: input.document, resolve })),
    )
    const controller = new CanvasResourceRefreshController({
      current: () => ({ document, scope: { documentId: document.id, generation: 0, scopeId } }),
      replace(next) {
        document = next as typeof initial
      },
      service: {
        hydrateStale,
        markStale(current) {
          return {
            ...current,
            nodes: current.nodes.map((node) => ({
              ...node,
              data: { ...node.data, resourceState: { status: "stale" } },
            })),
          }
        },
      },
    })

    const refresh = controller.invalidateResources()
    const firstInput = requests[0]!.input
    scopeId = "project-two"
    document = {
      ...document,
      revision: 5,
      nodes: document.nodes.map((node) => ({
        ...node,
        data: { ...node.data, metadata: { resource: "Notes/b.md" } },
      })),
    }
    requests[0]!.resolve({
      ...firstInput,
      nodes: firstInput.nodes.map((node) => ({
        ...node,
        data: { ...node.data, resourceState: { status: "ready", text: "obsolete" } },
      })),
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(hydrateStale).toHaveBeenCalledTimes(2)
    expect(document.nodes[0]!.data.resourceState).not.toHaveProperty("text", "obsolete")
    const trailingInput = requests[1]!.input
    requests[1]!.resolve({
      ...trailingInput,
      nodes: trailingInput.nodes.map((node) => ({
        ...node,
        data: { ...node.data, resourceState: { status: "ready", text: "current" } },
      })),
    })
    await refresh

    expect(document.revision).toBe(5)
    expect(document.nodes[0]!.data.metadata).toEqual({ resource: "Notes/b.md" })
    expect(document.nodes[0]!.data.resourceState).toEqual({ status: "ready", text: "current" })
  })

  test("ignores delayed success and failure after switching to another scope with the same Canvas id", async () => {
    const operation = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    let current = operation
    let resolveMutation!: (value: { createdNodeIds: string[]; revision: number; warnings: string[] }) => void
    const mutation = new Promise<{ createdNodeIds: string[]; revision: number; warnings: string[] }>((resolve) => {
      resolveMutation = resolve
    })
    const reload = mock(async () => undefined)
    const selectNodes = mock(() => undefined)
    const show = mock(() => undefined)
    const notifyError = mock(() => undefined)
    const completion = mutation.then((result) =>
      completeCanvasResourceMutation({
        currentScope: () => current,
        operationScope: operation,
        reload,
        result,
        selectNodes,
        show,
        signal: new AbortController().signal,
      }),
    )

    current = { documentId: "canvas-main", generation: 1, scopeId: "project-b" }
    resolveMutation({ createdNodeIds: ["old-note"], revision: 1, warnings: [] })
    await completion
    handleCanvasResourceMutationFailure({
      currentScope: () => current,
      error: new Error("old Project failed"),
      notifyError,
      operationScope: operation,
      signal: new AbortController().signal,
    })

    expect(reload).not.toHaveBeenCalled()
    expect(selectNodes).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
    expect(notifyError).not.toHaveBeenCalled()
  })

  test("warns when committed resources cannot be refreshed without exposing the reload error", async () => {
    const scope = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    const selectNodes = mock(() => undefined)
    const show = mock(() => undefined)

    await completeCanvasResourceMutation({
      currentScope: () => scope,
      operationScope: scope,
      reload: async () => {
        throw new Error("ENOENT: /native/private/project")
      },
      result: { createdNodeIds: ["note"], revision: 1, warnings: [] },
      selectNodes,
      show,
      signal: new AbortController().signal,
    })

    expect(selectNodes).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith({
      description: "Reload the Canvas to show the committed resources.",
      kind: "warning",
      title: "Resources added, but refresh failed",
    })
    expect(JSON.stringify(show.mock.calls)).not.toContain("/native/")
  })

  test("keeps a committed resource successful when its optional camera effect fails", async () => {
    const scope = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    const show = mock(() => undefined)
    const selectNodes = mock(() => undefined)
    await completeCanvasResourceMutation({
      currentScope: () => scope,
      operationScope: scope,
      reload: async () => undefined,
      result: { createdNodeIds: ["note"], revision: 1, warnings: [] },
      runViewEffect: async () => {
        throw new Error("view closed")
      },
      selectNodes,
      show,
      signal: new AbortController().signal,
    })
    expect(selectNodes).toHaveBeenCalledWith(["note"])
    expect(show).toHaveBeenCalledWith({ description: undefined, kind: "success", title: "1 item added" })
  })

  test("presents an authoritative batch once before selection and optional camera work", async () => {
    const scope = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    const calls: string[] = []
    await completeCanvasResourceMutation({
      currentScope: () => scope,
      operationScope: scope,
      presentCreatedNodes: (nodeIds) => calls.push(`present:${nodeIds.join(",")}`),
      reload: async () => {
        calls.push("reload")
      },
      result: { createdNodeIds: ["one", "two", "one"], revision: 1, warnings: [] },
      runViewEffect: async (nodeIds) => {
        calls.push(`view:${nodeIds.join(",")}`)
      },
      selectNodes: (nodeIds) => calls.push(`select:${nodeIds.join(",")}`),
      show: () => calls.push("show"),
      signal: new AbortController().signal,
    })

    expect(calls).toEqual(["reload", "present:one,two", "select:one,two", "view:one,two", "show"])
  })

  test("ignores an aborted success in the same scope before and during refresh completion", async () => {
    const scope = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    const abortedBefore = new AbortController()
    abortedBefore.abort()
    const reloadBefore = mock(async () => undefined)
    const selectBefore = mock(() => undefined)
    const showBefore = mock(() => undefined)

    await completeCanvasResourceMutation({
      currentScope: () => scope,
      operationScope: scope,
      reload: reloadBefore,
      result: { createdNodeIds: ["note"], revision: 1, warnings: [] },
      selectNodes: selectBefore,
      show: showBefore,
      signal: abortedBefore.signal,
    })
    expect(reloadBefore).not.toHaveBeenCalled()
    expect(selectBefore).not.toHaveBeenCalled()
    expect(showBefore).not.toHaveBeenCalled()

    const abortedDuring = new AbortController()
    const selectDuring = mock(() => undefined)
    const showDuring = mock(() => undefined)
    await completeCanvasResourceMutation({
      currentScope: () => scope,
      operationScope: scope,
      reload: async () => {
        abortedDuring.abort()
      },
      result: { createdNodeIds: ["note"], revision: 1, warnings: [] },
      selectNodes: selectDuring,
      show: showDuring,
      signal: abortedDuring.signal,
    })
    expect(selectDuring).not.toHaveBeenCalled()
    expect(showDuring).not.toHaveBeenCalled()

    const abortedBeforeNotify = new AbortController()
    const showAfterSelect = mock(() => undefined)
    await completeCanvasResourceMutation({
      currentScope: () => scope,
      operationScope: scope,
      reload: async () => undefined,
      result: { createdNodeIds: ["note"], revision: 1, warnings: [] },
      selectNodes: () => abortedBeforeNotify.abort(),
      show: showAfterSelect,
      signal: abortedBeforeNotify.signal,
    })
    expect(showAfterSelect).not.toHaveBeenCalled()
  })

  test("passes the mutation signal through a slow persistence reload and aborts it", async () => {
    const scope = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    const mutationController = new AbortController()
    let persistenceSignal: AbortSignal | undefined
    const show = mock(() => undefined)
    const selectNodes = mock(() => undefined)
    const completion = completeCanvasResourceMutation({
      currentScope: () => scope,
      operationScope: scope,
      reload: (async (signal: AbortSignal) => {
        persistenceSignal = signal
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
        })
      }) as never,
      result: { createdNodeIds: ["note"], revision: 1, warnings: [] },
      selectNodes,
      show,
      signal: mutationController.signal,
    })

    await Promise.resolve()
    mutationController.abort()
    await completion

    expect(persistenceSignal).toBe(mutationController.signal)
    expect(persistenceSignal?.aborted).toBeTrue()
    expect(selectNodes).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
  })

  test("resolves an aborted reload barrier without recording an error or notification", async () => {
    const scope = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    const mutationController = new AbortController()
    const reloadController = new AbortController()
    const unlink = linkCanvasReloadAbortSignal(mutationController.signal, reloadController)
    const resolveBarrier = mock(() => undefined)
    const rejectBarrier = mock(() => undefined)
    const setLoadError = mock(() => undefined)
    const notifyError = mock(() => undefined)

    mutationController.abort()
    const outcome = settleCanvasReloadFailure({
      currentScope: () => scope,
      error: new DOMException("Aborted", "AbortError"),
      notifyError,
      rejectBarrier,
      reloadScope: scope,
      resolveBarrier,
      setLoadError,
      signal: reloadController.signal,
    })
    unlink()

    expect(outcome).toBe("aborted")
    expect(reloadController.signal.aborted).toBeTrue()
    expect(resolveBarrier).toHaveBeenCalledTimes(1)
    expect(rejectBarrier).not.toHaveBeenCalled()
    expect(setLoadError).not.toHaveBeenCalled()
    expect(notifyError).not.toHaveBeenCalled()
  })

  test("aborts a tracked slow reload before prepare-to-leave waits for the load barrier", async () => {
    const reloadController = new AbortController()
    const events: string[] = []
    const slowReload = new Promise<void>((resolve) => {
      reloadController.signal.addEventListener(
        "abort",
        () => {
          events.push("abort")
          resolve()
        },
        { once: true },
      )
    })

    await abortCanvasReloadBeforeWait(reloadController, async () => {
      events.push("wait")
      expect(reloadController.signal.aborted).toBeTrue()
      await slowReload
    })

    expect(events).toEqual(["abort", "wait"])
  })

  test("aborts a tracked slow reload when the view scope changes without a remount", async () => {
    const reloadController = new AbortController()
    const aborted = new Promise<void>((resolve) =>
      reloadController.signal.addEventListener("abort", () => resolve(), { once: true }),
    )

    abortCanvasReload(reloadController)
    await aborted

    expect(reloadController.signal.aborted).toBeTrue()
  })

  test("does not apply stale reload state after a no-remount view scope change", () => {
    const reloadScope = { documentId: "canvas-main", generation: 0, scopeId: "project-a" }
    let current = reloadScope
    const setLoadError = mock(() => undefined)
    const setHydrating = mock(() => undefined)
    const notifyError = mock(() => undefined)

    current = { documentId: "canvas-main", generation: 1, scopeId: "project-b" }
    runCanvasReloadScopeEffect({
      currentScope: () => current,
      effect: () => {
        setLoadError()
        notifyError()
      },
      reloadScope,
    })
    runCanvasReloadScopeEffect({
      currentScope: () => current,
      effect: setHydrating,
      reloadScope,
    })

    expect(setLoadError).not.toHaveBeenCalled()
    expect(setHydrating).not.toHaveBeenCalled()
    expect(notifyError).not.toHaveBeenCalled()
  })

  test("routes context-menu text creation through new-text mutation without fitting the viewport", async () => {
    const additions: unknown[] = []
    renderEditor(
      createCanvasServices({
        mutation: {
          async add(input) {
            additions.push(input)
            return { createdNodeIds: ["note"], revision: 1, warnings: [] }
          },
        },
      }),
    )

    expect(contextMenuActions.get("Add Text")).toBeFunction()
    contextMenuActions.get("Add Text")?.()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(additions).toHaveLength(1)
    expect(additions[0]).toMatchObject({
      expectedRevision: 0,
      files: [],
      sources: [{ kind: "new-text", text: "" }],
    })
    expect((additions[0] as { sources: Array<{ sourceId: unknown }> }).sources[0]?.sourceId).toBeString()

    expectViewportUnchanged()
  })

  test("routes a drop through resource mutation and preserves the viewport", async () => {
    const additions: unknown[] = []
    renderEditor(
      createCanvasServices({
        mutation: {
          async add(input) {
            additions.push(input)
            return { createdNodeIds: ["brief"], revision: 1, warnings: [] }
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(additions).toHaveLength(1)
    expect(additions[0]).toMatchObject({
      expectedRevision: 0,
      files: [expect.objectContaining({ name: "brief.txt" })],
      sources: [],
      transfer: { data: { Files: "" }, types: ["Files"] },
    })
    expectViewportUnchanged()
  })

  test("fits only as an explicit view effect after the user tidies the canvas", () => {
    renderEditor(createCanvasServices(), {
      initialDocument: createCanvasDocument({
        edges: [{ id: "edge", source: "first", target: "second" }],
        id: "canvas-layout",
        nodes: [
          createTextNode({
            id: "first",
            metadata: {},
            position: { x: 400, y: 200 },
            resourceState: { status: "ready" },
          }),
          createTextNode({ id: "second", metadata: {}, position: { x: 0, y: 0 }, resourceState: { status: "ready" } }),
        ],
      }),
    })

    expect(buttonActions.get("Tidy canvas")).toBeFunction()
    buttonActions.get("Tidy canvas")?.()

    expect(fitView).toHaveBeenCalledWith({
      duration: 300,
      ease: expect.any(Function),
      interpolate: "smooth",
      maxZoom: 1,
      padding: 0.18,
    })
  })

  test("lets the explicit Fit view use the Canvas zoom ceiling", () => {
    renderEditor(createCanvasServices(), {
      initialDocument: createCanvasDocument({
        nodes: [
          createTextNode({ id: "small", metadata: {}, position: { x: 0, y: 0 }, resourceState: { status: "ready" } }),
        ],
      }),
    })

    buttonActions.get("Fit view")?.()

    expect(fitView).toHaveBeenCalledWith({
      duration: 300,
      ease: expect.any(Function),
      interpolate: "smooth",
      maxZoom: 2.5,
      padding: 0.18,
    })
  })

  test("keeps edge visibility and tidy as distinct toolbar actions", () => {
    renderEditor(createCanvasServices(), {
      initialDocument: createCanvasDocument({
        nodes: [
          createTextNode({ id: "first", metadata: {}, position: { x: 0, y: 0 }, resourceState: { status: "ready" } }),
          createTextNode({
            id: "second",
            metadata: {},
            position: { x: 400, y: 0 },
            resourceState: { status: "ready" },
          }),
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
          createTextNode({ id: "first", metadata: {}, position: { x: 0, y: 0 }, resourceState: { status: "ready" } }),
          createTextNode({
            id: "second",
            metadata: {},
            position: { x: 400, y: 0 },
            resourceState: { status: "ready" },
          }),
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

  test("offers empty image and video cards plus plugin cards without source-backed or agent roles", () => {
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
      "diagram",
      "image",
      "video",
    ])
  })

  test("shows image and video in the shared Canvas context-menu insertion list", () => {
    const markup = renderEditor()

    expect(markup).toContain("Add Text")
    expect(markup).toContain("Add Image")
    expect(markup).toContain("Add Video")
    expect(markup).not.toContain("Add Audio")
  })

  test("publishes registered node creation through the safe top toolbar without duplicating Search", () => {
    const markup = renderEditor(
      createCanvasServices({
        generate: {
          describeTool: async (toolId) => ({ fields: [], toolId }),
          generate: async () => ({ createdNodeIds: [], revision: 0, toolId: "unused", warnings: [] }),
          listTools: async () => [],
        },
      }),
    )

    expect(contextMenuActions.get("Add Text")).toBeFunction()
    expect(contextMenuActions.get("Generate⌘↵")).toBeFunction()
    expect(markup).toContain("convax-creation-toolbar-frame")
    expect(markup).toContain('aria-label="Add Text"')
    expect(markup).toContain('aria-label="Add Image"')
    expect(markup).toContain('aria-label="Add Video"')
    expect(markup).not.toContain('aria-label="Add Audio"')
    expect(markup).not.toContain('aria-label="Add Agent"')
    expect(buttonActions.get("Add node")).toBeFunction()
    expect(buttonActions.get("Upload")).toBeUndefined()
    expect(buttonActions.get("Generate")).toBeFunction()
    expect(buttonActions.get("Search")).toBeFunction()
  })

  test("routes top-toolbar Generate presentation to the host without opening Canvas's legacy overlay", () => {
    const onGenerateRequest = mock(() => undefined)
    renderEditor(
      createCanvasServices({
        generate: {
          describeTool: async (toolId) => ({ fields: [], toolId }),
          generate: async () => ({ createdNodeIds: [], revision: 0, toolId: "unused", warnings: [] }),
          listTools: async () => [],
        },
      }),
      { onGenerateRequest },
    )

    buttonActions.get("Generate")?.()

    expect(onGenerateRequest).toHaveBeenCalledTimes(1)
  })

  test("rejects generation re-entry instead of implicitly cancelling accepted work", async () => {
    const source = await Bun.file(new URL("./canvas-editor.tsx", import.meta.url)).text()

    expect(source).toContain("if (!generateService || readOnly || generationControllerRef.current) return")
    expect(source).not.toContain("generationControllerRef.current?.controller.abort()\n    setGenerating(true)")
    expect(source).toContain("props.onGenerationStateChange?.(true)")
    expect(source).toContain("props.onGenerationStateChange?.(false)")
  })

  test("keeps Search in the bottom-left viewport toolbar while restoring top creation tools", async () => {
    const source = await Bun.file(new URL("./canvas-editor.tsx", import.meta.url)).text()
    const markup = renderEditor()

    expect(markup).toContain("convax-viewport-toolbar bottom-3 left-3")
    expect(markup).toContain("convax-creation-toolbar-frame")
    expect(markup).toContain('aria-label="Canvas tools"')
    expect(source).toContain('className="convax-node-search__input"')
    expect(source).toContain('className="convax-node-search__backdrop"')
    expect(source).toContain('data-convax-node-search-panel="true"')
    expect(source).toContain("bindCanvasSearchDismissal({")
    expect(source).toContain("const searchResults = useMemo(")
    expect(source).toContain("searchOpen ? queryCanvasNodes(history.document")
    expect(source).toContain("[history.document, query, searchOpen]")
    expect(markup).not.toContain("<span>Search</span>")
    expect(buttonActions.get("Search")).toBeFunction()
    expect(buttonActions.get("Fit view")).toBeFunction()
    expect(buttonActions.get("Snap and alignment guides")).toBeFunction()
    expect(buttonActions.get("More canvas actions")).toBeFunction()
  })

  test("renders host appearance without producing an editor command", () => {
    const markup = renderEditor(createCanvasServices(), {
      appearance: {
        gridGap: 36,
        gridSize: 2,
        gridStyle: "lines",
        palette: {
          accent: "#7580e8",
          accentForeground: "#08090a",
          background: "#08090a",
          colorScheme: "dark",
          edge: "#34363d",
          edgeActive: "#8791ef",
          gridColor: "#292b31",
          nodeBackground: "#1c1c1f",
          nodeBorder: "#303137",
          surface: "#1c1c1f",
          text: "#f2f3f3",
          textMuted: "#8a8f98",
        },
      },
    })

    expect(markup).toContain('data-canvas-color-scheme="dark"')
    expect(renderedColorMode).toBe("dark")
    expect(renderedBackground).toMatchObject({
      color: "#292b314d",
      gap: 36,
      size: 2,
      variant: "lines",
    })
  })

  test("honors the host hidden-grid override without rendering a background", () => {
    renderEditor(createCanvasServices(), { appearance: { gridStyle: "none" } })

    expect(renderedBackground).toBeUndefined()
  })

  test("places the creation toolbar at safe top center without moving the viewport", async () => {
    const source = await Bun.file(new URL("./canvas-editor.tsx", import.meta.url)).text()

    expect(source).toContain('className="convax-creation-toolbar-frame"')
    expect(source).toContain('className="convax-creation-toolbar convax-tool-surface')
    expectViewportUnchanged()
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

    expect(contextMenuActions.get("Drag to Other Apps")).toBeFunction()
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
