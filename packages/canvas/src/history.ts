import type { CanvasDocument } from "./types"

export interface CanvasHistoryState {
  document: CanvasDocument
  past: CanvasDocument[]
  future: CanvasDocument[]
  gestureStart?: CanvasDocument
}

export type CanvasHistoryAction =
  | { type: "commit"; document: CanvasDocument }
  | { type: "commit-update"; update: (document: CanvasDocument) => CanvasDocument }
  | { type: "hydrate"; document: CanvasDocument }
  | { type: "preview-or-commit-update"; update: (document: CanvasDocument) => CanvasDocument }
  | { type: "replace"; document: CanvasDocument }
  | { type: "replace-update"; update: (document: CanvasDocument) => CanvasDocument }
  | { type: "begin-gesture" }
  | { type: "end-gesture" }
  | { type: "cancel-gesture" }
  | { type: "undo" }
  | { type: "redo" }

const HISTORY_LIMIT = 100

export function createCanvasHistory(document: CanvasDocument): CanvasHistoryState {
  return { document, past: [], future: [] }
}

function changed(left: CanvasDocument, right: CanvasDocument) {
  return left.nodes !== right.nodes || left.edges !== right.edges || left.metadata !== right.metadata
}

function nextRevision(document: CanvasDocument, revision: number): CanvasDocument {
  return { ...document, revision }
}

function pushPast(past: CanvasDocument[], document: CanvasDocument) {
  return [...past, document].slice(-HISTORY_LIMIT)
}

export function canvasHistoryReducer(state: CanvasHistoryState, action: CanvasHistoryAction): CanvasHistoryState {
  if (action.type === "hydrate") return createCanvasHistory(action.document)
  if (action.type === "commit-update") {
    return canvasHistoryReducer(state, { type: "commit", document: action.update(state.document) })
  }
  if (action.type === "replace-update") {
    return canvasHistoryReducer(state, { type: "replace", document: action.update(state.document) })
  }
  if (action.type === "preview-or-commit-update") {
    const document = action.update(state.document)
    return canvasHistoryReducer(state, { type: state.gestureStart ? "replace" : "commit", document })
  }
  if (action.type === "replace") {
    return { ...state, document: nextRevision(action.document, state.document.revision) }
  }
  if (action.type === "commit") {
    if (!changed(state.document, action.document)) return state
    if (state.gestureStart) {
      return { ...state, document: nextRevision(action.document, state.document.revision + 1), future: [] }
    }
    return {
      document: nextRevision(action.document, state.document.revision + 1),
      past: pushPast(state.past, state.document),
      future: [],
    }
  }
  if (action.type === "begin-gesture") {
    if (state.gestureStart) return state
    return { ...state, gestureStart: state.document }
  }
  if (action.type === "cancel-gesture") {
    if (!state.gestureStart) return state
    return {
      ...state,
      document: nextRevision(state.gestureStart, state.document.revision + 1),
      gestureStart: undefined,
    }
  }
  if (action.type === "end-gesture") {
    if (!state.gestureStart) return state
    if (!changed(state.gestureStart, state.document)) return { ...state, gestureStart: undefined }
    return {
      document: nextRevision(state.document, state.document.revision + 1),
      past: pushPast(state.past, state.gestureStart),
      future: [],
    }
  }
  if (action.type === "undo") {
    const previous = state.past.at(-1)
    if (!previous) return state
    return {
      document: nextRevision(previous, state.document.revision + 1),
      past: state.past.slice(0, -1),
      future: [state.document, ...state.future],
    }
  }
  const next = state.future[0]
  if (!next) return state
  return {
    document: nextRevision(next, state.document.revision + 1),
    past: pushPast(state.past, state.document),
    future: state.future.slice(1),
  }
}
