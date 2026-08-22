import {
  PROJECT_ENTRY_DRAG_TYPE,
  parseProjectEntryDrag,
  serializeProjectEntryDrag,
  type ProjectEntry,
  type ProjectEntryKind,
  type ProjectFileThumbnail,
  type ProjectFilesController,
  type ProjectFilesControllerSnapshot,
} from "@convax/project-files"
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  TooltipProvider,
  cn,
} from "@convax/ui"
import {
  Check,
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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from "react"
import type { ProjectRecord } from "./contracts"
import type { ProjectController } from "./controller"
import { fitProjectFilename } from "./project-filename"
import {
  EntryIcon,
  FilePreviewPortal,
  InlineInput,
  captureProjectImageThumbnail,
  captureProjectVideoThumbnail,
  getFilePreviewKind,
  type ProjectFilePreviewOpener,
} from "./project-sidebar-items"
import { bindProjectSwitcherDismissal } from "./project-switcher-dismissal"

type ProjectFileThumbnailResolverResult = ProjectFileThumbnail | string | null

export interface ProjectSidebarProps {
  className?: string
  controller: ProjectController
  extension?: {
    actions?: ReactNode
    busy?: boolean
    content: ReactNode | ((context: { query: string }) => ReactNode)
    count?: number
    createLabel?: string
    header?: ReactNode
    label: string
    onCreate?: () => void
  }
  filesCanvasResizeLabel?: string
  filesController: ProjectFilesController
  filesLabel?: string
  footerActions?: ReactNode
  headerActions?: ReactNode
  hideWhenNoProject?: boolean
  openFilePreview?: ProjectFilePreviewOpener
  onFileActivate?: (input: { entry: ProjectEntry; projectId: string }) => void
  presentation?: "sidebar" | "embedded-files" | "workspace" | "workspace-tabs"
  resolveFileThumbnailUrl?: (input: {
    path: string
    projectId: string
  }) => Promise<ProjectFileThumbnailResolverResult> | ProjectFileThumbnailResolverResult
  searchLabel?: string
}

type EntryEditor =
  | { kind: "create"; entryKind: ProjectEntryKind; name: string; parentPath: string }
  | { kind: "rename"; name: string; path: string }

const filePreviewOpenDelay = 120
const filePreviewCloseDelay = 90
const defaultSectionSplitRatio = 0.5
const minimumSectionSplitRatio = 0.1
const minimumExpandedSectionSize = 112
const sectionSplitterSize = 6
const maximumFileThumbnailCacheCharacters = 4 * 1024 * 1024
const maximumFilePreviewCacheEntries = 64
const fileThumbnailCache = new Map<string, ProjectFileThumbnail>()
const emptyProjectFilesSnapshot: ProjectFilesControllerSnapshot = {
  error: null,
  expandedPaths: [],
  listings: {},
  loadingPaths: [],
  projectId: null,
  selectedPaths: [],
}

export function ProjectSidebar({
  className,
  controller,
  extension,
  filesCanvasResizeLabel = "Resize Project files and Canvas sections",
  filesController,
  filesLabel = "Project files",
  footerActions,
  headerActions,
  hideWhenNoProject = false,
  openFilePreview,
  onFileActivate,
  presentation = "sidebar",
  resolveFileThumbnailUrl,
  searchLabel = "Search project",
}: ProjectSidebarProps) {
  const projectSnapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const latestFilesSnapshot = useSyncExternalStore(
    filesController.subscribe,
    filesController.getSnapshot,
    filesController.getSnapshot,
  )
  const filesSnapshot =
    latestFilesSnapshot.projectId === projectSnapshot.activeProjectId ? latestFilesSnapshot : emptyProjectFilesSnapshot
  const activeProject = projectSnapshot.projects.find((project) => project.id === projectSnapshot.activeProjectId)
  const embeddedFiles = presentation === "embedded-files"
  // Keep the Project-files-over-Canvas hierarchy explicit instead of presenting both as tabs.
  const workspaceTabs = presentation === "workspace" || presentation === "workspace-tabs"
  const displayedExtension = embeddedFiles ? undefined : extension
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [creatingProject, setCreatingProject] = useState(false)
  const creatingProjectRef = useRef(false)
  const [editor, setEditor] = useState<EntryEditor | null>(null)
  const [filesExpanded, setFilesExpanded] = useState(true)
  const [extensionExpanded, setExtensionExpanded] = useState(true)
  const [sectionSplitRatio, setSectionSplitRatio] = useState(defaultSectionSplitRatio)
  const [resizingSections, setResizingSections] = useState(false)
  const [layoutProjectId, setLayoutProjectId] = useState<string | null>(null)
  const [treeDragActive, setTreeDragActive] = useState(false)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [confirmDeletePaths, setConfirmDeletePaths] = useState<string[] | null>(null)
  const [confirmForget, setConfirmForget] = useState<ProjectRecord | null>(null)
  const [projectEditor, setProjectEditor] = useState<{ name: string; projectId: string } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const suppressClickAfterDragRef = useRef(false)
  const sectionsRef = useRef<HTMLDivElement | null>(null)
  const projectSwitcherRef = useRef<HTMLDivElement | null>(null)
  const projectSwitcherTriggerRef = useRef<HTMLButtonElement | null>(null)
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null)
  const openCreateProject = () => {
    controller.clearError()
    setCreateProjectOpen(true)
  }

  useEffect(() => {
    void controller.initialize()
  }, [controller])

  useEffect(() => {
    setEditor(null)
    setSwitcherOpen(false)
    setDropTargetPath(null)
    setTreeDragActive(false)
    setSearchOpen(false)
    setSearchQuery("")
    setProjectEditor(null)
  }, [projectSnapshot.activeProjectId])

  useEffect(() => {
    if (!switcherOpen) return
    const ownerDocument = projectSwitcherRef.current?.ownerDocument ?? projectSwitcherTriggerRef.current?.ownerDocument
    const switcher = projectSwitcherRef.current
    const trigger = projectSwitcherTriggerRef.current
    if (!ownerDocument || !switcher || !trigger) return

    return bindProjectSwitcherDismissal({
      document: ownerDocument,
      onDismiss: () => setSwitcherOpen(false),
      onEscape: () => {
        setSwitcherOpen(false)
        trigger.focus({ preventScroll: true })
      },
      switcher,
      trigger,
      window: ownerDocument.defaultView,
    })
  }, [switcherOpen])

  useEffect(() => {
    const projectId = projectSnapshot.activeProjectId
    if (!projectId) {
      setLayoutProjectId(null)
      return
    }
    const layout = readProjectSidebarLayout(projectId, workspaceTabs)
    setFilesExpanded(layout.filesExpanded)
    setExtensionExpanded(layout.extensionExpanded)
    setSectionSplitRatio(layout.sectionSplitRatio)
    setLayoutProjectId(projectId)
  }, [projectSnapshot.activeProjectId, workspaceTabs])

  useEffect(() => {
    const projectId = projectSnapshot.activeProjectId
    if (!projectId || layoutProjectId !== projectId) return
    writeProjectSidebarLayout(projectId, { extensionExpanded, filesExpanded, sectionSplitRatio }, workspaceTabs)
  }, [
    extensionExpanded,
    filesExpanded,
    layoutProjectId,
    projectSnapshot.activeProjectId,
    sectionSplitRatio,
    workspaceTabs,
  ])

  useEffect(
    () => () => {
      suppressClickAfterDragRef.current = false
    },
    [],
  )

  const visibleEntries = useMemo(() => flattenVisibleEntries(filesSnapshot), [filesSnapshot])
  const entryByPath = useMemo(() => new Map(visibleEntries.map((entry) => [entry.path, entry])), [visibleEntries])
  const matchingPaths = useMemo(
    () => findMatchingEntryPaths(filesSnapshot, workspaceTabs ? "" : searchQuery),
    [filesSnapshot, searchQuery, workspaceTabs],
  )
  const renderedExtensionContent =
    typeof displayedExtension?.content === "function"
      ? displayedExtension.content({ query: searchQuery })
      : displayedExtension?.content

  const beginCreate = async (entryKind: ProjectEntryKind, parentPath = "") => {
    const activeProjectId = projectSnapshot.activeProjectId
    if (parentPath) {
      if (!filesSnapshot.expandedPaths.includes(parentPath)) await filesController.toggleDirectory(parentPath)
      else await filesController.loadDirectory(parentPath)
    }
    if (filesController.getSnapshot().projectId !== activeProjectId) return
    setEditor({ kind: "create", entryKind, name: "", parentPath })
  }

  const commitEditor = async () => {
    if (!editor?.name.trim()) {
      setEditor(null)
      return
    }
    if (editor.kind === "create") {
      await filesController.createEntry({
        kind: editor.entryKind,
        name: editor.name.trim(),
        parentPath: editor.parentPath,
      })
    } else {
      await filesController.renameEntry(editor.path, editor.name.trim())
    }
    setEditor(null)
  }

  const requestDelete = (path: string) => {
    const selected = filesSnapshot.selectedPaths.includes(path) ? filesSnapshot.selectedPaths : [path]
    setConfirmDeletePaths(normalizeSelectionRoots(selected))
  }

  const finishTreeDrag = () => {
    setTreeDragActive(false)
    setDropTargetPath(null)
    window.setTimeout(() => {
      suppressClickAfterDragRef.current = false
    }, 0)
  }

  const handleDrop = async (event: DragEvent<HTMLElement>, destinationPath = "") => {
    event.preventDefault()
    event.stopPropagation()
    setTreeDragActive(false)
    setDropTargetPath(null)
    const payload = parseProjectEntryDrag(event.dataTransfer.getData(PROJECT_ENTRY_DRAG_TYPE))
    if (payload && payload.projectId === filesSnapshot.projectId) {
      await filesController.moveEntries(
        payload.entries.map((entry) => entry.path),
        destinationPath,
      )
      return
    }
    if (event.dataTransfer.files.length > 0) {
      await filesController.importDroppedFiles([...event.dataTransfer.files], destinationPath)
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
  const bothSectionsExpanded = Boolean(displayedExtension) && filesExpanded && (workspaceTabs || extensionExpanded)
  const expandedSectionMinHeight = `min(${minimumExpandedSectionSize}px, calc((100% - ${sectionSplitterSize}px) / 2))`

  if ((hideWhenNoProject || embeddedFiles) && !activeProject) return null

  return (
    <TooltipProvider>
      <aside
        aria-busy={projectSnapshot.changingActiveProject}
        className={cn(
          "relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-surface-panel text-text-primary",
          embeddedFiles || workspaceTabs ? "w-full" : "w-[292px] border-r border-border",
          projectSnapshot.changingActiveProject && "pointer-events-none opacity-80",
          className,
        )}
        data-project-files-view={embeddedFiles ? "embedded" : undefined}
        data-project-sidebar-presentation={presentation}
      >
        {!embeddedFiles ? (
          <header
            className={cn(
              "group/header relative flex shrink-0 items-center",
              workspaceTabs ? "h-11 gap-1 border-b border-border-subtle px-2.5" : "h-16 gap-2 px-3",
            )}
          >
            {workspaceTabs && activeProject ? (
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-md bg-interactive-selected text-brand"
              >
                <Folder className="size-3.5" />
              </span>
            ) : null}
            {workspaceTabs && activeProject && projectEditor?.projectId === activeProject.id ? (
              <ProjectNameInput
                name={projectEditor.name}
                onCancel={() => setProjectEditor(null)}
                onChange={(name) => setProjectEditor((current) => (current ? { ...current, name } : null))}
                onCommit={async () => {
                  const current = projectEditor
                  setProjectEditor(null)
                  if (!current || current.projectId !== projectSnapshot.activeProjectId) return
                  await controller.renameProject(current.projectId, current.name)
                }}
              />
            ) : (
              <button
                aria-expanded={switcherOpen}
                aria-haspopup="dialog"
                className={cn(
                  "flex min-w-0 max-w-full shrink items-center text-left outline-none transition-transform duration-100 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-focus-ring/40 motion-reduce:transition-none",
                  workspaceTabs
                    ? "h-8 gap-1 rounded-md px-1.5 text-xs font-medium hover:bg-interactive-hover active:bg-interactive-pressed"
                    : "gap-2 rounded-md px-2 py-1.5",
                )}
                onClick={() => setSwitcherOpen((open) => !open)}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  setSwitcherOpen(false)
                  if (activeProject) setProjectEditor({ name: activeProject.name, projectId: activeProject.id })
                }}
                ref={projectSwitcherTriggerRef}
                title={workspaceTabs ? "Switch Project · Double-click to rename" : undefined}
                type="button"
              >
                <span className="min-w-0 shrink">
                  <span className={cn("block truncate font-semibold", workspaceTabs ? "text-xs" : "text-sm")}>
                    {activeProject?.name ?? "Convax"}
                  </span>
                  {!workspaceTabs && activeProject ? (
                    <Tooltip content={<span className="break-all">{activeProject.rootPath}</span>} side="right">
                      <span
                        aria-label={`Project path: ${activeProject.rootPath}`}
                        className="mt-0.5 block truncate text-[10px] font-normal leading-4 text-muted-foreground"
                        data-project-header-path={activeProject.rootPath}
                      >
                        {activeProject.rootPath}
                      </span>
                    </Tooltip>
                  ) : null}
                </span>
                <ChevronDown
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                    workspaceTabs ? "size-3" : "size-4",
                    switcherOpen && "rotate-180",
                  )}
                />
              </button>
            )}
            {(workspaceTabs && activeProject && !projectEditor) || headerActions ? (
              <div className="ml-auto flex shrink-0 items-center" data-project-sidebar-project-actions="">
                {workspaceTabs && activeProject && !projectEditor ? (
                  <button
                    aria-label={`Rename ${activeProject.name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-md text-text-tertiary opacity-0 transition-[opacity,transform] duration-100 hover:bg-interactive-hover hover:text-text-primary active:scale-95 active:bg-interactive-pressed group-hover/header:opacity-100 focus:opacity-100 motion-reduce:transition-none"
                    onClick={() => setProjectEditor({ name: activeProject.name, projectId: activeProject.id })}
                    title={`Rename ${activeProject.name}`}
                    type="button"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                ) : null}
                {headerActions}
              </div>
            ) : null}
            {switcherOpen ? (
              <ProjectSwitcher
                activeProjectId={projectSnapshot.activeProjectId}
                projects={projectSnapshot.projects}
                rootRef={projectSwitcherRef}
                onActivate={(projectId) => {
                  setSwitcherOpen(false)
                  void controller.activate(projectId)
                }}
                onClose={() => setSwitcherOpen(false)}
                onCreate={() => {
                  setSwitcherOpen(false)
                  openCreateProject()
                }}
                onForget={(project) => {
                  setSwitcherOpen(false)
                  setConfirmForget(project)
                }}
                onOpen={() => {
                  setSwitcherOpen(false)
                  void controller.openProject()
                }}
              />
            ) : null}
          </header>
        ) : null}

        {!activeProject ? (
          <ProjectEmptyState
            loading={!projectSnapshot.initialized}
            onCreate={openCreateProject}
            onOpen={() => void controller.openProject()}
          />
        ) : (
          <>
            <div
              className={cn("flex min-h-0 min-w-0 flex-1 flex-col", resizingSections && "select-none")}
              ref={sectionsRef}
            >
              <section
                className="flex min-h-0 flex-col overflow-hidden"
                data-project-sidebar-section={workspaceTabs ? "project" : "files"}
                style={{
                  flex: workspaceTabs
                    ? `${sectionSplitRatio} 1 0px`
                    : filesExpanded
                      ? displayedExtension && extensionExpanded
                        ? `${sectionSplitRatio} 1 0px`
                        : "1 1 0"
                      : "0 0 36px",
                  minHeight: bothSectionsExpanded ? expandedSectionMinHeight : undefined,
                }}
              >
                {workspaceTabs ? (
                  <div className="flex h-9 shrink-0 items-center gap-1 px-2.5">
                    <button
                      aria-expanded={filesExpanded}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left outline-none hover:bg-interactive-hover focus-visible:ring-2 focus-visible:ring-focus-ring/40"
                      onClick={() => setFilesExpanded((expanded) => !expanded)}
                      type="button"
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-text-tertiary transition-transform duration-150 motion-reduce:transition-none",
                          filesExpanded && "rotate-90",
                        )}
                      />
                      <span className="truncate text-xs font-semibold text-text-secondary">{filesLabel}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-text-tertiary">
                        {visibleEntries.length}
                      </span>
                    </button>
                    <ProjectEntryAddMenu
                      onAddFile={() => {
                        setFilesExpanded(true)
                        void beginCreate("file")
                      }}
                      onAddFolder={() => {
                        setFilesExpanded(true)
                        void beginCreate("directory")
                      }}
                    />
                    <Tooltip content="Open project folder">
                      <Button
                        aria-label="Open project folder"
                        onClick={() => void filesController.openEntry("")}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <FolderOpen />
                      </Button>
                    </Tooltip>
                  </div>
                ) : (
                  <div className="flex h-9 shrink-0 items-center gap-1 px-2">
                    <button
                      aria-expanded={filesExpanded}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30"
                      onClick={() => setFilesExpanded((expanded) => !expanded)}
                      type="button"
                    >
                      <ChevronRight
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          filesExpanded && "rotate-90",
                        )}
                      />
                      <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Files
                      </span>
                    </button>
                    <ProjectEntryAddMenu
                      onAddFile={() => {
                        setFilesExpanded(true)
                        void beginCreate("file")
                      }}
                      onAddFolder={() => {
                        setFilesExpanded(true)
                        void beginCreate("directory")
                      }}
                    />
                    <Tooltip content="Refresh">
                      <Button
                        aria-label="Refresh files"
                        onClick={() => void filesController.refreshVisibleDirectories()}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <RefreshCw className={cn(filesSnapshot.loadingPaths.length > 0 && "animate-spin")} />
                      </Button>
                    </Tooltip>
                  </div>
                )}
                {filesExpanded ? (
                  <div
                    className={cn(
                      "min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-2",
                      dropTargetPath === "" && "bg-drop-target",
                    )}
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
                      <EntryEditorRow
                        editor={editor}
                        level={1}
                        onCancel={() => setEditor(null)}
                        onChange={setEditor}
                        onCommit={commitEditor}
                        workspaceStyle={workspaceTabs}
                      />
                    ) : null}
                    {(filesSnapshot.listings[""]?.entries ?? [])
                      .filter((entry) => !matchingPaths || matchingPaths.has(entry.path))
                      .map((entry) => (
                        <ProjectTreeNode
                          controller={filesController}
                          dropTargetPath={dropTargetPath}
                          editor={editor}
                          entry={entry}
                          entryByPath={entryByPath}
                          firstPath={visibleEntries[0]?.path}
                          key={entry.path}
                          level={1}
                          matchingPaths={matchingPaths}
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
                          onFileActivate={onFileActivate}
                          onRequestDelete={requestDelete}
                          onStartRename={(target) =>
                            setEditor({ kind: "rename", name: target.name, path: target.path })
                          }
                          previewDisabled={Boolean(editor) || treeDragActive}
                          openFilePreview={openFilePreview}
                          resolveFileThumbnailUrl={resolveFileThumbnailUrl}
                          shouldSuppressClick={() => suppressClickAfterDragRef.current}
                          snapshot={filesSnapshot}
                          workspaceStyle={workspaceTabs}
                        />
                      ))}
                    {matchingPaths?.size === 0 ? (
                      <div
                        className="grid h-32 place-items-center px-5 text-center text-xs text-muted-foreground"
                        role="status"
                      >
                        No matching project files.
                      </div>
                    ) : filesSnapshot.listings[""]?.entries.length === 0 && !editor ? (
                      <div className="flex h-32 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
                        <FolderOpen className="size-7 opacity-60" />
                        <span>This project is empty.</span>
                        <button
                          className="font-medium text-primary hover:underline"
                          onClick={() => void beginCreate("file")}
                          type="button"
                        >
                          Create a file
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {workspaceTabs && displayedExtension ? (
                <div
                  aria-label={filesCanvasResizeLabel}
                  aria-orientation="horizontal"
                  aria-valuemax={Math.round(sectionSplitBounds.maximum * 100)}
                  aria-valuemin={Math.round(sectionSplitBounds.minimum * 100)}
                  aria-valuenow={Math.round(sectionSplitRatio * 100)}
                  aria-valuetext={`${Math.round(sectionSplitRatio * 100)}% — ${filesLabel}`}
                  className="group relative h-1.5 shrink-0 cursor-row-resize touch-none outline-none"
                  data-project-sidebar-splitter=""
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
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(event.pointerId)
                    setResizingSections(false)
                  }}
                  role="separator"
                  tabIndex={0}
                  title="Drag to resize. Use arrow keys when focused."
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border-subtle"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_1px_var(--ui-surface-panel)] transition-[width] duration-150 group-hover:w-12 group-focus-visible:w-12 motion-reduce:transition-none"
                  />
                </div>
              ) : null}

              {workspaceTabs && displayedExtension ? (
                <section
                  aria-busy={displayedExtension.busy}
                  className={cn("flex min-h-0 flex-col overflow-hidden", displayedExtension.busy && "opacity-70")}
                  data-project-sidebar-section="canvas"
                  style={{
                    flex: `${1 - sectionSplitRatio} 1 0px`,
                    minHeight: bothSectionsExpanded ? expandedSectionMinHeight : undefined,
                  }}
                >
                  <div className="flex h-9 shrink-0 items-center gap-1 px-2.5">
                    {displayedExtension.header ? (
                      <div className="flex min-w-0 flex-1 items-center">{displayedExtension.header}</div>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1">
                        <span className="truncate text-xs font-semibold text-text-secondary">Canvas</span>
                        {displayedExtension.count === undefined ? null : (
                          <span className="shrink-0 text-[10px] tabular-nums text-text-tertiary">
                            {displayedExtension.count}
                          </span>
                        )}
                      </div>
                    )}
                    {displayedExtension.actions}
                    <Tooltip content={searchLabel}>
                      <Button
                        aria-label={searchLabel}
                        aria-pressed={searchOpen}
                        onClick={() => {
                          if (searchOpen) setSearchQuery("")
                          setSearchOpen(!searchOpen)
                        }}
                        ref={searchTriggerRef}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Search />
                      </Button>
                    </Tooltip>
                    {displayedExtension.onCreate ? (
                      <Tooltip content={displayedExtension.createLabel ?? `New ${displayedExtension.label}`}>
                        <Button
                          aria-label={displayedExtension.createLabel ?? `New ${displayedExtension.label}`}
                          disabled={displayedExtension.busy}
                          onClick={() => {
                            displayedExtension.onCreate?.()
                          }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Plus />
                        </Button>
                      </Tooltip>
                    ) : null}
                  </div>
                  {searchOpen ? (
                    <div className="flex h-9 shrink-0 items-center px-2.5 pb-1">
                      <Input
                        aria-label={searchLabel}
                        autoFocus
                        className="h-7 min-w-0 flex-1 text-xs"
                        onInput={(event) => setSearchQuery(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return
                          event.preventDefault()
                          event.stopPropagation()
                          setSearchQuery("")
                          setSearchOpen(false)
                          queueMicrotask(() => searchTriggerRef.current?.focus())
                        }}
                        placeholder={searchLabel}
                        type="search"
                        value={searchQuery}
                      />
                    </div>
                  ) : null}
                  {renderedExtensionContent}
                </section>
              ) : null}

              {bothSectionsExpanded && !workspaceTabs ? (
                <div
                  aria-label={
                    workspaceTabs
                      ? "Resize Canvas and Project sections"
                      : `Resize Files and ${displayedExtension?.label ?? "extension"} sections`
                  }
                  aria-orientation="horizontal"
                  aria-valuemax={Math.round(sectionSplitBounds.maximum * 100)}
                  aria-valuemin={Math.round(sectionSplitBounds.minimum * 100)}
                  aria-valuenow={Math.round(sectionSplitRatio * 100)}
                  aria-valuetext={`${Math.round(sectionSplitRatio * 100)}% for ${workspaceTabs ? "Canvas" : "Files"}`}
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
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(event.pointerId)
                    setResizingSections(false)
                  }}
                  role="separator"
                  tabIndex={0}
                  title="Drag to resize. Use arrow keys when focused."
                >
                  <span className="absolute inset-x-2 top-1/2 h-px origin-center -translate-y-1/2 bg-border-subtle transition-transform duration-150 group-hover:scale-y-2 group-focus-visible:scale-y-2 group-focus-visible:bg-focus-ring motion-reduce:transition-none" />
                </div>
              ) : null}

              {displayedExtension && !workspaceTabs ? (
                <section
                  aria-busy={displayedExtension.busy}
                  className={cn(
                    "flex min-h-0 flex-col overflow-hidden",
                    !workspaceTabs && !bothSectionsExpanded && "border-t border-border",
                    displayedExtension.busy && "opacity-70",
                  )}
                  style={{
                    flex: workspaceTabs
                      ? `${sectionSplitRatio} 1 0px`
                      : extensionExpanded
                        ? filesExpanded
                          ? `${1 - sectionSplitRatio} 1 0px`
                          : "1 1 0"
                        : "0 0 36px",
                    minHeight: bothSectionsExpanded ? expandedSectionMinHeight : undefined,
                  }}
                >
                  {workspaceTabs ? (
                    <div className="flex h-9 shrink-0 items-center gap-1 px-2">
                      <span className="min-w-0 flex-1 truncate px-1.5 text-[11px] font-semibold text-muted-foreground">
                        Canvas
                      </span>
                      {displayedExtension.count === undefined ? null : (
                        <span className="mr-1 text-[10px] tabular-nums text-muted-foreground/70">
                          {displayedExtension.count}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-9 shrink-0 items-center gap-1 px-2">
                      <button
                        aria-expanded={extensionExpanded}
                        aria-label={`${extensionExpanded ? "Collapse" : "Expand"} ${displayedExtension.label}`}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30"
                        onClick={() => setExtensionExpanded((expanded) => !expanded)}
                        type="button"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground transition-transform",
                            extensionExpanded && "rotate-90",
                          )}
                        />
                      </button>
                      {displayedExtension.header ? (
                        <div className="flex min-w-0 flex-1 items-center">{displayedExtension.header}</div>
                      ) : (
                        <button
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30"
                          onClick={() => setExtensionExpanded((expanded) => !expanded)}
                          type="button"
                        >
                          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            {displayedExtension.label}
                          </span>
                          {displayedExtension.count === undefined ? null : (
                            <span className="text-[10px] tabular-nums text-muted-foreground/70">
                              {displayedExtension.count}
                            </span>
                          )}
                        </button>
                      )}
                      {displayedExtension.actions}
                      {displayedExtension.onCreate ? (
                        <Tooltip content={displayedExtension.createLabel ?? `New ${displayedExtension.label}`}>
                          <Button
                            aria-label={displayedExtension.createLabel ?? `New ${displayedExtension.label}`}
                            disabled={displayedExtension.busy}
                            onClick={() => {
                              setExtensionExpanded(true)
                              displayedExtension.onCreate?.()
                            }}
                            size="icon-sm"
                            variant="ghost"
                          >
                            <Plus />
                          </Button>
                        </Tooltip>
                      ) : null}
                    </div>
                  )}
                  {workspaceTabs || extensionExpanded ? renderedExtensionContent : null}
                </section>
              ) : null}
            </div>
            {!embeddedFiles && footerActions ? (
              <div
                className="mt-auto min-w-0 shrink-0 overflow-hidden bg-surface-inset/35 p-2 shadow-[0_-16px_32px_-30px_rgb(0_0_0_/_72%)]"
                data-project-sidebar-footer=""
              >
                {footerActions}
              </div>
            ) : null}
          </>
        )}

        {projectSnapshot.error || filesSnapshot.error ? (
          <div className="absolute inset-x-3 bottom-11 z-30 flex items-start gap-2 rounded-lg border border-destructive/25 bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
            <span className="min-w-0 flex-1">{projectSnapshot.error ?? filesSnapshot.error}</span>
            <button
              aria-label="Dismiss error"
              onClick={() => {
                if (projectSnapshot.error) controller.clearError()
                else filesController.clearError()
              }}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        {createProjectOpen ? (
          <Modal
            title="New project"
            onClose={() => {
              if (!creatingProject) setCreateProjectOpen(false)
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!projectName.trim() || creatingProjectRef.current) return
                creatingProjectRef.current = true
                setCreatingProject(true)
                void controller
                  .createProject(projectName.trim())
                  .then((created) => {
                    if (!created) return
                    setProjectName("")
                    setCreateProjectOpen(false)
                  })
                  .finally(() => {
                    creatingProjectRef.current = false
                    setCreatingProject(false)
                  })
              }}
            >
              <label className="mb-1.5 block text-xs font-medium" htmlFor="project-name">
                Project name
              </label>
              <input
                autoFocus
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                disabled={creatingProject}
                id="project-name"
                onChange={(event) => {
                  setProjectName(event.currentTarget.value)
                  if (projectSnapshot.error) controller.clearError()
                }}
                placeholder="My project"
                value={projectName}
              />
              {projectSnapshot.error ? (
                <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
                  {projectSnapshot.error}
                </p>
              ) : (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  It will be created in your Documents/Convax workspace.
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  disabled={creatingProject}
                  onClick={() => setCreateProjectOpen(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button disabled={!projectName.trim() || creatingProject} size="sm" type="submit">
                  {creatingProject ? <LoaderCircle className="animate-spin" /> : null}
                  Create project
                </Button>
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
            onConfirm={() =>
              void filesController.deleteEntries(confirmDeletePaths).then(() => setConfirmDeletePaths(null))
            }
            title="Delete selected items?"
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

function ProjectEntryAddMenu({ onAddFile, onAddFolder }: { onAddFile: () => void; onAddFolder: () => void }) {
  const preserveEditorFocusRef = useRef(false)
  const selectAddAction = (action: () => void) => {
    preserveEditorFocusRef.current = true
    action()
  }

  return (
    <DropdownMenu>
      <Tooltip content="Add file or folder">
        <DropdownMenuTrigger aria-label="Add file or folder" size="icon-sm" variant="ghost">
          <Plus />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!preserveEditorFocusRef.current) return
          preserveEditorFocusRef.current = false
          event.preventDefault()
        }}
      >
        <DropdownMenuItem onSelect={() => selectAddAction(onAddFile)}>
          <Plus />
          Add file
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => selectAddAction(onAddFolder)}>
          <FolderPlus />
          Add folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectTreeEntryName(props: { directory: boolean; name: string }) {
  if (props.directory) return <span className="min-w-0 flex-1 truncate px-1.5">{props.name}</span>
  return <ProjectFileEntryName name={props.name} />
}

function ProjectFileEntryName(props: { name: string }) {
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const [displayName, setDisplayName] = useState(props.name)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measurer = measureRef.current
    if (!container || !measurer) return

    const updateDisplayName = () => {
      const style = window.getComputedStyle(container)
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
      const availableWidth = Math.max(0, container.clientWidth - horizontalPadding)
      const measureText = (value: string) => {
        measurer.textContent = value
        return measurer.getBoundingClientRect().width
      }
      const nextDisplayName = fitProjectFilename(props.name, availableWidth, measureText)
      setDisplayName((current) => (current === nextDisplayName ? current : nextDisplayName))
    }

    updateDisplayName()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateDisplayName)
      return () => window.removeEventListener("resize", updateDisplayName)
    }
    const observer = new ResizeObserver(updateDisplayName)
    observer.observe(container)
    return () => observer.disconnect()
  }, [props.name])

  return (
    <span
      aria-label={props.name}
      className="relative min-w-0 flex-1 overflow-hidden px-1.5"
      data-project-filename
      ref={containerRef}
      title={props.name}
    >
      <span aria-hidden="true" className="block truncate" data-project-filename-visible>
        {displayName}
      </span>
      <span
        aria-hidden="true"
        className="invisible absolute left-0 top-0 whitespace-nowrap"
        data-project-filename-measurer
        ref={measureRef}
      />
    </span>
  )
}

function ProjectTreeNode(props: {
  controller: ProjectFilesController
  dropTargetPath: string | null
  editor: EntryEditor | null
  entry: ProjectEntry
  entryByPath: Map<string, ProjectEntry>
  firstPath?: string
  level: number
  matchingPaths: ReadonlySet<string> | null
  onBeginCreate: (kind: ProjectEntryKind, parentPath: string) => Promise<void>
  onCancelEditor: () => void
  onChangeEditor: (editor: EntryEditor) => void
  onCommitEditor: () => Promise<void>
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>, destinationPath: string) => void
  onDragStart: () => void
  onDrop: (event: DragEvent<HTMLElement>, destinationPath: string) => Promise<void>
  onFileActivate?: (input: { entry: ProjectEntry; projectId: string }) => void
  openFilePreview?: ProjectFilePreviewOpener
  onRequestDelete: (path: string) => void
  onStartRename: (entry: ProjectEntry) => void
  previewDisabled: boolean
  resolveFileThumbnailUrl?: (input: {
    path: string
    projectId: string
  }) => Promise<ProjectFileThumbnailResolverResult> | ProjectFileThumbnailResolverResult
  shouldSuppressClick: () => boolean
  snapshot: ProjectFilesControllerSnapshot
  workspaceStyle: boolean
}) {
  const { entry, snapshot } = props
  const directory = entry.kind === "directory"
  const dropDestinationPath = directory ? entry.path : entry.parentPath
  const listing = snapshot.listings[entry.path]
  const children = listing?.entries ?? []
  const expanded =
    snapshot.expandedPaths.includes(entry.path) ||
    Boolean(props.matchingPaths && children.some((child) => props.matchingPaths?.has(child.path)))
  const selected = snapshot.selectedPaths.includes(entry.path)
  const loading = snapshot.loadingPaths.includes(entry.path)
  const editing = props.editor?.kind === "rename" && props.editor.path === entry.path
  const previewKind = getFilePreviewKind(entry)
  const previewCacheKey = snapshot.projectId ? projectFileThumbnailCacheKey(snapshot.projectId, entry) : null
  const [thumbnail, setThumbnail] = useState<ProjectFileThumbnail | null>(() =>
    previewCacheKey ? (fileThumbnailCache.get(previewCacheKey) ?? null) : null,
  )
  const rowRef = useRef<HTMLDivElement | null>(null)
  const previewOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPosition, setPreviewPosition] = useState({ left: 0, top: 0 })

  useEffect(() => {
    if (!previewKind || !snapshot.projectId || !previewCacheKey) {
      setThumbnail(null)
      return
    }
    if (previewKind === "markdown" || previewKind === "text") {
      setThumbnail(null)
      return
    }
    const cached = fileThumbnailCache.get(previewCacheKey)
    if (cached) {
      setThumbnail(cached)
      return
    }
    const canOpenMediaThumbnail = (previewKind === "image" || previewKind === "video") && Boolean(props.openFilePreview)
    if (!canOpenMediaThumbnail && !props.resolveFileThumbnailUrl) {
      setThumbnail(null)
      return
    }
    if (previewKind === "video" && !props.openFilePreview) {
      setThumbnail(null)
      return
    }
    const abortController = new AbortController()
    setThumbnail(null)
    const thumbnailPromise: Promise<ProjectFileThumbnail | null> = Promise.resolve().then(async () => {
      const thumbnailInput = { path: entry.path, projectId: snapshot.projectId! }
      if (previewKind === "image" && props.openFilePreview) {
        return captureProjectImageThumbnail(thumbnailInput, props.openFilePreview, abortController.signal)
      }
      if (previewKind === "video") {
        return captureProjectVideoThumbnail(thumbnailInput, props.openFilePreview!, abortController.signal)
      }
      return normalizeProjectFileThumbnail(await props.resolveFileThumbnailUrl?.(thumbnailInput))
    })
    void thumbnailPromise
      .then((nextThumbnail) => {
        if (abortController.signal.aborted || !nextThumbnail?.dataUrl) return
        cacheFileThumbnail(previewCacheKey, nextThumbnail)
        setThumbnail(nextThumbnail)
      })
      .catch(() => {
        if (!abortController.signal.aborted) setThumbnail(null)
      })
    return () => {
      abortController.abort()
    }
  }, [
    entry.path,
    previewCacheKey,
    previewKind,
    props.openFilePreview,
    props.resolveFileThumbnailUrl,
    snapshot.projectId,
  ])

  const clearPreviewTimer = (timerRef: typeof previewOpenTimerRef) => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const cancelPreviewClose = () => clearPreviewTimer(previewCloseTimerRef)
  const schedulePreviewOpen = () => {
    cancelPreviewClose()
    if (
      !previewKind ||
      props.previewDisabled ||
      ((previewKind === "image" || previewKind === "video" || previewKind === "audio") && !props.openFilePreview)
    )
      return
    clearPreviewTimer(previewOpenTimerRef)
    previewOpenTimerRef.current = setTimeout(() => {
      previewOpenTimerRef.current = null
      const bounds = rowRef.current?.getBoundingClientRect()
      if (!bounds || props.previewDisabled) return
      const preferredLeft = bounds.right + 10
      const left = preferredLeft + 320 <= window.innerWidth - 12 ? preferredLeft : Math.max(12, bounds.left - 330)
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

  useEffect(
    () => () => {
      clearPreviewTimer(previewOpenTimerRef)
      clearPreviewTimer(previewCloseTimerRef)
    },
    [],
  )

  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    props.onDragStart()
    setPreviewOpen(false)
    const paths = selected ? snapshot.selectedPaths : [entry.path]
    const entries = paths.flatMap((path) => {
      const item = props.entryByPath.get(path)
      if (!item) return []
      const presentation = snapshot.projectId
        ? resolveProjectEntryDragPresentation(snapshot.projectId, item)
        : undefined
      return [
        {
          kind: item.kind,
          name: item.name,
          path: item.path,
          ...(presentation ? { presentation } : {}),
        },
      ]
    })
    if (!selected) props.controller.selectEntry(entry.path, { range: false, toggle: false })
    event.dataTransfer.effectAllowed = "copyMove"
    const serialized = serializeBoundedProjectEntryDrag({
      entries,
      projectId: snapshot.projectId ?? "",
      version: 1,
    })
    if (serialized) event.dataTransfer.setData(PROJECT_ENTRY_DRAG_TYPE, serialized)
    event.dataTransfer.setData("text/plain", entries.map((item) => item.path).join("\n"))
  }
  const row = (
    <div
      aria-expanded={directory ? expanded : undefined}
      aria-level={props.level}
      aria-selected={selected}
      className={cn(
        props.workspaceStyle
          ? "group my-0.5 flex h-7 select-none items-center rounded-md pr-1 text-[13px] outline-none transition-transform duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-focus-ring/40 motion-reduce:transition-none"
          : "group my-0.5 flex h-7 select-none items-center rounded-md pr-1 text-[13px] outline-none",
        props.workspaceStyle
          ? selected
            ? "bg-interactive-selected font-medium text-text-primary"
            : "text-text-secondary hover:bg-interactive-hover hover:text-text-primary active:bg-interactive-pressed"
          : selected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-muted/70",
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
        if (!directory && !range && !toggle && snapshot.projectId) {
          props.onFileActivate?.({ entry, projectId: snapshot.projectId })
        }
      }}
      onDoubleClick={() => {
        if (!directory) void props.controller.openEntry(entry.path)
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => props.onDragOver(event, dropDestinationPath)}
      onDragStart={startDrag}
      onDrop={(event) => void props.onDrop(event, dropDestinationPath)}
      onMouseEnter={schedulePreviewOpen}
      onMouseLeave={schedulePreviewClose}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === "F2") props.onStartRename(entry)
        if (event.key === "Delete" || event.key === "Backspace") props.onRequestDelete(entry.path)
        if (directory && event.key === "ArrowRight" && !expanded) void props.controller.toggleDirectory(entry.path)
        if (directory && event.key === "ArrowLeft" && expanded) void props.controller.toggleDirectory(entry.path)
        if (event.key === "ArrowDown" || event.key === "ArrowUp")
          focusAdjacentTreeRow(event.currentTarget, event.key === "ArrowDown" ? 1 : -1)
      }}
      role="treeitem"
      tabIndex={selected || (!snapshot.selectedPaths.length && props.firstPath === entry.path) ? 0 : -1}
      ref={rowRef}
    >
      <span
        aria-hidden="true"
        data-project-tree-indent={props.workspaceStyle ? "" : undefined}
        style={{ width: `${(props.level - 1) * 14 + (props.workspaceStyle ? 16 : 0)}px` }}
      />
      {directory ? (
        <button
          aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
          className={cn(
            "grid shrink-0 place-items-center rounded outline-none",
            props.workspaceStyle
              ? "size-6 text-text-tertiary hover:bg-interactive-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus-ring/40"
              : "size-6 text-muted-foreground hover:text-foreground",
          )}
          onClick={(event) => {
            event.stopPropagation()
            void props.controller.toggleDirectory(entry.path)
          }}
          type="button"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      <EntryIcon entry={entry} expanded={expanded} previewKind={previewKind} previewUrl={thumbnail?.dataUrl ?? null} />
      {editing ? (
        <InlineInput
          label={`Rename ${entry.name}`}
          onCancel={props.onCancelEditor}
          onChange={(name) => props.onChangeEditor({ kind: "rename", name, path: entry.path })}
          onCommit={props.onCommitEditor}
          value={props.editor?.name ?? ""}
        />
      ) : (
        <ProjectTreeEntryName directory={directory} name={entry.name} />
      )}
      {!editing ? (
        props.workspaceStyle ? (
          <button
            aria-label={`More actions for ${entry.name}`}
            className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-text-tertiary opacity-0 outline-none transition-[opacity,transform] duration-100 hover:bg-interactive-hover hover:text-text-primary active:scale-95 active:bg-interactive-pressed group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-focus-ring/40 motion-reduce:transition-none"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const bounds = event.currentTarget.getBoundingClientRect()
              event.currentTarget.closest<HTMLElement>("[data-project-entry-path]")?.dispatchEvent(
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
        ) : (
          <MoreHorizontal className="size-3.5 opacity-0 group-hover:opacity-35" />
        )
      ) : null}
    </div>
  )
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {directory ? (
            <>
              <ContextMenuItem onSelect={() => void props.onBeginCreate("file", entry.path)}>
                <Plus />
                New file
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void props.onBeginCreate("directory", entry.path)}>
                <FolderPlus />
                New folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : null}
          <ContextMenuItem onSelect={() => void props.controller.openEntry(entry.path)}>
            <FolderInput />
            Open
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void props.controller.revealEntry(entry.path)}>
            <Search />
            Show in File Manager
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => props.onStartRename(entry)}>
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuItem className="text-destructive" onSelect={() => props.onRequestDelete(entry.path)}>
            <Trash2 />
            Move to Trash
          </ContextMenuItem>
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
                workspaceStyle={props.workspaceStyle}
              />
            ) : null}
            {loading ? (
              <TreeStateRow
                icon={<LoaderCircle className="animate-spin" />}
                label="Loading…"
                level={props.level + 1}
                workspaceStyle={props.workspaceStyle}
              />
            ) : null}
            {!loading &&
            listing &&
            children.length === 0 &&
            !(props.editor?.kind === "create" && props.editor.parentPath === entry.path) ? (
              <TreeStateRow label="Empty folder" level={props.level + 1} workspaceStyle={props.workspaceStyle} />
            ) : null}
            {children
              .filter((child) => !props.matchingPaths || props.matchingPaths.has(child.path))
              .map((child) => (
                <ProjectTreeNode key={child.path} {...props} entry={child} level={props.level + 1} />
              ))}
          </div>
        ) : null}
      </ContextMenu>
      {previewOpen && previewKind && snapshot.projectId ? (
        <FilePreviewPortal
          controller={props.controller}
          entry={entry}
          kind={previewKind}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={schedulePreviewClose}
          openPreview={props.openFilePreview}
          position={previewPosition}
          projectId={snapshot.projectId}
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
  workspaceStyle?: boolean
}) {
  return (
    <div
      className={cn(
        props.workspaceStyle
          ? "my-0.5 flex h-7 items-center rounded-md bg-interactive-selected pr-1 text-[13px]"
          : "my-0.5 flex h-7 items-center rounded-md bg-accent/60 pr-1 text-[13px]",
      )}
      role="treeitem"
      aria-level={props.level}
    >
      <span style={{ width: `${(props.level - 1) * 14 + 24 + (props.workspaceStyle ? 16 : 0)}px` }} />
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

function TreeStateRow({
  icon,
  label,
  level,
  workspaceStyle,
}: {
  icon?: ReactNode
  label: string
  level: number
  workspaceStyle: boolean
}) {
  return (
    <div
      className="my-0.5 flex h-7 items-center gap-1.5 text-xs text-muted-foreground"
      role="treeitem"
      aria-level={level}
    >
      <span style={{ width: `${(level - 1) * 14 + 24 + (workspaceStyle ? 16 : 0)}px` }} />
      {icon ? <span className="[&>svg]:size-3.5">{icon}</span> : null}
      <span>{label}</span>
    </div>
  )
}

function fileThumbnailUrlCacheCharacters() {
  let characters = 0
  for (const thumbnail of fileThumbnailCache.values()) characters += thumbnail.dataUrl?.length ?? 0
  return characters
}

function cacheFileThumbnail(key: string, thumbnail: ProjectFileThumbnail) {
  const url = thumbnail.dataUrl
  if (!url?.startsWith("data:image/") || url.length > 256 * 1024) return
  fileThumbnailCache.set(key, Object.freeze({ ...thumbnail }))
  while (
    fileThumbnailCache.size > maximumFilePreviewCacheEntries ||
    fileThumbnailUrlCacheCharacters() > maximumFileThumbnailCacheCharacters
  ) {
    const oldestKey = fileThumbnailCache.keys().next().value
    if (typeof oldestKey !== "string") break
    fileThumbnailCache.delete(oldestKey)
  }
}

function normalizeProjectFileThumbnail(
  value: ProjectFileThumbnailResolverResult | undefined,
): ProjectFileThumbnail | null {
  if (typeof value === "string") return { dataUrl: value }
  if (!value || (value.dataUrl !== null && typeof value.dataUrl !== "string")) return null
  return {
    dataUrl: value.dataUrl,
    ...(value.intrinsicHeight === undefined ? {} : { intrinsicHeight: value.intrinsicHeight }),
    ...(value.intrinsicWidth === undefined ? {} : { intrinsicWidth: value.intrinsicWidth }),
  }
}

function serializeBoundedProjectEntryDrag(payload: Parameters<typeof serializeProjectEntryDrag>[0]) {
  try {
    return serializeProjectEntryDrag(payload)
  } catch {
    try {
      return serializeProjectEntryDrag({
        ...payload,
        entries: payload.entries.map(({ presentation: _presentation, ...entry }) => entry),
      })
    } catch {
      return null
    }
  }
}

function projectFileThumbnailCacheKey(projectId: string, entry: Pick<ProjectEntry, "modifiedAt" | "path">) {
  return `${projectId}\u0000${entry.path}\u0000${entry.modifiedAt}`
}

function resolveProjectEntryDragPresentation(projectId: string, entry: ProjectEntry) {
  const mediaKind = getFilePreviewKind(entry)
  if (mediaKind !== "audio" && mediaKind !== "image" && mediaKind !== "video") return undefined
  const thumbnail = fileThumbnailCache.get(projectFileThumbnailCacheKey(projectId, entry))
  if (
    !thumbnail?.dataUrl ||
    !validIntrinsicDimension(thumbnail.intrinsicWidth) ||
    !validIntrinsicDimension(thumbnail.intrinsicHeight)
  )
    return undefined
  return {
    intrinsicHeight: thumbnail.intrinsicHeight,
    intrinsicWidth: thumbnail.intrinsicWidth,
    mediaKind,
    thumbnailDataUrl: thumbnail.dataUrl,
  }
}

function validIntrinsicDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1_000_000
}

function ProjectNameInput(props: {
  name: string
  onCancel: () => void
  onChange: (name: string) => void
  onCommit: () => Promise<void>
}) {
  const canceledRef = useRef(false)
  const committingRef = useRef(false)
  const commit = () => {
    if (canceledRef.current || committingRef.current) return
    committingRef.current = true
    void props.onCommit().finally(() => {
      committingRef.current = false
    })
  }
  return (
    <input
      aria-label="Rename active project"
      autoFocus
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-ring/25"
      onBlur={commit}
      onInput={(event) => props.onChange(event.currentTarget.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Enter") {
          event.preventDefault()
          commit()
        }
        if (event.key === "Escape") {
          event.preventDefault()
          canceledRef.current = true
          props.onCancel()
        }
      }}
      value={props.name}
    />
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
  rootRef: { current: HTMLDivElement | null }
}) {
  return (
    <div
      aria-label="Projects"
      className="absolute left-2 right-2 top-[44px] z-[91] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
      data-project-switcher
      ref={props.rootRef}
      role="dialog"
    >
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Projects</span>
        <button aria-label="Close projects" onClick={props.onClose} type="button">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="max-h-56 overflow-auto">
        {props.projects.map((project) => (
          <div
            className={cn(
              "group my-0.5 flex items-center rounded-lg",
              project.id === props.activeProjectId && "bg-primary/10 text-foreground",
            )}
            key={project.id}
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left"
              onClick={() => props.onActivate(project.id)}
              type="button"
            >
              <Folder className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{project.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {project.missing ? "Folder unavailable" : project.rootPath}
                </span>
              </span>
              {project.id === props.activeProjectId ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
            </button>
            <button
              aria-label={`Remove ${project.name}`}
              className="mr-1 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100"
              onClick={() => props.onForget(project)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="my-1 h-px bg-border" />
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium hover:bg-accent"
        onClick={props.onOpen}
        type="button"
      >
        <FolderPlus className="size-4" />
        Open folder…
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium hover:bg-accent"
        onClick={props.onCreate}
        type="button"
      >
        <Plus className="size-4" />
        New project
      </button>
    </div>
  )
}

function ProjectEmptyState({
  loading,
  onCreate,
  onOpen,
}: {
  loading: boolean
  onCreate: () => void
  onOpen: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center">
      {loading ? (
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
      ) : (
        <>
          <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-primary">
            <FolderOpen className="size-6" />
          </span>
          <h2 className="text-sm font-semibold">Start with a project</h2>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Open a folder or create a clean project for your files.
          </p>
          <Button className="mt-5 w-full" onClick={onOpen} size="sm">
            <FolderPlus />
            Open folder
          </Button>
          <Button className="mt-2 w-full" onClick={onCreate} size="sm" variant="outline">
            <Plus />
            New project
          </Button>
        </>
      )}
    </div>
  )
}

function Modal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-foreground/20 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
        role="dialog"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button aria-label="Close" onClick={onClose} size="icon-sm" variant="ghost">
            <X />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ConfirmDialog(props: {
  confirmLabel: string
  description: string
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
  title: string
}) {
  return (
    <Modal onClose={props.onCancel} title={props.title}>
      <p className="text-xs leading-5 text-muted-foreground">{props.description}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={props.onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button onClick={props.onConfirm} size="sm" variant={props.destructive ? "destructive" : "default"}>
          {props.confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

interface ProjectSidebarLayout {
  extensionExpanded: boolean
  filesExpanded: boolean
  sectionSplitRatio: number
}

function projectSidebarLayoutKey(projectId: string, workspace: boolean) {
  return workspace
    ? `convax.project-sidebar.workspace-layout.v4.${projectId}`
    : `convax.project-sidebar.layout.${projectId}`
}

function readProjectSidebarLayout(projectId: string, workspace: boolean): ProjectSidebarLayout {
  const fallback = {
    extensionExpanded: true,
    filesExpanded: true,
    sectionSplitRatio: defaultSectionSplitRatio,
  }
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(projectSidebarLayoutKey(projectId, workspace))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<ProjectSidebarLayout>
    return {
      extensionExpanded: typeof parsed.extensionExpanded === "boolean" ? parsed.extensionExpanded : true,
      filesExpanded: typeof parsed.filesExpanded === "boolean" ? parsed.filesExpanded : fallback.filesExpanded,
      sectionSplitRatio:
        typeof parsed.sectionSplitRatio === "number" && Number.isFinite(parsed.sectionSplitRatio)
          ? clamp(parsed.sectionSplitRatio, minimumSectionSplitRatio, 1 - minimumSectionSplitRatio)
          : fallback.sectionSplitRatio,
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

function writeProjectSidebarLayout(projectId: string, layout: ProjectSidebarLayout, workspace: boolean) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(projectSidebarLayoutKey(projectId, workspace), JSON.stringify(layout))
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory layout remains usable.
  }
}

function flattenVisibleEntries(snapshot: ProjectFilesControllerSnapshot) {
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

function findMatchingEntryPaths(snapshot: ProjectFilesControllerSnapshot, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return null
  const availablePaths = new Set(
    Object.values(snapshot.listings).flatMap((listing) => listing?.entries.map((entry) => entry.path) ?? []),
  )
  const matches = new Set<string>()
  for (const listing of Object.values(snapshot.listings)) {
    for (const entry of listing?.entries ?? []) {
      if (!`${entry.name} ${entry.path}`.toLocaleLowerCase().includes(normalizedQuery)) continue
      matches.add(entry.path)
      const segments = entry.path.split("/")
      for (let index = 1; index < segments.length; index += 1) {
        const ancestor = segments.slice(0, index).join("/")
        if (availablePaths.has(ancestor)) matches.add(ancestor)
      }
    }
  }
  return matches
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
