import { afterAll, expect, mock, test } from "bun:test"
import { Window as HappyDOMWindow } from "happy-dom"
import { StrictMode, type ReactNode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { CanvasRendererCollaborationClient, CanvasRendererCommand } from "../collaboration"
import type { CanvasAssistantRequest } from "../services"
import type { CanvasDocument, CanvasNode } from "../types"

const testWindow = new HappyDOMWindow({ url: "https://convax.test/" })
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
const globals = {
  DOMRect: testWindow.DOMRect,
  Element: testWindow.Element,
  Event: testWindow.Event,
  HTMLElement: testWindow.HTMLElement,
  KeyboardEvent: testWindow.KeyboardEvent,
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
  FolderGlyph: (props: { size?: string }) => (
    <span data-ui-folder-glyph="" data-ui-folder-glyph-size={props.size ?? "picker"} />
  ),
  ContextMenu: Passthrough,
  ContextMenuContent: Passthrough,
  ContextMenuItem: Passthrough,
  ContextMenuLabel: Passthrough,
  ContextMenuSeparator: () => null,
  ContextMenuTrigger: Passthrough,
  Dialog: Passthrough,
  DialogClose: Passthrough,
  DialogContent: Passthrough,
  DialogDescription: Passthrough,
  DialogTitle: Passthrough,
  Input: () => <input />,
  Loading: (props: { label?: ReactNode }) => <div role="status">{props.label}</div>,
  LoadingSpinner: () => <span aria-hidden="true" data-ui-loading-spinner="" />,
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
  getCanvasNodeGenerationRun,
  markCanvasNodeGenerationRunRunning,
  startCanvasNodeGenerationRun,
} = await import("../generation-run")
const { useCanvasEditor } = await import("../editor-context")
const { createCanvasNodeRegistry } = await import("../node-registry")
const { createCanvasServices } = await import("../services")
const { CanvasEditor } = await import("./canvas-editor")
const { useStoreApi } = await import("@xyflow/react")

class RealReactFlowCanvasSession implements CanvasRendererCollaborationClient {
  readonly authority = "project-collaboration-application" as const
  readonly commands: CanvasRendererCommand[] = []
  readonly undoModel = "project-yjs-semantic-history" as const
  private readonly incarnations = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  canRedoValue = false
  canUndoValue = false
  redoRequest: () => Promise<void> = async () => undefined
  undoRequest: () => Promise<void> = async () => undefined

  constructor(private projection: CanvasDocument) {
    for (const node of projection.nodes) this.incarnations.set(node.id, `incarnation-${node.id}`)
  }

  canRedo() {
    return this.canRedoValue
  }

  canUndo() {
    return this.canUndoValue
  }

  async flush() {}

  getProjection() {
    return this.projection
  }

  publish(projection: CanvasDocument, replacements: Readonly<Record<string, string>> = {}) {
    this.projection = projection
    for (const node of projection.nodes) {
      this.incarnations.set(
        node.id,
        replacements[node.id] ?? this.incarnations.get(node.id) ?? `incarnation-${node.id}`,
      )
    }
    for (const listener of this.listeners) listener()
  }

  redo() {
    return this.redoRequest()
  }

  resolveNodeEntity(nodeId: string) {
    const incarnation = this.incarnations.get(nodeId)
    return incarnation && this.projection.nodes.some((node) => node.id === nodeId)
      ? { kind: "node" as const, id: nodeId, incarnation }
      : undefined
  }

  async submit(command: CanvasRendererCommand) {
    this.commands.push(command)
    const updates = new Map(command.body.updates.map((update) => [update.node.id, update]))
    this.publish({
      ...this.projection,
      nodes: this.projection.nodes.map((node) => {
        const update = updates.get(node.id)
        if (
          !update ||
          !this.resolveNodeEntity(node.id) ||
          this.resolveNodeEntity(node.id)?.incarnation !== update.node.incarnation
        )
          return node
        return {
          ...node,
          position: { ...update.position },
          ...(update.size === undefined
            ? {}
            : { style: { ...node.style, height: update.size?.height, width: update.size?.width } }),
        }
      }),
    })
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  undo() {
    return this.undoRequest()
  }
}

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
let emitNodeDimensions: ((nodeId: string, width: number, height: number) => void) | undefined
let readReactFlowMultiSelectionActive: (() => boolean) | undefined
let readReactFlowProjection:
  | (() => {
      edgeIds: string[]
      nodes: Array<{
        id: string
        initialHeight?: number
        initialWidth?: number
        measured?: { height?: number; width?: number }
      }>
    })
  | undefined

function SelectionProbeNode() {
  const editor = useCanvasEditor()
  const store = useStoreApi()
  observedSelection = {
    edgeIds: [...editor.selection.edgeIds],
    nodeIds: [...editor.selection.nodeIds],
  }
  readReactFlowMultiSelectionActive = () => store.getState().multiSelectionActive
  emitConnectedEdgeSelection = () =>
    store.getState().triggerEdgeChanges([{ id: "connected", selected: true, type: "select" }])
  return <div />
}

function TransientStateProbeNode() {
  const store = useStoreApi()
  emitNodeDimensions = (nodeId, width, height) =>
    store.getState().triggerNodeChanges([{ dimensions: { height, width }, id: nodeId, type: "dimensions" }])
  readReactFlowProjection = () => ({
    edgeIds: [...store.getState().edgeLookup.keys()].sort(),
    nodes: [...store.getState().nodeLookup.values()]
      .map((node) => ({
        id: node.id,
        initialHeight: node.internals.userNode.initialHeight,
        initialWidth: node.internals.userNode.initialWidth,
        measured: node.internals.userNode.measured,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })
  return <div data-react-flow-transient-probe="" />
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
      style: { height: 80, width: 120 },
    }
    const second = {
      ...createTextNode({
        id: "second",
        metadata: {},
        position: { x: 360, y: 80 },
        resourceState: { status: "ready" },
      }),
      style: { height: 80, width: 120 },
    }
    const initialDocument = createCanvasDocument({
      edges: [{ id: "connected", source: first.id, target: second.id }],
      id: "box-selection",
      nodes: [first, second],
    })
    let observedDocument = initialDocument
    const session = new RealReactFlowCanvasSession(initialDocument)
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
            nodeRegistry={nodeRegistry}
            onDocumentChange={(next) => {
              observedDocument = next
            }}
            onlyRenderVisibleElements={false}
            services={createCanvasServices()}
            session={session}
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

    await act(async () => {
      canvasRoot?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Shift", metaKey: true, shiftKey: true }),
      )
    })
    expect(readReactFlowMultiSelectionActive?.()).toBeFalse()
    await act(async () => {
      canvasRoot?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          isPrimary: true,
          metaKey: true,
          pointerId: 99,
        }),
      )
    })
    expect(readReactFlowMultiSelectionActive?.()).toBeTrue()
    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0, isPrimary: true, metaKey: true, pointerId: 99 }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(readReactFlowMultiSelectionActive?.()).toBeFalse()

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
      session.publish(structuredClone(initialDocument), { first: "replacement-first-incarnation" })
      await Promise.resolve()
    })
    expect(observedDocument).not.toBe(initialDocument)
    expect(observedSelection).toEqual({ edgeIds: ["connected"], nodeIds: ["second"] })

    await act(async () => {
      root?.render(
        <StrictMode>
          <CanvasEditor
            fileRendererRegistry={createCanvasFileRendererRegistry()}
            nodeRegistry={nodeRegistry}
            onlyRenderVisibleElements={false}
            services={createCanvasServices()}
            session={session}
            viewScopeId="replacement-scope"
          />
        </StrictMode>,
      )
    })
    expect(observedSelection).toEqual({ edgeIds: [], nodeIds: [] })

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

test("keeps adaptive measurements across an equivalent plugin refresh and resets them at exact cache boundaries", async () => {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })

  emitNodeDimensions = undefined
  readReactFlowProjection = undefined
  const errors: Error[] = []
  const pluginNode: CanvasNode = {
    ...createTextNode({
      id: "plugin-card",
      metadata: { source: "plugin.example/card" },
      position: { x: 80, y: 80 },
      resourceState: { status: "ready" },
    }),
    data: {
      kind: "plugin-card",
      label: "Plugin card",
      metadata: { source: "plugin.example/card" },
      resourceState: { status: "ready" },
    },
    style: { height: 160, width: 280 },
  }
  const initialDocument = createCanvasDocument({ id: "plugin-measurement-cache", nodes: [pluginNode] })
  const session = new RealReactFlowCanvasSession(initialDocument)
  const nodeRegistry = createCanvasNodeRegistry([
    {
      component: TransientStateProbeNode,
      create: ({ position }) => createTextNode({ metadata: {}, position, resourceState: { status: "ready" } }),
      label: "File",
      type: "file",
    },
  ])
  const pluginDefinition = {
    component: TransientStateProbeNode,
    id: "plugin-card",
    label: "Plugin card",
    matches: (data: CanvasNode["data"]) => data.kind === "plugin-card",
  }
  const firstRegistry = createCanvasFileRendererRegistry()
  firstRegistry.register(pluginDefinition)
  const equivalentRegistry = createCanvasFileRendererRegistry()
  const unregisterEquivalent = equivalentRegistry.register({ ...pluginDefinition })
  const container = document.createElement("div")
  document.body.append(container)
  let root: Root | undefined
  const renderEditor = (
    fileRendererRegistry: ReturnType<typeof createCanvasFileRendererRegistry>,
    viewScopeId = "scope-a",
  ) => (
    <CanvasEditor
      fileRendererRegistry={fileRendererRegistry}
      nodeRegistry={nodeRegistry}
      onlyRenderVisibleElements={false}
      services={createCanvasServices()}
      session={session}
      viewScopeId={viewScopeId}
    />
  )

  try {
    root = createRoot(container, {
      onCaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    await act(async () => root?.render(renderEditor(firstRegistry)))
    expect(emitNodeDimensions).toBeFunction()

    await act(async () => emitNodeDimensions?.(pluginNode.id, 480, 270))
    expect(readReactFlowProjection?.().nodes).toEqual([
      { id: pluginNode.id, initialHeight: undefined, initialWidth: undefined, measured: { height: 270, width: 480 } },
    ])
    expect(session.getProjection().nodes[0]).not.toHaveProperty("measured")

    await act(async () => root?.render(renderEditor(equivalentRegistry)))
    expect(readReactFlowProjection?.().nodes[0]?.measured).toEqual({ height: 270, width: 480 })

    await act(async () => root?.render(renderEditor(equivalentRegistry, "scope-b")))
    expect(readReactFlowProjection?.().nodes).toEqual([
      { id: pluginNode.id, initialHeight: 160, initialWidth: 280, measured: undefined },
    ])

    await act(async () => emitNodeDimensions?.(pluginNode.id, 480, 270))
    expect(readReactFlowProjection?.().nodes[0]?.measured).toEqual({ height: 270, width: 480 })

    const authoritativeResize = structuredClone(initialDocument)
    authoritativeResize.nodes[0] = {
      ...authoritativeResize.nodes[0]!,
      style: { height: 200, width: 360 },
    }
    await act(async () => session.publish(authoritativeResize))
    expect(readReactFlowProjection?.().nodes).toEqual([
      { id: pluginNode.id, initialHeight: 200, initialWidth: 360, measured: undefined },
    ])

    await act(async () => emitNodeDimensions?.(pluginNode.id, 500, 300))
    expect(readReactFlowProjection?.().nodes[0]?.measured).toEqual({ height: 300, width: 500 })

    await act(async () => {
      session.publish(structuredClone(initialDocument), { [pluginNode.id]: "replacement-incarnation" })
    })
    expect(readReactFlowProjection?.().nodes).toEqual([
      { id: pluginNode.id, initialHeight: 160, initialWidth: 280, measured: undefined },
    ])

    await act(async () => emitNodeDimensions?.(pluginNode.id, 420, 240))
    expect(readReactFlowProjection?.().nodes[0]?.measured).toEqual({ height: 240, width: 420 })
    await act(async () => unregisterEquivalent())
    expect(readReactFlowProjection?.().nodes).toEqual([
      { id: pluginNode.id, initialHeight: 160, initialWidth: 280, measured: undefined },
    ])
    expect(errors).toEqual([])
  } finally {
    emitNodeDimensions = undefined
    readReactFlowProjection = undefined
    if (root) await act(async () => root?.unmount())
    container.remove()
  }
})

test("projects host undo and redo of a plugin creation group without owning renderer history", async () => {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })

  readReactFlowProjection = undefined
  const source = createTextNode({
    id: "creation-source",
    metadata: {},
    position: { x: 40, y: 40 },
    resourceState: { status: "ready" },
  })
  const created = createTextNode({
    id: "plugin-created",
    metadata: {},
    position: { x: 360, y: 40 },
    resourceState: { status: "ready" },
  })
  const beforeCreation = createCanvasDocument({ id: "plugin-creation-undo", nodes: [source] })
  const afterCreation = createCanvasDocument({
    edges: [{ id: "plugin-created-edge", source: source.id, target: created.id }],
    id: beforeCreation.id,
    nodes: [source, created],
  })
  const session = new RealReactFlowCanvasSession(afterCreation)
  session.canUndoValue = true
  session.undoRequest = async () => {
    session.canUndoValue = false
    session.canRedoValue = true
    session.publish(beforeCreation)
  }
  session.redoRequest = async () => {
    session.canUndoValue = true
    session.canRedoValue = false
    session.publish(afterCreation)
  }
  const nodeRegistry = createCanvasNodeRegistry([
    {
      component: TransientStateProbeNode,
      create: ({ position }) => createTextNode({ metadata: {}, position, resourceState: { status: "ready" } }),
      label: "File",
      type: "file",
    },
  ])
  const container = document.createElement("div")
  document.body.append(container)
  let root: Root | undefined

  try {
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          nodeRegistry={nodeRegistry}
          onlyRenderVisibleElements={false}
          services={createCanvasServices()}
          session={session}
        />,
      )
    })
    expect(readReactFlowProjection?.()).toMatchObject({
      edgeIds: ["plugin-created-edge"],
      nodes: [{ id: source.id }, { id: created.id }],
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")

    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }))
      await Promise.resolve()
    })
    expect(readReactFlowProjection?.()).toMatchObject({ edgeIds: [], nodes: [{ id: source.id }] })

    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true, shiftKey: true }))
      await Promise.resolve()
    })
    expect(readReactFlowProjection?.()).toMatchObject({
      edgeIds: ["plugin-created-edge"],
      nodes: [{ id: source.id }, { id: created.id }],
    })
  } finally {
    readReactFlowProjection = undefined
    if (root) await act(async () => root?.unmount())
    container.remove()
  }
})

test("read-only initialDocument cannot synthesize plugin creation undo without a Main-owned session", async () => {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })

  readReactFlowProjection = undefined
  const source = createTextNode({
    id: "desktop-source",
    metadata: {},
    position: { x: 40, y: 40 },
    resourceState: { status: "ready" },
  })
  const created = createTextNode({
    id: "desktop-plugin-created",
    metadata: {},
    position: { x: 360, y: 40 },
    resourceState: { status: "ready" },
  })
  const initialDocument = createCanvasDocument({
    edges: [{ id: "desktop-plugin-created-edge", source: source.id, target: created.id }],
    id: "desktop-plugin-creation-undo",
    nodes: [source, created],
  })
  const nodeRegistry = createCanvasNodeRegistry([
    {
      component: TransientStateProbeNode,
      create: ({ position }) => createTextNode({ metadata: {}, position, resourceState: { status: "ready" } }),
      label: "File",
      type: "file",
    },
  ])
  const container = document.createElement("div")
  document.body.append(container)
  let root: Root | undefined

  try {
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasEditor
          initialDocument={initialDocument}
          nodeRegistry={nodeRegistry}
          onlyRenderVisibleElements={false}
          services={createCanvasServices()}
        />,
      )
    })
    const canvas = container.querySelector<HTMLElement>(".convax-canvas")
    await act(async () => {
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }))
      await Promise.resolve()
    })
    expect(readReactFlowProjection?.()).toMatchObject({
      edgeIds: ["desktop-plugin-created-edge"],
      nodes: [{ id: created.id }, { id: source.id }],
    })
    expect(initialDocument).toEqual(
      createCanvasDocument({
        edges: [{ id: "desktop-plugin-created-edge", source: source.id, target: created.id }],
        id: "desktop-plugin-creation-undo",
        nodes: [source, created],
      }),
    )
  } finally {
    readReactFlowProjection = undefined
    if (root) await act(async () => root?.unmount())
    container.remove()
  }
})

test("isolates card-assistant wheel gestures only while its input owns focus", async () => {
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
  const textNode = createTextNode({
    id: "text",
    metadata: {},
    position: { x: 80, y: 80 },
    resourceState: { status: "ready" },
  })
  const container = document.createElement("div")
  document.body.append(container)
  let root: Root | undefined
  const initialDocument = createCanvasDocument({ id: "card-assistant-focus", nodes: [textNode] })
  const session = new RealReactFlowCanvasSession(initialDocument)
  const servicesWithAssistant = createCanvasServices({
    assistant: {
      render: () => <textarea aria-label="Card assistant input" />,
    },
  })
  const renderEditor = (services = servicesWithAssistant) => (
    <CanvasEditor onlyRenderVisibleElements={false} services={services} session={session} />
  )

  try {
    root = createRoot(container, {
      onCaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    await act(async () => {
      root?.render(renderEditor())
    })

    const nodeElement = container.querySelector<HTMLElement>('.react-flow__node[data-id="text"]')
    expect(nodeElement).not.toBeNull()
    await act(async () => {
      nodeElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const canvasRoot = container.querySelector<HTMLElement>(".convax-canvas")
    const toolbar = container.querySelector<HTMLElement>(".convax-node-assistant")
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Card assistant input"]')
    expect(canvasRoot).not.toBeNull()
    expect(toolbar).not.toBeNull()
    expect(input).not.toBeNull()
    expect(toolbar?.classList.contains("nodrag")).toBe(true)
    expect(toolbar?.classList.contains("nowheel")).toBe(false)

    await act(async () => {
      input?.focus()
    })
    expect(document.activeElement).toBe(input)
    expect(toolbar?.classList.contains("nowheel")).toBe(true)

    await act(async () => {
      root?.render(renderEditor(createCanvasServices()))
    })
    expect(container.querySelector(".convax-node-assistant")).toBeNull()

    await act(async () => {
      root?.render(renderEditor())
    })
    const reopenedToolbar = container.querySelector<HTMLElement>(".convax-node-assistant")
    expect(reopenedToolbar).not.toBeNull()
    expect(reopenedToolbar?.classList.contains("nowheel")).toBe(false)

    await act(async () => {
      canvasRoot?.focus()
    })
    expect(document.activeElement).toBe(canvasRoot)
    expect(reopenedToolbar?.classList.contains("nowheel")).toBe(false)
    expect(errors).toEqual([])
  } finally {
    if (root) await act(async () => root?.unmount())
    container.remove()
  }
})

test("keeps active controls interactive while a failed card stays selectable without reopening generation", async () => {
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
      return this.getAttribute("data-id") === "generating" ? rect(80, 80, 240, 160) : rect(400, 80, 240, 160)
    }
    return rect(0, 0, 1000, 800)
  }

  const generatingNode: CanvasNode = {
    data: { kind: "image", label: "Generating image", metadata: {} },
    id: "generating",
    position: { x: 80, y: 80 },
    style: { height: 160, width: 240 },
    type: "file",
  }
  const blockedNode: CanvasNode = {
    data: { kind: "image", label: "Interrupted image", metadata: {} },
    id: "blocked",
    position: { x: 400, y: 80 },
    style: { height: 160, width: 240 },
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
  initialDocument = finishCanvasNodeGenerationRun(initialDocument, blockedNode.id, "blocked-operation")

  const container = document.createElement("div")
  document.body.append(container)
  let latestDocument: CanvasDocument = initialDocument
  const session = new RealReactFlowCanvasSession(initialDocument)
  let assistantRequest: CanvasAssistantRequest | undefined
  let root: Root | undefined

  const dragWithMouse = async (target: Element, start: { x: number; y: number }, end: { x: number; y: number }) => {
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
          onlyRenderVisibleElements={false}
          onDocumentChange={(document) => {
            latestDocument = document
          }}
          services={createCanvasServices({
            assistant: {
              render: (request) => {
                assistantRequest = request
                return (
                  <textarea aria-label="Recovered generation prompt" defaultValue={request.generation?.initialPrompt} />
                )
              },
            },
          })}
          session={session}
        />,
      )
    })

    expect(errors).toEqual([])
    const activeOverlay = container.querySelector<HTMLElement>('[data-canvas-file-generation-activity="running"]')
    const cancelButton = [...(activeOverlay?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "取消",
    )
    const failedOverlay = container.querySelector<HTMLElement>('[data-canvas-file-generation-activity="failed"]')
    expect(activeOverlay).not.toBeNull()
    expect(cancelButton).toBeDefined()
    expect(failedOverlay).not.toBeNull()
    expect(failedOverlay?.classList.contains("pointer-events-none")).toBe(true)
    expect(failedOverlay?.querySelector("button")).toBeNull()
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
    await dragWithMouse(failedOverlay!, { x: 440, y: 120 }, { x: 504, y: 168 })
    expect(latestDocument.nodes.find((node) => node.id === blockedNode.id)?.position).not.toEqual(blockedPosition)

    await act(async () => {
      failedOverlay?.closest<HTMLElement>(".react-flow__node")?.click()
      await Promise.resolve()
    })
    expect(failedOverlay?.closest<HTMLElement>(".react-flow__node")?.classList.contains("selected")).toBe(true)
    expect(assistantRequest).toBeUndefined()
    expect(container.querySelector('textarea[aria-label="Recovered generation prompt"]')).toBeNull()
    expect(getCanvasNodeGenerationRun(latestDocument.nodes.find((node) => node.id === blockedNode.id)!)).toMatchObject({
      operationId: "blocked-operation",
      status: "failed",
    })
    expect(errors).toEqual([])
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect
    if (root) await act(async () => root?.unmount())
    container.remove()
  }
})

test("renders alignment guides while a real React Flow node drag is snapped", async () => {
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
  const source = {
    ...createTextNode({
      id: "snap-source",
      metadata: {},
      position: { x: 80, y: 80 },
      resourceState: { status: "ready" },
    }),
    style: { height: 80, width: 120 },
  }
  const target = {
    ...createTextNode({
      id: "snap-target",
      metadata: {},
      position: { x: 300, y: 200 },
      resourceState: { status: "ready" },
    }),
    style: { height: 80, width: 120 },
  }
  const initialDocument = createCanvasDocument({
    id: "node-snap-guides",
    nodes: [source, target],
  })
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList.contains("react-flow__node")) {
      const node = this.getAttribute("data-id") === source.id ? source : target
      const transform = this.style.transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\s*\)/)
      return rect(
        transform ? Number(transform[1]) : node.position.x,
        transform ? Number(transform[2]) : node.position.y,
        120,
        80,
      )
    }
    return rect(0, 0, 1000, 800)
  }

  const container = document.createElement("div")
  document.body.append(container)
  let latestDocument: CanvasDocument = initialDocument
  const session = new RealReactFlowCanvasSession(initialDocument)
  let root: Root | undefined

  try {
    root = createRoot(container, {
      onCaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    await act(async () => {
      root?.render(
        <CanvasEditor
          onlyRenderVisibleElements={false}
          onDocumentChange={(document) => {
            latestDocument = document
          }}
          services={createCanvasServices()}
          session={session}
        />,
      )
    })

    const sourceElement = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${source.id}"]`)
    expect(sourceElement).not.toBeNull()

    await act(async () => {
      sourceElement?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 100,
          clientY: 100,
          view: window,
        }),
      )
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 105,
          clientY: 105,
          view: window,
        }),
      )
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 205,
          clientY: 145,
          view: window,
        }),
      )
      await Promise.resolve()
    })

    expect(sourceElement?.getBoundingClientRect()).toMatchObject({ left: 180, top: 120 })
    expect(latestDocument.nodes.find((node) => node.id === source.id)?.position).toEqual(source.position)
    expect(container.querySelector('[data-canvas-snap-guide="x"]')).not.toBeNull()
    expect(container.querySelector('[data-canvas-snap-guide="y"]')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: 205,
          clientY: 145,
          view: window,
        }),
      )
      await Promise.resolve()
    })

    expect(latestDocument.nodes.find((node) => node.id === source.id)?.position).toEqual({ x: 180, y: 120 })
    expect(container.querySelector("[data-canvas-snap-guide]")).toBeNull()
    expect(errors).toEqual([])
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect
    if (root) await act(async () => root?.unmount())
    container.remove()
  }
})
