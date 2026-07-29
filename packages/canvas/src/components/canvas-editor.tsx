import {
  Background,
  BackgroundVariant,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
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
  Ellipsis,
  FileOutput,
  FileUp,
  Focus,
  Group,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  Magnet,
  MapPinned,
  PanelRightOpen,
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
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import {
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type ForwardedRef,
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
  findOpenCanvasPoint,
  queryCanvasNodes,
  type CanvasAutoLayoutStrategy,
} from "../application"
import { canvasAppearanceStyle, resolveCanvasAppearance, type CanvasAppearanceInput } from "../appearance"
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
  readCanvasClipboard,
  serializeCanvasClipboard,
  writeCanvasClipboard,
} from "../clipboard"
import { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } from "../builtin-registry"
import { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } from "../connections"
import { createCanvasId, getCanvasNodeSize, parseCanvasDocument } from "../document"
import { CanvasEditorProvider, CanvasOverlayRootProvider } from "../editor-context"
import {
  isCanvasGenerationComposerSubmissionCurrent,
  type CanvasGenerationComposerSubmission,
} from "../generation-composer"
import {
  createCanvasSelectionProjection,
  type CanvasInspectorProjection,
  type CanvasSelectionProjection,
} from "../inspector"
import { deriveCanvasSelectionContext, isNodeOnlySelectionContext } from "../selection-context"
import { createCanvasNodeSnapSession, type CanvasNodeSnapSession, type CanvasSnapLine } from "../snapping"
import { applyReactFlowEdgeSelectionChanges, applyReactFlowNodeSelectionChanges } from "./canvas-selection-sync"
import { snapCanvasNodePositionChanges } from "./canvas-node-snapping"
import { createCanvasFileNode, type CanvasFileRendererRegistry } from "../file-renderer-registry"
import { canvasHistoryReducer, createCanvasHistory, type CanvasHistoryAction } from "../history"
import type { CanvasNodeRegistry } from "../node-registry"
import { CanvasReloadQueue } from "../reload-queue"
import {
  CanvasSelectionActionExecutor,
  createCanvasSelectionActionContext,
  getVisibleCanvasSelectionActions,
  partitionCanvasSelectionActions,
  type CanvasSelectionAction,
} from "../selection-actions"
import {
  CanvasSelectionDragGestureController,
  getVisibleCanvasSelectionDragSource,
  type CanvasSelectionDragSource,
} from "../selection-drag-source"
import {
  CanvasServicesProvider,
  createCanvasPendingDraftRegistry,
  type CanvasNotification,
  type CanvasPendingDraft,
  type CanvasResourceMutationRequest,
  type CanvasResourceHydrationService,
  type CanvasServices,
  useCanvasService,
} from "../services"
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  CanvasPoint,
  CanvasResourceRuntimeState,
  CanvasSelection,
} from "../types"
import {
  createCanvasShortcutHandler,
  isCanvasEditableShortcutTarget,
  isCanvasExternalDragChordHeld,
  isCanvasExternalDragChordKey,
  resolveCanvasTidyShortcutScope,
  type CanvasShortcutOptions,
} from "../use-canvas-shortcuts"
import { useSpacePanning } from "../use-space-panning"
import {
  assertCanvasViewGuard,
  CANVAS_VIEW_MAX_ZOOM,
  CANVAS_VIEW_MIN_ZOOM,
  resolveCanvasDocumentFitEffect,
  resolveCanvasFitTargetNodeIds,
  type CanvasViewCommand,
  type CanvasViewCommandResult,
  type CanvasViewExecutionGuard,
  type CanvasViewRegistry,
  type CanvasViewSession,
  type CanvasViewSnapshot,
} from "../view"
import { CanvasConnectionLine, CanvasEdgeView, shouldAnimateCanvasEdge } from "./canvas-edge"
import { CanvasGenerationPanel } from "./canvas-generation-panel"
import { bindCanvasSearchDismissal } from "./canvas-search-dismissal"
import { createCanvasCardConnection } from "./connection-node-menu"
import { createCanvasDuplicateDragPlan, remapCanvasDuplicateDragChanges } from "./duplicate-drag"
import { getCanvasNodeInsertionItems } from "./insertion-items"
import { PendingConnectionMenu } from "./pending-connection-menu"

const edgeTypes = { canvas: CanvasEdgeView } satisfies EdgeTypes
const CANVAS_FIT_DURATION = 220
const CANVAS_FIT_MAX_ZOOM = 1
const CANVAS_FIT_PADDING = 0.18
const CANVAS_CENTER_FIT_MAX_ZOOM = 1.2
const CANVAS_CENTER_FIT_PADDING = 0.08
const CANVAS_MIN_ZOOM = CANVAS_VIEW_MIN_ZOOM
const CANVAS_MAX_ZOOM = CANVAS_VIEW_MAX_ZOOM
const CANVAS_FIT_VIEW_OPTIONS = { maxZoom: CANVAS_FIT_MAX_ZOOM, padding: CANVAS_FIT_PADDING }
const CANVAS_PAN_ON_DRAG = [1]
const CANVAS_SNAP_GRID: [number, number] = [8, 8]
const CANVAS_SNAP_TOLERANCE_SCREEN_PX = 8
const CANVAS_ZOOM_ACTIVATION_KEYS = ["Meta", "Control"]
const CANVAS_POINTER_FOCUS_INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "audio",
  "video",
  "iframe",
  "[contenteditable]:not([contenteditable='false'])",
  ".nodrag",
  "[data-canvas-shortcuts='ignore']",
].join(", ")
type CanvasDirectedAutoLayoutStrategy = Extract<
  CanvasAutoLayoutStrategy,
  "horizontal-directed-cluster" | "vertical-directed-cluster"
>

interface CanvasLoadBarrier {
  promise: Promise<void>
  reject(error: unknown): void
  resolve(): void
}

interface CanvasAuthoritativeRenderWaiter {
  documentId: string
  reject(error: unknown): void
  resolve(): void
  revision: number
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
    return (
      node.id === next.id &&
      node.position.x === next.position.x &&
      node.position.y === next.position.y &&
      node.measured?.width === next.measured?.width &&
      node.measured?.height === next.measured?.height &&
      node.width === next.width &&
      node.height === next.height &&
      node.dragging === next.dragging &&
      node.resizing === next.resizing &&
      node.hidden === next.hidden &&
      node.parentId === next.parentId &&
      node.data === next.data &&
      node.style === next.style
    )
  })
}

function isPositiveFiniteDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

/**
 * React Flow does not treat CSS width and height as known node dimensions.
 * Project persisted Canvas dimensions into its renderer-only initial fields so
 * an authoritative reload does not hide a freshly generated node.
 */
function projectCanvasNodeInitialDimensions(node: CanvasNode): CanvasNode {
  const initialWidth =
    node.measured?.width === undefined &&
    node.width === undefined &&
    node.initialWidth === undefined &&
    isPositiveFiniteDimension(node.style?.width)
      ? node.style.width
      : undefined
  const initialHeight =
    node.measured?.height === undefined &&
    node.height === undefined &&
    node.initialHeight === undefined &&
    isPositiveFiniteDimension(node.style?.height)
      ? node.style.height
      : undefined
  if (initialWidth === undefined && initialHeight === undefined) return node
  return {
    ...node,
    ...(initialWidth === undefined ? {} : { initialWidth }),
    ...(initialHeight === undefined ? {} : { initialHeight }),
  }
}

interface PendingConnection {
  nodeId: string
  side: "left" | "right"
  targetPosition: CanvasPoint
}

interface ConnectionStart extends Pick<PendingConnection, "nodeId" | "side"> {
  pointerScreen: CanvasPoint
}

function getEventClientPoint(event: MouseEvent | TouchEvent): CanvasPoint | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  return { x: event.clientX, y: event.clientY }
}

function getCanvasCardAtScreenPoint(
  root: HTMLElement | null,
  canvasDocument: CanvasDocument,
  point: CanvasPoint,
  sourceNodeId: string,
) {
  if (!root || typeof document === "undefined") return null
  const element = document.elementFromPoint(point.x, point.y)
  const nodeElement = element?.closest(".react-flow__node[data-id]")
  if (!nodeElement || !root.contains(nodeElement)) return null
  const nodeId = nodeElement.getAttribute("data-id")
  if (!nodeId || nodeId === sourceNodeId) return null
  const node = canvasDocument.nodes.find((candidate) => candidate.id === nodeId)
  return node && node.data.kind !== "group" ? node.id : null
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
  appearance?: CanvasAppearanceInput
  className?: string
  clipboardScope?: string
  initialDocument: CanvasDocument
  fileRendererRegistry?: CanvasFileRendererRegistry
  nodeRegistry?: CanvasNodeRegistry
  onlyRenderVisibleElements?: boolean
  onDocumentChange?: (document: CanvasDocument) => void
  /** Lets the host present Canvas's generation composer in its own utility surface. */
  onGenerateRequest?: () => void
  /** Publishes the Canvas-owned generation operation state without transferring ownership. */
  onGenerationStateChange?: (running: boolean) => void
  /** Publishes a bounded, scope-tagged projection for the host's active Canvas Input. */
  onSelectionProjectionChange?: (projection: CanvasSelectionProjection) => void
  /** Requests host-owned Inspector presentation for the current eligible projection. */
  onInspectorRequest?: (projection: CanvasInspectorProjection) => void
  readOnly?: boolean
  selectionActions?: readonly CanvasSelectionAction[]
  selectionDragSource?: CanvasSelectionDragSource
  services: CanvasServices
  title?: string
  viewId?: string
  viewRegistry?: CanvasViewRegistry
  viewScopeId?: string
}

export interface CanvasEditorHandle {
  /** Persists pending commands and returns Main's authoritative document projection. */
  flush: () => Promise<CanvasDocument>
  /** Inserts one registered node type through the ordinary editor flow and returns its id when accepted. */
  insertNode: (type: string) => string | undefined
  invalidateResources: () => Promise<void>
  /** Opens Canvas's existing generation surface without exposing its internal query state. */
  openGenerate: () => void
  /** Opens Canvas's existing search surface without exposing its internal query state. */
  openSearch: () => void
  prepareToLeave: () => Promise<boolean>
  reload: () => Promise<void>
  /** Reloads Main's authoritative projection and resolves after the renderer controller publishes it. */
  reloadAuthoritative: () => Promise<void>
  resumeAfterLeaveCanceled: () => void
  /** Selects existing nodes after a host-owned mutation has been reloaded. */
  selectNodes: (nodeIds: readonly string[]) => void
  /** Transfers a host-rendered Canvas composer submission to Canvas's operation owner. */
  submitGeneration: (submission: CanvasGenerationComposerSubmission) => void
}

export interface CanvasResourceMutationScopeToken {
  documentId: string
  generation: number
  scopeId: string
}

export function replaceCanvasNodeResourceState(
  document: CanvasDocument,
  nodeId: string,
  resourceState: CanvasResourceRuntimeState,
): CanvasDocument {
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId || !("resourceState" in node.data)) return node
    changed = true
    return { ...node, data: { ...node.data, resourceState } }
  })
  return changed ? { ...document, nodes } : document
}

function isCanvasResourceMutationScopeCurrent(
  currentScope: () => CanvasResourceMutationScopeToken,
  operationScope: CanvasResourceMutationScopeToken,
) {
  const current = currentScope()
  return (
    current.documentId === operationScope.documentId &&
    current.generation === operationScope.generation &&
    current.scopeId === operationScope.scopeId
  )
}

export function runCanvasReloadScopeEffect(input: {
  currentScope: () => CanvasResourceMutationScopeToken
  effect: () => void
  reloadScope: CanvasResourceMutationScopeToken
}) {
  if (!isCanvasResourceMutationScopeCurrent(input.currentScope, input.reloadScope)) return false
  input.effect()
  return true
}

interface CanvasResourceRefreshSnapshot {
  document: CanvasDocument
  scope: CanvasResourceMutationScopeToken
}

interface CanvasResourceRefreshControllerOptions {
  current(): CanvasResourceRefreshSnapshot
  onError?(error: unknown): void
  queue?: CanvasReloadQueue
  replace(document: CanvasDocument): void
  service: CanvasResourceHydrationService
}

export class CanvasResourceRefreshController {
  readonly #controllers = new Set<AbortController>()
  readonly #queue: CanvasReloadQueue
  #disposed = false
  #invalidationGeneration = 0

  constructor(private readonly options: CanvasResourceRefreshControllerOptions) {
    this.#queue = options.queue ?? new CanvasReloadQueue()
  }

  invalidateResources(): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    const current = this.options.current()
    this.options.replace(this.options.service.markStale(current.document))
    this.#invalidationGeneration += 1
    return this.#requestRefresh()
  }

  abort() {
    for (const controller of this.#controllers) controller.abort()
    this.#controllers.clear()
  }

  dispose() {
    this.#disposed = true
    this.abort()
  }

  #requestRefresh() {
    const pending = this.#queue.request(() => this.#refresh())
    void pending.catch((error) => this.options.onError?.(error))
    return pending
  }

  async #refresh() {
    if (this.#disposed) return
    const invalidationGeneration = this.#invalidationGeneration
    const requested = this.options.current()
    const controller = new AbortController()
    this.#controllers.add(controller)
    let hydrated: CanvasDocument
    try {
      hydrated = await this.options.service.hydrateStale({
        document: requested.document,
        signal: controller.signal,
      })
    } catch (error) {
      if (
        !this.#disposed &&
        !controller.signal.aborted &&
        !isCanvasResourceRefreshTargetCurrent(requested, this.options.current())
      ) {
        void this.#requestRefresh()
        return
      }
      throw error
    } finally {
      this.#controllers.delete(controller)
    }
    if (this.#disposed || controller.signal.aborted || invalidationGeneration !== this.#invalidationGeneration) return

    const current = this.options.current()
    const merged = mergeCanvasResourceRefresh(requested, current, hydrated)
    if (!merged) {
      void this.#requestRefresh()
      return
    }
    this.options.replace(merged)
  }
}

function mergeCanvasResourceRefresh(
  requested: CanvasResourceRefreshSnapshot,
  current: CanvasResourceRefreshSnapshot,
  hydrated: CanvasDocument,
): CanvasDocument | null {
  if (
    !isCanvasResourceRefreshTargetCurrent(requested, current) ||
    hydrated.id !== requested.document.id ||
    hydrated.revision !== requested.document.revision
  ) {
    return null
  }

  const currentNodes = new Map(current.document.nodes.map((node) => [node.id, node]))
  const hydratedNodes = new Map(hydrated.nodes.map((node) => [node.id, node]))
  let changed = false
  let invalid = false
  const nodes = current.document.nodes.map((currentNode) => {
    const requestedNode = requested.document.nodes.find((node) => node.id === currentNode.id)
    const requestedState = requestedNode ? canvasNodeResourceState(requestedNode) : undefined
    if (!requestedNode || !isStaleCanvasResourceState(requestedState)) return currentNode
    const hydratedNode = hydratedNodes.get(currentNode.id)
    const currentState = canvasNodeResourceState(currentNode)
    const hydratedState = hydratedNode ? canvasNodeResourceState(hydratedNode) : undefined
    if (
      !hydratedNode ||
      !sameCanvasRuntimeValue(requestedNode.data.metadata, currentNode.data.metadata) ||
      !sameCanvasRuntimeValue(requestedNode.data.metadata, hydratedNode.data.metadata) ||
      !sameCanvasRuntimeValue(requestedState, currentState) ||
      hydratedState === undefined
    ) {
      invalid = true
      return currentNode
    }
    if (sameCanvasRuntimeValue(currentState, hydratedState)) return currentNode
    changed = true
    return { ...currentNode, data: { ...currentNode.data, resourceState: hydratedState } }
  })

  if (invalid) return null

  for (const requestedNode of requested.document.nodes) {
    if (
      isStaleCanvasResourceState(canvasNodeResourceState(requestedNode)) &&
      (!currentNodes.has(requestedNode.id) || !hydratedNodes.has(requestedNode.id))
    ) {
      return null
    }
  }
  return changed ? { ...current.document, nodes } : current.document
}

function isCanvasResourceRefreshTargetCurrent(
  requested: CanvasResourceRefreshSnapshot,
  current: CanvasResourceRefreshSnapshot,
) {
  if (
    !isCanvasResourceMutationScopeCurrent(() => current.scope, requested.scope) ||
    current.document.id !== requested.document.id ||
    current.document.revision !== requested.document.revision
  )
    return false
  const currentNodes = new Map(current.document.nodes.map((node) => [node.id, node]))
  return requested.document.nodes.every((requestedNode) => {
    const requestedState = canvasNodeResourceState(requestedNode)
    if (!isStaleCanvasResourceState(requestedState)) return true
    const currentNode = currentNodes.get(requestedNode.id)
    return Boolean(
      currentNode &&
        sameCanvasRuntimeValue(requestedNode.data.metadata, currentNode.data.metadata) &&
        sameCanvasRuntimeValue(requestedState, canvasNodeResourceState(currentNode)),
    )
  })
}

function canvasNodeResourceState(node: CanvasNode): unknown {
  return node.data.resourceState
}

function isStaleCanvasResourceState(value: unknown) {
  return value !== null && typeof value === "object" && "status" in value && value.status === "stale"
}

function sameCanvasRuntimeValue(left: unknown, right: unknown) {
  if (left === right) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function linkCanvasReloadAbortSignal(source: AbortSignal | undefined, target: AbortController) {
  if (!source) return () => undefined
  const abort = () => target.abort(source.reason)
  if (source.aborted) abort()
  else source.addEventListener("abort", abort, { once: true })
  return () => source.removeEventListener("abort", abort)
}

export function abortCanvasReload(controller: AbortController | undefined) {
  controller?.abort()
}

export async function abortCanvasReloadBeforeWait(
  controller: AbortController | undefined,
  waitForStableLoad: () => Promise<void>,
) {
  abortCanvasReload(controller)
  await waitForStableLoad()
}

function canvasReloadAbortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error("Canvas reload was aborted")
  error.name = "AbortError"
  return error
}

export function settleCanvasReloadFailure(input: {
  currentScope: () => CanvasResourceMutationScopeToken
  error: unknown
  notifyError: (title: string, error: unknown) => void
  rejectBarrier: (error: unknown) => void
  reloadScope: CanvasResourceMutationScopeToken
  resolveBarrier: () => void
  setLoadError: (message: string) => void
  signal: AbortSignal
}) {
  if (input.signal.aborted || (input.error instanceof Error && input.error.name === "AbortError")) {
    input.resolveBarrier()
    return "aborted" as const
  }
  input.rejectBarrier(input.error)
  runCanvasReloadScopeEffect({
    currentScope: input.currentScope,
    effect: () => {
      input.setLoadError(input.error instanceof Error ? input.error.message : String(input.error))
      input.notifyError("Could not reload canvas", input.error)
    },
    reloadScope: input.reloadScope,
  })
  return "failed" as const
}

export async function completeCanvasResourceMutation(input: {
  currentScope: () => CanvasResourceMutationScopeToken
  operationScope: CanvasResourceMutationScopeToken
  reload: (signal: AbortSignal) => Promise<void>
  result: { createdNodeIds: readonly string[]; revision: number; warnings: readonly string[] }
  selectNodes: (nodeIds: readonly string[]) => void
  show: (notification: CanvasNotification) => void
  signal: AbortSignal
}) {
  const isActive = () =>
    !input.signal.aborted && isCanvasResourceMutationScopeCurrent(input.currentScope, input.operationScope)
  if (!isActive()) return
  const reload = input.reload
  if (!isActive()) return
  try {
    await reload(input.signal)
  } catch {
    if (isActive()) {
      input.show({
        description: "Reload the Canvas to show the committed resources.",
        kind: "warning",
        title: "Resources added, but refresh failed",
      })
    }
    return
  }
  if (!isActive()) return
  const createdNodeIds = input.result.createdNodeIds
  if (!isActive()) return
  input.selectNodes(createdNodeIds)
  if (!isActive()) return
  input.show({
    description: input.result.warnings.length ? input.result.warnings.join("\n") : undefined,
    kind: input.result.warnings.length ? "warning" : "success",
    title: `${createdNodeIds.length} item${createdNodeIds.length === 1 ? "" : "s"} added`,
  })
}

export function handleCanvasResourceMutationFailure(input: {
  currentScope: () => CanvasResourceMutationScopeToken
  error: unknown
  notifyError: (title: string, error: unknown) => void
  operationScope: CanvasResourceMutationScopeToken
  signal: AbortSignal
  title?: string
}) {
  if (!input.signal.aborted && isCanvasResourceMutationScopeCurrent(input.currentScope, input.operationScope)) {
    input.notifyError(input.title ?? "Could not add resources", input.error)
  }
}
export function handleCanvasResourceUploadSelection(files: readonly File[], upload: (files: readonly File[]) => void) {
  upload(files)
}

export function handleCanvasResourceRelinkSelection(
  nodeId: string | null,
  files: readonly File[],
  relink: (nodeId: string, file: File) => void,
) {
  const file = files[0]
  if (nodeId && file) relink(nodeId, file)
}
export const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(function CanvasEditor(props, ref) {
  const nodeRegistry = useMemo(() => props.nodeRegistry ?? createDefaultCanvasNodeRegistry(), [props.nodeRegistry])
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

function CanvasEditorContent(
  props: CanvasEditorProps & {
    editorRef: ForwardedRef<CanvasEditorHandle>
    fileRendererRegistry: CanvasFileRendererRegistry
    nodeRegistry: CanvasNodeRegistry
  },
) {
  const appearance = useMemo(() => resolveCanvasAppearance(props.appearance), [props.appearance])
  const [history, reduce] = useReducer(canvasHistoryReducer, props.initialDocument, createInitialCanvasHistory)
  const [selection, setSelection] = useState<CanvasSelection>(() => ({ nodeIds: new Set(), edgeIds: new Set() }))
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [edgesHidden, setEdgesHidden] = useState(false)
  const [miniMapVisible, setMiniMapVisible] = useState(true)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [snapLines, setSnapLines] = useState<CanvasSnapLine[]>([])
  const [autoLayoutStrategy, setAutoLayoutStrategy] =
    useState<CanvasDirectedAutoLayoutStrategy>("horizontal-directed-cluster")
  const [query, setQuery] = useState("")
  const [generating, setGenerating] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveAttempt, setSaveAttempt] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [selectionDragModeActive, setSelectionDragModeActive] = useState(false)
  const [insertPoint, setInsertPoint] = useState<CanvasPoint | null>(null)
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)
  const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null)
  const spacePanning = useSpacePanning()
  const rootRef = useRef<HTMLDivElement>(null)
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null)
  const setCanvasRoot = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element
    setOverlayRoot(element)
  }, [])
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const searchPanelRef = useRef<HTMLDivElement>(null)
  const relinkInputRef = useRef<HTMLInputElement>(null)
  const relinkNodeIdRef = useRef<string | null>(null)
  const pointerRef = useRef<CanvasPoint | null>(null)
  const boxSelectionActiveRef = useRef(false)
  const boxSelectionBaselineRef = useRef<CanvasSelection | null>(null)
  const selectionRef = useRef(selection)
  const selectionDragAutoSelectedNodeRef = useRef<string | null>(null)
  const selectionDragCandidateNodeRef = useRef<string | null>(null)
  const selectionDragModeActiveRef = useRef(false)
  const connectionStartRef = useRef<ConnectionStart | null>(null)
  const connectionTargetNodeIdRef = useRef<string | null>(null)
  const ignoreConnectionPaneClickRef = useRef(false)
  const altDragRef = useRef<{ duplicatedNodeIdBySourceId: ReadonlyMap<string, string> } | null>(null)
  const snapSessionRef = useRef<CanvasNodeSnapSession | null>(null)
  const snapEnabledRef = useRef(snapEnabled)
  const documentRef = useRef(history.document)
  const resourceMutationScopeRef = useRef<CanvasResourceMutationScopeToken>({
    documentId: history.document.id,
    generation: 0,
    scopeId: props.viewScopeId ?? "",
  })
  const currentResourceScope = resourceMutationScopeRef.current
  const currentViewScopeId = props.viewScopeId ?? ""
  if (currentResourceScope.documentId !== history.document.id || currentResourceScope.scopeId !== currentViewScopeId) {
    resourceMutationScopeRef.current = {
      documentId: history.document.id,
      generation: currentResourceScope.generation + 1,
      scopeId: currentViewScopeId,
    }
  }
  const historyRef = useRef(history)
  const hasLocalEditsRef = useRef(false)
  const saveErrorRef = useRef<string | null>(null)
  const leavingRef = useRef(false)
  const saveControllerRef = useRef<AbortController | undefined>(undefined)
  const savePromiseRef = useRef<Promise<CanvasDocument> | undefined>(undefined)
  const saveRevisionRef = useRef<number | undefined>(undefined)
  const savedRevisionRef = useRef(history.document.revision)
  const reloadQueueRef = useRef(new CanvasReloadQueue())
  const authoritativeRenderWaitersRef = useRef(new Set<CanvasAuthoritativeRenderWaiter>())
  const reloadControllerRef = useRef<AbortController | undefined>(undefined)
  const operationControllersRef = useRef(new Set<AbortController>())
  const authoritativeLoadRequestedRef = useRef(false)
  const presentedDocumentScopeRef = useRef<CanvasResourceMutationScopeToken | null>(null)
  const selectionActionControllerRef = useRef<AbortController | undefined>(undefined)
  const generationControllerRef = useRef<{ controller: AbortController; documentId: string } | null>(null)
  const submitGenerationRef = useRef<(submission: CanvasGenerationComposerSubmission) => void>(() => undefined)
  const pendingDraftsRef = useRef(createCanvasPendingDraftRegistry())
  const reactFlow = useReactFlow<CanvasNode>()
  const reactFlowRef = useRef(reactFlow)
  reactFlowRef.current = reactFlow
  const mutationService = useCanvasService("mutation")
  const hydrationService = useCanvasService("hydration")
  const generateService = useCanvasService("generate")
  const persistenceService = useCanvasService("persistence")
  const exportService = useCanvasService("export")
  const notificationService = useCanvasService("notify")
  const telemetryService = useCanvasService("telemetry")
  const draftDecisionService = useCanvasService("draftDecision")
  const requestGenerate = useCallback(() => {
    if (!generateService) return
    if (props.onGenerateRequest) {
      props.onGenerateRequest()
      return
    }
    setGenerateOpen(true)
  }, [generateService, props.onGenerateRequest])
  const [hydrating, setHydrating] = useState(Boolean(persistenceService))
  const [blockingLoad, setBlockingLoad] = useState(Boolean(persistenceService))
  const hydratingRef = useRef(Boolean(persistenceService))
  const loadBarrierRef = useRef(createCanvasLoadBarrier(!persistenceService))
  documentRef.current = history.document
  historyRef.current = history
  saveErrorRef.current = saveError
  selectionRef.current = selection
  snapEnabledRef.current = snapEnabled
  const waitForAuthoritativeRender = useCallback(
    (document: CanvasDocument) =>
      new Promise<void>((resolve, reject) => {
        authoritativeRenderWaitersRef.current.add({
          documentId: document.id,
          reject,
          resolve,
          revision: document.revision,
        })
      }),
    [],
  )
  useLayoutEffect(() => {
    if (hydrating || loadError) return
    for (const waiter of authoritativeRenderWaitersRef.current) {
      if (history.document.id !== waiter.documentId || history.document.revision < waiter.revision) continue
      authoritativeRenderWaitersRef.current.delete(waiter)
      waiter.resolve()
    }
  }, [history.document.id, history.document.revision, hydrating, loadError])
  useEffect(
    () => () => {
      const error = new Error("Canvas editor was closed before the authoritative document rendered")
      for (const waiter of authoritativeRenderWaitersRef.current) waiter.reject(error)
      authoritativeRenderWaitersRef.current.clear()
    },
    [],
  )
  const updateConnectionTargetNode = useCallback((nodeId: string | null) => {
    if (connectionTargetNodeIdRef.current === nodeId) return
    connectionTargetNodeIdRef.current = nodeId
    setConnectionTargetNodeId(nodeId)
  }, [])
  useLayoutEffect(() => {
    for (const controller of operationControllersRef.current) controller.abort()
    operationControllersRef.current.clear()
    abortCanvasReload(reloadControllerRef.current)
    snapSessionRef.current = null
    setSnapLines([])
  }, [currentViewScopeId, history.document.id])
  useEffect(() => {
    if (history.gestureStart) return
    snapSessionRef.current = null
    setSnapLines([])
  }, [history.gestureStart])
  const dispatch = useCallback((action: CanvasHistoryAction) => {
    if (leavingRef.current || hydratingRef.current) return
    if (action.type !== "hydrate" && action.type !== "replace" && action.type !== "replace-update") {
      hasLocalEditsRef.current = true
    }
    reduce(action)
  }, [])
  const replaceRuntimeDocument = useCallback((document: CanvasDocument) => {
    const replaced = canvasHistoryReducer(historyRef.current, { document, type: "replace" })
    historyRef.current = replaced
    documentRef.current = replaced.document
    reduce({ document, type: "replace" })
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
  const selectionProjection = useMemo(
    () =>
      createCanvasSelectionProjection({
        document: history.document,
        renderers: props.fileRendererRegistry,
        scopeId: currentViewScopeId,
        selection: selectionContext,
        viewId: props.viewId ?? "",
      }),
    [
      currentViewScopeId,
      fileRendererRegistryVersion,
      history.document,
      props.fileRendererRegistry,
      props.viewId,
      selectionContext,
    ],
  )
  const selectionProjectionRef = useRef(selectionProjection)
  selectionProjectionRef.current = selectionProjection
  useLayoutEffect(() => {
    try {
      props.onSelectionProjectionChange?.(selectionProjection)
    } catch {
      // Host projection is an optional view effect and cannot take down Canvas.
    }
  }, [props.onSelectionProjectionChange, selectionProjection])
  const hasNodeOnlySelection = isNodeOnlySelectionContext(selectionContext)
  const nodeById = useMemo(
    () => new Map(history.document.nodes.map((node) => [node.id, node])),
    [history.document.nodes],
  )
  const hasSingleGroupSelection =
    selectionContext.kind === "single-node" && nodeById.get(selectionContext.nodeId)?.data.kind === "group"
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
  const canArrangeSelection =
    arrangeNodes.length >= 2 && arrangeNodes.every((node) => node.parentId === arrangeNodes[0]?.parentId)
  const canDistributeSelection = canArrangeSelection && arrangeNodes.length >= 3
  const canvasNodeIds = useMemo(
    () => history.document.nodes.filter((node) => !node.parentId).map((node) => node.id),
    [history.document.nodes],
  )
  const canLayoutCanvas = !readOnly && canvasNodeIds.length >= 2
  const nodes = useMemo(() => {
    const depth = (node: CanvasNode, visited = new Set<string>()): number => {
      if (visited.has(node.id)) return 0
      visited.add(node.id)
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      return parent ? depth(parent, visited) + 1 : 0
    }
    return history.document.nodes
      .map((node) => {
        const projected = projectCanvasNodeInitialDimensions(node)
        const selected = selection.nodeIds.has(node.id)
        const isConnectionTarget = node.id === connectionTargetNodeId
        if (node.selected === selected && !isConnectionTarget) return projected
        return {
          ...projected,
          className: cn(node.className, isConnectionTarget && "is-connection-target"),
          selected,
        }
      })
      .sort((left, right) => depth(left) - depth(right))
  }, [connectionTargetNodeId, history.document.nodes, nodeById, selection.nodeIds])
  const edges = useMemo(() => {
    if (edgesHidden) return []
    return history.document.edges.map((edge) => ({
      ...edge,
      animated: shouldAnimateCanvasEdge(edge, selection),
      selected: selection.edgeIds.has(edge.id),
      sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
      targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
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
      { label: "Text", type: "text" },
      ...getCanvasNodeInsertionItems(props.fileRendererRegistry, props.nodeRegistry),
    ],
    [fileRendererRegistryVersion, props.fileRendererRegistry, props.nodeRegistry, registryVersion],
  )

  useEffect(() => {
    const active = generationControllerRef.current
    if (active && active.documentId !== history.document.id) active.controller.abort()
  }, [history.document.id])

  useEffect(() => () => generationControllerRef.current?.controller.abort(), [generateService])

  const replaceSelection = useCallback((next: CanvasSelection) => {
    selectionRef.current = next
    setSelection((current) => {
      if (equalIds(current.nodeIds, next.nodeIds) && equalIds(current.edgeIds, next.edgeIds)) return current
      return next
    })
  }, [])
  const updateSelection = useCallback(
    (nodeIds: readonly string[], edgeIds: readonly string[] = []) => {
      replaceSelection({ nodeIds: new Set(nodeIds), edgeIds: new Set(edgeIds) })
    },
    [replaceSelection],
  )
  const getViewSnapshot = useCallback(
    (): CanvasViewSnapshot => ({
      documentId: documentRef.current.id,
      revision: documentRef.current.revision,
      scopeId: props.viewScopeId ?? "",
      selectedEdgeIds: [...selectionRef.current.edgeIds],
      selectedNodeIds: [...selectionRef.current.nodeIds],
      viewId: props.viewId ?? "",
      viewport: reactFlow.getViewport(),
    }),
    [props.viewId, props.viewScopeId, reactFlow],
  )
  const fitDocumentViewport = useCallback(
    async (
      document: CanvasDocument,
      options: { duration?: number; maxZoom?: number; nodeIds?: readonly string[]; padding?: number } = {},
    ) => {
      const maxZoom = options.maxZoom ?? CANVAS_MAX_ZOOM
      const padding = options.padding ?? CANVAS_FIT_PADDING
      if (!Number.isFinite(maxZoom) || maxZoom < CANVAS_MIN_ZOOM || maxZoom > CANVAS_MAX_ZOOM) {
        throw new Error(`Canvas fit maxZoom must be between ${CANVAS_MIN_ZOOM} and ${CANVAS_MAX_ZOOM}`)
      }
      if (!Number.isFinite(padding) || padding < 0) {
        throw new Error("Canvas fit padding must be a finite non-negative number")
      }
      const bounds = rootRef.current?.getBoundingClientRect()
      const effect = resolveCanvasDocumentFitEffect({
        bounds: bounds
          ? {
              height: bounds.height,
              maxZoom: CANVAS_MAX_ZOOM,
              minZoom: CANVAS_MIN_ZOOM,
              width: bounds.width,
            }
          : undefined,
        document,
        maxZoom,
        nodeIds: options.nodeIds,
        padding,
      })
      if (effect.kind === "renderer-fallback") {
        await reactFlow.fitView({
          duration: options.duration ?? CANVAS_FIT_DURATION,
          maxZoom: effect.maxZoom,
          padding: effect.padding,
          ...(effect.nodeIds ? { nodes: effect.nodeIds.map((id) => ({ id })) } : {}),
        })
        return
      }
      if (effect.kind === "viewport") {
        await reactFlow.setViewport(effect.viewport, { duration: options.duration ?? CANVAS_FIT_DURATION })
      }
    },
    [reactFlow],
  )
  const waitForStableLoad = useCallback(async () => {
    while (true) {
      const barrier = loadBarrierRef.current
      await barrier.promise
      if (barrier === loadBarrierRef.current && !hydratingRef.current) return
    }
  }, [])
  const executeViewCommand = useCallback(
    async (command: CanvasViewCommand, guard?: CanvasViewExecutionGuard): Promise<CanvasViewCommandResult> => {
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
        updateSelection(
          foundNodeIds,
          (command.edgeIds ?? []).filter((edgeId) => existingEdgeIds.has(edgeId)),
        )
      }
      if (command.type === "nodes.reveal") {
        const resolved = resolveNodeIds(command.nodeIds)
        foundNodeIds = resolved.foundNodeIds
        missingNodeIds = resolved.missingNodeIds
        if (command.select) updateSelection(foundNodeIds)
        if ((command.fit ?? "contain") !== "none" && foundNodeIds.length > 0) {
          const center = command.fit === "center"
          await fitDocumentViewport(document, {
            duration,
            maxZoom: center ? CANVAS_CENTER_FIT_MAX_ZOOM : CANVAS_FIT_MAX_ZOOM,
            nodeIds: foundNodeIds,
            padding: center ? CANVAS_CENTER_FIT_PADDING : CANVAS_FIT_PADDING,
          })
        }
      }
      if (command.type === "viewport.fit") {
        const resolved = resolveCanvasFitTargetNodeIds(document, command.nodeIds)
        foundNodeIds = resolved.foundNodeIds
        missingNodeIds = resolved.missingNodeIds
        if (resolved.explicit && foundNodeIds.length === 0) {
          return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
        }
        await fitDocumentViewport(document, {
          duration,
          maxZoom: command.maxZoom,
          nodeIds: resolved.explicit ? foundNodeIds : undefined,
          padding: command.padding,
        })
      }
      if (command.type === "viewport.center") {
        if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) {
          throw new Error("Canvas viewport center must contain finite coordinates")
        }
        if (
          command.zoom !== undefined &&
          (!Number.isFinite(command.zoom) || command.zoom < CANVAS_MIN_ZOOM || command.zoom > CANVAS_MAX_ZOOM)
        ) {
          throw new Error(`Canvas viewport zoom must be between ${CANVAS_MIN_ZOOM} and ${CANVAS_MAX_ZOOM}`)
        }
        await reactFlow.setCenter(command.position.x, command.position.y, {
          duration,
          zoom: command.zoom,
        })
      }
      if (command.type === "viewport.zoom") {
        if (!Number.isFinite(command.zoom) || command.zoom < CANVAS_MIN_ZOOM || command.zoom > CANVAS_MAX_ZOOM)
          throw new Error(`Canvas viewport zoom must be between ${CANVAS_MIN_ZOOM} and ${CANVAS_MAX_ZOOM}`)
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
    },
    [fitDocumentViewport, getViewSnapshot, notificationService, reactFlow, updateSelection, waitForStableLoad],
  )
  const viewSession = useMemo<CanvasViewSession | null>(
    () =>
      props.viewId
        ? {
            execute: executeViewCommand,
            getSnapshot: getViewSnapshot,
            whenReady: waitForStableLoad,
            viewId: props.viewId,
          }
        : null,
    [executeViewCommand, getViewSnapshot, props.viewId, waitForStableLoad],
  )
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
    return reactFlowRef.current.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    })
  }, [])
  const fitCanvas = useCallback(() => void fitDocumentViewport(documentRef.current), [fitDocumentViewport])
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
      notificationService?.show({
        kind: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      })
    },
    [notificationService],
  )
  const resourceRefreshController = useMemo(
    () =>
      hydrationService
        ? new CanvasResourceRefreshController({
            current: () => ({
              document: documentRef.current,
              scope: resourceMutationScopeRef.current,
            }),
            onError: (error) => notifyError("Could not refresh canvas resources", error),
            queue: reloadQueueRef.current,
            replace: replaceRuntimeDocument,
            service: hydrationService,
          })
        : undefined,
    [hydrationService, notifyError, replaceRuntimeDocument],
  )
  useEffect(() => () => resourceRefreshController?.dispose(), [resourceRefreshController])
  const [selectionActionStateVersion, refreshSelectionActionState] = useReducer((version: number) => version + 1, 0)
  const selectionActionsMountedRef = useRef(false)
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
    [currentViewScopeId, history.document, props.viewId, readOnly, selectedEdgeIds, selectedNodeIds],
  )
  selectionActionControllerRef.current = selectionActionController
  const selectionActionContext = useMemo(
    () =>
      createCanvasSelectionActionContext(
        history.document,
        selectedNodeIds,
        selectedEdgeIds,
        selectionActionController.signal,
      ),
    [history.document, selectedEdgeIds, selectedNodeIds, selectionActionController],
  )
  const inspectorAction = useMemo<CanvasSelectionAction | null>(() => {
    const inspector = selectionProjection.inspector
    if (!inspector || !props.onInspectorRequest) return null
    return {
      execute(context) {
        if (context.signal.aborted || selectionProjectionRef.current.inspector !== inspector) return
        props.onInspectorRequest?.(inspector)
      },
      icon: <PanelRightOpen />,
      id: "canvas.inspector.open",
      label: "Open Inspector",
      presentation: { placement: "primary" },
    }
  }, [props.onInspectorRequest, selectionProjection.inspector])
  const availableSelectionActions = useMemo(
    () =>
      inspectorAction
        ? [inspectorAction, ...(props.selectionActions ?? []).filter((action) => action.id !== inspectorAction.id)]
        : (props.selectionActions ?? []),
    [inspectorAction, props.selectionActions],
  )
  const visibleSelectionActions = useMemo(
    () => getVisibleCanvasSelectionActions(availableSelectionActions, selectionActionContext),
    [availableSelectionActions, selectionActionContext],
  )
  const visibleSelectionDragSource = useMemo(
    () => getVisibleCanvasSelectionDragSource(props.selectionDragSource, selectionActionContext),
    [props.selectionDragSource, selectionActionContext],
  )
  const [selectionDragStateVersion, refreshSelectionDragState] = useReducer((version: number) => version + 1, 0)
  const selectionDragShortcutModifierRef = useRef<CanvasShortcutOptions["externalDragShortcutModifier"]>(undefined)
  const selectionDragMountedRef = useRef(false)
  const selectionDragErrorRef = useRef(notifyError)
  const selectionDragGestureRef = useRef<CanvasSelectionDragGestureController | null>(null)
  selectionDragErrorRef.current = notifyError
  if (!selectionDragGestureRef.current) {
    selectionDragGestureRef.current = new CanvasSelectionDragGestureController({
      onChange: () => {
        if (selectionDragMountedRef.current) refreshSelectionDragState()
      },
      onError: (source, error) => selectionDragErrorRef.current(`Could not prepare ${source.label}`, error),
    })
  }
  const selectionDragGesture = selectionDragGestureRef.current
  selectionDragModeActiveRef.current = selectionDragModeActive
  selectionDragShortcutModifierRef.current = props.selectionDragSource?.shortcutModifier
  const selectionDragChordHeld = selectionDragGesture.held
  const selectionDragArmed = Boolean(
    selectionDragChordHeld && !selectionDragGesture.consumed && visibleSelectionDragSource,
  )
  useLayoutEffect(() => {
    selectionActionsMountedRef.current = true
    return () => {
      selectionActionsMountedRef.current = false
    }
  }, [])
  useLayoutEffect(() => {
    selectionDragMountedRef.current = true
    return () => {
      selectionDragMountedRef.current = false
      selectionDragAutoSelectedNodeRef.current = null
      selectionDragCandidateNodeRef.current = null
      selectionDragGesture.release()
    }
  }, [selectionDragGesture])
  useLayoutEffect(() => {
    return () => {
      selectionActionController.abort()
      selectionActionExecutor.reset({ notify: false })
    }
  }, [selectionActionController, selectionActionExecutor])
  useLayoutEffect(() => {
    if (!selectionDragGesture.held || selectionDragGesture.consumed) return
    selectionDragGesture.reconcile(props.selectionDragSource, selectionActionContext)
  }, [props.selectionDragSource, selectionActionContext, selectionDragGesture])
  useLayoutEffect(() => {
    if (!selectionDragModeActive || readOnly || !props.selectionDragSource?.mode || selectionDragGesture.held) {
      return
    }
    selectionDragGesture.hold(props.selectionDragSource, selectionActionContext)
  }, [props.selectionDragSource, readOnly, selectionActionContext, selectionDragGesture, selectionDragModeActive])
  const executeSelectionAction = useCallback(
    (action: CanvasSelectionAction) => {
      if (
        hydratingRef.current ||
        leavingRef.current ||
        selectionActionContext.document !== documentRef.current ||
        !equalIds(new Set(selectionActionContext.selectedNodeIds), selectionRef.current.nodeIds) ||
        !equalIds(new Set(selectionActionContext.selectedEdgeIds), selectionRef.current.edgeIds)
      )
        return
      void selectionActionExecutor.execute(action, selectionActionContext)
    },
    [selectionActionContext, selectionActionExecutor],
  )
  const isSelectionActionPending = useCallback(
    (actionId: string) => selectionActionExecutor.isPending(actionId, selectionActionContext.signal),
    [selectionActionContext.signal, selectionActionExecutor],
  )
  const selectionDragContextIsCurrent = useCallback(
    () =>
      !hydratingRef.current &&
      !leavingRef.current &&
      selectionActionContext.document === documentRef.current &&
      equalIds(new Set(selectionActionContext.selectedNodeIds), selectionRef.current.nodeIds) &&
      equalIds(new Set(selectionActionContext.selectedEdgeIds), selectionRef.current.edgeIds),
    [selectionActionContext],
  )
  const selectHeldSelectionDragCandidate = useCallback(
    (nodeId: string) => {
      if (readOnly || !props.selectionDragSource || !selectionDragGesture.held || selectionDragGesture.consumed)
        return false
      const current = selectionRef.current
      const autoSelectedNodeId = selectionDragAutoSelectedNodeRef.current
      const mayReplaceAutoSelection =
        current.edgeIds.size === 0 &&
        current.nodeIds.size === 1 &&
        autoSelectedNodeId !== null &&
        current.nodeIds.has(autoSelectedNodeId)
      if ((current.nodeIds.size > 0 || current.edgeIds.size > 0) && !mayReplaceAutoSelection) return false
      if (current.nodeIds.has(nodeId)) return true
      const candidateController = new AbortController()
      const candidateContext = createCanvasSelectionActionContext(
        documentRef.current,
        [nodeId],
        [],
        candidateController.signal,
      )
      const eligible = Boolean(getVisibleCanvasSelectionDragSource(props.selectionDragSource, candidateContext))
      candidateController.abort()
      if (!eligible) return false
      selectionDragAutoSelectedNodeRef.current = nodeId
      updateSelection([nodeId])
      return true
    },
    [props.selectionDragSource, readOnly, selectionDragGesture, updateSelection],
  )
  const setSelectionDragCandidateNode = useCallback(
    (nodeId: string | null) => {
      selectionDragCandidateNodeRef.current = nodeId
      if (nodeId && !selectionDragModeActiveRef.current) selectHeldSelectionDragCandidate(nodeId)
    },
    [selectHeldSelectionDragCandidate],
  )
  const armSelectionDrag = useCallback(() => {
    if (readOnly || !props.selectionDragSource || !selectionDragContextIsCurrent()) return false
    const changed = selectionDragGesture.hold(props.selectionDragSource, selectionActionContext)
    const candidateNodeId = selectionDragCandidateNodeRef.current
    if (candidateNodeId) selectHeldSelectionDragCandidate(candidateNodeId)
    return changed
  }, [
    props.selectionDragSource,
    readOnly,
    selectHeldSelectionDragCandidate,
    selectionActionContext,
    selectionDragContextIsCurrent,
    selectionDragGesture,
  ])
  const cancelSelectionDrag = useCallback(() => {
    selectionDragAutoSelectedNodeRef.current = null
    return selectionDragGesture.release()
  }, [selectionDragGesture])
  const enterSelectionDragMode = useCallback(() => {
    if (readOnly || !props.selectionDragSource || !props.selectionDragSource.mode || !selectionDragContextIsCurrent()) {
      return false
    }
    selectionDragModeActiveRef.current = true
    setSelectionDragModeActive(true)
    selectionDragAutoSelectedNodeRef.current = null
    selectionDragGesture.restart(props.selectionDragSource, selectionActionContext)
    rootRef.current?.focus()
    return true
  }, [props.selectionDragSource, readOnly, selectionActionContext, selectionDragContextIsCurrent, selectionDragGesture])
  const exitSelectionDragMode = useCallback(() => {
    selectionDragModeActiveRef.current = false
    setSelectionDragModeActive(false)
    return cancelSelectionDrag()
  }, [cancelSelectionDrag])
  const finishSelectionDrag = useCallback(() => {
    if (
      selectionDragModeActiveRef.current &&
      !readOnly &&
      props.selectionDragSource &&
      selectionDragContextIsCurrent()
    ) {
      if (selectionDragGesture.consumed) {
        selectionDragGesture.restart(props.selectionDragSource, selectionActionContext)
      }
      return
    }
    cancelSelectionDrag()
  }, [
    cancelSelectionDrag,
    props.selectionDragSource,
    readOnly,
    selectionActionContext,
    selectionDragContextIsCurrent,
    selectionDragGesture,
  ])
  useEffect(() => {
    if (!selectionDragModeActive) return
    if (!props.selectionDragSource?.mode || readOnly) exitSelectionDragMode()
  }, [exitSelectionDragMode, props.selectionDragSource, readOnly, selectionDragModeActive])
  useEffect(() => {
    const cancelActiveDrag = () => {
      if (selectionDragGesture.held && !selectionDragModeActiveRef.current) cancelSelectionDrag()
    }
    const cancelOnKeyUp = (event: globalThis.KeyboardEvent) => {
      if (
        selectionDragGesture.held &&
        !selectionDragModeActiveRef.current &&
        isCanvasExternalDragChordKey(event.key, selectionDragShortcutModifierRef.current) &&
        !isCanvasExternalDragChordHeld(event, selectionDragShortcutModifierRef.current)
      ) {
        cancelSelectionDrag()
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        !selectionDragModeActiveRef.current &&
        isCanvasExternalDragChordHeld(event, selectionDragShortcutModifierRef.current) &&
        isCanvasExternalDragChordKey(event.key, selectionDragShortcutModifierRef.current)
      ) {
        armSelectionDrag()
        return
      }
      if (
        selectionDragGesture.held &&
        !selectionDragModeActiveRef.current &&
        !["Meta", "Control", "Shift"].includes(event.key)
      ) {
        cancelSelectionDrag()
      }
    }
    const cancelWhenHidden = () => {
      if (document.hidden) cancelActiveDrag()
    }
    window.addEventListener("blur", cancelActiveDrag)
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", cancelOnKeyUp, true)
    document.addEventListener("visibilitychange", cancelWhenHidden)
    return () => {
      window.removeEventListener("blur", cancelActiveDrag)
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", cancelOnKeyUp, true)
      document.removeEventListener("visibilitychange", cancelWhenHidden)
    }
  }, [armSelectionDrag, cancelSelectionDrag, selectionDragGesture])
  const startSelectionDrag = useCallback(() => {
    if (!selectionDragGesture.held || selectionDragGesture.consumed || !selectionDragContextIsCurrent()) {
      cancelSelectionDrag()
      return false
    }
    const started = selectionDragGesture.start()
    if (started && selectionDragModeActiveRef.current) {
      // A canceled HTML dragstart does not consistently emit dragend after
      // Electron takes over the native drag. Rearm independently so the mode
      // remains useful for consecutive exports.
      window.setTimeout(() => {
        if (
          !selectionDragMountedRef.current ||
          !selectionDragModeActiveRef.current ||
          !props.selectionDragSource ||
          !selectionDragContextIsCurrent()
        ) {
          return
        }
        selectionDragGesture.restart(props.selectionDragSource, selectionActionContext)
      }, 0)
    }
    return started
  }, [
    cancelSelectionDrag,
    props.selectionDragSource,
    selectionActionContext,
    selectionDragContextIsCurrent,
    selectionDragGesture,
  ])
  const startSave = useCallback(
    (document: CanvasDocument) => {
      if (!persistenceService || loadError || document.revision === 0) {
        savedRevisionRef.current = document.revision
        return Promise.resolve(document)
      }
      if (!saveErrorRef.current && savedRevisionRef.current === document.revision) return Promise.resolve(document)
      if (saveRevisionRef.current === document.revision && savePromiseRef.current) return savePromiseRef.current

      saveControllerRef.current?.abort()
      const controller = new AbortController()
      saveControllerRef.current = controller
      saveRevisionRef.current = document.revision
      const pending = persistenceService.save(document, controller.signal).then(
        (persisted) => {
          if (controller.signal.aborted) return document
          if (documentRef.current.revision === document.revision) {
            const action = {
              document: persisted,
              expectedRevision: document.revision,
              type: "acknowledge" as const,
            }
            const acknowledged = canvasHistoryReducer(historyRef.current, action)
            historyRef.current = acknowledged
            documentRef.current = acknowledged.document
            reduce(action)
            savedRevisionRef.current = persisted.revision
          }
          saveErrorRef.current = null
          setSaveError(null)
          return persisted
        },
        (error) => {
          if (controller.signal.aborted) return document
          const message = error instanceof Error ? error.message : String(error)
          saveErrorRef.current = message
          setSaveError(message)
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
    },
    [loadError, notifyError, persistenceService],
  )
  const abortPendingOperations = useCallback(() => {
    for (const controller of operationControllersRef.current) controller.abort()
    operationControllersRef.current.clear()
    abortCanvasReload(reloadControllerRef.current)
  }, [])
  const finalizeGestureAndSave = useCallback(async () => {
    const current = historyRef.current
    const finalized = current.gestureStart ? canvasHistoryReducer(current, { type: "end-gesture" }) : current
    if (finalized !== current) {
      historyRef.current = finalized
      documentRef.current = finalized.document
      reduce({ type: "end-gesture" })
    }
    await startSave(finalized.document)
  }, [startSave])
  const acceptHydratedDocument = useCallback((document: CanvasDocument) => {
    selectionActionControllerRef.current?.abort()
    hasLocalEditsRef.current = false
    savedRevisionRef.current = document.revision
    const hydrated = canvasHistoryReducer(historyRef.current, { type: "hydrate", document })
    historyRef.current = hydrated
    documentRef.current = hydrated.document
    reduce({ type: "hydrate", document })
  }, [])
  const reloadDocument = useCallback(
    (signal?: AbortSignal) => {
      if (!persistenceService) return Promise.resolve()
      selectionActionControllerRef.current?.abort()
      const reloadScope = resourceMutationScopeRef.current
      return reloadQueueRef.current.request(async () => {
        if (signal?.aborted) return
        await waitForStableLoad()
        if (
          signal?.aborted ||
          !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, reloadScope)
        )
          return
        if (loadError) throw new Error(loadError)
        const loadBarrier = createCanvasLoadBarrier()
        loadBarrierRef.current = loadBarrier
        hydratingRef.current = true
        setHydrating(true)
        setLoadError(null)
        const controller = new AbortController()
        abortCanvasReload(reloadControllerRef.current)
        reloadControllerRef.current = controller
        const unlinkAbortSignal = linkCanvasReloadAbortSignal(signal, controller)
        try {
          await startSave(historyRef.current.document)
          if (controller.signal.aborted) throw canvasReloadAbortError(controller.signal)
          const documentId = documentRef.current.id
          const document = await persistenceService.load(documentId, controller.signal)
          if (controller.signal.aborted) throw canvasReloadAbortError(controller.signal)
          if (!document) throw new Error(`Canvas document was not found: ${documentId}`)
          if (
            document.id !== documentId ||
            documentRef.current.id !== documentId ||
            !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, reloadScope)
          ) {
            throw new Error("Canvas changed while reloading")
          }
          acceptHydratedDocument(document)
          loadBarrier.resolve()
        } catch (error) {
          const outcome = settleCanvasReloadFailure({
            currentScope: () => resourceMutationScopeRef.current,
            error,
            notifyError: (title, failure) => {
              if (loadBarrierRef.current === loadBarrier) notifyError(title, failure)
            },
            rejectBarrier: loadBarrier.reject,
            reloadScope,
            resolveBarrier: loadBarrier.resolve,
            setLoadError: (message) => {
              if (loadBarrierRef.current !== loadBarrier) return
              setLoadError(message)
            },
            signal: controller.signal,
          })
          if (outcome === "failed") throw error
        } finally {
          unlinkAbortSignal()
          if (reloadControllerRef.current === controller) reloadControllerRef.current = undefined
          runCanvasReloadScopeEffect({
            currentScope: () => resourceMutationScopeRef.current,
            effect: () => {
              if (loadBarrierRef.current !== loadBarrier) return
              hydratingRef.current = false
              setHydrating(false)
            },
            reloadScope,
          })
        }
      })
    },
    [acceptHydratedDocument, loadError, notifyError, persistenceService, startSave, waitForStableLoad],
  )
  const reloadAuthoritativeDocument = useCallback(
    (signal?: AbortSignal) => {
      if (!persistenceService) {
        return Promise.reject(new Error("Canvas persistence is required to load the authoritative document"))
      }
      selectionActionControllerRef.current?.abort()
      return reloadQueueRef.current.request(async () => {
        if (signal?.aborted) return
        const reloadScope = resourceMutationScopeRef.current
        const presentedScope = presentedDocumentScopeRef.current
        const blockWhileRecovering =
          Boolean(loadError) ||
          !presentedScope ||
          !isCanvasResourceMutationScopeCurrent(() => presentedScope, reloadScope)
        const loadBarrier = createCanvasLoadBarrier()
        loadBarrierRef.current = loadBarrier
        hydratingRef.current = true
        setHydrating(true)
        if (blockWhileRecovering) setBlockingLoad(true)
        setLoadError(null)
        const controller = new AbortController()
        abortCanvasReload(reloadControllerRef.current)
        reloadControllerRef.current = controller
        const unlinkAbortSignal = linkCanvasReloadAbortSignal(signal, controller)
        operationControllersRef.current.add(controller)
        let rendered: Promise<void> | undefined
        try {
          if (controller.signal.aborted) throw canvasReloadAbortError(controller.signal)
          const documentId = documentRef.current.id
          // Main has already committed the authoritative document. Never persist the stale renderer projection here.
          const document = await persistenceService.load(documentId, controller.signal)
          if (controller.signal.aborted) throw canvasReloadAbortError(controller.signal)
          if (!document) throw new Error(`Canvas document was not found: ${documentId}`)
          if (
            document.id !== documentId ||
            documentRef.current.id !== documentId ||
            !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, reloadScope)
          ) {
            throw new Error("Canvas changed while loading the authoritative document")
          }
          rendered = waitForAuthoritativeRender(document)
          acceptHydratedDocument(document)
          presentedDocumentScopeRef.current = reloadScope
          loadBarrier.resolve()
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
            loadBarrier.resolve()
            return
          }
          loadBarrier.reject(error)
          runCanvasReloadScopeEffect({
            currentScope: () => resourceMutationScopeRef.current,
            effect: () => {
              setLoadError(error instanceof Error ? error.message : String(error))
              notifyError("Could not load authoritative canvas", error)
            },
            reloadScope,
          })
          throw error
        } finally {
          unlinkAbortSignal()
          if (reloadControllerRef.current === controller) reloadControllerRef.current = undefined
          if (loadBarrierRef.current === loadBarrier && hydratingRef.current) {
            loadBarrierRef.current = createCanvasLoadBarrier(true)
          }
          runCanvasReloadScopeEffect({
            currentScope: () => resourceMutationScopeRef.current,
            effect: () => {
              hydratingRef.current = false
              setHydrating(false)
              if (blockWhileRecovering) setBlockingLoad(false)
            },
            reloadScope,
          })
          operationControllersRef.current.delete(controller)
        }
        await rendered
      })
    },
    [acceptHydratedDocument, loadError, notifyError, persistenceService, waitForAuthoritativeRender],
  )
  useEffect(() => props.onDocumentChange?.(history.document), [history.document, props.onDocumentChange])
  useEffect(() => {
    const nodeIds = new Set(history.document.nodes.map((node) => node.id))
    const edgeIds = new Set(history.document.edges.map((edge) => edge.id))
    const current = selectionRef.current
    const next = {
      nodeIds: new Set([...current.nodeIds].filter((id) => nodeIds.has(id))),
      edgeIds: new Set([...current.edgeIds].filter((id) => edgeIds.has(id))),
    }
    replaceSelection(next)
  }, [history.document.edges, history.document.nodes, replaceSelection])
  useEffect(() => {
    if (!persistenceService) {
      hydratingRef.current = false
      presentedDocumentScopeRef.current = null
      setHydrating(false)
      setBlockingLoad(false)
      setLoadError(null)
      loadBarrierRef.current.resolve()
      return
    }
    setHydrating(true)
    hydratingRef.current = true
    setLoadError(null)
    const controller = new AbortController()
    const previousLoadBarrier = loadBarrierRef.current
    const loadBarrier = createCanvasLoadBarrier()
    loadBarrierRef.current = loadBarrier
    previousLoadBarrier.resolve()
    const loadScope = resourceMutationScopeRef.current
    const presentedScope = presentedDocumentScopeRef.current
    if (!presentedScope || !isCanvasResourceMutationScopeCurrent(() => presentedScope, loadScope)) {
      setBlockingLoad(true)
    }
    const documentId = history.document.id
    const isCurrentLoad = () =>
      !controller.signal.aborted &&
      loadBarrierRef.current === loadBarrier &&
      isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, loadScope)
    void persistenceService.load(documentId, controller.signal).then(
      (document) => {
        const authoritativeRetry = authoritativeLoadRequestedRef.current
        if (isCurrentLoad() && authoritativeRetry && !document) {
          const error = new Error(`Canvas document was not found: ${documentId}`)
          setHydrating(false)
          setBlockingLoad(false)
          hydratingRef.current = false
          setLoadError(error.message)
          loadBarrier.reject(error)
          notifyError("Could not load canvas", error)
          return
        }
        if (
          isCurrentLoad() &&
          document &&
          documentRef.current.id === documentId &&
          (authoritativeRetry || (documentRef.current.revision === 0 && !hasLocalEditsRef.current))
        ) {
          if (!leavingRef.current) {
            acceptHydratedDocument(document)
            authoritativeLoadRequestedRef.current = false
          }
        }
        if (isCurrentLoad()) {
          presentedDocumentScopeRef.current = loadScope
          setHydrating(false)
          setBlockingLoad(false)
          hydratingRef.current = false
          loadBarrier.resolve()
        }
      },
      (error) => {
        if (isCurrentLoad()) {
          setHydrating(false)
          setBlockingLoad(false)
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
  }, [acceptHydratedDocument, history.document.id, loadAttempt, notifyError, persistenceService, props.viewScopeId])
  useLayoutEffect(() => {
    void startSave(history.document).catch(() => undefined)
  }, [history.document.revision, saveAttempt, startSave])
  useEffect(() => {
    const preventUnsavedClose = (event: BeforeUnloadEvent) => {
      const hasUnsavedRevision = documentRef.current.revision !== savedRevisionRef.current
      if (
        !pendingDraftsRef.current.hasPending() &&
        !saveErrorRef.current &&
        !saveControllerRef.current &&
        !historyRef.current.gestureStart &&
        !hasUnsavedRevision
      )
        return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", preventUnsavedClose)
    return () => window.removeEventListener("beforeunload", preventUnsavedClose)
  }, [])
  useEffect(
    () => () => {
      leavingRef.current = true
      for (const controller of operationControllersRef.current) controller.abort()
      operationControllersRef.current.clear()
      abortCanvasReload(reloadControllerRef.current)
      saveControllerRef.current?.abort()
    },
    [],
  )
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
    if (!searchOpen) return
    const panel = searchPanelRef.current
    if (!panel) return
    return bindCanvasSearchDismissal({
      document,
      onDismiss: () => setSearchOpen(false),
      panel,
      window,
    })
  }, [searchOpen])
  useEffect(() => {
    if (pendingConnection && !history.document.nodes.some((node) => node.id === pendingConnection.nodeId)) {
      setPendingConnection(null)
    }
  }, [history.document.nodes, pendingConnection])
  const runResourceMutation = useCallback(
    (input: Omit<CanvasResourceMutationRequest, "expectedRevision" | "signal">) => {
      if (!mutationService || readOnly) return
      const controller = new AbortController()
      operationControllersRef.current.add(controller)
      void (async () => {
        const operationScope = resourceMutationScopeRef.current
        try {
          const document = documentRef.current
          const result = await mutationService.add({
            ...input,
            expectedRevision: document.revision,
            signal: controller.signal,
          })
          await completeCanvasResourceMutation({
            currentScope: () => resourceMutationScopeRef.current,
            operationScope,
            reload: reloadAuthoritativeDocument,
            result,
            selectNodes,
            show: (notification) => notificationService?.show(notification),
            signal: controller.signal,
          })
        } catch (error) {
          handleCanvasResourceMutationFailure({
            currentScope: () => resourceMutationScopeRef.current,
            error,
            notifyError,
            operationScope,
            signal: controller.signal,
          })
        } finally {
          operationControllersRef.current.delete(controller)
        }
      })()
    },
    [mutationService, notificationService, notifyError, readOnly, reloadAuthoritativeDocument, selectNodes],
  )
  const runResourceRelink = useCallback(
    async (
      operation: (input: { expectedRevision: number; signal: AbortSignal }) => Promise<{
        revision: number
        warnings: readonly string[]
      }>,
      successTitle: string,
    ) => {
      if (readOnly) return
      const controller = new AbortController()
      operationControllersRef.current.add(controller)
      const operationScope = resourceMutationScopeRef.current
      try {
        const result = await operation({
          expectedRevision: documentRef.current.revision,
          signal: controller.signal,
        })
        if (
          controller.signal.aborted ||
          !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, operationScope)
        )
          return
        try {
          await reloadDocument(controller.signal)
        } catch {
          if (!controller.signal.aborted) {
            notificationService?.show({
              description: "Reload the Canvas to show the committed resource.",
              kind: "warning",
              title: `${successTitle}, but refresh failed`,
            })
          }
          return
        }
        if (
          controller.signal.aborted ||
          !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, operationScope)
        )
          return
        notificationService?.show({
          description: result.warnings.length ? result.warnings.join("\n") : undefined,
          kind: result.warnings.length ? "warning" : "success",
          title: successTitle,
        })
      } catch (error) {
        handleCanvasResourceMutationFailure({
          currentScope: () => resourceMutationScopeRef.current,
          error,
          notifyError,
          operationScope,
          signal: controller.signal,
          title: "Could not relink resource",
        })
      } finally {
        operationControllersRef.current.delete(controller)
      }
    },
    [notificationService, notifyError, readOnly, reloadDocument],
  )
  const requestResourceRelink = useCallback(
    (nodeId: string) => {
      if (!mutationService?.relink || readOnly) return
      relinkNodeIdRef.current = nodeId
      relinkInputRef.current?.click()
    },
    [mutationService, readOnly],
  )
  const requestSelectedResourceRelink = useCallback(
    (nodeId: string) => {
      if (!mutationService?.relink || readOnly) return
      void runResourceRelink(
        ({ expectedRevision, signal }) => mutationService.relink!({ expectedRevision, nodeId, signal }),
        "Resource relinked",
      )
    },
    [mutationService, readOnly, runResourceRelink],
  )
  const saveEditableCopy = useCallback(
    (nodeId: string) => {
      if (!mutationService?.saveEditableCopy || readOnly) return Promise.resolve()
      return runResourceRelink(
        ({ expectedRevision, signal }) => mutationService.saveEditableCopy!({ expectedRevision, nodeId, signal }),
        "Editable copy saved",
      )
    },
    [mutationService, readOnly, runResourceRelink],
  )
  const addTextResource = useCallback(
    (position?: CanvasPoint, relation?: CanvasResourceMutationRequest["relation"]) => {
      runResourceMutation({
        anchor: position ?? nextInsertPoint(),
        files: [],
        relation,
        sources: [{ kind: "new-text", sourceId: createCanvasId("source"), text: "" }],
      })
      setNodeMenuOpen(false)
      setInsertPoint(null)
      telemetryService?.track({ name: "canvas.node.added", properties: { type: "text" } })
    },
    [nextInsertPoint, runResourceMutation, telemetryService],
  )
  const createNodeForType = useCallback(
    (type: string, position: CanvasPoint, data?: Record<string, unknown>) => {
      try {
        const fileRenderer = props.fileRendererRegistry.get(type)
        if (fileRenderer?.create) return createCanvasFileNode(fileRenderer, { data, position })
        return props.nodeRegistry.get(type)?.create?.({ data, position })
      } catch (error) {
        notifyError("Could not create canvas node", error)
        return undefined
      }
    },
    [notifyError, props.fileRendererRegistry, props.nodeRegistry],
  )
  const addNode = useCallback(
    (type: string, position?: CanvasPoint) => {
      if (readOnly || leavingRef.current || hydratingRef.current || saveErrorRef.current) return undefined
      if (type === "text") {
        addTextResource(position)
        return undefined
      }
      const preferredPosition = position ?? insertPoint ?? pointerRef.current ?? pointAtCenter()
      const created = createNodeForType(type, preferredPosition)
      if (!created) return undefined
      const node = {
        ...created,
        position: findOpenCanvasPoint(history.document, preferredPosition, getCanvasNodeSize(created)),
      }
      const result = addCanvasNodes(history.document, [node])
      dispatch({ type: "commit", document: result.document })
      selectNodes(result.selectedNodeIds)
      setNodeMenuOpen(false)
      setInsertPoint(null)
      telemetryService?.track({ name: "canvas.node.added", properties: { type } })
      return node.id
    },
    [
      addTextResource,
      createNodeForType,
      history.document,
      insertPoint,
      pointAtCenter,
      readOnly,
      selectNodes,
      telemetryService,
    ],
  )
  useImperativeHandle(
    props.editorRef,
    () => ({
      async flush() {
        await waitForStableLoad()
        return startSave(historyRef.current.document)
      },
      insertNode(type) {
        return addNode(type)
      },
      invalidateResources() {
        return resourceRefreshController?.invalidateResources() ?? Promise.resolve()
      },
      openGenerate() {
        requestGenerate()
      },
      openSearch() {
        setSearchOpen(true)
      },
      async prepareToLeave() {
        await waitForStableLoad()
        leavingRef.current = true
        setLeaving(true)
        const canLeave = await pendingDraftsRef.current.prepareToLeave(
          () => draftDecisionService?.decide({ count: pendingDraftsRef.current.pendingCount() }) ?? "cancel",
        )
        if (!canLeave) return false
        abortPendingOperations()
        await finalizeGestureAndSave()
        return true
      },
      async reload() {
        await reloadDocument()
      },
      async reloadAuthoritative() {
        await reloadAuthoritativeDocument()
      },
      resumeAfterLeaveCanceled() {
        leavingRef.current = false
        setLeaving(false)
      },
      selectNodes(nodeIds) {
        selectNodes(nodeIds)
      },
      submitGeneration(submission) {
        submitGenerationRef.current(submission)
      },
    }),
    [
      abortPendingOperations,
      addNode,
      draftDecisionService,
      finalizeGestureAndSave,
      props.editorRef,
      reloadDocument,
      reloadAuthoritativeDocument,
      resourceRefreshController,
      selectNodes,
      requestGenerate,
      startSave,
      waitForStableLoad,
    ],
  )
  const duplicate = useCallback(() => {
    if (!hasNodeOnlySelection) return
    const result = duplicateCanvasSelection(history.document, selectedNodeIds)
    dispatch({ type: "commit", document: result.document })
    selectNodes(result.selectedNodeIds)
  }, [hasNodeOnlySelection, history.document, selectedNodeIds, selectNodes])
  const duplicateNode = useCallback(
    (nodeId: string) => {
      const result = duplicateCanvasSelection(documentRef.current, [nodeId])
      if (result.selectedNodeIds.length === 0) return
      dispatch({ type: "commit", document: result.document })
      selectNodes(result.selectedNodeIds)
    },
    [selectNodes],
  )
  const quickConnect = useCallback(
    (nodeId: string, side: "left" | "right", nodeType: string, targetPosition?: CanvasPoint) => {
      if (readOnly) return
      if (nodeType === "text") {
        const anchor = documentRef.current.nodes.find((node) => node.id === nodeId)
        if (!anchor) return
        const anchorSize = getCanvasNodeSize(anchor)
        const parentPosition = anchor.parentId
          ? getNodeWorldPosition(documentRef.current, anchor.parentId)
          : { x: 0, y: 0 }
        const anchorWorld = {
          x: anchor.position.x + parentPosition.x,
          y: anchor.position.y + parentPosition.y,
        }
        addTextResource(
          targetPosition ?? {
            x: side === "right" ? anchorWorld.x + anchorSize.width + 160 : anchorWorld.x - 480,
            y: anchorWorld.y,
          },
          {
            anchorNodeIds: [nodeId],
            direction: side === "right" ? "from-anchor" : "to-anchor",
            mode: "connect",
          },
        )
        return
      }
      const created = createNodeForType(nodeType, targetPosition ?? { x: 0, y: 0 })
      if (!created) return
      commit((document) => {
        const anchor = document.nodes.find((node) => node.id === nodeId)
        if (!anchor) return document
        const anchorSize = getCanvasNodeSize(anchor)
        const createdSize = getCanvasNodeSize(created)
        const parentPosition = anchor.parentId ? getNodeWorldPosition(document, anchor.parentId) : { x: 0, y: 0 }
        const localTarget = targetPosition
          ? { x: targetPosition.x - parentPosition.x, y: targetPosition.y - parentPosition.y }
          : null
        const preferredPosition = localTarget
          ? {
              x: side === "right" ? localTarget.x : localTarget.x - createdSize.width,
              y: localTarget.y - createdSize.height / 2,
            }
          : {
              x:
                side === "right"
                  ? anchor.position.x + anchorSize.width + 160
                  : anchor.position.x - createdSize.width - 160,
              y: anchor.position.y + (anchorSize.height - createdSize.height) / 2,
            }
        const node: CanvasNode = {
          ...created,
          extent: anchor.parentId ? "parent" : created.extent,
          parentId: anchor.parentId,
          position: anchor.parentId ? preferredPosition : findOpenCanvasPoint(document, preferredPosition, createdSize),
        }
        const withNode = addCanvasNodes(document, [node]).document
        return connectCanvasNodes(
          withNode,
          side === "right"
            ? {
                source: anchor.id,
                sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
                target: node.id,
                targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
              }
            : {
                source: node.id,
                sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
                target: anchor.id,
                targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
              },
        )
      })
      selectNodes([created.id])
      telemetryService?.track({ name: "canvas.node.connected", properties: { side, type: nodeType } })
    },
    [addTextResource, commit, createNodeForType, readOnly, selectNodes, telemetryService],
  )
  const remove = useCallback(() => {
    commit((document) => removeCanvasElements(document, { nodeIds: selectedNodeIds, edgeIds: selectedEdgeIds }))
    updateSelection([])
  }, [commit, selectedEdgeIds, selectedNodeIds, updateSelection])
  const removeNode = useCallback(
    (nodeId: string) => {
      commit((document) => removeCanvasElements(document, { nodeIds: [nodeId] }))
      updateSelection([])
    },
    [commit, updateSelection],
  )
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
  const align = useCallback(
    (direction: CanvasAlign) => {
      if (!hasNodeOnlySelection || !canArrangeSelection) return
      commit((document) => alignCanvasNodes(document, arrangeNodeIds, direction))
    },
    [arrangeNodeIds, canArrangeSelection, commit, hasNodeOnlySelection],
  )
  const distribute = useCallback(
    (axis: CanvasDistribute) => {
      if (!hasNodeOnlySelection || !canDistributeSelection) return
      commit((document) => distributeCanvasNodes(document, arrangeNodeIds, axis))
    },
    [arrangeNodeIds, canDistributeSelection, commit, hasNodeOnlySelection],
  )
  const layout = useCallback(
    (value: CanvasLayout = "grid") => {
      if (!hasNodeOnlySelection || !canArrangeSelection) return
      commit((document) => layoutCanvasNodes(document, { nodeIds: arrangeNodeIds, layout: value }))
    },
    [arrangeNodeIds, canArrangeSelection, commit, hasNodeOnlySelection],
  )
  const tidySelection = useCallback(() => {
    if (!canArrangeSelection) return
    commit(
      (document) =>
        applyCanvasBusinessCommand(document, {
          type: "canvas.auto-layout",
          nodeIds: arrangeNodeIds,
          options: { strategy: autoLayoutStrategy },
        }).document,
    )
  }, [arrangeNodeIds, autoLayoutStrategy, canArrangeSelection, commit])
  const runCanvasLayout = useCallback(
    (strategy: CanvasDirectedAutoLayoutStrategy) => {
      if (!canLayoutCanvas || hydratingRef.current || leavingRef.current) return
      const result = applyCanvasBusinessCommand(documentRef.current, {
        options: { strategy },
        type: "canvas.auto-layout",
      })
      dispatch({ document: result.document, type: "commit" })
      void fitDocumentViewport(result.document, {
        maxZoom: CANVAS_FIT_MAX_ZOOM,
        padding: CANVAS_FIT_PADDING,
      })
    },
    [canLayoutCanvas, dispatch, fitDocumentViewport],
  )
  const layoutCanvas = useCallback(() => runCanvasLayout(autoLayoutStrategy), [autoLayoutStrategy, runCanvasLayout])
  const changeAutoLayoutStrategy = useCallback(
    (strategy: CanvasDirectedAutoLayoutStrategy) => {
      setAutoLayoutStrategy(strategy)
      runCanvasLayout(strategy)
    },
    [runCanvasLayout],
  )
  const getClipboardPayload = useCallback(() => {
    if (!hasNodeOnlySelection) return null
    return createCanvasClipboardPayload(history.document, selectedNodeIds, props.clipboardScope)
  }, [hasNodeOnlySelection, history.document, props.clipboardScope, selectedNodeIds])
  const applyClipboardPayload = useCallback(
    (payload: NonNullable<ReturnType<typeof createCanvasClipboardPayload>>) => {
      if (canvasClipboardHasScopeConflict(payload, props.clipboardScope)) {
        notificationService?.show({
          kind: "warning",
          title: "Referenced files cannot be pasted between scopes",
          description: "Add the source file or folder to this scope so the host can create a valid local reference.",
        })
        return true
      }
      const roots = payload.nodes.filter((node) => !node.parentId)
      const target = insertPoint ?? pointerRef.current
      const offset =
        target && roots.length
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
      return true
    },
    [dispatch, insertPoint, notificationService, props.clipboardScope, selectNodes],
  )
  const copy = useCallback(() => {
    const payload = getClipboardPayload()
    if (!payload) return
    rootRef.current?.focus({ preventScroll: true })
    if (typeof document !== "undefined" && typeof document.execCommand === "function" && document.execCommand("copy"))
      return
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard) {
      notifyError("Could not copy selection", new Error("System clipboard is unavailable"))
      return
    }
    void clipboard.writeText(serializeCanvasClipboard(payload)).then(
      () => notificationService?.show({ kind: "info", title: "Copied to clipboard" }),
      (error) => notifyError("Could not copy selection", error),
    )
  }, [getClipboardPayload, notificationService, notifyError])
  const paste = useCallback(() => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard) {
      notifyError("Could not read clipboard", new Error("System clipboard is unavailable"))
      return
    }
    void clipboard.readText().then(
      (value) => {
        const payload = parseCanvasClipboard(value)
        if (payload) applyClipboardPayload(payload)
      },
      (error) => notifyError("Could not read clipboard", error),
    )
  }, [applyClipboardPayload, notifyError])
  const onCanvasCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (isCanvasEditableShortcutTarget(event.target)) return
      const payload = getClipboardPayload()
      if (!payload) return
      writeCanvasClipboard(event.clipboardData, payload)
      event.preventDefault()
      event.stopPropagation()
      notificationService?.show({ kind: "info", title: "Copied to clipboard" })
    },
    [getClipboardPayload, notificationService],
  )
  const onCanvasPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (readOnly || isCanvasEditableShortcutTarget(event.target) || event.clipboardData.files.length > 0) return
      const payload = readCanvasClipboard(event.clipboardData)
      if (!payload) return
      applyClipboardPayload(payload)
      event.preventDefault()
      event.stopPropagation()
    },
    [applyClipboardPayload, readOnly],
  )

  const uploadFiles = useCallback(
    (
      files: readonly File[],
      position?: CanvasPoint,
      transfer?: { data: Readonly<Record<string, string>>; types: readonly string[] },
    ) => {
      if (!mutationService || (files.length === 0 && !transfer) || readOnly) return
      const anchor = position ?? pointerRef.current ?? pointAtCenter()
      runResourceMutation({ anchor, files, sources: [], transfer })
    },
    [mutationService, pointAtCenter, readOnly, runResourceMutation],
  )
  const runGenerate = useCallback(
    (submission: CanvasGenerationComposerSubmission) => {
      if (!generateService || readOnly || generationControllerRef.current) return
      const currentDocument = documentRef.current
      if (
        !isCanvasGenerationComposerSubmissionCurrent(submission, {
          documentId: currentDocument.id,
          revision: currentDocument.revision,
          scopeId: props.viewScopeId ?? "",
        })
      )
        return
      setGenerating(true)
      props.onGenerationStateChange?.(true)
      const controller = new AbortController()
      operationControllersRef.current.add(controller)
      const document = currentDocument
      const documentId = document.id
      const expectedRevision = document.revision
      const anchor = insertPoint ?? pointerRef.current ?? pointAtCenter()
      generationControllerRef.current = { controller, documentId }
      void (async () => {
        await startSave(document)
        if (
          controller.signal.aborted ||
          documentRef.current.id !== documentId ||
          documentRef.current.revision !== expectedRevision
        )
          return undefined
        return generateService.generate({
          anchor,
          context: { documentId, selectedNodeIds: submission.selectedNodeIds, source: "canvas" },
          expectedRevision,
          output: submission.tool.output,
          prompt: submission.prompt,
          ...(submission.promptContextNodeIds.length > 0
            ? { promptContextNodeIds: submission.promptContextNodeIds }
            : {}),
          references: submission.references,
          signal: controller.signal,
          toolId: submission.tool.id,
          ...(submission.toolInput && Object.keys(submission.toolInput).length > 0
            ? { toolInput: submission.toolInput }
            : {}),
        })
      })()
        .then(
          (result) => {
            if (!result || controller.signal.aborted || documentRef.current.id !== documentId) return
            setGenerateOpen(false)
            notificationService?.show({
              description: result.warnings.length > 0 ? result.warnings.join("\n") : undefined,
              kind: result.warnings.length > 0 ? "warning" : "success",
              title:
                result.createdNodeIds.length > 0
                  ? `${result.createdNodeIds.length} generated item${result.createdNodeIds.length === 1 ? "" : "s"} added`
                  : "Generation complete",
            })
          },
          (error) => {
            if (!controller.signal.aborted) notifyError("Generation failed", error)
          },
        )
        .finally(() => {
          operationControllersRef.current.delete(controller)
          if (generationControllerRef.current?.controller === controller) {
            generationControllerRef.current = null
            setGenerating(false)
            props.onGenerationStateChange?.(false)
          }
        })
    },
    [
      generateService,
      insertPoint,
      notificationService,
      notifyError,
      pointAtCenter,
      props.onGenerationStateChange,
      props.viewScopeId,
      readOnly,
      startSave,
    ],
  )
  submitGenerationRef.current = runGenerate
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
      armExternalDrag: () => {
        if (!selectionDragModeActiveRef.current) armSelectionDrag()
      },
      cancelExternalDrag: () => {
        if (selectionDragModeActiveRef.current) exitSelectionDragMode()
        else cancelSelectionDrag()
      },
      clearSelection: clearOverlays,
      copy,
      delete: remove,
      duplicate,
      fitView: fitCanvas,
      generate: () => {
        requestGenerate()
      },
      group,
      layout: () =>
        resolveCanvasTidyShortcutScope(canArrangeSelection, selectedNodeIds.length) === "selection"
          ? tidySelection()
          : layoutCanvas(),
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
    {
      canArmExternalDrag: Boolean(props.selectionDragSource) && !readOnly && !selectionDragModeActive,
      externalDragShortcutModifier: props.selectionDragSource?.shortcutModifier,
      externalDragArmed: selectionDragChordHeld,
    },
  )
  const controller = useMemo(
    () => ({
      document: history.document,
      hydrating,
      selection,
      selectionContext,
      readOnly,
      canUpload: Boolean(mutationService),
      fileRenderers: props.fileRendererRegistry,
      connectionNodeTypes,
      visibleSelectionActions,
      visibleSelectionDragSource,
      selectionDragArmed,
      selectionDragChordHeld,
      selectionDragModeActive,
      selectionDragStatus: selectionDragGesture.status,
      beginGesture: () => dispatch({ type: "begin-gesture" }),
      cancelGesture: () => dispatch({ type: "cancel-gesture" }),
      endGesture: () => dispatch({ type: "end-gesture" }),
      commit,
      duplicateNode,
      executeSelectionAction,
      isSelectionActionPending,
      finishSelectionDrag,
      setSelectionDragCandidateNode,
      startSelectionDrag,
      quickConnect,
      relinkResource: requestResourceRelink,
      relinkSelectedResource: requestSelectedResourceRelink,
      reloadAuthoritative: reloadAuthoritativeDocument,
      replaceResourceState: (nodeId: string, state: CanvasResourceRuntimeState) =>
        dispatch({
          type: "replace-update",
          update: (document) => replaceCanvasNodeResourceState(document, nodeId, state),
        }),
      registerPendingDraft: (draft: CanvasPendingDraft) => pendingDraftsRef.current.register(draft),
      removeNode,
      saveEditableCopy,
      selectNodes,
    }),
    [
      commit,
      connectionNodeTypes,
      duplicateNode,
      executeSelectionAction,
      history.document,
      hydrating,
      isSelectionActionPending,
      props.fileRendererRegistry,
      quickConnect,
      readOnly,
      finishSelectionDrag,
      requestResourceRelink,
      requestSelectedResourceRelink,
      reloadAuthoritativeDocument,
      removeNode,
      saveEditableCopy,
      selectNodes,
      selection,
      selectionActionStateVersion,
      selectionDragArmed,
      selectionDragChordHeld,
      selectionDragModeActive,
      selectionDragGesture,
      selectionDragStateVersion,
      selectionContext,
      startSelectionDrag,
      setSelectionDragCandidateNode,
      mutationService,
      visibleSelectionActions,
      visibleSelectionDragSource,
    ],
  )
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      const selectionChanges = changes.filter((change) => change.type === "select")
      if (selectionChanges.length > 0 && !boxSelectionActiveRef.current) {
        replaceSelection(applyReactFlowEdgeSelectionChanges(selectionRef.current, selectionChanges))
      }
      const documentChanges = changes.filter((change) => change.type !== "select")
      if (documentChanges.length === 0) return
      commit((document) => ({ ...document, edges: applyEdgeChanges(documentChanges, document.edges) }))
    },
    [commit, replaceSelection],
  )
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      let effectiveChanges = altDragRef.current
        ? remapCanvasDuplicateDragChanges(changes, altDragRef.current.duplicatedNodeIdBySourceId)
        : changes
      const snapSession = snapSessionRef.current
      if (snapEnabledRef.current && snapSession) {
        const zoom = reactFlowRef.current.getViewport().zoom
        const snapped = snapCanvasNodePositionChanges(
          effectiveChanges,
          snapSession,
          CANVAS_SNAP_TOLERANCE_SCREEN_PX / Math.max(zoom, Number.EPSILON),
        )
        effectiveChanges = snapped.changes
        setSnapLines(snapped.lines)
      }
      const selectionChanges = effectiveChanges.filter((change) => change.type === "select")
      if (selectionChanges.length > 0) {
        replaceSelection(applyReactFlowNodeSelectionChanges(selectionRef.current, selectionChanges))
      }
      const documentChanges = effectiveChanges.filter((change) => change.type !== "select" && change.type !== "remove")
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
    },
    [dispatch, replaceSelection],
  )
  const handleConnect = useCallback(
    (connection: Connection) => commit((document) => connectCanvasNodes(document, connection)),
    [commit],
  )
  const handleConnectStart = useCallback<OnConnectStart>(
    (event, params) => {
      setPendingConnection(null)
      updateConnectionTargetNode(null)
      const pointerScreen = getEventClientPoint(event)
      if (!params.nodeId || !params.handleId || !pointerScreen) {
        connectionStartRef.current = null
        return
      }
      connectionStartRef.current = {
        nodeId: params.nodeId,
        pointerScreen,
        side: params.handleId.includes("left") ? "left" : "right",
      }
    },
    [updateConnectionTargetNode],
  )
  const handleConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const start = connectionStartRef.current
      connectionStartRef.current = null
      const targetScreen = getEventClientPoint(event)
      const targetNodeId =
        start && targetScreen
          ? getCanvasCardAtScreenPoint(rootRef.current, documentRef.current, targetScreen, start.nodeId)
          : null
      updateConnectionTargetNode(null)
      if (!start || !targetScreen) return
      if (Math.hypot(targetScreen.x - start.pointerScreen.x, targetScreen.y - start.pointerScreen.y) <= 4) return
      if (connectionState.isValid || !connectionState.fromNode) return
      if (targetNodeId) {
        if (targetNodeId !== start.nodeId) {
          commit((document) =>
            connectCanvasNodes(document, createCanvasCardConnection(start.nodeId, start.side, targetNodeId)),
          )
        }
        ignoreConnectionPaneClickRef.current = true
        window.setTimeout(() => {
          ignoreConnectionPaneClickRef.current = false
        }, 250)
        return
      }
      const bounds = rootRef.current?.getBoundingClientRect()
      if (
        !bounds ||
        targetScreen.x < bounds.left ||
        targetScreen.x > bounds.right ||
        targetScreen.y < bounds.top ||
        targetScreen.y > bounds.bottom
      )
        return
      ignoreConnectionPaneClickRef.current = true
      window.setTimeout(() => {
        ignoreConnectionPaneClickRef.current = false
      }, 250)
      setPendingConnection({
        nodeId: start.nodeId,
        side: start.side,
        targetPosition: reactFlow.screenToFlowPosition(targetScreen),
      })
    },
    [commit, reactFlow, updateConnectionTargetNode],
  )
  const handleNodeDragStart = useCallback<OnNodeDrag<CanvasNode>>(
    (event, node, draggedNodes) => {
      dispatch({ type: "begin-gesture" })
      altDragRef.current = null
      setSnapLines([])
      let snapDocument = documentRef.current
      let draggingIds = draggedNodes.length > 0 ? draggedNodes.map((draggedNode) => draggedNode.id) : [node.id]
      if (event.altKey) {
        const currentSelection = selectionRef.current
        const nodeIds = currentSelection.nodeIds.has(node.id) ? [...currentSelection.nodeIds] : [node.id]
        const plan = createCanvasDuplicateDragPlan(documentRef.current, nodeIds, event.metaKey || event.ctrlKey)
        if (plan) {
          altDragRef.current = { duplicatedNodeIdBySourceId: plan.duplicatedNodeIdBySourceId }
          snapDocument = plan.document
          draggingIds = draggingIds.map((id) => plan.duplicatedNodeIdBySourceId.get(id) ?? id)
          dispatch({ type: "commit", document: plan.document })
          selectNodes(plan.selectedNodeIds)
        }
      }
      snapSessionRef.current = snapEnabledRef.current ? createCanvasNodeSnapSession(snapDocument, draggingIds) : null
    },
    [dispatch, selectNodes],
  )
  const handleNodeDragStop = useCallback(() => {
    altDragRef.current = null
    snapSessionRef.current = null
    setSnapLines([])
    dispatch({ type: "end-gesture" })
  }, [dispatch])
  const handleBoxSelectionStart = useCallback(() => {
    boxSelectionActiveRef.current = true
    // React Flow clears the controlled selection immediately before this
    // callback, while its internal lookup still uses the pre-gesture selection
    // as the first box-delta baseline. Restore the snapshot captured during the
    // pane's pointer-down capture phase so this does not depend on React's event
    // batching or a stale render closure.
    const baseline = boxSelectionBaselineRef.current ?? {
      edgeIds: new Set<string>(),
      nodeIds: new Set(selectionRef.current.nodeIds),
    }
    boxSelectionBaselineRef.current = null
    selectionRef.current = baseline
    setSelection(baseline)
  }, [])
  const handleBoxSelectionEnd = useCallback(() => {
    boxSelectionActiveRef.current = false
    boxSelectionBaselineRef.current = null
  }, [])
  const searchResults = useMemo(
    () => (searchOpen ? queryCanvasNodes(history.document, { limit: 8, text: query }) : []),
    [history.document, query, searchOpen],
  )

  return (
    <CanvasEditorProvider controller={controller}>
      <CanvasOverlayRootProvider root={overlayRoot}>
        <TooltipProvider>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                ref={setCanvasRoot}
                className={cn(
                  "convax-canvas relative size-full overflow-hidden bg-background text-foreground outline-none",
                  spacePanning && "is-space-panning",
                  props.className,
                )}
                data-canvas-color-scheme={appearance.colorScheme}
                onCopy={onCanvasCopy}
                onDragOver={(event) => {
                  if (!mutationService || readOnly) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "copy"
                }}
                onDrop={(event) => {
                  if (!mutationService || readOnly) return
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
                  if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("react-flow__pane"))
                    return
                  addNode("text", reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
                }}
                onKeyDown={shortcutHandler}
                onPaste={onCanvasPaste}
                onPointerCancelCapture={() => {
                  boxSelectionActiveRef.current = false
                  boxSelectionBaselineRef.current = null
                }}
                onPointerDownCapture={(event) => {
                  const canvasRoot = rootRef.current
                  const interactiveTarget =
                    event.target instanceof Element
                      ? event.target.closest(CANVAS_POINTER_FOCUS_INTERACTIVE_SELECTOR)
                      : null
                  if (event.button === 0 && (!interactiveTarget || !canvasRoot?.contains(interactiveTarget))) {
                    canvasRoot?.focus({ preventScroll: true })
                  }
                  if (
                    event.button === 0 &&
                    event.target instanceof HTMLElement &&
                    event.target.classList.contains("react-flow__pane")
                  ) {
                    boxSelectionBaselineRef.current = {
                      edgeIds: new Set<string>(),
                      nodeIds: new Set(selectionRef.current.nodeIds),
                    }
                  }
                }}
                onPointerMove={(event) => {
                  const connectionStart = connectionStartRef.current
                  if (connectionStart) {
                    updateConnectionTargetNode(
                      getCanvasCardAtScreenPoint(
                        rootRef.current,
                        documentRef.current,
                        { x: event.clientX, y: event.clientY },
                        connectionStart.nodeId,
                      ),
                    )
                  }
                  if (
                    !(event.target instanceof HTMLElement) ||
                    event.target.closest("button, input, textarea, [data-canvas-shortcuts='ignore']")
                  )
                    return
                  pointerRef.current = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
                }}
                style={canvasAppearanceStyle(appearance)}
                tabIndex={0}
              >
                <ReactFlow
                  colorMode={appearance.colorScheme}
                  connectOnClick={false}
                  connectionDragThreshold={4}
                  connectionLineComponent={CanvasConnectionLine}
                  deleteKeyCode={null}
                  edgeTypes={edgeTypes}
                  edges={edges}
                  elementsSelectable={!readOnly}
                  fitView
                  fitViewOptions={CANVAS_FIT_VIEW_OPTIONS}
                  maxZoom={CANVAS_MAX_ZOOM}
                  minZoom={CANVAS_MIN_ZOOM}
                  nodeTypes={nodeTypes}
                  nodes={nodes}
                  nodesConnectable={!readOnly}
                  nodesDraggable={!readOnly && !spacePanning && !selectionDragChordHeld}
                  nodesFocusable
                  nodeDragThreshold={4}
                  onlyRenderVisibleElements={props.onlyRenderVisibleElements ?? true}
                  autoPanOnNodeFocus={false}
                  panActivationKeyCode="Space"
                  panOnDrag={CANVAS_PAN_ON_DRAG}
                  panOnScroll
                  selectionKeyCode={null}
                  selectionOnDrag={!readOnly}
                  selectionMode={SelectionMode.Partial}
                  snapGrid={CANVAS_SNAP_GRID}
                  snapToGrid={snapEnabled}
                  zoomActivationKeyCode={CANVAS_ZOOM_ACTIVATION_KEYS}
                  zoomOnDoubleClick={false}
                  zoomOnPinch
                  zoomOnScroll={false}
                  onConnect={handleConnect}
                  onConnectEnd={handleConnectEnd}
                  onConnectStart={handleConnectStart}
                  onEdgesChange={handleEdgesChange}
                  onNodeContextMenu={(_, node) => {
                    if (!selection.nodeIds.has(node.id)) selectNodes([node.id])
                    setInsertPoint(node.position)
                  }}
                  onNodeDoubleClick={(_, node) => selectNodes([node.id])}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDragStop={handleNodeDragStop}
                  onNodesChange={handleNodesChange}
                  onSelectionEnd={handleBoxSelectionEnd}
                  onSelectionStart={handleBoxSelectionStart}
                  onPaneClick={() => {
                    boxSelectionActiveRef.current = false
                    boxSelectionBaselineRef.current = null
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
                  {appearance.gridStyle !== "none" ? (
                    <Background
                      color="var(--canvas-grid)"
                      gap={appearance.gridGap}
                      size={appearance.gridSize}
                      variant={appearance.gridStyle === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
                    />
                  ) : null}
                  <CanvasSnapGuides lines={snapLines} />
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
                      quickConnect(connection.nodeId, connection.side, type, connection.targetPosition)
                    }}
                    side={pendingConnection.side}
                    sourceNodeId={pendingConnection.nodeId}
                    targetPosition={pendingConnection.targetPosition}
                  />
                ) : null}

                {selectionDragModeActive && props.selectionDragSource?.mode ? (
                  <CanvasSelectionDragModeStatus
                    description={props.selectionDragSource.mode.description}
                    exitLabel={props.selectionDragSource.mode.exitLabel}
                    icon={props.selectionDragSource.icon ?? <FileOutput className="size-4" />}
                    onExit={exitSelectionDragMode}
                  />
                ) : null}

                {blockingLoad || loadError ? (
                  <div className="absolute inset-0 z-40 grid place-items-center bg-background/75 backdrop-blur-[2px]">
                    <div className="flex max-w-sm flex-col items-center gap-3 rounded-md border border-border bg-card px-5 py-4 text-center text-sm text-muted-foreground shadow-sm">
                      {loadError ? (
                        <>
                          <TriangleAlert className="size-5 text-destructive" />
                          <div>
                            <div className="font-medium text-foreground">Canvas could not be loaded</div>
                            <div className="mt-1 text-xs">{loadError}</div>
                          </div>
                          <Button
                            onClick={() => {
                              authoritativeLoadRequestedRef.current = true
                              loadBarrierRef.current = createCanvasLoadBarrier()
                              setLoadAttempt((attempt) => attempt + 1)
                            }}
                            size="sm"
                            variant="outline"
                          >
                            Retry
                          </Button>
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
                        <Button onClick={() => setSaveAttempt((attempt) => attempt + 1)} size="sm">
                          Retry save
                        </Button>
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
                      <div className="text-xs text-muted-foreground">
                        This window stays open until the canvas is saved or the last change is reverted.
                      </div>
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
                    onTidy={tidySelection}
                    nodeIds={selectedNodeIds}
                    onUngroup={ungroup}
                  />
                ) : null}

                <ViewportToolbar
                  autoLayoutStrategy={autoLayoutStrategy}
                  canLayout={canLayoutCanvas}
                  edgesHidden={edgesHidden}
                  miniMapVisible={miniMapVisible}
                  onEdgesHiddenChange={() => setEdgesHidden((hidden) => !hidden)}
                  onFit={fitCanvas}
                  onLayout={layoutCanvas}
                  onLayoutStrategyChange={changeAutoLayoutStrategy}
                  onMiniMapChange={() => setMiniMapVisible((visible) => !visible)}
                  onSearch={() => setSearchOpen(true)}
                  onSnapChange={() =>
                    setSnapEnabled((enabled) => {
                      if (enabled) setSnapLines([])
                      return !enabled
                    })
                  }
                  onZoomIn={() => void reactFlow.zoomIn({ duration: 140 })}
                  onZoomOut={() => void reactFlow.zoomOut({ duration: 140 })}
                  snapEnabled={snapEnabled}
                />

                {nodeMenuOpen ? (
                  <FloatingPanel className="left-1/2 top-20 w-64 -translate-x-1/2">
                    <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">Add to canvas</div>
                    <div className="grid grid-cols-2 gap-1">
                      {connectionNodeTypes.map((definition) => (
                        <Button
                          key={definition.type}
                          className="justify-start"
                          onClick={() => addNode(definition.type)}
                          size="sm"
                          variant="ghost"
                        >
                          {definition.type === "text" ? (
                            <Type />
                          ) : definition.type === "agent" ? (
                            <Sparkles />
                          ) : (
                            <FileUp />
                          )}
                          {definition.label}
                        </Button>
                      ))}
                    </div>
                  </FloatingPanel>
                ) : null}

                {generateOpen && generateService ? (
                  <FloatingPanel className="left-1/2 top-20 w-[min(440px,calc(100%-32px))] -translate-x-1/2">
                    <CanvasGenerationPanel
                      autoFocus
                      disabled={readOnly}
                      document={history.document}
                      generateService={generateService}
                      onSubmit={runGenerate}
                      scopeId={currentViewScopeId}
                      selectedNodeIds={selectedNodeIds}
                      submitting={generating}
                    />
                  </FloatingPanel>
                ) : null}

                {searchOpen ? (
                  <div
                    aria-label="Search nodes"
                    aria-modal="true"
                    className="convax-node-search__layer"
                    data-canvas-shortcuts="ignore"
                    role="dialog"
                  >
                    <div aria-hidden="true" className="convax-node-search__backdrop" />
                    <div data-convax-node-search-panel="true" ref={searchPanelRef}>
                      <FloatingPanel className="convax-node-search__panel left-1/2 top-20 w-[min(380px,calc(100%-32px))] -translate-x-1/2">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                          <Input
                            autoFocus
                            className="convax-node-search__input"
                            data-canvas-shortcuts="ignore"
                            onChange={(event) => setQuery(event.currentTarget.value)}
                            placeholder="Search nodes"
                            value={query}
                          />
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
                    </div>
                  </div>
                ) : null}

                <input
                  ref={uploadInputRef}
                  className="hidden"
                  data-canvas-resource-picker="upload"
                  multiple
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const files = [...(event.currentTarget.files ?? [])]
                    handleCanvasResourceUploadSelection(files, uploadFiles)
                    event.currentTarget.value = ""
                  }}
                  type="file"
                />
                <input
                  ref={relinkInputRef}
                  className="hidden"
                  data-canvas-resource-picker="relink"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const relinkNodeId = relinkNodeIdRef.current
                    relinkNodeIdRef.current = null
                    handleCanvasResourceRelinkSelection(
                      relinkNodeId,
                      [...(event.currentTarget.files ?? [])],
                      (nodeId, file) => {
                        if (!mutationService?.relink) return
                        void runResourceRelink(
                          ({ expectedRevision, signal }) =>
                            mutationService.relink!({ expectedRevision, file, nodeId, signal }),
                          "Resource relinked",
                        )
                      },
                    )
                    event.currentTarget.value = ""
                  }}
                  type="file"
                />
              </div>
            </ContextMenuTrigger>
            <CanvasContextMenu
              canArrange={hasNodeOnlySelection && canArrangeSelection}
              canDistribute={hasNodeOnlySelection && canDistributeSelection}
              canExport={Boolean(exportService)}
              canGenerate={Boolean(generateService)}
              canGroup={selectionContext.kind === "multi-node"}
              canRedo={history.future.length > 0}
              canUngroup={hasSingleGroupSelection}
              canUndo={history.past.length > 0}
              canUpload={Boolean(mutationService)}
              createItems={connectionNodeTypes}
              generating={generating}
              hasNodeSelection={hasNodeOnlySelection}
              hasSelection={selectedNodeIds.length > 0 || selectedEdgeIds.length > 0}
              onAddNode={addNode}
              onAlign={align}
              onCopy={copy}
              onDelete={remove}
              onDistribute={distribute}
              onDuplicate={duplicate}
              onExport={exportCanvas}
              onFit={fitCanvas}
              onGenerate={requestGenerate}
              onGroup={group}
              onLayout={tidySelection}
              onPaste={paste}
              onRedo={() => dispatch({ type: "redo" })}
              onSelectionDragModeChange={(active) => {
                if (active) enterSelectionDragMode()
                else exitSelectionDragMode()
              }}
              onUngroup={ungroup}
              onUndo={() => dispatch({ type: "undo" })}
              onUpload={() => uploadInputRef.current?.click()}
              readOnly={readOnly}
              selectionDragMode={
                props.selectionDragSource?.mode
                  ? {
                      active: selectionDragModeActive,
                      icon: props.selectionDragSource.icon ?? <FileOutput className="size-4" />,
                      label: props.selectionDragSource.mode.label,
                    }
                  : undefined
              }
            />
          </ContextMenu>
        </TooltipProvider>
      </CanvasOverlayRootProvider>
    </CanvasEditorProvider>
  )
}

function IconButton(props: {
  disabled?: boolean
  expanded?: boolean
  hasPopup?: "menu"
  icon: ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
  shortcut?: string
  tooltipSide?: "bottom" | "left" | "right" | "top"
}) {
  return (
    <Tooltip
      content={
        <span className="flex items-center gap-3">
          {props.label}
          {props.shortcut ? <Shortcut>{props.shortcut}</Shortcut> : null}
        </span>
      }
      side={props.tooltipSide}
    >
      <span className="inline-flex">
        <Button
          aria-expanded={props.expanded}
          aria-haspopup={props.hasPopup}
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
  return (
    <div
      className={cn(
        "convax-tool-surface absolute z-20 flex items-center rounded-md border p-1 text-card-foreground",
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

function FloatingPanel(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "convax-floating-panel absolute z-30 rounded-md border p-3 text-popover-foreground",
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

function CanvasSelectionDragModeStatus(props: {
  description: string
  exitLabel: string
  icon: ReactNode
  onExit: () => void
}) {
  return (
    <ToolSurface className="bottom-3 left-1/2 z-30 max-w-[calc(100%-32px)] -translate-x-1/2 gap-2 border-primary/30 bg-card/95 px-3 py-2 shadow-md">
      <span className="shrink-0 text-primary">{props.icon}</span>
      <span aria-live="polite" className="min-w-0 text-xs font-medium" role="status">
        {props.description}
      </span>
      <Button aria-label={props.exitLabel} className="shrink-0 gap-1" onClick={props.onExit} size="sm" variant="ghost">
        <X className="size-3.5" />
        {props.exitLabel}
      </Button>
    </ToolSurface>
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
  nodeIds: string[]
  onAlign: (direction: CanvasAlign) => void
  onAction: (action: CanvasSelectionAction) => void
  onDelete: () => void
  onDistribute: (axis: CanvasDistribute) => void
  onDuplicate: () => void
  onGroup: () => void
  onLayout: (layout: CanvasLayout) => void
  onTidy: () => void
  onUngroup: () => void
}) {
  const [arrangeMenuOpen, setArrangeMenuOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const partitionedActions = partitionCanvasSelectionActions(props.actions)
  useEffect(() => {
    if (!arrangeMenuOpen && !actionsMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        (menuRef.current?.contains(event.target) || actionsMenuRef.current?.contains(event.target))
      )
        return
      setArrangeMenuOpen(false)
      setActionsMenuOpen(false)
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setArrangeMenuOpen(false)
        setActionsMenuOpen(false)
      }
    }
    window.addEventListener("pointerdown", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [actionsMenuOpen, arrangeMenuOpen])
  useEffect(() => {
    if (props.canArrange) return
    setArrangeMenuOpen(false)
  }, [props.canArrange])
  return (
    <NodeToolbar
      className="convax-selection-toolbar nodrag nowheel"
      isVisible
      nodeId={props.nodeIds}
      offset={16}
      position={Position.Top}
    >
      <div
        className="convax-selection-toolbar__surface convax-tool-surface flex items-center gap-0.5 border text-card-foreground"
        data-canvas-shortcuts="ignore"
      >
        <IconButton icon={<Copy />} label="Duplicate" onClick={props.onDuplicate} shortcut="⌘D" tooltipSide="top" />
        <IconButton
          disabled={!props.canGroup}
          icon={<Group />}
          label="Group"
          onClick={props.onGroup}
          shortcut="⌘G"
          tooltipSide="top"
        />
        <IconButton
          disabled={!props.canUngroup}
          icon={<Ungroup />}
          label="Ungroup"
          onClick={props.onUngroup}
          shortcut="⇧⌘G"
          tooltipSide="top"
        />
        {props.actions.length > 0 ? <span className="mx-1 h-5 w-px bg-border" /> : null}
        {partitionedActions.primary.map((action) => {
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
        {partitionedActions.overflow.length > 0 ? (
          <div className="relative" ref={actionsMenuRef}>
            <IconButton
              icon={<Ellipsis />}
              label="More selection actions"
              onClick={() => setActionsMenuOpen((open) => !open)}
              pressed={actionsMenuOpen}
              tooltipSide="top"
            />
            {actionsMenuOpen ? (
              <div
                className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                data-canvas-shortcuts="ignore"
                role="menu"
              >
                {partitionedActions.overflow.map((action) => {
                  const pending = props.isActionPending(action.id)
                  return (
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50",
                        action.presentation?.tone === "destructive" && "text-destructive",
                      )}
                      disabled={pending}
                      key={action.id}
                      onClick={() => {
                        props.onAction(action)
                        setActionsMenuOpen(false)
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <span className="[&>svg]:size-3.5">
                        {pending ? <LoaderCircle className="animate-spin" /> : (action.icon ?? <Workflow />)}
                      </span>
                      <span>{action.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
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
        <IconButton
          disabled={!props.canArrange}
          icon={<LayoutGrid />}
          label="Tidy up"
          onClick={props.onTidy}
          shortcut="⌥⇧F"
          tooltipSide="top"
        />
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton icon={<Trash2 />} label="Delete" onClick={props.onDelete} shortcut="⌫" tooltipSide="top" />
      </div>
    </NodeToolbar>
  )
}

const zoomPresets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** Matches the Canvas edge-visibility affordance: topology, not generic visibility. */
function CanvasEdgeVisibilityIcon() {
  return (
    <svg
      aria-hidden="true"
      data-canvas-toolbar-icon="edge-visibility"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M4.25 4.75h3.5M8.25 4.75h3.5M4.25 11.25h7.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
      <circle cx="3" cy="4.75" fill="currentColor" r="1.35" />
      <circle cx="8" cy="4.75" fill="currentColor" r="1.35" />
      <circle cx="13" cy="4.75" fill="currentColor" r="1.35" />
      <circle cx="3" cy="11.25" fill="currentColor" r="1.35" />
      <circle cx="13" cy="11.25" fill="currentColor" r="1.35" />
    </svg>
  )
}

const canvasDirectedLayoutActions = [
  {
    icon: <AlignHorizontalSpaceBetween />,
    label: "Horizontal flow",
    strategy: "horizontal-directed-cluster",
  },
  {
    icon: <AlignVerticalSpaceBetween />,
    label: "Vertical flow",
    strategy: "vertical-directed-cluster",
  },
] satisfies readonly {
  icon: ReactNode
  label: string
  strategy: CanvasDirectedAutoLayoutStrategy
}[]

function CanvasSnapGuides({ lines }: { lines: readonly CanvasSnapLine[] }) {
  const viewport = useViewport()
  if (lines.length === 0) return null
  return (
    <div aria-hidden="true" className="convax-snap-guides">
      {lines.map((line) => {
        const position = line.value * viewport.zoom + (line.axis === "x" ? viewport.x : viewport.y)
        return (
          <div
            key={`${line.axis}:${line.value}`}
            className={cn("convax-snap-guide", line.axis === "x" ? "is-vertical" : "is-horizontal")}
            data-canvas-snap-guide={line.axis}
            style={line.axis === "x" ? { left: position } : { top: position }}
          />
        )
      })}
    </div>
  )
}

function ViewportToolbar(props: {
  autoLayoutStrategy: CanvasDirectedAutoLayoutStrategy
  canLayout: boolean
  edgesHidden: boolean
  miniMapVisible: boolean
  onEdgesHiddenChange: () => void
  onFit: () => void
  onLayout: () => void
  onLayoutStrategyChange: (strategy: CanvasDirectedAutoLayoutStrategy) => void
  onMiniMapChange: () => void
  onSearch: () => void
  onSnapChange: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  snapEnabled: boolean
}) {
  const viewport = useViewport()
  const reactFlow = useReactFlow<CanvasNode>()
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!layoutMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && layoutMenuRef.current?.contains(event.target)) return
      setLayoutMenuOpen(false)
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLayoutMenuOpen(false)
    }
    window.addEventListener("pointerdown", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [layoutMenuOpen])
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
      <IconButton icon={<Search />} label="Search" onClick={props.onSearch} shortcut="⌘F" tooltipSide="top" />
      <span className="mx-1 h-5 w-px bg-border" />
      <IconButton icon={<Focus />} label="Fit view" onClick={props.onFit} shortcut="⌘0" tooltipSide="top" />
      <IconButton
        icon={<CanvasEdgeVisibilityIcon />}
        label={props.edgesHidden ? "Show edges" : "Hide edges"}
        onClick={props.onEdgesHiddenChange}
        pressed={props.edgesHidden}
        tooltipSide="top"
      />
      <div ref={layoutMenuRef} className="relative flex items-center">
        <IconButton
          disabled={!props.canLayout}
          icon={<LayoutGrid />}
          label="Tidy canvas"
          onClick={props.onLayout}
          shortcut="⌥⇧F"
          tooltipSide="top"
        />
        <Tooltip content="Tidy direction" side="top">
          <Button
            aria-expanded={layoutMenuOpen}
            aria-haspopup="menu"
            aria-label="Choose tidy direction"
            className="-ml-1 size-6 px-0"
            disabled={!props.canLayout}
            onClick={() => setLayoutMenuOpen((open) => !open)}
            size="sm"
            variant="ghost"
          >
            <ChevronUp className={cn("size-3 transition-transform", layoutMenuOpen && "rotate-180")} />
          </Button>
        </Tooltip>
        {layoutMenuOpen ? (
          <div className="convax-zoom-menu convax-layout-menu" data-canvas-shortcuts="ignore" role="menu">
            <div className="convax-zoom-menu__title">Tidy direction</div>
            {canvasDirectedLayoutActions.map((action) => (
              <button
                key={action.strategy}
                aria-checked={props.autoLayoutStrategy === action.strategy}
                className="convax-zoom-menu__item"
                onClick={() => {
                  props.onLayoutStrategyChange(action.strategy)
                  setLayoutMenuOpen(false)
                }}
                role="menuitemradio"
                type="button"
              >
                <span className="flex items-center gap-2">
                  {action.icon}
                  <span>{action.label}</span>
                </span>
                {props.autoLayoutStrategy === action.strategy ? <Check /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <IconButton
        icon={<Magnet />}
        label="Snap and alignment guides"
        onClick={props.onSnapChange}
        pressed={props.snapEnabled}
        tooltipSide="top"
      />
      <IconButton
        icon={<MapPinned />}
        label="Minimap"
        onClick={props.onMiniMapChange}
        pressed={props.miniMapVisible}
        tooltipSide="top"
      />
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
  canExport: boolean
  canGenerate: boolean
  canGroup: boolean
  canRedo: boolean
  canUngroup: boolean
  canUndo: boolean
  canUpload: boolean
  createItems: readonly { label: string; type: string }[]
  generating: boolean
  hasNodeSelection: boolean
  hasSelection: boolean
  onAddNode: (type: string) => void
  onAlign: (direction: CanvasAlign) => void
  onCopy: () => void
  onDelete: () => void
  onDistribute: (axis: CanvasDistribute) => void
  onDuplicate: () => void
  onExport: () => void
  onFit: () => void
  onGenerate: () => void
  onGroup: () => void
  onLayout: () => void
  onPaste: () => void
  onRedo: () => void
  onSelectionDragModeChange: (active: boolean) => void
  onUngroup: () => void
  onUndo: () => void
  onUpload: () => void
  readOnly: boolean
  selectionDragMode?: {
    active: boolean
    icon: ReactNode
    label: string
  }
}) {
  return (
    <ContextMenuContent className="w-60">
      {!props.readOnly ? <ContextMenuLabel>Create</ContextMenuLabel> : null}
      {!props.readOnly
        ? props.createItems.map((item) => (
            <ContextMenuItem key={item.type} onSelect={() => props.onAddNode(item.type)}>
              {item.type === "text" ? (
                <Type />
              ) : item.type === "agent" ? (
                <Bot />
              ) : item.type === "image" ? (
                <ImagePlus />
              ) : item.type === "video" ? (
                <Video />
              ) : (
                <FileUp />
              )}
              Add {item.label}
            </ContextMenuItem>
          ))
        : null}
      {props.canUpload && !props.readOnly ? (
        <ContextMenuItem onSelect={props.onUpload}>
          <FileUp />
          Upload files
        </ContextMenuItem>
      ) : null}
      {props.canGenerate && !props.readOnly ? (
        <ContextMenuItem disabled={props.generating} onSelect={props.onGenerate}>
          {props.generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          Generate<Shortcut>⌘↵</Shortcut>
        </ContextMenuItem>
      ) : null}
      {!props.readOnly ? <ContextMenuSeparator /> : null}
      <ContextMenuLabel>Canvas</ContextMenuLabel>
      {!props.readOnly ? (
        <ContextMenuItem onSelect={props.onPaste}>
          <ClipboardPaste />
          Paste<Shortcut>⌘V</Shortcut>
        </ContextMenuItem>
      ) : null}
      {!props.readOnly ? (
        <ContextMenuItem disabled={!props.canUndo} onSelect={props.onUndo}>
          <Undo2 />
          Undo<Shortcut>⌘Z</Shortcut>
        </ContextMenuItem>
      ) : null}
      {!props.readOnly ? (
        <ContextMenuItem disabled={!props.canRedo} onSelect={props.onRedo}>
          <Redo2 />
          Redo<Shortcut>⇧⌘Z</Shortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={props.onFit}>
        <Focus />
        Fit view<Shortcut>⌘0</Shortcut>
      </ContextMenuItem>
      {props.canExport ? (
        <ContextMenuItem onSelect={props.onExport}>
          <Download />
          Export
        </ContextMenuItem>
      ) : null}
      {props.selectionDragMode && !props.readOnly ? (
        <ContextMenuItem onSelect={() => props.onSelectionDragModeChange(!props.selectionDragMode?.active)}>
          {props.selectionDragMode.icon}
          {props.selectionDragMode.active ? "Exit " : ""}
          {props.selectionDragMode.label}
        </ContextMenuItem>
      ) : null}
      {props.hasSelection ? <ContextMenuSeparator /> : null}
      {props.hasSelection ? <ContextMenuLabel>Selection</ContextMenuLabel> : null}
      {props.hasNodeSelection ? (
        <ContextMenuItem onSelect={props.onCopy}>
          <Copy />
          Copy<Shortcut>⌘C</Shortcut>
        </ContextMenuItem>
      ) : null}
      {props.hasNodeSelection && !props.readOnly ? (
        <ContextMenuItem onSelect={props.onDuplicate}>
          <Copy />
          Duplicate<Shortcut>⌘D</Shortcut>
        </ContextMenuItem>
      ) : null}
      {props.canGroup && !props.readOnly ? (
        <ContextMenuItem onSelect={props.onGroup}>
          <Group />
          Group<Shortcut>⌘G</Shortcut>
        </ContextMenuItem>
      ) : null}
      {props.canUngroup && !props.readOnly ? (
        <ContextMenuItem onSelect={props.onUngroup}>
          <Ungroup />
          Ungroup<Shortcut>⇧⌘G</Shortcut>
        </ContextMenuItem>
      ) : null}
      {props.canArrange && !props.readOnly ? (
        <ContextMenuItem onSelect={props.onLayout}>
          <LayoutGrid />
          Tidy up<Shortcut>⌥⇧F</Shortcut>
        </ContextMenuItem>
      ) : null}
      {props.canArrange && !props.readOnly ? (
        <ContextMenuItem onSelect={() => props.onAlign("left")}>
          <AlignStartVertical />
          Align left
        </ContextMenuItem>
      ) : null}
      {props.canArrange && !props.readOnly ? (
        <ContextMenuItem onSelect={() => props.onAlign("top")}>
          <AlignStartHorizontal />
          Align top
        </ContextMenuItem>
      ) : null}
      {props.canDistribute && !props.readOnly ? (
        <ContextMenuItem onSelect={() => props.onDistribute("horizontal")}>
          <AlignHorizontalSpaceBetween />
          Distribute horizontally
        </ContextMenuItem>
      ) : null}
      {props.canDistribute && !props.readOnly ? (
        <ContextMenuItem onSelect={() => props.onDistribute("vertical")}>
          <AlignVerticalSpaceBetween />
          Distribute vertically
        </ContextMenuItem>
      ) : null}
      {props.hasSelection && !props.readOnly ? <ContextMenuSeparator /> : null}
      {props.hasSelection && !props.readOnly ? (
        <ContextMenuItem className="text-destructive" onSelect={props.onDelete}>
          <Trash2 />
          Delete<Shortcut>⌫</Shortcut>
        </ContextMenuItem>
      ) : null}
    </ContextMenuContent>
  )
}
