import { updateCanvasNodeData } from "./commands"
import type { CanvasDocument, CanvasNode } from "./types"

export const canvasNodeGenerationPreferenceKey = "convaxGenerationPreference"
export const canvasNodeGenerationPreferenceSchema = "convax.node-generation-preference/1"

export const maximumCanvasGenerationToolIdLength = 512

interface StoredCanvasNodeGenerationPreference {
  schema: typeof canvasNodeGenerationPreferenceSchema
  toolId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function isCanvasGenerationToolId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumCanvasGenerationToolIdLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

/** Reads a portable, host-opaque generation model override from one Canvas node. */
export function getCanvasNodeGenerationToolId(node: CanvasNode): string | undefined {
  const metadata = node.data.metadata
  if (!isRecord(metadata)) return undefined
  const preference = metadata[canvasNodeGenerationPreferenceKey]
  if (!isRecord(preference)) return undefined
  if (preference.schema !== canvasNodeGenerationPreferenceSchema || !isCanvasGenerationToolId(preference.toolId)) {
    return undefined
  }
  return preference.toolId
}

/**
 * Persists only an opaque host tool id. Concrete vendors, models and routing stay
 * outside Canvas; clearing the id restores inheritance from the host preference.
 */
export function setCanvasNodeGenerationToolId(
  document: CanvasDocument,
  nodeId: string,
  toolId?: string,
): CanvasDocument {
  if (toolId !== undefined && !isCanvasGenerationToolId(toolId)) {
    throw new Error("Canvas generation tool id must be a bounded printable identifier")
  }
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || getCanvasNodeGenerationToolId(node) === toolId) return document

  return updateCanvasNodeData(document, nodeId, (data) => {
    const currentMetadata = isRecord(data.metadata) ? data.metadata : {}
    const metadata = { ...currentMetadata }
    if (toolId === undefined) delete metadata[canvasNodeGenerationPreferenceKey]
    else {
      metadata[canvasNodeGenerationPreferenceKey] = {
        schema: canvasNodeGenerationPreferenceSchema,
        toolId,
      } satisfies StoredCanvasNodeGenerationPreference
    }
    if (Object.keys(metadata).length === 0) {
      const { metadata: _metadata, ...withoutMetadata } = data
      return withoutMetadata as CanvasNode["data"]
    }
    return { ...data, metadata }
  })
}
