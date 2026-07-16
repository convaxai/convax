import { createContext, type ReactNode, useContext } from "react"
import type { CanvasFileRendererRegistry } from "./file-renderer-registry"
import type { CanvasDocument, CanvasPoint, CanvasSelection } from "./types"

export interface CanvasConnectionNodeType {
  label: string
  type: string
}

export interface CanvasEditorController {
  document: CanvasDocument
  selection: CanvasSelection
  readOnly: boolean
  canUpload: boolean
  fileRenderers: CanvasFileRendererRegistry
  connectionNodeTypes: readonly CanvasConnectionNodeType[]
  beginGesture: () => void
  cancelGesture: () => void
  endGesture: () => void
  commit: (update: (document: CanvasDocument) => CanvasDocument) => void
  duplicateNode: (nodeId: string) => void
  quickConnect: (nodeId: string, side: "left" | "right", nodeType: string, targetPosition?: CanvasPoint) => void
  removeNode: (nodeId: string) => void
  replaceNodeMedia: (nodeId: string, file: File) => void
  selectNodes: (nodeIds: readonly string[]) => void
}

const CanvasEditorContext = createContext<CanvasEditorController | null>(null)

export function CanvasEditorProvider(props: { children: ReactNode; controller: CanvasEditorController }) {
  return <CanvasEditorContext value={props.controller}>{props.children}</CanvasEditorContext>
}

export function useCanvasEditor() {
  const editor = useContext(CanvasEditorContext)
  if (editor) return editor
  throw new Error("CanvasEditorProvider is missing")
}
