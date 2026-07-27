import type { ProjectController } from "@convax/project"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from "@convax/ui"
import {
  ArrowRight,
  Check,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  buildProjectHomeModel,
  enterProjectFromHome,
  enterSelectedProjectFromHome,
  type ProjectHomeEntryResult,
  type ProjectHomeProject,
} from "./project-home-model"

export interface ProjectHomeProps {
  controller: ProjectController
  locale?: "en" | "zh-CN"
  onEnterProject: (projectId: string) => Promise<boolean | void>
}

type PendingAction =
  | "create"
  | "open"
  | `forget:${string}`
  | `project:${string}`
  | `rename:${string}`

const copy = {
  en: {
    continue: "Continue",
    continueEyebrow: "Continue where you left off",
    cancel: "Cancel",
    close: "Close",
    create: "Create a project",
    createHint: "It will be created in your Documents/Convax workspace.",
    createTitle: "New project",
    emptyDescription: "Create a Project or open an existing folder to begin.",
    emptyTitle: "Your next workspace starts here",
    loading: "Loading projects…",
    forget: "Remove from Convax",
    forgetConfirm: "Remove project?",
    forgetDescription: "The folder and its files stay on disk.",
    manage: "Project actions",
    name: "Project name",
    namePlaceholder: "My project",
    open: "Open project",
    projects: "Projects",
    recent: "Recent work",
    rename: "Rename",
    save: "Save",
    unavailable: "Folder unavailable",
  },
  "zh-CN": {
    continue: "继续",
    continueEyebrow: "继续上次工作",
    cancel: "取消",
    close: "关闭",
    create: "创建项目",
    createHint: "项目将创建在 Documents/Convax 工作区。",
    createTitle: "新建项目",
    emptyDescription: "创建项目或打开已有文件夹即可开始。",
    emptyTitle: "从一个项目开始",
    forget: "从 Convax 中移除",
    forgetConfirm: "移除项目？",
    forgetDescription: "项目文件夹和其中的文件仍会保留在磁盘上。",
    loading: "正在加载项目…",
    manage: "项目操作",
    name: "项目名称",
    namePlaceholder: "我的项目",
    open: "打开项目",
    projects: "项目",
    recent: "最近使用",
    rename: "重命名",
    save: "保存",
    unavailable: "文件夹不可用",
  },
} as const

export function ProjectHome({ controller, locale = "en", onEnterProject }: ProjectHomeProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const model = buildProjectHomeModel(snapshot)
  const labels = copy[locale]
  const [createOpen, setCreateOpen] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const [confirmForgetProjectId, setConfirmForgetProjectId] = useState<string | null>(null)
  const createNameInputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    void controller.initialize()
  }, [controller])

  const begin = (action: PendingAction) => {
    if (pendingRef.current) return false
    pendingRef.current = true
    setPending(action)
    setLocalError(null)
    controller.clearError()
    return true
  }

  const finish = (result: ProjectHomeEntryResult) => {
    pendingRef.current = false
    setPending(null)
    if (result.status === "failed") setLocalError(result.message)
  }

  const finishMutation = () => {
    pendingRef.current = false
    setPending(null)
    const error = controller.getSnapshot().error
    setLocalError(error)
    return error === null
  }

  const enter = async (projectId: string) => {
    if (!begin(`project:${projectId}`)) return
    finish(await enterProjectFromHome(controller, projectId, onEnterProject))
  }

  const openProject = async () => {
    if (!begin("open")) return
    finish(await enterSelectedProjectFromHome(controller, () => controller.openProject(), onEnterProject))
  }

  const createProject = async () => {
    const name = projectName.trim()
    if (!name || !begin("create")) return
    const result = await enterSelectedProjectFromHome(controller, () => controller.createProject(name), onEnterProject)
    if (result.status === "entered") {
      setCreateOpen(false)
      setProjectName("")
    }
    finish(result)
  }

  const renameProject = async (project: ProjectHomeProject) => {
    const name = renameName.trim()
    if (!name || !begin(`rename:${project.id}`)) return
    await controller.renameProject(project.id, name)
    if (finishMutation()) {
      setRenamingProjectId(null)
      setRenameName("")
    }
  }

  const forgetProject = async (project: ProjectHomeProject) => {
    if (!begin(`forget:${project.id}`)) return
    await controller.forgetProject(project.id)
    if (finishMutation()) {
      setConfirmForgetProjectId(null)
      setExpandedProjectId(null)
    }
  }

  if (!model.initialized) {
    return (
      <main className="grid size-full place-items-center bg-surface-canvas" data-project-home="true">
        <div className="flex items-center gap-2 text-sm text-text-tertiary" role="status">
          <LoaderCircle className="size-4 animate-spin" />
          {labels.loading}
        </div>
      </main>
    )
  }

  const visibleError = localError ?? snapshot.error

  return (
    <main className="relative size-full overflow-auto bg-surface-canvas text-text-primary" data-project-home="true">
      <div className="relative mx-auto w-full max-w-4xl px-5 pb-14 pt-8 sm:px-8 sm:pt-12">
        {model.continueProject ? (
          <section aria-labelledby="project-home-continue">
            <h1 className="text-sm font-semibold tracking-[-0.01em]" id="project-home-continue">
              {labels.continueEyebrow}
            </h1>
            <ContinueProject
              busy={pending === `project:${model.continueProject.id}`}
              disabled={pending !== null}
              labels={labels}
              locale={locale}
              onEnter={() => void enter(model.continueProject!.id)}
              project={model.continueProject}
            />
          </section>
        ) : model.empty ? (
          <section className="max-w-xl py-6">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-brand">Convax</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">{labels.emptyTitle}</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-text-secondary">{labels.emptyDescription}</p>
          </section>
        ) : (
          <section className="max-w-xl py-6">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-brand">Convax</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">{labels.projects}</h1>
          </section>
        )}

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            className="h-10 justify-center active:scale-[0.98]"
            disabled={pending !== null}
            onClick={() => {
              controller.clearError()
              setLocalError(null)
              setCreateOpen(true)
            }}
            variant="outline"
          >
            <FolderPlus className="text-brand" />
            {labels.create}
          </Button>
          <Button
            className="h-10 justify-center active:scale-[0.98]"
            disabled={pending !== null}
            onClick={() => void openProject()}
            variant="outline"
          >
            {pending === "open" ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
            {labels.open}
          </Button>
        </div>

        {visibleError && !createOpen ? (
          <div
            className="mt-5 max-w-2xl rounded-lg border border-status-danger/25 bg-status-danger-surface px-3.5 py-3 text-sm text-status-danger"
            role="alert"
          >
            {visibleError}
          </div>
        ) : null}

        {model.projects.length > 0 ? (
          <section aria-labelledby="project-home-projects" className="mt-10">
            <h2 className="text-sm font-semibold tracking-[-0.01em]" id="project-home-projects">
              {labels.recent}
            </h2>
            <div
              className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-xl bg-surface-panel shadow-[var(--ui-shadow-low)]"
              data-project-list="true"
            >
              {model.projects.map((project) => (
                <ProjectRow
                  busy={pending === `project:${project.id}`}
                  confirmForget={confirmForgetProjectId === project.id}
                  expanded={expandedProjectId === project.id}
                  key={project.id}
                  labels={labels}
                  locale={locale}
                  onEnter={() => void enter(project.id)}
                  onForget={() => {
                    if (confirmForgetProjectId === project.id) void forgetProject(project)
                    else setConfirmForgetProjectId(project.id)
                  }}
                  onRename={() => void renameProject(project)}
                  onRenameNameChange={setRenameName}
                  onStartRename={() => {
                    setConfirmForgetProjectId(null)
                    setRenamingProjectId(project.id)
                    setRenameName(project.name)
                  }}
                  onExpandedChange={(open) => {
                    setExpandedProjectId(open ? project.id : null)
                    setRenamingProjectId(null)
                    setConfirmForgetProjectId(null)
                    controller.clearError()
                    setLocalError(null)
                  }}
                  pending={pending}
                  project={project}
                  renameName={renameName}
                  renaming={renamingProjectId === project.id}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <Dialog
        dismissible={pending !== "create"}
        initialFocusRef={createNameInputRef}
        onOpenChange={(open) => setCreateOpen(open)}
        open={createOpen}
      >
        <DialogContent className="max-w-sm p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <DialogTitle>{labels.createTitle}</DialogTitle>
              <Button
                aria-label={labels.close}
                disabled={pending === "create"}
                onClick={() => setCreateOpen(false)}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
            <DialogDescription className="mb-4 text-xs">{labels.createHint}</DialogDescription>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void createProject()
              }}
            >
              <label className="mb-1.5 block text-xs font-medium" htmlFor="project-home-name">
                {labels.name}
              </label>
              <input
                className="h-9 w-full rounded-md border border-border-default bg-control-background px-3 text-sm text-text-primary outline-none focus:border-interactive-selected-border focus:ring-2 focus:ring-focus-ring/25"
                disabled={pending === "create"}
                id="project-home-name"
                onChange={(event) => {
                  setProjectName(event.currentTarget.value)
                  setLocalError(null)
                }}
                placeholder={labels.namePlaceholder}
                ref={createNameInputRef}
                value={projectName}
              />
              {visibleError ? (
                <p className="mt-2 text-xs leading-5 text-status-danger" role="alert">
                  {visibleError}
                </p>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button disabled={pending === "create"} onClick={() => setCreateOpen(false)} size="sm" variant="ghost">
                  {labels.cancel}
                </Button>
                <Button disabled={!projectName.trim() || pending === "create"} size="sm" type="submit">
                  {pending === "create" ? <LoaderCircle className="animate-spin" /> : null}
                  {labels.create}
                </Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function ContinueProject(props: {
  busy: boolean
  disabled: boolean
  labels: (typeof copy)[keyof typeof copy]
  locale: "en" | "zh-CN"
  onEnter: () => void
  project: ProjectHomeProject
}) {
  return (
    <div
      className="mt-3 flex min-w-0 items-center gap-4 rounded-xl bg-surface-raised p-3 shadow-[var(--ui-shadow-low)] sm:p-4"
      data-continue-project="true"
    >
      <ProjectGlyph className="hidden h-20 w-32 shrink-0 sm:grid" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-semibold tracking-[-0.025em]">{props.project.name}</h2>
        <p className="mt-1 truncate text-xs text-text-secondary" title={props.project.rootPath}>
          {props.project.rootPath}
        </p>
        <p className="mt-2 text-xs tabular-nums text-text-tertiary">
          {formatLastOpened(props.project.lastOpenedAt, props.project.hasValidRecency, props.locale)}
        </p>
      </div>
      <Button className="active:scale-95" disabled={props.disabled} onClick={props.onEnter}>
        {props.busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
        {props.labels.continue}
      </Button>
      </div>
  )
}

function ProjectRow(props: {
  busy: boolean
  confirmForget: boolean
  expanded: boolean
  labels: (typeof copy)[keyof typeof copy]
  locale: "en" | "zh-CN"
  onEnter: () => void
  onForget: () => void
  onRename: () => void
  onRenameNameChange: (value: string) => void
  onStartRename: () => void
  onExpandedChange: (open: boolean) => void
  pending: PendingAction | null
  project: ProjectHomeProject
  renameName: string
  renaming: boolean
}) {
  return (
    <Disclosure
      disabled={props.pending !== null}
      onOpenChange={props.onExpandedChange}
      open={props.expanded}
    >
      <article className="min-w-0" data-project-row={props.project.id}>
        <div className="flex min-h-16 min-w-0 items-center gap-1 px-2 py-2">
          <button
            className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,transform] duration-100 hover:bg-interactive-hover focus-visible:ring-2 focus-visible:ring-focus-ring/45 active:scale-[0.995] active:bg-interactive-pressed disabled:pointer-events-none disabled:opacity-50"
            data-project-id={props.project.id}
            disabled={!props.project.available || props.pending !== null}
            onClick={props.onEnter}
            type="button"
          >
            <ProjectGlyph className="grid h-11 w-16 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <Folder className="size-3.5 shrink-0 text-brand" />
                <span className="truncate text-sm font-medium">{props.project.name}</span>
                {!props.project.available ? (
                  <span className="shrink-0 text-[11px] text-status-danger">{props.labels.unavailable}</span>
                ) : null}
              </span>
              <span className="mt-1 block truncate text-xs text-text-tertiary" title={props.project.rootPath}>
                {props.project.rootPath}
              </span>
            </span>
            <span className="hidden shrink-0 text-xs tabular-nums text-text-tertiary md:block">
              {formatLastOpened(props.project.lastOpenedAt, props.project.hasValidRecency, props.locale)}
            </span>
            {props.busy ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : null}
          </button>
          <DisclosureTrigger
            aria-label={`${props.labels.manage}: ${props.project.name}`}
            className="size-8 min-h-8 w-8 shrink-0 justify-center px-0 active:scale-95"
          >
            <span className="sr-only">{props.labels.manage}</span>
          </DisclosureTrigger>
        </div>
        <DisclosureContent className="mx-4 border-t border-border-subtle pb-3 pt-3">
          {props.renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                props.onRename()
              }}
            >
              <label className="sr-only" htmlFor={`project-home-rename-${props.project.id}`}>
                {props.labels.rename}
              </label>
              <input
                autoFocus
                className="h-8 min-w-0 flex-1 rounded-md border border-border-default bg-control-background px-2.5 text-sm outline-none focus:border-interactive-selected-border focus:ring-2 focus:ring-focus-ring/25"
                id={`project-home-rename-${props.project.id}`}
                onChange={(event) => props.onRenameNameChange(event.currentTarget.value)}
                value={props.renameName}
              />
              <Button disabled={!props.renameName.trim()} size="sm" type="submit">
                <Check />
                {props.labels.save}
              </Button>
            </form>
          ) : props.confirmForget ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium">{props.labels.forgetConfirm}</span>
                <span className="mt-0.5 block text-xs text-text-tertiary">{props.labels.forgetDescription}</span>
              </span>
              <Button onClick={props.onForget} size="sm" variant="destructive">
                <Trash2 />
                {props.labels.forget}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 break-all text-xs text-text-tertiary">{props.project.rootPath}</p>
              <div className="flex shrink-0 items-center gap-1">
                <Button onClick={props.onStartRename} size="sm" variant="ghost">
                  <Pencil />
                  {props.labels.rename}
                </Button>
                <Button className="text-status-danger hover:text-status-danger" onClick={props.onForget} size="sm" variant="ghost">
                  <Trash2 />
                  {props.labels.forget}
                </Button>
              </div>
            </div>
          )}
        </DisclosureContent>
      </article>
    </Disclosure>
  )
}

function ProjectGlyph({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`place-items-center rounded-md border border-border-subtle bg-surface-inset text-brand ${className}`}
    >
      <Folder className="size-5" />
    </span>
  )
}

function formatLastOpened(lastOpenedAt: number, valid: boolean, locale: "en" | "zh-CN") {
  if (!valid) return locale === "zh-CN" ? "最近使用时间未知" : "Recent activity unavailable"
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(lastOpenedAt)
}
