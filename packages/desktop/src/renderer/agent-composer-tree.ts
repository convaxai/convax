import type { AgentResource } from "@convax/agent-runtime"
import type { CanvasDocument, CanvasNode } from "@convax/canvas"
import type { ProjectEntry } from "@convax/project-files"
import type { ProjectCanvas } from "@convax/project/canvas"
import { createAgentCanvasNodeResource } from "../agent-canvas-context"
import { canvasAgentResource } from "./agent-panel-state"

export type AgentReferenceTreeSection = "canvas" | "project"

export interface AgentReferenceTreeRow {
  active?: boolean
  depth: number
  description?: string
  expandable: boolean
  expanded: boolean
  id: string
  kind: "canvas" | "directory" | "file" | "group" | "node"
  label: string
  parentId?: string
  resource: AgentResource
  section: AgentReferenceTreeSection
}

export function buildAgentProjectReferenceTree(input: {
  expandedPaths: ReadonlySet<string>
  listings: ReadonlyMap<string, readonly ProjectEntry[]>
}) {
  const rows: AgentReferenceTreeRow[] = []
  const visit = (directoryPath: string, depth: number, parentId?: string) => {
    for (const entry of input.listings.get(directoryPath) ?? []) {
      const id = `project:${entry.kind}:${entry.path}`
      const expanded = entry.kind === "directory" && input.expandedPaths.has(entry.path)
      rows.push({
        depth,
        description: entry.path === entry.name ? undefined : entry.path,
        expandable: entry.kind === "directory",
        expanded,
        id,
        kind: entry.kind,
        label: entry.name,
        ...(parentId ? { parentId } : {}),
        resource: { kind: entry.kind, name: entry.name, path: entry.path },
        section: "project",
      })
      if (expanded) visit(entry.path, depth + 1, id)
    }
  }
  visit("", 0)
  return rows
}

export function buildAgentCanvasReferenceTree(input: {
  activeCanvasId?: string
  canvases: readonly ProjectCanvas[]
  documents: ReadonlyMap<string, CanvasDocument>
  expandedIds: ReadonlySet<string>
}) {
  const rows: AgentReferenceTreeRow[] = []
  for (const canvas of input.canvases) {
    const rootId = `canvas:${canvas.id}`
    const expanded = input.expandedIds.has(rootId)
    rows.push({
      active: canvas.id === input.activeCanvasId,
      depth: 0,
      expandable: true,
      expanded,
      id: rootId,
      kind: "canvas",
      label: canvas.name,
      resource: canvasAgentResource(canvas),
      section: "canvas",
    })
    if (!expanded) continue
    const document = input.documents.get(canvas.id)
    if (!document) continue
    const children = new Map<string | undefined, CanvasNode[]>()
    for (const node of document.nodes) {
      const siblings = children.get(node.parentId) ?? []
      siblings.push(node)
      children.set(node.parentId, siblings)
    }
    const visit = (parentNodeId: string | undefined, depth: number, parentId: string) => {
      for (const node of children.get(parentNodeId) ?? []) {
        const id = `canvas-node:${canvas.id}:${node.id}`
        const expandable = (children.get(node.id)?.length ?? 0) > 0
        const nodeExpanded = expandable && input.expandedIds.has(id)
        rows.push({
          depth,
          description: node.data.kind,
          expandable,
          expanded: nodeExpanded,
          id,
          kind: node.data.kind === "group" ? "group" : "node",
          label: node.data.label,
          parentId,
          resource: createAgentCanvasNodeResource(canvas.id, node.id, node.data.label),
          section: "canvas",
        })
        if (nodeExpanded) visit(node.id, depth + 1, id)
      }
    }
    visit(undefined, 1, rootId)
  }
  return rows
}

export function filterAgentReferenceTree(rows: readonly AgentReferenceTreeRow[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...rows]
  const byId = new Map(rows.map((row) => [row.id, row]))
  const visible = new Set<string>()
  for (const row of rows) {
    if (!agentReferenceSearchText(row).toLocaleLowerCase().includes(normalized)) continue
    let current: AgentReferenceTreeRow | undefined = row
    while (current && !visible.has(current.id)) {
      visible.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return rows.filter((row) => visible.has(row.id))
}

export function moveAgentReferenceTreeActive(
  rows: readonly AgentReferenceTreeRow[],
  activeId: string | undefined,
  direction: "child" | "down" | "parent" | "up",
) {
  if (!rows.length) return undefined
  const index = activeId ? rows.findIndex((row) => row.id === activeId) : -1
  if (direction === "down") return rows[index < 0 ? 0 : (index + 1) % rows.length]?.id
  if (direction === "up") return rows[index < 0 ? rows.length - 1 : (index - 1 + rows.length) % rows.length]?.id
  const current = index < 0 ? undefined : rows[index]
  if (direction === "parent") return current?.parentId ?? current?.id
  const child = current ? rows.find((row) => row.parentId === current.id) : undefined
  return child?.id ?? current?.id ?? rows[0]?.id
}

function agentReferenceSearchText(row: AgentReferenceTreeRow) {
  const identity =
    row.resource.kind === "resource"
      ? row.resource.uri
      : row.resource.kind === "skill"
        ? row.resource.name
        : row.resource.path
  return `${row.label} ${row.description ?? ""} ${identity}`
}
