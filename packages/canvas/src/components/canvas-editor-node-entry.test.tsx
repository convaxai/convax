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
import type { CanvasResourceMutationRequest } from "../services"
import type { CanvasEditorHandle } from "./canvas-editor"

let renderedNodes: CanvasNode[] = []
let renderNodes = true
let connect: ((connection: Connection) => void) | undefined
let connectStart: ((event: MouseEvent, params: { handleId: string | null; nodeId: string | null }) => void) | undefined
let connectEnd: ((event: MouseEvent, state: { fromNode?: { id: string }; isValid: boolean }) => void) | undefined
let nodesChange: ((changes: readonly { id: string; selected: boolean; type: "select" }[]) => void) | undefined
let moveStart: ((event?: MouseEvent) => void) | undefined
let relinkLocalFileAction: (() => void) | undefined
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
  BeamButton: (props: { children?: ReactNode }) => <button>{props.children}</button>,
  BeamSurface: Passthrough,
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
  }) => {
    if (props["aria-label"] === "Relink local file" && props.onClick) {
      const onClick = props.onClick
      relinkLocalFileAction = () => (onClick as () => void)()
    }
    return <button {...props}>{children}</button>
  },
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
    onMoveStart?: (event?: MouseEvent) => void
    onNodesChange?: (changes: readonly { id: string; selected: boolean; type: "select" }[]) => void
    onPaneContextMenu?: (event: { clientX: number; clientY: number }) => void
  }) => {
    renderedNodes = props.nodes ?? []
    connect = props.onConnect
    connectStart = props.onConnectStart
    connectEnd = props.onConnectEnd
    moveStart = props.onMoveStart
    nodesChange = props.onNodesChange
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
  useStoreApi: () => ({
    getState: () => ({}),
    setState: () => undefined,
    subscribe: () => () => undefined,
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

const [
  {
    CanvasEditor,
    canvasAuthorityMatchesOptimisticResourceBounds,
    isCanvasAuthoritativeResourceReadyForOptimisticHandoff,
  },
  { BuiltinCanvasNode, CanvasNodeChrome },
  {
    createAgentNode,
    createCanvasDocument,
    createGroupNode,
    createMediaNode,
    createTextNode,
    getCanvasNodePresentationSize,
    isCanvasEmptyMediaNodeData,
  },
  { createCanvasNodeRegistry },
  { createCanvasServices },
  { createCanvasViewRegistry },
  { CANVAS_MOTION_DURATION, CANVAS_NODE_ENTRY_FINISH_GRACE },
] = await Promise.all([
  import("./canvas-editor"),
  import("./builtin-node"),
  import("../document"),
  import("../node-registry"),
  import("../services"),
  import("../view"),
  import("../motion"),
])

async function waitForAnimationFrames(count: number) {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  }
}

let nextNodeId = 0
const createdNodes = new Map<string, CanvasNode>()
const resourceMutations: CanvasResourceMutationRequest[] = []

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
    cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    MouseEvent: testWindow.MouseEvent,
    Node: testWindow.Node,
    document: testWindow.document,
    requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
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
        resourceMutations.push(input)
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

test("keeps an active ready text editor mounted while its request-only stale snapshot hydrates", async () => {
  const restoreWindow = installTestWindow()
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  const textNode = createTextNode({
    id: "editable-note",
    metadata: { resource: "Notes/editable.md" },
    position: { x: 20, y: 40 },
    resourceState: {
      contentRevision: "a".repeat(64),
      editableText: true,
      status: "ready",
      text: "Before refresh",
    },
  })
  const session = new NodeEntryCanvasSession(
    createCanvasDocument({ id: "ready-text-request-hydration", nodes: [textNode] }),
  )
  const hydrationRequests: Array<{
    document: CanvasDocument
    resolve(document: CanvasDocument): void
  }> = []
  const services = createCanvasServices({
    hydration: {
      hydrateStale({ document }) {
        return new Promise<CanvasDocument>((resolve) => hydrationRequests.push({ document, resolve }))
      },
      markStale(document, shouldInvalidate) {
        return {
          ...document,
          nodes: document.nodes.map((node) =>
            shouldInvalidate?.(node)
              ? { ...node, data: { ...node.data, resourceState: { status: "stale" as const } } }
              : node,
          ),
        }
      },
    },
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={createCanvasNodeRegistry([{ component: BuiltinCanvasNode, label: "File", type: "file" }])}
          ref={editorRef}
          services={services}
          session={session}
          viewScopeId="project-one"
        />,
      )
      await waitForAnimationFrames(2)
    })
    await act(async () => {
      nodesChange?.([{ id: textNode.id, selected: true, type: "select" }])
      await waitForAnimationFrames(2)
    })
    const contenteditable = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(contenteditable).not.toBeNull()
    contenteditable?.focus()
    expect(document.activeElement).toBe(contenteditable)

    let refresh!: Promise<void>
    await act(async () => {
      refresh = editorRef.current!.invalidateResources((node) => node.id === textNode.id)
      await Promise.resolve()
    })

    expect(hydrationRequests).toHaveLength(1)
    expect(hydrationRequests[0]!.document.nodes[0]!.data.resourceState).toEqual({ status: "stale" })
    expect(renderedNodes[0]!.data.resourceState).toMatchObject({
      editableText: true,
      status: "ready",
      text: "Before refresh",
    })
    expect(contenteditable?.isConnected).toBeTrue()
    expect(container.querySelector<HTMLElement>('[contenteditable="true"]')).toBe(contenteditable)
    expect(document.activeElement).toBe(contenteditable)

    await act(async () => {
      const request = hydrationRequests[0]!.document
      hydrationRequests[0]!.resolve({
        ...request,
        nodes: request.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            resourceState: {
              contentRevision: "b".repeat(64),
              editableText: true,
              status: "ready" as const,
              text: "After refresh",
            },
          },
        })),
      })
      await refresh
    })

    expect(renderedNodes[0]!.data.resourceState).toMatchObject({ status: "ready", text: "After refresh" })
    expect(contenteditable?.isConnected).toBeTrue()
    expect(container.querySelector<HTMLElement>('[contenteditable="true"]')).toBe(contenteditable)
    expect(document.activeElement).toBe(contenteditable)
    container.remove()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

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

test("reports a relink business failure before cancelling its local preview", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  renderNodes = true
  const node = createMediaNode({
    id: "missing-image",
    position: { x: 20, y: 40 },
    resource: { id: "missing-image", kind: "image", metadata: {}, state: { status: "missing" } },
  })
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "relink-failure", nodes: [node] }))
  const notify = mock(() => undefined)
  let operationSignal: AbortSignal | undefined
  const relink = mock(async (input: { signal: AbortSignal }) => {
    operationSignal = input.signal
    throw new Error("relink rejected")
  })
  const nodeRegistry = createCanvasNodeRegistry([{ component: BuiltinCanvasNode, label: "File", type: "file" }])

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={nodeRegistry}
          services={createCanvasServices({
            mutation: {
              add: async () => ({ createdNodeIds: [], warnings: [] }),
              relink,
            },
            notify: { show: notify },
          })}
          session={session}
          viewScopeId="relink-failure"
        />,
      )
      await Promise.resolve()
    })
    await act(async () => {
      nodesChange?.([{ id: node.id, selected: true, type: "select" }])
      await Promise.resolve()
    })

    const relinkButton = container.querySelector<HTMLButtonElement>('button[aria-label="Relink local file"]')
    const picker = container.querySelector<HTMLInputElement>('input[data-canvas-resource-picker="relink"]')
    expect(relinkButton).not.toBeNull()
    expect(picker).not.toBeNull()
    await act(async () => {
      relinkButton?.click()
      Object.defineProperty(picker, "files", {
        configurable: true,
        value: [new File(["image"], "replacement.png", { type: "image/png" })],
      })
      picker?.dispatchEvent(new Event("change", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(relink).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({
      description: "relink rejected",
      kind: "error",
      title: "Could not relink resource",
    })
    expect(operationSignal?.aborted).toBeTrue()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("rehydrates the canonical resource after a superseding local relink preview fails", async () => {
  const restoreWindow = installTestWindow()
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL")
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")
  let nextObjectUrl = 0
  const revokeObjectUrl = mock((_url: string) => undefined)
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:relink-preview-${++nextObjectUrl}`,
    writable: true,
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
    writable: true,
  })
  let root: Root | undefined
  renderNodes = true
  relinkLocalFileAction = undefined
  const node = createMediaNode({
    id: "relinked-image",
    position: { x: 20, y: 40 },
    resource: { id: "relinked-image", kind: "image", metadata: {}, state: { status: "missing" } },
  })
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "relink-preview-race", nodes: [node] }))
  const relinkRequests: Array<{
    reject(reason?: unknown): void
    resolve(result: { authoritativeProjectionDelivered?: boolean; warnings: readonly string[] }): void
  }> = []
  const relink = mock(
    async () =>
      new Promise<{ authoritativeProjectionDelivered?: boolean; warnings: readonly string[] }>((resolve, reject) => {
        relinkRequests.push({ reject, resolve })
      }),
  )
  const hydrationRequests: Array<{
    document: CanvasDocument
    resolve(document: CanvasDocument): void
  }> = []
  const invalidatedNodeIds: string[][] = []
  const services = createCanvasServices({
    hydration: {
      hydrateStale({ document }) {
        return new Promise<CanvasDocument>((resolve) => hydrationRequests.push({ document, resolve }))
      },
      markStale(document, shouldInvalidate) {
        const invalidated = document.nodes.filter((candidate) => shouldInvalidate?.(candidate) ?? true)
        invalidatedNodeIds.push(invalidated.map((candidate) => candidate.id))
        if (!shouldInvalidate) return document
        return {
          ...document,
          nodes: document.nodes.map((candidate) =>
            shouldInvalidate(candidate)
              ? { ...candidate, data: { ...candidate.data, resourceState: { status: "stale" as const } } }
              : candidate,
          ),
        }
      },
    },
    mutation: {
      add: async () => ({ createdNodeIds: [], warnings: [] }),
      relink,
    },
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={createCanvasNodeRegistry([{ component: BuiltinCanvasNode, label: "File", type: "file" }])}
          services={services}
          session={session}
          viewScopeId="relink-preview-race"
        />,
      )
      await Promise.resolve()
    })
    await act(async () => {
      nodesChange?.([{ id: node.id, selected: true, type: "select" }])
      await Promise.resolve()
    })

    const selectRelinkFile = (name: string) => {
      const picker = container.querySelector<HTMLInputElement>('input[data-canvas-resource-picker="relink"]')
      relinkLocalFileAction?.()
      Object.defineProperty(picker, "files", {
        configurable: true,
        value: [new File([name], name, { type: "image/png" })],
      })
      picker?.dispatchEvent(new Event("change", { bubbles: true }))
    }

    await act(async () => {
      selectRelinkFile("first.png")
      // A second picker result can be delivered before React has committed the
      // first preview. Both operations still have to reconcile independently.
      selectRelinkFile("second.png")
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(relinkRequests).toHaveLength(2)
    expect(renderedNodes[0]?.data.resourceState).toMatchObject({
      localPreview: true,
      url: "blob:relink-preview-2",
    })
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:relink-preview-1")

    const firstCanonical = createMediaNode({
      id: node.id,
      position: node.position,
      resource: {
        id: "first-resource",
        kind: "image",
        metadata: { resourceRevision: "first" },
        name: "first.png",
        state: { status: "stale" },
      },
    })
    await act(async () => {
      session.publish(createCanvasDocument({ id: session.getProjection().id, nodes: [firstCanonical] }))
      relinkRequests[0]!.resolve({ authoritativeProjectionDelivered: true, warnings: [] })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(hydrationRequests).toHaveLength(1)

    await act(async () => {
      const hydrated = hydrationRequests[0]!.document
      hydrationRequests[0]!.resolve({
        ...hydrated,
        nodes: hydrated.nodes.map((candidate) => ({
          ...candidate,
          data: {
            ...candidate.data,
            resourceState: { status: "ready" as const, url: "convax-asset://project/first-resource" },
          },
        })),
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes[0]?.data.resourceState).toMatchObject({
      localPreview: true,
      url: "blob:relink-preview-2",
    })

    await act(async () => {
      relinkRequests[1]!.reject(new Error("second relink rejected"))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderedNodes[0]?.data.resourceState).toEqual({ status: "stale" })
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:relink-preview-2")
    expect(hydrationRequests).toHaveLength(2)
    expect(invalidatedNodeIds.at(-1)).toEqual([node.id])

    await act(async () => {
      const hydrated = hydrationRequests[1]!.document
      hydrationRequests[1]!.resolve({
        ...hydrated,
        nodes: hydrated.nodes.map((candidate) => ({
          ...candidate,
          data: {
            ...candidate.data,
            resourceState: { status: "ready" as const, url: "convax-asset://project/first-resource" },
          },
        })),
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes[0]?.data.resourceState).toEqual({
      status: "ready",
      url: "convax-asset://project/first-resource",
    })
  } finally {
    if (root) await act(async () => root?.unmount())
    relinkLocalFileAction = undefined
    if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl)
    else Reflect.deleteProperty(URL, "createObjectURL")
    if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl)
    else Reflect.deleteProperty(URL, "revokeObjectURL")
    await restoreWindow()
  }
})

test("retries only the relink target when a successful local preview blocked canonical hydration", async () => {
  const restoreWindow = installTestWindow()
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL")
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")
  const revokeObjectUrl = mock((_url: string) => undefined)
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:successful-relink-preview",
    writable: true,
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
    writable: true,
  })
  let root: Root | undefined
  renderNodes = true
  relinkLocalFileAction = undefined
  const target = createMediaNode({
    id: "target-image",
    position: { x: 20, y: 40 },
    resource: { id: "target-image", kind: "image", metadata: {}, state: { status: "missing" } },
  })
  const ready = createMediaNode({
    id: "ready-image",
    position: { x: 380, y: 40 },
    resource: {
      id: "ready-image",
      kind: "image",
      metadata: { resourceRevision: "ready" },
      state: { status: "ready", url: "convax-asset://project/ready-image" },
    },
  })
  const session = new NodeEntryCanvasSession(
    createCanvasDocument({ id: "successful-relink-hydration", nodes: [target, ready] }),
  )
  let resolveRelink!: (result: { authoritativeProjectionDelivered?: boolean; warnings: readonly string[] }) => void
  const relink = mock(
    async () =>
      new Promise<{ authoritativeProjectionDelivered?: boolean; warnings: readonly string[] }>((resolve) => {
        resolveRelink = resolve
      }),
  )
  const hydrationRequests: Array<{
    document: CanvasDocument
    resolve(document: CanvasDocument): void
  }> = []
  const invalidatedNodeIds: string[][] = []
  const services = createCanvasServices({
    hydration: {
      hydrateStale({ document }) {
        return new Promise<CanvasDocument>((resolve) => hydrationRequests.push({ document, resolve }))
      },
      markStale(document, shouldInvalidate) {
        const invalidated = document.nodes.filter((candidate) => shouldInvalidate?.(candidate) ?? true)
        invalidatedNodeIds.push(invalidated.map((candidate) => candidate.id))
        return {
          ...document,
          nodes: document.nodes.map((candidate) =>
            (shouldInvalidate?.(candidate) ?? true)
              ? { ...candidate, data: { ...candidate.data, resourceState: { status: "stale" as const } } }
              : candidate,
          ),
        }
      },
    },
    mutation: {
      add: async () => ({ createdNodeIds: [], warnings: [] }),
      relink,
    },
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={createCanvasNodeRegistry([{ component: BuiltinCanvasNode, label: "File", type: "file" }])}
          services={services}
          session={session}
          viewScopeId="successful-relink-hydration"
        />,
      )
      await Promise.resolve()
    })
    await act(async () => {
      nodesChange?.([{ id: target.id, selected: true, type: "select" }])
      await Promise.resolve()
    })

    const picker = container.querySelector<HTMLInputElement>('input[data-canvas-resource-picker="relink"]')
    await act(async () => {
      relinkLocalFileAction?.()
      Object.defineProperty(picker, "files", {
        configurable: true,
        value: [new File(["replacement"], "replacement.png", { type: "image/png" })],
      })
      picker?.dispatchEvent(new Event("change", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes.find((node) => node.id === target.id)?.data.resourceState).toMatchObject({
      localPreview: true,
      url: "blob:successful-relink-preview",
    })

    const canonicalTarget = createMediaNode({
      id: target.id,
      position: target.position,
      resource: {
        id: "replacement-resource",
        kind: "image",
        metadata: { resourceRevision: "replacement" },
        name: "replacement.png",
        state: { status: "stale" },
      },
    })
    await act(async () => {
      session.publish(createCanvasDocument({ id: session.getProjection().id, nodes: [canonicalTarget, ready] }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(hydrationRequests).toHaveLength(1)

    await act(async () => {
      const request = hydrationRequests[0]!.document
      hydrationRequests[0]!.resolve({
        ...request,
        nodes: request.nodes.map((candidate) => ({
          ...candidate,
          data: {
            ...candidate.data,
            resourceState: {
              status: "ready" as const,
              url:
                candidate.id === target.id
                  ? "convax-asset://project/replacement"
                  : "convax-asset://project/ready-image",
            },
          },
        })),
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(renderedNodes.find((node) => node.id === target.id)?.data.resourceState).toMatchObject({
      localPreview: true,
    })
    expect(renderedNodes.find((node) => node.id === ready.id)?.data.resourceState).toEqual({
      status: "ready",
      url: "convax-asset://project/ready-image",
    })

    await act(async () => {
      resolveRelink({ authoritativeProjectionDelivered: true, warnings: [] })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(hydrationRequests).toHaveLength(2)
    expect(invalidatedNodeIds.at(-1)).toEqual([target.id])
    expect(
      hydrationRequests[1]!.document.nodes.find((candidate) => candidate.id === ready.id)?.data.resourceState,
    ).toEqual({ status: "ready", url: "convax-asset://project/ready-image" })

    await act(async () => {
      const request = hydrationRequests[1]!.document
      hydrationRequests[1]!.resolve({
        ...request,
        nodes: request.nodes.map((candidate) =>
          candidate.id === target.id
            ? {
                ...candidate,
                data: {
                  ...candidate.data,
                  resourceState: { status: "ready" as const, url: "convax-asset://project/replacement" },
                },
              }
            : candidate,
        ),
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes.find((node) => node.id === target.id)?.data.resourceState).toEqual({
      status: "ready",
      url: "convax-asset://project/replacement",
    })
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:successful-relink-preview")
  } finally {
    if (root) await act(async () => root?.unmount())
    relinkLocalFileAction = undefined
    if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl)
    else Reflect.deleteProperty(URL, "createObjectURL")
    if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl)
    else Reflect.deleteProperty(URL, "revokeObjectURL")
    await restoreWindow()
  }
})

test("projects a dropped local file before the host mutation settles and reconciles it after authority arrives", async () => {
  const restoreWindow = installTestWindow()
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "optimistic-upload" }))
  let resolveMutation: ((value: { createdNodeIds: readonly string[]; warnings: readonly string[] }) => void) | undefined
  let rejectMutation: ((reason?: unknown) => void) | undefined
  const mutation = mock(
    async (_input: CanvasResourceMutationRequest) =>
      new Promise<{ createdNodeIds: readonly string[]; warnings: readonly string[] }>((resolve, reject) => {
        resolveMutation = resolve
        rejectMutation = reject
      }),
  )

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={createTestRegistry()}
          ref={editorRef}
          services={createCanvasServices({ mutation: { add: mutation } })}
          session={session}
          viewScopeId="optimistic-upload"
        />,
      )
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    const file = new File(["image"], "instant.png", { type: "image/png" })
    const drop = (selectedFile: File) => {
      const event = new Event("drop", { bubbles: true })
      Object.defineProperty(event, "clientX", { value: 120 })
      Object.defineProperty(event, "clientY", { value: 160 })
      Object.defineProperty(event, "dataTransfer", {
        value: { files: [selectedFile], getData: () => "", types: ["Files"] },
      })
      canvas.dispatchEvent(event)
    }

    await act(async () => {
      drop(file)
      await Promise.resolve()
    })

    expect(mutation).toHaveBeenCalledTimes(1)
    expect(renderedNodes).toHaveLength(1)
    expect(renderedNodes[0]).toMatchObject({ data: { kind: "image", name: "instant.png", status: "pending" } })
    expect(renderedNodes[0]).toMatchObject({
      connectable: false,
      deletable: false,
      draggable: false,
      focusable: false,
      selected: true,
      selectable: false,
    })
    expect(renderedNodes[0]?.id.startsWith("ghost-resource:")).toBeTrue()
    expect(session.getProjection().nodes).toEqual([])

    const authoritative = createMediaNode({
      id: "authoritative-image",
      position: { x: 0, y: 0 },
      resource: {
        id: "authoritative-image",
        kind: "image",
        metadata: {},
        name: "instant.png",
        state: { status: "ready" },
      },
    })
    await act(async () => {
      session.publish({ ...session.getProjection(), nodes: [authoritative] })
      resolveMutation?.({ createdNodeIds: [authoritative.id], warnings: [] })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderedNodes.map((node) => node.id)).toEqual([
      "authoritative-image",
      expect.stringMatching(/^ghost-resource:/),
    ])
    await act(async () => waitForAnimationFrames(2))
    expect(renderedNodes.map((node) => node.id)).toEqual(["authoritative-image"])

    const failedFile = new File(["video"], "failed.mp4", { type: "video/mp4" })
    await act(async () => {
      drop(failedFile)
      await new Promise((resolve) => setTimeout(resolve, 90))
    })
    expect(renderedNodes).toHaveLength(2)
    expect(renderedNodes[1]).toMatchObject({ data: { kind: "video", name: "failed.mp4", status: "pending" } })

    await act(async () => {
      rejectMutation?.(new Error("import failed"))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes.map((node) => node.id)).toEqual(["authoritative-image"])
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("never publishes a shifted late image ghost after fast authority beats the renderer probe", async () => {
  const restoreWindow = installTestWindow()
  const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap")
  let resolveBitmap: ((bitmap: ImageBitmap) => void) | undefined
  const createImageBitmap = mock(
    () =>
      new Promise<ImageBitmap>((resolve) => {
        resolveBitmap = resolve
      }),
  )
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: createImageBitmap,
    writable: true,
  })
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "authority-before-image-probe" }))
  const authoritative = createMediaNode({
    id: "fast-authoritative-image",
    position: { x: 0, y: 70 },
    resource: {
      id: "fast-authoritative-image",
      kind: "image",
      metadata: {},
      name: "deferred.png",
      state: { status: "ready" },
    },
  })
  const mutation = mock(async () => {
    session.publish(createCanvasDocument({ id: session.getProjection().id, nodes: [authoritative] }))
    return {
      authoritativeProjectionDelivered: true,
      createdNodeIds: [authoritative.id],
      warnings: [],
    }
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={createTestRegistry()}
          ref={editorRef}
          services={createCanvasServices({ mutation: { add: mutation } })}
          session={session}
          viewScopeId="authority-before-image-probe"
        />,
      )
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    const file = new File(["image"], "deferred.png", { type: "image/png" })

    await act(async () => {
      const event = new Event("drop", { bubbles: true })
      Object.defineProperty(event, "clientX", { value: 120 })
      Object.defineProperty(event, "clientY", { value: 160 })
      Object.defineProperty(event, "dataTransfer", {
        value: { files: [file], getData: () => "", types: ["Files"] },
      })
      canvas.dispatchEvent(event)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    const immediateGhost = renderedNodes.find((node) => node.id.startsWith("ghost-resource:"))
    expect(renderedNodes.map((node) => node.id)).toEqual([authoritative.id, expect.stringMatching(/^ghost-resource:/)])
    expect(immediateGhost?.position).toEqual(authoritative.position)

    await act(async () => {
      resolveBitmap?.({ close: () => undefined, height: 900, width: 1_600 } as ImageBitmap)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes.map((node) => node.id)).toEqual([authoritative.id])

    await act(async () => waitForAnimationFrames(2))
    expect(renderedNodes.map((node) => node.id)).toEqual([authoritative.id])
    expect(renderedNodes[0]?.position).toEqual(authoritative.position)
  } finally {
    if (root) await act(async () => root?.unmount())
    if (originalCreateImageBitmap) {
      Object.defineProperty(globalThis, "createImageBitmap", originalCreateImageBitmap)
    } else {
      Reflect.deleteProperty(globalThis, "createImageBitmap")
    }
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

test("lets the latest rapid node focus supersede unresolved camera motion", async () => {
  const restoreWindow = installTestWindow()
  const viewRegistry = createCanvasViewRegistry()
  const neverFinishes = new Promise<void>(() => undefined)
  let smoothMotionCount = 0
  let root: Root | undefined
  renderNodes = true
  setViewport.mockImplementation(async (_viewport, options?: { duration?: number }) => {
    if ((options?.duration ?? 0) <= 0) return
    smoothMotionCount += 1
    if (smoothMotionCount === 1) await neverFinishes
  })

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({
            id: "rapid-focus",
            nodes: [
              createMediaNode({
                id: "focus-a",
                position: { x: 20, y: 40 },
                resource: { id: "focus-a", kind: "image", metadata: {}, state: { status: "ready" } },
              }),
              createMediaNode({
                id: "focus-b",
                position: { x: 1_200, y: 640 },
                resource: { id: "focus-b", kind: "image", metadata: {}, state: { status: "ready" } },
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

    const request = (nodeId: string) =>
      viewRegistry.execute({
        command: { animation: "smooth", fit: "center", nodeIds: [nodeId], select: true, type: "nodes.reveal" },
        expectedDocumentId: "rapid-focus",
        expectedScopeId: "project-a",
        viewId: "main",
      })
    let firstSettled = false
    const first = request("focus-a").finally(() => {
      firstSettled = true
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    let secondResult!: Awaited<ReturnType<typeof request>>
    await act(async () => {
      secondResult = await request("focus-b")
    })
    expect(smoothMotionCount).toBe(2)
    expect(firstSettled).toBeTrue()
    expect(secondResult.snapshot.selectedNodeIds).toEqual(["focus-b"])

    await first
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("does not apply a superseded reveal after a newer group focus request", async () => {
  const restoreWindow = installTestWindow()
  const viewRegistry = createCanvasViewRegistry()
  let root: Root | undefined
  renderNodes = true

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const child = (id: string, parentId: string) => ({
      ...createMediaNode({
        id,
        position: { x: 20, y: 40 },
        resource: { id, kind: "image", metadata: {}, state: { status: "ready" } },
      }),
      parentId,
    })
    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={createCanvasDocument({
            id: "rapid-group-focus",
            nodes: [
              createGroupNode({ id: "group-a", position: { x: 0, y: 0 }, width: 500, height: 360 }),
              createGroupNode({ id: "group-b", position: { x: 700, y: 0 }, width: 500, height: 360 }),
              child("child-a", "group-a"),
              child("child-b", "group-b"),
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

    const request = (nodeId: string) =>
      viewRegistry.execute({
        command: { animation: "smooth", fit: "center", nodeIds: [nodeId], select: true, type: "nodes.reveal" },
        expectedDocumentId: "rapid-group-focus",
        expectedScopeId: "project-a",
        viewId: "main",
      })
    let firstResult!: Awaited<ReturnType<typeof request>>
    let secondResult!: Awaited<ReturnType<typeof request>>
    await act(async () => {
      const first = request("child-a")
      const second = request("child-b")
      ;[firstResult, secondResult] = await Promise.all([first, second])
    })

    expect(firstResult.snapshot.selectedNodeIds).not.toEqual(["child-a"])
    expect(secondResult.snapshot.selectedNodeIds).toEqual(["child-b"])
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("places, focuses, and hands off a top-toolbar-created empty node without a second entrance", async () => {
  const restoreWindow = installTestWindow()
  const occupied = createMediaNode({
    id: "occupied",
    position: { x: 240, y: 200 },
    resource: { id: "occupied", kind: "image", metadata: {}, state: { status: "ready" } },
  })
  const occupiedSize = getCanvasNodePresentationSize(occupied)
  const initial = createCanvasDocument({
    id: "header-create-focus",
    nodes: [occupied],
  })
  let authoritative = initial
  const session = new NodeEntryCanvasSession(initial)
  let requestedAnchor: { x: number; y: number } | undefined
  let root: Root | undefined

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
                    createTextNode({
                      id: "header-created",
                      metadata: {},
                      position: input.anchor,
                      resourceState: { status: "ready", text: "" },
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
    expect(requestedAnchor!.y + 180).toBeLessThanOrEqual(800)
    expect(
      requestedAnchor!.x < occupied.position.x + occupiedSize.width &&
        requestedAnchor!.x + 320 > occupied.position.x &&
        requestedAnchor!.y < occupied.position.y + occupiedSize.height &&
        requestedAnchor!.y + 180 > occupied.position.y,
    ).toBeFalse()
    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 400)).toBeTrue()
    expect(
      container.querySelector('[data-id="header-created"] .convax-node')?.hasAttribute("data-canvas-node-entry-phase"),
    ).toBeFalse()
    expect(
      container.querySelector('[data-id="header-created"] .convax-node')?.hasAttribute("data-canvas-node-entering"),
    ).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps a focused ghost until the authoritative text surface has committed focus", async () => {
  const testWindow = new Window({ url: "https://convax.test/" })
  const testDocument = testWindow.document
  const root = testDocument.createElement("div")
  const container = testDocument.createElement("div")
  container.className = "react-flow__node"
  container.dataset.id = "authoritative-text"
  const surface = testDocument.createElement("div")
  surface.dataset.canvasNodeKind = "text"
  const textEditor = testDocument.createElement("div")
  textEditor.className = "convax-text-editor"
  const prosemirror = testDocument.createElement("div")
  prosemirror.className = "convax-text-editor__prosemirror"
  textEditor.append(prosemirror)
  surface.append(textEditor)
  container.append(surface)
  root.append(container)
  const canvasDocument = createCanvasDocument({
    id: "focused-handoff-readiness",
    nodes: [
      createTextNode({
        id: "authoritative-text",
        metadata: {},
        position: { x: 20, y: 40 },
        resourceState: { status: "ready", text: "" },
      }),
    ],
  })

  expect(
    isCanvasAuthoritativeResourceReadyForOptimisticHandoff({
      document: canvasDocument,
      focusVisible: true,
      nodeIds: ["authoritative-text"],
      root,
    }),
  ).toBeFalse()
  container.classList.add("selected")
  expect(
    isCanvasAuthoritativeResourceReadyForOptimisticHandoff({
      document: canvasDocument,
      focusVisible: true,
      nodeIds: ["authoritative-text"],
      root,
    }),
  ).toBeTrue()
  prosemirror.remove()
  expect(
    isCanvasAuthoritativeResourceReadyForOptimisticHandoff({
      document: canvasDocument,
      focusVisible: true,
      nodeIds: ["authoritative-text"],
      root,
    }),
  ).toBeFalse()
  await testWindow.happyDOM.close()
})

test("matches optimistic batch bounds independently of canonical receipt id order", () => {
  const document = createCanvasDocument({
    id: "reverse-bounds",
    nodes: [
      createTextNode({
        id: "z-first",
        metadata: {},
        position: { x: 20, y: 40 },
        resourceState: { status: "ready", text: "" },
      }),
      createTextNode({
        id: "a-second",
        metadata: {},
        position: { x: 364, y: 40 },
        resourceState: { status: "ready", text: "" },
      }),
    ],
  })
  const ghosts = [
    {
      kind: "ghost-node" as const,
      position: { x: 20, y: 40 },
      presentation: { nodeType: "text" as const, title: "First" },
      presentationKey: "ghost-first",
      size: { height: 180, width: 320 },
    },
    {
      kind: "ghost-node" as const,
      position: { x: 364, y: 40 },
      presentation: { nodeType: "text" as const, title: "Second" },
      presentationKey: "ghost-second",
      size: { height: 180, width: 320 },
    },
  ]

  expect(canvasAuthorityMatchesOptimisticResourceBounds(ghosts, ["a-second", "z-first"], document)).toBeTrue()
})

test("starts top-toolbar text focus from the optimistic node before the host mutation settles", async () => {
  const restoreWindow = installTestWindow()
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "optimistic-text-focus" }))
  let requestedAnchor: { x: number; y: number } | undefined
  let resolveMutation: ((value: { createdNodeIds: readonly string[]; warnings: readonly string[] }) => void) | undefined
  let root: Root | undefined
  renderNodes = true
  setViewport.mockClear()

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
              add: async (input) => {
                requestedAnchor = input.anchor
                return new Promise((resolve) => {
                  resolveMutation = resolve
                })
              },
            },
          })}
          session={session}
          viewScopeId="optimistic-text-focus"
        />,
      )
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1200, top: 0, width: 1200 }),
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Add node"]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Add Text"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestedAnchor).toBeDefined()
    expect(session.getProjection().nodes).toEqual([])
    expect(renderedNodes).toHaveLength(1)
    expect(renderedNodes[0]?.id.startsWith("ghost-resource:")).toBeTrue()
    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 400)).toBeTrue()

    const authoritative = createTextNode({
      id: "authoritative-text",
      metadata: {},
      position: requestedAnchor!,
      resourceState: { status: "ready", text: "" },
    })
    await act(async () => {
      session.publish({ ...session.getProjection(), nodes: [authoritative] })
      resolveMutation?.({ createdNodeIds: [authoritative.id], warnings: [] })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes.map((node) => node.id)).toEqual([
      "authoritative-text",
      expect.stringMatching(/^ghost-resource:/),
    ])
    expect(renderedNodes.every((node) => node.selected)).toBeTrue()
    await act(async () => waitForAnimationFrames(2))
    expect(renderedNodes.map((node) => node.id)).toEqual(["authoritative-text"])
    expect(setViewport.mock.calls.filter((call) => call[1]?.duration === 400)).toHaveLength(1)
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("does not restart batch focus when receipt node ids reverse item order", async () => {
  const restoreWindow = installTestWindow()
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "reverse-batch-bounds" }))
  let root: Root | undefined
  renderNodes = true

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
                const first = createTextNode({
                  id: "z-first",
                  metadata: {},
                  position: input.anchor,
                  resourceState: { status: "ready", text: "" },
                })
                const second = createTextNode({
                  id: "a-second",
                  metadata: {},
                  position: { x: input.anchor.x + 344, y: input.anchor.y },
                  resourceState: { status: "ready", text: "" },
                })
                session.publish({ ...session.getProjection(), nodes: [first, second] })
                return {
                  authoritativeProjectionDelivered: true,
                  createdNodeIds: [second.id, first.id],
                  warnings: [],
                }
              },
            },
          })}
          session={session}
          viewScopeId="reverse-batch-bounds"
        />,
      )
      await Promise.resolve()
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1_200, top: 0, width: 1_200 }),
    })
    setViewport.mockClear()

    const picker = container.querySelector<HTMLInputElement>('input[data-canvas-resource-picker="upload"]')
    await act(async () => {
      Object.defineProperty(picker, "files", {
        configurable: true,
        value: [
          new File(["First"], "first.txt", { type: "text/plain" }),
          new File(["Second"], "second.txt", { type: "text/plain" }),
        ],
      })
      picker?.dispatchEvent(new Event("change", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await waitForAnimationFrames(4)
    })

    const authoritativeNodes = renderedNodes.filter((node) => !node.id.startsWith("ghost-resource:"))
    expect(authoritativeNodes.map((node) => node.id)).toEqual(["z-first", "a-second"])
    expect(authoritativeNodes.every((node) => node.selected)).toBeTrue()
    expect(setViewport.mock.calls.filter((call) => call[1]?.duration === 400)).toHaveLength(1)
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps the latest created-node focus when two mutations settle in reverse order", async () => {
  const restoreWindow = installTestWindow()
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "reverse-resource-focus" }))
  const requests: Array<{
    anchor: { x: number; y: number }
    resolve: (value: {
      authoritativeProjectionDelivered: true
      createdNodeIds: readonly string[]
      warnings: readonly string[]
    }) => void
  }> = []
  let root: Root | undefined
  renderNodes = true

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
              add: async (input) =>
                new Promise((resolve) => {
                  requests.push({ anchor: input.anchor, resolve })
                }),
            },
          })}
          session={session}
          viewScopeId="reverse-resource-focus"
        />,
      )
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")!
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 800, height: 800, left: 0, right: 1200, top: 0, width: 1200 }),
    })
    const addText = async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Add node"]')?.click()
      await Promise.resolve()
      container.querySelector<HTMLButtonElement>('button[aria-label="Add Text"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    }
    await act(addText)
    await act(addText)
    expect(requests).toHaveLength(2)

    const first = createTextNode({
      id: "created-first",
      metadata: {},
      position: requests[0]!.anchor,
      resourceState: { status: "ready", text: "" },
    })
    const second = createTextNode({
      id: "created-second",
      metadata: {},
      position: requests[1]!.anchor,
      resourceState: { status: "ready", text: "" },
    })
    await act(async () => {
      session.publish({ ...session.getProjection(), nodes: [second] })
      requests[1]!.resolve({
        authoritativeProjectionDelivered: true,
        createdNodeIds: [second.id],
        warnings: [],
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes.find((node) => node.id === second.id)?.selected).toBeTrue()

    await act(async () => {
      session.publish({ ...session.getProjection(), nodes: [second, first] })
      requests[0]!.resolve({
        authoritativeProjectionDelivered: true,
        createdNodeIds: [first.id],
        warnings: [],
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await waitForAnimationFrames(2)
    })
    expect(renderedNodes.map((node) => ({ id: node.id, selected: Boolean(node.selected) }))).toContainEqual({
      id: first.id,
      selected: false,
    })
    expect(renderedNodes.find((node) => node.id === second.id)?.selected).toBeTrue()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("offers atomic text, image, and video creation but not non-atomic Agent creation after dragging a connection", async () => {
  const restoreWindow = installTestWindow()
  const editorRef = createRef<CanvasEditorHandle | null>()
  let root: Root | undefined
  renderNodes = true
  nextNodeId = 0
  resourceMutations.length = 0
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
    const imageOption = [...(pendingMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])].find(
      (button) => button.textContent?.includes("Image"),
    )
    const videoOption = [...(pendingMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])].find(
      (button) => button.textContent?.includes("Video"),
    )
    expect(pendingMenu).toBeDefined()
    expect(agentOption).toBeUndefined()
    expect(textOption).toBeDefined()
    expect(imageOption).toBeDefined()
    expect(videoOption).toBeDefined()

    await act(async () => {
      imageOption?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(resourceMutations).toHaveLength(1)
    expect(resourceMutations[0]).toMatchObject({
      files: [],
      pending: { kind: "image", label: "Image" },
      relation: { anchorNodeIds: ["hydrated"], direction: "from-anchor", mode: "connect" },
      sources: [],
    })
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

test("hides a deleted node immediately and restores it when the authoritative command fails", async () => {
  const restoreWindow = installTestWindow()
  let root: Root | undefined
  renderNodes = true
  const node = createMediaNode({
    id: "optimistic-delete",
    position: { x: 20, y: 40 },
    resource: { id: "optimistic-delete", kind: "image", metadata: {}, state: { status: "ready" } },
  })
  const session = new NodeEntryCanvasSession(createCanvasDocument({ id: "optimistic-delete-canvas", nodes: [node] }))
  let resolveCommand: (() => void) | undefined
  let rejectCommand: ((error: Error) => void) | undefined
  const executeCommand = mock(
    () =>
      new Promise<void>((resolve, reject) => {
        resolveCommand = resolve
        rejectCommand = reject
      }),
  )
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
      nodesChange?.([{ id: node.id, selected: true, type: "select" }])
      await Promise.resolve()
    })
    const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Delete"),
    )
    expect(deleteButton).toBeDefined()
    await act(async () => {
      deleteButton?.click()
      await Promise.resolve()
    })
    expect(executeCommand).toHaveBeenCalledWith({ type: "elements.remove", nodeIds: [node.id], edgeIds: [] })
    expect(renderedNodes).toEqual([])

    await act(async () => {
      rejectCommand?.(new Error("delete rejected"))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderedNodes.map((candidate) => candidate.id)).toEqual([node.id])
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      title: "Could not delete Canvas elements",
      description: "delete rejected",
    })

    await act(async () => {
      nodesChange?.([{ id: node.id, selected: true, type: "select" }])
      await Promise.resolve()
    })
    const retryDeleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Delete"),
    )
    await act(async () => {
      retryDeleteButton?.click()
      await Promise.resolve()
      session.publish(createCanvasDocument({ id: "optimistic-delete-canvas" }))
      resolveCommand?.()
      await Promise.resolve()
    })
    expect(renderedNodes).toEqual([])
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
    const imageOption = [
      ...(connectionMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
    ].find((button) => button.textContent?.includes("Image"))
    const videoOption = [
      ...(connectionMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
    ].find((button) => button.textContent?.includes("Video"))
    expect(connectionMenu).toBeDefined()
    expect(agentOption).toBeUndefined()
    expect(textOption).toBeDefined()
    expect(imageOption).toBeDefined()
    expect(videoOption).toBeDefined()
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
  let root: Root | undefined
  renderNodes = true

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

    const textOption = [...container.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find((button) =>
      button.textContent?.includes("Text"),
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
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("applies the host-routed external drag hold and clears it before picker-created image entry", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({ id: "picker-create-entry" })
  let authoritative = initial
  const session = new NodeEntryCanvasSession(initial)
  let resolveCamera!: () => void
  const cameraFinished = new Promise<void>((resolve) => {
    resolveCamera = resolve
  })
  const prepare = mock(async () => ({ dispose: () => undefined, start: () => undefined }))
  const editorRef = createRef<CanvasEditorHandle>()
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
          ref={editorRef}
          selectionDragSource={{
            id: "native-files",
            label: "Keep holding Command-Shift",
            prepare,
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

    const chordDown = () => {
      const event = new Event("keydown", { bubbles: true })
      Object.defineProperties(event, {
        key: { value: "Shift" },
        metaKey: { value: true },
        shiftKey: { value: true },
      })
      return event
    }
    await act(async () => {
      window.dispatchEvent(chordDown())
      await Promise.resolve()
    })
    expect(prepare).not.toHaveBeenCalled()

    const outsideCanvas = document.createElement("button")
    document.body.append(outsideCanvas)
    const noDragSurface = document.createElement("div")
    noDragSurface.className = "nodrag"
    const image = document.createElement("img")
    noDragSurface.append(image)
    canvas.append(noDragSurface)
    outsideCanvas.focus()
    await act(async () => {
      image.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      editorRef.current?.setExternalDragShortcutHeld(true)
      await Promise.resolve()
    })
    expect(document.activeElement).toBe(canvas)
    expect(prepare).toHaveBeenCalledTimes(1)

    await act(async () => {
      const focusOut = new Event("focusout", { bubbles: true })
      Object.defineProperty(focusOut, "relatedTarget", { value: outsideCanvas })
      canvas.dispatchEvent(focusOut)
      outsideCanvas.focus()
      editorRef.current?.setExternalDragShortcutHeld(false)
      await Promise.resolve()
    })
    expect(container.querySelector("[data-canvas-selection-drag-hint]")).toBeNull()

    await act(async () => {
      window.dispatchEvent(chordDown())
      await Promise.resolve()
    })
    expect(prepare).toHaveBeenCalledTimes(1)

    await act(async () => {
      canvas.focus()
      editorRef.current?.setExternalDragShortcutHeld(true)
      await Promise.resolve()
    })
    expect(prepare).toHaveBeenCalledTimes(2)

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
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()

    await act(async () => {
      resolveCamera()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(created?.hasAttribute("data-canvas-node-entering")).toBeFalse()
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("focuses a context-menu-created empty text node at the click point", async () => {
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
  let root: Root | undefined
  renderNodes = true

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
    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 400)).toBeTrue()
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()
    expect(created?.hasAttribute("data-canvas-node-entering")).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps a context-menu-created node visible if the user navigates before optimistic focus finishes", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({
    id: "context-create-interrupt",
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
  const cameraFinished = new Promise<void>(() => undefined)
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
                    createMediaNode({
                      id: "context-created",
                      position: input.anchor,
                      resource: {
                        id: "context-created",
                        kind: "image",
                        metadata: {},
                        state: { status: "ready" },
                      },
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

    const contextAddImage = [...container.querySelectorAll<HTMLButtonElement>("[data-test-context-menu-item]")].find(
      (button) => button.textContent?.includes("Add Image"),
    )
    expect(contextAddImage).toBeDefined()

    await act(async () => {
      container
        .querySelector(".react-flow__pane")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 960, clientY: 640 }))
      await Promise.resolve()
      contextAddImage?.click()
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      await Promise.resolve()
    })

    const created = container.querySelector<HTMLElement>('[data-id="context-created"] .convax-node')
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()

    await act(async () => {
      moveStart?.(new MouseEvent("mousedown"))
      await Promise.resolve()
    })
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("shows a context-menu-created node immediately if optimistic camera motion never finishes", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({
    id: "context-create-hang",
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
  const cameraFinished = new Promise<void>(() => undefined)
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
                    createMediaNode({
                      id: "context-created",
                      position: input.anchor,
                      resource: {
                        id: "context-created",
                        kind: "image",
                        metadata: {},
                        state: { status: "ready" },
                      },
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

    const contextAddImage = [...container.querySelectorAll<HTMLButtonElement>("[data-test-context-menu-item]")].find(
      (button) => button.textContent?.includes("Add Image"),
    )
    expect(contextAddImage).toBeDefined()

    await act(async () => {
      container
        .querySelector(".react-flow__pane")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 960, clientY: 640 }))
      await Promise.resolve()
      contextAddImage?.click()
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      await Promise.resolve()
    })

    const created = container.querySelector<HTMLElement>('[data-id="context-created"] .convax-node')
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()

    await act(async () => {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, CANVAS_MOTION_DURATION.postMutationReveal + CANVAS_NODE_ENTRY_FINISH_GRACE + 20),
      )
    })
    expect(created?.hasAttribute("data-canvas-node-entry-phase")).toBeFalse()
    expect(created?.hasAttribute("data-canvas-node-entering")).toBeFalse()
  } finally {
    setViewport.mockReset()
    setViewport.mockImplementation(async () => undefined)
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("shows an idle empty image card immediately while the pending create is still in flight", async () => {
  const restoreWindow = installTestWindow()
  const initial = createCanvasDocument({
    id: "empty-card-ghost",
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
  let releaseAdd!: () => void
  const addHeld = new Promise<void>((resolve) => {
    releaseAdd = resolve
  })
  let root: Root | undefined
  renderNodes = true

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
                await addHeld
                authoritative = {
                  ...authoritative,
                  nodes: [
                    ...authoritative.nodes,
                    createMediaNode({
                      id: "empty-created",
                      position: input.anchor,
                      resource: {
                        id: "empty-created",
                        kind: "image",
                        metadata: {},
                        state: { status: "ready" },
                      },
                    }),
                  ],
                }
                session.publish(authoritative)
                return { createdNodeIds: ["empty-created"], warnings: [] }
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

    const contextAddImage = [...container.querySelectorAll<HTMLButtonElement>("[data-test-context-menu-item]")].find(
      (button) => button.textContent?.includes("Add Image"),
    )
    expect(contextAddImage).toBeDefined()

    await act(async () => {
      container
        .querySelector(".react-flow__pane")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 960, clientY: 640 }))
      await Promise.resolve()
      contextAddImage?.click()
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      await Promise.resolve()
    })

    const ghost = renderedNodes.find((node) => node.id.startsWith("ghost-resource:"))
    expect(ghost).toBeDefined()
    expect(ghost?.data.status).toBe("idle")
    expect(isCanvasEmptyMediaNodeData(ghost!.data)).toBeTrue()
    expect(container.querySelector('[data-canvas-empty-media="image"]')).not.toBeNull()
    expect(container.querySelector('[data-canvas-persisted-resource-status="pending"]')).toBeNull()
    expect(container.textContent).not.toContain("正在生成")
    expect(setViewport.mock.calls.some((call) => call[1]?.duration === 400)).toBeTrue()

    await act(async () => {
      releaseAdd()
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      await Promise.resolve()
    })
    expect(container.querySelector('[data-id="empty-created"]')).not.toBeNull()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
