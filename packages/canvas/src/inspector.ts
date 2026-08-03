import { getCanvasNodeSize } from "./document"
import type { CanvasSelectionContext } from "./selection-context"
import type { CanvasDocument, CanvasNode, CanvasNodeData } from "./types"

const MAX_INSPECTOR_SECTIONS = 8
const MAX_INSPECTOR_FIELDS_PER_SECTION = 16
const MAX_INSPECTOR_TEXT_LENGTH = 256

export interface CanvasInspectorFieldInput {
  readonly id: string
  readonly label: string
  readonly value: boolean | number | string
}

export interface CanvasInspectorSectionInput {
  readonly fields: readonly CanvasInspectorFieldInput[]
  readonly id: string
  readonly label: string
}

export interface CanvasInspectorContribution {
  /**
   * Projects renderer-owned data into bounded, display-only fields. The callback
   * never receives services or editor commands and cannot contribute controls.
   */
  readonly project?: (node: Readonly<CanvasNode>) => readonly CanvasInspectorSectionInput[]
}

export interface CanvasInspectorField {
  readonly id: string
  readonly label: string
  readonly value: string
}

export interface CanvasInspectorSection {
  readonly fields: readonly CanvasInspectorField[]
  readonly id: string
  readonly label: string
}

export interface CanvasInspectorProjection {
  readonly description?: string
  readonly documentId: string
  readonly kind: "node"
  readonly label: string
  readonly nodeId: string
  readonly nodeKind: string
  readonly rendererId: string
  readonly scopeId: string
  readonly sections: readonly CanvasInspectorSection[]
  readonly status?: string
  readonly viewId: string
}

export interface CanvasSelectionProjection {
  readonly documentId: string
  readonly inspector: CanvasInspectorProjection | null
  readonly kind: CanvasSelectionContext["kind"]
  readonly nodeIds: readonly string[]
  readonly scopeId: string
  readonly viewId: string
}

export interface CanvasSelectionProjectionScope {
  readonly documentId: string
  readonly scopeId: string
  readonly viewId: string
}

export interface CanvasInspectorRendererDefinition {
  readonly id: string
  readonly inspector?: CanvasInspectorContribution
}

export interface CanvasInspectorRendererResolver {
  resolve(data: CanvasNodeData): CanvasInspectorRendererDefinition | undefined
}

function boundedText(value: unknown) {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, MAX_INSPECTOR_TEXT_LENGTH) : undefined
}

function normalizeInspectorSections(
  sections: readonly CanvasInspectorSectionInput[],
): readonly CanvasInspectorSection[] | null {
  const sectionIds = new Set<string>()
  const normalized: CanvasInspectorSection[] = []
  for (const section of sections.slice(0, MAX_INSPECTOR_SECTIONS)) {
    const id = boundedText(section.id)
    const label = boundedText(section.label)
    if (!id || !label || sectionIds.has(id)) return null
    sectionIds.add(id)

    const fieldIds = new Set<string>()
    const fields: CanvasInspectorField[] = []
    for (const field of section.fields.slice(0, MAX_INSPECTOR_FIELDS_PER_SECTION)) {
      const fieldId = boundedText(field.id)
      const fieldLabel = boundedText(field.label)
      const value = boundedText(String(field.value))
      if (!fieldId || !fieldLabel || !value || fieldIds.has(fieldId)) return null
      fieldIds.add(fieldId)
      fields.push(Object.freeze({ id: fieldId, label: fieldLabel, value }))
    }
    if (fields.length > 0) {
      normalized.push(Object.freeze({ fields: Object.freeze(fields), id, label }))
    }
  }
  return Object.freeze(normalized)
}

function getSingleSelectedNode(document: CanvasDocument, selection: CanvasSelectionContext): CanvasNode | undefined {
  if (selection.kind !== "single-node") return undefined
  return document.nodes.find((node) => node.id === selection.nodeId)
}

/**
 * Resolves an Inspector only for one explicitly supported file renderer. Edge,
 * mixed, missing and renderer-projector failures all fail closed.
 */
export function resolveCanvasInspectorProjection(options: {
  readonly document: CanvasDocument
  readonly renderers: CanvasInspectorRendererResolver
  readonly scopeId: string
  readonly selection: CanvasSelectionContext
  readonly viewId: string
}): CanvasInspectorProjection | null {
  const node = getSingleSelectedNode(options.document, options.selection)
  if (!node || node.type !== "file") return null
  const renderer = options.renderers.resolve(node.data)
  if (!renderer?.inspector) return null

  let contributed: readonly CanvasInspectorSectionInput[] = []
  try {
    contributed = renderer.inspector.project?.(node) ?? []
  } catch {
    return null
  }
  const sections = normalizeInspectorSections([
    {
      fields: [
        { id: "kind", label: "Type", value: renderer.id },
        { id: "position", label: "Position", value: `${node.position.x}, ${node.position.y}` },
        {
          id: "size",
          label: "Size",
          value: `${getCanvasNodeSize(node).width} × ${getCanvasNodeSize(node).height}`,
        },
      ],
      id: "canvas",
      label: "Canvas",
    },
    ...contributed,
  ])
  if (!sections) return null

  return Object.freeze({
    ...(boundedText(node.data.description) ? { description: boundedText(node.data.description) } : {}),
    documentId: options.document.id,
    kind: "node",
    label: boundedText(node.data.label) ?? renderer.id,
    nodeId: node.id,
    nodeKind: node.data.kind,
    rendererId: renderer.id,
    scopeId: options.scopeId,
    sections,
    ...(boundedText(node.data.status) ? { status: boundedText(node.data.status) } : {}),
    viewId: options.viewId,
  })
}

export function createCanvasSelectionProjection(options: {
  readonly document: CanvasDocument
  readonly renderers: CanvasInspectorRendererResolver
  readonly scopeId: string
  readonly selection: CanvasSelectionContext
  readonly viewId: string
}): CanvasSelectionProjection {
  const nodeIds =
    options.selection.kind === "single-node"
      ? [options.selection.nodeId]
      : options.selection.kind === "multi-node"
        ? [...options.selection.nodeIds]
        : []
  return Object.freeze({
    documentId: options.document.id,
    inspector: resolveCanvasInspectorProjection(options),
    kind: options.selection.kind,
    nodeIds: Object.freeze(nodeIds),
    scopeId: options.scopeId,
    viewId: options.viewId,
  })
}

export function matchesCanvasSelectionProjectionScope(
  projection: Pick<CanvasSelectionProjection, "documentId" | "scopeId" | "viewId">,
  scope: CanvasSelectionProjectionScope,
) {
  return (
    projection.documentId === scope.documentId &&
    projection.scopeId === scope.scopeId &&
    projection.viewId === scope.viewId
  )
}

/** Explicit opt-in shared by Convax's built-in file renderers. */
export const builtinCanvasInspectorContribution: CanvasInspectorContribution = Object.freeze({
  project(node: Readonly<CanvasNode>) {
    const data = node.data
    const fields: CanvasInspectorFieldInput[] = []
    if ("name" in data && typeof data.name === "string" && data.name.trim()) {
      fields.push({ id: "name", label: "Name", value: data.name })
    }
    if ("mimeType" in data && typeof data.mimeType === "string" && data.mimeType.trim()) {
      fields.push({ id: "mime-type", label: "Media type", value: data.mimeType })
    }
    if ("width" in data && typeof data.width === "number" && Number.isFinite(data.width)) {
      fields.push({ id: "intrinsic-width", label: "Intrinsic width", value: data.width })
    }
    if ("height" in data && typeof data.height === "number" && Number.isFinite(data.height)) {
      fields.push({ id: "intrinsic-height", label: "Intrinsic height", value: data.height })
    }
    if ("durationMs" in data && typeof data.durationMs === "number" && Number.isFinite(data.durationMs)) {
      fields.push({ id: "duration", label: "Duration", value: `${Math.max(0, data.durationMs)} ms` })
    }
    if (
      "resourceState" in data &&
      data.resourceState &&
      typeof data.resourceState === "object" &&
      "status" in data.resourceState &&
      typeof data.resourceState.status === "string"
    ) {
      fields.push({ id: "resource-status", label: "Resource", value: data.resourceState.status })
    }
    return fields.length > 0 ? [{ fields, id: "resource", label: "Resource" }] : []
  },
})
