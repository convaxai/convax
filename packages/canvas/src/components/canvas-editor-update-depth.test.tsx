import { expect, mock, test } from "bun:test"
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
import type { CanvasEditorController } from "../editor-context"
import type { CanvasInspectorProjection, CanvasSelectionProjection } from "../inspector"
import type { CanvasEditorHandle } from "./canvas-editor"

let EditorProbe: ComponentType | undefined
let feedbackCommits = 0
let observedEditor: CanvasEditorController | undefined
let observedReactFlowProps:
  | {
      elementsSelectable?: boolean
      nodesConnectable?: boolean
      nodesDraggable?: boolean
      onNodesChange?: (
        changes: Array<{
          dimensions?: { height: number; width: number }
          id: string
          position?: { x: number; y: number }
          selected?: boolean
          type: string
        }>,
      ) => void
      panOnDrag?: boolean | number[]
      selectionOnDrag?: boolean
    }
  | undefined
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
  ContextMenu: Passthrough,
  ContextMenuContent: Passthrough,
  ContextMenuItem: Passthrough,
  ContextMenuLabel: Passthrough,
  ContextMenuSeparator: () => null,
  ContextMenuTrigger: Passthrough,
  Input: () => <input />,
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
  ReactFlow: (props: {
    children?: ReactNode
    elementsSelectable?: boolean
    nodesConnectable?: boolean
    nodesDraggable?: boolean
    onNodesChange?: (
      changes: Array<{
        dimensions?: { height: number; width: number }
        id: string
        position?: { x: number; y: number }
        selected?: boolean
        type: string
      }>,
    ) => void
    panOnDrag?: boolean | number[]
    selectionOnDrag?: boolean
  }) => {
    observedReactFlowProps = props
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

const { createCanvasDocument, createTextNode } = await import("../document")
const { createCanvasFileRendererRegistry } = await import("../file-renderer-registry")
const { useCanvasEditor } = await import("../editor-context")
const { createCanvasServices } = await import("../services")
const { CanvasEditor } = await import("./canvas-editor")

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

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({ id: "interaction-tools", nodes: [interactionNode] })}
          services={createCanvasServices()}
        />,
      )
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
      observedReactFlowProps?.onNodesChange?.([
        { id: interactionNode.id, position: { x: 16, y: 24 }, type: "position" },
      ])
    })
    expect(getObservedEditor()?.document.nodes[0]?.position).toEqual({ x: 16, y: 24 })

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

test("authoritative reload clears a prior load error and resolves after the writable controller renders", async () => {
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
    const authoritativeDocument = {
      ...createCanvasDocument({ id: initialDocument.id, title: "Authoritative" }),
      revision: 1,
    }
    const failure = new Error("First authoritative load failed")
    let loadAttempt = 0
    const load = mock(async () => {
      loadAttempt += 1
      if (loadAttempt === 1) return initialDocument
      if (loadAttempt === 2) throw failure
      return authoritativeDocument
    })
    const save = mock(async (document) => document)
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            initialDocument={initialDocument}
            ref={editorRef}
            services={createCanvasServices({ persistence: { load, save } })}
          />
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
    expect(observedEditor).toMatchObject({ hydrating: false, readOnly: true })
    expect(container.textContent).toContain(failure.message)

    let revisionAtResolution = -1
    let retry: Promise<void> | undefined
    await act(async () => {
      retry = editorRef.current?.reloadAuthoritative()
      await Promise.resolve()
    })
    await retry
    revisionAtResolution = (observedEditor as CanvasEditorController | undefined)?.document.revision ?? -1

    expect(revisionAtResolution).toBe(1)
    expect(observedEditor).toMatchObject({
      document: { metadata: { title: "Authoritative" }, revision: 1 },
      hydrating: false,
      readOnly: false,
    })
    expect(container.textContent).not.toContain(failure.message)
    expect(save).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps an existing Canvas visible while an authoritative document reload is pending", async () => {
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
      revision: 1,
    }
    let loadAttempt = 0
    let resolveReload!: (document: typeof authoritativeDocument) => void
    const pendingReload = new Promise<typeof authoritativeDocument>((resolve) => {
      resolveReload = resolve
    })
    const load = mock(async () => {
      loadAttempt += 1
      if (loadAttempt === 1) return initialDocument
      return pendingReload
    })
    const save = mock(async (document) => document)
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            initialDocument={initialDocument}
            ref={editorRef}
            services={createCanvasServices({ persistence: { load, save } })}
          />
        </TestErrorBoundary>,
      )
    })
    expect(container.textContent).not.toContain("Loading canvas…")

    let reload: Promise<void> | undefined
    await act(async () => {
      reload = editorRef.current?.reloadAuthoritative()
      await Promise.resolve()
    })

    expect(observedEditor).toMatchObject({ hydrating: true, readOnly: true })
    expect(container.textContent).not.toContain("Loading canvas…")

    await act(async () => {
      resolveReload(authoritativeDocument)
      await Promise.resolve()
    })
    await reload

    expect(observedEditor).toMatchObject({
      document: { metadata: { title: "Authoritative" }, revision: 1 },
      hydrating: false,
      readOnly: false,
    })
    expect(container.textContent).not.toContain("Loading canvas…")
    expect(save).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("imperative insertion reuses registered renderer placement, selection, and persistence", async () => {
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
    const fileRendererRegistry = createCanvasFileRendererRegistry([
      {
        component: () => null,
        create: ({ position }) =>
          createTextNode({ id: "inserted", metadata: {}, position, resourceState: { status: "ready" } }),
        id: "test.renderer",
        label: "Test renderer",
        matches: (data) => data.kind === "test.renderer",
      },
    ])
    const load = mock(async () => initialDocument)
    const save = mock(async (document) => document)
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            fileRendererRegistry={fileRendererRegistry}
            initialDocument={initialDocument}
            ref={editorRef}
            services={createCanvasServices({ persistence: { load, save } })}
          />
        </TestErrorBoundary>,
      )
    })

    let insertedNodeId: string | undefined
    await act(async () => {
      insertedNodeId = editorRef.current?.insertNode("test.renderer")
    })
    const editorAfterInsertion = getObservedEditor()
    expect(insertedNodeId).toBe("inserted")
    expect(editorAfterInsertion?.document.nodes).toHaveLength(2)
    expect(editorAfterInsertion?.document.nodes.find((node) => node.id === "inserted")).toMatchObject({
      data: { kind: "test.renderer" },
      position: { x: 304, y: 0 },
      type: "file",
    })
    expect([...(editorAfterInsertion?.selection.nodeIds ?? [])]).toEqual(["inserted"])

    await act(async () => {
      await editorRef.current?.flush()
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      nodes: [{ id: "existing" }, { data: { kind: "test.renderer" }, id: "inserted", position: { x: 304, y: 0 } }],
      revision: 1,
    })

    let missingNodeId: string | undefined = "unexpected"
    await act(async () => {
      missingNodeId = editorRef.current?.insertNode("missing.renderer")
    })
    expect(missingNodeId).toBeUndefined()
    expect(getObservedEditor()?.document.nodes).toHaveLength(2)
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
                generate: async () => ({ createdNodeIds: [], revision: 0, toolId: "unused", warnings: [] }),
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
      container
        .querySelector('[data-canvas-composer-overlay="generation"]')
        ?.closest('[data-canvas-presence="exit"]'),
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

test("publishes scope-safe selection and requests the read-only Inspector without a document commit", async () => {
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
    const initialDocument = { ...createCanvasDocument({ id: "projection", nodes: [node] }), revision: 5 }
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
      revision: 5,
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
    const inspectorAction = getObservedEditor()?.visibleSelectionActions.find(
      (action) => action.id === "canvas.inspector.open",
    )
    expect(inspectorAction).toBeDefined()

    await act(async () => {
      if (inspectorAction) getObservedEditor()?.executeSelectionAction(inspectorAction)
      await Promise.resolve()
    })
    expect(inspectorRequests).toHaveLength(1)
    expect(inspectorRequests[0]).toMatchObject({ nodeId: node.id, revision: 5 })

    await act(async () => getObservedEditor()?.selectNodes([]))
    expect(projections.at(-1)).toMatchObject({ inspector: null, kind: "none", nodeIds: [] })
    await act(async () => {
      if (inspectorAction) getObservedEditor()?.executeSelectionAction(inspectorAction)
      await Promise.resolve()
    })
    expect(inspectorRequests).toHaveLength(1)
    expect(getObservedEditor()?.document.revision).toBe(5)
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("does not replay the initial fit after the first mutation on an initially empty Canvas", async () => {
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

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({ id: "empty-then-mutate" })}
          services={createCanvasServices()}
        />,
      )
    })

    expect(getObservedEditor()?.document.nodes).toEqual([])
    fitView.mockClear()
    setViewport.mockClear()

    await act(async () => {
      getObservedEditor()?.commit((document) => ({
        ...document,
        nodes: [
          createTextNode({
            id: "first-note",
            metadata: {},
            position: { x: 40, y: 60 },
            resourceState: { status: "ready" },
          }),
        ],
        revision: document.revision + 1,
      }))
    })

    expect(getObservedEditor()?.document.nodes.map((node) => node.id)).toEqual(["first-note"])
    expect(fitView).not.toHaveBeenCalled()
    expect(setViewport).not.toHaveBeenCalled()
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

    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({ id: "creation-menu-keyboard" })}
          services={createCanvasServices()}
        />,
      )
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
