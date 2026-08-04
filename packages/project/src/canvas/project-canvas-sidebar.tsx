import {
  getCanvasGroupColorValue,
  getCanvasGroupEmoji,
  type CanvasGroupColor,
  type CanvasGroupEmoji,
} from "@convax/canvas/core"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FolderGlyph,
  Tooltip,
  cn,
} from "@convax/ui"
import {
  AudioLines,
  Bot,
  Box,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  Image as ImageIcon,
  ListFilter,
  LoaderCircle,
  PanelsTopLeft,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  Type,
  Video,
  X,
} from "lucide-react"
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { ProjectCanvas } from "./contracts"
import { ProjectCanvasController } from "./controller"
import { PROJECT_CANVAS_DRAG_TYPE, serializeProjectCanvasDrag } from "./drag"

export interface ProjectCanvasSidebarProps {
  activeCanvasId: string | null
  activeNodes?: ProjectCanvasSidebarNodeProjection | null
  controller: ProjectCanvasController
  filteredKinds?: ReadonlySet<string>
  loadNodes?(input: { canvasId: string; projectId: string }): Promise<readonly ProjectCanvasSidebarNode[]>
  creationUnavailableReason?: string
  navigationBusy?: boolean
  navigationError?: string | null
  /** @deprecated Compose ProjectCanvasSwitcher in the ProjectSidebar header instead. */
  onActivate?(canvasId: string): Promise<unknown> | unknown
  onClearNavigationError?(): void
  /** @deprecated Compose the Canvas create action in the ProjectSidebar header instead. */
  onCreate?(): Promise<unknown> | unknown
  /** @deprecated Compose ProjectCanvasSwitcher in the ProjectSidebar header instead. */
  onDelete?(canvasId: string): Promise<unknown> | unknown
  onNodeActivate?(input: { canvasId: string; nodeId: string }): Promise<unknown> | unknown
  onNodesResolved?(projection: ProjectCanvasSidebarNodeProjection): void
  query?: string
}

export interface ProjectCanvasSwitcherProps {
  activeCanvasId: string | null
  controller: ProjectCanvasController
  disabled?: boolean
  onActivate(canvasId: string): Promise<unknown> | unknown
  onDelete(canvasId: string): Promise<unknown> | unknown
}

export interface ProjectCanvasSidebarToolsProps {
  filteredKinds: ReadonlySet<string>
  nodes: readonly ProjectCanvasSidebarNode[]
  onFilteredKindsChange(kinds: ReadonlySet<string>): void
}

export interface ProjectCanvasSidebarNode {
  children?: readonly ProjectCanvasSidebarNode[]
  folderColor?: CanvasGroupColor
  folderEmoji?: CanvasGroupEmoji
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

export interface ProjectCanvasLeafKindSummary {
  count: number
  kind: string
  label: string
}

interface CanvasNodeLoadState {
  error?: string
  nodes: readonly ProjectCanvasSidebarNode[]
  projectId: string
  status: "error" | "loading" | "ready"
}

const canvasLeafKindOrder = ["text", "image", "video", "audio", "folder", "file", "agent", "plugin", "unknown"]
const canvasLeafKindLabels: Readonly<Record<string, string>> = {
  agent: "Agent",
  audio: "Audio",
  file: "File",
  folder: "Folder",
  image: "Image",
  plugin: "Plugin",
  text: "Text",
  unknown: "Other",
  video: "Video",
}

export function ProjectCanvasSwitcher(props: ProjectCanvasSwitcherProps) {
  const snapshot = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
    props.controller.getSnapshot,
  )
  const activeCanvas = snapshot.canvases.find((canvas) => canvas.id === props.activeCanvasId)
  const [editor, setEditor] = useState<{ canvasId: string; name: string; projectId: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ canvas: ProjectCanvas; projectId: string } | null>(null)
  const busy = snapshot.busy || Boolean(props.disabled)

  useEffect(() => {
    setEditor(null)
    setPendingDelete(null)
  }, [snapshot.projectId])

  useEffect(() => {
    if (editor && !snapshot.canvases.some((canvas) => canvas.id === editor.canvasId)) setEditor(null)
    if (pendingDelete && !snapshot.canvases.some((canvas) => canvas.id === pendingDelete.canvas.id)) {
      setPendingDelete(null)
    }
  }, [editor, pendingDelete, snapshot.canvases])

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

  const writeCanvasDrag = (event: DragEvent<HTMLElement>, canvas: ProjectCanvas) => {
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
  }

  return (
    <>
      {editor && activeCanvas?.id === editor.canvasId ? (
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1 px-1" data-project-canvas-switcher-editor="">
          <PanelsTopLeft className="size-3.5 shrink-0 text-brand" />
          <InlineInput
            label={`Rename ${activeCanvas.name}`}
            onCancel={() => setEditor(null)}
            onChange={(name) => setEditor((current) => (current ? { ...current, name } : null))}
            onCommit={commitEditor}
            value={editor.name}
          />
        </div>
      ) : (
        <DropdownMenu disabled={!activeCanvas || busy}>
          <DropdownMenuTrigger
            aria-label={activeCanvas ? `Switch canvas, current ${activeCanvas.name}` : "Select canvas"}
            className="h-7 min-w-0 flex-1 justify-start gap-1 border-transparent px-1 text-xs font-semibold text-text-secondary shadow-none"
            data-project-canvas-switcher=""
            draggable={Boolean(activeCanvas)}
            onDragStart={(event) => {
              if (activeCanvas) writeCanvasDrag(event, activeCanvas)
            }}
            size="compact"
            variant="ghost"
          >
            <PanelsTopLeft className="size-3.5 shrink-0 text-brand" />
            <span className="min-w-0 flex-1 truncate text-left">{activeCanvas?.name ?? "Select canvas"}</span>
            <ChevronDown className="size-3 shrink-0 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
            {snapshot.canvases.map((canvas) => {
              const active = canvas.id === activeCanvas?.id
              return (
                <DropdownMenuItem
                  data-project-canvas-option={canvas.id}
                  draggable
                  key={canvas.id}
                  onDragStart={(event) => writeCanvasDrag(event, canvas)}
                  onSelect={() => {
                    if (!active && !busy) void props.onActivate(canvas.id)
                  }}
                >
                  <Check className={cn("size-3.5", !active && "invisible")} />
                  <PanelsTopLeft className={cn("size-4", active && "text-brand")} />
                  <span className="min-w-0 flex-1 truncate">{canvas.name}</span>
                </DropdownMenuItem>
              )
            })}
            {activeCanvas ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    if (!snapshot.projectId) return
                    setEditor({ canvasId: activeCanvas.id, name: activeCanvas.name, projectId: snapshot.projectId })
                  }}
                >
                  <Pencil />
                  Rename canvas
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={snapshot.canvases.length <= 1}
                  onSelect={() => {
                    if (snapshot.projectId) setPendingDelete({ canvas: activeCanvas, projectId: snapshot.projectId })
                  }}
                >
                  <Trash2 />
                  Delete canvas
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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

export function ProjectCanvasSidebarTools(props: ProjectCanvasSidebarToolsProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const filterContentRef = useRef<HTMLDivElement | null>(null)
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null)
  const summaries = useMemo(() => summarizeProjectCanvasLeaves(props.nodes), [props.nodes])
  const options = useMemo(() => {
    const byKind = new Map(summaries.map((summary) => [summary.kind, summary]))
    for (const kind of props.filteredKinds) {
      if (!byKind.has(kind)) byKind.set(kind, { count: 0, kind, label: canvasLeafKindLabel(kind) })
    }
    return sortCanvasLeafSummaries([...byKind.values()])
  }, [props.filteredKinds, summaries])

  const toggleKind = (kind: string) => {
    const next = new Set(props.filteredKinds)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    props.onFilteredKindsChange(next)
  }

  useEffect(() => {
    if (!filterOpen) return
    const ownerDocument = filterTriggerRef.current?.ownerDocument
    if (!ownerDocument) return
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target
      const NodeConstructor = ownerDocument.defaultView?.Node
      if (!NodeConstructor || !(target instanceof NodeConstructor)) return
      if (filterTriggerRef.current?.contains(target) || filterContentRef.current?.contains(target)) return
      setFilterOpen(false)
    }
    ownerDocument.addEventListener("pointerdown", closeFromOutside, true)
    return () => ownerDocument.removeEventListener("pointerdown", closeFromOutside, true)
  }, [filterOpen])

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-project-canvas-tools="">
      <DropdownMenu disabled={options.length === 0} onOpenChange={setFilterOpen} open={filterOpen}>
        <Tooltip content="Filter leaf nodes" side="bottom">
          <DropdownMenuTrigger
            aria-label="Filter canvas nodes by type"
            aria-pressed={props.filteredKinds.size > 0}
            className="relative"
            ref={filterTriggerRef}
            size="icon-xs"
            variant="ghost"
          >
            <ListFilter />
            {props.filteredKinds.size > 0 ? (
              <span
                aria-hidden
                className="absolute right-1 top-1 size-1.5 rounded-full bg-brand shadow-[0_0_0_1px_var(--ui-surface-panel)]"
              />
            ) : null}
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="w-52"
          onPointerDownOutside={(event) => {
            if (event.target instanceof Node && filterTriggerRef.current?.contains(event.target)) {
              event.preventDefault()
            }
          }}
          ref={filterContentRef}
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Show node types
          </div>
          {options.map((summary) => {
            const selected = props.filteredKinds.has(summary.kind)
            return (
              <DropdownMenuItem
                data-project-canvas-filter-kind={summary.kind}
                key={summary.kind}
                onSelect={(event) => {
                  event.preventDefault()
                  toggleKind(summary.kind)
                }}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 place-items-center rounded border border-border text-brand",
                    selected && "border-brand/50 bg-brand/10",
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{summary.label}</span>
                <span className="tabular-nums text-text-tertiary">{summary.count}</span>
              </DropdownMenuItem>
            )
          })}
          {props.filteredKinds.size > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => props.onFilteredKindsChange(new Set())}>
                <X />
                Clear filters
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ProjectCanvasSidebar(props: ProjectCanvasSidebarProps) {
  const snapshot = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
    props.controller.getSnapshot,
  )
  const [expandedNodeKeys, setExpandedNodeKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [nodeLoadState, setNodeLoadState] = useState<Readonly<Record<string, CanvasNodeLoadState>>>({})
  const nodeLoadRequestsRef = useRef(new Map<string, number>())
  const nextNodeLoadRequestRef = useRef(0)
  const activeCanvas = snapshot.canvases.find((canvas) => canvas.id === props.activeCanvasId)
  const busy = snapshot.busy || Boolean(props.navigationBusy)
  const error = snapshot.error ?? props.navigationError
  const normalizedQuery = props.query?.trim().toLocaleLowerCase() ?? ""

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
      const projection = { canvasId, nodes: [...nodes], projectId } satisfies ProjectCanvasSidebarNodeProjection
      props.onNodesResolved?.(projection)
      setNodeLoadState((states) => ({
        ...states,
        [canvasId]: { nodes: projection.nodes, projectId, status: "ready" },
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
    nodeLoadRequestsRef.current.clear()
    setNodeLoadState({})
    setExpandedNodeKeys(new Set())
  }, [snapshot.projectId])

  useEffect(() => {
    if (!activeCanvas) return
    void loadCanvasNodes(activeCanvas.id)
  }, [activeCanvas?.id, snapshot.projectId])

  const hasActiveNodeProjection = Boolean(
    activeCanvas &&
      props.activeNodes?.projectId === snapshot.projectId &&
      props.activeNodes.canvasId === activeCanvas.id,
  )
  const nodes = activeCanvas
    ? resolveCanvasNodes(activeCanvas.id, snapshot.projectId, props.activeNodes, nodeLoadState)
    : undefined
  const loadState = activeCanvas ? nodeLoadState[activeCanvas.id] : undefined
  const filteredKinds = props.filteredKinds ?? new Set<string>()
  const flatNodes = filteredKinds.size
    ? listProjectCanvasLeafNodes(nodes ?? []).filter(
        (node) =>
          filteredKinds.has(normalizeCanvasLeafKind(node.kind)) &&
          (!normalizedQuery || projectCanvasNodeMatchesOwnQuery(node, normalizedQuery)),
      )
    : null
  const treeNodes =
    !filteredKinds.size && normalizedQuery ? filterProjectCanvasNodeTree(nodes ?? [], normalizedQuery) : nodes
  const legacyHeader =
    props.onActivate && props.onCreate && props.onDelete
      ? { onActivate: props.onActivate, onCreate: props.onCreate, onDelete: props.onDelete }
      : null

  let content
  if (snapshot.canvases.length === 0) {
    content = (
      <div className="grid min-h-0 flex-1 place-items-center px-5 text-center text-xs text-muted-foreground">
        <div className="space-y-2">
          <PanelsTopLeft className="mx-auto size-6 opacity-60" />
          <div>{busy ? "Loading canvases…" : "No canvases yet."}</div>
        </div>
      </div>
    )
  } else if (!activeCanvas) {
    content = (
      <div
        className="grid min-h-0 flex-1 place-items-center px-5 text-center text-xs text-muted-foreground"
        role="status"
      >
        Select a canvas to browse its nodes.
      </div>
    )
  } else if (
    !hasActiveNodeProjection &&
    loadState?.projectId === snapshot.projectId &&
    loadState.status === "loading" &&
    !nodes?.length
  ) {
    content = (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-text-tertiary" role="status">
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading nodes…
      </div>
    )
  } else if (
    !hasActiveNodeProjection &&
    loadState?.projectId === snapshot.projectId &&
    loadState.status === "error" &&
    !nodes?.length
  ) {
    content = (
      <button
        className="m-2 flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-xs text-status-danger hover:bg-interactive-hover"
        onClick={() => void loadCanvasNodes(activeCanvas.id, true)}
        title={loadState.error}
        type="button"
      >
        <RotateCw className="size-3.5 shrink-0" />
        Could not load nodes. Retry
      </button>
    )
  } else {
    const visibleNodes = flatNodes ?? treeNodes ?? []
    content = visibleNodes.length ? (
      <div
        aria-label={`${activeCanvas.name} nodes`}
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-2"
        data-project-canvas-view={flatNodes ? "flat" : "tree"}
        role="tree"
      >
        <ProjectCanvasNodeRows
          canvasId={activeCanvas.id}
          expandedNodeKeys={expandedNodeKeys}
          nodes={visibleNodes}
          onActivate={props.onNodeActivate}
          query={flatNodes ? "" : normalizedQuery}
          setExpandedNodeKeys={setExpandedNodeKeys}
        />
      </div>
    ) : (
      <div className="grid min-h-0 flex-1 place-items-center px-5 text-center text-xs text-text-tertiary" role="status">
        {filteredKinds.size
          ? "No leaf nodes match these filters."
          : normalizedQuery
            ? "No matching nodes."
            : "No nodes"}
      </div>
    )
  }

  return (
    <>
      {legacyHeader ? (
        <div className="flex h-9 shrink-0 items-center gap-1 px-2.5" data-project-canvas-legacy-header="">
          <ProjectCanvasSwitcher
            activeCanvasId={props.activeCanvasId}
            controller={props.controller}
            disabled={busy}
            onActivate={legacyHeader.onActivate}
            onDelete={legacyHeader.onDelete}
          />
          <Tooltip content="New canvas">
            <Button
              aria-label="New canvas"
              disabled={busy}
              onClick={() => void legacyHeader.onCreate()}
              size="icon-sm"
              variant="ghost"
            >
              <Plus />
            </Button>
          </Tooltip>
        </div>
      ) : null}
      {content}
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
    </>
  )
}

export function listProjectCanvasLeafNodes(nodes: readonly ProjectCanvasSidebarNode[]): ProjectCanvasSidebarNode[] {
  const leaves: ProjectCanvasSidebarNode[] = []
  const visit = (node: ProjectCanvasSidebarNode) => {
    const children = node.children ?? []
    if (children.length) {
      for (const child of children) visit(child)
      return
    }
    if (node.kind === "group" || node.folderColor) return
    leaves.push(node)
  }
  for (const node of nodes) visit(node)
  return leaves
}

export function summarizeProjectCanvasLeaves(
  nodes: readonly ProjectCanvasSidebarNode[],
): ProjectCanvasLeafKindSummary[] {
  const counts = new Map<string, number>()
  for (const node of listProjectCanvasLeafNodes(nodes)) {
    const kind = normalizeCanvasLeafKind(node.kind)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return sortCanvasLeafSummaries(
    [...counts].map(([kind, count]) => ({ count, kind, label: canvasLeafKindLabel(kind) })),
  )
}

function normalizeCanvasLeafKind(kind: string | undefined) {
  const normalized = kind?.trim().toLocaleLowerCase() || "unknown"
  return normalized.startsWith("plugin.") ? "plugin" : normalized
}

function canvasLeafKindLabel(kind: string) {
  return canvasLeafKindLabels[kind] ?? `${kind.slice(0, 1).toLocaleUpperCase()}${kind.slice(1)}`
}

function sortCanvasLeafSummaries(summaries: ProjectCanvasLeafKindSummary[]) {
  const ranks = new Map(canvasLeafKindOrder.map((kind, index) => [kind, index]))
  return summaries.sort(
    (left, right) =>
      (ranks.get(left.kind) ?? canvasLeafKindOrder.length) - (ranks.get(right.kind) ?? canvasLeafKindOrder.length) ||
      left.label.localeCompare(right.label),
  )
}

function filterProjectCanvasNodeTree(
  nodes: readonly ProjectCanvasSidebarNode[],
  query: string,
): ProjectCanvasSidebarNode[] {
  const matches: ProjectCanvasSidebarNode[] = []
  for (const node of nodes) {
    if (projectCanvasNodeMatchesOwnQuery(node, query)) {
      matches.push(node)
      continue
    }
    const children = filterProjectCanvasNodeTree(node.children ?? [], query)
    if (children.length) matches.push({ ...node, children })
  }
  return matches
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
    const sticky = node.kind === "group" || Boolean(node.folderColor)
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
          className={cn(
            "group/node flex min-h-8 w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[12px] text-text-tertiary outline-none hover:bg-interactive-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus-ring/40",
            sticky && "sticky bg-surface-panel",
          )}
          data-project-canvas-node-depth={depth}
          data-project-canvas-node-id={node.id}
          data-project-canvas-node-sticky={sticky ? "" : undefined}
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
          style={{
            paddingInlineStart: `${4 + depth * 16}px`,
            top: sticky ? `${depth * 32}px` : undefined,
            zIndex: sticky ? 20 - Math.min(depth, 15) : undefined,
          }}
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
          <span className="flex min-w-0 flex-1 items-center gap-1">
            {node.folderColor ? (
              <span
                aria-hidden
                className="grid size-4 shrink-0 place-items-center text-[13px] leading-none"
                data-project-canvas-node-folder-emoji={node.folderEmoji ?? "folder"}
              >
                {getCanvasGroupEmoji(node.folderEmoji ?? "folder")}
              </span>
            ) : null}
            <span className="min-w-0 truncate" data-project-canvas-node-label="">
              {node.label}
            </span>
          </span>
        </button>
        {expanded ? (
          <div className="relative" role="group">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-border-subtle"
              data-project-canvas-indent-guide={depth}
              style={{ insetInlineStart: `${34 + depth * 16}px` }}
            />
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

function projectCanvasNodeMatchesOwnQuery(node: ProjectCanvasSidebarNode, query: string): boolean {
  return `${node.label} ${node.kind ?? ""}`.toLocaleLowerCase().includes(query)
}

function projectCanvasNodeMatchesQuery(node: ProjectCanvasSidebarNode, query: string): boolean {
  return (
    projectCanvasNodeMatchesOwnQuery(node, query) ||
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
        <FolderGlyph className="translate-y-0.5" color={getCanvasGroupColorValue(folderColor)} size="compact" />
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
