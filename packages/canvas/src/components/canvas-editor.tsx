import {
  Background,
  BackgroundVariant,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  useReactFlow,
  useStoreApi,
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
  Loading,
  LoadingSpinner,
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
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  Columns3,
  Copy,
  Download,
  Ellipsis,
  FileOutput,
  FileUp,
  Focus,
  Folder,
  FolderOpen,
  Group,
  Hand,
  ImagePlus,
  LayoutGrid,
  Magnet,
  MapPinned,
  MousePointer2,
  Plus,
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
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type ForwardedRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
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
  CANVAS_POST_MUTATION_REVEAL,
  isCanvasCameraMotionCurrent,
  isCanvasPostMutationRevealGuardCurrent,
  resolveCanvasAnchoredZoomViewport,
  resolveCanvasFocusAvoidanceViewport,
  resolveCanvasSafeViewportRect,
  resolveCanvasVisibleWorldRect,
  resolveInitialCanvasCameraFit,
  shouldRevealCanvasNodes,
  type CanvasPostMutationRevealGuard,
  type CanvasViewportInsets,
} from "../camera"
import {
  findOpenCanvasPoint,
  queryCanvasNodes,
  type CanvasApplicationCommand,
  type CanvasApplicationCommandResult,
  type CanvasAutoLayoutStrategy,
} from "../application"
import { canvasAppearanceStyle, resolveCanvasAppearance, type CanvasAppearanceInput } from "../appearance"
import { canvasFileKindLabel, canvasMessage, resolveCanvasUiLocale, type CanvasUiLocale } from "../copy"
import {
  applyCanvasFilePickerAccept,
  canPickLocalCanvasRelinkFile,
  canvasFilePickerAccept,
  isCanvasFileCompatibleWithKind,
} from "../file-import"
import {
  addCanvasNodes,
  canGroupCanvasNodes,
  type CanvasNodeGeometryUpdate,
  type CanvasAlign,
  type CanvasDistribute,
  type CanvasLayout,
  connectCanvasNodes,
  removeCanvasElements,
  ungroupCanvasNode,
} from "../commands"
import {
  canvasClipboardHasScopeConflict,
  createCanvasClipboardPayload,
  parseCanvasClipboard,
  readCanvasClipboard,
  serializeCanvasClipboard,
  writeCanvasClipboard,
} from "../clipboard"
import { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } from "../builtin-registry"
import { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } from "../connections"
import { CANVAS_GROUP_FOLDER_SIZE, createCanvasId, getCanvasNodePresentationSize, getCanvasNodeSize } from "../document"
import { createCanvasFolderFocusNodes, getCanvasFolderFocusEntry } from "../directory-focus"
import { CanvasOverlayRootProvider } from "../editor-context"
import { CanvasEditorMutationSurfaceProvider } from "./canvas-mutation-surface"
import { CanvasGroupPresentationProvider } from "./group-presentation-context"
import { hasUnsupportedCanvasGroupFold, isCanvasGroupFolded } from "../group-fold"
import { projectCanvasGroupFocus, resolveCanvasGroupFocusForNodes } from "../group-focus"
import {
  isCanvasGenerationComposerSubmissionCurrent,
  type CanvasGenerationComposerSubmission,
} from "../generation-composer"
import {
  createCanvasSelectionProjection,
  type CanvasInspectorProjection,
  type CanvasSelectionProjection,
} from "../inspector"
import {
  CANVAS_MOTION_DURATION,
  CANVAS_NODE_ENTRY_FINISH_GRACE,
  CANVAS_NODE_ENTRY_MOUNT_TIMEOUT,
  CANVAS_REDUCED_MOTION_QUERY,
  CanvasNodeEntryPresentationStore,
  CanvasNodeEntryTracker,
  canvasMotionStyle,
  canvasViewportEase,
  resolveCanvasMotionDuration,
  resolveCanvasReducedMotion,
} from "../motion"
import {
  CANVAS_CONNECTION_RADIUS,
  isCanvasMultiSelectionPointerGesture,
  resolveCanvasInteractionPolicy,
  type CanvasInteractionTool,
} from "../interaction"
import { deriveCanvasSelectionContext, isNodeOnlySelectionContext } from "../selection-context"
import {
  createOptimisticAlignedResourceGhosts,
  createOptimisticEmptyNodeGhosts,
  inspectDroppedCanvasResourcePresentations,
  isEmptyLocalCanvasResourceCreate,
  scheduleCanvasOptimisticResourceHandoffAfterPaint,
} from "../optimistic-resource-projection"
import {
  CanvasCombinedPresentationStore,
  CanvasMergedOptimisticOverlayStore,
  CanvasOptimisticOverlayCoordinator,
  type CanvasGhostEdge,
  type CanvasGhostNode,
  type CanvasOptimisticOverlaySnapshot,
} from "../optimistic-overlay"
import {
  createCanvasConnectionGhost,
  createCanvasDuplicateOverlay,
  createCanvasHideEntityOverlay,
  createCanvasReplacePresentationOverlay,
} from "../optimistic-overlay-plans"
import {
  applyCanvasReplacePresentation,
  projectCanvasGhostEdgeForReactFlow,
  projectCanvasGhostNodeForReactFlow,
} from "../optimistic-overlay-react-flow"
import {
  createCanvasNodeSnapSession,
  resolveCanvasNodeSnapScopeNodeIds,
  type CanvasNodeSnapSession,
  type CanvasSnapLine,
} from "../snapping"
import { applyReactFlowEdgeSelectionChanges, applyReactFlowNodeSelectionChanges } from "./canvas-selection-sync"
import { snapCanvasNodePositionChanges } from "./canvas-node-snapping"
import { resolveCanvasOnlyRenderVisibleElements } from "./canvas-node-visibility"
import { createCanvasFileNode, type CanvasFileRendererRegistry } from "../file-renderer-registry"
import {
  CANVAS_RENDERER_VIEWPORT_MAX_NODES,
  canvasGeometryCommand,
  createReadonlyCanvasProjectionBootstrap,
  type CanvasEntityRef,
  type CanvasRendererCollaborationClient,
  type CanvasRendererProjectionStore,
  type CanvasRendererResourceHierarchyKey,
  type CanvasRendererResourceHierarchyTarget,
  type CanvasRendererViewportProjection,
} from "../collaboration"
import type { CanvasNodeRegistry } from "../node-registry"
import { CanvasReloadQueue } from "../reload-queue"
import {
  canvasCanonicalResourceIdentity,
} from "../resource-runtime-projection"
import { CanvasPersistentRuntimeMap } from "../persistent-runtime-map"
import {
  canvasDocumentPlacementIndex,
  installCanvasDocumentPlacementAppend,
  resolveIndexedCanvasResourcePlacements,
  type CanvasIndexedPlacementObstacle,
} from "../resource-placement"
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
  type CanvasFolderBrowseListing,
  type CanvasFolderBrowsePathEntry,
  type CanvasPendingDraft,
  type CanvasAcceptedPreparedResourceRuntime,
  type CanvasResourceMutationRequest,
  type CanvasResourceHydrationService,
  type CanvasServices,
  useCanvasService,
} from "../services"
// Runtime resource values stay at the Canvas-owned transient boundary.
import {
  parseCanvasResourceRuntimeState,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPoint,
  type CanvasResourceRuntimeState,
  type CanvasSelection,
  type CanvasSize,
} from "../types"
import {
  canRunCanvasShortcutCommand,
  isCanvasEditableShortcutTarget,
  resolveCanvasTidyShortcutScope,
  runCanvasShortcutCommand,
  type CanvasShortcutActions,
  type CanvasShortcutCommand,
} from "../use-canvas-shortcuts"
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
import { getCanvasNodeInsertionItems } from "./insertion-items"
import { PendingConnectionMenu } from "./pending-connection-menu"
import { useCanvasOverlayPresence } from "./use-overlay-presence"

const edgeTypes = { canvas: CanvasEdgeView } satisfies EdgeTypes
const CANVAS_FIT_DURATION = CANVAS_MOTION_DURATION.fit
const CANVAS_FIT_MAX_ZOOM = 1
const CANVAS_FIT_PADDING = 0.18
const CANVAS_CENTER_FIT_MAX_ZOOM = 1.2
const CANVAS_CENTER_FIT_PADDING = 0.08
const CANVAS_MIN_ZOOM = CANVAS_VIEW_MIN_ZOOM
const CANVAS_MAX_ZOOM = CANVAS_VIEW_MAX_ZOOM
const CANVAS_SNAP_GRID: [number, number] = [8, 8]
const CANVAS_SNAP_TOLERANCE_SCREEN_PX = 8
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
  "[data-canvas-shortcuts='ignore']",
].join(", ")
function subscribeToCanvasMotionPreference(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined
  const query = window.matchMedia(CANVAS_REDUCED_MOTION_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function readCanvasMotionPreference() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(CANVAS_REDUCED_MOTION_QUERY).matches
  )
}

function useCanvasReducedMotion() {
  return useSyncExternalStore(subscribeToCanvasMotionPreference, readCanvasMotionPreference, () => false)
}

type CanvasDirectedAutoLayoutStrategy = Extract<
  CanvasAutoLayoutStrategy,
  "horizontal-directed-cluster" | "vertical-directed-cluster"
>

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

function createCanvasCameraMotionInterruptWaiter(listeners: Set<() => void>) {
  let listener: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    listener = resolve
    listeners.add(listener)
  })
  return Object.freeze({
    dispose: () => listeners.delete(listener),
    promise,
  })
}

function equalIds(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((id) => right.has(id))
}

function isPositiveFiniteDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

/**
 * React Flow does not treat CSS width and height as known node dimensions.
 * Project persisted Canvas dimensions into its renderer-only initial fields so
 * an authoritative reload does not hide a freshly generated node.
 */
function projectCanvasNodeInitialDimensions(node: CanvasNode, measured?: CanvasSize): CanvasNode {
  const {
    dragging: _dragging,
    height: _height,
    initialHeight: _initialHeight,
    initialWidth: _initialWidth,
    measured: _measured,
    resizing: _resizing,
    selected: _selected,
    width: _width,
    ...projection
  } = node
  const initialWidth =
    measured === undefined && isPositiveFiniteDimension(node.style?.width) ? node.style.width : undefined
  const initialHeight =
    measured === undefined && isPositiveFiniteDimension(node.style?.height) ? node.style.height : undefined
  return {
    ...projection,
    ...(measured === undefined ? {} : { measured: { ...measured } }),
    ...(initialWidth === undefined ? {} : { initialWidth }),
    ...(initialHeight === undefined ? {} : { initialHeight }),
  }
}

/**
 * Group focus is a view projection over the same durable hierarchy. Its direct
 * children keep their parent-relative coordinates, but the hidden focus root
 * must not keep constraining pointer movement to its persisted frame.
 */
export function projectCanvasFocusedNode(node: CanvasNode, focusedGroupId: string | null): CanvasNode {
  if (!focusedGroupId || node.parentId !== focusedGroupId || node.extent === undefined) return node
  return { ...node, extent: undefined }
}

interface CanvasTransientGeometry {
  position?: CanvasPoint
  size?: CanvasSize
}

interface CanvasPendingGeometryValue<Value> {
  token: symbol
  value: Value
}

/**
 * Optimistic geometry is acknowledged per entity and field. Independent
 * gestures must coexist until their own canonical values arrive, while an old
 * submission failure may clear only the values published by its token.
 */
interface CanvasPendingNodeGeometry {
  entity: CanvasEntityRef
  position?: CanvasPendingGeometryValue<CanvasPoint>
  size?: CanvasPendingGeometryValue<CanvasSize>
}

function projectCanvasTransientNodeGeometry(
  node: CanvasNode,
  gesture: CanvasTransientGeometry | undefined,
  pending: CanvasPendingNodeGeometry | undefined,
): CanvasNode {
  const position = gesture?.position ?? pending?.position?.value
  const size = gesture?.size ?? pending?.size?.value
  const positionChanged =
    position !== undefined && (position.x !== node.position.x || position.y !== node.position.y)
  const sizeChanged = size !== undefined && !sameCanvasSize(size, getCanvasNodeSize(node))
  if (!positionChanged && !sizeChanged) return node
  return {
    ...node,
    ...(positionChanged ? { position } : {}),
    ...(sizeChanged ? { style: { ...node.style, height: size.height, width: size.width } } : {}),
  }
}

interface CanvasTransientMeasurement {
  canonicalSize: CanvasSize
  entity?: CanvasEntityRef
  rendererId: string
  size: CanvasSize
}

interface CanvasTransientResourceState {
  entity?: CanvasEntityRef
  localPreviewToken?: symbol
  rendererId: string
  resourceIdentity?: string
  state: CanvasResourceRuntimeState
}

interface CanvasLocalResourcePreview {
  nodeId: string
  objectUrl: string
  pending: boolean
  previous?: CanvasTransientResourceState
  token: symbol
}

function revokeCanvasLocalResourcePreviewUrl(url: string) {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // A renderer-only preview must never change the resource mutation outcome.
  }
}

function sameCanvasEntity(left: CanvasEntityRef | undefined, right: CanvasEntityRef | undefined) {
  return left?.id === right?.id && left?.incarnation === right?.incarnation
}

function sameCanvasSize(left: CanvasSize, right: CanvasSize) {
  return left.width === right.width && left.height === right.height
}

function canvasFileRendererIdentity(node: CanvasNode, registry: CanvasFileRendererRegistry) {
  const definition = registry.resolve(node.data)
  return definition ? `renderer:${definition.id}` : `missing:${node.data.kind}`
}

function sameCanvasTransientResourceOwner(
  transient: CanvasTransientResourceState,
  node: CanvasNode,
  entity: CanvasEntityRef | undefined,
) {
  if (transient.entity && !sameCanvasEntity(transient.entity, entity)) return false
  const resourceIdentity = canvasCanonicalResourceIdentity(node)
  return transient.resourceIdentity !== undefined ? transient.resourceIdentity === resourceIdentity : true
}

function submitCanvasTransientGeometry(
  session: CanvasRendererCollaborationClient,
  start: CanvasDocument,
  geometry: ReadonlyMap<string, CanvasTransientGeometry>,
  entities: ReadonlyMap<string, CanvasEntityRef>,
): Promise<boolean> {
  const updates: CanvasNodeGeometryUpdate[] = []
  for (const node of start.nodes) {
    const transient = geometry.get(node.id)
    const capturedEntity = entities.get(node.id)
    if (!transient || !capturedEntity || !sameCanvasEntity(capturedEntity, session.resolveNodeEntity(node.id))) continue
    const position = transient.position ?? node.position
    const startSize = getCanvasNodeSize(node)
    const positionChanged = position.x !== node.position.x || position.y !== node.position.y
    const sizeChanged =
      transient.size !== undefined &&
      (transient.size.width !== startSize.width || transient.size.height !== startSize.height)
    if (!positionChanged && !sizeChanged) continue
    updates.push({
      nodeId: node.id,
      position: { ...position },
      ...(sizeChanged ? { size: { ...transient.size! } } : {}),
    })
  }
  if (updates.length === 0) return Promise.resolve(false)
  return session.submit(canvasGeometryCommand(updates, (nodeId) => entities.get(nodeId))).then(() => true)
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
  return node?.id ?? null
}

function getCanvasGroupFolderAtScreenPoint(
  root: HTMLElement | null,
  canvasDocument: CanvasDocument,
  point: CanvasPoint,
  excludedNodeIds: ReadonlySet<string>,
) {
  if (!root || typeof document === "undefined") return null
  const elements =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(point.x, point.y)
      : [document.elementFromPoint(point.x, point.y)].filter((element): element is Element => Boolean(element))
  const paintedNodeIds: string[] = []
  for (const element of elements) {
    const nodeElement = element.closest(".react-flow__node[data-id]")
    if (!nodeElement || !root.contains(nodeElement)) continue
    const nodeId = nodeElement.getAttribute("data-id")
    if (nodeId) paintedNodeIds.push(nodeId)
  }
  return resolveCanvasGroupFolderDropTarget(canvasDocument, paintedNodeIds, excludedNodeIds)
}

export function resolveCanvasGroupFolderDropTarget(
  canvasDocument: CanvasDocument,
  paintedNodeIds: readonly string[],
  excludedNodeIds: ReadonlySet<string>,
) {
  for (const nodeId of paintedNodeIds) {
    if (excludedNodeIds.has(nodeId)) continue
    const node = canvasDocument.nodes.find((candidate) => candidate.id === nodeId)
    return node?.data.kind === "group" ? node.id : null
  }
  return null
}

export function resolveCanvasGroupMenuCapabilities(input: {
  canGroupSelection: boolean
  hasSingleGroupSelection: boolean
  singleGroupFolded: boolean
  singleGroupFoldUnsupported: boolean
}) {
  const expandedGroup = input.hasSingleGroupSelection && !input.singleGroupFolded
  const foldedGroup = input.hasSingleGroupSelection && input.singleGroupFolded
  return {
    canArrangeChildren: expandedGroup,
    canFold: input.canGroupSelection || (expandedGroup && !input.singleGroupFoldUnsupported),
    canGroup: input.canGroupSelection,
    canUngroup: expandedGroup,
    canUnfold: foldedGroup && !input.singleGroupFoldUnsupported,
  }
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
  /** Host-owned application locale for Canvas-owned UI copy. Independent consumers default to English. */
  locale?: CanvasUiLocale
  clipboardScope?: string
  /** Immutable, read-only, no-persistence preview used only when `session` is absent. */
  initialDocument?: CanvasDocument
  /** Required for editing. Host-owned Yjs projection, typed-intent, undo, and flush boundary. */
  session?: CanvasRendererCollaborationClient
  /** Host-owned application-command bridge used by non-geometry Canvas UI mutations. */
  executeCommand?: (command: CanvasApplicationCommand) => Promise<CanvasApplicationCommandResult>
  fileRendererRegistry?: CanvasFileRendererRegistry
  nodeRegistry?: CanvasNodeRegistry
  onlyRenderVisibleElements?: boolean
  onDocumentChange?: (document: CanvasDocument) => void
  /** @deprecated Prefer CanvasEditorHandle.openGenerate so Canvas owns the composer state. */
  onGenerateRequest?: () => void
  /** Publishes the Canvas-owned generation operation state without transferring ownership. */
  onGenerationStateChange?: (running: boolean) => void
  /** Publishes a bounded, scope-tagged projection for the host's active Canvas Input. */
  onSelectionProjectionChange?: (projection: CanvasSelectionProjection) => void
  /** @deprecated Inspector presentation was removed; this callback is no longer invoked. */
  onInspectorRequest?: (projection: CanvasInspectorProjection) => void
  readOnly?: boolean
  /** Explicit host policy wins; independent consumers fall back to the OS preference. */
  reducedMotion?: boolean
  selectionActions?: readonly CanvasSelectionAction[]
  selectionDragSource?: CanvasSelectionDragSource
  services: CanvasServices
  title?: string
  /** Host-owned geometry that is unavailable for Canvas overlays and focus. */
  viewportInsets?: CanvasViewportInsets
  viewId?: string
  viewRegistry?: CanvasViewRegistry
  viewScopeId?: string
}

type CanvasEditorTransientAction =
  | { readonly type: "begin-gesture"; readonly nodeIds?: readonly string[] }
  | { readonly type: "cancel-gesture" | "end-gesture" | "redo" | "undo" }

export interface CanvasEditorHandle {
  /** Reports whether Canvas can currently accept one host-routed shortcut command. */
  canRunShortcut: (command: CanvasShortcutCommand) => boolean
  /** Persists pending commands and returns Main's authoritative document projection. */
  flush: () => Promise<CanvasDocument>
  /** Inserts one registered node type through the ordinary editor flow and returns its id when accepted. */
  insertNode: (type: string) => string | undefined
  /** Marks and refreshes exact nodes, or every mounted resource when omitted. */
  invalidateResources: (nodeIds?: readonly string[]) => Promise<void>
  /** Resolves one exact host-neutral hierarchy key; unavailable indexes fall back to one bulk refresh. */
  invalidateResourcesAtHierarchyKey: (key: CanvasRendererResourceHierarchyKey) => Promise<void>
  /** Opens Canvas's existing generation surface without exposing its internal query state. */
  openGenerate: () => void
  /** Opens Canvas's existing search surface without exposing its internal query state. */
  openSearch: () => void
  prepareToLeave: (options?: { waitForPendingDrafts?: boolean }) => Promise<boolean>
  reload: () => Promise<void>
  /** Reloads Main's authoritative projection and resolves after the renderer controller publishes it. */
  reloadAuthoritative: () => Promise<void>
  /** Executes one host-routed shortcut command through Canvas's existing editor operations. */
  runShortcut: (command: CanvasShortcutCommand) => boolean
  resumeAfterLeaveCanceled: () => void
  /** Selects existing nodes after a host-owned mutation has been reloaded. */
  selectNodes: (nodeIds: readonly string[]) => void
  /** Applies a host-routed transient native-drag shortcut state. Persistent mode is unaffected by release. */
  setExternalDragShortcutHeld: (held: boolean) => boolean
  /** Applies the host-routed Space panning hold without installing a Canvas-owned global listener. */
  setSpacePanningShortcutHeld: (held: boolean) => boolean
  /** @deprecated Prefer CanvasEditorHandle.openGenerate and the Canvas-owned composer. */
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
  return replaceCanvasNodeResourceStates(document, new Map([[nodeId, resourceState]]))
}

function replaceCanvasNodeResourceStates(
  document: CanvasDocument,
  resourceStates: ReadonlyMap<string, CanvasResourceRuntimeState>,
): CanvasDocument {
  if (resourceStates.size === 0) return document
  let changed = false
  const nodes = document.nodes.map((node) => {
    const resourceState = resourceStates.get(node.id)
    if (resourceState === undefined || !("resourceState" in node.data) || node.data.resourceState === resourceState) {
      return node
    }
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

interface CanvasResourceRefreshCurrentSnapshot {
  document: CanvasDocument
  scope: CanvasResourceMutationScopeToken
}

interface CanvasResourceRefreshRequestSnapshot extends CanvasResourceRefreshCurrentSnapshot {
  /** Mounted projection retained unchanged until hydration completes. */
  presentedDocument: CanvasDocument
  targetNodeIds: ReadonlySet<string>
}

interface CanvasResourceRefreshControllerOptions {
  current(): CanvasResourceRefreshCurrentSnapshot
  exact?: CanvasResourceExactRefreshAdapter
  onError?(error: unknown): void
  queue?: CanvasReloadQueue
  replace(document: CanvasDocument): void
  service: CanvasResourceHydrationService
}

interface CanvasResourceExactRefreshCapture {
  readonly entity: CanvasEntityRef & { readonly kind: "node" }
  readonly node: CanvasNode
  readonly nodeId: string
  readonly ownerToken: unknown
  readonly rendererId: string
  readonly resourceIdentity: string
}

interface CanvasResourceExactRefreshReplacement {
  readonly capture: CanvasResourceExactRefreshCapture
  readonly state: CanvasResourceRuntimeState
}

interface CanvasResourceExactRefreshAdapter {
  capture(target: CanvasRendererResourceHierarchyTarget): CanvasResourceExactRefreshCapture | null
  header(): Pick<CanvasDocument, "id" | "metadata">
  replace(replacements: readonly CanvasResourceExactRefreshReplacement[]): boolean
}

export class CanvasResourceRefreshController {
  readonly #controllers = new Set<AbortController>()
  readonly #exactQueue = new CanvasReloadQueue()
  readonly #pendingExactTargets = new Map<string, CanvasRendererResourceHierarchyTarget>()
  readonly #pendingNodeIds = new Set<string>()
  readonly #queue: CanvasReloadQueue
  #disposed = false
  #invalidationGeneration = 0
  #exactInvalidationGeneration = 0

  constructor(private readonly options: CanvasResourceRefreshControllerOptions) {
    this.#queue = options.queue ?? new CanvasReloadQueue()
  }

  invalidateResources(nodeIds?: readonly string[]): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    const exactNodeIds = normalizeCanvasResourceRefreshNodeIds(nodeIds)
    if (exactNodeIds?.length === 0) return Promise.resolve()
    const current = this.options.current()
    for (const nodeId of exactNodeIds ?? current.document.nodes.map((node) => node.id)) {
      this.#pendingNodeIds.add(nodeId)
    }
    if (this.#pendingNodeIds.size === 0) return Promise.resolve()
    this.#invalidationGeneration += 1
    return this.#requestRefresh()
  }

  /** Exact indexed path: no canonical Canvas array is read or materialized. */
  invalidateExactResources(targets: readonly CanvasRendererResourceHierarchyTarget[]): Promise<void> {
    if (this.#disposed || !this.options.exact || targets.length === 0) return Promise.resolve()
    for (const target of targets) {
      if (
        !target ||
        target.entity.kind !== "node" ||
        target.nodeId !== target.entity.id ||
        typeof target.entity.incarnation !== "string"
      ) continue
      this.#pendingExactTargets.set(target.nodeId, target)
    }
    if (this.#pendingExactTargets.size === 0) return Promise.resolve()
    this.#exactInvalidationGeneration += 1
    const pending = this.#exactQueue.request(() => this.#refreshExact())
    void pending.catch((error) => this.options.onError?.(error))
    return pending
  }

  /** Refreshes already-stale runtime state without widening invalidation. */
  refreshStaleResources(nodeIds?: readonly string[]): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    const exactNodeIds = normalizeCanvasResourceRefreshNodeIds(nodeIds)
    if (exactNodeIds?.length === 0) return Promise.resolve()
    const current = this.options.current()
    for (const nodeId of exactNodeIds ?? staleCanvasResourceNodeIds(current.document)) {
      this.#pendingNodeIds.add(nodeId)
    }
    if (this.#pendingNodeIds.size === 0) return Promise.resolve()
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
    const presented = this.options.current()
    const pendingNodeIds = new Set(this.#pendingNodeIds)
    const requestDocument = this.options.service.markStale(presented.document, [...pendingNodeIds])
    const targetNodeIds = new Set<string>()
    for (const node of requestDocument.nodes) {
      if (pendingNodeIds.has(node.id) && isStaleCanvasResourceState(canvasNodeResourceState(node))) {
        targetNodeIds.add(node.id)
      }
    }
    if (targetNodeIds.size === 0) {
      if (invalidationGeneration === this.#invalidationGeneration) this.#pendingNodeIds.clear()
      return
    }
    const requested: CanvasResourceRefreshRequestSnapshot = {
      document: requestDocument,
      presentedDocument: presented.document,
      scope: presented.scope,
      targetNodeIds,
    }
    const controller = new AbortController()
    this.#controllers.add(controller)
    let hydrated: CanvasDocument
    try {
      hydrated = await this.options.service.hydrateStale({
        document: requested.document,
        nodeIds: [...requested.targetNodeIds],
        signal: controller.signal,
      })
    } catch (error) {
      if (
        !this.#disposed &&
        !controller.signal.aborted &&
        !isCanvasResourceRefreshTargetCurrent(requested, this.options.current())
      ) {
        if (this.#pendingNodeIds.size > 0) void this.#requestRefresh()
        return
      }
      throw error
    } finally {
      this.#controllers.delete(controller)
    }
    if (this.#disposed || controller.signal.aborted) return
    if (invalidationGeneration !== this.#invalidationGeneration) {
      if (this.#pendingNodeIds.size > 0) void this.#requestRefresh()
      return
    }

    const current = this.options.current()
    const merged = mergeCanvasResourceRefresh(requested, current, hydrated)
    if (!merged) {
      if (this.#pendingNodeIds.size > 0) void this.#requestRefresh()
      return
    }
    for (const nodeId of requested.targetNodeIds) this.#pendingNodeIds.delete(nodeId)
    this.options.replace(merged)
    if (this.#pendingNodeIds.size > 0) void this.#requestRefresh()
  }

  async #refreshExact() {
    if (this.#disposed || !this.options.exact || this.#pendingExactTargets.size === 0) return
    const invalidationGeneration = this.#exactInvalidationGeneration
    const exact = this.options.exact
    const captures: CanvasResourceExactRefreshCapture[] = []
    for (const target of this.#pendingExactTargets.values()) {
      const capture = exact.capture(target)
      if (capture) captures.push(capture)
      else this.#pendingExactTargets.delete(target.nodeId)
    }
    if (captures.length === 0) return

    const header = exact.header()
    const presentedDocument: CanvasDocument = {
      id: header.id,
      metadata: header.metadata,
      edges: [],
      nodes: captures.map((capture) => capture.node),
    }
    const nodeIds = captures.map((capture) => capture.nodeId)
    const requestDocument = this.options.service.markStale(presentedDocument, nodeIds)
    const requestedNodes = new Map(requestDocument.nodes.map((node) => [node.id, node]))
    const requestedCaptures = captures.filter((capture) => {
      const requested = requestedNodes.get(capture.nodeId)
      return Boolean(
        requested &&
          isStaleCanvasResourceState(canvasNodeResourceState(requested)) &&
          sameCanvasRuntimeValue(requested.data.metadata, capture.node.data.metadata),
      )
    })
    if (requestedCaptures.length === 0) {
      for (const capture of captures) this.#pendingExactTargets.delete(capture.nodeId)
      return
    }
    const requestedNodeIds = requestedCaptures.map((capture) => capture.nodeId)
    const controller = new AbortController()
    this.#controllers.add(controller)
    let hydrated: CanvasDocument
    try {
      hydrated = await this.options.service.hydrateStale({
        document: {
          ...requestDocument,
          nodes: requestedCaptures.map((capture) => requestedNodes.get(capture.nodeId)!),
        },
        nodeIds: requestedNodeIds,
        signal: controller.signal,
      })
    } finally {
      this.#controllers.delete(controller)
    }
    if (this.#disposed || controller.signal.aborted) return
    if (invalidationGeneration !== this.#exactInvalidationGeneration) {
      if (this.#pendingExactTargets.size > 0) void this.#requestExactRefresh()
      return
    }
    if (hydrated.id !== header.id) return
    const hydratedNodes = new Map(hydrated.nodes.map((node) => [node.id, node]))
    const replacements: CanvasResourceExactRefreshReplacement[] = []
    for (const capture of requestedCaptures) {
      const hydratedNode = hydratedNodes.get(capture.nodeId)
      const state = hydratedNode ? parseCanvasResourceRuntimeState(canvasNodeResourceState(hydratedNode)) : null
      if (
        !hydratedNode ||
        !state ||
        !sameCanvasRuntimeValue(hydratedNode.data.metadata, capture.node.data.metadata) ||
        canvasCanonicalResourceIdentity(hydratedNode) !== capture.resourceIdentity
      ) return
      replacements.push({ capture, state })
    }
    if (!exact.replace(replacements)) {
      if (this.#pendingExactTargets.size > 0) void this.#requestExactRefresh()
      return
    }
    for (const capture of requestedCaptures) {
      const pending = this.#pendingExactTargets.get(capture.nodeId)
      if (pending && sameCanvasEntity(pending.entity, capture.entity)) {
        this.#pendingExactTargets.delete(capture.nodeId)
      }
    }
    if (this.#pendingExactTargets.size > 0) void this.#requestExactRefresh()
  }

  #requestExactRefresh() {
    const pending = this.#exactQueue.request(() => this.#refreshExact())
    void pending.catch((error) => this.options.onError?.(error))
    return pending
  }
}

function mergeCanvasResourceRefresh(
  requested: CanvasResourceRefreshRequestSnapshot,
  current: CanvasResourceRefreshCurrentSnapshot,
  hydrated: CanvasDocument,
): CanvasDocument | null {
  if (!isCanvasResourceRefreshTargetCurrent(requested, current) || hydrated.id !== requested.document.id) {
    return null
  }

  const currentNodes = new Map(current.document.nodes.map((node) => [node.id, node]))
  const presentedNodes = new Map(requested.presentedDocument.nodes.map((node) => [node.id, node]))
  const requestedNodes = new Map(requested.document.nodes.map((node) => [node.id, node]))
  const hydratedNodes = new Map(hydrated.nodes.map((node) => [node.id, node]))
  const hydratedStates = new Map<string, CanvasResourceRuntimeState>()
  for (const nodeId of requested.targetNodeIds) {
    const currentNode = currentNodes.get(nodeId)
    const presentedNode = presentedNodes.get(nodeId)
    const requestedNode = requestedNodes.get(nodeId)
    const hydratedNode = hydratedNodes.get(nodeId)
    if (!currentNode || !presentedNode || !requestedNode || !hydratedNode) return null
    const presentedState = canvasNodeResourceState(presentedNode)
    const requestedState = canvasNodeResourceState(requestedNode)
    const currentState = canvasNodeResourceState(currentNode)
    const hydratedState = canvasNodeResourceState(hydratedNode)
    if (
      !isStaleCanvasResourceState(requestedState) ||
      !sameCanvasRuntimeValue(presentedNode.data.metadata, requestedNode.data.metadata) ||
      !sameCanvasRuntimeValue(presentedNode.data.metadata, currentNode.data.metadata) ||
      !sameCanvasRuntimeValue(requestedNode.data.metadata, hydratedNode.data.metadata) ||
      !sameCanvasRuntimeValue(presentedState, currentState) ||
      hydratedState === undefined
    ) {
      return null
    }
    hydratedStates.set(nodeId, hydratedState as CanvasResourceRuntimeState)
  }
  return replaceCanvasNodeResourceStates(current.document, hydratedStates)
}

function isCanvasResourceRefreshTargetCurrent(
  requested: CanvasResourceRefreshRequestSnapshot,
  current: CanvasResourceRefreshCurrentSnapshot,
) {
  if (
    !isCanvasResourceMutationScopeCurrent(() => current.scope, requested.scope) ||
    current.document.id !== requested.document.id
  )
    return false
  const presentedNodes = new Map(requested.presentedDocument.nodes.map((node) => [node.id, node]))
  const currentNodes = new Map(current.document.nodes.map((node) => [node.id, node]))
  return [...requested.targetNodeIds].every((nodeId) => {
    const presentedNode = presentedNodes.get(nodeId)
    const currentNode = currentNodes.get(nodeId)
    return Boolean(
      presentedNode &&
        currentNode &&
        sameCanvasRuntimeValue(presentedNode.data.metadata, currentNode.data.metadata) &&
        sameCanvasRuntimeValue(canvasNodeResourceState(presentedNode), canvasNodeResourceState(currentNode)),
    )
  })
}

function canvasNodeResourceState(node: CanvasNode): unknown {
  return node.data.resourceState
}

function isStaleCanvasResourceState(value: unknown) {
  return value !== null && typeof value === "object" && "status" in value && value.status === "stale"
}

function staleCanvasResourceNodeIds(document: CanvasDocument) {
  return document.nodes
    .filter((node) => isStaleCanvasResourceState(canvasNodeResourceState(node)))
    .map((node) => node.id)
}

function canvasResourceHydrationTargets(document: CanvasDocument) {
  const nodeIds: string[] = []
  const signatures: string[] = []
  for (const node of document.nodes) {
    if (!isStaleCanvasResourceState(canvasNodeResourceState(node))) continue
    nodeIds.push(node.id)
    const canonicalIdentity = canvasCanonicalResourceIdentity(node)
    if (canonicalIdentity !== undefined) {
      signatures.push(`${node.id}\u0000${canonicalIdentity}`)
      continue
    }
    try {
      signatures.push(`${node.id}\u0000${JSON.stringify(node.data.metadata)}`)
    } catch {
      signatures.push(node.id)
    }
  }
  return {
    nodeIds,
    signature: signatures.join("\u0001"),
  }
}

function normalizeCanvasResourceRefreshNodeIds(nodeIds: readonly string[] | undefined): readonly string[] | undefined {
  if (nodeIds === undefined) return undefined
  const unique = new Set<string>()
  for (const nodeId of nodeIds) {
    if (typeof nodeId !== "string" || !nodeId.trim()) throw new TypeError("Canvas resource node id is invalid")
    unique.add(nodeId)
  }
  return [...unique]
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
  afterReload?: (createdNodeIds: readonly string[]) => Promise<void> | void
  cancelPreparedNodes?: (createdNodeIds: readonly string[]) => void
  currentScope: () => CanvasResourceMutationScopeToken
  operationScope: CanvasResourceMutationScopeToken
  /**
   * @deprecated Use prepareCreatedNodes when presentation must exist for the authoritative first paint.
   * Ignored when prepareCreatedNodes is provided.
   */
  presentCreatedNodes?: (createdNodeIds: readonly string[]) => void
  prepareCreatedNodes?: (createdNodeIds: readonly string[]) => void
  reload: (signal: AbortSignal) => Promise<void>
  result: {
    authoritativeProjectionDelivered?: boolean
    createdNodeIds: readonly string[]
    warnings: readonly string[]
  }
  runViewEffect?: (createdNodeIds: readonly string[]) => Promise<void>
  selectNodes: (nodeIds: readonly string[]) => void
  show: (notification: CanvasNotification) => void
  signal: AbortSignal
}) {
  const isActive = () =>
    !input.signal.aborted && isCanvasResourceMutationScopeCurrent(input.currentScope, input.operationScope)
  if (!isActive()) return
  const createdNodeIds = [...new Set(input.result.createdNodeIds)]
  const warnings = [...input.result.warnings]
  let prepared = false
  try {
    input.prepareCreatedNodes?.(createdNodeIds)
    prepared = Boolean(input.prepareCreatedNodes)
  } catch {
    // Transient presentation never changes the committed resource outcome.
  }
  const cancelPreparedNodes = () => {
    if (!prepared) return
    prepared = false
    try {
      input.cancelPreparedNodes?.(createdNodeIds)
    } catch {
      // Transient presentation cleanup never changes the committed resource outcome.
    }
  }
  if (!input.result.authoritativeProjectionDelivered) {
    const reload = input.reload
    if (!isActive()) {
      cancelPreparedNodes()
      return
    }
    try {
      await reload(input.signal)
    } catch {
      cancelPreparedNodes()
      if (isActive()) {
        input.show({
          description: "Reload the Canvas to show the committed resources.",
          kind: "warning",
          title: "Resources added, but refresh failed",
        })
      }
      return
    }
  }
  if (!isActive()) {
    cancelPreparedNodes()
    return
  }
  try {
    await input.afterReload?.(createdNodeIds)
  } catch {
    // Resource admission already succeeded. A follow-up Canvas organization
    // command may be retried independently without hiding the new resource.
    warnings.push("Items were added, but follow-up organization failed.")
  }
  if (!isActive()) {
    cancelPreparedNodes()
    return
  }
  try {
    if (!input.prepareCreatedNodes) input.presentCreatedNodes?.(createdNodeIds)
  } catch {
    // Compatibility presentation never changes the committed resource outcome.
  }
  if (!isActive()) {
    cancelPreparedNodes()
    return
  }
  input.selectNodes(createdNodeIds)
  if (!isActive()) {
    cancelPreparedNodes()
    return
  }
  try {
    await input.runViewEffect?.(createdNodeIds)
  } catch {
    // A post-commit camera effect is optional and cannot reverse resource admission.
  }
  if (!isActive()) {
    cancelPreparedNodes()
    return
  }
  if (warnings.length) {
    input.show({
      description: warnings.join("\n"),
      kind: "warning",
      title: "Resources added with warnings",
    })
  }
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

export function isCanvasAuthoritativeResourceReadyForOptimisticHandoff(input: {
  document: CanvasDocument
  focusVisible: boolean
  nodeIds: readonly string[]
  resolveNode?: (nodeId: string) => CanvasNode | undefined
  root: ParentNode | null
}) {
  if (!input.root || input.nodeIds.length === 0) return false
  const containers = input.root.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")
  return input.nodeIds.every((nodeId) => {
    const container = [...containers].find((candidate) => candidate.dataset.id === nodeId)
    if (!container) return false
    const node = input.resolveNode?.(nodeId) ?? input.document.nodes.find((candidate) => candidate.id === nodeId)
    const nodeSurface = container.querySelector<HTMLElement>("[data-canvas-node-kind]")
    // A focused ghost must not hand off merely because the owner-derived
    // component mounted. React Flow and Canvas selection can commit on a later
    // render; removing the ghost before that render creates one unselected paint.
    if (
      input.focusVisible &&
      !container.classList.contains("selected") &&
      !nodeSurface?.classList.contains("is-selected")
    ) {
      return false
    }
    const mediaState = container.querySelector<HTMLElement>("[data-canvas-media-state]")
    if ((node?.data.kind === "image" || node?.data.kind === "video") && mediaState) return false
    if (node?.data.kind === "image") {
      const image = container.querySelector<HTMLImageElement>("img")
      if (image && (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1)) return false
    }
    if (node?.data.kind === "video") {
      const video = container.querySelector<HTMLVideoElement>("video")
      if (video && video.readyState < 1) return false
    }
    if (node?.data.kind !== "text") return Boolean(nodeSurface)
    const textSurface = container.querySelector(".convax-text-editor")
    return textSurface ? Boolean(container.querySelector(".convax-text-editor__prosemirror")) : Boolean(nodeSurface)
  })
}

export function canvasAuthorityMatchesOptimisticResourceBounds(
  ghosts: readonly CanvasGhostNode[],
  nodeIds: readonly string[],
  document: CanvasDocument,
  resolveNode?: (nodeId: string) => CanvasNode | undefined,
) {
  if (ghosts.length !== nodeIds.length || ghosts.length === 0) return false
  const unmatchedAuthorityBounds = nodeIds.map((nodeId) => {
    const node = resolveNode?.(nodeId) ?? document.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return null
    return {
      position: node.parentId ? getNodeWorldPosition(document, node.id) : node.position,
      size: getCanvasNodePresentationSize(node),
    }
  })
  if (unmatchedAuthorityBounds.some((bounds) => bounds === null)) return false
  return ghosts.every((ghost) => {
    const matchIndex = unmatchedAuthorityBounds.findIndex(
      (bounds) =>
        bounds !== null &&
        Math.abs(bounds.position.x - ghost.position.x) <= 1 &&
        Math.abs(bounds.position.y - ghost.position.y) <= 1 &&
        Math.abs(bounds.size.width - ghost.size.width) <= 1 &&
        Math.abs(bounds.size.height - ghost.size.height) <= 1,
    )
    if (matchIndex < 0) return false
    unmatchedAuthorityBounds.splice(matchIndex, 1)
    return true
  })
}

export function handleCanvasResourceRelinkSelection(
  nodeId: string | null,
  files: readonly File[],
  relink: (nodeId: string, file: File) => void,
  expectedKind: string | null,
): "empty" | "incompatible" | "selected" {
  const file = files[0]
  if (!nodeId || !file) return "empty"
  if (!isCanvasFileCompatibleWithKind(file, expectedKind)) return "incompatible"
  relink(nodeId, file)
  return "selected"
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

interface CanvasFolderFocusState {
  directoryId?: string
  error: string | null
  listing: CanvasFolderBrowseListing | null
  loading: boolean
  ownerNodeId: string
  path: readonly CanvasFolderBrowsePathEntry[]
  returnGroupId: string | null
}

const emptyCanvasOptimisticOverlaySnapshot: CanvasOptimisticOverlaySnapshot = Object.freeze({
  ghostEntityCount: 0,
  operations: Object.freeze([]),
  pendingOperationCount: 0,
  savingWithoutPrediction: 0,
})
const emptyCanvasOptimisticOverlayStore = Object.freeze({
  getSnapshot: () => emptyCanvasOptimisticOverlaySnapshot,
  subscribe: () => () => undefined,
})

/**
 * O(k) presentation-only layer for immediate resource feedback. It lives in
 * React Flow's public viewport portal but never enters the authoritative
 * `nodes`/`edges` arrays or its document reconciliation path.
 */
function CanvasOptimisticViewportLayer(props: Readonly<{
  edges: readonly CanvasGhostEdge[]
  focusedGroupId: string | null
  nodes: readonly CanvasGhostNode[]
  resolveNode: (nodeId: string) => CanvasNode | undefined
}>) {
  const nodes = props.nodes.filter(
    (ghost) => (ghost.parentPresentationKey ?? null) === props.focusedGroupId,
  )
  const ghostBounds = new Map(nodes.map((ghost) => [ghost.presentationKey, {
    position: ghost.snapshot?.position ?? ghost.position,
    size: ghost.snapshot?.size ?? ghost.size,
  }] as const))
  const endpoint = (value: CanvasGhostEdge["source"]) => {
    const ghost = ghostBounds.get(value.key)
    const node = ghost ? undefined : props.resolveNode(value.key)
    const position = ghost?.position ?? node?.position
    const size = ghost?.size ?? (node ? getCanvasNodeSize(node) : undefined)
    if (!position || !size) return null
    return {
      x: value.side === "output" ? position.x + size.width : value.side === "input" ? position.x : position.x + size.width / 2,
      y: position.y + size.height / 2,
    }
  }
  const edges = props.edges.map((ghost) => {
    const source = endpoint(ghost.source)
    const target = endpoint(ghost.target)
    if (!source || !target) return { ghost, path: null }
    const control = Math.max(48, Math.abs(target.x - source.x) / 2)
    return {
      ghost,
      path: {
        d: `M ${source.x} ${source.y} C ${source.x + control} ${source.y}, ${target.x - control} ${target.y}, ${target.x} ${target.y}`,
        labelX: (source.x + target.x) / 2,
        labelY: (source.y + target.y) / 2,
      },
    }
  })
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible">
      <svg className="absolute left-0 top-0 overflow-visible" height="1" width="1">
        {edges.flatMap(({ ghost, path }) => path ? [
          <g
            key={ghost.presentationKey}
            data-canvas-optimistic-ghost="edge"
            data-canvas-optimistic-key={ghost.presentationKey}
          >
            <path
              className="text-muted-foreground"
              d={path.d}
              fill="none"
              opacity="0.64"
              stroke="currentColor"
              strokeDasharray="6 5"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {ghost.label ? (
              <text
                className="fill-muted-foreground text-xs"
                textAnchor="middle"
                x={path.labelX}
                y={path.labelY - 6}
              >
                {ghost.label}
              </text>
            ) : null}
          </g>,
        ] : [])}
      </svg>
      {edges.flatMap(({ ghost, path }) => path ? [] : [
        <span
          key={ghost.presentationKey}
          data-canvas-optimistic-ghost="edge"
          data-canvas-optimistic-key={ghost.presentationKey}
          hidden
        />,
      ])}
      {nodes.map((ghost) => (
        <div
          key={ghost.presentationKey}
          className={cn(
            "absolute overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm",
            ghost.focusVisible && "ring-2 ring-ring/70",
          )}
          data-canvas-optimistic-ghost="node"
          data-canvas-optimistic-key={ghost.presentationKey}
          style={{
            height: ghost.size.height,
            opacity: 0.72,
            transform: `translate(${ghost.position.x}px, ${ghost.position.y}px)`,
            width: ghost.size.width,
          }}
        >
          {ghost.presentation.previewUrl ? (
            <img
              alt=""
              className="size-full object-cover"
              draggable={false}
              src={ghost.presentation.previewUrl}
            />
          ) : (
            <div className="flex size-full items-start px-3 py-2 text-sm text-muted-foreground">
              {ghost.presentation.title}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function createCanvasKeyedNodeDocument(
  document: CanvasDocument,
  nodeIds: readonly string[],
  resolveNode: ((nodeId: string) => CanvasNode | undefined) | undefined,
  edgeIds: readonly string[] = [],
  resolveEdge?: (edgeId: string) => CanvasEdge | undefined,
): CanvasDocument {
  if (!resolveNode) return document
  const nodes = new Map<string, CanvasNode>()
  for (const nodeId of nodeIds.slice(0, CANVAS_RENDERER_VIEWPORT_MAX_NODES)) {
    const path: CanvasNode[] = []
    const visited = new Set<string>()
    let node = resolveNode(nodeId)
    while (node && !visited.has(node.id) && nodes.size + path.length < CANVAS_RENDERER_VIEWPORT_MAX_NODES) {
      visited.add(node.id)
      path.push(node)
      node = node.parentId ? resolveNode(node.parentId) : undefined
    }
    for (let index = path.length - 1; index >= 0; index -= 1) nodes.set(path[index]!.id, path[index]!)
  }
  const edges = edgeIds.slice(0, CANVAS_RENDERER_VIEWPORT_MAX_NODES).flatMap((edgeId) => {
    const edge = resolveEdge?.(edgeId)
    return edge ? [edge] : []
  })
  return { ...document, edges, nodes: [...nodes.values()] }
}

function CanvasEditorContent(
  props: CanvasEditorProps & {
    editorRef: ForwardedRef<CanvasEditorHandle>
    fileRendererRegistry: CanvasFileRendererRegistry
    nodeRegistry: CanvasNodeRegistry
  },
) {
  const appearance = useMemo(() => resolveCanvasAppearance(props.appearance), [props.appearance])
  const locale = resolveCanvasUiLocale(props.locale)
  const [bootstrapProjection] = useState<CanvasRendererProjectionStore | undefined>(() =>
    props.initialDocument ? createReadonlyCanvasProjectionBootstrap(props.initialDocument) : undefined,
  )
  const collaborationSession = props.session
  const sessionVisualOverlay = collaborationSession?.visualOverlay ?? emptyCanvasOptimisticOverlayStore
  const projectionStore = collaborationSession ?? bootstrapProjection
  if (!projectionStore)
    throw new Error("CanvasEditor requires a host collaboration session or read-only initialDocument")
  if (props.session && props.initialDocument) {
    throw new Error("CanvasEditor initialDocument cannot coexist with a host collaboration session")
  }
  if (
    props.session &&
    (props.session.authority !== "project-collaboration-application" ||
      props.session.undoModel !== "project-yjs-semantic-history")
  ) {
    throw new Error("CanvasEditor requires a Main-owned Yjs collaboration projection client")
  }
  const [optimisticOverlay] = useState(() => new CanvasOptimisticOverlayCoordinator())
  const mergedOptimisticOverlay = useMemo(
    () => new CanvasMergedOptimisticOverlayStore([optimisticOverlay, sessionVisualOverlay]),
    [optimisticOverlay, sessionVisualOverlay],
  )
  const combinedPresentationStore = useMemo(
    () =>
      new CanvasCombinedPresentationStore({
        authoritative: {
          getSnapshot: projectionStore.getProjection.bind(projectionStore),
          subscribe: projectionStore.subscribe.bind(projectionStore),
        },
        overlay: mergedOptimisticOverlay,
      }),
    [mergedOptimisticOverlay, projectionStore],
  )
  useEffect(
    () => () => {
      combinedPresentationStore.dispose()
      mergedOptimisticOverlay.dispose()
    },
    [combinedPresentationStore, mergedOptimisticOverlay],
  )
  const subscribeCombinedPresentation = useCallback(
    (listener: () => void) => combinedPresentationStore.subscribe(listener),
    [combinedPresentationStore],
  )
  const readCombinedPresentation = useCallback(
    () => combinedPresentationStore.getSnapshot(),
    [combinedPresentationStore],
  )
  const combinedPresentation = useSyncExternalStore(
    subscribeCombinedPresentation,
    readCombinedPresentation,
    readCombinedPresentation,
  )
  const canonicalDocument = combinedPresentation.authoritative
  const boundedViewportEnabled = typeof projectionStore.queryViewport === "function"
  const [gestureStart, setGestureStart] = useState<CanvasDocument | undefined>()
  const gestureStartRef = useRef<CanvasDocument | undefined>(undefined)
  const gestureEntitiesRef = useRef(new Map<string, CanvasEntityRef>())
  const gestureGeometryRef = useRef(new Map<string, CanvasTransientGeometry>())
  const [gestureGeometry, setGestureGeometry] = useState(() => new Map<string, CanvasTransientGeometry>())
  const pendingGeometryRef = useRef(new Map<string, CanvasPendingNodeGeometry>())
  const [pendingGeometry, setPendingGeometry] = useState(() => new Map<string, CanvasPendingNodeGeometry>())
  const [reactFlowMeasurements, setReactFlowMeasurements] = useState(
    () => new Map<string, CanvasTransientMeasurement>(),
  )
  const [resourceStates, setResourceStates] = useState(
    () => CanvasPersistentRuntimeMap.empty<CanvasTransientResourceState>(),
  )
  const resourceStatesRef = useRef(resourceStates)
  resourceStatesRef.current = resourceStates
  const localResourcePreviewsRef = useRef(new Map<string, CanvasLocalResourcePreview>())
  const blockedLocalResourcePreviewHydrationsRef = useRef(new Set<symbol>())
  const pendingLocalResourcePreviewHydrationsRef = useRef(new Map<string, symbol>())
  const retiredLocalResourcePreviewUrlsRef = useRef(new Set<string>())
  const resourceRefreshControllerRef = useRef<CanvasResourceRefreshController | undefined>(undefined)
  const optimisticResourceScopeKey = `${props.viewScopeId ?? ""}:${canonicalDocument.id}`
  const optimisticOverlayItems = useMemo(
    () => combinedPresentation.overlay.operations.flatMap((operation) => operation.items),
    [combinedPresentation.overlay],
  )
  const optimisticResourceGhosts = useMemo(
    () => optimisticOverlayItems.filter((item) => item.kind === "ghost-node"),
    [optimisticOverlayItems],
  )
  const optimisticGhostEdges = useMemo(
    () => optimisticOverlayItems.filter((item) => item.kind === "ghost-edge"),
    [optimisticOverlayItems],
  )
  const optimisticHiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>()
    for (const item of optimisticOverlayItems) {
      if (item.kind !== "hide-entity" || item.entity.kind !== "node") continue
      const current = projectionStore.resolveNodeEntity(item.entity.entityId)
      if (current?.incarnation === item.entity.incarnation) hidden.add(item.entity.entityId)
    }
    return hidden
  }, [optimisticOverlayItems, projectionStore])
  const optimisticHiddenEdgeIds = useMemo(() => {
    const hidden = new Set<string>()
    for (const item of optimisticOverlayItems) {
      if (item.kind !== "hide-entity" || item.entity.kind !== "edge") continue
      const current = projectionStore.resolveEdgeEntity?.(item.entity.entityId)
      if (current?.incarnation === item.entity.incarnation) hidden.add(item.entity.entityId)
    }
    return hidden
  }, [optimisticOverlayItems, projectionStore])
  const optimisticNodeReplacements = useMemo(() => {
    const replacements = new Map<
      string,
      Extract<(typeof optimisticOverlayItems)[number], { kind: "replace-presentation" }>
    >()
    for (const item of optimisticOverlayItems) {
      if (item.kind !== "replace-presentation" || item.entity.kind !== "node") continue
      const current = projectionStore.resolveNodeEntity(item.entity.entityId)
      if (current?.incarnation === item.entity.incarnation) replacements.set(item.entity.entityId, item)
    }
    return replacements
  }, [optimisticOverlayItems, projectionStore])
  useEffect(
    () => () => optimisticOverlay.clearScope(optimisticResourceScopeKey),
    [optimisticOverlay, optimisticResourceScopeKey],
  )
  const renderedDocument = useMemo(() => {
    const resourceOverlays = new Map<string, CanvasTransientResourceState>()
    // The indexed production session applies runtime state only to its bounded
    // working set below. Resource completion must never map the full document.
    if (!boundedViewportEnabled && resourceStates.size > 0) {
      const canonicalNodes = new Map(canonicalDocument.nodes.map((node) => [node.id, node]))
      for (const [nodeId, transient] of resourceStates) {
        const currentNode = canonicalNodes.get(nodeId)
        if (!currentNode) continue
        const currentEntity = projectionStore.resolveNodeEntity(nodeId)
        if (!sameCanvasTransientResourceOwner(transient, currentNode, currentEntity)) continue
        resourceOverlays.set(nodeId, transient)
      }
    }
    if (gestureGeometry.size === 0 && pendingGeometry.size === 0 && resourceOverlays.size === 0) {
      return canonicalDocument
    }
    let changed = false
    const nodes = canonicalDocument.nodes.map((node) => {
      const gesture = gestureGeometry.get(node.id)
      const pending = pendingGeometry.get(node.id)
      const position = gesture?.position ?? pending?.position?.value
      const resourceOverlay = resourceOverlays.get(node.id)
      const size = gesture?.size ?? pending?.size?.value
      const resourceState = resourceOverlay?.state
      const positionChanged =
        position !== undefined && (position.x !== node.position.x || position.y !== node.position.y)
      const sizeChanged = size !== undefined && !sameCanvasSize(size, getCanvasNodeSize(node))
      const resourceStateChanged =
        resourceState !== undefined && "resourceState" in node.data && node.data.resourceState !== resourceState
      if (!positionChanged && !sizeChanged && !resourceStateChanged) return node
      changed = true
      return {
        ...node,
        ...(positionChanged ? { position } : {}),
        ...(sizeChanged ? { style: { ...node.style, height: size.height, width: size.width } } : {}),
        ...(resourceStateChanged ? { data: { ...node.data, resourceState } } : {}),
      }
    })
    return changed ? { ...canonicalDocument, nodes } : canonicalDocument
  }, [boundedViewportEnabled, canonicalDocument, gestureGeometry, pendingGeometry, projectionStore, resourceStates])
  const resourceHydrationDocument = useMemo(() => {
    if (boundedViewportEnabled) return canonicalDocument
    if (resourceStates.size === 0) return canonicalDocument
    const canonicalNodes = new Map(canonicalDocument.nodes.map((node) => [node.id, node]))
    const resourceStateOverlays = new Map<string, CanvasResourceRuntimeState>()
    for (const [nodeId, transient] of resourceStates) {
      // Local File previews are presentation only. Hydration must continue to
      // observe the authoritative stale state or it would mistake a blob URL
      // for a resolved Project resource and never perform the real handoff.
      if (transient.localPreviewToken) continue
      const currentNode = canonicalNodes.get(nodeId)
      if (!currentNode) continue
      const currentEntity = projectionStore.resolveNodeEntity(nodeId)
      if (!sameCanvasTransientResourceOwner(transient, currentNode, currentEntity)) continue
      resourceStateOverlays.set(nodeId, transient.state)
    }
    return replaceCanvasNodeResourceStates(canonicalDocument, resourceStateOverlays)
  }, [boundedViewportEnabled, canonicalDocument, projectionStore, resourceStates])
  const history = useMemo(
    () => ({
      document: renderedDocument,
      future: collaborationSession?.canRedo() ? [true] : [],
      gestureStart,
      past: collaborationSession?.canUndo() ? [true] : [],
    }),
    [collaborationSession, gestureStart, renderedDocument],
  )
  const [selection, setSelection] = useState<CanvasSelection>(() => ({ nodeIds: new Set(), edgeIds: new Set() }))
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const generatePresence = useCanvasOverlayPresence(generateOpen)
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
  const [loadError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [interactionTool, setInteractionTool] = useState<CanvasInteractionTool>("select")
  const [selectionDragModeActive, setSelectionDragModeActive] = useState(false)
  const [insertPoint, setInsertPoint] = useState<CanvasPoint | null>(null)
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null)
  const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null)
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null)
  const [folderFocus, setFolderFocus] = useState<CanvasFolderFocusState | null>(null)
  const [groupDropTargetId, setGroupDropTargetId] = useState<string | null>(null)
  const [pendingNodeFocus, setPendingNodeFocus] = useState<{
    guard: CanvasPostMutationRevealGuard
    nodeIds: readonly string[]
  } | null>(null)
  const [spacePanning, setSpacePanning] = useState(false)
  const spacePanningRef = useRef(false)
  const shortcutCanRunRef = useRef<(command: CanvasShortcutCommand) => boolean>(() => false)
  const shortcutRunRef = useRef<(command: CanvasShortcutCommand) => boolean>(() => false)
  const osPrefersReducedMotion = useCanvasReducedMotion()
  const prefersReducedMotion = resolveCanvasReducedMotion(props.reducedMotion, osPrefersReducedMotion)
  const nodeEntryScopeKey = `${props.viewScopeId ?? ""}:${history.document.id}`
  const nodeEntryTrackerRef = useRef<CanvasNodeEntryTracker | null>(null)
  nodeEntryTrackerRef.current ??= new CanvasNodeEntryTracker(
    nodeEntryScopeKey,
    history.document.nodes.map((node) => node.id),
  )
  if (nodeEntryTrackerRef.current.scopeKey !== nodeEntryScopeKey) {
    nodeEntryTrackerRef.current.reset(
      nodeEntryScopeKey,
      history.document.nodes.map((node) => node.id),
    )
  }
  const nodeEntryPresentation = useMemo(
    () => new CanvasNodeEntryPresentationStore(nodeEntryScopeKey),
    [nodeEntryScopeKey],
  )
  const activeNodeEntryIds = nodeEntryPresentation.activeNodeIds
  const enteringNodeIds = nodeEntryPresentation.enteringNodeIds
  const rootRef = useRef<HTMLDivElement>(null)
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null)
  const setCanvasRoot = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element
    setOverlayRoot(element)
  }, [])
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const imageUploadInputRef = useRef<HTMLInputElement>(null)
  const videoUploadInputRef = useRef<HTMLInputElement>(null)
  const searchPanelRef = useRef<HTMLDivElement>(null)
  const relinkInputRef = useRef<HTMLInputElement>(null)
  const relinkNodeIdRef = useRef<string | null>(null)
  const relinkKindRef = useRef<string | null>(null)
  const pointerRef = useRef<CanvasPoint | null>(null)
  const boxSelectionActiveRef = useRef(false)
  const boxSelectionBaselineRef = useRef<CanvasSelection | null>(null)
  const selectionRef = useRef(selection)
  const selectedNodeEntitiesRef = useRef(new Map<string, CanvasEntityRef>())
  const selectionDragAutoSelectedNodeRef = useRef<string | null>(null)
  const selectionDragCandidateNodeRef = useRef<string | null>(null)
  const selectionDragModeActiveRef = useRef(false)
  const connectionStartRef = useRef<ConnectionStart | null>(null)
  const connectionTargetNodeIdRef = useRef<string | null>(null)
  const focusedGroupIdRef = useRef(focusedGroupId)
  const folderFocusRef = useRef(folderFocus)
  const folderFocusRequestRef = useRef<AbortController | null>(null)
  const groupDropTargetIdRef = useRef<string | null>(null)
  const ignoreConnectionPaneClickRef = useRef(false)
  const altDragRef = useRef<{ sourceNodeIds: readonly string[]; edgeScope: "connected" | "internal" } | null>(null)
  const snapSessionRef = useRef<CanvasNodeSnapSession | null>(null)
  const snapEnabledRef = useRef(snapEnabled)
  const navigationRevisionRef = useRef(0)
  const cameraMotionGenerationRef = useRef(0)
  const groupFocusNavigationGenerationRef = useRef(0)
  const resourceMutationPresentationGenerationRef = useRef(0)
  const cameraMotionInterruptListenersRef = useRef(new Set<() => void>())
  const nodeEntryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const initialCameraScopeRef = useRef("")
  const viewportInsetsKeyRef = useRef(
    [
      props.viewportInsets?.top ?? 0,
      props.viewportInsets?.right ?? 0,
      props.viewportInsets?.bottom ?? 0,
      props.viewportInsets?.left ?? 0,
    ].join(":"),
  )
  const documentRef = useRef(history.document)
  const canonicalDocumentRef = useRef(canonicalDocument)
  // Exact certified append entries that have reached the mounted React Flow but
  // have not yet been folded into an explicit full presentation reconcile.
  const incrementalProjectionNodesRef = useRef(new Map<string, CanvasNode>())
  const incrementalProjectionEdgesRef = useRef(new Map<string, CanvasEdge>())
  const certifiedViewportPinsRef = useRef(new Set<string>())
  const [viewportProjectionRevision, invalidateViewportProjection] = useReducer(
    (revision: number) => revision + 1,
    0,
  )
  const resourceHydrationDocumentRef = useRef(resourceHydrationDocument)
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
  const saveErrorRef = useRef<string | null>(null)
  const leavingRef = useRef(false)
  const saveControllerRef = useRef<AbortController | undefined>(undefined)
  const reloadQueueRef = useRef(new CanvasReloadQueue())
  const reloadControllerRef = useRef<AbortController | undefined>(undefined)
  const operationControllersRef = useRef(new Set<AbortController>())
  const selectionActionControllerRef = useRef<AbortController | undefined>(undefined)
  const generationControllerRef = useRef<{ controller: AbortController; documentId: string } | null>(null)
  const submitGenerationRef = useRef<(submission: CanvasGenerationComposerSubmission) => void>(() => undefined)
  const pendingDraftsRef = useRef(createCanvasPendingDraftRegistry())
  const reactFlow = useReactFlow<CanvasNode>()
  const rendererViewport = useViewport()
  const reactFlowStore = useStoreApi<CanvasNode>()
  const reactFlowRef = useRef(reactFlow)
  const [rendererViewportSize, setRendererViewportSize] = useState({ height: 1080, width: 1920 })
  const pointerMultiSelectionGenerationRef = useRef(0)
  reactFlowRef.current = reactFlow
  useEffect(() => {
    if (!overlayRoot || typeof ResizeObserver === "undefined") return
    const update = () => {
      const bounds = overlayRoot.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      setRendererViewportSize((current) =>
        current.width === bounds.width && current.height === bounds.height
          ? current
          : { height: bounds.height, width: bounds.width },
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(overlayRoot)
    return () => observer.disconnect()
  }, [overlayRoot])
  useEffect(() => {
    if (!projectionStore.subscribeProjectionChanges) return
    return projectionStore.subscribeProjectionChanges((change) => {
      if (change.kind === "reset") {
        incrementalProjectionNodesRef.current.clear()
        incrementalProjectionEdgesRef.current.clear()
        certifiedViewportPinsRef.current.clear()
        invalidateViewportProjection()
        return
      }
      if (boundedViewportEnabled) {
        for (const node of change.changes.nodes) {
          const pins = certifiedViewportPinsRef.current
          if (!pins.has(node.id) && pins.size >= CANVAS_RENDERER_VIEWPORT_MAX_NODES) {
            const oldest = pins.values().next().value
            if (typeof oldest === "string") pins.delete(oldest)
          }
          pins.add(node.id)
        }
        if (change.preparedResources.length > 0) {
          setResourceStates((current) => {
            let next = current
            for (const prepared of change.preparedResources) {
              const node = projectionStore.resolveNode?.(prepared.nodeId)
              const entity = projectionStore.resolveNodeEntity(prepared.nodeId)
              if (
                !node ||
                !entity ||
                !sameCanvasEntity(prepared.entity, entity) ||
                prepared.resourceIdentity !== canvasCanonicalResourceIdentity(node)
              ) continue
              const transient: CanvasTransientResourceState = {
                entity: prepared.entity,
                rendererId: canvasFileRendererIdentity(node, props.fileRendererRegistry),
                resourceIdentity: prepared.resourceIdentity,
                state: prepared.state,
              }
              const previous = next.get(prepared.nodeId)
              if (
                previous &&
                sameCanvasTransientResourceOwner(previous, node, entity) &&
                previous.rendererId === transient.rendererId &&
                sameCanvasRuntimeValue(previous.state, transient.state)
              ) continue
              next = next.set(prepared.nodeId, transient)
            }
            return next
          })
        }
        invalidateViewportProjection()
        return
      }
      const addedNodes: CanvasNode[] = []
      const addedEdges: CanvasEdge[] = []
      for (const node of change.changes.nodes) {
        incrementalProjectionNodesRef.current.set(node.id, node)
        addedNodes.push(projectCanvasNodeInitialDimensions(node))
      }
      for (const edge of change.changes.edges) {
        incrementalProjectionEdgesRef.current.set(edge.id, edge)
        addedEdges.push({
          ...edge,
          animated: false,
          selected: false,
          sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
          targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
          type: !edge.type || edge.type === "smoothstep" ? "canvas" : edge.type,
        })
      }
      // @xyflow's public incremental calls are the presentation-reconciliation
      // boundary. Canvas supplies only k exact additions and never reads the
      // projection store's full getter in this callback.
      if (addedNodes.length > 0 && typeof reactFlow.addNodes === "function") reactFlow.addNodes(addedNodes)
      if (addedEdges.length > 0 && typeof reactFlow.addEdges === "function") reactFlow.addEdges(addedEdges)
    })
  }, [boundedViewportEnabled, projectionStore, props.fileRendererRegistry, reactFlow])
  const setPointerMultiSelection = useCallback(
    (active: boolean) => {
      pointerMultiSelectionGenerationRef.current += 1
      reactFlowStore.setState({ multiSelectionActive: active })
    },
    [reactFlowStore],
  )
  const clearPointerMultiSelection = useCallback(() => setPointerMultiSelection(false), [setPointerMultiSelection])
  const schedulePointerMultiSelectionClear = useCallback(() => {
    const generation = pointerMultiSelectionGenerationRef.current
    window.setTimeout(() => {
      if (pointerMultiSelectionGenerationRef.current !== generation) return
      clearPointerMultiSelection()
    }, 0)
  }, [clearPointerMultiSelection])
  useEffect(() => {
    window.addEventListener("blur", clearPointerMultiSelection)
    window.addEventListener("pointercancel", clearPointerMultiSelection)
    window.addEventListener("pointerup", schedulePointerMultiSelectionClear)
    return () => {
      window.removeEventListener("blur", clearPointerMultiSelection)
      window.removeEventListener("pointercancel", clearPointerMultiSelection)
      window.removeEventListener("pointerup", schedulePointerMultiSelectionClear)
      clearPointerMultiSelection()
    }
  }, [clearPointerMultiSelection, schedulePointerMultiSelectionClear])
  const mutationService = useCanvasService("mutation")
  const assistantService = useCanvasService("assistant")
  const folderBrowseService = useCanvasService("folderBrowse")
  const hydrationService = useCanvasService("hydration")
  const generateService = useCanvasService("generate")
  const exportService = useCanvasService("export")
  const notificationService = useCanvasService("notify")
  const telemetryService = useCanvasService("telemetry")
  const textDraftStore = useCanvasService("textDrafts")
  const requestGenerate = useCallback(() => {
    if (!generateService) return
    if (props.onGenerateRequest) {
      props.onGenerateRequest()
      return
    }
    setGenerateOpen(true)
  }, [generateService, props.onGenerateRequest])
  const closeGenerate = useCallback(() => {
    setGenerateOpen(false)
    rootRef.current?.focus({ preventScroll: true })
  }, [])
  const [hydrating] = useState(false)
  const [blockingLoad] = useState(false)
  const hydratingRef = useRef(false)
  const loadBarrierRef = useRef(createCanvasLoadBarrier(true))
  documentRef.current = history.document
  canonicalDocumentRef.current = canonicalDocument
  resourceHydrationDocumentRef.current = resourceHydrationDocument
  focusedGroupIdRef.current = focusedGroupId
  folderFocusRef.current = folderFocus
  historyRef.current = history
  saveErrorRef.current = saveError
  selectionRef.current = selection
  snapEnabledRef.current = snapEnabled
  const resolveCurrentNode = useCallback(
    (nodeId: string) => projectionStore.resolveNode?.(nodeId) ??
      documentRef.current.nodes.find((node) => node.id === nodeId),
    [projectionStore],
  )
  const readCurrentBulkDocument = useCallback(
    () => boundedViewportEnabled ? projectionStore.getProjection() : documentRef.current,
    [boundedViewportEnabled, projectionStore],
  )
  const readCurrentWorkingDocument = useCallback(
    (nodeIds?: readonly string[]) => boundedViewportEnabled
      ? createCanvasKeyedNodeDocument(
          documentRef.current,
          nodeIds ?? reactFlowRef.current.getNodes().map((node) => node.id),
          resolveCurrentNode,
        )
      : documentRef.current,
    [boundedViewportEnabled, resolveCurrentNode],
  )
  const updateConnectionTargetNode = useCallback((nodeId: string | null) => {
    if (connectionTargetNodeIdRef.current === nodeId) return
    connectionTargetNodeIdRef.current = nodeId
    setConnectionTargetNodeId(nodeId)
  }, [])
  const updateGroupDropTarget = useCallback((nodeId: string | null) => {
    if (groupDropTargetIdRef.current === nodeId) return
    groupDropTargetIdRef.current = nodeId
    setGroupDropTargetId(nodeId)
  }, [])
  useLayoutEffect(() => {
    for (const controller of operationControllersRef.current) controller.abort()
    operationControllersRef.current.clear()
    abortCanvasReload(reloadControllerRef.current)
    const emptySelection = { edgeIds: new Set<string>(), nodeIds: new Set<string>() }
    selectionRef.current = emptySelection
    selectedNodeEntitiesRef.current = new Map()
    setSelection(emptySelection)
    boxSelectionActiveRef.current = false
    boxSelectionBaselineRef.current = null
    connectionStartRef.current = null
    updateConnectionTargetNode(null)
    ignoreConnectionPaneClickRef.current = false
    altDragRef.current = null
    pointerRef.current = null
    snapSessionRef.current = null
    setSnapLines([])
    folderFocusRequestRef.current?.abort()
    folderFocusRequestRef.current = null
    setFolderFocus(null)
    setFocusedGroupId(null)
    updateGroupDropTarget(null)
    gestureStartRef.current = undefined
    gestureEntitiesRef.current = new Map()
    gestureGeometryRef.current = new Map()
    setGestureGeometry(new Map())
    pendingGeometryRef.current = new Map()
    setPendingGeometry(new Map())
    setGestureStart(undefined)
    setReactFlowMeasurements(new Map())
    setResourceStates(CanvasPersistentRuntimeMap.empty())
    optimisticOverlay.clear()
    setPendingConnection(null)
    setPendingNodeFocus(null)
    setInsertPoint(null)
    setNodeMenuOpen(false)
    setGenerateOpen(false)
    setSearchOpen(false)
    groupFocusNavigationGenerationRef.current += 1
    cameraMotionGenerationRef.current += 1
    for (const listener of cameraMotionInterruptListenersRef.current) listener()
    cameraMotionInterruptListenersRef.current.clear()
    try {
      void reactFlowRef.current.setViewport(reactFlowRef.current.getViewport(), { duration: 0 })
    } catch {
      // React Flow may not be mounted for the previous scope yet.
    }
  }, [currentViewScopeId, history.document.id, optimisticOverlay, updateConnectionTargetNode, updateGroupDropTarget])
  useEffect(() => {
    if (history.gestureStart) return
    snapSessionRef.current = null
    setSnapLines([])
  }, [history.gestureStart])
  const clearTransientGeometry = useCallback(() => {
    gestureStartRef.current = undefined
    gestureEntitiesRef.current = new Map()
    gestureGeometryRef.current = new Map()
    setGestureGeometry(new Map())
    setGestureStart(undefined)
  }, [])
  const clearPendingGeometry = useCallback((token: symbol) => {
    const next = new Map(pendingGeometryRef.current)
    let changed = false
    for (const [nodeId, pending] of next) {
      const position = pending.position?.token === token ? undefined : pending.position
      const size = pending.size?.token === token ? undefined : pending.size
      if (position === pending.position && size === pending.size) continue
      changed = true
      if (!position && !size) next.delete(nodeId)
      else next.set(nodeId, { ...pending, position, size })
    }
    if (!changed) return
    pendingGeometryRef.current = next
    setPendingGeometry(next)
  }, [])
  useLayoutEffect(() => {
    if (!gestureStartRef.current || gestureGeometryRef.current.size === 0) return
    for (const nodeId of gestureGeometryRef.current.keys()) {
      const captured = gestureEntitiesRef.current.get(nodeId)
      if (captured && sameCanvasEntity(captured, projectionStore.resolveNodeEntity(nodeId))) continue
      clearTransientGeometry()
      snapSessionRef.current = null
      setSnapLines([])
      break
    }
  }, [canonicalDocument, clearTransientGeometry, projectionStore])
  useLayoutEffect(() => {
    if (pendingGeometryRef.current.size === 0) return
    const next = new Map(pendingGeometryRef.current)
    let changed = false
    for (const [nodeId, pending] of next) {
      const node = resolveCurrentNode(nodeId)
      if (!node || !sameCanvasEntity(pending.entity, projectionStore.resolveNodeEntity(nodeId))) {
        next.delete(nodeId)
        changed = true
        continue
      }
      const position =
        pending.position && node.position.x === pending.position.value.x && node.position.y === pending.position.value.y
          ? undefined
          : pending.position
      const canonicalSize = pending.size ? getCanvasNodeSize(node) : undefined
      const size =
        pending.size && canonicalSize && sameCanvasSize(canonicalSize, pending.size.value) ? undefined : pending.size
      if (position === pending.position && size === pending.size) continue
      changed = true
      if (!position && !size) {
        next.delete(nodeId)
      } else {
        next.set(nodeId, { ...pending, position, size })
      }
    }
    if (!changed) return
    pendingGeometryRef.current = next
    setPendingGeometry(next)
  }, [projectionStore, resolveCurrentNode, viewportProjectionRevision])
  const dispatch = useCallback(
    (action: CanvasEditorTransientAction) => {
      if (leavingRef.current || hydratingRef.current) return
      if (action.type === "begin-gesture") {
        if (!gestureStartRef.current) {
          const start = boundedViewportEnabled
            ? createCanvasKeyedNodeDocument(
                canonicalDocument,
                action.nodeIds ?? [...selectionRef.current.nodeIds],
                resolveCurrentNode,
              )
            : canonicalDocument
          gestureStartRef.current = start
          gestureEntitiesRef.current = new Map(
            start.nodes.flatMap((node) => {
              const entity = projectionStore.resolveNodeEntity(node.id)
              return entity ? [[node.id, entity] as const] : []
            }),
          )
          gestureGeometryRef.current = new Map()
          setGestureGeometry(new Map())
          setGestureStart(start)
        }
        return
      }
      if (action.type === "cancel-gesture") {
        clearTransientGeometry()
        return
      }
      if (action.type === "end-gesture") {
        const start = gestureStartRef.current
        const geometry = gestureGeometryRef.current
        const entities = gestureEntitiesRef.current
        clearTransientGeometry()
        if (!start) return
        if (collaborationSession) {
          const token = Symbol("canvas-pending-geometry")
          const nextPending = new Map(pendingGeometryRef.current)
          for (const [nodeId, transient] of geometry) {
            const entity = entities.get(nodeId)
            if (!entity) continue
            const previous = nextPending.get(nodeId)
            const sameEntity = previous && sameCanvasEntity(previous.entity, entity) ? previous : undefined
            nextPending.set(nodeId, {
              entity,
              position: transient.position ? { token, value: { ...transient.position } } : sameEntity?.position,
              size: transient.size ? { token, value: { ...transient.size } } : sameEntity?.size,
            })
          }
          pendingGeometryRef.current = nextPending
          setPendingGeometry(nextPending)
          const onSubmissionError = (error: unknown) => {
            clearPendingGeometry(token)
            setSaveError(error instanceof Error ? error.message : "Canvas geometry submission failed")
          }
          try {
            void submitCanvasTransientGeometry(collaborationSession, start, geometry, entities)
              .then((submitted) => {
                if (!submitted) clearPendingGeometry(token)
              })
              .catch(onSubmissionError)
          } catch (error) {
            onSubmissionError(error)
          }
        }
        return
      }
      if (action.type === "undo") {
        if (collaborationSession) void collaborationSession.undo()
        return
      }
      if (action.type === "redo") {
        if (collaborationSession) void collaborationSession.redo()
      }
    },
    [
      boundedViewportEnabled,
      canonicalDocument,
      clearPendingGeometry,
      clearTransientGeometry,
      collaborationSession,
      projectionStore,
      resolveCurrentNode,
    ],
  )
  const rejectUnmappedCanvasMutation = useCallback(() => {
    notificationService?.show({
      kind: "warning",
      title: "Canvas operation unavailable",
      description: "This operation was rejected before changing collaboration state.",
    })
  }, [notificationService])
  const replaceRuntimeResourceStates = useCallback(
    (document: CanvasDocument) => {
      if (document.id !== canonicalDocument.id) return
      const canonicalNodes = new Map(canonicalDocument.nodes.map((node) => [node.id, node]))
      setResourceStates((current) => {
        let next = current
        for (const node of document.nodes) {
          const canonicalNode = canonicalNodes.get(node.id)
          const state = parseCanvasResourceRuntimeState(canvasNodeResourceState(node))
          if (!canonicalNode || !state) continue
          const entity = projectionStore.resolveNodeEntity(node.id)
          const rendererId = canvasFileRendererIdentity(canonicalNode, props.fileRendererRegistry)
          const previous = next.get(node.id)
          const localPreview = localResourcePreviewsRef.current.get(node.id)
          if (
            previous?.localPreviewToken &&
            localPreview?.token === previous.localPreviewToken &&
            localPreview.pending
          ) {
            blockedLocalResourcePreviewHydrationsRef.current.add(previous.localPreviewToken)
            continue
          }
          if (
            previous &&
            sameCanvasTransientResourceOwner(previous, canonicalNode, entity) &&
            previous.rendererId === rendererId &&
            sameCanvasRuntimeValue(previous.state, state)
          ) {
            continue
          }
          next = next.set(node.id, {
            entity,
            rendererId,
            resourceIdentity: canvasCanonicalResourceIdentity(canonicalNode),
            state,
          })
        }
        return next
      })
    },
    [canonicalDocument, projectionStore, props.fileRendererRegistry],
  )
  const replaceRuntimeResourceStatesRef = useRef(replaceRuntimeResourceStates)
  replaceRuntimeResourceStatesRef.current = replaceRuntimeResourceStates
  const installPreparedResourceStates = useCallback(
    (preparedResources: readonly CanvasAcceptedPreparedResourceRuntime[] | undefined, createdNodeIds: readonly string[]) => {
      if (!preparedResources?.length) return
      const created = new Set(createdNodeIds)
      setResourceStates((current) => {
        let next = current
        const installed = new Set<string>()
        for (const prepared of preparedResources) {
          if (
            !prepared ||
            typeof prepared.nodeId !== "string" ||
            installed.has(prepared.nodeId) ||
            !created.has(prepared.nodeId)
          ) {
            continue
          }
          installed.add(prepared.nodeId)
          const node = projectionStore.resolveNode?.(prepared.nodeId) ??
            canonicalDocumentRef.current.nodes.find((candidate) => candidate.id === prepared.nodeId)
          const state = parseCanvasResourceRuntimeState(prepared.state)
          const entity = projectionStore.resolveNodeEntity(prepared.nodeId)
          if (
            !node ||
            !state ||
            !entity ||
            !sameCanvasEntity(prepared.entity, entity) ||
            prepared.resourceIdentity !== canvasCanonicalResourceIdentity(node)
          ) continue
          const rendererId = canvasFileRendererIdentity(node, props.fileRendererRegistry)
          const previous = next.get(prepared.nodeId)
          if (
            previous &&
            sameCanvasTransientResourceOwner(previous, node, entity) &&
            previous.rendererId === rendererId &&
            sameCanvasRuntimeValue(previous.state, state)
          ) {
            continue
          }
          next = next.set(prepared.nodeId, {
            entity: prepared.entity,
            rendererId,
            resourceIdentity: prepared.resourceIdentity,
            state,
          })
        }
        return next
      })
    },
    [projectionStore, props.fileRendererRegistry],
  )
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
  useEffect(() => {
    const liveNodes = new Map(canonicalDocument.nodes.map((node) => [node.id, node]))
    setReactFlowMeasurements((current) => {
      const next = new Map<string, CanvasTransientMeasurement>()
      for (const [nodeId, transient] of current) {
        const node = liveNodes.get(nodeId)
        if (!node) continue
        const entity = projectionStore.resolveNodeEntity(nodeId)
        if (transient.entity && !sameCanvasEntity(transient.entity, entity)) continue
        if (!sameCanvasSize(transient.canonicalSize, getCanvasNodeSize(node))) continue
        if (transient.rendererId !== canvasFileRendererIdentity(node, props.fileRendererRegistry)) continue
        next.set(nodeId, transient)
      }
      if (next.size === current.size && [...next].every(([nodeId, value]) => current.get(nodeId) === value)) {
        return current
      }
      return next
    })
    setResourceStates((current) => {
      let next = CanvasPersistentRuntimeMap.empty<CanvasTransientResourceState>()
      for (const [nodeId, transient] of current) {
        if (!liveNodes.has(nodeId)) continue
        const node = liveNodes.get(nodeId)!
        const entity = projectionStore.resolveNodeEntity(nodeId)
        if (!sameCanvasTransientResourceOwner(transient, node, entity)) continue
        if (transient.rendererId !== canvasFileRendererIdentity(node, props.fileRendererRegistry)) continue
        next = next.set(nodeId, transient)
      }
      if (next.size !== current.size) return next
      for (const [nodeId, value] of next) if (current.get(nodeId) !== value) return next
      return current
    })
  }, [canonicalDocument, fileRendererRegistryVersion, projectionStore, props.fileRendererRegistry])
  useEffect(() => {
    for (const [nodeId, preview] of localResourcePreviewsRef.current) {
      if (resourceStates.get(nodeId)?.localPreviewToken === preview.token) continue
      blockedLocalResourcePreviewHydrationsRef.current.delete(preview.token)
      revokeCanvasLocalResourcePreviewUrl(preview.objectUrl)
      localResourcePreviewsRef.current.delete(nodeId)
    }
    for (const url of retiredLocalResourcePreviewUrlsRef.current) {
      revokeCanvasLocalResourcePreviewUrl(url)
    }
    retiredLocalResourcePreviewUrlsRef.current.clear()
    const hydrationNodeIds = new Set<string>()
    for (const [nodeId, token] of pendingLocalResourcePreviewHydrationsRef.current) {
      const currentPreviewToken = resourceStates.get(nodeId)?.localPreviewToken
      if (currentPreviewToken === token) continue
      pendingLocalResourcePreviewHydrationsRef.current.delete(nodeId)
      if (!currentPreviewToken) hydrationNodeIds.add(nodeId)
    }
    if (hydrationNodeIds.size > 0) {
      void resourceRefreshControllerRef.current?.invalidateResources([...hydrationNodeIds])
    }
  }, [resourceStates])
  useEffect(
    () => () => {
      for (const preview of localResourcePreviewsRef.current.values()) {
        revokeCanvasLocalResourcePreviewUrl(preview.objectUrl)
      }
      for (const url of retiredLocalResourcePreviewUrlsRef.current) {
        revokeCanvasLocalResourcePreviewUrl(url)
      }
      localResourcePreviewsRef.current.clear()
      blockedLocalResourcePreviewHydrationsRef.current.clear()
      pendingLocalResourcePreviewHydrationsRef.current.clear()
      retiredLocalResourcePreviewUrlsRef.current.clear()
    },
    [],
  )

  const readOnly =
    !collaborationSession ||
    (props.readOnly ?? false) ||
    leaving ||
    hydrating ||
    Boolean(loadError) ||
    Boolean(saveError) ||
    Boolean(folderFocus)
  const baseInteractionPolicy = resolveCanvasInteractionPolicy({
    readOnly,
    selectionDragChordHeld: false,
    spacePanning,
    tool: interactionTool,
  })
  const canvasPointerNavigationOnly = baseInteractionPolicy.navigationOnly
  const canvasPointerSelectionEnabled = baseInteractionPolicy.selectionEnabled
  const selectedNodeIds = useMemo(() => [...selection.nodeIds], [selection.nodeIds])
  const selectedEdgeIds = useMemo(() => [...selection.edgeIds], [selection.edgeIds])
  const selectionContext = useMemo(() => deriveCanvasSelectionContext(selection), [selection])
  const singleSelectedNode = selectionContext.kind === "single-node"
    ? resolveCurrentNode(selectionContext.nodeId)
    : undefined
  const selectedNodeKind =
    selectionContext.kind === "single-node"
      ? singleSelectedNode?.data.kind
      : undefined
  const onlyRenderVisibleElements = resolveCanvasOnlyRenderVisibleElements({
    assistantAvailable: Boolean(assistantService),
    configured: props.onlyRenderVisibleElements,
    editorAvailable: !readOnly || hydrating,
    selectedNodeKind,
  })
  const selectionProjection = useMemo(
    () => {
      const projectionDocument = boundedViewportEnabled
        ? createCanvasKeyedNodeDocument(
            history.document,
            selectedNodeIds,
            resolveCurrentNode,
            selectedEdgeIds,
            projectionStore.resolveEdge?.bind(projectionStore),
          )
        : history.document
      return (
      createCanvasSelectionProjection({
        document: projectionDocument,
        renderers: props.fileRendererRegistry,
        scopeId: currentViewScopeId,
        selection: selectionContext,
        viewId: props.viewId ?? "",
      }))
    },
    [
      boundedViewportEnabled,
      currentViewScopeId,
      fileRendererRegistryVersion,
      history.document,
      projectionStore,
      props.fileRendererRegistry,
      props.viewId,
      resolveCurrentNode,
      selectedEdgeIds,
      selectedNodeIds,
      selectionContext,
      viewportProjectionRevision,
    ],
  )
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
  const legacyGroupFocus = useMemo(
    () => projectCanvasGroupFocus(history.document, focusedGroupId),
    [focusedGroupId, history.document],
  )
  useEffect(() => {
    if (!focusedGroupId) return
    const current = projectionStore.resolveNode?.(focusedGroupId)
    if ((boundedViewportEnabled ? current?.data.kind !== "group" : legacyGroupFocus.focusedGroupId !== focusedGroupId)) {
      setFocusedGroupId(null)
    }
  }, [boundedViewportEnabled, focusedGroupId, legacyGroupFocus.focusedGroupId, projectionStore])
  const rendererViewportPins = useMemo(() => {
    const pins = new Set<string>()
    const add = (nodeId: string | null | undefined) => {
      if (nodeId && pins.size < CANVAS_RENDERER_VIEWPORT_MAX_NODES) pins.add(nodeId)
    }
    add(focusedGroupId)
    for (const nodeId of pendingNodeFocus?.nodeIds ?? []) add(nodeId)
    for (const nodeId of gestureGeometry.keys()) add(nodeId)
    for (const nodeId of pendingGeometry.keys()) add(nodeId)
    add(connectionTargetNodeId)
    add(connectionStartRef.current?.nodeId)
    add(groupDropTargetId)
    for (const nodeId of selection.nodeIds) add(nodeId)
    for (const nodeId of certifiedViewportPinsRef.current) add(nodeId)
    return Object.freeze([...pins])
  }, [
    connectionTargetNodeId,
    focusedGroupId,
    gestureGeometry,
    groupDropTargetId,
    pendingGeometry,
    pendingNodeFocus,
    selection.nodeIds,
    viewportProjectionRevision,
  ])
  const viewportProjection = useMemo<CanvasRendererViewportProjection | null>(() => {
    if (!projectionStore.queryViewport) return null
    const zoom = Number.isFinite(rendererViewport.zoom) && rendererViewport.zoom > 0 ? rendererViewport.zoom : 1
    const overscan = 256 / zoom
    return projectionStore.queryViewport({
      focusedGroupId,
      pinnedNodeIds: rendererViewportPins,
      rect: {
        height: rendererViewportSize.height / zoom + overscan * 2,
        width: rendererViewportSize.width / zoom + overscan * 2,
        x: -rendererViewport.x / zoom - overscan,
        y: -rendererViewport.y / zoom - overscan,
      },
    })
  }, [
    focusedGroupId,
    projectionStore,
    rendererViewport.x,
    rendererViewport.y,
    rendererViewport.zoom,
    rendererViewportPins,
    rendererViewportSize.height,
    rendererViewportSize.width,
    viewportProjectionRevision,
  ])
  const viewportPresentationNodes = useMemo(
    () => viewportProjection?.nodes.map((node) =>
      projectCanvasTransientNodeGeometry(node, gestureGeometry.get(node.id), pendingGeometry.get(node.id))),
    [gestureGeometry, pendingGeometry, viewportProjection],
  )
  const groupFocus = useMemo(
    () => viewportProjection
      ? projectCanvasGroupFocus(
          {
            ...history.document,
            edges: [...viewportProjection.edges],
            nodes: [...(viewportPresentationNodes ?? [])],
          },
          focusedGroupId,
        )
      : legacyGroupFocus,
    [focusedGroupId, history.document, legacyGroupFocus, viewportPresentationNodes, viewportProjection],
  )
  const hasSingleGroupSelection = selectionContext.kind === "single-node" && singleSelectedNode?.data.kind === "group"
  const selectedGroup =
    hasSingleGroupSelection && selectionContext.kind === "single-node"
      ? singleSelectedNode
      : undefined
  const selectedGroupFolded = isCanvasGroupFolded(selectedGroup)
  const selectedNodeDocument = boundedViewportEnabled
    ? createCanvasKeyedNodeDocument(history.document, selectedNodeIds, resolveCurrentNode)
    : history.document
  const groupMenuCapabilities = resolveCanvasGroupMenuCapabilities({
    canGroupSelection: selectionContext.kind === "multi-node" && canGroupCanvasNodes(selectedNodeDocument, selectedNodeIds),
    hasSingleGroupSelection,
    singleGroupFolded: selectedGroupFolded,
    singleGroupFoldUnsupported: hasUnsupportedCanvasGroupFold(selectedGroup),
  })
  const arrangeNodeIds = useMemo(() => {
    const ids = [...selection.nodeIds]
    if (ids.length !== 1) return ids
    if (!groupMenuCapabilities.canArrangeChildren) return ids
    const selected = resolveCurrentNode(ids[0]!)
    if (!selected) return ids
    const currentNodes = viewportProjection?.nodes ?? history.document.nodes
    return currentNodes.filter((node) => node.parentId === selected.id).map((node) => node.id)
  }, [
    groupMenuCapabilities.canArrangeChildren,
    history.document.nodes,
    resolveCurrentNode,
    selection.nodeIds,
    viewportProjection,
  ])
  const arrangeNodes = arrangeNodeIds.flatMap((id) => {
    const node = resolveCurrentNode(id)
    return node ? [node] : []
  })
  const canArrangeSelection =
    groupMenuCapabilities.canArrangeChildren ||
    (arrangeNodes.length >= 2 && arrangeNodes.every((node) => node.parentId === arrangeNodes[0]?.parentId))
  const canDistributeSelection =
    groupMenuCapabilities.canArrangeChildren || (canArrangeSelection && arrangeNodes.length >= 3)
  const resolveCurrentArrangeNodeIds = useCallback(() => {
    const ids = [...selectionRef.current.nodeIds]
    if (ids.length !== 1) return ids
    const selected = resolveCurrentNode(ids[0]!)
    if (selected?.data.kind !== "group" || isCanvasGroupFolded(selected)) return ids
    const document = readCurrentBulkDocument()
    return document.nodes.filter((node) => node.parentId === selected.id).map((node) => node.id)
  }, [readCurrentBulkDocument, resolveCurrentNode])
  const folderFocusNodes = useMemo(
    () =>
      folderFocus?.listing
        ? createCanvasFolderFocusNodes({
            listing: folderFocus.listing,
            ownerNodeId: folderFocus.ownerNodeId,
            reservedNodeIds: history.document.nodes.map((node) => node.id),
          })
        : [],
    [folderFocus, history.document.nodes],
  )
  const canvasNodeIds = useMemo(
    () => (folderFocus ? folderFocusNodes.map((node) => node.id) : [...groupFocus.scopeNodeIds]),
    [folderFocus, folderFocusNodes, groupFocus.scopeNodeIds],
  )
  const canLayoutCanvas = !readOnly && canvasNodeIds.length >= 2
  const nodes = useMemo(() => {
    if (folderFocus) {
      return boundedViewportEnabled
        ? folderFocusNodes.slice(0, CANVAS_RENDERER_VIEWPORT_MAX_NODES)
        : folderFocusNodes
    }
    const activeFocusedGroupId = viewportProjection ? focusedGroupId : groupFocus.focusedGroupId
    const depth = (node: CanvasNode, visited = new Set<string>()): number => {
      if (visited.has(node.id)) return 0
      visited.add(node.id)
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      return parent ? depth(parent, visited) + 1 : 0
    }
    const incrementalNodes = !viewportProjection && incrementalProjectionNodesRef.current.size > 0
      ? (() => {
          const documentNodeIds = new Set(history.document.nodes.map((node) => node.id))
          return [...incrementalProjectionNodesRef.current.values()].filter((node) => !documentNodeIds.has(node.id))
        })()
      : []
    const sourceNodes = viewportPresentationNodes ?? (incrementalNodes.length > 0
      ? [...history.document.nodes, ...incrementalNodes]
      : history.document.nodes)
    const authoritativeNodes = sourceNodes
      .filter(
        (node) =>
          (viewportProjection !== null || groupFocus.visibleNodeIds.has(node.id) ||
            (groupFocus.focusedGroupId === null && incrementalProjectionNodesRef.current.has(node.id))) &&
          !optimisticHiddenNodeIds.has(node.id),
      )
      .map((authoritativeNode) => {
        const incrementalRuntime = resourceStates.get(authoritativeNode.id)
        const currentEntity = projectionStore.resolveNodeEntity(authoritativeNode.id)
        const runtimeNode =
          incrementalRuntime &&
          "resourceState" in authoritativeNode.data &&
          sameCanvasTransientResourceOwner(incrementalRuntime, authoritativeNode, currentEntity)
            ? {
                ...authoritativeNode,
                data: { ...authoritativeNode.data, resourceState: incrementalRuntime.state },
              }
            : authoritativeNode
        const node = applyCanvasReplacePresentation(
          runtimeNode,
          optimisticNodeReplacements.get(runtimeNode.id),
        )
        const isFocusRoot = node.id === activeFocusedGroupId
        const isFolder = node.data.kind === "group" && !isFocusRoot && isCanvasGroupFolded(node)
        const measurement = reactFlowMeasurements.get(node.id)
        const currentNodeEntity = projectionStore.resolveNodeEntity(node.id)
        const measured =
          !isFocusRoot &&
          !isFolder &&
          measurement &&
          (!measurement.entity || sameCanvasEntity(measurement.entity, currentNodeEntity)) &&
          sameCanvasSize(measurement.canonicalSize, getCanvasNodeSize(node)) &&
          measurement.rendererId === canvasFileRendererIdentity(node, props.fileRendererRegistry)
            ? measurement.size
            : undefined
        const projected = projectCanvasNodeInitialDimensions(
          projectCanvasFocusedNode(
            isFocusRoot
              ? {
                  ...node,
                  draggable: false,
                  extent: undefined,
                  focusable: false,
                  parentId: undefined,
                  position: { x: 0, y: 0 },
                  selectable: false,
                  selected: false,
                  zIndex: -1,
                }
              : isFolder
                ? {
                    ...node,
                    height: undefined,
                    initialHeight: CANVAS_GROUP_FOLDER_SIZE.height,
                    initialWidth: CANVAS_GROUP_FOLDER_SIZE.width,
                    measured: undefined,
                    style: {
                      ...node.style,
                      height: CANVAS_GROUP_FOLDER_SIZE.height,
                      width: CANVAS_GROUP_FOLDER_SIZE.width,
                    },
                    width: undefined,
                    zIndex: 0,
                  }
                : node,
            activeFocusedGroupId,
          ),
          measured,
        )
        const selected = selection.nodeIds.has(node.id)
        const isConnectionTarget = node.id === connectionTargetNodeId
        if (isFocusRoot) return projected
        if (!selected && !isConnectionTarget) return projected
        return {
          ...projected,
          className: cn(node.className, isConnectionTarget && "is-connection-target"),
          selected,
        }
      })
    if (viewportProjection) return authoritativeNodes
    const ghostNodes = optimisticResourceGhosts
      .filter((ghost) => (ghost.parentPresentationKey ?? null) === (groupFocus.focusedGroupId ?? null))
      .map(projectCanvasGhostNodeForReactFlow)
    return [...authoritativeNodes, ...ghostNodes].sort((left, right) => depth(left) - depth(right))
  }, [
    connectionTargetNodeId,
    boundedViewportEnabled,
    folderFocus,
    folderFocusNodes,
    focusedGroupId,
    groupFocus.focusedGroupId,
    groupFocus.visibleNodeIds,
    history.document.nodes,
    optimisticResourceGhosts,
    optimisticHiddenNodeIds,
    optimisticNodeReplacements,
    nodeById,
    projectionStore,
    props.fileRendererRegistry,
    reactFlowMeasurements,
    resourceStates,
    selection.nodeIds,
    viewportProjection,
    viewportPresentationNodes,
  ])
  const edges = useMemo(() => {
    if (edgesHidden || folderFocus) return []
    const incrementalEdges = !viewportProjection && groupFocus.focusedGroupId === null && incrementalProjectionEdgesRef.current.size > 0
      ? (() => {
          const documentEdgeIds = new Set(groupFocus.edges.map((edge) => edge.id))
          return [...incrementalProjectionEdgesRef.current.values()].filter((edge) => !documentEdgeIds.has(edge.id))
        })()
      : []
    const sourceEdges = viewportProjection?.edges ??
      (incrementalEdges.length > 0 ? [...groupFocus.edges, ...incrementalEdges] : groupFocus.edges)
    const authoritativeEdges = sourceEdges
      .filter(
        (edge) =>
          !optimisticHiddenEdgeIds.has(edge.id) &&
          !optimisticHiddenNodeIds.has(edge.source) &&
          !optimisticHiddenNodeIds.has(edge.target),
      )
      .map((edge) => ({
        ...edge,
        animated: shouldAnimateCanvasEdge(edge, selection),
        selected: selection.edgeIds.has(edge.id),
        sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
        targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
        type: !edge.type || edge.type === "smoothstep" ? "canvas" : edge.type,
      }))
    if (viewportProjection) return authoritativeEdges
    const ghostEdges = optimisticGhostEdges.map(projectCanvasGhostEdgeForReactFlow)
    return [...authoritativeEdges, ...ghostEdges]
  }, [
    edgesHidden,
    folderFocus,
    groupFocus.edges,
    optimisticGhostEdges,
    optimisticHiddenEdgeIds,
    optimisticHiddenNodeIds,
    selection,
    viewportProjection,
  ])
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
  // Canvas can atomically create connected text resources and manual image/video
  // placeholders, but it has no generic create-agent/plugin-plus-edge intent. Keep
  // unsupported compound writes out of the UI instead of splitting one user action
  // into two independently durable frames.
  const quickConnectionNodeTypes = useMemo(
    () =>
      connectionNodeTypes.filter(
        (definition) => definition.type === "text" || definition.type === "image" || definition.type === "video",
      ),
    [connectionNodeTypes],
  )

  useEffect(() => {
    const active = generationControllerRef.current
    if (active && active.documentId !== history.document.id) active.controller.abort()
  }, [history.document.id])

  useEffect(() => () => generationControllerRef.current?.controller.abort(), [generateService])

  const replaceSelection = useCallback(
    (next: CanvasSelection) => {
      const current = selectionRef.current
      // React Flow may echo the same selected ids while a new authoritative
      // incarnation is being projected. Treat that as a no-op so it cannot
      // recapture the replacement entity and preserve a stale selection.
      if (equalIds(current.nodeIds, next.nodeIds) && equalIds(current.edgeIds, next.edgeIds)) return
      selectionRef.current = next
      selectedNodeEntitiesRef.current = new Map(
        [...next.nodeIds].flatMap((nodeId) => {
          const entity = projectionStore.resolveNodeEntity(nodeId)
          return entity ? [[nodeId, entity] as const] : []
        }),
      )
      setSelection(next)
    },
    [projectionStore],
  )
  const updateSelection = useCallback(
    (nodeIds: readonly string[], edgeIds: readonly string[] = []) => {
      replaceSelection({ nodeIds: new Set(nodeIds), edgeIds: new Set(edgeIds) })
    },
    [replaceSelection],
  )
  const finishNodeEntryForScope = useCallback(
    (scopeKey: string, nodeId: string) => {
      const timerKey = `${scopeKey}\u0000${nodeId}`
      const timer = nodeEntryTimersRef.current.get(timerKey)
      if (timer !== undefined) {
        clearTimeout(timer)
        nodeEntryTimersRef.current.delete(timerKey)
      }
      nodeEntryPresentation.finish(scopeKey, nodeId)
    },
    [nodeEntryPresentation],
  )
  const finishNodeEntry = useCallback(
    (nodeId: string) => finishNodeEntryForScope(nodeEntryScopeKey, nodeId),
    [finishNodeEntryForScope, nodeEntryScopeKey],
  )
  const notifyNodeEntryAnimationStartForScope = useCallback(
    (scopeKey: string, nodeId: string) => {
      if (!nodeEntryPresentation.has(nodeId)) return
      const timerKey = `${scopeKey}\u0000${nodeId}`
      const currentTimer = nodeEntryTimersRef.current.get(timerKey)
      if (currentTimer !== undefined) clearTimeout(currentTimer)
      nodeEntryTimersRef.current.set(
        timerKey,
        setTimeout(
          () => finishNodeEntryForScope(scopeKey, nodeId),
          CANVAS_MOTION_DURATION.nodeEnter + CANVAS_NODE_ENTRY_FINISH_GRACE,
        ),
      )
    },
    [finishNodeEntryForScope, nodeEntryPresentation],
  )
  const notifyNodeEntryAnimationStart = useCallback(
    (nodeId: string) => notifyNodeEntryAnimationStartForScope(nodeEntryScopeKey, nodeId),
    [nodeEntryScopeKey, notifyNodeEntryAnimationStartForScope],
  )
  const startNodeEntryPresentation = useCallback(
    (nodeIds: readonly string[]) => {
      const activated = [...new Set(nodeIds)].filter((nodeId) => Boolean(resolveCurrentNode(nodeId)))
      if (activated.length === 0 || prefersReducedMotion) return
      nodeEntryPresentation.start(nodeEntryScopeKey, activated)
      for (const nodeId of activated) {
        const timerKey = `${nodeEntryScopeKey}\u0000${nodeId}`
        const currentTimer = nodeEntryTimersRef.current.get(timerKey)
        if (currentTimer !== undefined) clearTimeout(currentTimer)
        nodeEntryTimersRef.current.set(
          timerKey,
          setTimeout(() => finishNodeEntryForScope(nodeEntryScopeKey, nodeId), CANVAS_NODE_ENTRY_MOUNT_TIMEOUT),
        )
      }
    },
    [finishNodeEntryForScope, nodeEntryPresentation, nodeEntryScopeKey, prefersReducedMotion, resolveCurrentNode],
  )
  const presentNodeEntries = useCallback(
    (nodeIds: readonly string[]) => {
      const tracker = nodeEntryTrackerRef.current
      if (!tracker || tracker.scopeKey !== nodeEntryScopeKey) return
      tracker.queue(nodeEntryScopeKey, nodeIds)
      const availableNodeIds = new Set(nodeIds.filter((nodeId) => Boolean(resolveCurrentNode(nodeId))))
      startNodeEntryPresentation(tracker.activate(nodeEntryScopeKey, availableNodeIds))
    },
    [nodeEntryScopeKey, resolveCurrentNode, startNodeEntryPresentation],
  )
  const adoptOptimisticallyPresentedNodeEntries = useCallback(
    (nodeIds: readonly string[]) => {
      const tracker = nodeEntryTrackerRef.current
      if (!tracker || tracker.scopeKey !== nodeEntryScopeKey) return
      // The ghost already supplied the creation presentation while the camera was
      // moving. Record the owner-derived ids as presented so the authoritative
      // handoff does not replay a second fade/scale entrance.
      tracker.claim(nodeEntryScopeKey, nodeIds)
    },
    [nodeEntryScopeKey],
  )
  const armFocusedNodeEntryTimeout = useCallback(
    (nodeIds: readonly string[]) => {
      const focusTimeout =
        resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.postMutationReveal, prefersReducedMotion) +
        CANVAS_NODE_ENTRY_FINISH_GRACE
      for (const nodeId of nodeIds) {
        const timerKey = `${nodeEntryScopeKey}\u0000${nodeId}`
        const currentTimer = nodeEntryTimersRef.current.get(timerKey)
        if (currentTimer !== undefined) clearTimeout(currentTimer)
        nodeEntryTimersRef.current.set(
          timerKey,
          setTimeout(() => {
            if (nodeEntryPresentation.phase(nodeId) !== "pending-focus") return
            startNodeEntryPresentation([nodeId])
          }, focusTimeout),
        )
      }
    },
    [nodeEntryPresentation, nodeEntryScopeKey, prefersReducedMotion, startNodeEntryPresentation],
  )
  const prepareFocusedNodeEntries = useCallback(
    (nodeIds: readonly string[]) => {
      const tracker = nodeEntryTrackerRef.current
      if (!tracker || tracker.scopeKey !== nodeEntryScopeKey) return
      const claimed = tracker.claim(nodeEntryScopeKey, nodeIds)
      if (prefersReducedMotion) return
      nodeEntryPresentation.prepare(nodeEntryScopeKey, claimed)
      armFocusedNodeEntryTimeout(claimed)
    },
    [armFocusedNodeEntryTimeout, nodeEntryPresentation, nodeEntryScopeKey, prefersReducedMotion],
  )
  const cancelNodeEntries = useCallback(
    (nodeIds: readonly string[]) => {
      const tracker = nodeEntryTrackerRef.current
      if (!tracker || tracker.scopeKey !== nodeEntryScopeKey) return
      tracker.cancel(nodeEntryScopeKey, nodeIds)
      for (const nodeId of nodeIds) finishNodeEntryForScope(nodeEntryScopeKey, nodeId)
    },
    [finishNodeEntryForScope, nodeEntryScopeKey],
  )
  useLayoutEffect(() => {
    const availableNodeIds = new Set(history.document.nodes.map((node) => node.id))
    for (const nodeId of activeNodeEntryIds) {
      if (!availableNodeIds.has(nodeId)) finishNodeEntryForScope(nodeEntryScopeKey, nodeId)
    }
    presentNodeEntries([])
  }, [activeNodeEntryIds, finishNodeEntryForScope, history.document.nodes, nodeEntryScopeKey, presentNodeEntries])
  useLayoutEffect(() => {
    if (!prefersReducedMotion) return
    for (const timer of nodeEntryTimersRef.current.values()) clearTimeout(timer)
    nodeEntryTimersRef.current.clear()
    nodeEntryPresentation.clear(nodeEntryScopeKey)
  }, [nodeEntryPresentation, nodeEntryScopeKey, prefersReducedMotion])
  useLayoutEffect(
    () => () => {
      for (const timer of nodeEntryTimersRef.current.values()) clearTimeout(timer)
      nodeEntryTimersRef.current.clear()
    },
    [nodeEntryScopeKey],
  )
  const getViewSnapshot = useCallback(
    (): CanvasViewSnapshot => ({
      documentId: documentRef.current.id,
      focusedGroupId: focusedGroupIdRef.current,
      scopeId: props.viewScopeId ?? "",
      selectedEdgeIds: [...selectionRef.current.edgeIds],
      selectedNodeIds: [...selectionRef.current.nodeIds],
      viewId: props.viewId ?? "",
      viewport: reactFlowRef.current.getViewport(),
    }),
    [props.viewId, props.viewScopeId],
  )
  const getPostMutationRevealGuard = useCallback(
    (): CanvasPostMutationRevealGuard => ({
      documentId: documentRef.current.id,
      navigationRevision: navigationRevisionRef.current,
      scopeId: props.viewScopeId ?? "",
      viewId: props.viewId ?? "",
    }),
    [props.viewId, props.viewScopeId],
  )
  const confirmCanvasNodeGeometry = useCallback((nodeIds: readonly string[], isCurrent: () => boolean) => {
    const uniqueNodeIds = [...new Set(nodeIds)]
    if (uniqueNodeIds.length === 0 || !isCurrent()) return false
    // Camera bounds are Canvas-owned. Mounted React Flow measurements may be
    // stale or absent under virtualization, so readiness comes from the same
    // authoritative geometry that fit/reveal consumes.
    const ready = uniqueNodeIds.every((nodeId) => {
      const node = resolveCurrentNode(nodeId)
      if (!node) return false
      const size = getCanvasNodePresentationSize(node)
      return isPositiveFiniteDimension(size.width) && isPositiveFiniteDimension(size.height)
    })
    return ready && isCurrent()
  }, [resolveCurrentNode])
  const getSafeViewportRect = useCallback(() => {
    const bounds = rootRef.current?.getBoundingClientRect()
    return bounds
      ? resolveCanvasSafeViewportRect({ height: bounds.height, width: bounds.width }, props.viewportInsets)
      : undefined
  }, [props.viewportInsets?.bottom, props.viewportInsets?.left, props.viewportInsets?.right, props.viewportInsets?.top])
  const interruptCameraMotion = useCallback(() => {
    cameraMotionGenerationRef.current += 1
    for (const listener of cameraMotionInterruptListenersRef.current) listener()
    cameraMotionInterruptListenersRef.current.clear()
    try {
      void reactFlowRef.current.setViewport(reactFlowRef.current.getViewport(), { duration: 0 })
    } catch {
      // React Flow may not be ready during early mount or teardown.
    }
  }, [])
  const markUserNavigation = useCallback(() => {
    navigationRevisionRef.current += 1
    interruptCameraMotion()
    const pending = [...nodeEntryPresentation.activeNodeIds].filter(
      (nodeId) => nodeEntryPresentation.phase(nodeId) === "pending-focus",
    )
    if (pending.length > 0) startNodeEntryPresentation(pending)
  }, [interruptCameraMotion, nodeEntryPresentation, startNodeEntryPresentation])
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
      const motionGeneration = cameraMotionGenerationRef.current
      const safeRect = getSafeViewportRect()
      const effect = resolveCanvasDocumentFitEffect({
        bounds: safeRect
          ? {
              height: safeRect.height,
              left: safeRect.left,
              maxZoom: CANVAS_MAX_ZOOM,
              minZoom: CANVAS_MIN_ZOOM,
              top: safeRect.top,
              width: safeRect.width,
            }
          : undefined,
        document,
        maxZoom,
        nodeIds: options.nodeIds,
        padding,
      })
      if (!isCanvasCameraMotionCurrent(motionGeneration, cameraMotionGenerationRef.current)) return
      if (effect.kind === "renderer-fallback") {
        await reactFlowRef.current.fitView({
          duration: resolveCanvasMotionDuration(options.duration ?? CANVAS_FIT_DURATION, prefersReducedMotion),
          ease: canvasViewportEase,
          interpolate: "smooth",
          maxZoom: effect.maxZoom,
          padding: effect.padding,
          ...(effect.nodeIds ? { nodes: effect.nodeIds.map((id) => ({ id })) } : {}),
        })
        return
      }
      if (effect.kind === "viewport") {
        await reactFlowRef.current.setViewport(effect.viewport, {
          duration: resolveCanvasMotionDuration(options.duration ?? CANVAS_FIT_DURATION, prefersReducedMotion),
          ease: canvasViewportEase,
          interpolate: "smooth",
        })
      }
    },
    [getSafeViewportRect, prefersReducedMotion],
  )
  const navigateGroupFocus = useCallback(
    async (requestedGroupId: string | null, fitScope = true): Promise<"changed" | "stale" | "unchanged"> => {
      const document = readCurrentBulkDocument()
      const requestedGroup = requestedGroupId
        ? document.nodes.find((node) => node.id === requestedGroupId && node.data.kind === "group")
        : undefined
      const nextGroupId = requestedGroup?.id ?? null
      const navigationGeneration = ++groupFocusNavigationGenerationRef.current
      if (nextGroupId === focusedGroupIdRef.current) return "unchanged"
      markUserNavigation()
      updateSelection([])
      focusedGroupIdRef.current = nextGroupId
      setFocusedGroupId(nextGroupId)
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
          resolve()
          return
        }
        window.requestAnimationFrame(() => resolve())
      })
      if (navigationGeneration !== groupFocusNavigationGenerationRef.current) return "stale"
      if (!fitScope) return "changed"
      const scopeNodeIds = document.nodes
        .filter((node) => (nextGroupId ? node.parentId === nextGroupId : !node.parentId))
        .map((node) => node.id)
      if (scopeNodeIds.length === 0) return "changed"
      if (navigationGeneration !== groupFocusNavigationGenerationRef.current) return "stale"
      await fitDocumentViewport(document, {
        duration: CANVAS_MOTION_DURATION.fit,
        maxZoom: CANVAS_FIT_MAX_ZOOM,
        nodeIds: scopeNodeIds,
        padding: CANVAS_FIT_PADDING,
      })
      return navigationGeneration === groupFocusNavigationGenerationRef.current ? "changed" : "stale"
    },
    [fitDocumentViewport, markUserNavigation, readCurrentBulkDocument, updateSelection],
  )
  const focusGroup = useCallback(
    (groupId: string) => {
      folderFocusRequestRef.current?.abort()
      folderFocusRequestRef.current = null
      setFolderFocus(null)
      void navigateGroupFocus(groupId)
    },
    [navigateGroupFocus],
  )
  const waitForFocusProjection = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
          resolve()
          return
        }
        window.requestAnimationFrame(() => resolve())
      }),
    [],
  )
  const fitFolderFocusListing = useCallback(
    async (listing: CanvasFolderBrowseListing, ownerNodeId: string) => {
      const nodeIds = createCanvasFolderFocusNodes({
        listing,
        ownerNodeId,
        reservedNodeIds: readCurrentBulkDocument().nodes.map((node) => node.id),
      }).map((node) => node.id)
      if (nodeIds.length === 0) return
      await waitForFocusProjection()
      await reactFlowRef.current.fitView({
        duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.fit, prefersReducedMotion),
        ease: canvasViewportEase,
        interpolate: "smooth",
        maxZoom: CANVAS_FIT_MAX_ZOOM,
        nodes: nodeIds.map((id) => ({ id })),
        padding: CANVAS_FIT_PADDING,
      })
    },
    [prefersReducedMotion, readCurrentBulkDocument, waitForFocusProjection],
  )
  const leaveFolderFocus = useCallback(
    async (fitScope = true) => {
      const current = folderFocusRef.current
      if (!current) return false
      folderFocusRequestRef.current?.abort()
      folderFocusRequestRef.current = null
      markUserNavigation()
      updateSelection([])
      setFolderFocus(null)
      setFocusedGroupId(current.returnGroupId)
      if (!fitScope) return true
      await waitForFocusProjection()
      const document = readCurrentBulkDocument()
      const scopeNodeIds = document.nodes
        .filter((node) => (current.returnGroupId ? node.parentId === current.returnGroupId : !node.parentId))
        .map((node) => node.id)
      if (scopeNodeIds.length === 0) return true
      await fitDocumentViewport(document, {
        duration: CANVAS_MOTION_DURATION.fit,
        maxZoom: CANVAS_FIT_MAX_ZOOM,
        nodeIds: scopeNodeIds,
        padding: CANVAS_FIT_PADDING,
      })
      return true
    },
    [fitDocumentViewport, markUserNavigation, readCurrentBulkDocument, updateSelection, waitForFocusProjection],
  )
  const navigateFolderFocus = useCallback(
    async (
      ownerNodeId: string,
      directoryId?: string,
      options?: {
        fitScope?: boolean
        path?: readonly CanvasFolderBrowsePathEntry[]
        preserveListing?: boolean
        userNavigation?: boolean
      },
    ) => {
      const owner = resolveCurrentNode(ownerNodeId)
      if (owner?.data.kind !== "folder") return false
      const current = folderFocusRef.current
      const returnGroupId = current?.returnGroupId ?? focusedGroupIdRef.current
      const path = options?.path ?? current?.path ?? [{ id: directoryId ?? ownerNodeId, label: owner.data.label }]
      if (options?.userNavigation !== false) {
        markUserNavigation()
        updateSelection([])
      }
      setFocusedGroupId(null)
      folderFocusRequestRef.current?.abort()
      const controller = new AbortController()
      folderFocusRequestRef.current = controller
      setFolderFocus({
        directoryId,
        error: null,
        listing: options?.preserveListing ? (current?.listing ?? null) : null,
        loading: true,
        ownerNodeId,
        path,
        returnGroupId,
      })
      if (!folderBrowseService) {
        if (folderFocusRequestRef.current === controller) {
          setFolderFocus({
            directoryId,
            error: "Folder browsing is unavailable.",
            listing: null,
            loading: false,
            ownerNodeId,
            path,
            returnGroupId,
          })
        }
        return false
      }
      try {
        const listing = await folderBrowseService.list({
          context: {
            documentId: documentRef.current.id,
            selectedNodeIds: [],
            source: props.viewId ?? "canvas",
          },
          ...(directoryId === undefined ? {} : { directoryId }),
          ownerNodeId,
          signal: controller.signal,
        })
        if (controller.signal.aborted || folderFocusRequestRef.current !== controller) return false
        setFolderFocus({
          directoryId,
          error: null,
          listing,
          loading: false,
          ownerNodeId,
          path: listing.path,
          returnGroupId,
        })
        if (options?.fitScope !== false) await fitFolderFocusListing(listing, ownerNodeId)
        return true
      } catch (error) {
        if (controller.signal.aborted || folderFocusRequestRef.current !== controller) return false
        setFolderFocus({
          directoryId,
          error: error instanceof Error ? error.message : "The folder could not be opened.",
          listing: options?.preserveListing ? (current?.listing ?? null) : null,
          loading: false,
          ownerNodeId,
          path,
          returnGroupId,
        })
        return false
      }
    },
    [fitFolderFocusListing, folderBrowseService, markUserNavigation, props.viewId, resolveCurrentNode, updateSelection],
  )
  useEffect(() => {
    if (
      !folderFocus ||
      resolveCurrentNode(folderFocus.ownerNodeId)?.data.kind === "folder"
    ) {
      return
    }
    void leaveFolderFocus(false)
  }, [folderFocus, history.document.nodes, leaveFolderFocus, resolveCurrentNode, viewportProjectionRevision])
  useEffect(() => {
    if (!folderBrowseService?.subscribe) return
    return folderBrowseService.subscribe(() => {
      const current = folderFocusRef.current
      if (!current) return
      void navigateFolderFocus(current.ownerNodeId, current.directoryId, {
        fitScope: false,
        path: current.path,
        preserveListing: true,
        userNavigation: false,
      })
    })
  }, [folderBrowseService, navigateFolderFocus])
  useEffect(
    () => () => {
      folderFocusRequestRef.current?.abort()
      folderFocusRequestRef.current = null
    },
    [],
  )
  useLayoutEffect(() => {
    if (hydrating || loadError || !rootRef.current) return
    const scope = `${currentViewScopeId}:${history.document.id}`
    const action = resolveInitialCanvasCameraFit({
      initializedScope: initialCameraScopeRef.current,
      nodeCount: history.document.nodes.length,
      scope,
    })
    if (action === "skip") return
    initialCameraScopeRef.current = scope
    if (action === "mark-and-fit") {
      const document = readCurrentBulkDocument()
      const initialNodeIds = folderFocus
        ? folderFocusNodes.map((node) => node.id)
        : document.nodes
            .filter((node) => (focusedGroupIdRef.current ? node.parentId === focusedGroupIdRef.current : !node.parentId))
            .map((node) => node.id)
      void fitDocumentViewport(document, {
        duration: 0,
        maxZoom: CANVAS_FIT_MAX_ZOOM,
        nodeIds: initialNodeIds,
        padding: CANVAS_FIT_PADDING,
      })
    }
  }, [
    currentViewScopeId,
    fitDocumentViewport,
    folderFocus,
    folderFocusNodes,
    history.document,
    hydrating,
    loadError,
    readCurrentBulkDocument,
  ])
  const revealCanvasNodesAfterMutation = useCallback(
    async (nodeIds: readonly string[], guard: CanvasPostMutationRevealGuard) => {
      if (
        nodeIds.length === 0 ||
        leavingRef.current ||
        !isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard())
      )
        return
      if (
        !confirmCanvasNodeGeometry(nodeIds, () =>
          isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard()),
        )
      )
        return
      const revealDocument = boundedViewportEnabled
        ? createCanvasKeyedNodeDocument(
            documentRef.current,
            nodeIds,
            projectionStore.resolveNode?.bind(projectionStore),
          )
        : documentRef.current
      const safeRect = getSafeViewportRect()
      if (
        !safeRect ||
        !shouldRevealCanvasNodes({
          document: revealDocument,
          nodeIds,
          safeRect,
          viewport: reactFlowRef.current.getViewport(),
        })
      )
        return
      if (!isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard())) return
      const motionGeneration = cameraMotionGenerationRef.current
      await fitDocumentViewport(revealDocument, {
        duration: CANVAS_MOTION_DURATION.postMutationReveal,
        maxZoom: CANVAS_POST_MUTATION_REVEAL.maxZoom,
        nodeIds,
        padding: CANVAS_POST_MUTATION_REVEAL.padding,
      })
      if (
        !isCanvasCameraMotionCurrent(motionGeneration, cameraMotionGenerationRef.current) ||
        !isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard())
      ) {
        return
      }
    },
    [
      boundedViewportEnabled,
      confirmCanvasNodeGeometry,
      fitDocumentViewport,
      getPostMutationRevealGuard,
      getSafeViewportRect,
      projectionStore,
    ],
  )
  const focusCanvasNodes = useCallback(
    async (
      nodeIds: readonly string[],
      guard: CanvasPostMutationRevealGuard,
      options: { duration?: number; presentEntry?: boolean } = {},
    ) => {
      const duration = options.duration ?? CANVAS_MOTION_DURATION.postMutationReveal
      if (
        nodeIds.length === 0 ||
        leavingRef.current ||
        !isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard()) ||
        !confirmCanvasNodeGeometry(nodeIds, () =>
          isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard()),
        )
      ) {
        return false
      }
      interruptCameraMotion()
      const motionGeneration = cameraMotionGenerationRef.current
      const motionDuration = resolveCanvasMotionDuration(duration, prefersReducedMotion)
      const interruption = createCanvasCameraMotionInterruptWaiter(cameraMotionInterruptListenersRef.current)
      const focusDocument = boundedViewportEnabled
        ? createCanvasKeyedNodeDocument(
            documentRef.current,
            nodeIds,
            projectionStore.resolveNode?.bind(projectionStore),
          )
        : documentRef.current
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          fitDocumentViewport(focusDocument, {
            duration,
            maxZoom: CANVAS_CENTER_FIT_MAX_ZOOM,
            nodeIds,
            padding: CANVAS_CENTER_FIT_PADDING,
          }),
          new Promise<void>((resolve) => {
            timeoutId = setTimeout(resolve, motionDuration + CANVAS_NODE_ENTRY_FINISH_GRACE)
          }),
          interruption.promise,
        ])
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        interruption.dispose()
      }
      if (
        !isCanvasCameraMotionCurrent(motionGeneration, cameraMotionGenerationRef.current) ||
        !isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard())
      ) {
        return false
      }
      if (options.presentEntry !== false) startNodeEntryPresentation(nodeIds)
      return true
    },
    [
      confirmCanvasNodeGeometry,
      boundedViewportEnabled,
      fitDocumentViewport,
      getPostMutationRevealGuard,
      interruptCameraMotion,
      prefersReducedMotion,
      projectionStore,
      startNodeEntryPresentation,
    ],
  )
  const focusOptimisticCanvasGhosts = useCallback(
    async (ghosts: readonly CanvasGhostNode[], guard: CanvasPostMutationRevealGuard) => {
      if (
        ghosts.length === 0 ||
        leavingRef.current ||
        !isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard())
      ) {
        return false
      }
      interruptCameraMotion()
      const motionGeneration = cameraMotionGenerationRef.current
      const duration = CANVAS_MOTION_DURATION.postMutationReveal
      const motionDuration = resolveCanvasMotionDuration(duration, prefersReducedMotion)
      const interruption = createCanvasCameraMotionInterruptWaiter(cameraMotionInterruptListenersRef.current)
      const ghostNodes = ghosts.map(projectCanvasGhostNodeForReactFlow)
      const presentationDocument: CanvasDocument = {
        ...documentRef.current,
        edges: [],
        nodes: ghostNodes,
      }
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          fitDocumentViewport(presentationDocument, {
            duration,
            maxZoom: CANVAS_CENTER_FIT_MAX_ZOOM,
            nodeIds: ghostNodes.map((node) => node.id),
            padding: CANVAS_CENTER_FIT_PADDING,
          }),
          new Promise<void>((resolve) => {
            timeoutId = setTimeout(resolve, motionDuration + CANVAS_NODE_ENTRY_FINISH_GRACE)
          }),
          interruption.promise,
        ])
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        interruption.dispose()
      }
      return (
        isCanvasCameraMotionCurrent(motionGeneration, cameraMotionGenerationRef.current) &&
        isCanvasPostMutationRevealGuardCurrent(guard, getPostMutationRevealGuard())
      )
    },
    [fitDocumentViewport, getPostMutationRevealGuard, interruptCameraMotion, prefersReducedMotion],
  )
  useLayoutEffect(() => {
    if (!pendingNodeFocus) return
    if (!isCanvasPostMutationRevealGuardCurrent(pendingNodeFocus.guard, getPostMutationRevealGuard())) {
      cancelNodeEntries(pendingNodeFocus.nodeIds)
      setPendingNodeFocus(null)
      return
    }
    if (!pendingNodeFocus.nodeIds.every((nodeId) => resolveCurrentNode(nodeId))) return
    setPendingNodeFocus(null)
    void focusCanvasNodes(pendingNodeFocus.nodeIds, pendingNodeFocus.guard).then(
      (focused) => {
        if (!focused) cancelNodeEntries(pendingNodeFocus.nodeIds)
      },
      () => cancelNodeEntries(pendingNodeFocus.nodeIds),
    )
  }, [
    cancelNodeEntries,
    focusCanvasNodes,
    getPostMutationRevealGuard,
    pendingNodeFocus,
    resolveCurrentNode,
    viewportProjectionRevision,
  ])
  useEffect(() => {
    const key = [
      props.viewportInsets?.top ?? 0,
      props.viewportInsets?.right ?? 0,
      props.viewportInsets?.bottom ?? 0,
      props.viewportInsets?.left ?? 0,
    ].join(":")
    if (viewportInsetsKeyRef.current === key) return
    viewportInsetsKeyRef.current = key
    const safeRect = getSafeViewportRect()
    if (!safeRect || selectedNodeIds.length === 0) return
    const viewport = resolveCanvasFocusAvoidanceViewport({
      document: readCurrentWorkingDocument(selectedNodeIds),
      nodeIds: selectedNodeIds,
      safeRect,
      viewport: reactFlow.getViewport(),
    })
    if (!viewport) return
    void reactFlow.setViewport(viewport, {
      duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.viewport, prefersReducedMotion),
      ease: canvasViewportEase,
      interpolate: "smooth",
    })
  }, [
    getSafeViewportRect,
    prefersReducedMotion,
    props.viewportInsets?.bottom,
    props.viewportInsets?.left,
    props.viewportInsets?.right,
    props.viewportInsets?.top,
    reactFlow,
    readCurrentWorkingDocument,
    selectedNodeIds,
  ])
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
      const document = readCurrentBulkDocument()
      const existingNodeIds = new Set(document.nodes.map((node) => node.id))
      const resolveNodeIds = (nodeIds: readonly string[]) => ({
        foundNodeIds: [...new Set(nodeIds.filter((nodeId) => existingNodeIds.has(nodeId)))],
        missingNodeIds: [...new Set(nodeIds.filter((nodeId) => !existingNodeIds.has(nodeId)))],
      })
      let foundNodeIds: string[] = []
      let missingNodeIds: string[] = []
      const duration = resolveCanvasMotionDuration(
        "animation" in command && command.animation === "smooth" ? CANVAS_MOTION_DURATION.fit : 0,
        prefersReducedMotion,
      )

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
        const revealGroupId = resolveCanvasGroupFocusForNodes(document, foundNodeIds)
        if (foundNodeIds.length > 0 && revealGroupId === undefined) {
          throw new Error("Canvas reveal targets must belong to one direct group scope")
        }
        const groupNavigation =
          revealGroupId === undefined ? "unchanged" : await navigateGroupFocus(revealGroupId, false)
        if (groupNavigation === "stale") {
          return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
        }
        const groupScopeChanged = groupNavigation === "changed"
        if (command.select) updateSelection(foundNodeIds)
        if ((command.fit ?? "contain") !== "none" && foundNodeIds.length > 0) {
          const focusGuard = getPostMutationRevealGuard()
          const geometryReady = confirmCanvasNodeGeometry(foundNodeIds, () =>
            isCanvasPostMutationRevealGuardCurrent(focusGuard, getPostMutationRevealGuard()),
          )
          if (!geometryReady) {
            return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
          }
          markUserNavigation()
          const center = command.fit === "center"
          if (groupScopeChanged || typeof revealGroupId === "string") {
            await reactFlowRef.current.fitView({
              duration,
              ease: canvasViewportEase,
              interpolate: "smooth",
              maxZoom: center ? CANVAS_CENTER_FIT_MAX_ZOOM : CANVAS_FIT_MAX_ZOOM,
              nodes: foundNodeIds.map((id) => ({ id })),
              padding: center ? CANVAS_CENTER_FIT_PADDING : CANVAS_FIT_PADDING,
            })
          } else if (center && command.animation === "smooth") {
            await focusCanvasNodes(foundNodeIds, getPostMutationRevealGuard(), {
              duration: CANVAS_MOTION_DURATION.fit,
              presentEntry: false,
            })
          } else {
            await fitDocumentViewport(document, {
              duration,
              maxZoom: center ? CANVAS_CENTER_FIT_MAX_ZOOM : CANVAS_FIT_MAX_ZOOM,
              nodeIds: foundNodeIds,
              padding: center ? CANVAS_CENTER_FIT_PADDING : CANVAS_FIT_PADDING,
            })
          }
        }
      }
      if (command.type === "viewport.fit") {
        const currentFocus = projectCanvasGroupFocus(document, focusedGroupIdRef.current)
        const resolved = resolveCanvasFitTargetNodeIds(document, command.nodeIds)
        foundNodeIds = resolved.foundNodeIds
        missingNodeIds = resolved.missingNodeIds
        const fitGroupId = resolved.explicit ? resolveCanvasGroupFocusForNodes(document, foundNodeIds) : undefined
        if (resolved.explicit && foundNodeIds.length === 0) {
          return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
        }
        if (resolved.explicit && fitGroupId === undefined) {
          throw new Error("Canvas fit targets must belong to one direct group scope")
        }
        const groupNavigation = fitGroupId === undefined ? "unchanged" : await navigateGroupFocus(fitGroupId, false)
        if (groupNavigation === "stale") {
          return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
        }
        const fitGroupScopeChanged = groupNavigation === "changed"
        if (resolved.explicit) {
          const focusGuard = getPostMutationRevealGuard()
          const geometryReady = confirmCanvasNodeGeometry(foundNodeIds, () =>
            isCanvasPostMutationRevealGuardCurrent(focusGuard, getPostMutationRevealGuard()),
          )
          if (!geometryReady) {
            return { foundNodeIds, missingNodeIds, snapshot: getViewSnapshot() }
          }
        }
        markUserNavigation()
        if (
          fitGroupScopeChanged ||
          typeof fitGroupId === "string" ||
          (!resolved.explicit && currentFocus.focusedGroupId)
        ) {
          const nodeIds = fitGroupId !== undefined ? foundNodeIds : [...currentFocus.scopeNodeIds]
          await fitDocumentViewport(document, {
            duration,
            maxZoom: command.maxZoom,
            nodeIds,
            padding: command.padding,
          })
        } else {
          await fitDocumentViewport(document, {
            duration,
            maxZoom: command.maxZoom,
            nodeIds: resolved.explicit ? foundNodeIds : [...currentFocus.scopeNodeIds],
            padding: command.padding,
          })
        }
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
        markUserNavigation()
        await reactFlow.setCenter(command.position.x, command.position.y, {
          duration,
          ease: canvasViewportEase,
          interpolate: "smooth",
          zoom: command.zoom,
        })
      }
      if (command.type === "viewport.zoom") {
        if (!Number.isFinite(command.zoom) || command.zoom < CANVAS_MIN_ZOOM || command.zoom > CANVAS_MAX_ZOOM)
          throw new Error(`Canvas viewport zoom must be between ${CANVAS_MIN_ZOOM} and ${CANVAS_MAX_ZOOM}`)
        markUserNavigation()
        await reactFlow.zoomTo(command.zoom, { duration, ease: canvasViewportEase, interpolate: "smooth" })
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
    [
      confirmCanvasNodeGeometry,
      fitDocumentViewport,
      focusCanvasNodes,
      getPostMutationRevealGuard,
      getViewSnapshot,
      markUserNavigation,
      navigateGroupFocus,
      notificationService,
      prefersReducedMotion,
      readCurrentBulkDocument,
      reactFlow,
      updateSelection,
      waitForStableLoad,
    ],
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
    (_update: (document: CanvasDocument) => CanvasDocument) => {
      if (readOnly) return
      rejectUnmappedCanvasMutation()
    },
    [readOnly, rejectUnmappedCanvasMutation],
  )
  const pointAtCenter = useCallback(() => {
    const bounds = rootRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return reactFlowRef.current.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    })
  }, [])
  const resolveIndexedInsertPoint = useCallback(
    (anchor: CanvasPoint, size: CanvasSize = { height: 200, width: 320 }) =>
      resolveIndexedCanvasResourcePlacements({
        anchor,
        index: canvasDocumentPlacementIndex(
          canonicalDocumentRef.current,
          groupFocus.focusedGroupId ?? undefined,
        ),
        sizes: [size],
      })?.[0] ?? anchor,
    [groupFocus.focusedGroupId],
  )
  const nextViewportInsertPoint = useCallback(
    (size = { height: 200, width: 320 }) => {
      const safeRect = getSafeViewportRect()
      const worldBounds = safeRect
        ? resolveCanvasVisibleWorldRect({ safeRect, viewport: reactFlowRef.current.getViewport() })
        : undefined
      if (!worldBounds) return resolveIndexedInsertPoint(pointAtCenter(), size)
      const preferred = {
        x: worldBounds.left + (worldBounds.width - size.width) / 2,
        y: worldBounds.top + (worldBounds.height - size.height) / 2,
      }
      return resolveIndexedInsertPoint(preferred, size)
    },
    [getSafeViewportRect, pointAtCenter, resolveIndexedInsertPoint],
  )
  const fitCanvas = useCallback(() => {
    markUserNavigation()
    const document = readCurrentBulkDocument()
    const currentFocus = projectCanvasGroupFocus(document, focusedGroupIdRef.current)
    void fitDocumentViewport(document, {
      maxZoom: CANVAS_MAX_ZOOM,
      nodeIds: [...currentFocus.scopeNodeIds],
      padding: CANVAS_FIT_PADDING,
    })
  }, [
    fitDocumentViewport,
    markUserNavigation,
    readCurrentBulkDocument,
  ])
  const nextInsertPoint = useCallback(
    (index = 0, size: CanvasSize = { height: 200, width: 320 }) => {
      const point = insertPoint ?? pointerRef.current ?? pointAtCenter()
      const open = resolveIndexedInsertPoint(point, size)
      return { x: open.x + index * 36, y: open.y + index * 36 }
    },
    [insertPoint, pointAtCenter, resolveIndexedInsertPoint],
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
  const notifyErrorRef = useRef(notifyError)
  notifyErrorRef.current = notifyError
  const resourceRefreshController = useMemo(
    () =>
      hydrationService
          ? new CanvasResourceRefreshController({
            current: () => ({
              document: resourceHydrationDocumentRef.current,
              scope: resourceMutationScopeRef.current,
            }),
            ...(typeof projectionStore.queryResourceHierarchy === "function"
              ? {
                  exact: {
                    capture(target: CanvasRendererResourceHierarchyTarget) {
                      const node = projectionStore.resolveNode?.(target.nodeId)
                      const entity = projectionStore.resolveNodeEntity(target.nodeId)
                      if (!node || !entity || !sameCanvasEntity(target.entity, entity)) return null
                      const resourceIdentity = canvasCanonicalResourceIdentity(node)
                      if (!resourceIdentity) return null
                      const transient = resourceStatesRef.current.get(target.nodeId)
                      const localPreview = localResourcePreviewsRef.current.get(target.nodeId)
                      if (
                        transient?.localPreviewToken &&
                        localPreview?.token === transient.localPreviewToken &&
                        localPreview.pending
                      ) return null
                      const presentedState =
                        transient && sameCanvasTransientResourceOwner(transient, node, entity)
                          ? transient.state
                          : parseCanvasResourceRuntimeState(canvasNodeResourceState(node))
                      const presentedNode =
                        presentedState && "resourceState" in node.data
                          ? { ...node, data: { ...node.data, resourceState: presentedState } }
                          : node
                      return {
                        entity,
                        node: presentedNode,
                        nodeId: node.id,
                        ownerToken: transient,
                        rendererId: canvasFileRendererIdentity(node, props.fileRendererRegistry),
                        resourceIdentity,
                      }
                    },
                    header() {
                      const current = canonicalDocumentRef.current
                      return { id: current.id, metadata: current.metadata }
                    },
                    replace(replacements: readonly CanvasResourceExactRefreshReplacement[]) {
                      const isCurrent = (
                        replacement: CanvasResourceExactRefreshReplacement,
                        states: CanvasPersistentRuntimeMap<CanvasTransientResourceState>,
                      ) => {
                        const { capture } = replacement
                        const node = projectionStore.resolveNode?.(capture.nodeId)
                        const entity = projectionStore.resolveNodeEntity(capture.nodeId)
                        return Boolean(
                          node &&
                            entity &&
                            sameCanvasEntity(capture.entity, entity) &&
                            canvasCanonicalResourceIdentity(node) === capture.resourceIdentity &&
                            canvasFileRendererIdentity(node, props.fileRendererRegistry) === capture.rendererId &&
                            states.get(capture.nodeId) === capture.ownerToken,
                        )
                      }
                      if (!replacements.every((replacement) => isCurrent(replacement, resourceStatesRef.current))) {
                        return false
                      }
                      setResourceStates((current) => {
                        if (!replacements.every((replacement) => isCurrent(replacement, current))) return current
                        let next = current
                        for (const { capture, state } of replacements) {
                          next = next.set(capture.nodeId, {
                            entity: capture.entity,
                            rendererId: capture.rendererId,
                            resourceIdentity: capture.resourceIdentity,
                            state,
                          })
                        }
                        return next
                      })
                      return true
                    },
                  },
                }
              : {}),
            onError: (error) => notifyErrorRef.current("Could not refresh canvas resources", error),
            queue: reloadQueueRef.current,
            replace: (document) => {
              documentRef.current = document
              replaceRuntimeResourceStatesRef.current(document)
            },
            service: hydrationService,
          })
        : undefined,
    [hydrationService, projectionStore, props.fileRendererRegistry],
  )
  resourceRefreshControllerRef.current = resourceRefreshController
  useEffect(() => () => resourceRefreshController?.dispose(), [resourceRefreshController])
  const invalidateResourcesAtHierarchyKey = useCallback(
    (key: CanvasRendererResourceHierarchyKey) => {
      const result = projectionStore.queryResourceHierarchy?.(key)
      if (!result || result.status === "unavailable") {
        return resourceRefreshController?.invalidateResources() ?? Promise.resolve()
      }
      return resourceRefreshController?.invalidateExactResources(result.targets) ?? Promise.resolve()
    },
    [projectionStore, resourceRefreshController],
  )
  const resourceHydrationTargets = useMemo(
    () => canvasResourceHydrationTargets(resourceHydrationDocument),
    [resourceHydrationDocument],
  )
  useEffect(() => {
    if (!resourceHydrationTargets.signature) return
    void resourceRefreshController?.refreshStaleResources(resourceHydrationTargets.nodeIds)
  }, [resourceHydrationTargets.signature, resourceRefreshController])
  const beginLocalResourcePreview = useCallback(
    async (nodeId: string, file: File, kind: string | null | undefined, signal: AbortSignal) => {
      if (kind !== "image" && kind !== "video" && kind !== "audio") return undefined
      if (typeof URL.createObjectURL !== "function") return undefined
      const node = resolveCurrentNode(nodeId)
      const entity = projectionStore.resolveNodeEntity(nodeId)
      if (!node || !entity || node.data.kind !== kind) return undefined
      let objectUrl: string
      try {
        objectUrl = URL.createObjectURL(file)
      } catch {
        return undefined
      }
      if (signal.aborted) {
        revokeCanvasLocalResourcePreviewUrl(objectUrl)
        return undefined
      }
      const currentNode = resolveCurrentNode(nodeId)
      const currentEntity = projectionStore.resolveNodeEntity(nodeId)
      if (!currentNode || !sameCanvasEntity(entity, currentEntity) || currentNode.data.kind !== kind) {
        revokeCanvasLocalResourcePreviewUrl(objectUrl)
        return undefined
      }
      const previousPreview = localResourcePreviewsRef.current.get(nodeId)
      if (previousPreview) {
        blockedLocalResourcePreviewHydrationsRef.current.delete(previousPreview.token)
        retiredLocalResourcePreviewUrlsRef.current.add(previousPreview.objectUrl)
      }
      const token = Symbol("canvas-local-resource-preview")
      const preview: CanvasLocalResourcePreview = {
        nodeId,
        objectUrl,
        pending: true,
        previous: resourceStatesRef.current.get(nodeId),
        token,
      }
      localResourcePreviewsRef.current.set(nodeId, preview)
      setResourceStates((current) => {
        const currentNode = resolveCurrentNode(nodeId)
        const currentEntity = projectionStore.resolveNodeEntity(nodeId)
        if (!currentNode || !sameCanvasEntity(entity, currentEntity)) return current
        return current.set(nodeId, {
          entity,
          localPreviewToken: token,
          rendererId: canvasFileRendererIdentity(currentNode, props.fileRendererRegistry),
          state: {
            localPreview: true,
            ...(file.type ? { mediaType: file.type } : {}),
            name: file.name,
            status: "ready",
            url: objectUrl,
          },
        })
      })
      return token
    },
    [projectionStore, props.fileRendererRegistry, resolveCurrentNode],
  )
  const cancelLocalResourcePreview = useCallback(
    (nodeId: string, token: symbol) => {
      const preview = localResourcePreviewsRef.current.get(nodeId)
      if (preview?.token !== token) return
      const hydrationWasBlocked = blockedLocalResourcePreviewHydrationsRef.current.delete(token)
      if (hydrationWasBlocked && resourceStatesRef.current.get(nodeId)?.localPreviewToken === token) {
        pendingLocalResourcePreviewHydrationsRef.current.set(nodeId, token)
      }
      setResourceStates((current) => {
        if (current.get(nodeId)?.localPreviewToken !== token) return current
        const node = resolveCurrentNode(nodeId)
        const entity = projectionStore.resolveNodeEntity(nodeId)
        if (
          preview.previous &&
          !preview.previous.localPreviewToken &&
          node &&
          sameCanvasTransientResourceOwner(preview.previous, node, entity) &&
          preview.previous.rendererId === canvasFileRendererIdentity(node, props.fileRendererRegistry)
        ) {
          return current.set(nodeId, preview.previous)
        }
        return current.delete(nodeId)
      })
    },
    [projectionStore, props.fileRendererRegistry, resolveCurrentNode],
  )
  const completeLocalResourcePreview = useCallback(
    (nodeId: string, token: symbol) => {
      const preview = localResourcePreviewsRef.current.get(nodeId)
      if (preview?.token !== token) return
      preview.pending = false
      // Retry only when a completed hydration pass was deliberately blocked.
      // An in-flight pass can now finish normally; blindly invalidating it would
      // discard valid work and add another full Main hydration round-trip.
      if (blockedLocalResourcePreviewHydrationsRef.current.delete(token)) {
        void resourceRefreshController?.invalidateResources([nodeId])
      }
    },
    [resourceRefreshController],
  )
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
  const selectionActionUnavailable =
    (props.readOnly ?? false) || leaving || blockingLoad || Boolean(loadError) || Boolean(saveError)
  const selectionActionController = useMemo(
    () => new AbortController(),
    [
      currentViewScopeId,
      history.document.id,
      props.viewId,
      selectedEdgeIds,
      selectedNodeIds,
      selectionActionUnavailable,
    ],
  )
  selectionActionControllerRef.current = selectionActionController
  const selectionActionDocument = useMemo(
    () => boundedViewportEnabled
      ? createCanvasKeyedNodeDocument(
          history.document,
          selectedNodeIds,
          resolveCurrentNode,
          selectedEdgeIds,
          projectionStore.resolveEdge?.bind(projectionStore),
        )
      : history.document,
    [
      boundedViewportEnabled,
      history.document,
      projectionStore,
      resolveCurrentNode,
      selectedEdgeIds,
      selectedNodeIds,
      viewportProjectionRevision,
    ],
  )
  const selectionActionContext = useMemo(
    () =>
      createCanvasSelectionActionContext(
        selectionActionDocument,
        selectedNodeIds,
        selectedEdgeIds,
        selectionActionController.signal,
      ),
    [selectedEdgeIds, selectedNodeIds, selectionActionController, selectionActionDocument],
  )
  const visibleSelectionActions = useMemo(
    () => getVisibleCanvasSelectionActions(props.selectionActions ?? [], selectionActionContext),
    [props.selectionActions, selectionActionContext],
  )
  const visibleSelectionDragSource = useMemo(
    () => getVisibleCanvasSelectionDragSource(props.selectionDragSource, selectionActionContext),
    [props.selectionDragSource, selectionActionContext],
  )
  const [selectionDragStateVersion, refreshSelectionDragState] = useReducer((version: number) => version + 1, 0)
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
  const selectionDragChordHeld = selectionDragGesture.held
  const interactionPolicy = resolveCanvasInteractionPolicy({
    readOnly,
    selectionDragChordHeld,
    spacePanning,
    tool: interactionTool,
  })
  const canvasPointerMutationEnabled = interactionPolicy.mutationEnabled
  const selectionDragArmed = Boolean(
    selectionDragChordHeld && !selectionDragGesture.consumed && visibleSelectionDragSource,
  )
  useEffect(() => {
    if (canvasPointerMutationEnabled) return
    connectionStartRef.current = null
    updateConnectionTargetNode(null)
    boxSelectionActiveRef.current = false
    boxSelectionBaselineRef.current = null
    setPendingConnection(null)
  }, [canvasPointerMutationEnabled, updateConnectionTargetNode])
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
        selectionActionContext.document !== selectionActionDocument ||
        !equalIds(new Set(selectionActionContext.selectedNodeIds), selectionRef.current.nodeIds) ||
        !equalIds(new Set(selectionActionContext.selectedEdgeIds), selectionRef.current.edgeIds)
      )
        return
      void selectionActionExecutor.execute(action, selectionActionContext)
    },
    [selectionActionContext, selectionActionDocument, selectionActionExecutor],
  )
  const isSelectionActionPending = useCallback(
    (actionId: string) => selectionActionExecutor.isPending(actionId, selectionActionContext.signal),
    [selectionActionContext.signal, selectionActionExecutor],
  )
  const selectionDragContextIsCurrent = useCallback(
    () =>
      !hydratingRef.current &&
      !leavingRef.current &&
      selectionActionContext.document === selectionActionDocument &&
      equalIds(new Set(selectionActionContext.selectedNodeIds), selectionRef.current.nodeIds) &&
      equalIds(new Set(selectionActionContext.selectedEdgeIds), selectionRef.current.edgeIds),
    [selectionActionContext, selectionActionDocument],
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
        createCanvasKeyedNodeDocument(documentRef.current, [nodeId], resolveCurrentNode),
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
    [props.selectionDragSource, readOnly, resolveCurrentNode, selectionDragGesture, updateSelection],
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
    async (_document: CanvasDocument) => {
      await collaborationSession?.flush()
      return projectionStore.getProjection()
    },
    [collaborationSession, projectionStore],
  )
  const abortPendingOperations = useCallback(() => {
    for (const controller of operationControllersRef.current) controller.abort()
    operationControllersRef.current.clear()
    abortCanvasReload(reloadControllerRef.current)
  }, [])
  const finalizeGestureAndSave = useCallback(async () => {
    if (historyRef.current.gestureStart) dispatch({ type: "end-gesture" })
    await startSave(documentRef.current)
  }, [startSave])
  const reloadDocument = useCallback(
    async (signal?: AbortSignal) => collaborationSession?.flush(signal),
    [collaborationSession],
  )
  const reloadAuthoritativeDocument = reloadDocument
  // Host observers receive only the authoritative projection. React Flow
  // gesture/resource overlays are renderer state and must never look like a
  // persistable document update to a legacy observer.
  useEffect(() => props.onDocumentChange?.(canonicalDocument), [canonicalDocument, props.onDocumentChange])

  useEffect(() => {
    const nodeIds = new Set(history.document.nodes.map((node) => node.id))
    const edgeIds = new Set(history.document.edges.map((edge) => edge.id))
    const current = selectionRef.current
    const next = {
      nodeIds: new Set(
        [...current.nodeIds].filter((id) => {
          if (!nodeIds.has(id)) return false
          const selectedEntity = selectedNodeEntitiesRef.current.get(id)
          return !selectedEntity || sameCanvasEntity(selectedEntity, projectionStore.resolveNodeEntity(id))
        }),
      ),
      edgeIds: new Set([...current.edgeIds].filter((id) => edgeIds.has(id))),
    }
    replaceSelection(next)
  }, [history.document.edges, history.document.nodes, projectionStore, replaceSelection])
  useEffect(() => {
    const preventUnsavedClose = (event: BeforeUnloadEvent) => {
      if (
        !pendingDraftsRef.current.hasPending() &&
        !textDraftStore?.hasPending() &&
        !saveErrorRef.current &&
        !saveControllerRef.current &&
        !historyRef.current.gestureStart
      )
        return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", preventUnsavedClose)
    return () => window.removeEventListener("beforeunload", preventUnsavedClose)
  }, [textDraftStore])
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
    if (pendingConnection && !resolveCurrentNode(pendingConnection.nodeId)) {
      setPendingConnection(null)
    }
  }, [pendingConnection, resolveCurrentNode, viewportProjectionRevision])
  const runResourceMutation = useCallback(
    (
      input: Omit<CanvasResourceMutationRequest, "signal">,
      options: {
        focusCreatedNodes?: boolean
        parentGroupId?: string | null
        resolvedOptimisticPositions?: readonly CanvasPoint[]
        revealCreatedNodes?: boolean
        showSelectionImmediately?: boolean
      } = {},
    ) => {
      if (!mutationService || readOnly) return
      const controller = new AbortController()
      operationControllersRef.current.add(controller)
      const presentationGeneration = ++resourceMutationPresentationGenerationRef.current
      const isLatestPresentation = () => resourceMutationPresentationGenerationRef.current === presentationGeneration
      const emptyLocalCreate = isEmptyLocalCanvasResourceCreate(input)
      const revealGuard =
        options.focusCreatedNodes || options.revealCreatedNodes ? getPostMutationRevealGuard() : undefined
      const droppedFiles = input.files && input.files.length > 0 ? input.files : []
      const optimisticFiles = emptyLocalCreate ? [] : droppedFiles
      void (async () => {
        const performanceStartedAt = performance.now()
        const performanceOperationId = globalThis.crypto.randomUUID()
        const recordPerformanceStage = (stage: string) =>
          telemetryService?.track({
            name: "canvas.resource.performance",
            properties: {
              durationMs: Math.round((performance.now() - performanceStartedAt) * 10) / 10,
              fileCount: droppedFiles.length,
              operationId: performanceOperationId,
              stage,
            },
          })
        recordPerformanceStage("input")
        const operationScope = resourceMutationScopeRef.current
        const mutationStartDocument = canonicalDocumentRef.current
        const optimisticPreviewUrls = optimisticFiles.map((file) => {
          if (typeof URL.createObjectURL !== "function") return null
          try {
            return URL.createObjectURL(file)
          } catch {
            return null
          }
        })
        let optimisticToken: symbol | undefined
        let optimisticSettled = false
        let optimisticHandoffScheduled = false
        let optimisticFocusStarted = false
        let optimisticFocusInterrupted = false
        let optimisticFocusPromise: Promise<void> | undefined
        let optimisticGhosts: readonly CanvasGhostNode[] = []
        const revokeOptimisticPreviews = () => {
          for (const url of optimisticPreviewUrls) if (url) revokeCanvasLocalResourcePreviewUrl(url)
        }
        const settleOptimistic = () => {
          if (optimisticSettled) return
          optimisticSettled = true
          if (optimisticToken) optimisticOverlay.settle(optimisticToken)
          revokeOptimisticPreviews()
        }
        const scheduleOptimisticHandoff = (createdNodeIds: readonly string[]) => {
          if (!optimisticToken || optimisticSettled || optimisticHandoffScheduled) return
          optimisticHandoffScheduled = true
          scheduleCanvasOptimisticResourceHandoffAfterPaint({
            isAuthorityReady: () =>
              isCanvasAuthoritativeResourceReadyForOptimisticHandoff({
                document: documentRef.current,
                focusVisible: options.focusCreatedNodes === true || options.showSelectionImmediately === true,
                nodeIds: createdNodeIds,
                resolveNode: projectionStore.resolveNode?.bind(projectionStore),
                root: rootRef.current,
              }),
            onReady: () => {
              recordPerformanceStage("authority-painted")
              settleOptimistic()
            },
          })
        }
        const interruptOptimisticFocus = () => {
          if (!isLatestPresentation() || !optimisticFocusStarted || optimisticFocusInterrupted) return
          optimisticFocusInterrupted = true
          if (revealGuard && isCanvasPostMutationRevealGuardCurrent(revealGuard, getPostMutationRevealGuard())) {
            interruptCameraMotion()
          }
        }
        try {
          // Freeze one request and publish its base presentation before invoking
          // Main, so even a synchronous authority delivery cannot race in front
          // of the first ghost paint.
          const mutationInput = {
            ...input,
            ...(options.parentGroupId ? { parentId: options.parentGroupId } : {}),
            signal: controller.signal,
          }
          let presentationPreparation: ReturnType<NonNullable<typeof mutationService.preparePresentation>> = []
          try {
            presentationPreparation = mutationService.preparePresentation?.(mutationInput) ?? []
          } catch {
            presentationPreparation = []
          }
          const immediatePresentations = Array.isArray(presentationPreparation) ? presentationPreparation : []
          const preparedPresentationsPromise = Promise.resolve(presentationPreparation).catch(() => [])
          const emptyGhosts = emptyLocalCreate
            ? createOptimisticEmptyNodeGhosts({
                anchor: input.anchor,
                ...(input.anchorOrigin === undefined ? {} : { anchorOrigin: input.anchorOrigin }),
                document: mutationStartDocument,
                kind: input.pending?.kind ?? "text",
                ...(options.parentGroupId ? { parentPresentationKey: options.parentGroupId } : {}),
                ...(options.resolvedOptimisticPositions
                  ? { resolvedPositions: options.resolvedOptimisticPositions }
                  : {}),
              })
            : []
          const baseAlignedGhosts = emptyLocalCreate
            ? []
            : createOptimisticAlignedResourceGhosts({
                anchor: input.anchor,
                ...(input.anchorOrigin === undefined ? {} : { anchorOrigin: input.anchorOrigin }),
                document: mutationStartDocument,
                files: optimisticFiles,
                presentations: immediatePresentations,
                previewUrls: optimisticPreviewUrls,
                sources: input.sources,
                ...(options.parentGroupId ? { parentPresentationKey: options.parentGroupId } : {}),
                ...(options.resolvedOptimisticPositions
                  ? { resolvedPositions: options.resolvedOptimisticPositions }
                  : {}),
              })
          optimisticGhosts = [...emptyGhosts, ...baseAlignedGhosts].map((ghost) =>
            options.focusCreatedNodes || options.showSelectionImmediately
              ? Object.freeze({ ...ghost, focusVisible: true as const })
              : ghost,
          )
          const optimisticEdges =
            input.relation?.mode === "connect"
              ? optimisticGhosts.flatMap((ghost) =>
                  input.relation!.anchorNodeIds.map((anchorNodeId) =>
                    input.relation!.direction === "to-anchor"
                      ? createCanvasConnectionGhost(ghost.presentationKey, anchorNodeId)
                      : createCanvasConnectionGhost(anchorNodeId, ghost.presentationKey),
                  ),
                )
              : []
          const optimisticOperation =
            optimisticGhosts.length > 0
              ? optimisticOverlay.begin(optimisticResourceScopeKey, [...optimisticGhosts, ...optimisticEdges])
              : undefined
          optimisticToken = optimisticOperation?.token
          recordPerformanceStage("optimistic-presented")
          optimisticFocusStarted = Boolean(
            isLatestPresentation() &&
              options.focusCreatedNodes &&
              !options.parentGroupId &&
              revealGuard &&
              optimisticOperation?.status === "shown" &&
              optimisticGhosts.length > 0,
          )
          if (optimisticFocusStarted) {
            optimisticFocusPromise = focusOptimisticCanvasGhosts(optimisticGhosts, revealGuard!).then(
              () => undefined,
              () => undefined,
            )
          }
          // Durable preparation and renderer-only intrinsic probing now run in
          // parallel; neither waits for the other.
          let authorityDelivered = false
          const mutationPromise = mutationService.add(mutationInput)
          void mutationPromise.then(
            () => {
              authorityDelivered = true
            },
            () => {
              authorityDelivered = true
            },
          )
          void mutationPromise.catch(() => undefined)
          if (
            optimisticToken &&
            baseAlignedGhosts.length > 0 &&
            (optimisticFiles.length > 0 || !Array.isArray(presentationPreparation))
          ) {
            void Promise.all([
              optimisticFiles.length > 0
                ? inspectDroppedCanvasResourcePresentations(optimisticFiles, controller.signal)
                : Promise.resolve([]),
              preparedPresentationsPromise,
            ])
              .then(([intrinsicSizes, preparedPresentations]) => {
                recordPerformanceStage("presentation-probed")
                if (
                  authorityDelivered ||
                  controller.signal.aborted ||
                  canonicalDocumentRef.current !== mutationStartDocument ||
                  !isLatestPresentation() ||
                  optimisticSettled ||
                  !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, operationScope)
                ) {
                  return
                }
                let presentationKeyIndex = 0
                const refinedAlignedGhosts = createOptimisticAlignedResourceGhosts({
                  anchor: input.anchor,
                  ...(input.anchorOrigin === undefined ? {} : { anchorOrigin: input.anchorOrigin }),
                  createPresentationKey: () => baseAlignedGhosts[presentationKeyIndex++]!.presentationKey,
                  document: mutationStartDocument,
                  files: optimisticFiles,
                  intrinsicSizes,
                  presentations: preparedPresentations.slice(0, baseAlignedGhosts.length),
                  previewUrls: optimisticPreviewUrls,
                  sources: input.sources,
                  ...(options.parentGroupId ? { parentPresentationKey: options.parentGroupId } : {}),
                  ...(options.resolvedOptimisticPositions
                    ? { resolvedPositions: options.resolvedOptimisticPositions }
                    : {}),
                })
                if (refinedAlignedGhosts.length !== baseAlignedGhosts.length) return
                const refinedGhosts = refinedAlignedGhosts.map((ghost) =>
                  options.focusCreatedNodes || options.showSelectionImmediately
                    ? Object.freeze({ ...ghost, focusVisible: true as const })
                    : ghost,
                )
                if (!optimisticOverlay.replace(optimisticToken!, [...refinedGhosts, ...optimisticEdges])) return
                optimisticGhosts = refinedGhosts
                if (isLatestPresentation() && optimisticFocusStarted) {
                  optimisticFocusPromise = focusOptimisticCanvasGhosts(refinedGhosts, revealGuard!).then(
                    () => undefined,
                    () => undefined,
                  )
                }
              })
              .catch(() => undefined)
          }
          if (optimisticOperation?.status === "bounded") {
            notificationService?.show({ kind: "info", title: "Saving Canvas changes…" })
          }
          const result = await mutationPromise
          recordPerformanceStage("authority-delivered")
          await completeCanvasResourceMutation({
            afterReload: (createdNodeIds) => {
              installPreparedResourceStates(result.preparedResources, result.createdNodeIds)
              if (
                !projectionStore.subscribeProjectionChanges &&
                createdNodeIds.length === optimisticGhosts.length
              ) {
                const obstacles: CanvasIndexedPlacementObstacle[] = createdNodeIds.map((nodeId, index) => ({
                  key: nodeId,
                  ...optimisticGhosts[index]!.position,
                  ...optimisticGhosts[index]!.size,
                }))
                installCanvasDocumentPlacementAppend({
                  base: mutationStartDocument,
                  next: projectionStore.getProjection(),
                  obstacles,
                  parentId: options.parentGroupId ?? undefined,
                })
              }
              scheduleOptimisticHandoff(createdNodeIds)
            },
            cancelPreparedNodes: cancelNodeEntries,
            currentScope: () => resourceMutationScopeRef.current,
            operationScope,
            prepareCreatedNodes:
              optimisticFocusStarted ||
              optimisticFiles.length > 0 ||
              baseAlignedGhosts.length > 0 ||
              options.showSelectionImmediately
                ? adoptOptimisticallyPresentedNodeEntries
                : options.focusCreatedNodes
                  ? prepareFocusedNodeEntries
                  : presentNodeEntries,
            reload: reloadAuthoritativeDocument,
            result,
            runViewEffect: revealGuard
              ? async (createdNodeIds) => {
                  if (!isLatestPresentation()) {
                    cancelNodeEntries(createdNodeIds)
                    return
                  }
                  if (options.parentGroupId) {
                    if (
                      focusedGroupIdRef.current === options.parentGroupId &&
                      isCanvasPostMutationRevealGuardCurrent(revealGuard, getPostMutationRevealGuard())
                    ) {
                      startNodeEntryPresentation(createdNodeIds)
                      await reactFlowRef.current.fitView({
                        duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.fit, prefersReducedMotion),
                        ease: canvasViewportEase,
                        interpolate: "smooth",
                        maxZoom: CANVAS_CENTER_FIT_MAX_ZOOM,
                        nodes: createdNodeIds.map((id) => ({ id })),
                        padding: CANVAS_CENTER_FIT_PADDING,
                      })
                    }
                    return
                  }
                  if (options.focusCreatedNodes) {
                    scheduleOptimisticHandoff(createdNodeIds)
                    if (
                      optimisticFocusStarted &&
                      canvasAuthorityMatchesOptimisticResourceBounds(
                        optimisticGhosts,
                        createdNodeIds,
                        documentRef.current,
                        projectionStore.resolveNode?.bind(projectionStore),
                      )
                    ) {
                      await optimisticFocusPromise
                      return
                    }
                    // A stale/concurrent authoritative placement is the only
                    // case that needs a corrective second camera target.
                    interruptOptimisticFocus()
                    try {
                      const focused = await focusCanvasNodes(createdNodeIds, revealGuard, {
                        presentEntry: !optimisticFocusStarted,
                      })
                      if (!focused) cancelNodeEntries(createdNodeIds)
                    } catch (error) {
                      cancelNodeEntries(createdNodeIds)
                      throw error
                    }
                  } else await revealCanvasNodesAfterMutation(createdNodeIds, revealGuard)
                }
              : undefined,
            selectNodes: (createdNodeIds) => {
              if (!isLatestPresentation()) return
              if (!options.parentGroupId || focusedGroupIdRef.current === options.parentGroupId) {
                selectNodes(createdNodeIds)
              }
            },
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
          interruptOptimisticFocus()
          if (!optimisticHandoffScheduled) settleOptimistic()
          operationControllersRef.current.delete(controller)
          recordPerformanceStage("complete")
        }
      })()
    },
    [
      cancelNodeEntries,
      adoptOptimisticallyPresentedNodeEntries,
      dispatch,
      getPostMutationRevealGuard,
      focusCanvasNodes,
      focusOptimisticCanvasGhosts,
      interruptCameraMotion,
      installPreparedResourceStates,
      mutationService,
      notificationService,
      notifyError,
      presentNodeEntries,
      prepareFocusedNodeEntries,
      prefersReducedMotion,
      readOnly,
      reloadAuthoritativeDocument,
      revealCanvasNodesAfterMutation,
      selectNodes,
      startNodeEntryPresentation,
      optimisticResourceScopeKey,
      optimisticOverlay,
      projectionStore,
      telemetryService,
    ],
  )
  const runResourceRelink = useCallback(
    async (
      operation: (input: { signal: AbortSignal }) => Promise<{
        authoritativeProjectionDelivered?: boolean
        warnings: readonly string[]
      }>,
      successTitle: string,
      localPreview?: { file: File; kind: string | null; nodeId: string },
    ) => {
      if (readOnly) return
      const controller = new AbortController()
      operationControllersRef.current.add(controller)
      const localPreviewPromise = localPreview
        ? beginLocalResourcePreview(localPreview.nodeId, localPreview.file, localPreview.kind, controller.signal)
        : Promise.resolve(undefined)
      const operationScope = resourceMutationScopeRef.current
      let committed = false
      let localPreviewToken: symbol | undefined
      try {
        const operationPromise = operation({ signal: controller.signal })
        const [previewToken, result] = await Promise.all([localPreviewPromise, operationPromise])
        localPreviewToken = previewToken
        committed = true
        if (localPreviewToken && localPreview) {
          completeLocalResourcePreview(localPreview.nodeId, localPreviewToken)
        }
        if (
          controller.signal.aborted ||
          !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, operationScope)
        )
          return
        if (!result.authoritativeProjectionDelivered) {
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
        }
        if (
          controller.signal.aborted ||
          !isCanvasResourceMutationScopeCurrent(() => resourceMutationScopeRef.current, operationScope)
        )
          return
        if (result.warnings.length) {
          notificationService?.show({
            description: result.warnings.join("\n"),
            kind: "warning",
            title: `${successTitle} with warnings`,
          })
        }
      } catch (error) {
        handleCanvasResourceMutationFailure({
          currentScope: () => resourceMutationScopeRef.current,
          error,
          notifyError,
          operationScope,
          signal: controller.signal,
          title: "Could not relink resource",
        })
        controller.abort(error)
        localPreviewToken ??= await localPreviewPromise.catch(() => undefined)
      } finally {
        if (!committed && localPreviewToken && localPreview) {
          cancelLocalResourcePreview(localPreview.nodeId, localPreviewToken)
        }
        operationControllersRef.current.delete(controller)
      }
    },
    [
      beginLocalResourcePreview,
      cancelLocalResourcePreview,
      completeLocalResourcePreview,
      notificationService,
      notifyError,
      readOnly,
      reloadDocument,
    ],
  )
  const requestResourceRelink = useCallback(
    (nodeId: string) => {
      if (!mutationService?.relink || readOnly) return
      const node = resolveCurrentNode(nodeId)
      const kind = typeof node?.data.kind === "string" ? node.data.kind : null
      const input = relinkInputRef.current
      if (!input || !canPickLocalCanvasRelinkFile(kind)) return
      applyCanvasFilePickerAccept(input, kind)
      relinkNodeIdRef.current = nodeId
      relinkKindRef.current = kind
      input.click()
    },
    [mutationService, readOnly, resolveCurrentNode],
  )
  const requestSelectedResourceRelink = useCallback(
    (nodeId: string) => {
      if (!mutationService?.relink || readOnly) return
      void runResourceRelink(({ signal }) => mutationService.relink!({ nodeId, signal }), "Resource relinked")
    },
    [mutationService, readOnly, runResourceRelink],
  )
  const saveEditableCopy = useCallback(
    (nodeId: string) => {
      if (!mutationService?.saveEditableCopy || readOnly) return Promise.resolve()
      return runResourceRelink(
        ({ signal }) => mutationService.saveEditableCopy!({ nodeId, signal }),
        "Editable copy saved",
      )
    },
    [mutationService, readOnly, runResourceRelink],
  )
  const addTextResource = useCallback(
    (position?: CanvasPoint, relation?: CanvasResourceMutationRequest["relation"], focusAfterCreate = false) => {
      const anchor = position
        ? resolveIndexedInsertPoint(position, { height: 180, width: 320 })
        : focusAfterCreate
          ? nextViewportInsertPoint({ height: 180, width: 320 })
          : nextInsertPoint(0, { height: 180, width: 320 })
      runResourceMutation(
        {
          anchor,
          files: [],
          relation,
          sources: [{ kind: "new-text", sourceId: createCanvasId("source"), text: "" }],
        },
        {
          ...(focusAfterCreate ? { focusCreatedNodes: true } : {}),
          parentGroupId: groupFocus.focusedGroupId,
          resolvedOptimisticPositions: [anchor],
        },
      )
      setNodeMenuOpen(false)
      setInsertPoint(null)
      telemetryService?.track({ name: "canvas.node.added", properties: { type: "text" } })
    },
    [
      groupFocus.focusedGroupId,
      nextInsertPoint,
      nextViewportInsertPoint,
      resolveIndexedInsertPoint,
      runResourceMutation,
      telemetryService,
    ],
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
    (type: string, position?: CanvasPoint, focusAfterCreate = false) => {
      if (readOnly || leavingRef.current || hydratingRef.current || saveErrorRef.current) return undefined
      if (type === "text") {
        addTextResource(position, undefined, focusAfterCreate)
        return undefined
      }
      if (type === "image" || type === "video") {
        runResourceMutation(
          {
            anchor: position ?? (focusAfterCreate ? nextViewportInsertPoint() : nextInsertPoint()),
            files: [],
            pending: { kind: type, label: type === "image" ? "Image" : "Video" },
            sources: [],
          },
          {
            ...(focusAfterCreate ? { focusCreatedNodes: true } : {}),
            parentGroupId: groupFocus.focusedGroupId,
          },
        )
        setNodeMenuOpen(false)
        setInsertPoint(null)
        telemetryService?.track({ name: "canvas.node.added", properties: { type } })
        return undefined
      }
      const createdAt = position ?? insertPoint ?? pointAtCenter()
      const provisional = createNodeForType(type, createdAt)
      if (!provisional) return undefined
      const size = getCanvasNodePresentationSize(provisional)
      const preferredPosition = focusAfterCreate && position === undefined ? nextViewportInsertPoint(size) : createdAt
      const created = { ...provisional, position: preferredPosition }
      const parentId = groupFocus.focusedGroupId ?? undefined
      const node = {
        ...created,
        extent: parentId ? ("parent" as const) : created.extent,
        parentId,
        position:
          parentId || (focusAfterCreate && position === undefined)
            ? preferredPosition
            : findOpenCanvasPoint(history.document, preferredPosition, getCanvasNodePresentationSize(created)),
      }
      const result = addCanvasNodes(history.document, [node])
      if (focusAfterCreate) prepareFocusedNodeEntries([node.id])
      else presentNodeEntries([node.id])
      rejectUnmappedCanvasMutation()
      selectNodes(result.selectedNodeIds)
      if (focusAfterCreate && !parentId) {
        setPendingNodeFocus({ guard: getPostMutationRevealGuard(), nodeIds: [node.id] })
      } else if (focusAfterCreate && parentId) {
        window.requestAnimationFrame(() => {
          void reactFlowRef.current.fitView({
            duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.fit, prefersReducedMotion),
            ease: canvasViewportEase,
            interpolate: "smooth",
            maxZoom: CANVAS_CENTER_FIT_MAX_ZOOM,
            nodes: [{ id: node.id }],
            padding: CANVAS_CENTER_FIT_PADDING,
          })
        })
      }
      setNodeMenuOpen(false)
      setInsertPoint(null)
      telemetryService?.track({ name: "canvas.node.added", properties: { type } })
      return node.id
    },
    [
      addTextResource,
      createNodeForType,
      history.document,
      getPostMutationRevealGuard,
      groupFocus.focusedGroupId,
      insertPoint,
      nextViewportInsertPoint,
      nextInsertPoint,
      pointAtCenter,
      presentNodeEntries,
      prepareFocusedNodeEntries,
      prefersReducedMotion,
      readOnly,
      rejectUnmappedCanvasMutation,
      runResourceMutation,
      selectNodes,
      telemetryService,
    ],
  )
  useImperativeHandle(
    props.editorRef,
    () => ({
      canRunShortcut(command) {
        return shortcutCanRunRef.current(command)
      },
      async flush() {
        await waitForStableLoad()
        return startSave(historyRef.current.document)
      },
      insertNode(type) {
        return addNode(type)
      },
      invalidateResources(nodeIds) {
        return resourceRefreshController?.invalidateResources(nodeIds) ?? Promise.resolve()
      },
      invalidateResourcesAtHierarchyKey(key) {
        return invalidateResourcesAtHierarchyKey(key)
      },
      openGenerate() {
        requestGenerate()
      },
      openSearch() {
        setSearchOpen(true)
      },
      async prepareToLeave(options = {}) {
        const waitForPendingDrafts = options.waitForPendingDrafts ?? true
        leavingRef.current = true
        setLeaving(true)
        const reportBackgroundSaveError = () =>
          notificationService?.show({
            description: "Your draft was kept and will be retried when you return to this Canvas.",
            kind: "error",
            title: "Could not save text draft",
          })
        const reportBackgroundFlushError = () =>
          notificationService?.show({
            description: "The durable Canvas state remains authoritative and can be refreshed when you return.",
            kind: "warning",
            title: "Could not finish Canvas synchronization",
          })
        if (waitForPendingDrafts) {
          await waitForStableLoad()
          const results = await Promise.allSettled([
            pendingDraftsRef.current.savePending({ wait: true }),
            textDraftStore?.flush({ wait: true }) ?? Promise.resolve(),
          ])
          const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
          if (failure) throw failure.reason
        } else {
          void pendingDraftsRef.current.savePending({ wait: false })
          void textDraftStore?.flush({ onError: reportBackgroundSaveError, wait: false })
        }
        abortPendingOperations()
        if (waitForPendingDrafts) await finalizeGestureAndSave()
        else void finalizeGestureAndSave().catch(reportBackgroundFlushError)
        return true
      },
      async reload() {
        await reloadDocument()
      },
      async reloadAuthoritative() {
        await reloadAuthoritativeDocument()
      },
      runShortcut(command) {
        return shortcutRunRef.current(command)
      },
      resumeAfterLeaveCanceled() {
        leavingRef.current = false
        setLeaving(false)
      },
      selectNodes(nodeIds) {
        selectNodes(nodeIds)
      },
      setExternalDragShortcutHeld(held) {
        if (held) return selectionDragModeActiveRef.current ? false : armSelectionDrag()
        return selectionDragModeActiveRef.current ? false : cancelSelectionDrag()
      },
      setSpacePanningShortcutHeld(held) {
        if (spacePanningRef.current === held) return false
        spacePanningRef.current = held
        setSpacePanning(held)
        return true
      },
      submitGeneration(submission) {
        submitGenerationRef.current(submission)
      },
    }),
    [
      abortPendingOperations,
      addNode,
      armSelectionDrag,
      cancelSelectionDrag,
      finalizeGestureAndSave,
      notificationService,
      props.editorRef,
      reloadDocument,
      reloadAuthoritativeDocument,
      resourceRefreshController,
      selectNodes,
      requestGenerate,
      startSave,
      textDraftStore,
      waitForStableLoad,
    ],
  )
  const duplicate = useCallback(() => {
    if (!hasNodeOnlySelection || !props.executeCommand) {
      rejectUnmappedCanvasMutation()
      return
    }
    const reportFailure = (error: unknown) => notifyError("Could not duplicate Canvas nodes", error)
    const optimisticOperation = optimisticOverlay.begin(
      optimisticResourceScopeKey,
      createCanvasDuplicateOverlay({ document: readCurrentBulkDocument(), nodeIds: selectedNodeIds }),
    )
    try {
      void props
        .executeCommand({ type: "nodes.duplicate", nodeIds: selectedNodeIds })
        .then((result) => {
          presentNodeEntries(result.createdNodeIds)
          selectNodes(result.createdNodeIds)
        }, reportFailure)
        .finally(() => optimisticOverlay.settle(optimisticOperation.token))
    } catch (error) {
      optimisticOverlay.settle(optimisticOperation.token)
      reportFailure(error)
    }
  }, [
    hasNodeOnlySelection,
    notifyError,
    optimisticOverlay,
    optimisticResourceScopeKey,
    presentNodeEntries,
    props.executeCommand,
    readCurrentBulkDocument,
    rejectUnmappedCanvasMutation,
    selectedNodeIds,
    selectNodes,
  ])
  const createCommandPresentationOverlay = useCallback(
    (command: CanvasApplicationCommand) => {
      const replacements: ReturnType<typeof createCanvasReplacePresentationOverlay>[] = []
      const add = (
        nodeId: string,
        update: { position?: CanvasPoint; size?: { height: number; width: number }; title?: string },
      ) => {
        const entity = projectionStore.resolveNodeEntity(nodeId)
        if (!entity) return
        replacements.push(
          createCanvasReplacePresentationOverlay({
            entity: { entityId: entity.id, incarnation: entity.incarnation, kind: "node" },
            ...update,
          }),
        )
      }
      if (command.type === "nodes.setTitle") add(command.nodeId, { title: command.title.trim().slice(0, 200) })
      if (command.type === "nodes.move") {
        for (const nodeId of command.nodeIds) {
          const node = resolveCurrentNode(nodeId)
          if (node)
            add(nodeId, { position: { x: node.position.x + command.delta.x, y: node.position.y + command.delta.y } })
        }
      }
      if (command.type === "nodes.setGeometry") {
        for (const update of command.updates) {
          add(update.nodeId, {
            position: update.position,
            ...(update.size ? { size: update.size } : {}),
          })
        }
      }
      const pendingNodeIds =
        command.type === "canvas.auto-layout"
          ? (command.nodeIds ?? readCurrentBulkDocument().nodes.map((node) => node.id))
          : command.type === "nodes.align" ||
              command.type === "nodes.distribute" ||
              command.type === "nodes.layout" ||
              command.type === "nodes.reparent"
            ? command.nodeIds
            : command.type === "nodes.setFolded" || command.type === "nodes.ungroup"
              ? [command.nodeId]
              : command.type === "nodes.group"
                ? command.nodeIds
                : []
      if (replacements.length === 0) {
        for (const nodeId of pendingNodeIds) {
          const node = resolveCurrentNode(nodeId)
          if (!node) continue
          add(nodeId, {
            position: node.position,
            size: getCanvasNodePresentationSize(node),
            title: node.data.label,
          })
        }
      }
      return replacements
    },
    [projectionStore, readCurrentBulkDocument, resolveCurrentNode],
  )
  const executeControllerCommand = useCallback(
    (command: CanvasApplicationCommand) => {
      if (!props.executeCommand) {
        rejectUnmappedCanvasMutation()
        return
      }
      const overlays = createCommandPresentationOverlay(command)
      const operation = overlays.length > 0 ? optimisticOverlay.begin(optimisticResourceScopeKey, overlays) : undefined
      try {
        void props.executeCommand(command).then(
          () => {
            if (operation) optimisticOverlay.settle(operation.token)
          },
          (error) => {
            if (operation) optimisticOverlay.settle(operation.token)
            notifyError("Could not update Canvas node", error)
          },
        )
      } catch (error) {
        if (operation) optimisticOverlay.settle(operation.token)
        notifyError("Could not update Canvas node", error)
      }
    },
    [
      createCommandPresentationOverlay,
      notifyError,
      optimisticOverlay,
      optimisticResourceScopeKey,
      props.executeCommand,
      rejectUnmappedCanvasMutation,
    ],
  )
  const duplicateNode = useCallback(
    (nodeId: string) => {
      if (!props.executeCommand) {
        rejectUnmappedCanvasMutation()
        return
      }
      const reportFailure = (error: unknown) => notifyError("Could not duplicate Canvas node", error)
      const optimisticOperation = optimisticOverlay.begin(
        optimisticResourceScopeKey,
        createCanvasDuplicateOverlay({ document: readCurrentBulkDocument(), nodeIds: [nodeId] }),
      )
      try {
        void props
          .executeCommand({ type: "nodes.duplicate", nodeIds: [nodeId] })
          .then((result) => {
            presentNodeEntries(result.createdNodeIds)
            selectNodes(result.createdNodeIds)
          }, reportFailure)
          .finally(() => optimisticOverlay.settle(optimisticOperation.token))
      } catch (error) {
        optimisticOverlay.settle(optimisticOperation.token)
        reportFailure(error)
      }
    },
    [
      notifyError,
      optimisticOverlay,
      optimisticResourceScopeKey,
      presentNodeEntries,
      props.executeCommand,
      readCurrentBulkDocument,
      rejectUnmappedCanvasMutation,
      selectNodes,
    ],
  )
  const quickConnect = useCallback(
    (nodeId: string, side: "left" | "right", nodeType: string, targetPosition?: CanvasPoint) => {
      if (readOnly) return
      const focusAfterCreate = targetPosition !== undefined
      if (nodeType === "text" || nodeType === "image" || nodeType === "video") {
        const anchor = resolveCurrentNode(nodeId)
        if (!anchor) return
        const anchorSize = getCanvasNodePresentationSize(anchor)
        const anchorDocument = createCanvasKeyedNodeDocument(documentRef.current, [anchor.id], resolveCurrentNode)
        const parentPosition =
          anchor.parentId && anchor.parentId !== groupFocus.focusedGroupId
            ? getNodeWorldPosition(anchorDocument, anchor.parentId)
            : { x: 0, y: 0 }
        const anchorWorld = {
          x: anchor.position.x + parentPosition.x,
          y: anchor.position.y + parentPosition.y,
        }
        const position = targetPosition ?? {
          x: side === "right" ? anchorWorld.x + anchorSize.width + 160 : anchorWorld.x - 480,
          y: anchorWorld.y,
        }
        const relation = {
          anchorNodeIds: [nodeId],
          direction: side === "right" ? ("from-anchor" as const) : ("to-anchor" as const),
          mode: "connect" as const,
        }
        if (nodeType === "text") addTextResource(position, relation, focusAfterCreate)
        else {
          runResourceMutation(
            {
              anchor: position,
              files: [],
              pending: { kind: nodeType, label: nodeType === "image" ? "Image" : "Video" },
              relation,
              sources: [],
            },
            {
              ...(focusAfterCreate ? { focusCreatedNodes: true } : {}),
              parentGroupId: groupFocus.focusedGroupId,
            },
          )
          telemetryService?.track({ name: "canvas.node.connected", properties: { side, type: nodeType } })
        }
        return
      }
      const anchor = resolveCurrentNode(nodeId)
      if (!anchor) return
      const created = createNodeForType(nodeType, targetPosition ?? { x: 0, y: 0 })
      if (!created) return
      if (focusAfterCreate) prepareFocusedNodeEntries([created.id])
      else presentNodeEntries([created.id])
      commit((document) => {
        const anchor = document.nodes.find((node) => node.id === nodeId)
        if (!anchor) return document
        const anchorSize = getCanvasNodePresentationSize(anchor)
        const createdSize = getCanvasNodePresentationSize(created)
        const parentPosition =
          anchor.parentId && anchor.parentId !== groupFocus.focusedGroupId
            ? getNodeWorldPosition(document, anchor.parentId)
            : { x: 0, y: 0 }
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
      if (focusAfterCreate && !anchor.parentId) {
        setPendingNodeFocus({ guard: getPostMutationRevealGuard(), nodeIds: [created.id] })
      } else if (focusAfterCreate && anchor.parentId) {
        window.requestAnimationFrame(() => {
          startNodeEntryPresentation([created.id])
          void reactFlowRef.current.fitView({
            duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.fit, prefersReducedMotion),
            ease: canvasViewportEase,
            interpolate: "smooth",
            maxZoom: CANVAS_CENTER_FIT_MAX_ZOOM,
            nodes: [{ id: created.id }],
            padding: CANVAS_CENTER_FIT_PADDING,
          })
        })
      }
      telemetryService?.track({ name: "canvas.node.connected", properties: { side, type: nodeType } })
    },
    [
      addTextResource,
      commit,
      createNodeForType,
      getPostMutationRevealGuard,
      groupFocus.focusedGroupId,
      presentNodeEntries,
      prepareFocusedNodeEntries,
      prefersReducedMotion,
      readOnly,
      resolveCurrentNode,
      runResourceMutation,
      selectNodes,
      startNodeEntryPresentation,
      telemetryService,
    ],
  )
  const removeElements = useCallback(
    (nodeIds: readonly string[], edgeIds?: readonly string[]) => {
      if (!props.executeCommand) {
        commit((document) => removeCanvasElements(document, { nodeIds, edgeIds }))
        return
      }
      const entities = nodeIds.flatMap((nodeId) => {
        const entity = projectionStore.resolveNodeEntity(nodeId)
        return entity ? [entity] : []
      })
      const overlays = entities.map((entity) =>
        createCanvasHideEntityOverlay({
          entityId: entity.id,
          incarnation: entity.incarnation,
          kind: "node",
        }),
      )
      const operation = overlays.length > 0 ? optimisticOverlay.begin(optimisticResourceScopeKey, overlays) : undefined
      void props.executeCommand({ type: "elements.remove", nodeIds, edgeIds }).then(
        () => {
          if (operation) optimisticOverlay.settle(operation.token)
        },
        (error) => {
          if (operation) optimisticOverlay.settle(operation.token)
          notifyError("Could not delete Canvas elements", error)
        },
      )
    },
    [commit, notifyError, optimisticOverlay, optimisticResourceScopeKey, projectionStore, props.executeCommand],
  )
  const remove = useCallback(() => {
    removeElements(selectedNodeIds, selectedEdgeIds)
    updateSelection([])
  }, [removeElements, selectedEdgeIds, selectedNodeIds, updateSelection])
  const removeNode = useCallback(
    (nodeId: string) => {
      removeElements([nodeId])
      updateSelection([])
    },
    [removeElements, updateSelection],
  )
  const group = useCallback(() => {
    if (!groupMenuCapabilities.canGroup || selectionContext.kind !== "multi-node") return
    if (!props.executeCommand) {
      rejectUnmappedCanvasMutation()
      return
    }
    const reportFailure = (error: unknown) => notifyError("Could not group Canvas nodes", error)
    try {
      void props.executeCommand({ type: "nodes.group", nodeIds: selectedNodeIds }).then((result) => {
        presentNodeEntries(result.createdNodeIds)
        selectNodes(result.createdNodeIds)
      }, reportFailure)
    } catch (error) {
      reportFailure(error)
    }
  }, [
    groupMenuCapabilities.canGroup,
    notifyError,
    presentNodeEntries,
    props.executeCommand,
    rejectUnmappedCanvasMutation,
    selectedNodeIds,
    selectNodes,
    selectionContext.kind,
  ])
  const fold = useCallback(() => {
    if (selectionContext.kind === "multi-node") {
      if (!groupMenuCapabilities.canFold) return
      if (!props.executeCommand) return rejectUnmappedCanvasMutation()
      void props.executeCommand({ type: "nodes.group", nodeIds: selectedNodeIds, folded: true }).then(
        (result) => {
          presentNodeEntries(result.createdNodeIds)
          selectNodes(result.createdNodeIds)
        },
        (error) => notifyError("Could not fold Canvas nodes", error),
      )
      return
    }
    if (!groupMenuCapabilities.canFold || selectionContext.kind !== "single-node") return
    if (!props.executeCommand) return rejectUnmappedCanvasMutation()
    void props
      .executeCommand({ type: "nodes.setFolded", nodeId: selectionContext.nodeId, folded: true })
      .catch((error) => notifyError("Could not fold Canvas group", error))
  }, [
    groupMenuCapabilities.canFold,
    notifyError,
    presentNodeEntries,
    props.executeCommand,
    rejectUnmappedCanvasMutation,
    selectedNodeIds,
    selectNodes,
    selectionContext,
  ])
  const unfold = useCallback(() => {
    if (!groupMenuCapabilities.canUnfold || selectionContext.kind !== "single-node") return
    if (!props.executeCommand) return rejectUnmappedCanvasMutation()
    void props
      .executeCommand({ type: "nodes.ungroup", nodeId: selectionContext.nodeId })
      .catch((error) => notifyError("Could not unfold Canvas folder", error))
  }, [
    groupMenuCapabilities.canUnfold,
    notifyError,
    props.executeCommand,
    rejectUnmappedCanvasMutation,
    selectionContext,
  ])
  const ungroup = useCallback(() => {
    if (!groupMenuCapabilities.canUngroup || selectionContext.kind !== "single-node") return
    const groupId = selectionContext.nodeId
    if (!groupId) return
    if (!props.executeCommand) {
      rejectUnmappedCanvasMutation()
      return
    }
    const selectedAfterCommit = ungroupCanvasNode(readCurrentBulkDocument(), groupId).selectedNodeIds
    const reportFailure = (error: unknown) => notifyError("Could not ungroup Canvas nodes", error)
    try {
      void props
        .executeCommand({ type: "nodes.ungroup", nodeId: groupId })
        .then(() => selectNodes(selectedAfterCommit), reportFailure)
    } catch (error) {
      reportFailure(error)
    }
  }, [
    groupMenuCapabilities.canUngroup,
    notifyError,
    props.executeCommand,
    rejectUnmappedCanvasMutation,
    readCurrentBulkDocument,
    selectNodes,
    selectionContext,
  ])
  const align = useCallback(
    (direction: CanvasAlign) => {
      if (!hasNodeOnlySelection || !canArrangeSelection) return
      if (!props.executeCommand) return rejectUnmappedCanvasMutation()
      const nodeIds = resolveCurrentArrangeNodeIds()
      if (nodeIds.length < 2) return
      executeControllerCommand({ type: "nodes.align", nodeIds, direction })
    },
    [
      canArrangeSelection,
      executeControllerCommand,
      hasNodeOnlySelection,
      props.executeCommand,
      rejectUnmappedCanvasMutation,
      resolveCurrentArrangeNodeIds,
    ],
  )
  const distribute = useCallback(
    (axis: CanvasDistribute) => {
      if (!hasNodeOnlySelection || !canDistributeSelection) return
      if (!props.executeCommand) return rejectUnmappedCanvasMutation()
      const nodeIds = resolveCurrentArrangeNodeIds()
      if (nodeIds.length < 3) return
      executeControllerCommand({ type: "nodes.distribute", nodeIds, axis })
    },
    [
      canDistributeSelection,
      executeControllerCommand,
      hasNodeOnlySelection,
      props.executeCommand,
      rejectUnmappedCanvasMutation,
      resolveCurrentArrangeNodeIds,
    ],
  )
  const layout = useCallback(
    (value: CanvasLayout = "grid") => {
      if (!hasNodeOnlySelection || !canArrangeSelection) return
      if (!props.executeCommand) return rejectUnmappedCanvasMutation()
      const nodeIds = resolveCurrentArrangeNodeIds()
      if (nodeIds.length < 2) return
      executeControllerCommand({ type: "nodes.layout", nodeIds, layout: value })
    },
    [
      canArrangeSelection,
      executeControllerCommand,
      hasNodeOnlySelection,
      props.executeCommand,
      rejectUnmappedCanvasMutation,
      resolveCurrentArrangeNodeIds,
    ],
  )
  const tidySelection = useCallback(() => {
    if (!canArrangeSelection) return
    if (!props.executeCommand) return rejectUnmappedCanvasMutation()
    const nodeIds = resolveCurrentArrangeNodeIds()
    if (nodeIds.length < 2) return
    executeControllerCommand({
      type: "canvas.auto-layout",
      nodeIds,
      options: { strategy: autoLayoutStrategy },
    })
  }, [
    autoLayoutStrategy,
    canArrangeSelection,
    executeControllerCommand,
    props.executeCommand,
    rejectUnmappedCanvasMutation,
    resolveCurrentArrangeNodeIds,
  ])
  const runCanvasLayout = useCallback(
    (strategy: CanvasDirectedAutoLayoutStrategy) => {
      if (!canLayoutCanvas || hydratingRef.current || leavingRef.current) return
      if (!props.executeCommand) return rejectUnmappedCanvasMutation()
      const currentDocument = readCurrentBulkDocument()
      const currentFocus = projectCanvasGroupFocus(currentDocument, focusedGroupIdRef.current)
      const currentScopeNodeIds = [...currentFocus.scopeNodeIds]
      const command: CanvasApplicationCommand = {
        ...(currentFocus.focusedGroupId ? { nodeIds: currentScopeNodeIds } : {}),
        options: { strategy },
        type: "canvas.auto-layout",
      }
      const overlays = createCommandPresentationOverlay(command)
      const operation = overlays.length > 0 ? optimisticOverlay.begin(optimisticResourceScopeKey, overlays) : undefined
      void props.executeCommand(command).then(
        (result) => {
          if (operation) optimisticOverlay.settle(operation.token)
          return fitDocumentViewport(result.document, {
            maxZoom: CANVAS_FIT_MAX_ZOOM,
            nodeIds: currentScopeNodeIds,
            padding: CANVAS_FIT_PADDING,
          })
        },
        (error) => {
          if (operation) optimisticOverlay.settle(operation.token)
          notifyError("Could not tidy Canvas", error)
        },
      )
    },
    [
      canLayoutCanvas,
      createCommandPresentationOverlay,
      fitDocumentViewport,
      notifyError,
      optimisticOverlay,
      optimisticResourceScopeKey,
      props.executeCommand,
      readCurrentBulkDocument,
      rejectUnmappedCanvasMutation,
    ],
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
    return createCanvasClipboardPayload(readCurrentBulkDocument(), selectedNodeIds, props.clipboardScope)
  }, [hasNodeOnlySelection, props.clipboardScope, readCurrentBulkDocument, selectedNodeIds])
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
      const sourceNodeIds = payload.nodes.map((node) => node.id)
      if (
        !props.executeCommand ||
        sourceNodeIds.length === 0 ||
        sourceNodeIds.some((nodeId) => !resolveCurrentNode(nodeId))
      ) {
        notificationService?.show({
          kind: "warning",
          title: "Canvas paste unavailable",
          description: "This selection no longer belongs to the current Canvas.",
        })
        return true
      }
      const duplicateOffset = offset && (offset.x !== 0 || offset.y !== 0) ? offset : { x: 32, y: 32 }
      const optimisticOperation = optimisticOverlay.begin(
        optimisticResourceScopeKey,
        createCanvasDuplicateOverlay({
          document: readCurrentBulkDocument(),
          nodeIds: sourceNodeIds,
          offset: duplicateOffset,
        }),
      )
      void props
        .executeCommand({
          type: "nodes.duplicate",
          nodeIds: sourceNodeIds,
          offset: duplicateOffset,
          edgeScope: "internal",
        })
        .then(
          (result) => {
            presentNodeEntries(result.createdNodeIds)
            selectNodes(result.createdNodeIds)
          },
          (error) => notifyError("Could not paste Canvas nodes", error),
        )
        .finally(() => optimisticOverlay.settle(optimisticOperation.token))
      return true
    },
    [
      insertPoint,
      notificationService,
      notifyError,
      optimisticOverlay,
      optimisticResourceScopeKey,
      presentNodeEntries,
      props.clipboardScope,
      props.executeCommand,
      readCurrentBulkDocument,
      resolveCurrentNode,
      selectNodes,
    ],
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
      anchorOrigin?: CanvasResourceMutationRequest["anchorOrigin"],
    ) => {
      if (!mutationService || (files.length === 0 && !transfer) || readOnly) return
      const anchor = position ?? pointerRef.current ?? pointAtCenter()
      runResourceMutation(
        { anchor, ...(anchorOrigin === undefined ? {} : { anchorOrigin }), files, sources: [], transfer },
        {
          focusCreatedNodes: position === undefined,
          parentGroupId: groupFocus.focusedGroupId,
          showSelectionImmediately: true,
        },
      )
    },
    [groupFocus.focusedGroupId, mutationService, pointAtCenter, readOnly, runResourceMutation],
  )
  const handleUploadInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = [...(event.currentTarget.files ?? [])]
      handleCanvasResourceUploadSelection(files, uploadFiles)
      event.currentTarget.value = ""
    },
    [uploadFiles],
  )
  const runGenerate = useCallback(
    (submission: CanvasGenerationComposerSubmission) => {
      if (!generateService || readOnly || generationControllerRef.current) return
      const currentDocument = documentRef.current
      if (
        !isCanvasGenerationComposerSubmissionCurrent(submission, {
          documentId: currentDocument.id,
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
      const revealGuard = getPostMutationRevealGuard()
      const anchor = insertPoint ?? pointerRef.current ?? pointAtCenter()
      const parentGroupId = groupFocus.focusedGroupId
      generationControllerRef.current = { controller, documentId }
      void (async () => {
        await startSave(document)
        if (controller.signal.aborted || documentRef.current.id !== documentId) return undefined
        return generateService.generate({
          anchor,
          context: { documentId, selectedNodeIds: submission.selectedNodeIds, source: "canvas" },
          output: submission.tool.output,
          ...(parentGroupId ? { parentId: parentGroupId } : {}),
          prompt: submission.prompt,
          resultMode: { type: "create-pending-node" },
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
          async (result) => {
            if (!result || controller.signal.aborted || documentRef.current.id !== documentId) return
            setGenerateOpen(false)
            let refreshed = false
            try {
              await reloadAuthoritativeDocument(controller.signal)
              refreshed = true
            } catch {
              if (!controller.signal.aborted) {
                notificationService?.show({
                  description: "Reload the Canvas to show the committed generation.",
                  kind: "warning",
                  title: "Generation completed, but refresh failed",
                })
              }
            }
            if (refreshed && !controller.signal.aborted && documentRef.current.id === documentId) {
              presentNodeEntries(result.createdNodeIds)
              if (!parentGroupId || focusedGroupIdRef.current === parentGroupId) {
                selectNodes(result.createdNodeIds)
                try {
                  if (
                    parentGroupId &&
                    isCanvasPostMutationRevealGuardCurrent(revealGuard, getPostMutationRevealGuard())
                  ) {
                    await reactFlowRef.current.fitView({
                      duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.fit, prefersReducedMotion),
                      ease: canvasViewportEase,
                      interpolate: "smooth",
                      maxZoom: CANVAS_CENTER_FIT_MAX_ZOOM,
                      nodes: result.createdNodeIds.map((id) => ({ id })),
                      padding: CANVAS_CENTER_FIT_PADDING,
                    })
                  } else {
                    await revealCanvasNodesAfterMutation(result.createdNodeIds, revealGuard)
                  }
                } catch {
                  // A post-commit camera effect is optional and cannot turn
                  // successful generation into a refresh or mutation failure.
                }
              }
            }
            if (controller.signal.aborted || documentRef.current.id !== documentId) return
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
      dispatch,
      generateService,
      getPostMutationRevealGuard,
      groupFocus.focusedGroupId,
      insertPoint,
      notificationService,
      notifyError,
      pointAtCenter,
      presentNodeEntries,
      prefersReducedMotion,
      props.onGenerationStateChange,
      props.viewScopeId,
      readOnly,
      reloadAuthoritativeDocument,
      revealCanvasNodesAfterMutation,
      selectNodes,
      startSave,
    ],
  )
  submitGenerationRef.current = runGenerate
  const exportCanvas = useCallback(() => {
    if (!exportService) return
    const controller = new AbortController()
    void exportService
      .export({ document: readCurrentBulkDocument(), format: "json", selectedNodeIds }, controller.signal)
      .then(undefined, (error) => notifyError("Export failed", error))
  }, [exportService, notifyError, readCurrentBulkDocument, selectedNodeIds])

  const clearOverlays = useCallback(() => {
    snapSessionRef.current = null
    setSnapLines([])
    updateSelection([])
    setPendingConnection(null)
    setNodeMenuOpen(false)
    setGenerateOpen(false)
    setSearchOpen(false)
  }, [updateSelection])
  const activateInteractionTool = useCallback(
    (tool: CanvasInteractionTool) => {
      connectionStartRef.current = null
      updateConnectionTargetNode(null)
      boxSelectionActiveRef.current = false
      boxSelectionBaselineRef.current = null
      setInteractionTool(tool)
      setPendingConnection(null)
      setNodeMenuOpen(false)
      setGenerateOpen(false)
      setSearchOpen(false)
      rootRef.current?.focus()
    },
    [updateConnectionTargetNode],
  )
  const selectAllCanvas = useCallback(() => {
    if (folderFocus) {
      selectNodes(folderFocusNodes.map((node) => node.id))
      return
    }
    const document = readCurrentBulkDocument()
    const currentFocus = projectCanvasGroupFocus(document, focusedGroupIdRef.current)
    selectNodes([...currentFocus.scopeNodeIds])
  }, [folderFocus, folderFocusNodes, readCurrentBulkDocument, selectNodes])
  const shortcutActions: CanvasShortcutActions = {
    addNode: () => setNodeMenuOpen(true),
    clearSelection: () => {
      if (folderFocus) {
        const parent = folderFocus.path.at(-2)
        if (parent) {
          void navigateFolderFocus(folderFocus.ownerNodeId, parent.id, {
            path: folderFocus.path.slice(0, -1),
          })
        } else {
          void leaveFolderFocus()
        }
        return
      }
      if (groupFocus.focusedGroupId) {
        void navigateGroupFocus(groupFocus.parentGroupId)
        return
      }
      clearOverlays()
    },
    delete: remove,
    duplicate,
    enterGroup:
      hasSingleGroupSelection && selectionContext.kind === "single-node"
        ? () => focusGroup(selectionContext.nodeId)
        : undefined,
    fitView: fitCanvas,
    generate: () => {
      requestGenerate()
    },
    group,
    hand: () => activateInteractionTool("hand"),
    layout: () =>
      resolveCanvasTidyShortcutScope(canArrangeSelection, selectedNodeIds.length) === "selection"
        ? tidySelection()
        : layoutCanvas(),
    openSearch: () => setSearchOpen(true),
    select: () => activateInteractionTool("select"),
    selectAll: selectAllCanvas,
    ungroup: () => {
      if (groupMenuCapabilities.canUnfold) unfold()
      else ungroup()
    },
    zoomIn: () => {
      markUserNavigation()
      void reactFlow.zoomIn({
        duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.stepZoom, prefersReducedMotion),
        ease: canvasViewportEase,
        interpolate: "smooth",
      })
    },
    zoomOut: () => {
      markUserNavigation()
      void reactFlow.zoomOut({
        duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.stepZoom, prefersReducedMotion),
        ease: canvasViewportEase,
        interpolate: "smooth",
      })
    },
  }
  shortcutCanRunRef.current = (command) => canRunCanvasShortcutCommand(command, shortcutActions, readOnly)
  shortcutRunRef.current = (command) => runCanvasShortcutCommand(command, shortcutActions, readOnly)
  const controller = useMemo(
    () => ({
      document: viewportProjection
        ? {
            ...history.document,
            edges: [...viewportProjection.edges],
            nodes: [...(viewportPresentationNodes ?? [])],
          }
        : history.document,
      scopeId: currentViewScopeId,
      enteringNodeIds,
      hydrating,
      locale: props.locale,
      reducedMotion: prefersReducedMotion,
      selection,
      selectionContext,
      readOnly,
      canUpload: Boolean(mutationService),
      canRelinkResource: mutationService !== undefined && typeof Reflect.get(mutationService, "relink") === "function",
      fileRenderers: props.fileRendererRegistry,
      connectionNodeTypes,
      quickConnectionNodeTypes,
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
      executeCommand: executeControllerCommand,
      finishNodeEntry,
      isSelectionActionPending,
      finishSelectionDrag,
      setSelectionDragCandidateNode,
      startSelectionDrag,
      quickConnect,
      relinkResource: requestResourceRelink,
      relinkSelectedResource: requestSelectedResourceRelink,
      reloadAuthoritative: reloadAuthoritativeDocument,
      replaceResourceState: (nodeId: string, state: CanvasResourceRuntimeState) =>
        setResourceStates((current) => {
          const node = resolveCurrentNode(nodeId)
          if (!node) return current
          return current.set(nodeId, {
            entity: projectionStore.resolveNodeEntity(nodeId),
            rendererId: canvasFileRendererIdentity(node, props.fileRendererRegistry),
            resourceIdentity: canvasCanonicalResourceIdentity(node),
            state,
          })
        }),
      registerPendingDraft: (draft: CanvasPendingDraft) => pendingDraftsRef.current.register(draft),
      removeNode,
      saveEditableCopy,
      selectNodes,
    }),
    [
      commit,
      connectionNodeTypes,
      quickConnectionNodeTypes,
      duplicateNode,
      executeControllerCommand,
      executeSelectionAction,
      enteringNodeIds,
      finishNodeEntry,
      history.document,
      hydrating,
      isSelectionActionPending,
      props.fileRendererRegistry,
      props.locale,
      currentViewScopeId,
      quickConnect,
      readOnly,
      finishSelectionDrag,
      requestResourceRelink,
      requestSelectedResourceRelink,
      reloadAuthoritativeDocument,
      resolveCurrentNode,
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
      prefersReducedMotion,
      projectionStore,
      visibleSelectionActions,
      visibleSelectionDragSource,
      viewportProjection,
      viewportPresentationNodes,
    ],
  )
  const groupPresentationController = useMemo(
    () => ({
      dropTargetId: groupDropTargetId,
      focus: focusGroup,
      focusedGroupId: groupFocus.focusedGroupId,
      summaries: groupFocus.summaries,
    }),
    [focusGroup, groupDropTargetId, groupFocus.focusedGroupId, groupFocus.summaries],
  )
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      const selectionChanges = changes.filter((change) => change.type === "select")
      if (canvasPointerSelectionEnabled && selectionChanges.length > 0 && !boxSelectionActiveRef.current) {
        replaceSelection(applyReactFlowEdgeSelectionChanges(selectionRef.current, selectionChanges))
      }
    },
    [canvasPointerSelectionEnabled, replaceSelection],
  )
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      if (folderFocusRef.current) return
      let effectiveChanges = changes
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
      if (canvasPointerSelectionEnabled && selectionChanges.length > 0) {
        replaceSelection(applyReactFlowNodeSelectionChanges(selectionRef.current, selectionChanges))
      }
      const documentChanges = effectiveChanges.filter((change) => change.type !== "select" && change.type !== "remove")
      if (documentChanges.length === 0) return
      const measurementChanges = canvasPointerNavigationOnly
        ? []
        : documentChanges.filter((change) => {
            if (
              change.type !== "dimensions" ||
              change.dimensions === undefined ||
              !isPositiveFiniteDimension(change.dimensions.width) ||
              !isPositiveFiniteDimension(change.dimensions.height)
            )
              return false
            const node = resolveCurrentNode(change.id)
            return (
              node?.data.kind !== "group" || (!isCanvasGroupFolded(node) && change.id !== groupFocus.focusedGroupId)
            )
          })
      if (measurementChanges.length > 0) {
        setReactFlowMeasurements((current) => {
          const next = new Map(current)
          let changed = false
          for (const change of measurementChanges) {
            if (change.type !== "dimensions" || !change.dimensions) continue
            const node = resolveCurrentNode(change.id)
            if (!node) continue
            const canonicalSize = getCanvasNodeSize(node)
            const entity = projectionStore.resolveNodeEntity(change.id)
            const rendererId = canvasFileRendererIdentity(node, props.fileRendererRegistry)
            const previous = next.get(change.id)
            if (
              previous &&
              sameCanvasSize(previous.canonicalSize, canonicalSize) &&
              sameCanvasEntity(previous.entity, entity) &&
              previous.rendererId === rendererId &&
              previous.size.width === change.dimensions.width &&
              previous.size.height === change.dimensions.height
            ) {
              continue
            }
            next.set(change.id, {
              canonicalSize,
              entity,
              rendererId,
              size: { ...change.dimensions },
            })
            changed = true
          }
          return changed ? next : current
        })
      }
      if (canvasPointerMutationEnabled && gestureStartRef.current) {
        const next = new Map(gestureGeometryRef.current)
        let changed = false
        for (const change of documentChanges) {
          if (change.type === "position" && change.position) {
            const current = next.get(change.id) ?? {}
            next.set(change.id, { ...current, position: { ...change.position } })
            changed = true
          }
          if (
            change.type === "dimensions" &&
            change.resizing === true &&
            change.dimensions &&
            isPositiveFiniteDimension(change.dimensions.width) &&
            isPositiveFiniteDimension(change.dimensions.height)
          ) {
            const current = next.get(change.id) ?? {}
            next.set(change.id, { ...current, size: { ...change.dimensions } })
            changed = true
          }
        }
        if (changed) {
          gestureGeometryRef.current = next
          setGestureGeometry(next)
        }
      }
    },
    [
      canvasPointerNavigationOnly,
      canvasPointerMutationEnabled,
      canvasPointerSelectionEnabled,
      groupFocus.focusedGroupId,
      projectionStore,
      props.fileRendererRegistry,
      replaceSelection,
      resolveCurrentNode,
    ],
  )
  const executeNodeConnection = useCallback(
    ({ source, target }: Pick<CanvasEdge, "source" | "target">) => {
      if (source === target) return
      if (!props.executeCommand) {
        rejectUnmappedCanvasMutation()
        return
      }
      const reportFailure = (error: unknown) => notifyError("Could not connect Canvas nodes", error)
      const optimisticOperation = optimisticOverlay.begin(optimisticResourceScopeKey, [
        createCanvasConnectionGhost(source, target),
      ])
      if (optimisticOperation.status === "bounded") {
        notificationService?.show({ kind: "info", title: "Saving Canvas changes…" })
      }
      try {
        void props
          .executeCommand({ type: "nodes.connect", connection: { source, target } })
          .catch(reportFailure)
          .finally(() => optimisticOverlay.settle(optimisticOperation.token))
      } catch (error) {
        optimisticOverlay.settle(optimisticOperation.token)
        reportFailure(error)
      }
    },
    [
      notificationService,
      notifyError,
      optimisticOverlay,
      optimisticResourceScopeKey,
      props.executeCommand,
      rejectUnmappedCanvasMutation,
    ],
  )
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!canvasPointerMutationEnabled) return
      executeNodeConnection(connection)
    },
    [canvasPointerMutationEnabled, executeNodeConnection],
  )
  const handleConnectStart = useCallback<OnConnectStart>(
    (event, params) => {
      setPendingConnection(null)
      updateConnectionTargetNode(null)
      if (!canvasPointerMutationEnabled) {
        connectionStartRef.current = null
        return
      }
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
    [canvasPointerMutationEnabled, updateConnectionTargetNode],
  )
  const handleConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const start = connectionStartRef.current
      connectionStartRef.current = null
      if (!canvasPointerMutationEnabled) {
        updateConnectionTargetNode(null)
        return
      }
      const targetScreen = getEventClientPoint(event)
      const targetNodeId =
        start && targetScreen
          ? getCanvasCardAtScreenPoint(rootRef.current, readCurrentWorkingDocument(), targetScreen, start.nodeId)
          : null
      updateConnectionTargetNode(null)
      if (!start || !targetScreen) return
      if (Math.hypot(targetScreen.x - start.pointerScreen.x, targetScreen.y - start.pointerScreen.y) <= 4) return
      if (connectionState.isValid || !connectionState.fromNode) return
      if (targetNodeId) {
        if (targetNodeId !== start.nodeId) {
          executeNodeConnection(createCanvasCardConnection(start.nodeId, start.side, targetNodeId))
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
    [
      canvasPointerMutationEnabled,
      executeNodeConnection,
      reactFlow,
      readCurrentWorkingDocument,
      updateConnectionTargetNode,
    ],
  )
  const handleNodeDragStart = useCallback<OnNodeDrag<CanvasNode>>(
    (event, node, draggedNodes) => {
      if (!canvasPointerMutationEnabled) return
      rootRef.current?.focus({ preventScroll: true })
      const draggingIds = draggedNodes.length > 0 ? draggedNodes.map((draggedNode) => draggedNode.id) : [node.id]
      dispatch({ type: "begin-gesture", nodeIds: draggingIds })
      altDragRef.current = null
      updateGroupDropTarget(null)
      setSnapLines([])
      const snapDocument = readCurrentWorkingDocument()
      if (event.altKey) {
        const currentSelection = selectionRef.current
        const nodeIds = currentSelection.nodeIds.has(node.id) ? [...currentSelection.nodeIds] : [node.id]
        altDragRef.current = {
          sourceNodeIds: nodeIds,
          edgeScope: event.metaKey || event.ctrlKey ? "connected" : "internal",
        }
      }
      snapSessionRef.current = snapEnabledRef.current
        ? createCanvasNodeSnapSession(
            snapDocument,
            draggingIds,
            resolveCanvasNodeSnapScopeNodeIds(snapDocument, draggingIds),
          )
        : null
    },
    [canvasPointerMutationEnabled, dispatch, readCurrentWorkingDocument, updateGroupDropTarget],
  )
  const handleNodeDrag = useCallback<OnNodeDrag<CanvasNode>>(
    (event, node, draggedNodes) => {
      if (!canvasPointerMutationEnabled) return
      const pointer = getEventClientPoint(event)
      if (!pointer) {
        updateGroupDropTarget(null)
        return
      }
      const draggedIds = new Set((draggedNodes.length > 0 ? draggedNodes : [node]).map((draggedNode) => draggedNode.id))
      if (draggedIds.size !== 1) {
        updateGroupDropTarget(null)
        return
      }
      updateGroupDropTarget(
        getCanvasGroupFolderAtScreenPoint(rootRef.current, readCurrentWorkingDocument(), pointer, draggedIds),
      )
    },
    [canvasPointerMutationEnabled, readCurrentWorkingDocument, updateGroupDropTarget],
  )
  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasNode>>(() => {
    rootRef.current?.focus({ preventScroll: true })
    const targetGroupId = groupDropTargetIdRef.current
    if (canvasPointerMutationEnabled && targetGroupId) {
      const movedNodeIds = [...gestureGeometryRef.current.keys()]
      const nodeId = movedNodeIds.length === 1 ? movedNodeIds[0] : undefined
      const source = nodeId ? gestureStartRef.current?.nodes.find((node) => node.id === nodeId) : undefined
      const finalPosition = nodeId ? gestureGeometryRef.current.get(nodeId)?.position : undefined
      altDragRef.current = null
      snapSessionRef.current = null
      setSnapLines([])
      updateGroupDropTarget(null)
      dispatch({ type: "cancel-gesture" })
      if (!nodeId || !source || !finalPosition || !props.executeCommand) {
        rejectUnmappedCanvasMutation()
        return
      }
      const entity = projectionStore.resolveNodeEntity(nodeId)
      const operation = entity
        ? optimisticOverlay.begin(optimisticResourceScopeKey, [
            createCanvasReplacePresentationOverlay({
              entity: { entityId: entity.id, incarnation: entity.incarnation, kind: "node" },
              position: finalPosition,
              size: getCanvasNodePresentationSize(source),
            }),
          ])
        : undefined
      void props
        .executeCommand({
          type: "nodes.reparent",
          nodeIds: [nodeId],
          parentId: targetGroupId,
          preserveWorldPosition: true,
          delta: { x: finalPosition.x - source.position.x, y: finalPosition.y - source.position.y },
        })
        .then(
          () => {
            if (operation) optimisticOverlay.settle(operation.token)
            selectNodes([nodeId])
          },
          (error) => {
            if (operation) optimisticOverlay.settle(operation.token)
            notifyError("Could not move Canvas node into Group", error)
          },
        )
      return
    }
    const altDrag = altDragRef.current
    if (canvasPointerMutationEnabled && altDrag) {
      const sourceId = altDrag.sourceNodeIds[0]
      const source = sourceId ? gestureStartRef.current?.nodes.find((node) => node.id === sourceId) : undefined
      const finalPosition = sourceId ? gestureGeometryRef.current.get(sourceId)?.position : undefined
      altDragRef.current = null
      snapSessionRef.current = null
      setSnapLines([])
      updateGroupDropTarget(null)
      dispatch({ type: "cancel-gesture" })
      if (!source || !finalPosition || !props.executeCommand) {
        rejectUnmappedCanvasMutation()
        return
      }
      const offset = { x: finalPosition.x - source.position.x, y: finalPosition.y - source.position.y }
      if (offset.x === 0 && offset.y === 0) return
      const operation = optimisticOverlay.begin(
        optimisticResourceScopeKey,
        createCanvasDuplicateOverlay({
          document: readCurrentWorkingDocument(altDrag.sourceNodeIds),
          nodeIds: altDrag.sourceNodeIds,
          offset,
        }),
      )
      void props
        .executeCommand({
          type: "nodes.duplicate",
          nodeIds: altDrag.sourceNodeIds,
          offset,
          edgeScope: altDrag.edgeScope,
        })
        .then(
          (result) => {
            optimisticOverlay.settle(operation.token)
            presentNodeEntries(result.createdNodeIds)
            selectNodes(result.createdNodeIds)
          },
          (error) => {
            optimisticOverlay.settle(operation.token)
            notifyError("Could not duplicate dragged Canvas nodes", error)
          },
        )
      return
    }
    altDragRef.current = null
    snapSessionRef.current = null
    setSnapLines([])
    updateGroupDropTarget(null)
    dispatch({ type: "end-gesture" })
  }, [
    canvasPointerMutationEnabled,
    dispatch,
    notifyError,
    optimisticOverlay,
    optimisticResourceScopeKey,
    presentNodeEntries,
    projectionStore,
    props.executeCommand,
    readCurrentWorkingDocument,
    rejectUnmappedCanvasMutation,
    selectNodes,
    updateGroupDropTarget,
  ])
  const handleBoxSelectionStart = useCallback(() => {
    if (!canvasPointerSelectionEnabled) {
      boxSelectionActiveRef.current = false
      boxSelectionBaselineRef.current = null
      return
    }
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
  }, [canvasPointerSelectionEnabled])
  const handleBoxSelectionEnd = useCallback(() => {
    boxSelectionActiveRef.current = false
    boxSelectionBaselineRef.current = null
  }, [])
  const searchResults = useMemo(
    () => (searchOpen ? queryCanvasNodes(readCurrentBulkDocument(), { limit: 8, text: query }) : []),
    [query, readCurrentBulkDocument, searchOpen, viewportProjectionRevision],
  )
  const interactionProps = interactionPolicy
  const viewportInsetStyle = useMemo(
    () =>
      ({
        "--canvas-safe-bottom": `${Math.max(0, props.viewportInsets?.bottom ?? 0)}px`,
        "--canvas-safe-left": `${Math.max(0, props.viewportInsets?.left ?? 0)}px`,
        "--canvas-safe-right": `${Math.max(0, props.viewportInsets?.right ?? 0)}px`,
        "--canvas-safe-top": `${Math.max(0, props.viewportInsets?.top ?? 0)}px`,
      }) as CSSProperties,
    [props.viewportInsets?.bottom, props.viewportInsets?.left, props.viewportInsets?.right, props.viewportInsets?.top],
  )
  const zoomToPreset = useCallback(
    (zoom: number) => {
      markUserNavigation()
      const duration = resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.viewport, prefersReducedMotion)
      const safeRect = getSafeViewportRect()
      const viewport = reactFlow.getViewport()
      const centeredViewport = safeRect
        ? resolveCanvasAnchoredZoomViewport({
            anchor: {
              x: safeRect.left + safeRect.width / 2,
              y: safeRect.top + safeRect.height / 2,
            },
            targetZoom: zoom,
            viewport,
          })
        : undefined
      const options = { duration, ease: canvasViewportEase, interpolate: "smooth" as const }
      if (centeredViewport) {
        void reactFlow.setViewport(centeredViewport, options)
        return
      }
      void reactFlow.zoomTo(zoom, options)
    },
    [getSafeViewportRect, markUserNavigation, prefersReducedMotion, reactFlow],
  )

  const mutationSurfaceVisible = !(props.readOnly ?? false) && !leaving && !blockingLoad && !loadError && !saveError

  return (
    <CanvasEditorMutationSurfaceProvider
      controller={controller}
      disabled={readOnly}
      onAnimationStart={notifyNodeEntryAnimationStart}
      presentation={nodeEntryPresentation}
      visible={mutationSurfaceVisible}
    >
      <CanvasGroupPresentationProvider controller={groupPresentationController}>
        <CanvasOverlayRootProvider root={overlayRoot}>
          <TooltipProvider>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  ref={setCanvasRoot}
                  className={cn(
                    "convax-canvas relative size-full overflow-hidden bg-background text-foreground outline-none",
                    spacePanning && "is-space-panning",
                    interactionTool === "hand" && "is-hand-tool",
                    leaving && "is-leaving",
                    props.className,
                  )}
                  data-canvas-color-scheme={appearance.colorScheme}
                  data-canvas-reduced-motion={String(prefersReducedMotion)}
                  data-canvas-tool={interactionTool}
                  onBlurCapture={(event) => {
                    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                    clearPointerMultiSelection()
                    if (!selectionDragModeActiveRef.current) cancelSelectionDrag()
                  }}
                  onCopy={onCanvasCopy}
                  onDragOver={(event) => {
                    if (!mutationService || !canvasPointerMutationEnabled) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = "copy"
                  }}
                  onDrop={(event) => {
                    if (!mutationService || !canvasPointerMutationEnabled) return
                    event.preventDefault()
                    const types = Array.from(event.dataTransfer.types)
                    uploadFiles(
                      [...event.dataTransfer.files],
                      reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                      {
                        data: Object.fromEntries(types.map((type) => [type, event.dataTransfer.getData(type)])),
                        types,
                      },
                      "center",
                    )
                  }}
                  onDoubleClick={(event) => {
                    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("react-flow__pane"))
                      return
                    const bounds = rootRef.current?.getBoundingClientRect()
                    if (!bounds) return
                    const viewport = reactFlow.getViewport()
                    const next = resolveCanvasAnchoredZoomViewport({
                      anchor: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
                      targetZoom: Math.min(
                        CANVAS_MAX_ZOOM,
                        Math.max(CANVAS_MIN_ZOOM, viewport.zoom * (event.shiftKey ? 0.5 : 2)),
                      ),
                      viewport,
                    })
                    if (!next) return
                    markUserNavigation()
                    void reactFlow.setViewport(next, {
                      duration: resolveCanvasMotionDuration(
                        CANVAS_MOTION_DURATION.doubleClickZoom,
                        prefersReducedMotion,
                      ),
                      ease: canvasViewportEase,
                      interpolate: "smooth",
                    })
                  }}
                  onPaste={onCanvasPaste}
                  onPointerCancelCapture={() => {
                    clearPointerMultiSelection()
                    boxSelectionActiveRef.current = false
                    boxSelectionBaselineRef.current = null
                    altDragRef.current = null
                    snapSessionRef.current = null
                    setSnapLines([])
                    updateGroupDropTarget(null)
                    dispatch({ type: "cancel-gesture" })
                  }}
                  onPointerDownCapture={(event) => {
                    setPointerMultiSelection(isCanvasMultiSelectionPointerGesture(event))
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
                      canvasPointerSelectionEnabled &&
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
                          readCurrentWorkingDocument(),
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
                  style={{
                    ...canvasAppearanceStyle(appearance),
                    ...canvasMotionStyle(prefersReducedMotion),
                    ...viewportInsetStyle,
                  }}
                  tabIndex={0}
                >
                  <ReactFlow
                    colorMode={appearance.colorScheme}
                    connectOnClick={false}
                    connectionRadius={CANVAS_CONNECTION_RADIUS}
                    connectionDragThreshold={4}
                    connectionLineComponent={CanvasConnectionLine}
                    deleteKeyCode={null}
                    edgeTypes={edgeTypes}
                    edges={edges}
                    elementsSelectable={interactionProps.elementsSelectable}
                    maxZoom={CANVAS_MAX_ZOOM}
                    minZoom={CANVAS_MIN_ZOOM}
                    multiSelectionKeyCode={null}
                    nodeTypes={nodeTypes}
                    nodes={nodes}
                    nodesConnectable={interactionProps.nodesConnectable}
                    nodesDraggable={interactionProps.nodesDraggable}
                    nodesFocusable
                    nodeDragThreshold={4}
                    onlyRenderVisibleElements={onlyRenderVisibleElements}
                    autoPanOnNodeFocus={false}
                    panActivationKeyCode={null}
                    panOnDrag={interactionProps.panOnDrag}
                    panOnScroll
                    selectionKeyCode={null}
                    selectionOnDrag={interactionProps.selectionOnDrag}
                    selectionMode={SelectionMode.Partial}
                    snapGrid={CANVAS_SNAP_GRID}
                    snapToGrid={snapEnabled}
                    zoomActivationKeyCode={null}
                    zoomOnDoubleClick={false}
                    zoomOnPinch
                    zoomOnScroll={false}
                    onConnect={handleConnect}
                    onConnectEnd={handleConnectEnd}
                    onConnectStart={handleConnectStart}
                    onEdgesChange={handleEdgesChange}
                    onNodeContextMenu={(_, node) => {
                      if (getCanvasFolderFocusEntry(node)) return
                      if (canvasPointerSelectionEnabled && !selection.nodeIds.has(node.id)) selectNodes([node.id])
                      setInsertPoint(node.position)
                    }}
                    onNodeDoubleClick={(_, node) => {
                      const folderEntry = getCanvasFolderFocusEntry(node)
                      if (folderEntry?.kind === "folder") {
                        const current = folderFocusRef.current
                        const nextPath = current
                          ? [...current.path, { id: folderEntry.entryId, label: node.data.label }]
                          : undefined
                        void navigateFolderFocus(folderEntry.ownerNodeId, folderEntry.entryId, { path: nextPath })
                        return
                      }
                      if (node.data.kind === "group") {
                        focusGroup(node.id)
                        return
                      }
                      if (node.data.kind === "folder") {
                        void navigateFolderFocus(node.id)
                        return
                      }
                      if (canvasPointerSelectionEnabled) selectNodes([node.id])
                    }}
                    onNodeDrag={handleNodeDrag}
                    onNodeDragStart={handleNodeDragStart}
                    onNodeDragStop={handleNodeDragStop}
                    onNodesChange={handleNodesChange}
                    onMoveStart={(event) => {
                      if (event) markUserNavigation()
                    }}
                    onSelectionEnd={handleBoxSelectionEnd}
                    onSelectionStart={handleBoxSelectionStart}
                    onPaneClick={() => {
                      boxSelectionActiveRef.current = false
                      boxSelectionBaselineRef.current = null
                      if (ignoreConnectionPaneClickRef.current) {
                        ignoreConnectionPaneClickRef.current = false
                        return
                      }
                      if (canvasPointerSelectionEnabled) {
                        updateSelection([])
                        setPendingConnection(null)
                      }
                      rootRef.current?.focus()
                    }}
                    onPaneContextMenu={(event) => {
                      setInsertPoint(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
                      rootRef.current?.focus()
                    }}
                  >
                    {viewportProjection ? (
                      <ViewportPortal>
                        <CanvasOptimisticViewportLayer
                          edges={optimisticGhostEdges}
                          focusedGroupId={focusedGroupId}
                          nodes={optimisticResourceGhosts}
                          resolveNode={resolveCurrentNode}
                        />
                      </ViewportPortal>
                    ) : null}
                    {appearance.gridStyle !== "none" ? (
                      <Background
                        color={`${appearance.gridColor}4d`}
                        gap={appearance.gridGap}
                        size={appearance.gridSize}
                        variant={appearance.gridStyle === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
                      />
                    ) : null}
                    <CanvasSnapGuides lines={snapLines} />
                    {miniMapVisible && !viewportProjection?.truncated ? (
                      <MiniMap
                        className="convax-canvas-minimap !h-24 !w-36 !rounded-md !border !border-border !bg-card !shadow-sm"
                        maskColor="color-mix(in oklab, var(--background) 68%, transparent)"
                        nodeColor="var(--muted-foreground)"
                        pannable
                        zoomable
                      />
                    ) : null}
                  </ReactFlow>
                  {pendingConnection ? (
                    <PendingConnectionMenu
                      items={quickConnectionNodeTypes}
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

                  <CanvasHeader
                    canUpload={Boolean(mutationService)}
                    createItems={connectionNodeTypes}
                    interactionTool={interactionTool}
                    onAddNode={(type) => addNode(type, undefined, true)}
                    onInteractionToolChange={activateInteractionTool}
                    onSearch={() => setSearchOpen(true)}
                    onUpload={(kind) => {
                      cancelSelectionDrag()
                      if (kind === "image") imageUploadInputRef.current?.click()
                      else if (kind === "video") videoUploadInputRef.current?.click()
                      else uploadInputRef.current?.click()
                    }}
                    readOnly={readOnly}
                  />
                  {folderFocus ? (
                    <CanvasBreadcrumb
                      onNavigate={(directoryId) => {
                        if (directoryId === null) {
                          void leaveFolderFocus()
                          return
                        }
                        const index = folderFocus.path.findIndex((entry) => entry.id === directoryId)
                        if (index < 0) return
                        void navigateFolderFocus(folderFocus.ownerNodeId, directoryId, {
                          path: folderFocus.path.slice(0, index + 1),
                        })
                      }}
                      path={folderFocus.path}
                    />
                  ) : groupFocus.focusedGroupId ? (
                    <CanvasBreadcrumb
                      onNavigate={(groupId) => {
                        void navigateGroupFocus(groupId)
                      }}
                      path={groupFocus.focusPath}
                    />
                  ) : null}
                  {folderFocus ? (
                    <CanvasFolderFocusStatus
                      focus={folderFocus}
                      onRetry={() => {
                        void navigateFolderFocus(folderFocus.ownerNodeId, folderFocus.directoryId, {
                          path: folderFocus.path,
                          preserveListing: true,
                          userNavigation: false,
                        })
                      }}
                      reducedMotion={prefersReducedMotion}
                    />
                  ) : null}

                  {blockingLoad || loadError ? (
                    <div className="absolute inset-0 z-40 grid place-items-center bg-background/75 backdrop-blur-[2px]">
                      {loadError ? (
                        <div
                          aria-live="assertive"
                          className="flex max-w-sm flex-col items-center gap-3 rounded-md border border-border bg-card px-5 py-4 text-center text-sm text-muted-foreground shadow-sm"
                          role="alert"
                        >
                          <TriangleAlert className="size-5 text-destructive" />
                          <div>
                            <div className="font-medium text-foreground">Canvas could not be loaded</div>
                            <div className="mt-1 text-xs">{loadError}</div>
                          </div>
                        </div>
                      ) : (
                        <Loading
                          className="max-w-sm rounded-md border border-border bg-card px-5 py-4 shadow-sm"
                          label="Loading canvas…"
                          reducedMotion={prefersReducedMotion}
                        />
                      )}
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

                  {(selectionContext.kind === "multi-node" || hasSingleGroupSelection) && mutationSurfaceVisible ? (
                    <SelectionToolbar
                      actions={visibleSelectionActions}
                      canArrange={canArrangeSelection}
                      showArrangeActions={
                        selectionContext.kind === "multi-node" || groupMenuCapabilities.canArrangeChildren
                      }
                      canDistribute={canDistributeSelection}
                      disabled={readOnly}
                      canFold={groupMenuCapabilities.canFold}
                      canGroup={groupMenuCapabilities.canGroup}
                      canUngroup={groupMenuCapabilities.canUngroup}
                      canUnfold={groupMenuCapabilities.canUnfold}
                      isActionPending={isSelectionActionPending}
                      onAlign={align}
                      onAction={executeSelectionAction}
                      onDelete={remove}
                      onDistribute={distribute}
                      onDuplicate={duplicate}
                      onFold={fold}
                      onGroup={group}
                      onLayout={layout}
                      onTidy={tidySelection}
                      nodeIds={selectedNodeIds}
                      onUngroup={ungroup}
                      onUnfold={unfold}
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
                    onSnapChange={() =>
                      setSnapEnabled((enabled) => {
                        if (enabled) setSnapLines([])
                        return !enabled
                      })
                    }
                    onZoomIn={() => {
                      markUserNavigation()
                      void reactFlow.zoomIn({
                        duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.stepZoom, prefersReducedMotion),
                        ease: canvasViewportEase,
                        interpolate: "smooth",
                      })
                    }}
                    onZoomOut={() => {
                      markUserNavigation()
                      void reactFlow.zoomOut({
                        duration: resolveCanvasMotionDuration(CANVAS_MOTION_DURATION.stepZoom, prefersReducedMotion),
                        ease: canvasViewportEase,
                        interpolate: "smooth",
                      })
                    }}
                    onZoomPreset={zoomToPreset}
                    snapEnabled={snapEnabled}
                  />

                  {nodeMenuOpen ? (
                    <FloatingPanel className="convax-safe-centered-panel top-20 w-64">
                      <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">Add to canvas</div>
                      <div className="grid grid-cols-2 gap-1">
                        {connectionNodeTypes.map((definition) => (
                          <Button
                            key={definition.type}
                            className="justify-start"
                            onClick={() => addNode(definition.type, undefined, true)}
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

                  {generatePresence.present && generateService ? (
                    <FloatingPanel
                      aria-hidden={!generateOpen || undefined}
                      className="convax-canvas-composer-overlay convax-generation-surface"
                      data-canvas-presence={generatePresence.phase}
                      inert={!generateOpen || undefined}
                    >
                      <div
                        data-canvas-composer-overlay="generation"
                        data-canvas-shortcuts="ignore"
                        onKeyDownCapture={(event) => {
                          if (event.key !== "Escape") return
                          event.preventDefault()
                          event.stopPropagation()
                          closeGenerate()
                        }}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-muted-foreground">Generate on this canvas</span>
                          <Button
                            aria-label="Close generation composer"
                            onClick={closeGenerate}
                            size="icon-sm"
                            variant="ghost"
                          >
                            <X />
                          </Button>
                        </div>
                        <CanvasGenerationPanel
                          autoFocus={generateOpen}
                          disabled={!generateOpen || readOnly}
                          document={history.document}
                          generateService={generateService}
                          onSubmit={runGenerate}
                          reducedMotion={prefersReducedMotion}
                          scopeId={currentViewScopeId}
                          selectedNodeIds={selectedNodeIds}
                          submitting={generating}
                        />
                      </div>
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
                        <FloatingPanel className="convax-node-search__panel convax-safe-centered-panel top-20 w-[min(380px,calc(100%-32px))]">
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
                    ref={imageUploadInputRef}
                    accept={canvasFilePickerAccept("image")}
                    className="hidden"
                    data-canvas-resource-picker="image"
                    onChange={handleUploadInputChange}
                    type="file"
                  />
                  <input
                    ref={videoUploadInputRef}
                    accept={canvasFilePickerAccept("video")}
                    className="hidden"
                    data-canvas-resource-picker="video"
                    onChange={handleUploadInputChange}
                    type="file"
                  />
                  <input
                    ref={uploadInputRef}
                    className="hidden"
                    data-canvas-resource-picker="upload"
                    multiple
                    onChange={handleUploadInputChange}
                    type="file"
                  />
                  <input
                    ref={relinkInputRef}
                    className="hidden"
                    data-canvas-resource-picker="relink"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const relinkNodeId = relinkNodeIdRef.current
                      const expectedKind = relinkKindRef.current
                      relinkNodeIdRef.current = null
                      relinkKindRef.current = null
                      const result = handleCanvasResourceRelinkSelection(
                        relinkNodeId,
                        [...(event.currentTarget.files ?? [])],
                        (nodeId, file) => {
                          if (!mutationService?.relink) return
                          void runResourceRelink(
                            ({ signal }) => mutationService.relink!({ file, nodeId, signal }),
                            "Resource relinked",
                            { file, kind: expectedKind, nodeId },
                          )
                        },
                        expectedKind,
                      )
                      if (result === "incompatible") {
                        notifyError(
                          "Could not relink resource",
                          new Error(
                            canvasMessage(locale, "resourceRelink.incompatibleFile", {
                              kind: canvasFileKindLabel(locale, expectedKind ?? ""),
                            }),
                          ),
                        )
                      }
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
                canFold={groupMenuCapabilities.canFold}
                canGenerate={Boolean(generateService)}
                canGroup={groupMenuCapabilities.canGroup}
                canRedo={history.future.length > 0}
                canUngroup={groupMenuCapabilities.canUngroup}
                canUnfold={groupMenuCapabilities.canUnfold}
                canUndo={history.past.length > 0}
                canUpload={Boolean(mutationService)}
                createItems={connectionNodeTypes}
                generating={generating}
                hasNodeSelection={hasNodeOnlySelection}
                hasSelection={selectedNodeIds.length > 0 || selectedEdgeIds.length > 0}
                onAddNode={(type) => addNode(type, nextInsertPoint(), true)}
                onAlign={align}
                onCopy={copy}
                onDelete={remove}
                onDistribute={distribute}
                onDuplicate={duplicate}
                onExport={exportCanvas}
                onFit={fitCanvas}
                onFold={fold}
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
                onUnfold={unfold}
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
                viewportInsets={props.viewportInsets}
              />
            </ContextMenu>
          </TooltipProvider>
        </CanvasOverlayRootProvider>
      </CanvasGroupPresentationProvider>
    </CanvasEditorMutationSurfaceProvider>
  )
}

function IconButton(props: {
  busy?: boolean
  buttonRef?: ForwardedRef<HTMLButtonElement>
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
          ref={props.buttonRef}
          aria-busy={props.busy}
          aria-expanded={props.expanded}
          aria-haspopup={props.hasPopup}
          aria-label={props.label}
          aria-pressed={props.pressed}
          className={cn(props.pressed && "bg-accent text-accent-foreground")}
          data-canvas-toolbar-control="true"
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
        "convax-tool-surface convax-motion-surface convax-motion-surface--bottom absolute z-20 flex items-center rounded-md border p-1 text-card-foreground",
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

function FloatingPanel({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "convax-floating-panel convax-motion-surface convax-motion-surface--top absolute z-30 rounded-md border p-3 text-popover-foreground",
        className,
      )}
    >
      {children}
    </div>
  )
}

function insertionIcon(type: string) {
  if (type === "text") return <Type />
  if (type === "agent") return <Bot />
  if (type === "image") return <ImagePlus />
  if (type === "video") return <Video />
  return <FileUp />
}

function moveMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "End", "Home"].includes(event.key)) return
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  if (items.length === 0) return
  event.preventDefault()
  const currentIndex =
    event.target instanceof Element ? items.indexOf(event.target.closest("button") as HTMLButtonElement) : -1
  if (event.key === "Home") items[0]?.focus()
  else if (event.key === "End") items.at(-1)?.focus()
  else if (event.key === "ArrowDown") items[(currentIndex + 1 + items.length) % items.length]?.focus()
  else items[currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length]?.focus()
}

function CanvasBreadcrumb(props: {
  onNavigate: (entryId: string | null) => void
  path: readonly { id: string; label: string }[]
}) {
  return (
    <nav aria-label="Canvas path" className="convax-group-breadcrumb" data-canvas-shortcuts="ignore">
      <button className="convax-group-breadcrumb__item" onClick={() => props.onNavigate(null)} type="button">
        <FolderOpen />
        <span>Canvas</span>
      </button>
      {props.path.map((entry, index) => {
        const current = index === props.path.length - 1
        return (
          <span className="contents" key={entry.id}>
            <ChevronRight aria-hidden="true" className="convax-group-breadcrumb__separator" />
            <button
              aria-current={current ? "page" : undefined}
              className="convax-group-breadcrumb__item"
              disabled={current}
              onClick={() => props.onNavigate(entry.id)}
              type="button"
            >
              <span>{entry.label}</span>
            </button>
          </span>
        )
      })}
    </nav>
  )
}

function CanvasFolderFocusStatus(props: {
  focus: CanvasFolderFocusState
  onRetry: () => void
  reducedMotion: boolean
}) {
  const listing = props.focus.listing
  if (props.focus.loading && !listing) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
        data-canvas-folder-focus-state="loading"
      >
        <Loading
          className="rounded-md bg-card px-4 py-3 shadow-sm"
          label="Opening folder…"
          reducedMotion={props.reducedMotion}
        />
      </div>
    )
  }
  if (props.focus.error) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
        data-canvas-folder-focus-state="error"
      >
        <div
          aria-live="assertive"
          className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-md bg-card px-5 py-4 text-center text-sm text-muted-foreground shadow-md"
          role="alert"
        >
          <TriangleAlert className="size-5 text-destructive" />
          <div>
            <div className="font-medium text-foreground">Folder could not be opened</div>
            <div className="mt-1 text-xs">{props.focus.error}</div>
          </div>
          <Button onClick={props.onRetry} size="sm" variant="outline">
            Retry
          </Button>
        </div>
      </div>
    )
  }
  if (listing && listing.entries.length === 0) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
        data-canvas-folder-focus-state="empty"
      >
        <div className="flex flex-col items-center gap-2 rounded-md bg-card/90 px-5 py-4 text-sm text-muted-foreground shadow-sm">
          <FolderOpen className="size-5" />
          <span>This folder is empty</span>
        </div>
      </div>
    )
  }
  if (listing?.truncated) {
    return (
      <div
        aria-live="polite"
        className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm"
        data-canvas-folder-focus-state="truncated"
      >
        Showing 200 of {listing.totalCount} items
      </div>
    )
  }
  if (props.focus.loading && listing) {
    return (
      <div
        aria-live="polite"
        className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm"
        data-canvas-folder-focus-state="refreshing"
      >
        Refreshing folder…
      </div>
    )
  }
  return null
}

function CanvasHeader(props: {
  canUpload: boolean
  createItems: readonly { label: string; type: string }[]
  interactionTool: CanvasInteractionTool
  onAddNode: (type: string) => void
  onInteractionToolChange: (tool: CanvasInteractionTool) => void
  onSearch: () => void
  onUpload: (kind: "files" | "image" | "video") => void
  readOnly: boolean
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!addOpen) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && addMenuRef.current?.contains(event.target)) return
      setAddOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      addTriggerRef.current?.focus()
      setAddOpen(false)
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [addOpen])
  useEffect(() => {
    if (!props.readOnly) return
    setAddOpen(false)
  }, [props.readOnly])
  useEffect(() => {
    if (!addOpen) return
    const frame = window.requestAnimationFrame(() =>
      addMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
    )
    return () => window.cancelAnimationFrame(frame)
  }, [addOpen])
  return (
    <div className="convax-creation-toolbar-frame">
      <div
        aria-label="Canvas tools"
        className="convax-creation-toolbar convax-tool-surface convax-motion-surface convax-motion-surface--top"
        data-canvas-shortcuts="ignore"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "End", "Home"].includes(event.key)) return
          if (!(event.target instanceof Element) || !event.target.matches("[data-canvas-toolbar-control='true']"))
            return
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-canvas-toolbar-control='true']:not(:disabled)",
            ),
          ]
          if (controls.length === 0) return
          event.preventDefault()
          const currentIndex = controls.indexOf(event.target as HTMLButtonElement)
          if (event.key === "Home") controls[0]?.focus()
          else if (event.key === "End") controls.at(-1)?.focus()
          else if (event.key === "ArrowRight") controls[(currentIndex + 1 + controls.length) % controls.length]?.focus()
          else controls[(currentIndex - 1 + controls.length) % controls.length]?.focus()
        }}
        role="toolbar"
      >
        <IconButton
          icon={<MousePointer2 />}
          label="Select"
          onClick={() => props.onInteractionToolChange("select")}
          pressed={props.interactionTool === "select"}
          shortcut="V"
          tooltipSide="bottom"
        />
        <IconButton
          icon={<Hand />}
          label="Hand"
          onClick={() => props.onInteractionToolChange("hand")}
          pressed={props.interactionTool === "hand"}
          shortcut="H"
          tooltipSide="bottom"
        />
        <IconButton icon={<Search />} label="Search" onClick={props.onSearch} shortcut="⌘F" tooltipSide="bottom" />
        <div className="relative" ref={addMenuRef}>
          <IconButton
            buttonRef={addTriggerRef}
            disabled={props.readOnly || (props.createItems.length === 0 && !props.canUpload)}
            expanded={addOpen}
            hasPopup="menu"
            icon={<Plus />}
            label="Add node"
            onClick={() => setAddOpen((open) => !open)}
            pressed={addOpen}
            tooltipSide="bottom"
          />
          <div
            className="convax-canvas-create-menu convax-motion-menu"
            data-canvas-shortcuts="ignore"
            hidden={!addOpen}
            onKeyDown={moveMenuFocus}
            role="menu"
          >
            <div className="convax-canvas-menu__label">Create</div>
            {props.createItems.map((item) => (
              <button
                aria-label={`Add ${item.label}`}
                disabled={props.readOnly}
                key={item.type}
                onClick={() => {
                  if (item.type === "image" || item.type === "video") props.onUpload(item.type)
                  else props.onAddNode(item.type)
                  setAddOpen(false)
                  addTriggerRef.current?.focus()
                }}
                role="menuitem"
                type="button"
              >
                {insertionIcon(item.type)}
                <span>Add {item.label}</span>
              </button>
            ))}
            {props.canUpload ? (
              <button
                aria-label="Upload files"
                disabled={props.readOnly}
                onClick={() => {
                  props.onUpload("files")
                  setAddOpen(false)
                  addTriggerRef.current?.focus()
                }}
                role="menuitem"
                type="button"
              >
                <FileUp />
                <span>Upload files</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
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
  showArrangeActions: boolean
  canDistribute: boolean
  canFold: boolean
  canGroup: boolean
  canUngroup: boolean
  disabled: boolean
  canUnfold: boolean
  isActionPending: (actionId: string) => boolean
  nodeIds: string[]
  onAlign: (direction: CanvasAlign) => void
  onAction: (action: CanvasSelectionAction) => void
  onDelete: () => void
  onDistribute: (axis: CanvasDistribute) => void
  onDuplicate: () => void
  onFold: () => void
  onGroup: () => void
  onLayout: (layout: CanvasLayout) => void
  onTidy: () => void
  onUngroup: () => void
  onUnfold: () => void
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
      aria-busy={props.disabled || undefined}
      className="convax-selection-toolbar nodrag nowheel"
      inert={props.disabled || undefined}
      isVisible
      nodeId={props.nodeIds}
      offset={16}
      position={Position.Top}
    >
      <div
        className="convax-selection-toolbar__surface convax-tool-surface convax-motion-surface convax-motion-surface--top flex items-center gap-0.5 border text-card-foreground"
        data-canvas-shortcuts="ignore"
      >
        <IconButton icon={<Copy />} label="Duplicate" onClick={props.onDuplicate} shortcut="⌘D" tooltipSide="top" />
        {props.canGroup ? (
          <IconButton icon={<Group />} label="Group" onClick={props.onGroup} shortcut="⌘G" tooltipSide="top" />
        ) : null}
        {props.canFold ? <IconButton icon={<Folder />} label="Fold" onClick={props.onFold} tooltipSide="top" /> : null}
        {props.canUnfold ? (
          <IconButton icon={<FolderOpen />} label="Unfold" onClick={props.onUnfold} shortcut="⇧⌘G" tooltipSide="top" />
        ) : null}
        {props.canUngroup ? (
          <IconButton icon={<Ungroup />} label="Ungroup" onClick={props.onUngroup} shortcut="⇧⌘G" tooltipSide="top" />
        ) : null}
        {props.actions.length > 0 ? <span className="mx-1 h-5 w-px bg-border" /> : null}
        {partitionedActions.primary.map((action) => {
          const pending = props.isActionPending(action.id)
          return (
            <IconButton
              busy={pending}
              key={action.id}
              disabled={pending}
              icon={action.icon ?? <Workflow />}
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
                className="convax-motion-menu absolute left-0 top-full z-50 mt-1 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                data-canvas-shortcuts="ignore"
                role="menu"
              >
                {partitionedActions.overflow.map((action) => {
                  const pending = props.isActionPending(action.id)
                  return (
                    <button
                      aria-busy={pending}
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
                      <span className="[&>svg]:size-3.5">{action.icon ?? <Workflow />}</span>
                      <span>{action.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {props.showArrangeActions ? (
          <>
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
                <div
                  className="convax-arrange-menu convax-motion-menu convax-motion-menu--centered"
                  data-canvas-shortcuts="ignore"
                  role="menu"
                >
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
          </>
        ) : null}
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
  onSnapChange: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  snapEnabled: boolean
  onZoomPreset: (zoom: number) => void
}) {
  const viewport = useViewport()
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const zoomTriggerRef = useRef<HTMLButtonElement>(null)
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
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setZoomMenuOpen(false)
      zoomTriggerRef.current?.focus()
    }
    window.addEventListener("pointerdown", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [zoomMenuOpen])
  return (
    <ToolSurface className="convax-viewport-toolbar bottom-3 left-3 gap-0.5">
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
          <div
            className="convax-zoom-menu convax-layout-menu convax-motion-menu convax-motion-menu--centered"
            data-canvas-shortcuts="ignore"
            role="menu"
          >
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
            ref={zoomTriggerRef}
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
          <div
            className="convax-zoom-menu convax-motion-menu convax-motion-menu--centered"
            data-canvas-shortcuts="ignore"
            role="menu"
          >
            <div className="convax-zoom-menu__title">Zoom</div>
            {zoomPresets.map((zoom) => (
              <button
                key={zoom}
                className="convax-zoom-menu__item"
                onClick={() => {
                  props.onZoomPreset(zoom)
                  setZoomMenuOpen(false)
                  zoomTriggerRef.current?.focus()
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
  canFold: boolean
  canGenerate: boolean
  canGroup: boolean
  canRedo: boolean
  canUngroup: boolean
  canUnfold: boolean
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
  onFold: () => void
  onGenerate: () => void
  onGroup: () => void
  onLayout: () => void
  onPaste: () => void
  onRedo: () => void
  onSelectionDragModeChange: (active: boolean) => void
  onUngroup: () => void
  onUnfold: () => void
  onUndo: () => void
  onUpload: () => void
  readOnly: boolean
  selectionDragMode?: {
    active: boolean
    icon: ReactNode
    label: string
  }
  viewportInsets?: CanvasViewportInsets
}) {
  const collisionPadding = {
    bottom: Math.max(12, (props.viewportInsets?.bottom ?? 0) + 12),
    left: Math.max(12, (props.viewportInsets?.left ?? 0) + 12),
    right: Math.max(12, (props.viewportInsets?.right ?? 0) + 12),
    top: Math.max(12, (props.viewportInsets?.top ?? 0) + 12),
  }
  return (
    <ContextMenuContent
      className="convax-canvas-context-menu convax-motion-menu w-60"
      collisionPadding={collisionPadding}
    >
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
          {props.generating ? <LoadingSpinner size="sm" /> : <Sparkles />}
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
      {props.canFold && !props.readOnly ? (
        <ContextMenuItem onSelect={props.onFold}>
          <Folder />
          Fold
        </ContextMenuItem>
      ) : null}
      {props.canUnfold && !props.readOnly ? (
        <ContextMenuItem onSelect={props.onUnfold}>
          <FolderOpen />
          Unfold<Shortcut>⇧⌘G</Shortcut>
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
