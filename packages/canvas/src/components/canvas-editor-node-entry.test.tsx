import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import {
  type AnimationEventHandler,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode,
  act,
  createRef,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Connection, NodeProps } from "@xyflow/react"
import type { CanvasRendererCollaborationClient, CanvasRendererCommand } from "../collaboration"
import { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } from "../connections"
import type { CanvasDocument, CanvasNode } from "../types"
import type { CanvasEditorHandle } from "./canvas-editor"

let renderedNodes: CanvasNode[] = []
let renderNodes = true
let connect: ((connection: Connection) => void) | undefined
let connectStart:
  | ((event: MouseEvent, params: { handleId: string | null; nodeId: string | null }) => void)
  | undefined
let connectEnd:
  | ((event: MouseEvent, state: { fromNode?: { id: string }; isValid: boolean }) => void)
  | undefined
const setViewport = mock(async (_viewport: unknown, _options?: { duration?: number }) => undefined)

function Passthrough(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

function animationEvent(name: string) {
  const event = new Event(name.endsWith("-start") ? "animationstart" : "animationend", { bubbles: true })
  Object.defineProperty(event, "animationName", { value: name.replace(/-(?:start|end)$/, "") })
  return event
}

void mock.module("@convax/ui", () => ({
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
  ContextMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) => (
    <button data-test-context-menu-item="" onClick={onSelect}>
      {children}
    </button>
  ),
  ContextMenuLabel: Passthrough,
  ContextMenuSeparator: () => null,
  ContextMenuTrigger: Passthrough,
  Dialog: Passthrough,
  DialogClose: Passthrough,
  DialogContent: Passthrough,
  DialogDescription: Passthrough,
  DialogTitle: Passthrough,
  Input: (props: ButtonHTMLAttributes<HTMLInputElement>) => <input {...props} />,
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
  Tooltip: (props: { children?: ReactNode }) => <>{props.children}</>,
  TooltipProvider: Passthrough,
  cn: (...values: unknown[]) => values.filter((value) => typeof value === "string").join(" "),
  createToolInputDefaultValues: () => ({}),
  validateToolInputValues: () => ({ input: {}, invalidFieldIds: [], missingRequiredFieldIds: [], valid: true }),
}))

void mock.module("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots", Lines: "lines" },
  BaseEdge: () => null,
  EdgeLabelRenderer: Passthrough,
  Handle: ({
    children,
    id,
    isConnectable: _isConnectable,
    position: _position,
    type: _type,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    id?: string
    isConnectable?: boolean
    position?: string
    type?: string
  }) => (
    <button {...props} data-canvas-test-handle={id} type="button">
      {children}
    </button>
  ),
  MiniMap: () => null,
  NodeResizer: () => null,
  NodeToolbar: (props: {
    children?: ReactNode
    className?: string
    "data-canvas-node-entry-phase"?: string
    "data-canvas-node-entering"?: boolean
    onAnimationEnd?: AnimationEventHandler<HTMLDivElement>
    onAnimationStart?: AnimationEventHandler<HTMLDivElement>
  }) => (
    <div
      className={props.className}
      data-canvas-node-entry-phase={props["data-canvas-node-entry-phase"]}
      data-canvas-node-entering={props["data-canvas-node-entering"] || undefined}
      onAnimationEnd={props.onAnimationEnd}
      onAnimationStart={props.onAnimationStart}
    >
      {props.children}
    </div>
  ),
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  ReactFlow: (props: {
    children?: ReactNode
    nodeTypes?: Record<string, ComponentType<NodeProps<CanvasNode>>>
    nodes?: CanvasNode[]
    onConnect?: (connection: Connection) => void
    onConnectEnd?: (event: MouseEvent, state: { fromNode?: { id: string }; isValid: boolean }) => void
    onConnectStart?: (event: MouseEvent, params: { handleId: string | null; nodeId: string | null }) => void
    onPaneContextMenu?: (event: { clientX: number; clientY: number }) => void
  }) => {
    renderedNodes = props.nodes ?? []
    connect = props.onConnect
    connectStart = props.onConnectStart
    connectEnd = props.onConnectEnd
    return (
      <div
        className="react-flow__pane"
        onContextMenu={(event) => {
          props.onPaneContextMenu?.(event)
        }}
      >
        {renderNodes
          ? renderedNodes.map((node) => {
              const Component = props.nodeTypes?.[node.type ?? "file"]
              if (!Component) return null
              const nodeProps = {
                data: node.data,
                deletable: true,
                draggable: true,
                dragging: false,
                id: node.id,
                isConnectable: true,
                positionAbsoluteX: node.position.x,
                positionAbsoluteY: node.position.y,
                selected: Boolean(node.selected),
                selectable: true,
                type: node.type ?? "file",
                zIndex: 0,
              } as NodeProps<CanvasNode>
              return (
                <div
                  className="react-flow__node"
                  data-id={node.id}
                  key={node.id}
                  style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)` }}
                >
                  <Component {...nodeProps} />
                </div>
              )
            })
          : null}
        {props.children}
      </div>
    )
  },
  ReactFlowProvider: Passthrough,
  SelectionMode: { Partial: "partial" },
  ViewportPortal: Passthrough,
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
  useInternalNode: (id: string) => {
    const node = renderedNodes.find((candidate) => candidate.id === id)
    if (!node) return undefined
    return {
      height: 200,
      internals: { positionAbsolute: node.position },
      measured: { height: 200, width: 320 },
      width: 320,
    }
  },
  useReactFlow: () => ({
    fitView: async () => undefined,
    getNode: (id: string) => renderedNodes.find((node) => node.id === id),
    getNodes: () => renderedNodes,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    setCenter: async () => undefined,
    setViewport,
    zoomIn: async () => undefined,
    zoomOut: async () => undefined,
    zoomTo: async () => undefined,
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

const [
  { CanvasEditor },
  { CanvasNodeChrome },
  { createAgentNode, createCanvasDocument, createMediaNode, createTextNode },
  { createCanvasNodeRegistry },
  { createCanvasServices },
  { createCanvasViewRegistry },
  { CANVAS_MOTION_DURATION },
] = await Promise.all([
  import("./canvas-editor"),
  import("./builtin-node"),
  import("../document"),
  import("../node-registry"),
  import("../services"),
  import("../view"),
  import("../motion"),
])

let nextNodeId = 0
const createdNodes = new Map<string, CanvasNode>()

class NodeEntryCanvasSession implements CanvasRendererCollaborationClient {
  readonly authority = "project-collaboration-application" as const
  readonly undoModel = "project-yjs-semantic-history" as const
  private readonly listeners = new Set<() => void>()
  private entityRevision = 0

  constructor(private projection: CanvasDocument) {}

  canRedo() {
    return false
  }

  canUndo() {
    return false
  }

  async flush() {}

  getProjection() {
    return this.projection
  }

  publish(projection: CanvasDocument) {
    this.projection = projection
    for (const listener of this.listeners) listener()
  }

  reincarnateNodes() {
    this.entityRevision += 1
    for (const listener of this.listeners) listener()
  }

  async redo() {}

  resolveNodeEntity(nodeId: string) {
    return this.projection.nodes.some((node) => node.id === nodeId)
      ? { kind: "node" as const, id: nodeId, incarnation: `incarnation-${nodeId}-${this.entityRevision}` }
      : undefined
  }

  async submit(_command: CanvasRendererCommand) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async undo() {}
}

function TestNode(props: NodeProps<CanvasNode>) {
  return (
    <CanvasNodeChrome icon={null} label={props.data.label} node={props}>
      <iframe title={`${props.data.label} plugin surface`} />
    </CanvasNodeChrome>
  )
}

function createTestRegistry() {
  return createCanvasNodeRegistry([
    {
      component: TestNode,
      create: ({ position }) => {
        const id = `created-${++nextNodeId}`
        const node = createMediaNode({
          id,
          position,
          resource: { id, kind: "image", metadata: {}, state: { status: "ready" } },
        })
        createdNodes.set(id, node)
        return node
      },
      label: "File",
      type: "file",
    },
    {
      component: TestNode,
      create: ({ position }) => {
        const id = `created-${++nextNodeId}`
        return createAgentNode({ id, position })
      },
      label: "Agent",
      type: "agent",
    },
  ])
}

function installTestWindow(reducedMotion = false) {
  const testWindow = new Window({ url: "https://convax.test/" })
  Object.defineProperty(testWindow, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
      media: query,
      removeEventListener: () => undefined,
    }),
  })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    MouseEvent: testWindow.MouseEvent,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  }
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"))
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

function editorElement(
  editorRef: ReturnType<typeof createRef<CanvasEditorHandle | null>>,
  nodeRegistry: ReturnType<typeof createTestRegistry>,
  session: NodeEntryCanvasSession,
  viewScopeId: string,
  reducedMotion?: boolean,
) {
  return (
    <CanvasEditor
      nodeRegistry={nodeRegistry}
      reducedMotion={reducedMotion}
      ref={editorRef}
      services={createNodeEntryServices(session)}
      session={session}
      viewScopeId={viewScopeId}
    />
  )
}

function createNodeEntryDocument() {
  return createCanvasDocument({
    id: "node-entry",
    nodes: [
      createMediaNode({
        id: "hydrated",
        position: { x: 20, y: 40 },
        resource: { id: "hydrated", kind: "image", metadata: {}, state: { status: "ready" } },
      }),
    ],
  })
}

function createNodeEntryServices(session: NodeEntryCanvasSession) {
  return createCanvasServices({
    mutation: {
      async add(input) {
        const id = `created-${++nextNodeId}`
        const node = createMediaNode({
          id,
          position: input.anchor,
          resource: { id, kind: "image", metadata: {}, state: { status: "ready" } },
        })
        createdNodes.set(id, node)
        session.publish({ ...session.getProjection(), nodes: [...session.getProjection().nodes, node] })
        return { createdNodeIds: [id], warnings: [] }
      },
    },
  })
}

test("publishes hydrated resource state into the rendered transient document", async () => {
  const restoreWindow = installTestWindow()
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  const canvasDocument = createCanvasDocument({
    id: "resource-hydration",
    nodes: [
      createMediaNode({
        id: "image",
        position: { x: 20, y: 40 },
        resource: {
          id: "image-resource",
          kind: "image",
          metadata: {
            convaxResource: {
              format: "convax.canvas-resource-ref",
              uri:
                `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
                `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${"1".repeat(64)}` +
                `?blob=sha256%3A${"a".repeat(64)}&path=Generated%2Fimage.png`,
              mediaClass: "image",
              mime: "image/png",
              byteLength: "12" as never,
              contentDigest: "a".repeat(64),
              ownerProofDigest: "b".repeat(64),
            },
          },
          name: "image.png",
          state: { status: "stale" },
        },
      }),
    ],
  })
  const session = new NodeEntryCanvasSession(canvasDocument)
  const hydrationRequests: Array<{
    document: CanvasDocument
    resolve(document: CanvasDocument): void
    signal: AbortSignal
  }> = []
  const services = createCanvasServices({
    hydration: {
      hydrateStale({ document: stale, signal }) {
        return new Promise<CanvasDocument>((resolve) => {
          hydrationRequests.push({ document: stale, resolve, signal })
        })
      },
      markStale: (current) => current,
    },
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <CanvasEditor
          nodeRegistry={createTestRegistry()}
          ref={editorRef}
          services={services}
          session={session}
          viewScopeId="project-one"
        />,
      ),
    )
    expect(hydrationRequests).toHaveLength(1)

    await act(async () => session.reincarnateNodes())
    expect(hydrationRequests[0]!.signal.aborted).toBeFalse()

    await act(async () => {
      const stale = hydrationRequests[0]!.document
      hydrationRequests[0]!.resolve({
        ...stale,
        nodes: stale.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            resourceState: { status: "ready" as const, url: "convax-asset://project/image" },
          },
        })),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderedNodes[0]?.data.resourceState).toEqual({
      status: "ready",
      url: "convax-asset://project/image",
    })

    await act(async () =>
      session.publish({
        ...canvasDocument,
        nodes: canvasDocument.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            metadata: {
              ...node.data.metadata,
              convaxResource: {
                ...(node.data.metadata as Record<string, Record<string, unknown>>).convaxResource,
                ownerProofDigest: "d".repeat(64),
              },
            },
            resourceState: { status: "stale" as const },
          },
        })),
      }),
    )
    expect(renderedNodes[0]?.data.resourceState).toEqual({ status: "stale" })
    expect(hydrationRequests).toHaveLength(2)

    await act(async () => {
      const stale = hydrationRequests[1]!.document
      hydrationRequests[1]!.resolve({
        ...stale,
        nodes: stale.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            resourceState: { status: "ready" as const, url: "convax-asset://project/relinked-image" },
          },
        })),
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes[0]?.data.resourceState).toEqual({
      status: "ready",
      url: "convax-asset://project/relinked-image",
    })
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("mounts rapid new nodes with one inner-shell entrance and never replays hydration or virtualization", async () => {
  const restoreWindow = installTestWindow()
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  nextNodeId = 0
  createdNodes.clear()
  const session = new NodeEntryCanvasSession(createNodeEntryDocument())
  const nodeRegistry = createTestRegistry()

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "scope-a")))

    expect(
      container.querySelector('[data-id="hydrated"] .convax-node')?.hasAttribute("data-canvas-node-entering"),
    ).toBeFalse()

    const firstId = "created-1"
    const secondId = "created-2"
    await act(async () => {
      editorRef.current?.insertNode("text")
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      editorRef.current?.insertNode("text")
      await Promise.resolve()
      await Promise.resolve()
    })

    const first = container.querySelector<HTMLElement>(`[data-id="${firstId}"] .convax-node`)
    const second = container.querySelector<HTMLElement>(`[data-id="${secondId}"] .convax-node`)
    expect(first?.dataset.canvasNodeEntering).toBe("true")
    expect(second?.dataset.canvasNodeEntering).toBe("true")
    expect(container.querySelector<HTMLElement>(`[data-id="${firstId}"]`)?.style.transform).toContain("translate(")
    expect(first?.querySelector("iframe")).not.toBeNull()
    expect(first?.querySelector(".convax-node__entry-shell [data-canvas-test-handle]")).toBeNull()
    expect(first?.querySelectorAll(":scope > [data-canvas-test-handle]")).toHaveLength(2)

    await act(async () => {
      first?.querySelector(".convax-node__entry-shell")?.dispatchEvent(animationEvent("convax-node-enter-end"))
      second?.querySelector(".convax-node__entry-shell")?.dispatchEvent(animationEvent("convax-node-enter-end"))
    })
    expect(first?.hasAttribute("data-canvas-node-entering")).toBeFalse()
    expect(second?.hasAttribute("data-canvas-node-entering")).toBeFalse()

    renderNodes = false
    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "scope-a")))
    renderNodes = true
    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "scope-a")))
    expect(
      container.querySelector(`[data-id="${firstId}"] .convax-node`)?.hasAttribute("data-canvas-node-entering"),
    ).toBeFalse()

    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "scope-b")))
    expect(
      container.querySelector('[data-id="hydrated"] .convax-node')?.hasAttribute("data-canvas-node-entering"),
    ).toBeFalse()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("host reduced motion skips the transient frame while keeping the created node", async () => {
  const restoreWindow = installTestWindow(false)
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  nextNodeId = 0
  createdNodes.clear()
  const session = new NodeEntryCanvasSession(createNodeEntryDocument())
  const nodeRegistry = createTestRegistry()

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "scope-reduced", true)))
    const createdId = "created-1"
    await act(async () => {
      editorRef.current?.insertNode("text")
      await Promise.resolve()
      await Promise.resolve()
    })

    const created = container.querySelector(`[data-id="${createdId}"] .convax-node`)
    expect(created).not.toBeNull()
    expect(created?.hasAttribute("data-canvas-node-entering")).toBeFalse()
    expect(container.querySelector(".convax-canvas")?.getAttribute("data-canvas-reduced-motion")).toBe("true")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("an explicit host animation preference overrides OS reduced motion", async () => {
  const restoreWindow = installTestWindow(true)
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  nextNodeId = 0
  createdNodes.clear()
  const session = new NodeEntryCanvasSession(createNodeEntryDocument())
  const nodeRegistry = createTestRegistry()

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "scope-host-motion", false)))
    const createdId = "created-1"
    await act(async () => {
      editorRef.current?.insertNode("text")
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      container.querySelector(`[data-id="${createdId}"] .convax-node`)?.getAttribute("data-canvas-node-entering"),
    ).toBe("true")
    expect(container.querySelector(".convax-canvas")?.getAttribute("data-canvas-reduced-motion")).toBe("false")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("centers an outline reveal without replaying the node-entry animation", async () => {
  const restoreWindow = installTestWindow()
  const viewRegistry = createCanvasViewRegistry()
  let resolveCamera!: () => void
  const cameraFinished = new Promise<void>((resolve) => {
    resolveCamera = resolve
  })
  let root: Root | undefined
  renderNodes = true
  setViewport.mockImplementation(async (_viewport, options?: { duration?: number }) => {
    if ((options?.duration ?? 0) > 0) await cameraFinished
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({
            id: "outline-focus",
            nodes: [
              createMediaNode({
                id: "focus-target",
                position: { x: 900, y: 40 },
                resource: { id: "focus-target", kind: "image", metadata: {}, state: { status: "ready" } },
              }),
            ],
          })}
          nodeRegistry={createTestRegistry()}
          services={createCanvasServices()}
          viewId="main"
          viewRegistry={viewRegistry}
          viewScopeId="project-a"
        />,
      )
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }),
    })

    let execution!: Promise<unknown>
    await act(async () => {
      execution = viewRegistry.execute({
        command: {
          animation: "smooth",
          fit: "center",
          nodeIds: ["focus-target"],
          select: true,
          type: "nodes.reveal",
        },
        expectedDocumentId: "outline-focus",
        expectedScopeId: "project-a",
        viewId: "main",
      })
      await Promise.resolve()
    })

    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 300)).toBeTrue()
    expect(
      container.querySelector('[data-id="focus-target"] .convax-node')?.hasAttribute("data-canvas-node-entering"),
    ).toBeFalse()

    await act(async () => {
      resolveCamera()
      await execution
    })
    expect(
      container.querySelector('[data-id="focus-target"] .convax-node')?.hasAttribute("data-canvas-node-entering"),
    ).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("places a top-toolbar-created node in a visible gap and focuses it before entry presentation", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({
    id: "header-create-focus",
    nodes: [
      createMediaNode({
        id: "occupied",
        position: { x: 240, y: 200 },
        resource: { id: "occupied", kind: "image", metadata: {}, state: { status: "ready" } },
      }),
    ],
  })
  let authoritative = initial
  const session = new NodeEntryCanvasSession(initial)
  let requestedAnchor: { x: number; y: number } | undefined
  let resolveCamera!: () => void
  const cameraFinished = new Promise<void>((resolve) => {
    resolveCamera = resolve
  })
  let root: Root | undefined
  setViewport.mockImplementation(async (_viewport, options) => {
    if ((options?.duration ?? 0) > 0) await cameraFinished
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          services={createCanvasServices({
            mutation: {
              async add(input) {
                requestedAnchor = input.anchor
                authoritative = {
                  ...authoritative,
                  nodes: [
                    ...authoritative.nodes,
                    createMediaNode({
                      id: "header-created",
                      position: input.anchor,
                      resource: {
                        id: "header-created",
                        kind: "image",
                        metadata: {},
                        state: { status: "ready" },
                      },
                    }),
                  ],
                }
                session.publish(authoritative)
                return { createdNodeIds: ["header-created"], warnings: [] }
              },
            },
          })}
          session={session}
        />,
      )
      await Promise.resolve()
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1200, top: 0, width: 1200 }),
    })

    const addTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Add node"]')
    await act(async () => {
      addTrigger?.click()
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Add Text"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.activeElement === addTrigger).toBeTrue()

    expect(requestedAnchor).toBeDefined()
    expect(requestedAnchor!.x).toBeGreaterThanOrEqual(0)
    expect(requestedAnchor!.y).toBeGreaterThanOrEqual(0)
    expect(requestedAnchor!.x + 320).toBeLessThanOrEqual(1200)
    expect(requestedAnchor!.y + 200).toBeLessThanOrEqual(800)
    expect(
      requestedAnchor!.x < 560 &&
        requestedAnchor!.x + 320 > 240 &&
        requestedAnchor!.y < 400 &&
        requestedAnchor!.y + 200 > 200,
    ).toBeFalse()
    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 400)).toBeTrue()
    expect(
      container.querySelector('[data-id="header-created"] .convax-node')?.hasAttribute("data-canvas-node-entering"),
    ).toBeFalse()
    expect(
      container.querySelector('[data-id="header-created"] .convax-node')?.getAttribute("data-canvas-node-entry-phase"),
    ).toBe("pending-focus")

    await act(async () => {
      resolveCamera()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-id="header-created"] .convax-node')?.getAttribute("data-canvas-node-entering"),
    ).toBe("true")
    expect(
      container.querySelector('[data-id="header-created"] .convax-node')?.getAttribute("data-canvas-node-entry-phase"),
    ).toBe("entering")
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("does not offer non-atomic Agent creation after dragging a connection to empty canvas", async () => {
  const restoreWindow = installTestWindow()
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  nextNodeId = 0
  const session = new NodeEntryCanvasSession(createNodeEntryDocument())
  const nodeRegistry = createTestRegistry()
  setViewport.mockClear()

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "drag-connect-focus")))
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1_200, top: 0, width: 1_200 }),
    })
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null })

    await act(async () => {
      connectStart?.(new MouseEvent("mousedown", { clientX: 340, clientY: 140 }), {
        handleId: CANVAS_NODE_OUTPUT_HANDLE_ID,
        nodeId: "hydrated",
      })
      connectEnd?.(new MouseEvent("mouseup", { clientX: 900, clientY: 520 }), {
        fromNode: { id: "hydrated" },
        isValid: false,
      })
      await Promise.resolve()
    })

    const pendingMenu = container.querySelector<HTMLElement>('[data-convax-pending-connection="menu"]')
    const agentOption = [...(pendingMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])].find(
      (button) => button.textContent?.includes("Agent"),
    )
    const textOption = [...(pendingMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])].find(
      (button) => button.textContent?.includes("Text"),
    )
    expect(pendingMenu).toBeDefined()
    expect(agentOption).toBeUndefined()
    expect(textOption).toBeDefined()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("submits direct and card-target connections through the existing application command bridge", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  renderNodes = true
  const source = createMediaNode({
    id: "connection-source",
    position: { x: 20, y: 40 },
    resource: { id: "connection-source", kind: "image", metadata: {}, state: { status: "ready" } },
  })
  const target = createMediaNode({
    id: "connection-target",
    position: { x: 420, y: 40 },
    resource: { id: "connection-target", kind: "video", metadata: {}, state: { status: "ready" } },
  })
  const session = new NodeEntryCanvasSession(
    createCanvasDocument({ id: "application-command-connections", nodes: [source, target] }),
  )
  const executeCommand = mock(async () => undefined)
  const notify = mock(() => undefined)

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          executeCommand={executeCommand}
          nodeRegistry={createTestRegistry()}
          services={createCanvasServices({ notify: { show: notify } })}
          session={session}
        />,
      )
      await Promise.resolve()
    })

    await act(async () => {
      connect?.({
        source: source.id,
        sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
        target: target.id,
        targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
      })
      await Promise.resolve()
    })
    expect(executeCommand).toHaveBeenNthCalledWith(1, {
      type: "nodes.connect",
      connection: { source: source.id, target: target.id },
    })

    const targetElement = container.querySelector<HTMLElement>(`[data-id="${target.id}"] .convax-node`)
    expect(targetElement).toBeDefined()
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => targetElement })
    await act(async () => {
      connectStart?.(new MouseEvent("mousedown", { clientX: 340, clientY: 140 }), {
        handleId: CANVAS_NODE_OUTPUT_HANDLE_ID,
        nodeId: source.id,
      })
      connectEnd?.(new MouseEvent("mouseup", { clientX: 700, clientY: 220 }), {
        fromNode: { id: source.id },
        isValid: false,
      })
      await Promise.resolve()
    })
    expect(executeCommand).toHaveBeenNthCalledWith(2, {
      type: "nodes.connect",
      connection: { source: source.id, target: target.id },
    })
    expect(session.getProjection().edges).toEqual([])
    expect(notify).not.toHaveBeenCalled()

    executeCommand.mockImplementationOnce(async () => {
      throw new Error("connection rejected")
    })
    await act(async () => {
      connect?.({
        source: source.id,
        sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
        target: target.id,
        targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      title: "Could not connect Canvas nodes",
      description: "connection rejected",
    })
    expect(session.getProjection().edges).toEqual([])
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("does not offer non-atomic Agent creation from click-to-connect", async () => {
  const restoreWindow = installTestWindow()
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  nextNodeId = 0
  const session = new NodeEntryCanvasSession(createNodeEntryDocument())
  const nodeRegistry = createTestRegistry()
  setViewport.mockClear()

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(editorElement(editorRef, nodeRegistry, session, "click-connect-entry")))
    await act(async () => editorRef.current?.selectNodes(["hydrated"]))

    const outputHandle = container.querySelector<HTMLButtonElement>(
      `[data-id="hydrated"] [data-canvas-test-handle="${CANVAS_NODE_OUTPUT_HANDLE_ID}"]`,
    )
    await act(async () => outputHandle?.click())
    const connectionMenu = container.querySelector<HTMLElement>(".convax-connect-menu-positioner")
    const agentOption = [
      ...(connectionMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
    ].find((button) => button.textContent?.includes("Agent"))
    const textOption = [...(connectionMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])].find(
      (button) => button.textContent?.includes("Text"),
    )
    expect(connectionMenu).toBeDefined()
    expect(agentOption).toBeUndefined()
    expect(textOption).toBeDefined()
    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 400)).toBeFalse()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("focuses a text node created after dragging a connection to empty canvas", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({
    id: "drag-connect-text-focus",
    nodes: [
      createMediaNode({
        id: "anchor",
        position: { x: 20, y: 40 },
        resource: { id: "anchor", kind: "image", metadata: {}, state: { status: "ready" } },
      }),
    ],
  })
  let authoritative = initial
  const session = new NodeEntryCanvasSession(initial)
  let resolveCamera!: () => void
  const cameraFinished = new Promise<void>((resolve) => {
    resolveCamera = resolve
  })
  let root: Root | undefined
  renderNodes = true
  setViewport.mockImplementation(async (_viewport, options) => {
    if ((options?.duration ?? 0) > 0) await cameraFinished
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={createTestRegistry()}
          services={createCanvasServices({
            mutation: {
              async add(input) {
                authoritative = {
                  ...authoritative,
                  nodes: [
                    ...authoritative.nodes,
                    createTextNode({
                      id: "drag-created-text",
                      metadata: {},
                      position: input.anchor,
                      resourceState: { status: "ready" },
                    }),
                  ],
                }
                session.publish(authoritative)
                return { createdNodeIds: ["drag-created-text"], warnings: [] }
              },
            },
          })}
          session={session}
        />,
      )
      await Promise.resolve()
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1_200, top: 0, width: 1_200 }),
    })
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null })

    await act(async () => {
      connectStart?.(new MouseEvent("mousedown", { clientX: 340, clientY: 140 }), {
        handleId: CANVAS_NODE_OUTPUT_HANDLE_ID,
        nodeId: "anchor",
      })
      connectEnd?.(new MouseEvent("mouseup", { clientX: 900, clientY: 520 }), {
        fromNode: { id: "anchor" },
        isValid: false,
      })
      await Promise.resolve()
    })

    const textOption = [...container.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(
      (button) => button.textContent?.includes("Text"),
    )
    expect(textOption).toBeDefined()
    await act(async () => {
      textOption?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const created = container.querySelector<HTMLElement>('[data-id="drag-created-text"] .convax-node')
    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 400)).toBeTrue()
    expect(created?.hasAttribute("data-canvas-node-entering")).toBeFalse()
    expect(created?.dataset.canvasNodeEntryPhase).toBe("pending-focus")

    await act(async () => {
      resolveCamera()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(created?.dataset.canvasNodeEntering).toBe("true")
    expect(created?.dataset.canvasNodeEntryPhase).toBe("entering")
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("focuses a picker-created image before entry and clears a held external-drag hint", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({ id: "picker-create-entry" })
  let authoritative = initial
  const session = new NodeEntryCanvasSession(initial)
  let resolveCamera!: () => void
  const cameraFinished = new Promise<void>((resolve) => {
    resolveCamera = resolve
  })
  const prepare = mock(async () => ({ dispose: () => undefined, start: () => undefined }))
  let root: Root | undefined
  renderNodes = true
  setViewport.mockImplementation(async (_viewport, options) => {
    if ((options?.duration ?? 0) > 0) await cameraFinished
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          selectionDragSource={{
            id: "native-files",
            label: "Keep holding Command-Shift",
            prepare,
            shortcutModifier: "meta",
            visible: () => true,
          }}
          services={createCanvasServices({
            mutation: {
              async add(input) {
                authoritative = {
                  ...authoritative,
                  nodes: [
                    ...authoritative.nodes,
                    createMediaNode({
                      id: "picker-created",
                      position: { x: 1_200, y: 400 },
                      resource: {
                        id: "picker-created",
                        kind: "image",
                        metadata: {},
                        state: { status: "ready" },
                      },
                    }),
                  ],
                }
                session.publish(authoritative)
                expect(input.files).toHaveLength(1)
                return { createdNodeIds: ["picker-created"], warnings: [] }
              },
            },
          })}
          session={session}
        />,
      )
      await Promise.resolve()
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1_200, top: 0, width: 1_200 }),
    })

    const chordDown = new Event("keydown", { bubbles: true })
    Object.defineProperties(chordDown, {
      key: { value: "Shift" },
      metaKey: { value: true },
      shiftKey: { value: true },
    })
    await act(async () => {
      window.dispatchEvent(chordDown)
      await Promise.resolve()
    })
    expect(prepare).toHaveBeenCalledTimes(1)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Add node"]')?.click()
      await Promise.resolve()
      container.querySelector<HTMLButtonElement>('button[aria-label="Add Image"]')?.click()
      await Promise.resolve()
    })
    const imageInput = container.querySelector<HTMLInputElement>('[data-canvas-resource-picker="image"]')!
    Object.defineProperty(imageInput, "files", {
      configurable: true,
      value: [{ name: "picked.png", type: "image/png" }],
    })
    await act(async () => {
      imageInput.dispatchEvent(new Event("change", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const created = container.querySelector<HTMLElement>('[data-id="picker-created"] .convax-node')
    expect(container.querySelector("[data-canvas-selection-drag-hint]")).toBeNull()
    expect(created?.dataset.canvasNodeEntryPhase).toBe("pending-focus")

    await act(async () => {
      resolveCamera()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(created?.dataset.canvasNodeEntering).toBe("true")
    expect(created?.dataset.canvasNodeEntryPhase).toBe("entering")
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("runs the context-menu-created text node through the same camera focus and entry sequence as the top toolbar", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({
    id: "context-create-entry",
    nodes: [
      createMediaNode({
        id: "hydrated",
        position: { x: 20, y: 40 },
        resource: { id: "hydrated", kind: "image", metadata: {}, state: { status: "ready" } },
      }),
    ],
  })
  let authoritative = initial
  const session = new NodeEntryCanvasSession(initial)
  let requestedAnchor: { x: number; y: number } | undefined
  let resolveCamera!: () => void
  const cameraFinished = new Promise<void>((resolve) => {
    resolveCamera = resolve
  })
  let root: Root | undefined
  renderNodes = true
  setViewport.mockImplementation(async (_viewport, options) => {
    if ((options?.duration ?? 0) > 0) await cameraFinished
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={createTestRegistry()}
          selectionActions={[{ execute: () => undefined, id: "test.action", label: "Test action" }]}
          services={createCanvasServices({
            mutation: {
              async add(input) {
                requestedAnchor = input.anchor
                authoritative = {
                  ...authoritative,
                  nodes: [
                    ...authoritative.nodes,
                    createTextNode({
                      id: "context-created",
                      metadata: {},
                      position: input.anchor,
                      resourceState: { status: "ready" },
                    }),
                  ],
                }
                session.publish(authoritative)
                return { createdNodeIds: ["context-created"], warnings: [] }
              },
            },
          })}
          session={session}
        />,
      )
      await Promise.resolve()
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1200, top: 0, width: 1200 }),
    })

    const contextAddText = [...container.querySelectorAll<HTMLButtonElement>("[data-test-context-menu-item]")].find(
      (button) => button.textContent?.includes("Add Text"),
    )
    expect(contextAddText).toBeDefined()

    await act(async () => {
      container
        .querySelector(".react-flow__pane")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 960, clientY: 640 }))
      await Promise.resolve()
      contextAddText?.click()
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      await Promise.resolve()
    })

    const created = container.querySelector<HTMLElement>('[data-id="context-created"] .convax-node')
    expect(requestedAnchor).toEqual({ x: 960, y: 640 })
    const focusCall = setViewport.mock.calls.find((call) => call[1]?.duration === 400)
    expect(focusCall).toBeDefined()
    expect(focusCall?.[0]).toMatchObject({ zoom: 1.2 })
    expect(focusCall?.[0]).not.toMatchObject({ x: 0, y: 0 })
    expect(created?.hasAttribute("data-canvas-node-entering")).toBeFalse()
    expect(created?.dataset.canvasNodeEntryPhase).toBe("pending-focus")

    await act(async () => {
      resolveCamera()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(created?.dataset.canvasNodeEntering).toBe("true")
    expect(created?.dataset.canvasNodeEntryPhase).toBe("entering")

    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, CANVAS_MOTION_DURATION.nodeEnter + 80))
    })
    expect(created?.dataset.canvasNodeEntering).toBe("true")

    await act(async () => {
      const shell = created?.querySelector(".convax-node__entry-shell")
      shell?.dispatchEvent(animationEvent("convax-node-enter-start"))
      shell?.dispatchEvent(animationEvent("convax-node-enter-end"))
    })
    expect(created?.dataset.canvasNodeEntering).toBe("true")

    await act(async () => {
      const toolbar = container.querySelector('[data-id="context-created"] .convax-node-toolbar')
      toolbar?.dispatchEvent(animationEvent("convax-node-chrome-enter-start"))
      toolbar?.dispatchEvent(animationEvent("convax-node-chrome-enter-end"))
    })
    expect(created?.hasAttribute("data-canvas-node-entering")).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
