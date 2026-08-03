import { getCanvasGroupColorValue, type CanvasGroupColor } from "@convax/canvas/core"
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  FolderGlyph,
  cn,
} from "@convax/ui"
import {
  AudioLines,
  Bot,
  Box,
  Boxes,
  ChevronRight,
  File,
  Folder,
  Image as ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  RotateCw,
  Trash2,
  Type,
  Video,
  X,
} from "lucide-react"
import { type Dispatch, type SetStateAction, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { ProjectCanvas } from "./contracts"
import { ProjectCanvasController } from "./controller"
import { PROJECT_CANVAS_DRAG_TYPE, serializeProjectCanvasDrag } from "./drag"

export interface ProjectCanvasSidebarProps {
  activeCanvasId: string | null
  activeNodes?: ProjectCanvasSidebarNodeProjection | null
  controller: ProjectCanvasController
  loadNodes?(input: { canvasId: string; projectId: string }): Promise<readonly ProjectCanvasSidebarNode[]>
  navigationBusy?: boolean
  navigationError?: string | null
  onActivate(canvasId: string): Promise<unknown> | unknown
  onClearNavigationError?(): void
  onCreate(): Promise<unknown> | unknown
  onDelete(canvasId: string): Promise<unknown> | unknown
  onNodeActivate?(input: { canvasId: string; nodeId: string }): Promise<unknown> | unknown
  query?: string
}

export interface ProjectCanvasSidebarNode {
  children?: readonly ProjectCanvasSidebarNode[]
  folderColor?: CanvasGroupColor
  id: string
  kind?: string
  label: string
  previewType?: "image" | "video"
  previewUrl?: string
}

export interface ProjectCanvasSidebarNodeProjection {
  canvasId: string
  nodes: readonly ProjectCanvasSidebarNode[]
  projectId: string
}

interface CanvasNodeLoadState {
  error?: string
  nodes: readonly ProjectCanvasSidebarNode[]
  projectId: string
  status: "error" | "loading" | "ready"
}

export function ProjectCanvasSidebar(props: ProjectCanvasSidebarProps) {
  const snapshot = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
    props.controller.getSnapshot,
  )
  const [editor, setEditor] = useState<{ canvasId: string; name: string; projectId: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ canvas: ProjectCanvas; projectId: string } | null>(null)
  const [expandedCanvasIds, setExpandedCanvasIds] = useState<ReadonlySet<string>>(
    () => new Set(props.activeCanvasId ? [props.activeCanvasId] : []),
  )
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [nodeLoadState, setNodeLoadState] = useState<Readonly<Record<string, CanvasNodeLoadState>>>({})
  const nodeLoadRequestsRef = useRef(new Map<string, number>())
  const nextNodeLoadRequestRef = useRef(0)
  const busy = snapshot.busy || Boolean(props.navigationBusy)
  const error = snapshot.error ?? props.navigationError
  const normalizedQuery = props.query?.trim().toLocaleLowerCase() ?? ""
  const visibleCanvases = normalizedQuery
    ? snapshot.canvases.filter((canvas) => {
        if (canvas.name.toLocaleLowerCase().includes(normalizedQuery)) return true
        const nodes = resolveCanvasNodes(canvas.id, snapshot.projectId, props.activeNodes, nodeLoadState)
        const canLoadOutline = Boolean(
          props.loadNodes ||
            (props.activeNodes?.projectId === snapshot.projectId && props.activeNodes.canvasId === canvas.id),
        )
        return (
          (nodes === undefined && canLoadOutline) ||
          nodes?.some((node) => projectCanvasNodeMatchesQuery(node, normalizedQuery)) === true
        )
      })
    : snapshot.canvases

  const loadCanvasNodes = async (canvasId: string, force = false) => {
    const projectId = snapshot.projectId
    if (!projectId || !props.loadNodes || !snapshot.canvases.some((canvas) => canvas.id === canvasId)) return
    const current = nodeLoadState[canvasId]
    if (!force && current?.projectId === projectId && (current.status === "loading" || current.status === "ready")) {
      return
    }
    const request = ++nextNodeLoadRequestRef.current
    nodeLoadRequestsRef.current.set(canvasId, request)
    setNodeLoadState((states) => ({
      ...states,
      [canvasId]: {
        nodes: states[canvasId]?.projectId === projectId ? (states[canvasId]?.nodes ?? []) : [],
        projectId,
        status: "loading",
      },
    }))
    try {
      const nodes = await props.loadNodes({ canvasId, projectId })
      const live = props.controller.getSnapshot()
      if (
        nodeLoadRequestsRef.current.get(canvasId) !== request ||
        live.projectId !== projectId ||
        !live.canvases.some((canvas) => canvas.id === canvasId)
      ) {
        return
      }
      setNodeLoadState((states) => ({
        ...states,
        [canvasId]: { nodes: [...nodes], projectId, status: "ready" },
      }))
    } catch (failure) {
      const live = props.controller.getSnapshot()
      if (nodeLoadRequestsRef.current.get(canvasId) !== request || live.projectId !== projectId) return
      setNodeLoadState((states) => ({
        ...states,
        [canvasId]: {
          error: failure instanceof Error ? failure.message : String(failure),
          nodes: states[canvasId]?.projectId === projectId ? (states[canvasId]?.nodes ?? []) : [],
          projectId,
          status: "error",
        },
      }))
    }
  }

  useEffect(() => {
    setEditor(null)
    setPendingDelete(null)
    nodeLoadRequestsRef.current.clear()
    setNodeLoadState({})
    setExpandedCanvasIds(new Set(props.activeCanvasId ? [props.activeCanvasId] : []))
    setExpandedNodeKeys(new Set())
  }, [snapshot.projectId])

  useEffect(() => {
    const canvasId = props.activeCanvasId
    if (!canvasId || !snapshot.canvases.some((canvas) => canvas.id === canvasId)) return
    setExpandedCanvasIds((current) => (current.has(canvasId) ? current : new Set([...current, canvasId])))
    void loadCanvasNodes(canvasId)
  }, [props.activeCanvasId, snapshot.projectId])

  useEffect(() => {
    if (!normalizedQuery) return
    for (const canvas of snapshot.canvases) void loadCanvasNodes(canvas.id)
  }, [normalizedQuery, snapshot.projectId])

  useEffect(() => {
    if (!pendingDelete) return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setPendingDelete(null)
    }
    document.addEventListener("keydown", dismissOnEscape)
    return () => document.removeEventListener("keydown", dismissOnEscape)
  }, [pendingDelete])

  const commitEditor = async () => {
    const current = editor
    setEditor(null)
    if (
      current?.name.trim() &&
      current.projectId === snapshot.projectId &&
      snapshot.canvases.some((canvas) => canvas.id === current.canvasId)
    ) {
      await props.controller.renameCanvas(current.canvasId, current.name)
    }
  }
  const beginRename = (canvas: ProjectCanvas) => {
    if (!snapshot.projectId) return
    setEditor({ canvasId: canvas.id, name: canvas.name, projectId: snapshot.projectId })
  }
  const beginDelete = (canvas: ProjectCanvas) => {
    if (!snapshot.projectId) return
    setPendingDelete({ canvas, projectId: snapshot.projectId })
  }

  if (snapshot.canvases.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
        <PanelsTopLeft className="size-6 opacity-60" />
        <span>{busy ? "Loading canvases…" : "No canvases yet."}</span>
        {!busy ? (
          <button
            className="font-medium text-primary hover:underline"
            disabled={busy}
            onClick={() => void props.onCreate()}
            type="button"
          >
            Create a canvas
          </button>
        ) : null}
      </div>
    )
  }

  if (visibleCanvases.length === 0) {
    return (
      <div
        className="grid min-h-0 flex-1 place-items-center px-5 text-center text-xs text-muted-foreground"
        role="status"
      >
        No matching canvases.
      </div>
    )
  }

  return (
    <>
      <div
        aria-label="Project canvases"
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-2"
        role="tree"
      >
        {visibleCanvases.map((canvas) => {
          const active = canvas.id === props.activeCanvasId
          const canDelete = snapshot.canvases.length > 1
          const editing = editor?.canvasId === canvas.id
          const hasActiveNodeProjection =
            props.activeNodes?.projectId === snapshot.projectId && props.activeNodes.canvasId === canvas.id
          const showsNodeOutline = Boolean(props.loadNodes || hasActiveNodeProjection)
          const nodes = resolveCanvasNodes(canvas.id, snapshot.projectId, props.activeNodes, nodeLoadState)
          const hasMatchingNode = Boolean(
            normalizedQuery && nodes?.some((node) => projectCanvasNodeMatchesQuery(node, normalizedQuery)),
          )
          const expanded = showsNodeOutline && (expandedCanvasIds.has(canvas.id) || hasMatchingNode)
          const loadState = nodeLoadState[canvas.id]
          const toggleCanvasOutline = () => {
            if (!showsNodeOutline) return
            setExpandedCanvasIds((current) => {
              const next = new Set(current)
              if (expanded) {
                next.delete(canvas.id)
              } else {
                next.add(canvas.id)
              }
              return next
            })
            if (!expanded) void loadCanvasNodes(canvas.id)
          }
          const row = (
            <div
              className={cn(
                "group my-0.5 flex h-7 items-center rounded-md pr-1 text-[13px] outline-none transition-transform duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-focus-ring/40 motion-reduce:transition-none",
                active
                  ? "bg-interactive-selected font-medium text-text-primary"
                  : "text-text-secondary hover:bg-interactive-hover hover:text-text-primary active:bg-interactive-pressed",
              )}
              data-project-canvas-row=""
              draggable={!editing}
              onClick={() => {
                if (editing || busy) return
                if (active && showsNodeOutline) toggleCanvasOutline()
                else void props.onActivate(canvas.id)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                if (!editing) beginRename(canvas)
              }}
              onDragStart={(event) => {
                if (!snapshot.projectId) return
                event.dataTransfer.effectAllowed = "copy"
                event.dataTransfer.setData(
                  PROJECT_CANVAS_DRAG_TYPE,
                  serializeProjectCanvasDrag({
                    canvas: { id: canvas.id, name: canvas.name },
                    projectId: snapshot.projectId,
                    version: 1,
                  }),
                )
                event.dataTransfer.setData("text/plain", canvas.name)
              }}
              onKeyDown={(event) => {
                if (editing || event.target !== event.currentTarget) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  if (!busy) {
                    if (active && showsNodeOutline) toggleCanvasOutline()
                    else void props.onActivate(canvas.id)
                  }
                }
                if (event.key === "F2") beginRename(canvas)
                if ((event.key === "Delete" || event.key === "Backspace") && canDelete) beginDelete(canvas)
              }}
              tabIndex={active || (!props.activeCanvasId && visibleCanvases[0]?.id === canvas.id) ? 0 : -1}
            >
              <span aria-hidden className="w-4 shrink-0" data-project-canvas-indent="" />
              {showsNodeOutline ? (
                <button
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${canvas.name} nodes`}
                  className="grid size-6 shrink-0 place-items-center rounded text-text-tertiary outline-none hover:bg-interactive-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus-ring/40"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    toggleCanvasOutline()
                  }}
                  type="button"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                      expanded && "rotate-90",
                    )}
                  />
                </button>
              ) : (
                <span className="size-6 shrink-0" />
              )}
              <PanelsTopLeft className={cn("size-4 shrink-0", active ? "text-brand" : "text-text-tertiary")} />
              {editing ? (
                <InlineInput
                  label={`Rename ${canvas.name}`}
                  onCancel={() => setEditor(null)}
                  onChange={(name) => setEditor((current) => (current ? { ...current, name } : null))}
                  onCommit={commitEditor}
                  value={editor?.name ?? ""}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate px-1.5">{canvas.name}</span>
              )}
              {!editing ? (
                <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                  <button
                    aria-label={`More actions for ${canvas.name}`}
                    className="grid size-6 place-items-center rounded-md text-text-tertiary outline-none transition-transform duration-100 hover:bg-interactive-hover hover:text-text-primary active:scale-95 active:bg-interactive-pressed focus-visible:ring-2 focus-visible:ring-focus-ring/40 motion-reduce:transition-none"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const row = event.currentTarget.closest<HTMLElement>("[data-project-canvas-id]")
                      const bounds = event.currentTarget.getBoundingClientRect()
                      row?.dispatchEvent(
                        new MouseEvent("contextmenu", {
                          bubbles: true,
                          button: 2,
                          clientX: bounds.right,
                          clientY: bounds.bottom + 4,
                        }),
                      )
                    }}
                    type="button"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </span>
              ) : null}
            </div>
          )
          return (
            <div
              aria-expanded={showsNodeOutline ? expanded : undefined}
              aria-selected={active}
              data-project-canvas-id={canvas.id}
              key={canvas.id}
              role="treeitem"
            >
              <ContextMenu>
                <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                <ContextMenuContent className="min-w-40">
                  <ContextMenuItem onSelect={() => beginRename(canvas)}>
                    <Pencil />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive"
                    disabled={!canDelete}
                    onSelect={() => beginDelete(canvas)}
                  >
                    <Trash2 />
                    Delete canvas
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {expanded ? (
                <div className="mb-1 ml-7 border-l border-border-subtle pl-2" role="group">
                  {!hasActiveNodeProjection &&
                  loadState?.projectId === snapshot.projectId &&
                  loadState.status === "loading" &&
                  !nodes?.length ? (
                    <div className="flex h-8 items-center gap-2 px-2 text-[11px] text-text-tertiary" role="status">
                      <LoaderCircle className="size-3 animate-spin" />
                      Loading nodes…
                    </div>
                  ) : !hasActiveNodeProjection &&
                    loadState?.projectId === snapshot.projectId &&
                    loadState.status === "error" &&
                    !nodes?.length ? (
                    <button
                      className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-status-danger hover:bg-interactive-hover"
                      onClick={() => void loadCanvasNodes(canvas.id, true)}
                      title={loadState.error}
                      type="button"
                    >
                      <RotateCw className="size-3 shrink-0" />
                      Could not load nodes. Retry
                    </button>
                  ) : nodes?.length ? (
                    <ProjectCanvasNodeRows
                      canvasId={canvas.id}
                      expandedNodeKeys={expandedNodeKeys}
                      nodes={nodes}
                      onActivate={props.onNodeActivate}
                      query={normalizedQuery}
                      setExpandedNodeKeys={setExpandedNodeKeys}
                    />
                  ) : (
                    <div className="flex h-8 items-center px-2 text-[11px] text-text-tertiary" role="status">
                      No nodes
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {error ? (
        <div className="absolute inset-x-3 bottom-11 z-30 flex items-start gap-2 rounded-lg border border-destructive/25 bg-popover p-2.5 text-xs shadow-lg">
          <span className="min-w-0 flex-1">{error}</span>
          <button
            aria-label="Dismiss project canvas error"
            onClick={() => {
              props.controller.clearError()
              props.onClearNavigationError?.()
            }}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {pendingDelete ? (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-foreground/20 p-5 backdrop-blur-[2px]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null)
          }}
        >
          <div
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 shadow-2xl"
            role="dialog"
          >
            <h2 className="text-sm font-semibold">Delete canvas?</h2>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              “{pendingDelete.canvas.name}” and its canvas document will be deleted. Project files are not affected.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setPendingDelete(null)} size="sm" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (pendingDelete.projectId !== snapshot.projectId) return setPendingDelete(null)
                  void Promise.resolve(props.onDelete(pendingDelete.canvas.id)).then(() => setPendingDelete(null))
                }}
                size="sm"
                variant="destructive"
              >
                Delete canvas
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function ProjectCanvasNodeRows({
  canvasId,
  depth = 0,
  expandedNodeKeys,
  nodes,
  onActivate,
  query,
  setExpandedNodeKeys,
}: {
  canvasId: string
  depth?: number
  expandedNodeKeys: ReadonlySet<string>
  nodes: readonly ProjectCanvasSidebarNode[]
  onActivate?: ProjectCanvasSidebarProps["onNodeActivate"]
  query: string
  setExpandedNodeKeys: Dispatch<SetStateAction<ReadonlySet<string>>>
}) {
  return nodes.map((node) => {
    const children = node.children ?? []
    const expandable = children.length > 0
    const nodeKey = `${canvasId}:${node.id}`
    const revealsQueryMatch = Boolean(query && children.some((child) => projectCanvasNodeMatchesQuery(child, query)))
    const expanded = expandable && (expandedNodeKeys.has(nodeKey) || revealsQueryMatch)
    const setExpanded = (nextExpanded: boolean) => {
      setExpandedNodeKeys((current) => {
        const next = new Set(current)
        if (nextExpanded) next.add(nodeKey)
        else next.delete(nodeKey)
        return next
      })
    }

    return (
      <div aria-expanded={expandable ? expanded : undefined} key={node.id} role="treeitem">
        <button
          className="group/node flex min-h-8 w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[12px] text-text-tertiary outline-none hover:bg-interactive-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus-ring/40"
          data-project-canvas-node-depth={depth}
          data-project-canvas-node-id={node.id}
          onClick={() => {
            if (expandable) setExpanded(!expanded)
            else void onActivate?.({ canvasId, nodeId: node.id })
          }}
          onKeyDown={(event) => {
            if (!expandable) return
            if (event.key === "ArrowRight" && !expanded) {
              event.preventDefault()
              setExpanded(true)
            }
            if (event.key === "ArrowLeft" && expanded) {
              event.preventDefault()
              setExpanded(false)
            }
          }}
          style={{ paddingInlineStart: `${4 + depth * 16}px` }}
          title={node.label}
          type="button"
        >
          <span
            aria-hidden
            className="grid size-4 shrink-0 place-items-center text-text-tertiary"
            data-project-canvas-node-disclosure={expandable ? (expanded ? "expanded" : "collapsed") : "leaf"}
          >
            {expandable ? (
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                  expanded && "rotate-90",
                )}
              />
            ) : null}
          </span>
          <ProjectCanvasNodePreview
            folderColor={node.folderColor}
            kind={node.kind}
            previewType={node.previewType}
            previewUrl={node.previewUrl}
          />
          <span className="min-w-0 flex-1 truncate">{node.label}</span>
        </button>
        {expanded ? (
          <div role="group">
            <ProjectCanvasNodeRows
              canvasId={canvasId}
              depth={depth + 1}
              expandedNodeKeys={expandedNodeKeys}
              nodes={children}
              onActivate={onActivate}
              query={query}
              setExpandedNodeKeys={setExpandedNodeKeys}
            />
          </div>
        ) : null}
      </div>
    )
  })
}

function projectCanvasNodeMatchesQuery(node: ProjectCanvasSidebarNode, query: string): boolean {
  return (
    `${node.label} ${node.kind ?? ""}`.toLocaleLowerCase().includes(query) ||
    (node.children ?? []).some((child) => projectCanvasNodeMatchesQuery(child, query))
  )
}

function ProjectCanvasNodePreview({
  folderColor,
  kind = "unknown",
  previewType = kind === "video" ? "video" : "image",
  previewUrl,
}: {
  folderColor?: CanvasGroupColor
  kind?: string
  previewType?: "image" | "video"
  previewUrl?: string
}) {
  const [previewFailed, setPreviewFailed] = useState(false)
  useEffect(() => setPreviewFailed(false), [previewUrl])

  if (folderColor) {
    return (
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center"
        data-project-canvas-node-folder-color={folderColor}
        data-project-canvas-node-icon="fold"
      >
        <FolderGlyph color={getCanvasGroupColorValue(folderColor)} size="compact" />
      </span>
    )
  }

  if (previewUrl && !previewFailed) {
    return (
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center overflow-hidden rounded border border-border-subtle bg-surface-inset"
        data-project-canvas-node-preview={kind}
      >
        {previewType === "video" ? (
          <video
            className="size-full object-cover"
            muted
            onError={() => setPreviewFailed(true)}
            playsInline
            preload="metadata"
            src={previewUrl}
          />
        ) : (
          <img
            alt=""
            className="size-full object-cover"
            draggable={false}
            loading="lazy"
            onError={() => setPreviewFailed(true)}
            src={previewUrl}
          />
        )}
      </span>
    )
  }

  const icon =
    kind === "text" ? (
      <Type />
    ) : kind === "image" ? (
      <ImageIcon />
    ) : kind === "video" ? (
      <Video />
    ) : kind === "audio" ? (
      <AudioLines />
    ) : kind === "folder" ? (
      <Folder />
    ) : kind === "agent" ? (
      <Bot />
    ) : kind === "group" ? (
      <Boxes />
    ) : kind === "file" ? (
      <File />
    ) : (
      <Box />
    )

  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded bg-surface-inset text-text-tertiary [&>svg]:size-3.5"
      data-project-canvas-node-icon={kind}
    >
      {icon}
    </span>
  )
}

function resolveCanvasNodes(
  canvasId: string,
  projectId: string | null,
  activeNodes: ProjectCanvasSidebarNodeProjection | null | undefined,
  loadState: Readonly<Record<string, CanvasNodeLoadState>>,
) {
  if (projectId && activeNodes?.projectId === projectId && activeNodes.canvasId === canvasId) return activeNodes.nodes
  const loaded = loadState[canvasId]
  return loaded?.projectId === projectId ? loaded.nodes : undefined
}

function InlineInput(props: {
  label: string
  onCancel: () => void
  onChange: (value: string) => void
  onCommit: () => Promise<void>
  value: string
}) {
  const committing = useRef(false)
  const canceled = useRef(false)
  const commit = () => {
    if (canceled.current || committing.current) return
    committing.current = true
    void props.onCommit().finally(() => {
      committing.current = false
    })
  }
  return (
    <input
      aria-label={props.label}
      autoFocus
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/25"
      onBlur={commit}
      onInput={(event) => props.onChange(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Enter") {
          event.preventDefault()
          commit()
        }
        if (event.key === "Escape") {
          event.preventDefault()
          canceled.current = true
          props.onCancel()
        }
      }}
      value={props.value}
    />
  )
}
