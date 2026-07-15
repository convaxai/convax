import { createContext, type ReactNode, useContext } from "react"
import type { CanvasDocument, CanvasSelection } from "./types"

export interface CanvasConnectionNodeType {
  label: string
  type: string
}

export interface CanvasEditorController {
  document: CanvasDocument
  selection: CanvasSelection
  readOnly: boolean
  connectionNodeTypes: readonly CanvasConnectionNodeType[]
  beginGesture: () => void
  endGesture: () => void
  commit: (update: (document: CanvasDocument) => CanvasDocument) => void
  quickConnect: (nodeId: string, side: "left" | "right", nodeType: string) => void
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
