import type { CanvasDocument, CanvasNode } from "./types"
import { isCanvasGroupFolded } from "./group-fold"

export type CanvasGroupPreviewKind = "file" | "image" | "text" | "video"

export interface CanvasGroupPreview {
  id: string
  kind: CanvasGroupPreviewKind
  label: string
  url?: string
}

export interface CanvasGroupSummary {
  externalIncomingCount: number
  externalOutgoingCount: number
  itemCount: number
  nestedGroupCount: number
  previews: readonly CanvasGroupPreview[]
}

export interface CanvasGroupFocusPathEntry {
  id: string
  label: string
}

export interface CanvasGroupFocusProjection {
  edges: CanvasDocument["edges"]
  focusedGroupId: string | null
  focusPath: readonly CanvasGroupFocusPathEntry[]
  parentGroupId: string | null
  scopeNodeIds: ReadonlySet<string>
  summaries: ReadonlyMap<string, CanvasGroupSummary>
  visibleNodeIds: ReadonlySet<string>
}

function isGroup(node: CanvasNode | undefined): node is CanvasNode {
  return node?.data.kind === "group"
}

function previewForNode(node: CanvasNode): CanvasGroupPreview {
  const resourceState = Reflect.get(node.data, "resourceState")
  const posterUrl =
    resourceState && typeof resourceState === "object" && typeof Reflect.get(resourceState, "posterUrl") === "string"
      ? Reflect.get(resourceState, "posterUrl")
      : undefined
  const url =
    resourceState && typeof resourceState === "object" && typeof Reflect.get(resourceState, "url") === "string"
      ? Reflect.get(resourceState, "url")
      : undefined
  if (node.data.kind === "image") {
    return {
      id: node.id,
      kind: "image",
      label: node.data.label,
      url: posterUrl ?? url,
    }
  }
  if (node.data.kind === "video") {
    return {
      id: node.id,
      kind: "video",
      label: node.data.label,
      url: posterUrl,
    }
  }
  if (node.data.kind === "text") return { id: node.id, kind: "text", label: node.data.label }
  return { id: node.id, kind: "file", label: node.data.label }
}

function previewPriority(preview: CanvasGroupPreview) {
  if (preview.kind === "image") return 0
  if (preview.kind === "video") return 1
  if (preview.kind === "text") return 2
  return 3
}

function createGroupSummaries(document: CanvasDocument) {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const ancestorsByNodeId = new Map<string, readonly string[]>()
  const ancestorsFor = (node: CanvasNode) => {
    const cached = ancestorsByNodeId.get(node.id)
    if (cached) return cached

    const path: CanvasNode[] = []
    const pathIds = new Set<string>()
    let current: CanvasNode | undefined = node
    let tail: readonly string[] = []
    while (current && !pathIds.has(current.id)) {
      const currentCached = ancestorsByNodeId.get(current.id)
      if (currentCached) {
        tail = currentCached
        break
      }
      path.push(current)
      pathIds.add(current.id)
      current = current.parentId ? nodeById.get(current.parentId) : undefined
    }
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const item = path[index]
      if (!item) continue
      const parent = item.parentId ? nodeById.get(item.parentId) : undefined
      const ancestors = (isGroup(parent) ? [parent.id, ...tail] : [...tail]).filter(
        (ancestorId) => ancestorId !== item.id,
      )
      ancestorsByNodeId.set(item.id, ancestors)
      tail = ancestors
    }
    return ancestorsByNodeId.get(node.id) ?? []
  }
  const summaries = new Map<
    string,
    CanvasGroupSummary & { previewCandidates: { index: number; preview: CanvasGroupPreview }[] }
  >()
  for (const node of document.nodes) {
    if (!isGroup(node)) continue
    summaries.set(node.id, {
      externalIncomingCount: 0,
      externalOutgoingCount: 0,
      itemCount: 0,
      nestedGroupCount: 0,
      previewCandidates: [],
      previews: [],
    })
  }
  document.nodes.forEach((node, index) => {
    for (const ancestorId of ancestorsFor(node)) {
      const summary = summaries.get(ancestorId)
      if (!summary) continue
      if (isGroup(node)) {
        summary.nestedGroupCount += 1
        continue
      }
      summary.itemCount += 1
      summary.previewCandidates.push({ index, preview: previewForNode(node) })
      summary.previewCandidates.sort(
        (left, right) => previewPriority(left.preview) - previewPriority(right.preview) || left.index - right.index,
      )
      if (summary.previewCandidates.length > 4) summary.previewCandidates.length = 4
    }
  })
  for (const edge of document.edges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue
    const sourceAncestors = new Set(ancestorsFor(source))
    const targetAncestors = new Set(ancestorsFor(target))
    for (const groupId of targetAncestors) {
      if (!sourceAncestors.has(groupId)) {
        const summary = summaries.get(groupId)
        if (summary) summary.externalIncomingCount += 1
      }
    }
    for (const groupId of sourceAncestors) {
      if (!targetAncestors.has(groupId)) {
        const summary = summaries.get(groupId)
        if (summary) summary.externalOutgoingCount += 1
      }
    }
    if (isGroup(target)) {
      const summary = summaries.get(target.id)
      if (summary) summary.externalIncomingCount += 1
    }
    if (isGroup(source)) {
      const summary = summaries.get(source.id)
      if (summary) summary.externalOutgoingCount += 1
    }
  }
  return new Map(
    [...summaries].map(([groupId, summary]) => [
      groupId,
      {
        externalIncomingCount: summary.externalIncomingCount,
        externalOutgoingCount: summary.externalOutgoingCount,
        itemCount: summary.itemCount,
        nestedGroupCount: summary.nestedGroupCount,
        previews: summary.previewCandidates.map(({ preview }) => preview),
      },
    ]),
  )
}

function createFocusPath(focusedGroup: CanvasNode | undefined, nodeById: ReadonlyMap<string, CanvasNode>) {
  const path: CanvasGroupFocusPathEntry[] = []
  const visited = new Set<string>()
  let current = focusedGroup
  while (isGroup(current) && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift({ id: current.id, label: current.data.label })
    current = current.parentId ? nodeById.get(current.parentId) : undefined
  }
  return path
}

export function projectCanvasGroupFocus(
  document: CanvasDocument,
  requestedFocusedGroupId?: string | null,
): CanvasGroupFocusProjection {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const requestedGroup = requestedFocusedGroupId ? nodeById.get(requestedFocusedGroupId) : undefined
  const focusedGroup = isGroup(requestedGroup) ? requestedGroup : undefined
  const focusedGroupId = focusedGroup?.id ?? null
  const scopeNodeIds = new Set(
    document.nodes
      .filter((node) => (focusedGroupId ? node.parentId === focusedGroupId : !node.parentId))
      .map((node) => node.id),
  )
  const visibleNodeIds = new Set(
    document.nodes
      .filter((node) => {
        if (node.id === focusedGroupId) return true
        const visited = new Set<string>()
        let current = node
        while (current.parentId) {
          if (visited.has(current.id)) return false
          visited.add(current.id)
          const parent = nodeById.get(current.parentId)
          if (!parent) return false
          if (parent.id === focusedGroupId) return true
          if (isCanvasGroupFolded(parent)) return false
          current = parent
        }
        return focusedGroupId === null
      })
      .map((node) => node.id),
  )
  const edgeEndpointIds = new Set(visibleNodeIds)
  if (focusedGroupId) edgeEndpointIds.delete(focusedGroupId)

  return {
    edges: document.edges.filter((edge) => edgeEndpointIds.has(edge.source) && edgeEndpointIds.has(edge.target)),
    focusedGroupId,
    focusPath: createFocusPath(focusedGroup, nodeById),
    parentGroupId:
      focusedGroup?.parentId && isGroup(nodeById.get(focusedGroup.parentId)) ? focusedGroup.parentId : null,
    scopeNodeIds,
    summaries: createGroupSummaries(document),
    visibleNodeIds,
  }
}

export function resolveCanvasGroupFocusForNodes(document: CanvasDocument, nodeIds: readonly string[]) {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const scopes = new Set(
    nodeIds.flatMap((nodeId) => {
      const node = nodeById.get(nodeId)
      if (!node) return []
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      return [isGroup(parent) ? parent.id : null]
    }),
  )
  if (scopes.size !== 1) return undefined
  return scopes.values().next().value ?? null
}
