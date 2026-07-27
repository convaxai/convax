import { ChevronRight, File, Folder, MessageSquareText } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import type { CanvasDocument, CanvasNode } from "../types"
import type { CanvasViewSession } from "../view"

export interface CanvasOutlineEntry {
  children: readonly CanvasOutlineEntry[]
  depth: number
  id: string
  kind: string
  label: string
  parentId?: string
}

function compareCanvasOutlineNodes(left: CanvasNode, right: CanvasNode) {
  return (
    left.position.y - right.position.y ||
    left.position.x - right.position.x ||
    left.data.label.localeCompare(right.data.label) ||
    left.id.localeCompare(right.id)
  )
}

/**
 * Builds a deterministic, host-neutral outline solely from the portable Canvas
 * document. It does not require mounted React Flow nodes or inspect the DOM.
 */
export function projectCanvasOutline(document: Readonly<CanvasDocument>): readonly CanvasOutlineEntry[] {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const childrenByParent = new Map<string | undefined, CanvasNode[]>()
  for (const node of document.nodes) {
    const parentId = node.parentId && nodesById.has(node.parentId) ? node.parentId : undefined
    const children = childrenByParent.get(parentId) ?? []
    children.push(node)
    childrenByParent.set(parentId, children)
  }
  for (const children of childrenByParent.values()) children.sort(compareCanvasOutlineNodes)

  const visited = new Set<string>()
  const visit = (node: CanvasNode, depth: number): CanvasOutlineEntry | undefined => {
    if (visited.has(node.id)) return undefined
    visited.add(node.id)
    const children = (childrenByParent.get(node.id) ?? [])
      .map((child) => visit(child, depth + 1))
      .filter((entry): entry is CanvasOutlineEntry => Boolean(entry))
    return {
      children,
      depth,
      id: node.id,
      kind: node.data.kind,
      label: node.data.label || "Untitled",
      ...(node.parentId && nodesById.has(node.parentId) ? { parentId: node.parentId } : {}),
    }
  }

  const roots = (childrenByParent.get(undefined) ?? [])
    .map((node) => visit(node, 0))
    .filter((entry): entry is CanvasOutlineEntry => Boolean(entry))
  // Fail closed but keep malformed/cyclic in-memory projections discoverable.
  for (const node of [...document.nodes].sort(compareCanvasOutlineNodes)) {
    const entry = visit(node, 0)
    if (entry) roots.push(entry)
  }
  return roots
}

export function activateCanvasOutlineEntry(session: Pick<CanvasViewSession, "execute">, nodeId: string) {
  return session.execute({
    animation: "smooth",
    fit: "center",
    nodeIds: [nodeId],
    select: true,
    type: "nodes.reveal",
  })
}

export interface CanvasOutlineProps {
  activeNodeIds?: ReadonlySet<string>
  className?: string
  document: Readonly<CanvasDocument>
  empty?: ReactNode
  onActivate?: (entry: CanvasOutlineEntry) => void
  onActivationError?: (error: unknown) => void
  viewSession?: Pick<CanvasViewSession, "execute">
}

function CanvasOutlineRows({
  activeNodeIds,
  entries,
  onActivate,
}: {
  activeNodeIds: ReadonlySet<string>
  entries: readonly CanvasOutlineEntry[]
  onActivate: (entry: CanvasOutlineEntry) => void
}) {
  return entries.map((entry) => {
    const isGroup = entry.kind === "group"
    const Icon = isGroup ? Folder : entry.kind === "agent" ? MessageSquareText : File
    return (
      <Fragment key={entry.id}>
        <li>
          <button
            aria-current={activeNodeIds.has(entry.id) ? "location" : undefined}
            className="convax-canvas-outline__item"
            onClick={() => onActivate(entry)}
            style={{ paddingInlineStart: `${10 + entry.depth * 18}px` }}
            type="button"
          >
            <span aria-hidden className="convax-canvas-outline__disclosure">
              {entry.children.length > 0 ? <ChevronRight /> : null}
            </span>
            <Icon aria-hidden />
            <span className="convax-canvas-outline__label">{entry.label}</span>
          </button>
        </li>
        {entry.children.length > 0 ? (
          <CanvasOutlineRows
            activeNodeIds={activeNodeIds}
            entries={entry.children}
            onActivate={onActivate}
          />
        ) : null}
      </Fragment>
    )
  })
}

export function CanvasOutline({
  activeNodeIds = new Set(),
  className,
  document,
  empty = <div className="convax-canvas-outline__empty">This Canvas is empty.</div>,
  onActivate,
  onActivationError,
  viewSession,
}: CanvasOutlineProps) {
  const entries = projectCanvasOutline(document)
  const activate = (entry: CanvasOutlineEntry) => {
    onActivate?.(entry)
    if (viewSession) {
      void activateCanvasOutlineEntry(viewSession, entry.id).catch((error) => onActivationError?.(error))
    }
  }
  return (
    <nav aria-label="Canvas outline" className={className}>
      {entries.length > 0 ? (
        <ul className="convax-canvas-outline">
          <CanvasOutlineRows activeNodeIds={activeNodeIds} entries={entries} onActivate={activate} />
        </ul>
      ) : (
        empty
      )}
    </nav>
  )
}
