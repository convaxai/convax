import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
  TooltipProvider,
  cn,
} from "@convax/ui"
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from "react"
import type { ProjectCanvas, ProjectEntry, ProjectEntryKind, ProjectRecord } from "./contracts"
import type { ProjectController, ProjectControllerSnapshot } from "./controller"
import { parseProjectEntryDrag, PROJECT_ENTRY_DRAG_TYPE, serializeProjectEntryDrag } from "./drag"
import {
  CanvasList,
  EntryIcon,
  FilePreviewPortal,
  InlineInput,
  getFilePreviewKind,
  type FilePreviewKind,
} from "./project-sidebar-items"

export interface ProjectSidebarProps {
  className?: string
  controller: ProjectController
  hideWhenNoProject?: boolean
  resolveFileUrl?: (input: { path: string; projectId: string }) => string
}

type EntryEditor =
  | { kind: "create"; entryKind: ProjectEntryKind; name: string; parentPath: string }
  | { kind: "rename"; name: string; path: string }

const filePreviewOpenDelay = 120
const filePreviewCloseDelay = 90
const defaultSectionSplitRatio = 0.6
const minimumSectionSplitRatio = 0.1
const minimumExpandedSectionSize = 112
const sectionSplitterSize = 6

export function ProjectSidebar({ className, controller, hideWhenNoProject = false, resolveFileUrl }: ProjectSidebarProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const activeProject = snapshot.projects.find((project) => project.id === snapshot.activeProjectId)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [editor, setEditor] = useState<EntryEditor | null>(null)
  const [canvasEditor, setCanvasEditor] = useState<{ canvasId: string; name: string } | null>(null)
  const [filesExpanded, setFilesExpanded] = useState(true)
  const [canvasesExpanded, setCanvasesExpanded] = useState(true)
  const [sectionSplitRatio, setSectionSplitRatio] = useState(defaultSectionSplitRatio)
  const [resizingSections, setResizingSections] = useState(false)
  const [layoutProjectId, setLayoutProjectId] = useState<string | null>(null)
  const [treeDragActive, setTreeDragActive] = useState(false)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [confirmDeletePaths, setConfirmDeletePaths] = useState<string[] | null>(null)
  const [confirmDeleteCanvas, setConfirmDeleteCanvas] = useState<ProjectCanvas | null>(null)
  const [confirmForget, setConfirmForget] = useState<ProjectRecord | null>(null)
  const suppressClickAfterDragRef = useRef(false)
  const sectionsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void controller.initialize()
  }, [controller])

  useEffect(() => {
    setEditor(null)
    setCanvasEditor(null)
    setSwitcherOpen(false)
    setDropTargetPath(null)
    setConfirmDeleteCanvas(null)
    setTreeDragActive(false)
  }, [snapshot.activeProjectId])

  useEffect(() => {
    const projectId = snapshot.activeProjectId
    if (!projectId) {
      setLayoutProjectId(null)
      return
    }
    const layout = readProjectSidebarLayout(projectId)
    setFilesExpanded(layout.filesExpanded)
    setCanvasesExpanded(layout.canvasesExpanded)
    setSectionSplitRatio(layout.sectionSplitRatio)
    setLayoutProjectId(projectId)
  }, [snapshot.activeProjectId])

  useEffect(() => {
    const projectId = snapshot.activeProjectId
    if (!projectId || layoutProjectId !== projectId) return
    writeProjectSidebarLayout(projectId, { canvasesExpanded, filesExpanded, sectionSplitRatio })
  }, [canvasesExpanded, filesExpanded, layoutProjectId, sectionSplitRatio, snapshot.activeProjectId])

  useEffect(() => () => {
    suppressClickAfterDragRef.current = false
  }, [])

  const visibleEntries = useMemo(() => flattenVisibleEntries(snapshot), [snapshot])
  const entryByPath = useMemo(() => new Map(visibleEntries.map((entry) => [entry.path, entry])), [visibleEntries])

  const beginCreate = async (entryKind: ProjectEntryKind, parentPath = "") => {
    const activeProjectId = controller.getSnapshot().activeProjectId
    if (parentPath) {
      if (!snapshot.expandedPaths.includes(parentPath)) await controller.toggleDirectory(parentPath)
      else await controller.loadDirectory(parentPath)
    }
    if (controller.getSnapshot().activeProjectId !== activeProjectId) return
    setEditor({ kind: "create", entryKind, name: "", parentPath })
  }

  const commitEditor = async () => {
    if (!editor?.name.trim()) {
      setEditor(null)
      return
    }
    if (editor.kind === "create") {
      await controller.createEntry({ kind: editor.entryKind, name: editor.name.trim(), parentPath: editor.parentPath })
    } else {
      await controller.renameEntry(editor.path, editor.name.trim())
    }
    setEditor(null)
  }

  const requestDelete = (path: string) => {
    const selected = snapshot.selectedPaths.includes(path) ? snapshot.selectedPaths : [path]
    setConfirmDeletePaths(normalizeSelectionRoots(selected))
  }

  const finishTreeDrag = () => {
    setTreeDragActive(false)
    setDropTargetPath(null)
    window.setTimeout(() => {
      suppressClickAfterDragRef.current = false
    }, 0)
  }

  const commitCanvasEditor = async () => {
    const current = canvasEditor
    setCanvasEditor(null)
    if (!current?.name.trim()) return
    await controller.renameCanvas(current.canvasId, current.name.trim())
  }

  const handleDrop = async (event: DragEvent<HTMLElement>, destinationPath = "") => {
    event.preventDefault()
    event.stopPropagation()
    setTreeDragActive(false)
    setDropTargetPath(null)
    const payload = parseProjectEntryDrag(event.dataTransfer.getData(PROJECT_ENTRY_DRAG_TYPE))
    if (payload && payload.projectId === snapshot.activeProjectId) {
      await controller.moveEntries(payload.entries.map((entry) => entry.path), destinationPath)
      return
    }
    if (event.dataTransfer.files.length > 0) {
      await controller.importDroppedFiles([...event.dataTransfer.files], destinationPath)
    }
  }

  const handleDragOver = (event: DragEvent<HTMLElement>, destinationPath = "") => {
    const hasProjectEntries = event.dataTransfer.types.includes(PROJECT_ENTRY_DRAG_TYPE)
    const hasExternalFiles = event.dataTransfer.types.includes("Files")
    if (!hasProjectEntries && !hasExternalFiles) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = hasProjectEntries ? "move" : "copy"
    setDropTargetPath(destinationPath)
  }

  const resizeSectionsAt = (clientY: number) => {
    const bounds = sectionsRef.current?.getBoundingClientRect()
    if (!bounds) return
    const availableHeight = Math.max(1, bounds.height - sectionSplitterSize)
    const ratio = (clientY - bounds.top - sectionSplitterSize / 2) / availableHeight
    const limits = getSectionSplitBounds(bounds.height)
    setSectionSplitRatio(clamp(ratio, limits.minimum, limits.maximum))
  }

  const adjustSectionSplit = (key: string, largeStep: boolean) => {
    const limits = getSectionSplitBounds(sectionsRef.current?.clientHeight ?? 0)
    const step = largeStep ? 0.1 : 0.05
    if (key === "Home") setSectionSplitRatio(limits.minimum)
    if (key === "End") setSectionSplitRatio(limits.maximum)
    if (key === "ArrowUp") setSectionSplitRatio((ratio) => clamp(ratio - step, limits.minimum, limits.maximum))
    if (key === "ArrowDown") setSectionSplitRatio((ratio) => clamp(ratio + step, limits.minimum, limits.maximum))
  }

  const sectionSplitBounds = getSectionSplitBounds(sectionsRef.current?.clientHeight ?? 0)
  const bothSectionsExpanded = filesExpanded && canvasesExpanded
  const expandedSectionMinHeight = `min(${minimumExpandedSectionSize}px, calc((100% - ${sectionSplitterSize}px) / 2))`

  if (hideWhenNoProject && !activeProject) return null

  return (
    <TooltipProvider>
      <aside
        aria-busy={snapshot.changingActiveProject}
        className={cn(
          "relative flex h-full w-[292px] shrink-0 flex-col border-r border-border bg-card text-card-foreground",
          snapshot.changingActiveProject && "pointer-events-none opacity-80",
          className,
        )}
      >
      <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-[11px] font-bold tracking-tight text-primary-foreground">CX</span>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setSwitcherOpen((open) => !open)}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{activeProject?.name ?? "Convax"}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
        <Tooltip content="Open folder">
          <Button aria-label="Open folder" onClick={() => void controller.openProject()} size="icon-sm" variant="ghost">
            <FolderPlus />
          </Button>
        </Tooltip>
        {switcherOpen ? (
          <ProjectSwitcher
            activeProjectId={snapshot.activeProjectId}
            projects={snapshot.projects}
            onActivate={(projectId) => void controller.activate(projectId)}
            onClose={() => setSwitcherOpen(false)}
            onCreate={() => {
              setSwitcherOpen(false)
              setCreateProjectOpen(true)
            }}
            onForget={setConfirmForget}
            onOpen={() => void controller.openProject()}
          />
        ) : null}
      </header>

      {!activeProject ? (
        <ProjectEmptyState
          loading={!snapshot.initialized}
          onCreate={() => setCreateProjectOpen(true)}
          onOpen={() => void controller.openProject()}
        />
      ) : (
        <>
          <div className={cn("flex min-h-0 flex-1 flex-col", resizingSections && "select-none")} ref={sectionsRef}>
            <section
              className="flex min-h-0 flex-col overflow-hidden"
              style={{
                flex: filesExpanded ? (canvasesExpanded ? `${sectionSplitRatio} 1 0px` : "1 1 0") : "0 0 36px",
                minHeight: bothSectionsExpanded ? expandedSectionMinHeight : undefined,
              }}
            >
              <div className="flex h-9 shrink-0 items-center gap-1 px-2">
                <button
                  aria-expanded={filesExpanded}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => setFilesExpanded((expanded) => !expanded)}
                  type="button"
                >
                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", filesExpanded && "rotate-90")} />
                  <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Files</span>
                </button>
                <Tooltip content="New file">
                  <Button aria-label="New file" onClick={() => {
                    setFilesExpanded(true)
                    void beginCreate("file")
                  }} size="icon-sm" variant="ghost"><Plus /></Button>
                </Tooltip>
                <Tooltip content="New folder">
                  <Button aria-label="New folder" onClick={() => {
                    setFilesExpanded(true)
                    void beginCreate("directory")
                  }} size="icon-sm" variant="ghost"><FolderPlus /></Button>
                </Tooltip>
                <Tooltip content="Refresh">
                  <Button aria-label="Refresh files" onClick={() => void controller.refreshVisibleDirectories()} size="icon-sm" variant="ghost">
                    <RefreshCw className={cn(snapshot.loadingPaths.length > 0 && "animate-spin")} />
                  </Button>
                </Tooltip>
              </div>
              {filesExpanded ? (
                <div
                  className={cn("min-h-0 flex-1 overflow-auto px-2 pb-2", dropTargetPath === "" && "bg-accent/50")}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target && dropTargetPath === "") setDropTargetPath(null)
                  }}
                  onDragOver={(event) => handleDragOver(event)}
                  onDrop={(event) => void handleDrop(event)}
                  role="tree"
                  aria-label={`${activeProject.name} files`}
                  aria-multiselectable="true"
                >
                  {editor?.kind === "create" && editor.parentPath === "" ? (
                    <EntryEditorRow editor={editor} level={1} onCancel={() => setEditor(null)} onChange={setEditor} onCommit={commitEditor} />
                  ) : null}
                  {(snapshot.listings[""]?.entries ?? []).map((entry) => (
                    <ProjectTreeNode
                      controller={controller}
                      dropTargetPath={dropTargetPath}
                      editor={editor}
                      entry={entry}
                      entryByPath={entryByPath}
                      firstPath={visibleEntries[0]?.path}
                      key={entry.path}
                      level={1}
                      onBeginCreate={beginCreate}
                      onCancelEditor={() => setEditor(null)}
                      onChangeEditor={setEditor}
                      onCommitEditor={commitEditor}
                      onDragEnd={finishTreeDrag}
                      onDragOver={handleDragOver}
                      onDragStart={() => {
                        suppressClickAfterDragRef.current = true
                        setTreeDragActive(true)
                      }}
                      onDrop={handleDrop}
                      onRequestDelete={requestDelete}
                      onStartRename={(target) => setEditor({ kind: "rename", name: target.name, path: target.path })}
                      previewDisabled={Boolean(editor) || treeDragActive}
                      resolveFileUrl={resolveFileUrl}
                      shouldSuppressClick={() => suppressClickAfterDragRef.current}
                      snapshot={snapshot}
                    />
                  ))}
                  {snapshot.initialized && snapshot.listings[""]?.entries.length === 0 && !editor ? (
                    <div className="flex h-32 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
                      <FolderOpen className="size-7 opacity-60" />
                      <span>This project is empty.</span>
                      <button className="font-medium text-primary hover:underline" onClick={() => void beginCreate("file")} type="button">Create a file</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            {bothSectionsExpanded ? (
              <div
                aria-label="Resize Files and Canvases sections"
                aria-orientation="horizontal"
                aria-valuemax={Math.round(sectionSplitBounds.maximum * 100)}
                aria-valuemin={Math.round(sectionSplitBounds.minimum * 100)}
                aria-valuenow={Math.round(sectionSplitRatio * 100)}
                aria-valuetext={`${Math.round(sectionSplitRatio * 100)}% for Files`}
                className={cn(
                  "group relative h-1.5 shrink-0 cursor-row-resize touch-none outline-none",
                  resizingSections && "bg-accent/40",
                )}
                onKeyDown={(event) => {
                  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
                  event.preventDefault()
                  adjustSectionSplit(event.key, event.shiftKey)
                }}
                onLostPointerCapture={() => setResizingSections(false)}
                onPointerCancel={() => setResizingSections(false)}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !event.isPrimary) return
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setResizingSections(true)
                  resizeSectionsAt(event.clientY)
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  resizeSectionsAt(event.clientY)
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                  setResizingSections(false)
                }}
                role="separator"
                tabIndex={0}
                title="Drag to resize. Use arrow keys when focused."
              >
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-all group-hover:h-0.5 group-hover:bg-primary/45 group-focus-visible:h-0.5 group-focus-visible:bg-ring" />
              </div>
            ) : null}

            <section
              aria-busy={snapshot.changingActiveCanvas}
              className={cn(
                "flex min-h-0 flex-col overflow-hidden",
                !bothSectionsExpanded && "border-t border-border",
                snapshot.changingActiveCanvas && "opacity-70",
              )}
              style={{
                flex: canvasesExpanded ? (filesExpanded ? `${1 - sectionSplitRatio} 1 0px` : "1 1 0") : "0 0 36px",
                minHeight: bothSectionsExpanded ? expandedSectionMinHeight : undefined,
              }}
            >
              <div className="flex h-9 shrink-0 items-center gap-1 px-2">
                <button
                  aria-expanded={canvasesExpanded}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => setCanvasesExpanded((expanded) => !expanded)}
                  type="button"
                >
                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", canvasesExpanded && "rotate-90")} />
                  <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Canvases</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">{snapshot.canvases.length}</span>
                </button>
                <Tooltip content="New canvas">
                  <Button aria-label="New canvas" disabled={snapshot.changingActiveCanvas} onClick={() => {
                    setCanvasesExpanded(true)
                    void controller.createCanvas()
                  }} size="icon-sm" variant="ghost"><Plus /></Button>
                </Tooltip>
              </div>
              {canvasesExpanded ? (
                <CanvasList
                  activeCanvasId={snapshot.activeCanvasId}
                  canvases={snapshot.canvases}
                  controller={controller}
                  editor={canvasEditor}
                  onCancelEdit={() => setCanvasEditor(null)}
                  onChangeEdit={(name) => setCanvasEditor((current) => current ? { ...current, name } : null)}
                  onCommitEdit={commitCanvasEditor}
                  onDelete={setConfirmDeleteCanvas}
                  onRename={(canvas) => setCanvasEditor({ canvasId: canvas.id, name: canvas.name })}
                />
              ) : null}
            </section>
          </div>
          <footer className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span className="min-w-0 flex-1 truncate" title={activeProject.rootPath}>{activeProject.rootPath}</span>
          </footer>
        </>
      )}

      {snapshot.error ? (
        <div className="absolute inset-x-3 bottom-11 z-30 flex items-start gap-2 rounded-lg border border-destructive/25 bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
          <span className="min-w-0 flex-1">{snapshot.error}</span>
          <button aria-label="Dismiss error" onClick={() => controller.clearError()} type="button"><X className="size-3.5" /></button>
        </div>
      ) : null}

      {createProjectOpen ? (
        <Modal title="New project" onClose={() => setCreateProjectOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!projectName.trim()) return
              void controller.createProject(projectName.trim()).then(() => {
                setProjectName("")
                setCreateProjectOpen(false)
              })
            }}
          >
            <label className="mb-1.5 block text-xs font-medium" htmlFor="project-name">Project name</label>
            <input
              autoFocus
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
              id="project-name"
              onChange={(event) => setProjectName(event.currentTarget.value)}
              placeholder="My project"
              value={projectName}
            />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">You will choose where to create it next.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setCreateProjectOpen(false)} size="sm" variant="ghost">Cancel</Button>
              <Button disabled={!projectName.trim()} size="sm" type="submit">Create project</Button>
            </div>
          </form>
        </Modal>
      ) : null}
      {confirmDeletePaths ? (
        <ConfirmDialog
          confirmLabel="Move to Trash"
          description={`${confirmDeletePaths.length} item${confirmDeletePaths.length === 1 ? "" : "s"} will be moved to the system Trash.`}
          destructive
          onCancel={() => setConfirmDeletePaths(null)}
          onConfirm={() => void controller.deleteEntries(confirmDeletePaths).then(() => setConfirmDeletePaths(null))}
          title="Delete selected items?"
        />
      ) : null}
      {confirmDeleteCanvas ? (
        <ConfirmDialog
          confirmLabel="Delete canvas"
          description={`“${confirmDeleteCanvas.name}” and its canvas document will be deleted. Project files are not affected.`}
          destructive
          onCancel={() => setConfirmDeleteCanvas(null)}
          onConfirm={() => void controller.deleteCanvas(confirmDeleteCanvas.id).then(() => setConfirmDeleteCanvas(null))}
          title="Delete canvas?"
        />
      ) : null}
      {confirmForget ? (
        <ConfirmDialog
          confirmLabel="Remove"
          description="This removes the project from Convax. Files on disk will not be deleted."
          onCancel={() => setConfirmForget(null)}
          onConfirm={() => void controller.forgetProject(confirmForget.id).then(() => setConfirmForget(null))}
          title={`Remove “${confirmForget.name}”?`}
        />
      ) : null}
      </aside>
    </TooltipProvider>
  )
}

function ProjectTreeNode(props: {
  controller: ProjectController
  dropTargetPath: string | null
  editor: EntryEditor | null
  entry: ProjectEntry
  entryByPath: Map<string, ProjectEntry>
  firstPath?: string
  level: number
  onBeginCreate: (kind: ProjectEntryKind, parentPath: string) => Promise<void>
  onCancelEditor: () => void
  onChangeEditor: (editor: EntryEditor) => void
  onCommitEditor: () => Promise<void>
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>, destinationPath: string) => void
  onDragStart: () => void
  onDrop: (event: DragEvent<HTMLElement>, destinationPath: string) => Promise<void>
  onRequestDelete: (path: string) => void
  onStartRename: (entry: ProjectEntry) => void
  previewDisabled: boolean
  resolveFileUrl?: (input: { path: string; projectId: string }) => string
  shouldSuppressClick: () => boolean
  snapshot: ProjectControllerSnapshot
}) {
  const { entry, snapshot } = props
  const directory = entry.kind === "directory"
  const dropDestinationPath = directory ? entry.path : entry.parentPath
  const expanded = snapshot.expandedPaths.includes(entry.path)
  const selected = snapshot.selectedPaths.includes(entry.path)
  const listing = snapshot.listings[entry.path]
  const loading = snapshot.loadingPaths.includes(entry.path)
  const children = listing?.entries ?? []
  const editing = props.editor?.kind === "rename" && props.editor.path === entry.path
  const previewKind = getFilePreviewKind(entry)
  const previewUrl = useMemo(() => {
    if (!previewKind || !snapshot.activeProjectId) return null
    if (previewKind === "markdown" || previewKind === "text") return ""
    if (!props.resolveFileUrl) return null
    try {
      return props.resolveFileUrl({ path: entry.path, projectId: snapshot.activeProjectId }) || null
    } catch {
      return null
    }
  }, [entry.path, previewKind, props.resolveFileUrl, snapshot.activeProjectId])
  const rowRef = useRef<HTMLDivElement | null>(null)
  const previewOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPosition, setPreviewPosition] = useState({ left: 0, top: 0 })

  const clearPreviewTimer = (timerRef: typeof previewOpenTimerRef) => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const cancelPreviewClose = () => clearPreviewTimer(previewCloseTimerRef)
  const schedulePreviewOpen = () => {
    cancelPreviewClose()
    if (!previewKind || previewUrl === null || props.previewDisabled) return
    clearPreviewTimer(previewOpenTimerRef)
    previewOpenTimerRef.current = setTimeout(() => {
      previewOpenTimerRef.current = null
      const bounds = rowRef.current?.getBoundingClientRect()
      if (!bounds || props.previewDisabled) return
      const preferredLeft = bounds.right + 10
      const left = preferredLeft + 320 <= window.innerWidth - 12
        ? preferredLeft
        : Math.max(12, bounds.left - 330)
      const top = Math.max(12, Math.min(bounds.top - 104, window.innerHeight - 320))
      setPreviewPosition({ left, top })
      setPreviewOpen(true)
    }, filePreviewOpenDelay)
  }
  const schedulePreviewClose = () => {
    clearPreviewTimer(previewOpenTimerRef)
    clearPreviewTimer(previewCloseTimerRef)
    previewCloseTimerRef.current = setTimeout(() => {
      previewCloseTimerRef.current = null
      setPreviewOpen(false)
    }, filePreviewCloseDelay)
  }

  useEffect(() => {
    if (!props.previewDisabled) return
    clearPreviewTimer(previewOpenTimerRef)
    clearPreviewTimer(previewCloseTimerRef)
    setPreviewOpen(false)
  }, [props.previewDisabled])

  useEffect(() => () => {
    clearPreviewTimer(previewOpenTimerRef)
    clearPreviewTimer(previewCloseTimerRef)
  }, [])

  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    props.onDragStart()
    setPreviewOpen(false)
    const paths = selected ? snapshot.selectedPaths : [entry.path]
    const entries = paths.flatMap((path) => {
      const item = props.entryByPath.get(path)
      return item ? [{ kind: item.kind, name: item.name, path: item.path }] : []
    })
    if (!selected) props.controller.selectEntry(entry.path, { range: false, toggle: false })
    event.dataTransfer.effectAllowed = "copyMove"
    event.dataTransfer.setData(PROJECT_ENTRY_DRAG_TYPE, serializeProjectEntryDrag({
      entries,
      projectId: snapshot.activeProjectId ?? "",
      version: 1,
    }))
    event.dataTransfer.setData("text/plain", entries.map((item) => item.path).join("\n"))
  }
  const row = (
    <div
      aria-expanded={directory ? expanded : undefined}
      aria-level={props.level}
      aria-selected={selected}
      className={cn(
        "group flex h-7 select-none items-center rounded-md pr-1 text-[13px] outline-none",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/70",
        props.dropTargetPath === entry.path && "bg-primary/10 ring-1 ring-inset ring-primary/40",
      )}
      data-project-entry-path={entry.path}
      draggable={!editing}
      onClick={(event) => {
        if (props.shouldSuppressClick()) return
        const range = event.shiftKey
        const toggle = event.metaKey || event.ctrlKey
        props.controller.selectEntry(entry.path, { range, toggle })
        if (directory && event.detail === 1 && !range && !toggle) void props.controller.toggleDirectory(entry.path)
      }}
      onDoubleClick={() => { if (!directory) void props.controller.openEntry(entry.path) }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => props.onDragOver(event, dropDestinationPath)}
      onDragStart={startDrag}
      onDrop={(event) => void props.onDrop(event, dropDestinationPath)}
      onMouseEnter={schedulePreviewOpen}
      onMouseLeave={schedulePreviewClose}
      onKeyDown={(event) => {
        if (event.key === "F2") props.onStartRename(entry)
        if (event.key === "Delete" || event.key === "Backspace") props.onRequestDelete(entry.path)
        if (directory && event.key === "ArrowRight" && !expanded) void props.controller.toggleDirectory(entry.path)
        if (directory && event.key === "ArrowLeft" && expanded) void props.controller.toggleDirectory(entry.path)
        if (event.key === "ArrowDown" || event.key === "ArrowUp") focusAdjacentTreeRow(event.currentTarget, event.key === "ArrowDown" ? 1 : -1)
      }}
      role="treeitem"
      tabIndex={selected || (!snapshot.selectedPaths.length && props.firstPath === entry.path) ? 0 : -1}
      ref={rowRef}
    >
      <span aria-hidden="true" style={{ width: `${(props.level - 1) * 14}px` }} />
      {directory ? (
        <button
          aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation()
            void props.controller.toggleDirectory(entry.path)
          }}
          type="button"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
      ) : <span className="size-6 shrink-0" />}
      <EntryIcon entry={entry} expanded={expanded} previewKind={previewKind} previewUrl={previewUrl} />
      {editing ? (
        <InlineInput
          label={`Rename ${entry.name}`}
          onCancel={props.onCancelEditor}
          onChange={(name) => props.onChangeEditor({ kind: "rename", name, path: entry.path })}
          onCommit={props.onCommitEditor}
          value={props.editor?.name ?? ""}
        />
      ) : <span className="min-w-0 flex-1 truncate px-1.5">{entry.name}</span>}
      {!editing ? <MoreHorizontal className="size-3.5 opacity-0 group-hover:opacity-35" /> : null}
    </div>
  )
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {directory ? (
            <>
              <ContextMenuItem onSelect={() => void props.onBeginCreate("file", entry.path)}><Plus />New file</ContextMenuItem>
              <ContextMenuItem onSelect={() => void props.onBeginCreate("directory", entry.path)}><FolderPlus />New folder</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : null}
          <ContextMenuItem onSelect={() => void props.controller.openEntry(entry.path)}><FolderInput />Open</ContextMenuItem>
          <ContextMenuItem onSelect={() => void props.controller.revealEntry(entry.path)}><Search />Show in File Manager</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => props.onStartRename(entry)}><Pencil />Rename</ContextMenuItem>
          <ContextMenuItem className="text-destructive" onSelect={() => props.onRequestDelete(entry.path)}><Trash2 />Move to Trash</ContextMenuItem>
        </ContextMenuContent>
        {directory && expanded ? (
          <div role="group">
            {props.editor?.kind === "create" && props.editor.parentPath === entry.path ? (
              <EntryEditorRow
                editor={props.editor}
                level={props.level + 1}
                onCancel={props.onCancelEditor}
                onChange={props.onChangeEditor}
                onCommit={props.onCommitEditor}
              />
            ) : null}
            {loading ? <TreeStateRow icon={<LoaderCircle className="animate-spin" />} label="Loading…" level={props.level + 1} /> : null}
            {!loading && listing && children.length === 0 && !(props.editor?.kind === "create" && props.editor.parentPath === entry.path)
              ? <TreeStateRow label="Empty folder" level={props.level + 1} />
              : null}
            {children.map((child) => <ProjectTreeNode {...props} entry={child} key={child.path} level={props.level + 1} />)}
          </div>
        ) : null}
      </ContextMenu>
      {previewOpen && previewKind && previewUrl !== null && snapshot.activeProjectId ? (
        <FilePreviewPortal
          controller={props.controller}
          entry={entry}
          kind={previewKind}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={schedulePreviewClose}
          position={previewPosition}
          projectId={snapshot.activeProjectId}
          url={previewUrl}
        />
      ) : null}
    </>
  )
}

function EntryEditorRow(props: {
  editor: Extract<EntryEditor, { kind: "create" }>
  level: number
  onCancel: () => void
  onChange: (editor: EntryEditor) => void
  onCommit: () => Promise<void>
}) {
  return (
    <div className="flex h-7 items-center rounded-md bg-accent/60 pr-1 text-[13px]" role="treeitem" aria-level={props.level}>
      <span style={{ width: `${(props.level - 1) * 14 + 24}px` }} />
      <EntryIcon entry={{ kind: props.editor.entryKind, name: props.editor.name }} />
      <InlineInput
        label={props.editor.entryKind === "directory" ? "Folder name" : "File name"}
        onCancel={props.onCancel}
        onChange={(name) => props.onChange({ ...props.editor, name })}
        onCommit={props.onCommit}
        value={props.editor.name}
      />
    </div>
  )
}

function TreeStateRow({ icon, label, level }: { icon?: ReactNode; label: string; level: number }) {
  return (
    <div className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground" role="treeitem" aria-level={level}>
      <span style={{ width: `${(level - 1) * 14 + 24}px` }} />
      {icon ? <span className="[&>svg]:size-3.5">{icon}</span> : null}
      <span>{label}</span>
    </div>
  )
}

function ProjectSwitcher(props: {
  activeProjectId: string | null
  onActivate: (projectId: string) => void
  onClose: () => void
  onCreate: () => void
  onForget: (project: ProjectRecord) => void
  onOpen: () => void
  projects: ProjectRecord[]
}) {
  return (
    <div className="absolute left-3 right-3 top-[50px] z-50 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Projects</span>
        <button aria-label="Close projects" onClick={props.onClose} type="button"><X className="size-3.5" /></button>
      </div>
      <div className="max-h-56 overflow-auto">
        {props.projects.map((project) => (
          <div className={cn("group flex items-center rounded-lg", project.id === props.activeProjectId && "bg-accent")} key={project.id}>
            <button className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left" onClick={() => props.onActivate(project.id)} type="button">
              <Folder className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{project.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{project.missing ? "Folder unavailable" : project.rootPath}</span>
              </span>
            </button>
            <button
              aria-label={`Remove ${project.name}`}
              className="mr-1 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100"
              onClick={() => props.onForget(project)}
              type="button"
            ><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="my-1 h-px bg-border" />
      <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium hover:bg-accent" onClick={props.onOpen} type="button"><FolderPlus className="size-4" />Open folder…</button>
      <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium hover:bg-accent" onClick={props.onCreate} type="button"><Plus className="size-4" />New project</button>
    </div>
  )
}

function ProjectEmptyState({ loading, onCreate, onOpen }: { loading: boolean; onCreate: () => void; onOpen: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center">
      {loading ? <LoaderCircle className="size-6 animate-spin text-muted-foreground" /> : (
        <>
          <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-primary"><FolderOpen className="size-6" /></span>
          <h2 className="text-sm font-semibold">Start with a project</h2>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Open a folder or create a clean workspace for your canvas and files.</p>
          <Button className="mt-5 w-full" onClick={onOpen} size="sm"><FolderPlus />Open folder</Button>
          <Button className="mt-2 w-full" onClick={onCreate} size="sm" variant="outline"><Plus />New project</Button>
        </>
      )}
    </div>
  )
}

function Modal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/20 p-5 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div aria-modal="true" className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl" role="dialog">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button aria-label="Close" onClick={onClose} size="icon-sm" variant="ghost"><X /></Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ConfirmDialog(props: { confirmLabel: string; description: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void; title: string }) {
  return (
    <Modal onClose={props.onCancel} title={props.title}>
      <p className="text-xs leading-5 text-muted-foreground">{props.description}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={props.onCancel} size="sm" variant="ghost">Cancel</Button>
        <Button onClick={props.onConfirm} size="sm" variant={props.destructive ? "destructive" : "default"}>{props.confirmLabel}</Button>
      </div>
    </Modal>
  )
}

interface ProjectSidebarLayout {
  canvasesExpanded: boolean
  filesExpanded: boolean
  sectionSplitRatio: number
}

function projectSidebarLayoutKey(projectId: string) {
  return `convax.project-sidebar.layout.${projectId}`
}

function readProjectSidebarLayout(projectId: string): ProjectSidebarLayout {
  const fallback = { canvasesExpanded: true, filesExpanded: true, sectionSplitRatio: defaultSectionSplitRatio }
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(projectSidebarLayoutKey(projectId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<ProjectSidebarLayout>
    return {
      canvasesExpanded: typeof parsed.canvasesExpanded === "boolean" ? parsed.canvasesExpanded : true,
      filesExpanded: typeof parsed.filesExpanded === "boolean" ? parsed.filesExpanded : true,
      sectionSplitRatio: typeof parsed.sectionSplitRatio === "number" && Number.isFinite(parsed.sectionSplitRatio)
        ? clamp(parsed.sectionSplitRatio, minimumSectionSplitRatio, 1 - minimumSectionSplitRatio)
        : defaultSectionSplitRatio,
    }
  } catch {
    return fallback
  }
}

function getSectionSplitBounds(containerHeight: number) {
  const availableHeight = containerHeight - sectionSplitterSize
  if (availableHeight <= 0) {
    return { maximum: 1 - minimumSectionSplitRatio, minimum: minimumSectionSplitRatio }
  }
  const minimum = Math.min(0.5, Math.max(minimumSectionSplitRatio, minimumExpandedSectionSize / availableHeight))
  return { maximum: 1 - minimum, minimum }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function writeProjectSidebarLayout(projectId: string, layout: ProjectSidebarLayout) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(projectSidebarLayoutKey(projectId), JSON.stringify(layout))
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory layout remains usable.
  }
}

function flattenVisibleEntries(snapshot: ProjectControllerSnapshot) {
  const visible: ProjectEntry[] = []
  const visit = (directoryPath: string) => {
    for (const entry of snapshot.listings[directoryPath]?.entries ?? []) {
      visible.push(entry)
      if (entry.kind === "directory" && snapshot.expandedPaths.includes(entry.path)) visit(entry.path)
    }
  }
  visit("")
  return visible
}

function normalizeSelectionRoots(paths: readonly string[]) {
  const selected = new Set(paths)
  return paths.filter((path) => {
    const segments = path.split("/")
    return !segments.slice(0, -1).some((_, index) => selected.has(segments.slice(0, index + 1).join("/")))
  })
}

function focusAdjacentTreeRow(current: HTMLElement, offset: -1 | 1) {
  const tree = current.closest('[role="tree"]')
  const rows = tree ? [...tree.querySelectorAll<HTMLElement>('[role="treeitem"][data-project-entry-path]')] : []
  const index = rows.indexOf(current)
  const next = rows[index + offset]
  if (!next) return
  next.tabIndex = 0
  current.tabIndex = -1
  next.focus()
}
