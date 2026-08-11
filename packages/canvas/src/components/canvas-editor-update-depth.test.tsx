import { afterAll, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ButtonHTMLAttributes,
  type ReactNode,
  act,
  createRef,
  useLayoutEffect,
  useRef,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import type { CanvasRendererCollaborationClient, CanvasRendererCommand } from "../collaboration"
import type { CanvasEditorController } from "../editor-context"
import type { CanvasInspectorProjection, CanvasSelectionProjection } from "../inspector"
import type { CanvasFolderBrowseListing } from "../services"
import type { CanvasDocument, CanvasNode } from "../types"
import type { CanvasEditorHandle } from "./canvas-editor"

interface TestNodeDragEvent {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

interface ObservedReactFlowProps {
  elementsSelectable?: boolean
  nodes?: CanvasNode[]
  nodesConnectable?: boolean
  nodesDraggable?: boolean
  onNodeDoubleClick?: (event: unknown, node: CanvasNode) => void
  onNodeDragStart?: (event: TestNodeDragEvent, node: CanvasNode, draggedNodes: CanvasNode[]) => void
  onNodeDragStop?: () => void
  onNodesChange?: (
    changes: Array<{
      dimensions?: { height: number; width: number }
      id: string
      position?: { x: number; y: number }
      resizing?: boolean
      selected?: boolean
      type: string
    }>,
  ) => void
  panOnDrag?: boolean | number[]
  selectionOnDrag?: boolean
}

let EditorProbe: ComponentType | undefined
let feedbackCommits = 0
let observedEditor: CanvasEditorController | undefined
let observedReactFlowProps: ObservedReactFlowProps | undefined
const fitView = mock(async () => undefined)
const getViewport = mock(() => ({ x: 0, y: 0, zoom: 1 }))
const setViewport = mock(async () => undefined)
const zoomIn = mock(async () => undefined)
const zoomOut = mock(async () => undefined)
const zoomTo = mock(async () => undefined)

function Passthrough(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

mock.module("@convax/ui", () => ({
  Button: ({
    asChild: _asChild,
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean
    size?: string
    variant?: string
  }) => <button {...props}>{children}</button>,
  FolderGlyph: (props: { size?: string }) => (
    <span data-ui-folder-glyph="" data-ui-folder-glyph-size={props.size ?? "picker"} />
  ),
  ContextMenu: Passthrough,
  ContextMenuContent: Passthrough,
  ContextMenuItem: Passthrough,
  ContextMenuLabel: Passthrough,
  ContextMenuSeparator: () => null,
  ContextMenuTrigger: Passthrough,
  Input: () => <input />,
  Loading: (props: { className?: string; description?: ReactNode; label?: ReactNode; reducedMotion?: boolean }) => (
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
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  BaseEdge: () => null,
  EdgeLabelRenderer: Passthrough,
  Handle: (props: { children?: ReactNode }) => <div>{props.children}</div>,
  MiniMap: () => null,
  NodeResizer: (props: { isVisible?: boolean }) => (props.isVisible === false ? null : <div data-node-resizer />),
  NodeToolbar: (props: { children?: ReactNode; isVisible?: boolean }) => (
    <div data-node-toolbar data-visibility={props.isVisible === undefined ? "default" : String(props.isVisible)}>
      {props.children}
    </div>
  ),
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  ReactFlow: (
    props: ObservedReactFlowProps & {
      children?: ReactNode
    },
  ) => {
    observedReactFlowProps = {
      elementsSelectable: props.elementsSelectable,
      nodes: props.nodes,
      nodesConnectable: props.nodesConnectable,
      nodesDraggable: props.nodesDraggable,
      onNodeDoubleClick: props.onNodeDoubleClick,
      onNodeDragStart: props.onNodeDragStart,
      onNodeDragStop: props.onNodeDragStop,
      onNodesChange: props.onNodesChange,
      panOnDrag: props.panOnDrag,
      selectionOnDrag: props.selectionOnDrag,
    }
    return (
      <>
        {props.children}
        {EditorProbe ? <EditorProbe /> : null}
      </>
    )
  },
  ReactFlowProvider: Passthrough,
  SelectionMode: { Partial: "partial" },
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
  applyNodeChanges: (
    changes: Array<{
      dimensions?: { height: number; width: number }
      id: string
      position?: { x: number; y: number }
      selected?: boolean
      type: string
    }>,
    nodes: Array<{
      id: string
      measured?: { height: number; width: number }
      position: { x: number; y: number }
      selected?: boolean
    }>,
  ) =>
    nodes.map((node) => {
      const applicable = changes.filter((change) => change.id === node.id)
      return applicable.reduce(
        (current, change) =>
          change.type === "position" && change.position
            ? { ...current, position: change.position }
            : change.type === "dimensions" && change.dimensions
              ? { ...current, measured: change.dimensions }
              : change.type === "select"
                ? { ...current, selected: change.selected }
                : current,
        node,
      )
    }),
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
  useInternalNode: () => undefined,
  useReactFlow: () => ({
    fitView,
    getNodes: () => [],
    getViewport,
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    setCenter: async () => undefined,
    setViewport,
    zoomIn,
    zoomOut,
    zoomTo,
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

const { createCanvasDocument, createFolderNode, createGroupNode, createMediaNode, createTextNode } = await import(
  "../document"
)
const { getCanvasFolderFocusEntry } = await import("../directory-focus")
const { setCanvasGroupFolded } = await import("../group-fold")
const { createCanvasFileRendererRegistry } = await import("../file-renderer-registry")
const { useCanvasEditor } = await import("../editor-context")
const { createCanvasServices } = await import("../services")
const { CanvasEditor } = await import("./canvas-editor")

afterAll(() => {
  mock.restore()
})

class TestCanvasSession implements CanvasRendererCollaborationClient {
  readonly authority = "project-collaboration-application" as const
  readonly commands: CanvasRendererCommand[] = []
  readonly undoModel = "project-yjs-semantic-history" as const
  canUndoValue = false
  flushRequest: (signal?: AbortSignal) => Promise<void> = async () => undefined
  submitRequest: (command: CanvasRendererCommand) => Promise<void> = async () => undefined
  undoRequest: () => Promise<void> = async () => undefined
  private readonly listeners = new Set<() => void>()
  private readonly nodeIncarnations = new Map<string, string>()

  constructor(private projection: CanvasDocument) {
    for (const node of projection.nodes) this.nodeIncarnations.set(node.id, `incarnation-${node.id}`)
  }

  canRedo() {
    return false
  }

  canUndo() {
    return this.canUndoValue
  }

  flush(signal?: AbortSignal) {
    return this.flushRequest(signal)
  }

  getProjection() {
    return this.projection
  }

  publish(projection: CanvasDocument) {
    this.projection = projection
    for (const node of projection.nodes) {
      if (!this.nodeIncarnations.has(node.id)) this.nodeIncarnations.set(node.id, `incarnation-${node.id}`)
    }
    for (const listener of this.listeners) listener()
  }

  replaceNodeIncarnation(nodeId: string, incarnation: string) {
    this.nodeIncarnations.set(nodeId, incarnation)
  }

  async redo() {}

  resolveNodeEntity(nodeId: string) {
    const incarnation = this.nodeIncarnations.get(nodeId)
    return incarnation && this.projection.nodes.some((node) => node.id === nodeId)
      ? { kind: "node" as const, id: nodeId, incarnation }
      : undefined
  }

  async submit(command: CanvasRendererCommand) {
    this.commands.push(command)
    await this.submitRequest(command)
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  undo() {
    return this.undoRequest()
  }
}

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

class TestErrorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { error: Error | null }
> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
  }

  render() {
    return this.state.error ? <div data-testid="error">Canvas failed</div> : this.props.children
  }
}

/** Mimics a layout subscriber that commits when the provider refreshes without a semantic state change. */
function IdentityFeedbackProbe() {
  const editor = useCanvasEditor()
  const previousRef = useRef<CanvasEditorController | undefined>(undefined)

  useLayoutEffect(() => {
    const previous = previousRef.current
    previousRef.current = editor
    if (
      previous &&
      previous !== editor &&
      previous.document === editor.document &&
      previous.selection === editor.selection &&
      previous.readOnly === editor.readOnly &&
      previous.hydrating === editor.hydrating
    ) {
      feedbackCommits += 1
      editor.commit((document) => ({
        ...document,
        metadata: { ...document.metadata, title: `${document.metadata.title}.` },
      }))
    }
  }, [editor])

  return null
}

function EditorStateProbe() {
  observedEditor = useCanvasEditor()
  return null
}

function getObservedEditor() {
  return observedEditor
}

test("does not feed a selection-action refresh back into Canvas document updates", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = IdentityFeedbackProbe
  feedbackCommits = 0

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const initialDocument = createCanvasDocument({ title: "Stable" })

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor initialDocument={initialDocument} services={createCanvasServices()} />
        </TestErrorBoundary>,
      )
    })

    expect(errors).toEqual([])
    expect(feedbackCommits).toBe(0)
    expect(document.querySelector('[data-testid="error"]')).toBeNull()
  } finally {
    EditorProbe = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("switches Select and Hand modes through canvas shortcuts", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined
  observedReactFlowProps = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const interactionNode = createTextNode({
      id: "interaction-node",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const session = new TestCanvasSession(createCanvasDocument({ id: "interaction-tools", nodes: [interactionNode] }))
    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })

    const canvas = container.querySelector<HTMLElement>(".convax-canvas")
    expect(canvas?.dataset.canvasTool).toBe("select")
    expect(observedReactFlowProps).toMatchObject({
      elementsSelectable: true,
      nodesConnectable: true,
      nodesDraggable: true,
      panOnDrag: [1],
      selectionOnDrag: true,
    })
    await act(async () => {
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, interactionNode, [
        interactionNode,
      ])
      observedReactFlowProps?.onNodesChange?.([
        { id: interactionNode.id, position: { x: 16, y: 24 }, type: "position" },
        { dimensions: { height: 300, width: 400 }, id: interactionNode.id, type: "dimensions" },
        { id: interactionNode.id, selected: true, type: "select" },
      ])
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 16, y: 24 })
    expect(getObservedEditor()?.document.nodes[0]?.measured).toBeUndefined()
    expect(observedReactFlowProps?.nodes?.[0]?.measured).toEqual({ height: 300, width: 400 })
    expect([...(getObservedEditor()?.selection.nodeIds ?? [])]).toEqual([interactionNode.id])
    expect(session.getProjection().nodes[0]?.position).toEqual({ x: 0, y: 0 })
    expect(session.getProjection().nodes[0]?.measured).toBeUndefined()
    expect(session.getProjection().nodes[0]?.selected).toBeUndefined()
    expect(session.commands).toEqual([])

    await act(async () => {
      observedReactFlowProps?.onNodeDragStop?.()
      await Promise.resolve()
    })
    expect(session.commands).toEqual([
      {
        body: {
          updates: [
            {
              node: { kind: "node", id: interactionNode.id, incarnation: `incarnation-${interactionNode.id}` },
              position: { x: 16, y: 24 },
            },
          ],
        },
        format: "convax.canvas-renderer-command",
        kind: "canvas.nodes.set-geometry",
      },
    ])
    expect(session.commands[0]).not.toHaveProperty("expectedRevision")
    expect(session.getProjection().nodes[0]?.position).toEqual({ x: 0, y: 0 })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 16, y: 24 })
    await act(async () => {
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) => (node.id === interactionNode.id ? { ...node, position: { x: 16, y: 24 } } : node)),
      })
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 16, y: 24 })
    await act(async () => getObservedEditor()?.selectNodes([]))

    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "h" }))
    })
    expect(canvas?.dataset.canvasTool).toBe("hand")
    expect(observedReactFlowProps).toMatchObject({
      elementsSelectable: false,
      nodesConnectable: false,
      nodesDraggable: false,
      panOnDrag: true,
      selectionOnDrag: false,
    })
    await act(async () => {
      observedReactFlowProps?.onNodesChange?.([
        { id: interactionNode.id, position: { x: 160, y: 240 }, type: "position" },
        { dimensions: { height: 300, width: 400 }, id: interactionNode.id, type: "dimensions" },
        { id: interactionNode.id, selected: true, type: "select" },
      ])
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 16, y: 24 })
    expect(getObservedEditor()?.document.nodes[0]?.measured).toBeUndefined()
    expect(getObservedEditor()?.selection.nodeIds.size).toBe(0)
    expect(session.commands).toHaveLength(1)

    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "v" }))
    })
    expect(canvas?.dataset.canvasTool).toBe("select")

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))
    })
    expect(canvas?.classList.contains("is-space-panning")).toBeTrue()
    expect(observedReactFlowProps).toMatchObject({
      elementsSelectable: false,
      nodesConnectable: false,
      nodesDraggable: false,
      selectionOnDrag: false,
    })
    await act(async () => {
      observedReactFlowProps?.onNodesChange?.([
        { id: interactionNode.id, position: { x: 320, y: 480 }, type: "position" },
        { dimensions: { height: 600, width: 800 }, id: interactionNode.id, type: "dimensions" },
        { id: interactionNode.id, selected: true, type: "select" },
      ])
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 16, y: 24 })
    expect(getObservedEditor()?.document.nodes[0]?.measured).toBeUndefined()
    expect(getObservedEditor()?.selection.nodeIds.size).toBe(0)
    expect(session.commands).toHaveLength(1)
    await act(async () => {
      window.dispatchEvent(new Event("blur"))
    })
    expect(canvas?.classList.contains("is-space-panning")).toBeFalse()
    expect(observedReactFlowProps).toMatchObject({
      elementsSelectable: true,
      nodesConnectable: true,
      nodesDraggable: true,
      selectionOnDrag: true,
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))
    })
    expect(canvas?.classList.contains("is-space-panning")).toBeTrue()
    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(canvas?.classList.contains("is-space-panning")).toBeFalse()

    const input = container.querySelector<HTMLInputElement>('[data-canvas-resource-picker="upload"]')
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "h" }))
    })
    expect(canvas?.dataset.canvasTool).toBe("select")

    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "h" }))
    })
    expect(canvas?.dataset.canvasTool).toBe("hand")
  } finally {
    EditorProbe = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("reclaims Canvas focus during node drag so undo uses session history", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  observedReactFlowProps = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const textNode = createTextNode({
      id: "drag-focus-text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "Draft remains unchanged" },
    })
    const session = new TestCanvasSession(createCanvasDocument({ id: "drag-focus", nodes: [textNode] }))
    const undo = mock(async () => undefined)
    session.canUndoValue = true
    session.undoRequest = undo

    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })

    const canvas = container.querySelector<HTMLElement>(".convax-canvas")
    const textEditor = document.createElement("div")
    textEditor.contentEditable = "true"
    textEditor.textContent = "Draft remains unchanged"
    canvas?.append(textEditor)
    textEditor.focus()
    expect(document.activeElement).toBe(textEditor)

    await act(async () => {
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, textNode, [textNode])
    })
    expect(document.activeElement).toBe(canvas)

    await act(async () => {
      observedReactFlowProps?.onNodeDragStop?.()
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }))
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(canvas)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(textEditor.textContent).toBe("Draft remains unchanged")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps independently submitted image and video positions stable until each authority update arrives", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined
  observedReactFlowProps = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const image = createMediaNode({
      id: "optimistic-image",
      position: { x: 0, y: 0 },
      resource: { id: "image-resource", kind: "image", metadata: {}, state: { status: "ready" } },
    })
    const video = createMediaNode({
      id: "optimistic-video",
      position: { x: 400, y: 0 },
      resource: { id: "video-resource", kind: "video", metadata: {}, state: { status: "ready" } },
    })
    const session = new TestCanvasSession(createCanvasDocument({ id: "independent-geometry", nodes: [image, video] }))
    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })

    await act(async () => {
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, image, [image])
      observedReactFlowProps?.onNodesChange?.([{ id: image.id, position: { x: 80, y: 120 }, type: "position" }])
      observedReactFlowProps?.onNodeDragStop?.()
      await Promise.resolve()
    })
    expect(getObservedEditor()?.document.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 120 },
      { x: 400, y: 0 },
    ])

    await act(async () => {
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, video, [video])
      observedReactFlowProps?.onNodesChange?.([{ id: video.id, position: { x: 520, y: 160 }, type: "position" }])
      observedReactFlowProps?.onNodeDragStop?.()
      await Promise.resolve()
    })
    expect(getObservedEditor()?.document.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 120 },
      { x: 520, y: 160 },
    ])

    await act(async () => {
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) => (node.id === image.id ? { ...node, position: { x: 80, y: 120 } } : node)),
      })
    })
    expect(getObservedEditor()?.document.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 120 },
      { x: 520, y: 160 },
    ])

    await act(async () => {
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) => (node.id === video.id ? { ...node, position: { x: 520, y: 160 } } : node)),
      })
    })
    expect(getObservedEditor()?.document.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 120 },
      { x: 520, y: 160 },
    ])

    await act(async () => {
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, image, [image])
      observedReactFlowProps?.onNodesChange?.([{ id: image.id, position: { x: 160, y: 200 }, type: "position" }])
      observedReactFlowProps?.onNodeDragStop?.()
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, image, [image])
      observedReactFlowProps?.onNodesChange?.([{ id: image.id, position: { x: 240, y: 280 }, type: "position" }])
      observedReactFlowProps?.onNodeDragStop?.()
      await Promise.resolve()
    })
    await act(async () => {
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) => (node.id === image.id ? { ...node, position: { x: 160, y: 200 } } : node)),
      })
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 240, y: 280 })
    await act(async () => {
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) => (node.id === image.id ? { ...node, position: { x: 240, y: 280 } } : node)),
      })
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 240, y: 280 })

    await act(async () => {
      getObservedEditor()?.beginGesture()
      observedReactFlowProps?.onNodesChange?.([
        { dimensions: { height: 360, width: 640 }, id: video.id, resizing: true, type: "dimensions" },
      ])
      getObservedEditor()?.endGesture()
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, video, [video])
      observedReactFlowProps?.onNodesChange?.([{ id: video.id, position: { x: 640, y: 240 }, type: "position" }])
      observedReactFlowProps?.onNodeDragStop?.()
      await Promise.resolve()
    })
    expect(getObservedEditor()?.document.nodes[1]).toMatchObject({
      position: { x: 640, y: 240 },
      style: { height: 360, width: 640 },
    })
    await act(async () => {
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) =>
            node.id === video.id ? { ...node, style: { ...node.style, height: 360, width: 640 } } : node,
          ),
      })
    })
    expect(getObservedEditor()?.document.nodes[1]).toMatchObject({
      position: { x: 640, y: 240 },
      style: { height: 360, width: 640 },
    })
    await act(async () => {
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) => (node.id === video.id ? { ...node, position: { x: 640, y: 240 } } : node)),
      })
    })
    expect(getObservedEditor()?.document.nodes[1]).toMatchObject({
      position: { x: 640, y: 240 },
      style: { height: 360, width: 640 },
    })
    expect(session.commands).toHaveLength(6)
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    observedReactFlowProps = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("isolates a failed node geometry submission from another node still awaiting authority", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined
  observedReactFlowProps = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const image = createMediaNode({
      id: "failed-image-move",
      position: { x: 0, y: 0 },
      resource: { id: "failed-image-resource", kind: "image", metadata: {}, state: { status: "ready" } },
    })
    const video = createMediaNode({
      id: "pending-video-move",
      position: { x: 400, y: 0 },
      resource: { id: "pending-video-resource", kind: "video", metadata: {}, state: { status: "ready" } },
    })
    const session = new TestCanvasSession(
      createCanvasDocument({ id: "isolated-geometry-failure", nodes: [image, video] }),
    )
    let rejectImageSubmission: (reason: unknown) => void = () => undefined
    let resolveVideoSubmission: () => void = () => undefined
    const imageSubmission = new Promise<void>((_resolve, reject) => {
      rejectImageSubmission = reject
    })
    const videoSubmission = new Promise<void>((resolve) => {
      resolveVideoSubmission = resolve
    })
    session.submitRequest = (command) => {
      if (command.kind !== "canvas.nodes.set-geometry") return Promise.resolve()
      return command.body.updates[0]?.node.id === image.id ? imageSubmission : videoSubmission
    }
    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })

    await act(async () => {
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, image, [image])
      observedReactFlowProps?.onNodesChange?.([{ id: image.id, position: { x: 80, y: 120 }, type: "position" }])
      observedReactFlowProps?.onNodeDragStop?.()
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, video, [video])
      observedReactFlowProps?.onNodesChange?.([{ id: video.id, position: { x: 520, y: 160 }, type: "position" }])
      observedReactFlowProps?.onNodeDragStop?.()
    })
    expect(getObservedEditor()?.document.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 120 },
      { x: 520, y: 160 },
    ])

    await act(async () => {
      rejectImageSubmission(new Error("image geometry rejected"))
      await imageSubmission.catch(() => undefined)
      await Promise.resolve()
    })
    expect(getObservedEditor()?.document.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 520, y: 160 },
    ])

    await act(async () => {
      resolveVideoSubmission()
      await videoSubmission
      session.publish({
        ...session.getProjection(),
        nodes: session
          .getProjection()
          .nodes.map((node) => (node.id === video.id ? { ...node, position: { x: 520, y: 160 } } : node)),
      })
    })
    expect(getObservedEditor()?.document.nodes[1]?.position).toEqual({ x: 520, y: 160 })
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    observedReactFlowProps = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps expanded Group measurements transient and protects folded presentation measurements", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined
  observedReactFlowProps = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const expanded = createGroupNode({
      height: 360,
      id: "expanded-group",
      position: { x: 40, y: 60 },
      width: 520,
    })
    const expandedSession = new TestCanvasSession(
      createCanvasDocument({ id: "expanded-group-measurement", nodes: [expanded] }),
    )

    await act(async () => {
      root?.render(
        <CanvasEditor
          key="expanded-group"
          services={createCanvasServices()}
          session={expandedSession}
        />,
      )
    })
    await act(async () => {
      observedReactFlowProps?.onNodesChange?.([
        { dimensions: { height: 420, width: 640 }, id: expanded.id, type: "dimensions" },
      ])
    })
    expect(observedReactFlowProps?.nodes?.[0]?.measured).toEqual({ height: 420, width: 640 })
    expect(getObservedEditor()?.document.nodes[0]).not.toHaveProperty("measured")
    expect(expandedSession.getProjection().nodes[0]).not.toHaveProperty("measured")
    expect(expandedSession.commands).toEqual([])

    const foldedDocument = setCanvasGroupFolded(
      createCanvasDocument({ id: "folded-group-measurement", nodes: [expanded] }),
      expanded.id,
      true,
    )
    const foldedSession = new TestCanvasSession(foldedDocument)
    await act(async () => {
      root?.render(
        <CanvasEditor key="folded-group" services={createCanvasServices()} session={foldedSession} />,
      )
    })
    await act(async () => {
      observedReactFlowProps?.onNodesChange?.([
        { dimensions: { height: 160, width: 200 }, id: expanded.id, type: "dimensions" },
      ])
    })
    expect(observedReactFlowProps?.nodes?.[0]).not.toHaveProperty("measured")
    expect(getObservedEditor()?.document.nodes[0]).not.toHaveProperty("measured")
    expect(foldedSession.getProjection().nodes[0]).not.toHaveProperty("measured")
    expect(foldedSession.commands).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    observedReactFlowProps = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("treats a folded Group as one node and hides child arrangement controls", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const group = createGroupNode({
      height: 360,
      id: "folded-group",
      position: { x: 40, y: 60 },
      width: 520,
    })
    const first = {
      ...createTextNode({
        id: "first-child",
        metadata: {},
        position: { x: 40, y: 50 },
        resourceState: { status: "ready" },
      }),
      parentId: group.id,
    }
    const second = {
      ...createTextNode({
        id: "second-child",
        metadata: {},
        position: { x: 300, y: 50 },
        resourceState: { status: "ready" },
      }),
      parentId: group.id,
    }
    const foldedDocument = setCanvasGroupFolded(
      createCanvasDocument({ id: "folded-group-menu", nodes: [group, first, second] }),
      group.id,
      true,
    )
    const session = new TestCanvasSession(foldedDocument)

    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })
    await act(async () => {
      observedReactFlowProps?.onNodesChange?.([{ id: group.id, selected: true, type: "select" }])
    })

    expect(container.querySelector('button[aria-label="Unfold"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="Align and arrange"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Tidy up"]')).toBeNull()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("double-clicks a Project folder into a read-only transient Canvas focus", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  fitView.mockClear()

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const folder = createFolderNode({
      id: "project-folder",
      position: { x: 40, y: 60 },
      resource: {
        id: "project-folder",
        kind: "folder",
        metadata: {},
        name: "Design",
        state: { status: "ready" },
      },
    })
    const listings = new Map<string | undefined, CanvasFolderBrowseListing>([
      [
        undefined,
        {
          entries: [
            { id: "Design/References", kind: "folder", label: "References" },
            { id: "Design/brief.pdf", kind: "file", label: "brief.pdf" },
          ],
          path: [{ id: "Design", label: "Design" }],
          totalCount: 2,
          truncated: false,
        },
      ],
      [
        "Design",
        {
          entries: [
            { id: "Design/References", kind: "folder", label: "References" },
            { id: "Design/brief.pdf", kind: "file", label: "brief.pdf" },
          ],
          path: [{ id: "Design", label: "Design" }],
          totalCount: 2,
          truncated: false,
        },
      ],
      [
        "Design/References",
        {
          entries: [],
          path: [
            { id: "Design", label: "Design" },
            { id: "Design/References", label: "References" },
          ],
          totalCount: 0,
          truncated: false,
        },
      ],
    ])
    const list = mock(async ({ directoryId }: { directoryId?: string }) => listings.get(directoryId)!)

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({ id: "folder-focus", nodes: [folder] })}
          services={createCanvasServices({ folderBrowse: { list } })}
        />,
      )
    })

    await act(async () => {
      observedReactFlowProps?.onNodeDoubleClick?.({}, folder)
      await Promise.resolve()
    })
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ ownerNodeId: folder.id }))
    expect(observedReactFlowProps?.nodes).toHaveLength(2)
    expect(observedReactFlowProps?.nodes?.every((node) => getCanvasFolderFocusEntry(node))).toBe(true)
    expect(observedReactFlowProps).toMatchObject({
      elementsSelectable: false,
      nodesConnectable: false,
      nodesDraggable: false,
    })
    expect(getObservedEditor()?.document.nodes).toEqual([folder])
    expect(getObservedEditor()?.document).toEqual(createCanvasDocument({ id: "folder-focus", nodes: [folder] }))
    expect(container.querySelector('[aria-label="Canvas path"]')?.textContent).toContain("CanvasDesign")

    const nestedFolder = observedReactFlowProps?.nodes?.find(
      (node) => getCanvasFolderFocusEntry(node)?.kind === "folder",
    )
    await act(async () => {
      if (nestedFolder) observedReactFlowProps?.onNodeDoubleClick?.({}, nestedFolder)
      await Promise.resolve()
    })
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ directoryId: "Design/References", ownerNodeId: folder.id }),
    )
    expect(observedReactFlowProps?.nodes).toEqual([])
    expect(container.querySelector('[aria-label="Canvas path"]')?.textContent).toContain("CanvasDesignReferences")
    expect(container.querySelector('[data-canvas-folder-focus-state="empty"]')).not.toBeNull()

    const canvas = container.querySelector<HTMLElement>(".convax-canvas")
    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observedReactFlowProps?.nodes).toHaveLength(2)
    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observedReactFlowProps?.nodes?.map((node) => node.id)).toEqual([folder.id])
    expect(container.querySelector('[aria-label="Canvas path"]')).toBeNull()
    expect(fitView).toHaveBeenCalled()
  } finally {
    EditorProbe = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("ignores a stale folder listing when a later subdirectory wins", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const folder = createFolderNode({
      id: "project-folder",
      position: { x: 0, y: 0 },
      resource: {
        id: "project-folder",
        kind: "folder",
        metadata: {},
        name: "Design",
        state: { status: "ready" },
      },
    })
    const rootListing: CanvasFolderBrowseListing = {
      entries: [
        { id: "Design/A", kind: "folder", label: "A" },
        { id: "Design/B", kind: "folder", label: "B" },
      ],
      path: [{ id: "Design", label: "Design" }],
      totalCount: 2,
      truncated: false,
    }
    let resolveA!: (listing: CanvasFolderBrowseListing) => void
    const pendingA = new Promise<CanvasFolderBrowseListing>((resolve) => {
      resolveA = resolve
    })
    const list = mock(async ({ directoryId }: { directoryId?: string }) => {
      if (!directoryId) return rootListing
      if (directoryId === "Design/A") return pendingA
      return {
        entries: [{ id: "Design/B/winner.txt", kind: "file" as const, label: "winner.txt" }],
        path: [
          { id: "Design", label: "Design" },
          { id: "Design/B", label: "B" },
        ],
        totalCount: 1,
        truncated: false,
      }
    })

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({ id: "stale-folder-focus", nodes: [folder] })}
          services={createCanvasServices({ folderBrowse: { list } })}
        />,
      )
    })
    await act(async () => {
      observedReactFlowProps?.onNodeDoubleClick?.({}, folder)
      await Promise.resolve()
    })
    const projected = observedReactFlowProps?.nodes ?? []
    const folderA = projected.find((node) => node.data.label === "A")
    const folderB = projected.find((node) => node.data.label === "B")
    expect(folderA).toBeDefined()
    expect(folderB).toBeDefined()

    await act(async () => {
      if (folderA) observedReactFlowProps?.onNodeDoubleClick?.({}, folderA)
      if (folderB) observedReactFlowProps?.onNodeDoubleClick?.({}, folderB)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(observedReactFlowProps?.nodes?.map((node) => node.data.label)).toEqual(["winner.txt"])

    await act(async () => {
      resolveA({
        entries: [{ id: "Design/A/stale.txt", kind: "file", label: "stale.txt" }],
        path: [
          { id: "Design", label: "Design" },
          { id: "Design/A", label: "A" },
        ],
        totalCount: 1,
        truncated: false,
      })
      await Promise.resolve()
    })
    expect(observedReactFlowProps?.nodes?.map((node) => node.data.label)).toEqual(["winner.txt"])
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps measured and resize preview state in React Flow and submits one closed size intent", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined
  observedReactFlowProps = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const node = createTextNode({
      id: "resize-node",
      metadata: {},
      position: { x: 10, y: 20 },
      resourceState: { status: "ready" },
    })
    const session = new TestCanvasSession(createCanvasDocument({ id: "resize-preview", nodes: [node] }))
    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })

    await act(async () => {
      observedReactFlowProps?.onNodesChange?.([
        { dimensions: { height: 220, width: 350 }, id: node.id, type: "dimensions" },
      ])
    })
    expect(observedReactFlowProps?.nodes?.[0]?.measured).toEqual({ height: 220, width: 350 })
    expect(getObservedEditor()?.document.nodes[0]).not.toHaveProperty("measured")
    expect(session.getProjection().nodes[0]).not.toHaveProperty("measured")
    expect(session.commands).toEqual([])

    await act(async () => {
      getObservedEditor()?.beginGesture()
      observedReactFlowProps?.onNodesChange?.([
        { dimensions: { height: 300, width: 400 }, id: node.id, resizing: true, type: "dimensions" },
      ])
    })
    expect(getObservedEditor()?.document.nodes[0]?.style).toMatchObject({ height: 300, width: 400 })
    expect(getObservedEditor()?.document.nodes[0]).not.toHaveProperty("measured")
    expect(session.commands).toEqual([])

    await act(async () => {
      getObservedEditor()?.endGesture()
      await Promise.resolve()
    })
    expect(session.commands).toEqual([
      {
        body: {
          updates: [
            {
              node: { kind: "node", id: node.id, incarnation: `incarnation-${node.id}` },
              position: { x: 10, y: 20 },
              size: { height: 300, width: 400 },
            },
          ],
        },
        format: "convax.canvas-renderer-command",
        kind: "canvas.nodes.set-geometry",
      },
    ])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    observedReactFlowProps = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("drops a drag preview instead of submitting it to a replacement node incarnation", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined
  observedReactFlowProps = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const node = createTextNode({
      id: "recreated-node",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const session = new TestCanvasSession(createCanvasDocument({ id: "incarnation-guard", nodes: [node] }))
    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })

    await act(async () => {
      observedReactFlowProps?.onNodeDragStart?.({ altKey: false, ctrlKey: false, metaKey: false }, node, [node])
      observedReactFlowProps?.onNodesChange?.([{ id: node.id, position: { x: 50, y: 60 }, type: "position" }])
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 50, y: 60 })

    session.replaceNodeIncarnation(node.id, "replacement-incarnation")
    await act(async () => {
      observedReactFlowProps?.onNodeDragStop?.()
      await Promise.resolve()
    })
    expect(session.commands).toEqual([])
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 0, y: 0 })
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    observedReactFlowProps = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("uses zero-duration viewport commands when reduced motion is preferred", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  fitView.mockClear()
  setViewport.mockClear()
  zoomIn.mockClear()
  zoomOut.mockClear()

  try {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        addEventListener: () => undefined,
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        removeEventListener: () => undefined,
      }),
    })
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({
            id: "reduced-motion",
            nodes: [
              createTextNode({
                id: "motion-node",
                metadata: {},
                position: { x: 0, y: 0 },
                resourceState: { status: "ready" },
              }),
            ],
          })}
          services={createCanvasServices()}
        />,
      )
    })

    const zoomInButton = container.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')
    const zoomOutButton = container.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')
    expect(zoomInButton).not.toBeNull()
    expect(zoomOutButton).not.toBeNull()
    await act(async () => {
      zoomInButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      zoomOutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(zoomIn).toHaveBeenCalledWith({
      duration: 0,
      ease: expect.any(Function),
      interpolate: "smooth",
    })
    expect(zoomOut).toHaveBeenCalledWith({
      duration: 0,
      ease: expect.any(Function),
      interpolate: "smooth",
    })
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("animates zoom presets around the visible viewport center", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  getViewport.mockClear()
  setViewport.mockClear()
  zoomTo.mockClear()
  getViewport.mockImplementation(() => ({ x: -200, y: 100, zoom: 1 }))

  try {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        addEventListener: () => undefined,
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        removeEventListener: () => undefined,
      }),
    })
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({
            id: "centered-zoom",
            nodes: [
              createTextNode({
                id: "zoom-node",
                metadata: {},
                position: { x: 0, y: 0 },
                resourceState: { status: "ready" },
              }),
            ],
          })}
          services={createCanvasServices()}
        />,
      )
    })

    const canvas = container.querySelector<HTMLElement>(".convax-canvas")
    expect(canvas).not.toBeNull()
    Object.defineProperty(canvas!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 600, width: 800 }),
    })
    const zoomTrigger = container.querySelector<HTMLButtonElement>(".convax-zoom-trigger")
    await act(async () => zoomTrigger?.click())
    const zoomPreset = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.trim() === "200%",
    )
    expect(zoomPreset).not.toBeUndefined()
    await act(async () => zoomPreset?.click())

    expect(setViewport).toHaveBeenCalledWith(
      { x: -800, y: -100, zoom: 2 },
      {
        duration: 300,
        ease: expect.any(Function),
        interpolate: "smooth",
      },
    )
    expect(zoomTo).not.toHaveBeenCalled()
  } finally {
    getViewport.mockImplementation(() => ({ x: 0, y: 0, zoom: 1 }))
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("authoritative reload retries a failed collaboration flush without replacing the current projection", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const initialDocument = createCanvasDocument({ id: "authoritative-retry", title: "Initial" })
    const authoritativeDocument = createCanvasDocument({ id: initialDocument.id, title: "Authoritative" })
    const failure = new Error("First authoritative load failed")
    const session = new TestCanvasSession(initialDocument)
    let flushAttempt = 0
    session.flushRequest = async () => {
      flushAttempt += 1
      if (flushAttempt === 1) throw failure
      session.publish(authoritativeDocument)
    }
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor ref={editorRef} services={createCanvasServices()} session={session} />
        </TestErrorBoundary>,
      )
    })
    expect(observedEditor).toMatchObject({ hydrating: false, readOnly: false })

    let rejected: unknown
    await act(async () => {
      try {
        await editorRef.current?.reloadAuthoritative()
      } catch (error) {
        rejected = error
      }
    })
    expect(rejected).toBe(failure)
    expect(observedEditor).toMatchObject({
      document: { metadata: { title: "Initial" } },
      hydrating: false,
      readOnly: false,
    })
    expect(container.textContent).not.toContain(failure.message)

    await act(async () => {
      await editorRef.current?.reloadAuthoritative()
    })

    expect(observedEditor).toMatchObject({
      document: { metadata: { title: "Authoritative" } },
      hydrating: false,
      readOnly: false,
    })
    expect(container.textContent).not.toContain(failure.message)
    expect(flushAttempt).toBe(2)
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps the current projection visible while an authoritative collaboration flush is pending", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const initialDocument = createCanvasDocument({ id: "background-authoritative-reload", title: "Initial" })
    const authoritativeDocument = {
      ...initialDocument,
      metadata: { ...initialDocument.metadata, title: "Authoritative" },
    }
    let resolveReload!: (document: typeof authoritativeDocument) => void
    const pendingReload = new Promise<typeof authoritativeDocument>((resolve) => {
      resolveReload = resolve
    })
    const session = new TestCanvasSession(initialDocument)
    session.flushRequest = async () => session.publish(await pendingReload)
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor ref={editorRef} services={createCanvasServices()} session={session} />
        </TestErrorBoundary>,
      )
    })
    expect(container.textContent).not.toContain("Loading canvas…")

    let reload: Promise<void> | undefined
    await act(async () => {
      reload = editorRef.current?.reloadAuthoritative()
      await Promise.resolve()
    })

    expect(observedEditor).toMatchObject({
      document: { metadata: { title: "Initial" } },
      hydrating: false,
      readOnly: false,
    })
    expect(container.textContent).not.toContain("Loading canvas…")

    await act(async () => {
      resolveReload(authoritativeDocument)
      await Promise.resolve()
    })
    await reload

    expect(observedEditor).toMatchObject({
      document: { metadata: { title: "Authoritative" } },
      hydrating: false,
      readOnly: false,
    })
    expect(container.textContent).not.toContain("Loading canvas…")
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("imperative insertion cannot turn an initialDocument preview into durable state", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const existing = createTextNode({
      id: "existing",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const initialDocument = createCanvasDocument({
      id: "imperative-insertion",
      nodes: [existing],
      title: "Insertion",
    })
    const create = mock(({ position }) =>
      createTextNode({ id: "inserted", metadata: {}, position, resourceState: { status: "ready" } }),
    )
    const fileRendererRegistry = createCanvasFileRendererRegistry([
      {
        component: () => null,
        create,
        id: "test.renderer",
        label: "Test renderer",
        matches: (data) => data.kind === "test.renderer",
      },
    ])
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            fileRendererRegistry={fileRendererRegistry}
            initialDocument={initialDocument}
            ref={editorRef}
            services={createCanvasServices()}
          />
        </TestErrorBoundary>,
      )
    })

    let insertedNodeId: string | undefined
    await act(async () => {
      insertedNodeId = editorRef.current?.insertNode("test.renderer")
    })
    const editorAfterInsertion = getObservedEditor()
    expect(insertedNodeId).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
    expect(editorAfterInsertion?.document).toEqual(initialDocument)
    expect(editorAfterInsertion?.selection.nodeIds.size).toBe(0)

    await act(async () => {
      await editorRef.current?.flush()
    })

    let missingNodeId: string | undefined = "unexpected"
    await act(async () => {
      missingNodeId = editorRef.current?.insertNode("missing.renderer")
    })
    expect(missingNodeId).toBeUndefined()
    expect(getObservedEditor()?.document.nodes).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("imperative insertion fails safely when the editor is read-only", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const create = mock(({ position }) =>
      createTextNode({ id: "must-not-exist", metadata: {}, position, resourceState: { status: "ready" } }),
    )
    const fileRendererRegistry = createCanvasFileRendererRegistry([
      {
        component: () => null,
        create,
        id: "test.read-only-renderer",
        label: "Read-only renderer",
        matches: (data) => data.kind === "test.read-only-renderer",
      },
    ])
    const initialDocument = createCanvasDocument({ id: "read-only-insertion" })
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            fileRendererRegistry={fileRendererRegistry}
            initialDocument={initialDocument}
            readOnly
            ref={editorRef}
            services={createCanvasServices()}
          />
        </TestErrorBoundary>,
      )
    })

    let insertedNodeId: string | undefined = "unexpected"
    await act(async () => {
      insertedNodeId = editorRef.current?.insertNode("test.read-only-renderer")
    })
    expect(insertedNodeId).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
    expect(getObservedEditor()?.document.nodes).toEqual([])
    expect(getObservedEditor()?.selection.nodeIds.size).toBe(0)
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("imperative commands open Canvas-owned search and generation surfaces", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            initialDocument={createCanvasDocument({ id: "imperative-surfaces" })}
            ref={editorRef}
            services={createCanvasServices({
              generate: {
                describeTool: async (toolId) => ({ fields: [], toolId }),
                generate: async () => ({ createdNodeIds: [], toolId: "unused", warnings: [] }),
                listTools: async () => [],
              },
            })}
          />
        </TestErrorBoundary>,
      )
    })

    expect(container.querySelector('[aria-label="Search nodes"]')).toBeNull()
    expect(container.textContent).not.toContain("No supported context or reference nodes selected.")
    fitView.mockClear()
    setViewport.mockClear()
    zoomIn.mockClear()
    zoomOut.mockClear()
    zoomTo.mockClear()

    await act(async () => editorRef.current?.openSearch())
    expect(container.querySelector('[aria-label="Search nodes"]')).not.toBeNull()

    await act(async () => {
      editorRef.current?.openGenerate()
      await Promise.resolve()
    })
    const canvasRoot = container.querySelector<HTMLElement>(".convax-canvas")
    const generationOverlay = container.querySelector<HTMLElement>('[data-canvas-composer-overlay="generation"]')
    const generationSurface = generationOverlay?.closest(".convax-canvas-composer-overlay")
    expect(generationOverlay).not.toBeNull()
    expect(generationSurface?.parentElement).toBe(canvasRoot)
    expect(container.textContent).toContain("No supported context or reference nodes selected.")
    expect(fitView).not.toHaveBeenCalled()
    expect(setViewport).not.toHaveBeenCalled()
    expect(zoomIn).not.toHaveBeenCalled()
    expect(zoomOut).not.toHaveBeenCalled()
    expect(zoomTo).not.toHaveBeenCalled()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close generation composer"]')?.click()
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-canvas-composer-overlay="generation"]')?.closest('[data-canvas-presence="exit"]'),
    ).not.toBeNull()
    expect(document.activeElement).toBe(canvasRoot)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220))
    })
    expect(container.querySelector('[data-canvas-composer-overlay="generation"]')).toBeNull()
    expect(errors).toEqual([])
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("publishes scope-safe selection without restoring the removed Inspector action", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const node = createTextNode({
      id: "inspectable",
      metadata: { privateValue: "hidden" },
      position: { x: 20, y: 40 },
      resourceState: { status: "ready", url: "asset://hidden" },
    })
    const initialDocument = createCanvasDocument({ id: "projection", nodes: [node] })
    const projections: CanvasSelectionProjection[] = []
    const inspectorRequests: CanvasInspectorProjection[] = []

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            initialDocument={initialDocument}
            onInspectorRequest={(projection) => inspectorRequests.push(projection)}
            onSelectionProjectionChange={(projection) => projections.push(projection)}
            services={createCanvasServices()}
            viewId="primary"
            viewScopeId="project-a/projection"
          />
        </TestErrorBoundary>,
      )
    })
    expect(projections.at(-1)).toEqual({
      documentId: "projection",
      inspector: null,
      kind: "none",
      nodeIds: [],
      scopeId: "project-a/projection",
      viewId: "primary",
    })

    await act(async () => getObservedEditor()?.selectNodes([node.id]))
    expect(projections.at(-1)).toMatchObject({
      inspector: { nodeId: node.id },
      kind: "single-node",
      nodeIds: [node.id],
      scopeId: "project-a/projection",
    })
    expect(
      getObservedEditor()?.visibleSelectionActions.some((action) => action.id === "canvas.inspector.open"),
    ).toBeFalse()
    expect(inspectorRequests).toEqual([])

    await act(async () => getObservedEditor()?.selectNodes([]))
    expect(projections.at(-1)).toMatchObject({ inspector: null, kind: "none", nodeIds: [] })
    expect(inspectorRequests).toEqual([])
    expect(getObservedEditor()?.document).toEqual(initialDocument)
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps viewport commands transient instead of changing the Canvas projection", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined
  fitView.mockClear()
  setViewport.mockClear()

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const initialDocument = createCanvasDocument({ id: "viewport-transient" })

    await act(async () => {
      root?.render(<CanvasEditor initialDocument={initialDocument} services={createCanvasServices()} />)
    })

    expect(getObservedEditor()?.document).toEqual(initialDocument)
    fitView.mockClear()
    setViewport.mockClear()
    zoomIn.mockClear()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click()
    })

    expect(zoomIn).toHaveBeenCalledTimes(1)
    expect(getObservedEditor()?.document).toEqual(initialDocument)
    expect(fitView).not.toHaveBeenCalled()
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("dismisses the zoom menu with Escape and restores trigger focus", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({
            id: "zoom-menu-escape",
            nodes: [
              createTextNode({
                id: "visible",
                metadata: {},
                position: { x: 0, y: 0 },
                resourceState: { status: "ready" },
              }),
            ],
          })}
          services={createCanvasServices()}
        />,
      )
    })

    const trigger = container.querySelector<HTMLButtonElement>(".convax-zoom-trigger")
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger?.focus()
      trigger?.click()
    })
    expect(container.querySelector(".convax-zoom-menu[role='menu']")).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    })

    expect(container.querySelector(".convax-zoom-menu[role='menu']")).toBeNull()
    expect(document.activeElement?.classList.contains("convax-zoom-trigger") ?? false).toBeTrue()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("navigates the top creation menu by keyboard and restores its trigger on Escape", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const session = new TestCanvasSession(createCanvasDocument({ id: "creation-menu-keyboard" }))

    await act(async () => {
      root?.render(<CanvasEditor services={createCanvasServices()} session={session} />)
    })

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Add node"]')
    const menu = container.querySelector<HTMLElement>(".convax-canvas-create-menu")
    expect(trigger).not.toBeNull()
    expect(menu?.hidden).toBeTrue()

    await act(async () => {
      trigger?.focus()
      trigger?.click()
    })
    expect(menu?.hidden).toBeFalse()

    const text = menu?.querySelector<HTMLButtonElement>('button[aria-label="Add Text"]')
    text?.focus()
    await act(async () => {
      text?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }))
    })
    expect((document.activeElement as HTMLElement | null)?.getAttribute("aria-label")).toBe("Add Image")

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    })
    expect(menu?.hidden).toBeTrue()
    expect(document.activeElement).toBe(trigger)
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
