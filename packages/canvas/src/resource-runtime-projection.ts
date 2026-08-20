import type { CanvasDocument, CanvasNode, CanvasResourceRuntimeState } from "./types"
import { canvasProjectionResourceMetadataKey } from "./collaboration/projection"
import { assertResourceRef } from "./collaboration/validation"

/** Exact identity of the durable resource currently projected for one node. */
export function canvasCanonicalResourceIdentity(node: CanvasNode): string | undefined {
  const metadata = node.data.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const candidate = (metadata as Record<string, unknown>)[canvasProjectionResourceMetadataKey]
  try {
    assertResourceRef(candidate)
  } catch {
    return undefined
  }
  return [
    candidate.format,
    candidate.uri,
    candidate.mediaClass,
    candidate.mime,
    candidate.byteLength,
    candidate.contentDigest,
    candidate.ownerProofDigest,
  ].join("\u0000")
}

/**
 * Applies transient resource presentation in one document traversal. This is a
 * renderer projection only; neither the input Map nor its values are persisted.
 */
export function projectCanvasResourceRuntimeStates<Value>(input: {
  document: CanvasDocument
  resolve(node: CanvasNode, value: Value): CanvasResourceRuntimeState | null
  states: ReadonlyMap<string, Value>
}): CanvasDocument {
  if (input.states.size === 0) return input.document
  let changed = false
  const nodes = input.document.nodes.map((node) => {
    const value = input.states.get(node.id)
    if (value === undefined || !("resourceState" in node.data)) return node
    const state = input.resolve(node, value)
    if (!state) return node
    changed = true
    return { ...node, data: { ...node.data, resourceState: state } }
  })
  return changed ? { ...input.document, nodes } : input.document
}
