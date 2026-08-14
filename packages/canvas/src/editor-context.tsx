import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from "react"
import type { CanvasFileRendererRegistry } from "./file-renderer-registry"
import type { CanvasNodeEntryPhase } from "./motion"
import type { CanvasSelectionContext } from "./selection-context"
import type { CanvasSelectionAction } from "./selection-actions"
import type { CanvasSelectionDragPreparationStatus, CanvasSelectionDragSource } from "./selection-drag-source"
import type { CanvasDocument, CanvasPoint, CanvasResourceRuntimeState, CanvasSelection } from "./types"
import type { CanvasPendingDraft } from "./services"
import type { CanvasApplicationCommand } from "./application/commands"

export interface CanvasConnectionNodeType {
  label: string
  type: string
}

export interface CanvasNodeEntryPresentation {
  has: (nodeId: string) => boolean
  phase: (nodeId: string) => CanvasNodeEntryPhase
  subscribe: (nodeId: string, listener: () => void) => () => void
}

export interface CanvasEditorController {
  document: CanvasDocument
  /** Host scope that owns the document; empty for independent Canvas consumers. */
  scopeId?: string
  /** @deprecated Use useCanvasNodeEntryPresentation for reactive node-local presentation. */
  enteringNodeIds: ReadonlySet<string>
  hydrating: boolean
  reducedMotion: boolean
  selection: CanvasSelection
  selectionContext: CanvasSelectionContext
  readOnly: boolean
  canUpload: boolean
  canRelinkResource: boolean
  fileRenderers: CanvasFileRendererRegistry
  connectionNodeTypes: readonly CanvasConnectionNodeType[]
  /** Node kinds whose create-plus-edge operation is one admitted atomic Canvas intent. */
  quickConnectionNodeTypes: readonly CanvasConnectionNodeType[]
  visibleSelectionActions: readonly CanvasSelectionAction[]
  visibleSelectionDragSource: CanvasSelectionDragSource | null
  selectionDragArmed: boolean
  selectionDragChordHeld: boolean
  selectionDragModeActive: boolean
  selectionDragStatus: CanvasSelectionDragPreparationStatus
  beginGesture: () => void
  cancelGesture: () => void
  endGesture: () => void
  commit: (update: (document: CanvasDocument) => CanvasDocument) => void
  /** Submits one closed Canvas-owned application command through the authoritative Host bridge. */
  executeCommand: (command: CanvasApplicationCommand) => void
  duplicateNode: (nodeId: string) => void
  executeSelectionAction: (action: CanvasSelectionAction) => void
  finishNodeEntry: (nodeId: string) => void
  isSelectionActionPending: (actionId: string) => boolean
  finishSelectionDrag: () => void
  setSelectionDragCandidateNode: (nodeId: string | null) => void
  startSelectionDrag: () => boolean
  quickConnect: (nodeId: string, side: "left" | "right", nodeType: string, targetPosition?: CanvasPoint) => void
  relinkResource: (nodeId: string) => void
  relinkSelectedResource: (nodeId: string) => void
  reloadAuthoritative?: () => Promise<void>
  replaceResourceState: (nodeId: string, state: CanvasResourceRuntimeState) => void
  registerPendingDraft: (draft: CanvasPendingDraft) => () => void
  removeNode: (nodeId: string) => void
  saveEditableCopy: (nodeId: string) => Promise<void>
  selectNodes: (nodeIds: readonly string[]) => void
}

const CanvasEditorContext = createContext<CanvasEditorController | null>(null)
const CanvasOverlayRootContext = createContext<HTMLElement | null>(null)
const CanvasNodeEntryPresentationContext = createContext<{
  onAnimationStart: (nodeId: string) => void
  presentation: CanvasNodeEntryPresentation
} | null>(null)

export function CanvasEditorProvider(props: { children: ReactNode; controller: CanvasEditorController }) {
  return <CanvasEditorContext value={props.controller}>{props.children}</CanvasEditorContext>
}

export function CanvasEditorNodeEntryProvider(props: {
  children: ReactNode
  controller: CanvasEditorController
  onAnimationStart: (nodeId: string) => void
  presentation: CanvasNodeEntryPresentation
}) {
  const value = useMemo(
    () => ({ onAnimationStart: props.onAnimationStart, presentation: props.presentation }),
    [props.onAnimationStart, props.presentation],
  )
  return (
    <CanvasEditorProvider controller={props.controller}>
      <CanvasNodeEntryPresentationContext value={value}>{props.children}</CanvasNodeEntryPresentationContext>
    </CanvasEditorProvider>
  )
}

export function CanvasOverlayRootProvider(props: { children: ReactNode; root: HTMLElement | null }) {
  return <CanvasOverlayRootContext value={props.root}>{props.children}</CanvasOverlayRootContext>
}

export function useCanvasOverlayRoot() {
  return useContext(CanvasOverlayRootContext)
}

export function useCanvasEditor() {
  const editor = useContext(CanvasEditorContext)
  if (editor) return editor
  throw new Error("CanvasEditorProvider is missing")
}

export function useCanvasNodeEntryPresentation(nodeId: string, fallback: ReadonlySet<string>) {
  const context = useContext(CanvasNodeEntryPresentationContext)
  const phase = useSyncExternalStore(
    useCallback(
      (listener) => context?.presentation.subscribe(nodeId, listener) ?? (() => undefined),
      [context, nodeId],
    ),
    () => context?.presentation.phase(nodeId) ?? (fallback.has(nodeId) ? "entering" : "idle"),
    () => context?.presentation.phase(nodeId) ?? (fallback.has(nodeId) ? "entering" : "idle"),
  )
  const notifyAnimationStart = useCallback(() => context?.onAnimationStart(nodeId), [context, nodeId])
  return { entering: phase === "entering", notifyAnimationStart, phase }
}
