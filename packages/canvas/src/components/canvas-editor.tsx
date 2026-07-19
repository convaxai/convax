import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react"
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Input,
  Shortcut,
  Tooltip,
  TooltipProvider,
  cn,
} from "@convax/ui"
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Bot,
  Check,
  ChevronUp,
  ClipboardPaste,
  Columns3,
  Copy,
  Download,
  FileUp,
  Focus,
  Group,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  Magnet,
  MapPinned,
  MousePointer2,
  Redo2,
  Rows3,
  Search,
  Sparkles,
  TriangleAlert,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Video,
  Workflow,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import {
  type ChangeEvent,
  type ForwardedRef,
  type FormEvent,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  applyCanvasBusinessCommand,
  createAddCanvasResourcesCommand,
  findOpenCanvasPoint,
  queryCanvasNodes,
} from "../application"
import {
  addCanvasNodes,
  alignCanvasNodes,
  type CanvasAlign,
  type CanvasDistribute,
  type CanvasLayout,
  connectCanvasNodes,
  distributeCanvasNodes,
  duplicateCanvasSelection,
  groupCanvasNodes,
  layoutCanvasNodes,
  removeCanvasElements,
  ungroupCanvasNode,
} from "../commands"
import {
  canvasClipboardHasScopeConflict,
  createCanvasClipboardPayload,
  parseCanvasClipboard,
  prepareCanvasClipboardPaste,
  serializeCanvasClipboard,
} from "../clipboard"
import { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } from "../builtin-registry"
import { createMediaNode, createTextNode, getCanvasNodeSize, parseCanvasDocument } from "../document"
import { CanvasEditorProvider } from "../editor-context"
import { deriveCanvasSelectionContext, isNodeOnlySelectionContext } from "../selection-context"
import { createCanvasFileNode, type CanvasFileRendererRegistry } from "../file-renderer-registry"
import { canvasHistoryReducer, createCanvasHistory, type CanvasHistoryAction } from "../history"
import type { CanvasNodeRegistry } from "../node-registry"
import { CanvasReloadQueue } from "../reload-queue"
import {
  CanvasSelectionActionExecutor,
  createCanvasSelectionActionContext,
  getVisibleCanvasSelectionActions,
  type CanvasSelectionAction,
} from "../selection-actions"
import {
  CanvasServicesProvider,
  type CanvasServices,
  useCanvasService,
} from "../services"
import type { CanvasDocument, CanvasNode, CanvasPoint, CanvasSelection } from "../types"
import { createCanvasShortcutHandler } from "../use-canvas-shortcuts"
import { useSpacePanning } from "../use-space-panning"
import {
  assertCanvasViewGuard,
  type CanvasViewCommand,
  type CanvasViewCommandResult,
  type CanvasViewExecutionGuard,
  type CanvasViewRegistry,
  type CanvasViewSession,
  type CanvasViewSnapshot,
} from "../view"
import { CanvasConnectionLine, CanvasEdgeView, shouldAnimateCanvasEdge } from "./canvas-edge"
import { PendingConnectionMenu } from "./connection-node-menu"

const edgeTypes = { canvas: CanvasEdgeView } satisfies EdgeTypes

interface CanvasLoadBarrier {
  promise: Promise<void>
  reject(error: unknown): void
  resolve(): void
}

function createCanvasLoadBarrier(resolved = false): CanvasLoadBarrier {
  if (resolved) return { promise: Promise.resolve(), reject: () => undefined, resolve: () => undefined }
  let rejectPromise: (error: unknown) => void = () => undefined
  let resolvePromise: () => void = () => undefined
  const promise = new Promise<void>((resolve, reject) => {
    rejectPromise = reject
    resolvePromise = resolve
  })
  void promise.catch(() => undefined)
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}

function createInitialCanvasHistory(document: CanvasDocument) {
  const normalized = parseCanvasDocument(document, document.id)
  if (!normalized) throw new Error("CanvasEditor received an invalid initial document")
  return createCanvasHistory(normalized)
}

function equalIds(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((id) => right.has(id))
}

function equalCanvasNodes(left: readonly CanvasNode[], right: readonly CanvasNode[]) {
  if (left.length !== right.length) return false
  return left.every((node, index) => {
    const next = right[index]
    if (node === next) return true
    return node.id === next.id
      && node.position.x === next.position.x
      && node.position.y === next.position.y
      && node.measured?.width === next.measured?.width
      && node.measured?.height === next.measured?.height
      && node.width === next.width
      && node.height === next.height
      && node.dragging === next.dragging
      && node.resizing === next.resizing
      && node.hidden === next.hidden
      && node.parentId === next.parentId
      && node.data === next.data
      && node.style === next.style
  })
}

interface PendingConnection {
  nodeId: string
  side: "left" | "right"
  sourceScreen: CanvasPoint
  targetPosition: CanvasPoint
  targetScreen: CanvasPoint
}

interface ConnectionStart extends Pick<PendingConnection, "nodeId" | "side" | "sourceScreen"> {
  pointerScreen: CanvasPoint
}

function getEventClientPoint(event: MouseEvent | TouchEvent): CanvasPoint | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  return { x: event.clientX, y: event.clientY }
}

function getNodeWorldPosition(document: CanvasDocument, nodeId: string): CanvasPoint {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const visited = new Set<string>()
  let current = nodes.get(nodeId)
  let x = 0
  let y = 0
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    x += current.position.x
    y += current.position.y
    current = current.parentId ? nodes.get(current.parentId) : undefined
  }
  return { x, y }
}

export interface CanvasEditorProps {
  className?: string
  clipboardScope?: string
  initialDocument: CanvasDocument
  fileRendererRegistry?: CanvasFileRendererRegistry
  nodeRegistry?: CanvasNodeRegistry
  onlyRenderVisibleElements?: boolean
  onDocumentChange?: (document: CanvasDocument) => void
  readOnly?: boolean
  selectionActions?: readonly CanvasSelectionAction[]
  services: CanvasServices
  title?: string
  viewId?: string
  viewRegistry?: CanvasViewRegistry
  viewScopeId?: string
}

export interface CanvasEditorHandle {
  flush: () => Promise<void>
  prepareToLeave: () => Promise<void>
  reload: () => Promise<void>
  resumeAfterLeaveCanceled: () => void
}

export const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(function CanvasEditor(props, ref) {
  const nodeRegistry = useMemo(
    () => props.nodeRegistry ?? createDefaultCanvasNodeRegistry(),
    [props.nodeRegistry],
  )
  const fileRendererRegistry = useMemo(
    () => props.fileRendererRegistry ?? createDefaultCanvasFileRendererRegistry(),
    [props.fileRendererRegistry],
  )
  return (
    <CanvasServicesProvider services={props.services}>
      <ReactFlowProvider>
        <CanvasEditorContent
          {...props}
          editorRef={ref}
          fileRendererRegistry={fileRendererRegistry}
          nodeRegistry={nodeRegistry}
        />
      </ReactFlowProvider>
    </CanvasServicesProvider>
  )
})

function CanvasEditorContent(props: CanvasEditorProps & {
  editorRef: ForwardedRef<CanvasEditorHandle>
  fileRendererRegistry: CanvasFileRendererRegistry
  nodeRegistry: CanvasNodeRegistry
}) {
  const [history, reduce] = useReducer(canvasHistoryReducer, props.initialDocument, createInitialCanvasHistory)
  const [selection, setSelection] = useState<CanvasSelection>(() => ({ nodeIds: new Set(), edgeIds: new Set() }))
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [edgesHidden, setEdgesHidden] = useState(false)
  const [miniMapVisible, setMiniMapVisible] = useState(true)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [prompt, setPrompt] = useState("")
  const [query, setQuery] = useState("")
  const [generating, setGenerating] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveAttempt, setSaveAttempt] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [insertPoint, setInsertPoint] = useState<CanvasPoint | null>(null)
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)
  const spacePanning = useSpacePanning()
  const rootRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const pointerRef = useRef<CanvasPoint | null>(null)
  const selectionRef = useRef(selection)
  const connectionStartRef = useRef<ConnectionStart | null>(null)
  const ignoreConnectionPaneClickRef = useRef(false)
  const altDragRef = useRef<{ nodeIds: string[]; positions: Map<string, CanvasPoint> } | null>(null)
  const documentRef = useRef(history.document)
  const historyRef = useRef(history)
  const hasLocalEditsRef = useRef(false)
  const saveErrorRef = useRef<string | null>(null)
  const leavingRef = useRef(false)
  const saveControllerRef = useRef<AbortController | undefined>(undefined)
  const savePromiseRef = useRef<Promise<void> | undefined>(undefined)
  const saveRevisionRef = useRef<number | undefined>(undefined)
  const savedRevisionRef = useRef(history.document.revision)
  const reloadQueueRef = useRef(new CanvasReloadQueue())
  const operationControllersRef = useRef(new Set<AbortController>())
  const selectionActionControllerRef = useRef<AbortController | undefined>(undefined)
  const reactFlow = useReactFlow<CanvasNode>()
  const uploadService = useCanvasService("upload")
  const generateService = useCanvasService("generate")
  const persistenceService = useCanvasService("persistence")
  const exportService = useCanvasService("export")
  const notificationService = useCanvasService("notify")
  const telemetryService = useCanvasService("telemetry")
  const [hydrating, setHydrating] = useState(Boolean(persistenceService))
  const hydratingRef = useRef(Boolean(persistenceService))
  const loadBarrierRef = useRef(createCanvasLoadBarrier(!persistenceService))
  documentRef.current = history.document
  historyRef.current = history
  saveErrorRef.current = saveError
  selectionRef.current = selection
  const dispatch = useCallback((action: CanvasHistoryAction) => {
    if (leavingRef.current || hydratingRef.current) return
    if (action.type !== "hydrate" && action.type !== "replace" && action.type !== "replace-update") {
      hasLocalEditsRef.current = true
    }
    reduce(action)
  }, [])
  const registryVersion = useSyncExternalStore(
    props.nodeRegistry.subscribe,
    props.nodeRegistry.getVersion,
    props.nodeRegistry.getVersion,
  )
  const fileRendererRegistryVersion = useSyncExternalStore(
    props.fileRendererRegistry.subscribe,
    props.fileRendererRegistry.getVersion,
    props.fileRendererRegistry.getVersion,
  )

  const readOnly = (props.readOnly ?? false) || leaving || hydrating || Boolean(loadError) || Boolean(saveError)
  const selectedNodeIds = useMemo(() => [...selection.nodeIds], [selection.nodeIds])
  const selectedEdgeIds = useMemo(() => [...selection.edgeIds], [selection.edgeIds])
  const selectionContext = useMemo(() => deriveCanvasSelectionContext(selection), [selection])
  const hasNodeOnlySelection = isNodeOnlySelectionContext(selectionContext)
  const nodeById = useMemo(
    () => new Map(history.document.nodes.map((node) => [node.id, node])),
    [history.document.nodes],
  )
  const hasSingleGroupSelection = selectionContext.kind === "single-node"
    && nodeById.get(selectionContext.nodeId)?.data.kind === "group"
  const arrangeNodeIds = useMemo(() => {
    const ids = [...selection.nodeIds]
    if (ids.length !== 1) return ids
    const selected = nodeById.get(ids[0])
    if (selected?.data.kind !== "group") return ids
    return history.document.nodes.filter((node) => node.parentId === selected.id).map((node) => node.id)
  }, [history.document.nodes, nodeById, selection.nodeIds])
  const arrangeNodes = arrangeNodeIds.flatMap((id) => {
    const node = nodeById.get(id)
    return node ? [node] : []
  })
  const canArrangeSelection = arrangeNodes.length >= 2
    && arrangeNodes.every((node) => node.parentId === arrangeNodes[0]?.parentId)
  const canDistributeSelection = canArrangeSelection && arrangeNodes.length >= 3
  const canvasNodeIds = useMemo(
    () => history.document.nodes.filter((node) => !node.parentId).map((node) => node.id),
    [history.document.nodes],
  )
  const canLayoutCanvas = canvasNodeIds.length >= 2
  const nodes = useMemo(() => {
    const depth = (node: CanvasNode, visited = new Set<string>()): number => {
      if (visited.has(node.id)) return 0
      visited.add(node.id)
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      return parent ? depth(parent, visited) + 1 : 0
    }
    return history.document.nodes
      .map((node) => node.selected === selection.nodeIds.has(node.id)
        ? node
        : { ...node, selected: selection.nodeIds.has(node.id) })
      .sort((left, right) => depth(left) - depth(right))
  }, [history.document.nodes, nodeById, selection.nodeIds])
  const edges = useMemo(() => {
    if (edgesHidden) return []
    return history.document.edges.map((edge) => ({
      ...edge,
      animated: shouldAnimateCanvasEdge(edge, selection),
      selected: selection.edgeIds.has(edge.id),
      type: !edge.type || edge.type === "smoothstep" ? "canvas" : edge.type,
    }))
  }, [edgesHidden, history.document.edges, selection])
  const nodeTypes = useMemo(() => {
    const fallback = props.nodeRegistry.get("file")?.component
    const definitions = props.nodeRegistry.list()
    return Object.fromEntries(
      definitions.flatMap((definition) => {
        const type = definition.type
        const component = props.nodeRegistry.get(type)?.component ?? fallback
        return component ? [[type, component]] : []
      }),
    ) as NodeTypes
  }, [props.nodeRegistry, registryVersion])
  const connectionNodeTypes = useMemo(
    () => [
      ...props.fileRendererRegistry
        .list()
        .filter((definition) => !definition.hidden && definition.create)
        .map((definition) => ({ label: definition.label, type: definition.id })),
      ...props.nodeRegistry
        .list()
        .filter((definition) => !definition.hidden && definition.type === "agent")
        .map((definition) => ({ label: definition.label, type: definition.type })),
    ],
    [fileRendererRegistryVersion, props.fileRendererRegistry, props.nodeRegistry, registryVersion],
  )

  const updateSelection = useCallback((nodeIds: readonly string[], edgeIds: readonly string[] = []) => {
    const next = { nodeIds: new Set(nodeIds), edgeIds: new Set(edgeIds) }
    selectionRef.current = next
    setSelection((current) => {
      if (equalIds(current.nodeIds, next.nodeIds) && equalIds(current.edgeIds, next.edgeIds)) return current
      return next
    })
  }, [])
  const getViewSnapshot = useCallback((): CanvasViewSnapshot => ({
    documentId: documentRef.current.id,
    revision: documentRef.current.revision,
    scopeId: props.viewScopeId ?? "",
    selectedEdgeIds: [...selectionRef.current.edgeIds],
    selectedNodeIds: [...selectionRef.current.nodeIds],
    viewId: props.viewId ?? "",
    viewport: reactFlow.getViewport(),
  }), [props.viewId, props.viewScopeId, reactFlow])
  const waitForStableLoad = useCallback(async () => {
    while (true) {
      const barrier = loadBarrierRef.current
      await barrier.promise
      if (barrier === loadBarrierRef.current && !hydratingRef.current) return
    }
  }, [])
  const executeViewCommand = useCallback(async (
    command: CanvasViewCommand,
    guard?: CanvasViewExecutionGuard,
  ): Promise<CanvasViewCommandResult> => {
    await waitForStableLoad()
    if (guard) assertCanvasViewGuard(getViewSnapshot(), guard)
    const document = documentRef.current
    const existingNodeIds = new Set(document.nodes.map((node) => node.id))
    const resolveNodeIds = (nodeIds: readonly string[]) => ({
      foundNodeIds: [...new Set(nodeIds.filter((nodeId) => existingNodeIds.has(nodeId)))],
      missingNodeIds: [...new Set(nodeIds.filter((nodeId) => !existingNodeIds.has(nodeId)))],
    })
    let foundNodeIds: string[] = []
    let missingNodeIds: string[] = []
    const duration = "animation" in command && command.animation === "smooth" ? 220 : 0

    if (command.type === "selection.clear") updateSelection([])
    if (command.type === "selection.set") {
      const resolved = resolveNodeIds(command.nodeIds ?? [])
      foundNodeIds = resolved.foundNodeIds
      missingNodeIds = resolved.missingNodeIds
      const existingEdgeIds = new Set(document.edges.map((edge) => edge.id))
      updateSelection(foundNodeIds, (command.edgeIds ?? []).filter((edgeId) => existingEdgeIds.has(edgeId)))
    }
    if (command.type === "nodes.reveal") {
      const resolved = resolveNodeIds(command.nodeIds)
      foundNodeIds = resolved.foundNodeIds
      missingNodeIds = resolved.missingNodeIds
      if (command.select) updateSelection(foundNodeIds)
      if ((command.fit ?? "contain") !== "none" && foundNodeIds.length > 0) {
        const ids = new Set(foundNodeIds)
        const renderedNodes = reactFlow.getNodes().filter((node) => ids.has(node.id))
        if (renderedNodes.length > 0) {
          await reactFlow.fitView({
            duration,
            maxZoom: (command.fit ?? "contain") === "center" ? 1.2 : 1.1,
            nodes: renderedNodes,
            padding: (command.fit ?? "contain") === "center" ? 0.8 : 0.3,
          })
        }
      }
    }
    if (command.type === "viewport.fit") {
      const requested = command.nodeIds ?? document.nodes.map((node) => node.id)
      const resolved = resolveNodeIds(requested)
      foundNodeIds = resolved.foundNodeIds
      missingNodeIds = resolved.missingNodeIds
      const ids = new Set(foundNodeIds)
      const renderedNodes = reactFlow.getNodes().filter((node) => ids.has(node.id))
      if (command.nodeIds && renderedNodes.length === 0) {
        return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
      }
      await reactFlow.fitView({
        duration,
        maxZoom: command.maxZoom ?? 1.2,
        nodes: command.nodeIds ? renderedNodes : undefined,
        padding: command.padding ?? 0.3,
      })
    }
    if (command.type === "viewport.center") {
      if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) {
        throw new Error("Canvas viewport center must contain finite coordinates")
      }
      await reactFlow.setCenter(command.position.x, command.position.y, {
        duration,
        zoom: command.zoom,
      })
    }
    if (command.type === "viewport.zoom") {
      if (!Number.isFinite(command.zoom) || command.zoom <= 0) throw new Error("Canvas viewport zoom must be positive")
      await reactFlow.zoomTo(command.zoom, { duration })
    }
    if (command.type === "notification.show") {
      notificationService?.show({
        description: command.description,
        kind: command.kind,
        title: command.title,
      })
    }
    return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
  }, [getViewSnapshot, notificationService, reactFlow, updateSelection, waitForStableLoad])
  const viewSession = useMemo<CanvasViewSession | null>(() => props.viewId ? {
    execute: executeViewCommand,
    getSnapshot: getViewSnapshot,
    whenReady: waitForStableLoad,
    viewId: props.viewId,
  } : null, [executeViewCommand, getViewSnapshot, props.viewId, waitForStableLoad])
  useEffect(() => {
    if (!props.viewRegistry || !viewSession) return
    return props.viewRegistry.register(viewSession)
  }, [props.viewRegistry, viewSession])
  const selectNodes = useCallback((nodeIds: readonly string[]) => updateSelection(nodeIds), [updateSelection])
  const commit = useCallback(
    (update: (document: CanvasDocument) => CanvasDocument) => {
      if (readOnly) return
      dispatch({ type: "commit-update", update })
    },
    [dispatch, readOnly],
  )
  const pointAtCenter = useCallback(() => {
    const bounds = rootRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return reactFlow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
  }, [reactFlow])
  const fitAfterRender = useCallback(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      void reactFlow.fitView({ duration: 220, maxZoom: 1.1, padding: 0.3 })
    }))
  }, [reactFlow])
  const nextInsertPoint = useCallback(
    (index = 0) => {
      const point = insertPoint ?? pointerRef.current ?? pointAtCenter()
      const open = findOpenCanvasPoint(history.document, point)
      return { x: open.x + index * 36, y: open.y + index * 36 }
    },
    [history.document, insertPoint, pointAtCenter],
  )
  const notifyError = useCallback(
    (title: string, error: unknown) => {
      notificationService?.show({ kind: "error", title, description: error instanceof Error ? error.message : String(error) })
    },
    [notificationService],
  )
  const [selectionActionStateVersion, refreshSelectionActionState] = useReducer((version: number) => version + 1, 0)
  const selectionActionsMountedRef = useRef(true)
  const selectionActionErrorRef = useRef(notifyError)
  const selectionActionExecutorRef = useRef<CanvasSelectionActionExecutor | null>(null)
  selectionActionErrorRef.current = notifyError
  if (!selectionActionExecutorRef.current) {
    selectionActionExecutorRef.current = new CanvasSelectionActionExecutor({
      onError: (action, error) => selectionActionErrorRef.current(`Could not run ${action.label}`, error),
      onPendingChange: () => {
        if (selectionActionsMountedRef.current) refreshSelectionActionState()
      },
    })
  }
  const selectionActionExecutor = selectionActionExecutorRef.current
  const selectionActionController = useMemo(
    () => new AbortController(),
    [history.document, readOnly, selectedEdgeIds, selectedNodeIds],
  )
  selectionActionControllerRef.current = selectionActionController
  const selectionActionContext = useMemo(
    () => createCanvasSelectionActionContext(
      history.document,
      selectedNodeIds,
      selectedEdgeIds,
      selectionActionController.signal,
    ),
    [history.document, selectedEdgeIds, selectedNodeIds, selectionActionController],
  )
  const visibleSelectionActions = useMemo(
    () => getVisibleCanvasSelectionActions(props.selectionActions ?? [], selectionActionContext),
    [props.selectionActions, selectionActionContext],
  )
  useEffect(() => {
    selectionActionsMountedRef.current = true
    return () => {
      selectionActionsMountedRef.current = false
    }
  }, [])
  useLayoutEffect(() => {
    refreshSelectionActionState()
    return () => {
      selectionActionController.abort()
      selectionActionExecutor.reset({ notify: false })
    }
  }, [selectionActionController, selectionActionExecutor])
  const executeSelectionAction = useCallback(
    (action: CanvasSelectionAction) => {
      if (
        hydratingRef.current
        || leavingRef.current
        || selectionActionContext.document !== documentRef.current
        || !equalIds(new Set(selectionActionContext.selectedNodeIds), selectionRef.current.nodeIds)
        || !equalIds(new Set(selectionActionContext.selectedEdgeIds), selectionRef.current.edgeIds)
      ) return
      void selectionActionExecutor.execute(action, selectionActionContext)
    },
    [selectionActionContext, selectionActionExecutor],
  )
  const isSelectionActionPending = useCallback(
    (actionId: string) => selectionActionExecutor.isPending(actionId),
    [selectionActionExecutor],
  )
  const startSave = useCallback((document: CanvasDocument) => {
    if (!persistenceService || loadError || document.revision === 0) {
      savedRevisionRef.current = document.revision
      return Promise.resolve()
    }
    if (!saveErrorRef.current && savedRevisionRef.current === document.revision) return Promise.resolve()
    if (saveRevisionRef.current === document.revision && savePromiseRef.current) return savePromiseRef.current

    saveControllerRef.current?.abort()
    setSaveState("saving")
    const controller = new AbortController()
    saveControllerRef.current = controller
    saveRevisionRef.current = document.revision
    const pending = persistenceService.save(document, controller.signal).then(
      () => {
        if (controller.signal.aborted) return
        savedRevisionRef.current = document.revision
        saveErrorRef.current = null
        setSaveError(null)
        setSaveState("saved")
      },
      (error) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        saveErrorRef.current = message
        setSaveError(message)
        setSaveState("idle")
        notifyError("Could not save canvas", error)
        throw error
      },
    )
    savePromiseRef.current = pending
    const clearPending = () => {
      if (savePromiseRef.current === pending) {
        savePromiseRef.current = undefined
        saveRevisionRef.current = undefined
      }
      if (saveControllerRef.current === controller) saveControllerRef.current = undefined
    }
    void pending.then(clearPending, clearPending)
    return pending
  }, [loadError, notifyError, persistenceService])
  const acceptHydratedDocument = useCallback((document: CanvasDocument) => {
    selectionActionControllerRef.current?.abort()
    hasLocalEditsRef.current = false
    savedRevisionRef.current = document.revision
    const hydrated = canvasHistoryReducer(historyRef.current, { type: "hydrate", document })
    historyRef.current = hydrated
    documentRef.current = hydrated.document
    reduce({ type: "hydrate", document })
  }, [])
  const reloadDocument = useCallback(() => {
    if (!persistenceService) return Promise.resolve()
    selectionActionControllerRef.current?.abort()
    return reloadQueueRef.current.request(async () => {
      await waitForStableLoad()
      if (loadError) throw new Error(loadError)
      const loadBarrier = createCanvasLoadBarrier()
      loadBarrierRef.current = loadBarrier
      hydratingRef.current = true
      setHydrating(true)
      setLoadError(null)
      const controller = new AbortController()
      try {
        await startSave(historyRef.current.document)
        const documentId = documentRef.current.id
        const document = await persistenceService.load(documentId, controller.signal)
        if (!document) throw new Error(`Canvas document was not found: ${documentId}`)
        if (document.id !== documentId || documentRef.current.id !== documentId) {
          throw new Error("Canvas changed while reloading")
        }
        acceptHydratedDocument(document)
        loadBarrier.resolve()
      } catch (error) {
        loadBarrier.reject(error)
        setLoadError(error instanceof Error ? error.message : String(error))
        notifyError("Could not reload canvas", error)
        throw error
      } finally {
        hydratingRef.current = false
        setHydrating(false)
      }
    })
  }, [acceptHydratedDocument, loadError, notifyError, persistenceService, startSave, waitForStableLoad])
  useImperativeHandle(props.editorRef, () => ({
    async flush() {
      await waitForStableLoad()
      await startSave(historyRef.current.document)
    },
    async prepareToLeave() {
      await waitForStableLoad()
      leavingRef.current = true
      setLeaving(true)
      for (const controller of operationControllersRef.current) controller.abort()
      operationControllersRef.current.clear()

      const current = historyRef.current
      const finalized = current.gestureStart
        ? canvasHistoryReducer(current, { type: "end-gesture" })
        : current
      if (finalized !== current) {
        historyRef.current = finalized
        documentRef.current = finalized.document
        reduce({ type: "end-gesture" })
      }
      await startSave(finalized.document)
    },
    reload: reloadDocument,
    resumeAfterLeaveCanceled() {
      leavingRef.current = false
      setLeaving(false)
    },
  }), [props.editorRef, reloadDocument, startSave, waitForStableLoad])
  useEffect(() => props.onDocumentChange?.(history.document), [history.document, props.onDocumentChange])
  useEffect(() => {
    const nodeIds = new Set(history.document.nodes.map((node) => node.id))
    const edgeIds = new Set(history.document.edges.map((edge) => edge.id))
    setSelection((current) => {
      const next = {
        nodeIds: new Set([...current.nodeIds].filter((id) => nodeIds.has(id))),
        edgeIds: new Set([...current.edgeIds].filter((id) => edgeIds.has(id))),
      }
      if (equalIds(current.nodeIds, next.nodeIds) && equalIds(current.edgeIds, next.edgeIds)) return current
      return next
    })
  }, [history.document.edges, history.document.nodes])
  useEffect(() => {
    if (!persistenceService) {
      hydratingRef.current = false
      setHydrating(false)
      setLoadError(null)
      loadBarrierRef.current.resolve()
      return
    }
    setHydrating(true)
    hydratingRef.current = true
    setLoadError(null)
    const controller = new AbortController()
    const loadBarrier = loadBarrierRef.current
    const documentId = history.document.id
    void persistenceService.load(documentId, controller.signal).then(
      (document) => {
        if (!controller.signal.aborted
          && document
          && documentRef.current.id === documentId
          && documentRef.current.revision === 0
          && !hasLocalEditsRef.current) {
          if (!leavingRef.current) {
            acceptHydratedDocument(document)
          }
        }
        if (!controller.signal.aborted) {
          setHydrating(false)
          hydratingRef.current = false
          loadBarrier.resolve()
        }
      },
      (error) => {
        if (!controller.signal.aborted) {
          setHydrating(false)
          hydratingRef.current = false
          setLoadError(error instanceof Error ? error.message : String(error))
          loadBarrier.reject(error)
          notifyError("Could not load canvas", error)
        }
      },
    )
    return () => {
      controller.abort()
      loadBarrier.reject(new Error("Canvas load was canceled"))
    }
  }, [acceptHydratedDocument, history.document.id, loadAttempt, persistenceService, notifyError])
  useLayoutEffect(() => {
    void startSave(history.document).catch(() => undefined)
  }, [history.document.revision, saveAttempt, startSave])
  useEffect(() => {
    const preventUnsavedClose = (event: BeforeUnloadEvent) => {
      const hasUnsavedRevision = documentRef.current.revision !== savedRevisionRef.current
      if (!saveErrorRef.current && !saveControllerRef.current && !historyRef.current.gestureStart && !hasUnsavedRevision) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", preventUnsavedClose)
    return () => window.removeEventListener("beforeunload", preventUnsavedClose)
  }, [])
  useEffect(() => () => {
    leavingRef.current = true
    for (const controller of operationControllersRef.current) controller.abort()
    operationControllersRef.current.clear()
    saveControllerRef.current?.abort()
  }, [])
  useEffect(() => {
    if (!pendingConnection) return
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-convax-connect-menu='true']")) return
      setPendingConnection(null)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true)
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true)
  }, [pendingConnection])
  useEffect(() => {
    if (pendingConnection && !history.document.nodes.some((node) => node.id === pendingConnection.nodeId)) {
      setPendingConnection(null)
    }
  }, [history.document.nodes, pendingConnection])
  const createNodeForType = useCallback((
    type: string,
    position: CanvasPoint,
    data?: Record<string, unknown>,
  ) => {
    try {
      const fileRenderer = props.fileRendererRegistry.get(type)
      if (fileRenderer?.create) return createCanvasFileNode(fileRenderer, { data, position })
      return props.nodeRegistry.get(type)?.create({ data, position })
    } catch (error) {
      notifyError("Could not create canvas node", error)
      return undefined
    }
  }, [notifyError, props.fileRendererRegistry, props.nodeRegistry])
  const addNode = useCallback(
    (type: string, position?: CanvasPoint) => {
      if (readOnly) return
      const node = createNodeForType(type, position ?? nextInsertPoint())
      if (!node) return
      const result = addCanvasNodes(history.document, [node])
      dispatch({ type: "commit", document: result.document })
      selectNodes(result.selectedNodeIds)
      fitAfterRender()
      setNodeMenuOpen(false)
      setInsertPoint(null)
      telemetryService?.track({ name: "canvas.node.added", properties: { type } })
    },
    [createNodeForType, fitAfterRender, history.document, nextInsertPoint, readOnly, selectNodes, telemetryService],
  )
  const duplicate = useCallback(() => {
    if (!hasNodeOnlySelection) return
    const result = duplicateCanvasSelection(history.document, selectedNodeIds)
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [hasNodeOnlySelection, history.document, selectedNodeIds, selectNodes])
  const duplicateNode = useCallback((nodeId: string) => {
    const result = duplicateCanvasSelection(documentRef.current, [nodeId])
    if (result.selectedNodeIds.length === 0) return
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [selectNodes])
  const quickConnect = useCallback(
    (nodeId: string, side: "left" | "right", nodeType: string, targetPosition?: CanvasPoint) => {
      if (readOnly) return
      const created = createNodeForType(nodeType, targetPosition ?? { x: 0, y: 0 })
      if (!created) return
      commit((document) => {
        const anchor = document.nodes.find((node) => node.id === nodeId)
        if (!anchor) return document
        const anchorSize = getCanvasNodeSize(anchor)
        const createdSize = getCanvasNodeSize(created)
        const parentPosition = anchor.parentId
          ? getNodeWorldPosition(document, anchor.parentId)
          : { x: 0, y: 0 }
        const localTarget = targetPosition
          ? { x: targetPosition.x - parentPosition.x, y: targetPosition.y - parentPosition.y }
          : null
        const node: CanvasNode = {
          ...created,
          extent: anchor.parentId ? "parent" : created.extent,
          parentId: anchor.parentId,
          position: localTarget
            ? {
                x: side === "right" ? localTarget.x : localTarget.x - createdSize.width,
                y: localTarget.y - createdSize.height / 2,
              }
            : {
                x: side === "right"
                  ? anchor.position.x + anchorSize.width + 160
                  : anchor.position.x - createdSize.width - 160,
                y: anchor.position.y + (anchorSize.height - createdSize.height) / 2,
              },
        }
        const withNode = addCanvasNodes(document, [node]).document
        return connectCanvasNodes(withNode, side === "right"
          ? {
              source: anchor.id,
              sourceHandle: "source-right",
              target: node.id,
              targetHandle: "target-left",
            }
          : {
              source: node.id,
              sourceHandle: "source-right",
              target: anchor.id,
              targetHandle: "target-left",
            })
      })
      selectNodes([created.id])
      telemetryService?.track({ name: "canvas.node.connected", properties: { side, type: nodeType } })
    },
    [commit, createNodeForType, readOnly, selectNodes, telemetryService],
  )
  const remove = useCallback(() => {
    commit((document) => removeCanvasElements(document, { nodeIds: selectedNodeIds, edgeIds: selectedEdgeIds }))
    updateSelection([])
  }, [commit, selectedEdgeIds, selectedNodeIds, updateSelection])
  const removeNode = useCallback((nodeId: string) => {
    commit((document) => removeCanvasElements(document, { nodeIds: [nodeId] }))
    updateSelection([])
  }, [commit, updateSelection])
  const group = useCallback(() => {
    if (selectionContext.kind !== "multi-node") return
    const result = groupCanvasNodes(history.document, selectedNodeIds)
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [history.document, selectedNodeIds, selectNodes, selectionContext.kind])
  const ungroup = useCallback(() => {
    if (!hasSingleGroupSelection || selectionContext.kind !== "single-node") return
    const groupId = selectionContext.nodeId
    if (!groupId) return
    const result = ungroupCanvasNode(history.document, groupId)
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [hasSingleGroupSelection, history.document, selectNodes, selectionContext])
  const align = useCallback((direction: CanvasAlign) => {
    if (!hasNodeOnlySelection || !canArrangeSelection) return
    commit((document) => alignCanvasNodes(document, arrangeNodeIds, direction))
  }, [arrangeNodeIds, canArrangeSelection, commit, hasNodeOnlySelection])
  const distribute = useCallback((axis: CanvasDistribute) => {
    if (!hasNodeOnlySelection || !canDistributeSelection) return
    commit((document) => distributeCanvasNodes(document, arrangeNodeIds, axis))
  }, [arrangeNodeIds, canDistributeSelection, commit, hasNodeOnlySelection])
  const layout = useCallback((value: CanvasLayout = "grid") => {
    if (!hasNodeOnlySelection || !canArrangeSelection) return
    commit((document) => layoutCanvasNodes(document, { nodeIds: arrangeNodeIds, layout: value }))
  }, [arrangeNodeIds, canArrangeSelection, commit, hasNodeOnlySelection])
  const layoutCanvas = useCallback(() => {
    if (!canLayoutCanvas) return
    commit((document) => layoutCanvasNodes(document, { nodeIds: canvasNodeIds, layout: "grid" }))
    fitAfterRender()
  }, [canLayoutCanvas, canvasNodeIds, commit, fitAfterRender])
  const copy = useCallback(() => {
    if (!hasNodeOnlySelection) return
    const payload = createCanvasClipboardPayload(history.document, selectedNodeIds, props.clipboardScope)
    if (!payload) return
    void navigator.clipboard.writeText(serializeCanvasClipboard(payload)).then(
      () => notificationService?.show({ kind: "info", title: "Copied to clipboard" }),
      (error) => notifyError("Could not copy selection", error),
    )
  }, [hasNodeOnlySelection, history.document, notificationService, notifyError, props.clipboardScope, selectedNodeIds])
  const paste = useCallback(() => {
    void navigator.clipboard.readText().then(
      (value) => {
        const payload = parseCanvasClipboard(value)
        if (!payload) return
        if (canvasClipboardHasScopeConflict(payload, props.clipboardScope)) {
          notificationService?.show({
            kind: "warning",
            title: "Referenced files cannot be pasted between scopes",
            description: "Add the source file or folder to this scope so the host can create a valid local reference.",
          })
          return
        }
        const roots = payload.nodes.filter((node) => !node.parentId)
        const target = insertPoint ?? pointerRef.current
        const offset = target && roots.length
          ? {
              x: target.x - Math.min(...roots.map((node) => node.position.x)),
              y: target.y - Math.min(...roots.map((node) => node.position.y)),
            }
          : undefined
        const prepared = prepareCanvasClipboardPaste(payload, offset)
        dispatch({
          type: "commit-update",
          update: (document) => ({
            ...document,
            edges: [...document.edges, ...prepared.edges],
            nodes: [...document.nodes, ...prepared.nodes],
          }),
        })
        selectNodes(prepared.selectedNodeIds)
      },
      (error) => notifyError("Could not read clipboard", error),
    )
  }, [dispatch, insertPoint, notificationService, notifyError, props.clipboardScope, selectNodes])

  const uploadFiles = useCallback(
    (
      files: readonly File[],
      position?: CanvasPoint,
      transfer?: { data: Readonly<Record<string, string>>; types: readonly string[] },
    ) => {
      if (!uploadService || (files.length === 0 && !transfer) || readOnly) return
      const controller = new AbortController()
      operationControllersRef.current.add(controller)
      const documentId = documentRef.current.id
      const anchor = position ?? pointerRef.current ?? pointAtCenter()
      void uploadService
        .upload({
          files,
          position,
          transfer,
          context: { documentId, selectedNodeIds, source: "canvas" },
          signal: controller.signal,
        })
        .then(
          (items) => {
            if (controller.signal.aborted || documentRef.current.id !== documentId) return
            if (items.length === 0) {
              notificationService?.show({ kind: "warning", title: "No supported files to add" })
              return
            }
            const command = createAddCanvasResourcesCommand({ anchor, items })
            const nodeIds = command.items.map((item) => item.nodeId)
            dispatch({
              type: "commit-update",
              update: (document) => applyCanvasBusinessCommand(document, command).document,
            })
            selectNodes(nodeIds)
            fitAfterRender()
            notificationService?.show({ kind: "success", title: `${items.length} item${items.length === 1 ? "" : "s"} added` })
          },
          (error) => {
            if (!controller.signal.aborted) notifyError("Upload failed", error)
          },
        )
        .finally(() => operationControllersRef.current.delete(controller))
    },
    [dispatch, fitAfterRender, notificationService, notifyError, pointAtCenter, readOnly, selectedNodeIds, selectNodes, uploadService],
  )
  const replaceNodeMedia = useCallback((nodeId: string, file: File) => {
    if (!uploadService || readOnly) return
    const sourceNode = documentRef.current.nodes.find((node) => node.id === nodeId)
    if (!sourceNode || !["image", "video", "audio", "file"].includes(sourceNode.data.kind)) return
    const expectedKind = sourceNode.data.kind
    const documentId = documentRef.current.id
    const operationController = new AbortController()
    operationControllersRef.current.add(operationController)
    void uploadService.upload({
      files: [file],
      context: { documentId, selectedNodeIds: [nodeId], source: "node" },
      signal: operationController.signal,
    }).then(
      (items) => {
        if (operationController.signal.aborted || documentRef.current.id !== documentId) return
        const resource = items.find((item) => item.kind !== "text" && item.kind === expectedKind)
        if (!resource || resource.kind === "text" || resource.kind === "folder") {
          notificationService?.show({
            kind: "warning",
            title: `Choose a ${expectedKind} file`,
            description: "The selected file did not match this node type.",
          })
          return
        }
        commit((document) => {
          const current = document.nodes.find((node) => node.id === nodeId)
          if (!current) return document
          const replacement = createMediaNode({ position: current.position, resource })
          return {
            ...document,
            nodes: document.nodes.map((node) => node.id === nodeId
              ? {
                  ...node,
                  data: replacement.data,
                  type: replacement.type,
                }
              : node),
          }
        })
        selectNodes([nodeId])
        notificationService?.show({ kind: "success", title: `${resource.name ?? resource.kind} replaced` })
      },
      (error) => {
        if (!operationController.signal.aborted) notifyError("Could not replace media", error)
      },
    ).finally(() => operationControllersRef.current.delete(operationController))
  }, [commit, notificationService, notifyError, readOnly, selectNodes, uploadService])
  const runGenerate = useCallback(() => {
    if (!generateService || readOnly) return
    if (!prompt.trim()) {
      setGenerateOpen(true)
      return
    }
    setGenerating(true)
    const controller = new AbortController()
    operationControllersRef.current.add(controller)
    const document = documentRef.current
    const documentId = document.id
    const requestPrompt = prompt.trim()
    const anchor = insertPoint ?? pointerRef.current ?? pointAtCenter()
    const references = document.nodes
      .filter((node) => selection.nodeIds.has(node.id))
      .map((node) => ({
        nodeId: node.id,
        kind: node.data.kind,
        text: "text" in node.data && typeof node.data.text === "string" ? node.data.text : undefined,
        url: "url" in node.data && typeof node.data.url === "string" ? node.data.url : undefined,
      }))
    void generateService
      .generate({
        prompt: requestPrompt,
        references,
        context: { documentId, selectedNodeIds, source: "canvas" },
        signal: controller.signal,
      })
      .then(
        (items) => {
          if (controller.signal.aborted || documentRef.current.id !== documentId) return
          const nodes = items.flatMap((item, index) => {
            const position = { x: anchor.x + index * 36, y: anchor.y + index * 36 }
            if (item.resource) return [createMediaNode({ label: item.title, position, resource: item.resource })]
            if (!item.nodeType || item.nodeType === "text") {
              return [createTextNode({ label: item.title ?? "Generated", position, text: item.text ?? requestPrompt })]
            }
            const node = createNodeForType(item.nodeType, position, {
              ...item.metadata,
              label: item.title,
              text: item.text,
            })
            return node ? [node] : []
          })
          dispatch({
            type: "commit-update",
            update: (current) => {
              const point = findOpenCanvasPoint(current, anchor)
              return addCanvasNodes(current, nodes.map((node, index) => ({
                ...node,
                position: { x: point.x + index * 36, y: point.y + index * 36 },
              }))).document
            },
          })
          selectNodes(nodes.map((node) => node.id))
          fitAfterRender()
          setGenerateOpen(false)
          setPrompt("")
          notificationService?.show({ kind: "success", title: "Generation complete" })
        },
        (error) => {
          if (!controller.signal.aborted) notifyError("Generation failed", error)
        },
      )
      .finally(() => {
        operationControllersRef.current.delete(controller)
        if (!controller.signal.aborted) setGenerating(false)
      })
  }, [createNodeForType, dispatch, fitAfterRender, generateService, insertPoint, notificationService, notifyError, pointAtCenter, prompt, readOnly, selectedNodeIds, selectNodes, selection.nodeIds])
  const exportCanvas = useCallback(() => {
    if (!exportService) return
    const controller = new AbortController()
    void exportService
      .export({ document: history.document, format: "json", selectedNodeIds }, controller.signal)
      .then(undefined, (error) => notifyError("Export failed", error))
  }, [exportService, history.document, notifyError, selectedNodeIds])

  const clearOverlays = useCallback(() => {
    updateSelection([])
    setPendingConnection(null)
    setNodeMenuOpen(false)
    setGenerateOpen(false)
    setSearchOpen(false)
  }, [updateSelection])
  const activateSelectTool = useCallback(() => {
    setPendingConnection(null)
    setNodeMenuOpen(false)
    setGenerateOpen(false)
    setSearchOpen(false)
    rootRef.current?.focus()
  }, [])
  const shortcutHandler = createCanvasShortcutHandler(
    {
      addNode: () => setNodeMenuOpen(true),
      clearSelection: clearOverlays,
      copy,
      delete: remove,
      duplicate,
      fitView: () => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 }),
      generate: runGenerate,
      group,
      layout: () => selectedNodeIds.length > 0 ? layout() : layoutCanvas(),
      openSearch: () => setSearchOpen(true),
      paste,
      redo: () => dispatch({ type: "redo" }),
      select: activateSelectTool,
      selectAll: () => selectNodes(history.document.nodes.filter((node) => !node.parentId).map((node) => node.id)),
      undo: () => dispatch({ type: "undo" }),
      ungroup,
      zoomIn: () => void reactFlow.zoomIn({ duration: 140 }),
      zoomOut: () => void reactFlow.zoomOut({ duration: 140 }),
    },
    readOnly,
  )
  const controller = useMemo(
    () => ({
      document: history.document,
      selection,
      selectionContext,
      readOnly,
      canUpload: Boolean(uploadService),
      fileRenderers: props.fileRendererRegistry,
      connectionNodeTypes,
      visibleSelectionActions,
      beginGesture: () => dispatch({ type: "begin-gesture" }),
      cancelGesture: () => dispatch({ type: "cancel-gesture" }),
      endGesture: () => dispatch({ type: "end-gesture" }),
      commit,
      duplicateNode,
      executeSelectionAction,
      isSelectionActionPending,
      quickConnect,
      removeNode,
      replaceNodeMedia,
      selectNodes,
    }),
    [
      commit,
      connectionNodeTypes,
      duplicateNode,
      executeSelectionAction,
      history.document,
      isSelectionActionPending,
      props.fileRendererRegistry,
      quickConnect,
      readOnly,
      removeNode,
      replaceNodeMedia,
      selectNodes,
      selection,
      selectionActionStateVersion,
      selectionContext,
      uploadService,
      visibleSelectionActions,
    ],
  )
  const searchResults = queryCanvasNodes(history.document, { limit: 8, text: query })

  return (
    <CanvasEditorProvider controller={controller}>
      <TooltipProvider>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={rootRef}
              className={cn(
                "convax-canvas relative size-full overflow-hidden bg-background text-foreground outline-none",
                spacePanning && "is-space-panning",
                props.className,
              )}
              onDragOver={(event) => {
                if (!uploadService || readOnly) return
                event.preventDefault()
                event.dataTransfer.dropEffect = "copy"
              }}
              onDrop={(event) => {
                if (!uploadService || readOnly) return
                event.preventDefault()
                const types = Array.from(event.dataTransfer.types)
                uploadFiles(
                  [...event.dataTransfer.files],
                  reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                  {
                    data: Object.fromEntries(types.map((type) => [type, event.dataTransfer.getData(type)])),
                    types,
                  },
                )
              }}
              onDoubleClick={(event) => {
                if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("react-flow__pane")) return
                addNode("text", reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
              }}
              onKeyDown={shortcutHandler}
              onPointerMove={(event) => {
                if (!(event.target instanceof HTMLElement) || event.target.closest("button, input, textarea, [data-canvas-shortcuts='ignore']")) return
                pointerRef.current = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
              }}
              tabIndex={0}
            >
              <ReactFlow
                colorMode="light"
                connectOnClick={false}
                connectionDragThreshold={4}
                connectionLineComponent={CanvasConnectionLine}
                deleteKeyCode={null}
                edgeTypes={edgeTypes}
                edges={edges}
                elementsSelectable={!readOnly}
                fitView
                fitViewOptions={{ maxZoom: 1.2, padding: 0.3 }}
                maxZoom={2.5}
                minZoom={0.15}
                nodeTypes={nodeTypes}
                nodes={nodes}
                nodesConnectable={!readOnly}
                nodesDraggable={!readOnly && !spacePanning}
                nodesFocusable
                nodeDragThreshold={4}
                onlyRenderVisibleElements={props.onlyRenderVisibleElements ?? true}
                autoPanOnNodeFocus={false}
                panActivationKeyCode="Space"
                panOnDrag={[1]}
                panOnScroll
                selectionKeyCode={null}
                selectionOnDrag={!readOnly}
                selectionMode={SelectionMode.Partial}
                snapGrid={[8, 8]}
                snapToGrid={snapToGrid}
                zoomActivationKeyCode={["Meta", "Control"]}
                zoomOnDoubleClick={false}
                zoomOnPinch
                zoomOnScroll={false}
                onConnect={(connection) => commit((document) => connectCanvasNodes(document, connection))}
                onConnectEnd={(event, connectionState) => {
                  const start = connectionStartRef.current
                  connectionStartRef.current = null
                  const targetScreen = getEventClientPoint(event)
                  if (!start || !targetScreen) return
                  if (Math.hypot(
                    targetScreen.x - start.pointerScreen.x,
                    targetScreen.y - start.pointerScreen.y,
                  ) <= 4) return
                  if (connectionState.isValid || connectionState.toNode || !connectionState.fromNode) return
                  const bounds = rootRef.current?.getBoundingClientRect()
                  if (!bounds
                    || targetScreen.x < bounds.left
                    || targetScreen.x > bounds.right
                    || targetScreen.y < bounds.top
                    || targetScreen.y > bounds.bottom) return
                  ignoreConnectionPaneClickRef.current = true
                  window.setTimeout(() => {
                    ignoreConnectionPaneClickRef.current = false
                  }, 250)
                  setPendingConnection({
                    nodeId: start.nodeId,
                    side: start.side,
                    sourceScreen: start.sourceScreen,
                    targetPosition: reactFlow.screenToFlowPosition(targetScreen),
                    targetScreen,
                  })
                }}
                onConnectStart={(event, params) => {
                  setPendingConnection(null)
                  const pointerScreen = getEventClientPoint(event)
                  if (!params.nodeId || !params.handleId || !pointerScreen) {
                    connectionStartRef.current = null
                    return
                  }
                  const handle = event.target instanceof Element
                    ? event.target.closest(".react-flow__handle")
                    : null
                  const bounds = handle?.getBoundingClientRect()
                  connectionStartRef.current = {
                    nodeId: params.nodeId,
                    pointerScreen,
                    side: params.handleId.includes("left") ? "left" : "right",
                    sourceScreen: bounds
                      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
                      : pointerScreen,
                  }
                }}
                onEdgesChange={(changes) => {
                  const selectionChanges = changes.filter((change) => change.type === "select")
                  if (selectionChanges.length > 0) {
                    setSelection((current) => {
                      const edgeIds = new Set(current.edgeIds)
                      selectionChanges.forEach((change) => change.selected ? edgeIds.add(change.id) : edgeIds.delete(change.id))
                      if (equalIds(current.edgeIds, edgeIds)) return current
                      return { nodeIds: current.nodeIds, edgeIds }
                    })
                  }
                  const documentChanges = changes.filter((change) => change.type !== "select")
                  if (documentChanges.length === 0) return
                  commit((document) => ({ ...document, edges: applyEdgeChanges(documentChanges, document.edges) }))
                }}
                onNodeContextMenu={(_, node) => {
                  if (!selection.nodeIds.has(node.id)) selectNodes([node.id])
                  setInsertPoint(node.position)
                }}
                onNodeDoubleClick={(_, node) => selectNodes([node.id])}
                onNodeDragStart={(event, node) => {
                  dispatch({ type: "begin-gesture" })
                  if (!(event instanceof MouseEvent) || !event.altKey) return
                  const nodeIds = selection.nodeIds.has(node.id) ? selectedNodeIds : [node.id]
                  altDragRef.current = {
                    nodeIds,
                    positions: new Map(history.document.nodes.filter((item) => nodeIds.includes(item.id)).map((item) => [item.id, item.position])),
                  }
                }}
                onNodeDragStop={() => {
                  if (altDragRef.current) {
                    const duplicated = duplicateCanvasSelection(history.document, altDragRef.current.nodeIds, { x: 0, y: 0 })
                    const positions = altDragRef.current.positions
                    const appendedNodes = duplicated.document.nodes.slice(history.document.nodes.length)
                    const appendedEdges = duplicated.document.edges.slice(history.document.edges.length)
                    dispatch({
                      type: "replace-update",
                      update: (document) => ({
                        ...document,
                        edges: [...document.edges, ...appendedEdges],
                        nodes: [
                          ...document.nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id) ?? node.position } : node),
                          ...appendedNodes,
                        ],
                      }),
                    })
                    selectNodes(duplicated.selectedNodeIds)
                    altDragRef.current = null
                  }
                  dispatch({ type: "end-gesture" })
                }}
                onNodesChange={(changes) => {
                  const selectionChanges = changes.filter((change) => change.type === "select")
                  if (selectionChanges.length > 0) {
                    setSelection((current) => {
                      const nodeIds = new Set(current.nodeIds)
                      selectionChanges.forEach((change) => change.selected ? nodeIds.add(change.id) : nodeIds.delete(change.id))
                      if (equalIds(current.nodeIds, nodeIds)) return current
                      return { nodeIds, edgeIds: current.edgeIds }
                    })
                  }
                  const documentChanges = changes.filter((change) => change.type !== "select" && change.type !== "remove")
                  if (documentChanges.length === 0) return
                  const measurementChanges = documentChanges.filter((change) => change.type === "dimensions")
                  const committedChanges = documentChanges.filter((change) => change.type !== "dimensions")
                  if (measurementChanges.length > 0) {
                    dispatch({
                      type: "replace-update",
                      update: (document) => {
                        const nextNodes = applyNodeChanges(measurementChanges, document.nodes)
                        return equalCanvasNodes(document.nodes, nextNodes) ? document : { ...document, nodes: nextNodes }
                      },
                    })
                  }
                  if (committedChanges.length > 0) {
                    dispatch({
                      type: "preview-or-commit-update",
                      update: (document) => {
                        const nextNodes = applyNodeChanges(committedChanges, document.nodes)
                        return equalCanvasNodes(document.nodes, nextNodes) ? document : { ...document, nodes: nextNodes }
                      },
                    })
                  }
                }}
                onPaneClick={() => {
                  if (ignoreConnectionPaneClickRef.current) {
                    ignoreConnectionPaneClickRef.current = false
                    return
                  }
                  updateSelection([])
                  setPendingConnection(null)
                  rootRef.current?.focus()
                }}
                onPaneContextMenu={(event) => {
                  setInsertPoint(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
                  rootRef.current?.focus()
                }}
              >
                <Background color="var(--canvas-grid)" gap={24} size={1.2} variant={BackgroundVariant.Dots} />
                {miniMapVisible ? (
                  <MiniMap
                    className="!bottom-4 !right-4 !h-24 !w-36 !rounded-md !border !border-border !bg-card !shadow-sm"
                    maskColor="color-mix(in oklab, var(--background) 68%, transparent)"
                    nodeColor="var(--muted-foreground)"
                    pannable
                    zoomable
                  />
                ) : null}
              </ReactFlow>

              {pendingConnection ? (
                <PendingConnectionMenu
                  items={connectionNodeTypes}
                  onSelect={(type) => {
                    const connection = pendingConnection
                    setPendingConnection(null)
                    quickConnect(
                      connection.nodeId,
                      connection.side,
                      type,
                      connection.targetPosition,
                    )
                  }}
                  side={pendingConnection.side}
                  sourceScreen={pendingConnection.sourceScreen}
                  targetScreen={pendingConnection.targetScreen}
                />
              ) : null}

              <CanvasHeader
                canExport={Boolean(exportService)}
                canGenerate={Boolean(generateService)}
                canRedo={history.future.length > 0}
                canUndo={history.past.length > 0}
                canUpload={Boolean(uploadService)}
                document={history.document}
                generating={generating}
                onAddAgent={() => addNode("agent")}
                onAddText={() => addNode("text")}
                onExport={exportCanvas}
                onGenerate={() => setGenerateOpen(true)}
                onRedo={() => dispatch({ type: "redo" })}
                onSearch={() => setSearchOpen(true)}
                onSelect={activateSelectTool}
                onUndo={() => dispatch({ type: "undo" })}
                onUpload={() => uploadInputRef.current?.click()}
                readOnly={readOnly}
                saveState={saveState}
                title={props.title}
              />

              {hydrating || loadError ? (
                <div className="absolute inset-0 z-40 grid place-items-center bg-background/75 backdrop-blur-[2px]">
                  <div className="flex max-w-sm flex-col items-center gap-3 rounded-md border border-border bg-card px-5 py-4 text-center text-sm text-muted-foreground shadow-sm">
                    {loadError ? (
                      <>
                        <TriangleAlert className="size-5 text-destructive" />
                        <div>
                          <div className="font-medium text-foreground">Canvas could not be loaded</div>
                          <div className="mt-1 text-xs">{loadError}</div>
                        </div>
                        <Button onClick={() => {
                          loadBarrierRef.current = createCanvasLoadBarrier()
                          setLoadAttempt((attempt) => attempt + 1)
                        }} size="sm" variant="outline">Retry</Button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <LoaderCircle className="size-4 animate-spin" />
                        Loading canvas…
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {saveError ? (
                <div className="fixed inset-0 z-[100] grid place-items-center bg-background/80 backdrop-blur-[2px]">
                  <div className="flex max-w-md flex-col items-center gap-3 rounded-md border border-destructive/30 bg-card px-6 py-5 text-center text-sm shadow-lg">
                    <TriangleAlert className="size-6 text-destructive" />
                    <div>
                      <div className="font-medium text-foreground">Canvas has unsaved changes</div>
                      <div className="mt-1 text-xs text-muted-foreground">{saveError}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => setSaveAttempt((attempt) => attempt + 1)} size="sm">Retry save</Button>
                      <Button
                        disabled={!history.gestureStart && history.past.length === 0}
                        onClick={() => {
                          setSaveError(null)
                          dispatch({ type: history.gestureStart ? "cancel-gesture" : "undo" })
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Revert last change
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">This window stays open until the canvas is saved or the last change is reverted.</div>
                  </div>
                </div>
              ) : null}

              {(selectionContext.kind === "multi-node" || hasSingleGroupSelection) && !readOnly ? (
                <SelectionToolbar
                  actions={visibleSelectionActions}
                  canArrange={canArrangeSelection}
                  canDistribute={canDistributeSelection}
                  canGroup={selectionContext.kind === "multi-node"}
                  canUngroup={hasSingleGroupSelection}
                  isActionPending={isSelectionActionPending}
                  onAlign={align}
                  onAction={executeSelectionAction}
                  onDelete={remove}
                  onDistribute={distribute}
                  onDuplicate={duplicate}
                  onGroup={group}
                  onLayout={layout}
                  onUngroup={ungroup}
                />
              ) : null}

              <ViewportToolbar
                canLayout={canLayoutCanvas}
                edgesHidden={edgesHidden}
                miniMapVisible={miniMapVisible}
                onEdgesHiddenChange={() => setEdgesHidden((hidden) => !hidden)}
                onFit={() => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 })}
                onLayout={layoutCanvas}
                onMiniMapChange={() => setMiniMapVisible((visible) => !visible)}
                onSnapChange={() => setSnapToGrid((enabled) => !enabled)}
                onZoomIn={() => void reactFlow.zoomIn({ duration: 140 })}
                onZoomOut={() => void reactFlow.zoomOut({ duration: 140 })}
                snapToGrid={snapToGrid}
              />

              {nodeMenuOpen ? (
                <FloatingPanel className="left-1/2 top-20 w-64 -translate-x-1/2">
                  <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">Add to canvas</div>
                  <div className="grid grid-cols-2 gap-1">
                    {connectionNodeTypes.map((definition) => (
                      <Button key={definition.type} className="justify-start" onClick={() => addNode(definition.type)} size="sm" variant="ghost">
                        {definition.type === "text" ? <Type /> : definition.type === "agent" ? <Sparkles /> : <FileUp />}
                        {definition.label}
                      </Button>
                    ))}
                  </div>
                </FloatingPanel>
              ) : null}

              {generateOpen ? (
                <FloatingPanel className="left-1/2 top-20 w-[min(440px,calc(100%-32px))] -translate-x-1/2">
                  <form
                    className="flex gap-2"
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault()
                      runGenerate()
                    }}
                  >
                    <Input autoFocus data-canvas-shortcuts="ignore" onChange={(event) => setPrompt(event.currentTarget.value)} placeholder="Describe what to create..." value={prompt} />
                    <Button aria-label="Run generation" disabled={generating || !prompt.trim()} size="icon" type="submit">
                      {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                    </Button>
                  </form>
                  <div className="mt-2 text-xs text-muted-foreground">{selectedNodeIds.length ? `${selectedNodeIds.length} selected node${selectedNodeIds.length === 1 ? "" : "s"} will be used as context.` : "No reference nodes selected."}</div>
                </FloatingPanel>
              ) : null}

              {searchOpen ? (
                <FloatingPanel className="left-1/2 top-20 w-[min(380px,calc(100%-32px))] -translate-x-1/2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input autoFocus className="pl-9" data-canvas-shortcuts="ignore" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search nodes" value={query} />
                  </div>
                  <div className="mt-2 max-h-64 overflow-auto">
                    {searchResults.map((node) => (
                      <button
                        key={node.id}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          setSearchOpen(false)
                          void executeViewCommand({
                            animation: "smooth",
                            fit: "center",
                            nodeIds: [node.id],
                            select: true,
                            type: "nodes.reveal",
                          })
                        }}
                        type="button"
                      >
                        <span className="size-2 rounded-full bg-muted-foreground" />
                        <span className="truncate">{node.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{node.kind}</span>
                      </button>
                    ))}
                  </div>
                </FloatingPanel>
              ) : null}

              <input
                ref={uploadInputRef}
                className="hidden"
                multiple
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  uploadFiles([...(event.currentTarget.files ?? [])])
                  event.currentTarget.value = ""
                }}
                type="file"
              />
            </div>
          </ContextMenuTrigger>
          <CanvasContextMenu
            canArrange={hasNodeOnlySelection && canArrangeSelection}
            canDistribute={hasNodeOnlySelection && canDistributeSelection}
            canGroup={selectionContext.kind === "multi-node"}
            canRedo={history.future.length > 0}
            canUngroup={hasSingleGroupSelection}
            canUndo={history.past.length > 0}
            canUpload={Boolean(uploadService)}
            createItems={connectionNodeTypes}
            hasNodeSelection={hasNodeOnlySelection}
            hasSelection={selectedNodeIds.length > 0 || selectedEdgeIds.length > 0}
            onAddNode={addNode}
            onAlign={align}
            onCopy={copy}
            onDelete={remove}
            onDistribute={distribute}
            onDuplicate={duplicate}
            onFit={() => void reactFlow.fitView({ duration: 220, maxZoom: 1.2, padding: 0.3 })}
            onGroup={group}
            onLayout={() => layout("grid")}
            onPaste={paste}
            onRedo={() => dispatch({ type: "redo" })}
            onUngroup={ungroup}
            onUndo={() => dispatch({ type: "undo" })}
            onUpload={() => uploadInputRef.current?.click()}
            readOnly={readOnly}
          />
        </ContextMenu>
      </TooltipProvider>
    </CanvasEditorProvider>
  )
}

function IconButton(props: {
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
  shortcut?: string
  tooltipSide?: "bottom" | "left" | "right" | "top"
}) {
  return (
    <Tooltip
      content={<span className="flex items-center gap-3">{props.label}{props.shortcut ? <Shortcut>{props.shortcut}</Shortcut> : null}</span>}
      side={props.tooltipSide}
    >
      <span className="inline-flex">
        <Button
          aria-label={props.label}
          aria-pressed={props.pressed}
          className={cn(props.pressed && "bg-accent text-accent-foreground")}
          disabled={props.disabled}
          onClick={props.onClick}
          size="icon-sm"
          variant="ghost"
        >
          {props.icon}
        </Button>
      </span>
    </Tooltip>
  )
}

function ToolSurface(props: { children: ReactNode; className?: string }) {
  return <div className={cn("convax-tool-surface absolute z-20 flex items-center rounded-md border p-1 text-card-foreground", props.className)}>{props.children}</div>
}

function FloatingPanel(props: { children: ReactNode; className?: string }) {
  return <div className={cn("convax-floating-panel absolute z-30 rounded-md border p-3 text-popover-foreground", props.className)}>{props.children}</div>
}

function CanvasHeader(props: {
  canExport: boolean
  canGenerate: boolean
  canRedo: boolean
  canUndo: boolean
  canUpload: boolean
  document: CanvasDocument
  generating: boolean
  onAddAgent: () => void
  onAddText: () => void
  onExport: () => void
  onGenerate: () => void
  onRedo: () => void
  onSearch: () => void
  onSelect: () => void
  onUndo: () => void
  onUpload: () => void
  readOnly: boolean
  saveState: "idle" | "saving" | "saved"
  title?: string
}) {
  return (
    <>
      <ToolSurface className="left-4 top-4 h-10 max-w-[calc(100%-32px)] gap-2 px-3">
        <div className="grid size-5 grid-cols-2 gap-0.5" aria-hidden="true">
          <span className="bg-foreground" /><span className="bg-emerald-500" /><span className="bg-emerald-500" /><span className="bg-foreground" />
        </div>
        <span className="truncate text-sm font-semibold">{props.title ?? props.document.metadata.title}</span>
        {props.saveState !== "idle" ? <span className="text-xs text-muted-foreground">{props.saveState === "saving" ? "Saving..." : "Saved"}</span> : null}
      </ToolSurface>
      <ToolSurface className="left-1/2 top-4 -translate-x-1/2 gap-0.5 max-[820px]:top-16">
        <IconButton icon={<MousePointer2 />} label="Select" onClick={props.onSelect} pressed shortcut="V" />
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton disabled={props.readOnly} icon={<Type />} label="Text" onClick={props.onAddText} />
        <IconButton disabled={props.readOnly} icon={<Bot />} label="Agent" onClick={props.onAddAgent} />
        {props.canUpload ? <IconButton disabled={props.readOnly} icon={<FileUp />} label="Upload" onClick={props.onUpload} /> : null}
        {props.canGenerate ? <IconButton disabled={props.readOnly || props.generating} icon={props.generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />} label="Generate" onClick={props.onGenerate} shortcut="⌘↵" /> : null}
      </ToolSurface>
      <ToolSurface className="right-4 top-4 gap-0.5 max-[820px]:top-16">
        <IconButton disabled={!props.canUndo || props.readOnly} icon={<Undo2 />} label="Undo" onClick={props.onUndo} shortcut="⌘Z" />
        <IconButton disabled={!props.canRedo || props.readOnly} icon={<Redo2 />} label="Redo" onClick={props.onRedo} shortcut="⇧⌘Z" />
        <IconButton icon={<Search />} label="Search" onClick={props.onSearch} shortcut="⌘F" />
        {props.canExport ? <IconButton icon={<Download />} label="Export" onClick={props.onExport} /> : null}
      </ToolSurface>
    </>
  )
}

const selectionAlignActions = [
  { direction: "left", icon: <AlignStartVertical />, label: "Left" },
  { direction: "center", icon: <AlignCenterVertical />, label: "Center" },
  { direction: "right", icon: <AlignEndVertical />, label: "Right" },
  { direction: "top", icon: <AlignStartHorizontal />, label: "Top" },
  { direction: "middle", icon: <AlignCenterHorizontal />, label: "Middle" },
  { direction: "bottom", icon: <AlignEndHorizontal />, label: "Bottom" },
] satisfies readonly { direction: CanvasAlign; icon: ReactNode; label: string }[]

const selectionDistributeActions = [
  { axis: "horizontal", icon: <AlignHorizontalSpaceBetween />, label: "Horizontal" },
  { axis: "vertical", icon: <AlignVerticalSpaceBetween />, label: "Vertical" },
] satisfies readonly { axis: CanvasDistribute; icon: ReactNode; label: string }[]

const selectionLayoutActions = [
  { layout: "horizontal", icon: <Columns3 />, label: "Horizontal" },
  { layout: "vertical", icon: <Rows3 />, label: "Vertical" },
  { layout: "grid", icon: <LayoutGrid />, label: "Grid" },
] satisfies readonly { layout: CanvasLayout; icon: ReactNode; label: string }[]

function SelectionToolbar(props: {
  actions: readonly CanvasSelectionAction[]
  canArrange: boolean
  canDistribute: boolean
  canGroup: boolean
  canUngroup: boolean
  isActionPending: (actionId: string) => boolean
  onAlign: (direction: CanvasAlign) => void
  onAction: (action: CanvasSelectionAction) => void
  onDelete: () => void
  onDistribute: (axis: CanvasDistribute) => void
  onDuplicate: () => void
  onGroup: () => void
  onLayout: (layout: CanvasLayout) => void
  onUngroup: () => void
}) {
  const [arrangeMenuOpen, setArrangeMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!arrangeMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && menuRef.current?.contains(event.target)) return
      setArrangeMenuOpen(false)
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArrangeMenuOpen(false)
    }
    window.addEventListener("pointerdown", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [arrangeMenuOpen])
  useEffect(() => {
    if (props.canArrange) return
    setArrangeMenuOpen(false)
  }, [props.canArrange])
  return (
    <ToolSurface className="convax-selection-toolbar bottom-5 left-1/2 -translate-x-1/2 gap-0.5 max-[760px]:bottom-16">
      <IconButton icon={<Copy />} label="Duplicate" onClick={props.onDuplicate} shortcut="⌘D" tooltipSide="top" />
      <IconButton disabled={!props.canGroup} icon={<Group />} label="Group" onClick={props.onGroup} shortcut="⌘G" tooltipSide="top" />
      <IconButton disabled={!props.canUngroup} icon={<Ungroup />} label="Ungroup" onClick={props.onUngroup} shortcut="⇧⌘G" tooltipSide="top" />
      {props.actions.length > 0 ? <span className="mx-1 h-5 w-px bg-border" /> : null}
      {props.actions.map((action) => {
        const pending = props.isActionPending(action.id)
        return (
          <IconButton
            key={action.id}
            disabled={pending}
            icon={pending ? <LoaderCircle className="animate-spin" /> : (action.icon ?? <Workflow />)}
            label={action.label}
            onClick={() => props.onAction(action)}
            tooltipSide="top"
          />
        )
      })}
      <span className="mx-1 h-5 w-px bg-border" />
      <div ref={menuRef} className="relative">
        <IconButton
          disabled={!props.canArrange}
          icon={<AlignStartVertical />}
          label="Align and arrange"
          onClick={() => setArrangeMenuOpen((open) => !open)}
          pressed={arrangeMenuOpen}
          tooltipSide="top"
        />
        {arrangeMenuOpen ? (
          <div className="convax-arrange-menu" data-canvas-shortcuts="ignore" role="menu">
            <div className="convax-arrange-menu__title">Align</div>
            <div className="convax-arrange-menu__grid" role="group">
              {selectionAlignActions.map((action) => (
                <button
                  key={action.direction}
                  className="convax-arrange-menu__action"
                  onClick={() => {
                    props.onAlign(action.direction)
                    setArrangeMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
            <div className="convax-arrange-menu__title">Distribute</div>
            <div className="convax-arrange-menu__grid convax-arrange-menu__grid--two" role="group">
              {selectionDistributeActions.map((action) => (
                <button
                  key={action.axis}
                  className="convax-arrange-menu__action"
                  disabled={!props.canDistribute}
                  onClick={() => {
                    props.onDistribute(action.axis)
                    setArrangeMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
            <div className="convax-arrange-menu__title">Layout</div>
            <div className="convax-arrange-menu__grid" role="group">
              {selectionLayoutActions.map((action) => (
                <button
                  key={action.layout}
                  className="convax-arrange-menu__action"
                  onClick={() => {
                    props.onLayout(action.layout)
                    setArrangeMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <IconButton disabled={!props.canArrange} icon={<LayoutGrid />} label="Tidy up" onClick={() => props.onLayout("grid")} shortcut="⌥⇧F" tooltipSide="top" />
      <span className="mx-1 h-5 w-px bg-border" />
      <IconButton icon={<Trash2 />} label="Delete" onClick={props.onDelete} shortcut="⌫" tooltipSide="top" />
    </ToolSurface>
  )
}

const zoomPresets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

function ViewportToolbar(props: {
  canLayout: boolean
  edgesHidden: boolean
  miniMapVisible: boolean
  onEdgesHiddenChange: () => void
  onFit: () => void
  onLayout: () => void
  onMiniMapChange: () => void
  onSnapChange: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  snapToGrid: boolean
}) {
  const viewport = useViewport()
  const reactFlow = useReactFlow<CanvasNode>()
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!zoomMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && menuRef.current?.contains(event.target)) return
      setZoomMenuOpen(false)
    }
    window.addEventListener("pointerdown", closeMenu)
    return () => window.removeEventListener("pointerdown", closeMenu)
  }, [zoomMenuOpen])
  return (
    <ToolSurface className="convax-viewport-toolbar bottom-3 left-3 gap-0.5">
      <IconButton icon={<Focus />} label="Fit view" onClick={props.onFit} shortcut="⌘0" tooltipSide="top" />
      <IconButton
        icon={<Workflow />}
        label={props.edgesHidden ? "Show edges" : "Hide edges"}
        onClick={props.onEdgesHiddenChange}
        pressed={props.edgesHidden}
        tooltipSide="top"
      />
      <IconButton
        disabled={!props.canLayout}
        icon={<LayoutGrid />}
        label="Tidy canvas"
        onClick={props.onLayout}
        shortcut="⌥⇧F"
        tooltipSide="top"
      />
      <IconButton icon={<Magnet />} label="Snap to grid" onClick={props.onSnapChange} pressed={props.snapToGrid} tooltipSide="top" />
      <IconButton icon={<MapPinned />} label="Minimap" onClick={props.onMiniMapChange} pressed={props.miniMapVisible} tooltipSide="top" />
      <span className="mx-1 h-5 w-px bg-border" />
      <IconButton icon={<ZoomOut />} label="Zoom out" onClick={props.onZoomOut} shortcut="⌘−" tooltipSide="top" />
      <div ref={menuRef} className="relative">
        <Tooltip content="Zoom presets" side="top">
          <Button
            aria-expanded={zoomMenuOpen}
            aria-haspopup="menu"
            className="convax-zoom-trigger"
            onClick={() => setZoomMenuOpen((open) => !open)}
            size="sm"
            variant="ghost"
          >
            <span>{Math.round(viewport.zoom * 100)}%</span>
            <ChevronUp className={cn("transition-transform", zoomMenuOpen && "rotate-180")} />
          </Button>
        </Tooltip>
        {zoomMenuOpen ? (
          <div className="convax-zoom-menu" data-canvas-shortcuts="ignore" role="menu">
            <div className="convax-zoom-menu__title">Zoom</div>
            {zoomPresets.map((zoom) => (
              <button
                key={zoom}
                className="convax-zoom-menu__item"
                onClick={() => {
                  void reactFlow.zoomTo(zoom, { duration: 160 })
                  setZoomMenuOpen(false)
                }}
                role="menuitem"
                type="button"
              >
                <span>{Math.round(zoom * 100)}%</span>
                {Math.abs(viewport.zoom - zoom) < 0.01 ? <Check /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <IconButton icon={<ZoomIn />} label="Zoom in" onClick={props.onZoomIn} shortcut="⌘+" tooltipSide="top" />
    </ToolSurface>
  )
}

function CanvasContextMenu(props: {
  canArrange: boolean
  canDistribute: boolean
  canGroup: boolean
  canRedo: boolean
  canUngroup: boolean
  canUndo: boolean
  canUpload: boolean
  createItems: readonly { label: string; type: string }[]
  hasNodeSelection: boolean
  hasSelection: boolean
  onAddNode: (type: string) => void
  onAlign: (direction: CanvasAlign) => void
  onCopy: () => void
  onDelete: () => void
  onDistribute: (axis: CanvasDistribute) => void
  onDuplicate: () => void
  onFit: () => void
  onGroup: () => void
  onLayout: () => void
  onPaste: () => void
  onRedo: () => void
  onUngroup: () => void
  onUndo: () => void
  onUpload: () => void
  readOnly: boolean
}) {
  return (
    <ContextMenuContent className="w-60">
      {!props.readOnly ? <ContextMenuLabel>Create</ContextMenuLabel> : null}
      {!props.readOnly ? props.createItems.map((item) => (
        <ContextMenuItem key={item.type} onSelect={() => props.onAddNode(item.type)}>
          {item.type === "text"
            ? <Type />
            : item.type === "agent"
              ? <Bot />
              : item.type === "image"
                ? <ImagePlus />
                : item.type === "video"
                  ? <Video />
                  : <FileUp />}
          Add {item.label}
        </ContextMenuItem>
      )) : null}
      {props.canUpload && !props.readOnly ? <ContextMenuItem onSelect={props.onUpload}><FileUp />Upload files</ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuSeparator /> : null}
      <ContextMenuLabel>Canvas</ContextMenuLabel>
      {!props.readOnly ? <ContextMenuItem onSelect={props.onPaste}><ClipboardPaste />Paste<Shortcut>⌘V</Shortcut></ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuItem disabled={!props.canUndo} onSelect={props.onUndo}><Undo2 />Undo<Shortcut>⌘Z</Shortcut></ContextMenuItem> : null}
      {!props.readOnly ? <ContextMenuItem disabled={!props.canRedo} onSelect={props.onRedo}><Redo2 />Redo<Shortcut>⇧⌘Z</Shortcut></ContextMenuItem> : null}
      <ContextMenuItem onSelect={props.onFit}><Focus />Fit view<Shortcut>⌘0</Shortcut></ContextMenuItem>
      {props.hasSelection ? <ContextMenuSeparator /> : null}
      {props.hasSelection ? <ContextMenuLabel>Selection</ContextMenuLabel> : null}
      {props.hasNodeSelection ? <ContextMenuItem onSelect={props.onCopy}><Copy />Copy<Shortcut>⌘C</Shortcut></ContextMenuItem> : null}
      {props.hasNodeSelection && !props.readOnly ? <ContextMenuItem onSelect={props.onDuplicate}><Copy />Duplicate<Shortcut>⌘D</Shortcut></ContextMenuItem> : null}
      {props.canGroup && !props.readOnly ? <ContextMenuItem onSelect={props.onGroup}><Group />Group<Shortcut>⌘G</Shortcut></ContextMenuItem> : null}
      {props.canUngroup && !props.readOnly ? <ContextMenuItem onSelect={props.onUngroup}><Ungroup />Ungroup<Shortcut>⇧⌘G</Shortcut></ContextMenuItem> : null}
      {props.canArrange && !props.readOnly ? <ContextMenuItem onSelect={props.onLayout}><LayoutGrid />Tidy up<Shortcut>⌥⇧F</Shortcut></ContextMenuItem> : null}
      {props.canArrange && !props.readOnly ? <ContextMenuItem onSelect={() => props.onAlign("left")}><AlignStartVertical />Align left</ContextMenuItem> : null}
      {props.canArrange && !props.readOnly ? <ContextMenuItem onSelect={() => props.onAlign("top")}><AlignStartHorizontal />Align top</ContextMenuItem> : null}
      {props.canDistribute && !props.readOnly ? <ContextMenuItem onSelect={() => props.onDistribute("horizontal")}><AlignHorizontalSpaceBetween />Distribute horizontally</ContextMenuItem> : null}
      {props.canDistribute && !props.readOnly ? <ContextMenuItem onSelect={() => props.onDistribute("vertical")}><AlignVerticalSpaceBetween />Distribute vertically</ContextMenuItem> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuSeparator /> : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuItem className="text-destructive" onSelect={props.onDelete}><Trash2 />Delete<Shortcut>⌫</Shortcut></ContextMenuItem> : null}
    </ContextMenuContent>
  )
}
