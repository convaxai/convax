import { createContext, type ReactNode, useContext } from "react"
import type { CanvasFileRendererRegistry } from "./file-renderer-registry"
import type { CanvasSelectionContext } from "./selection-context"
import type { CanvasSelectionAction } from "./selection-actions"
import type { CanvasSelectionDragPreparationStatus, CanvasSelectionDragSource } from "./selection-drag-source"
import type { CanvasDocument, CanvasPoint, CanvasResourceRuntimeState, CanvasSelection } from "./types"
import type { CanvasPendingDraft } from "./services"

export interface CanvasConnectionNodeType {
  label: string
  type: string
}

export interface CanvasEditorController {
  document: CanvasDocument
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

export function CanvasEditorProvider(props: { children: ReactNode; controller: CanvasEditorController }) {
  return <CanvasEditorContext value={props.controller}>{props.children}</CanvasEditorContext>
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
