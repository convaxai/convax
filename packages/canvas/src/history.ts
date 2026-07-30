import type { CanvasDocument } from "./types"
import { sameCanvasJson } from "./json-equality"

export interface CanvasHistoryState {
  document: CanvasDocument
  past: CanvasDocument[]
  future: CanvasDocument[]
  gestureStart?: CanvasDocument
}

export type CanvasHistoryAction =
  | { type: "acknowledge"; document: CanvasDocument; expectedRevision: number }
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

function reuseEqualElements<T extends { id: string }>(current: T[], authoritative: T[]): T[] {
  const currentById = new Map(current.map((element) => [element.id, element]))
  let canReuseArray = current.length === authoritative.length
  const reconciled = authoritative.map((element, index) => {
    const previous = currentById.get(element.id)
    const next = previous && sameCanvasJson(previous, element) ? previous : element
    if (current[index] !== next) canReuseArray = false
    return next
  })
  return canReuseArray ? current : reconciled
}

/** Accepts authoritative content while retaining renderer identity for unchanged elements. */
function reconcileAuthoritativeDocument(current: CanvasDocument, authoritative: CanvasDocument): CanvasDocument {
  if (current.id !== authoritative.id) return authoritative
  return {
    ...authoritative,
    edges: reuseEqualElements(current.edges, authoritative.edges),
    metadata: sameCanvasJson(current.metadata, authoritative.metadata) ? current.metadata : authoritative.metadata,
    nodes: reuseEqualElements(current.nodes, authoritative.nodes),
  }
}

export function canvasHistoryReducer(state: CanvasHistoryState, action: CanvasHistoryAction): CanvasHistoryState {
  if (action.type === "acknowledge") {
    if (state.document.revision !== action.expectedRevision || state.document.id !== action.document.id) return state
    return { ...state, document: reconcileAuthoritativeDocument(state.document, action.document) }
  }
  if (action.type === "hydrate") {
    return createCanvasHistory(reconcileAuthoritativeDocument(state.document, action.document))
  }
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
