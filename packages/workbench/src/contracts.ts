export interface WorkbenchCanvasInput {
  canvasId: string
  kind: "canvas"
  projectId: string
}

export interface WorkbenchFileInput {
  kind: "file"
  path: string
  projectId: string
  resourceId?: string
}

/** A serializable identity for content opened in the primary Workbench surface. */
export type WorkbenchInput = WorkbenchCanvasInput | WorkbenchFileInput

export interface WorkbenchCanvasNodesSelection {
  kind: "canvas-nodes"
  /** A serialized set of unique node ids. Array order has no selection semantics. */
  nodeIds: readonly string[]
}

export interface WorkbenchFileRangeSelection {
  endLine?: number
  kind: "file-range"
  startLine: number
}

/** A short-lived selection inside one Workbench input. */
export type WorkbenchSelection = WorkbenchCanvasNodesSelection | WorkbenchFileRangeSelection

export interface WorkbenchSelectionState {
  input: WorkbenchInput
  selection: WorkbenchSelection
}

export type WorkbenchSurface =
  | { kind: "empty"; reason: "no-input" | "no-project" }
  | { input: WorkbenchCanvasInput; kind: "canvas" }
  | { input: WorkbenchFileInput; kind: "file" }

export interface WorkbenchSnapshot {
  activeInput: WorkbenchInput | null
  changingInput: boolean
  error: string | null
  inputMode: "pinned" | "preview"
  projectId: string | null
  selection: WorkbenchSelectionState | null
  surface: WorkbenchSurface
}

export interface WorkbenchOpenOptions {
  focus?: boolean
  preview?: boolean
}

export interface WorkbenchRevealOptions extends WorkbenchOpenOptions {
  fitView?: boolean
}

export interface WorkbenchRevealRequest {
  input: WorkbenchInput
  options: Required<Pick<WorkbenchRevealOptions, "fitView" | "focus">>
  selection: WorkbenchSelection
}
