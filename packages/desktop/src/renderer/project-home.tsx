import type { ProjectController } from "@convax/project"
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, LoadingSpinner } from "@convax/ui"
import { FileText, FolderOpen, FolderPlus, Image, MessageSquare, X } from "lucide-react"
import { useRef, useState } from "react"
import { ConvaxBrand } from "./convax-brand"
import { enterSelectedProjectFromHome, type ProjectHomeEntryResult } from "./project-home-model"

export interface ProjectHomeProps {
  controller: ProjectController
  locale?: "en" | "zh-CN"
  onEnterProject: (projectId: string) => Promise<boolean | void>
  onSelectionStart?: () => void
  readySummary?: {
    account: string
    plan: string
  }
  reducedMotion?: boolean
}

type PendingAction = "create" | "open"

const copy = {
  en: {
    cancel: "Cancel",
    close: "Close",
    create: "Create project",
    createFirst: "Create first project",
    createHint: "It will be created in your Documents/Convax workspace.",
    createTitle: "New project",
    description: "Bring ideas, files, and AI together in one connected workspace.",
    name: "Project name",
    namePlaceholder: "My project",
    open: "Open project",
    openExisting: "Open existing project",
    readyDescription: "Your account and plan are ready. Start with a local Project or open one you already have.",
    readyTitle: "You’re ready to create",
    title: "Start with a blank canvas",
  },
  "zh-CN": {
    cancel: "取消",
    close: "关闭",
    create: "创建项目",
    createFirst: "创建第一个项目",
    createHint: "项目将创建在 Documents/Convax 工作区。",
    createTitle: "新建项目",
    description: "把想法、文件和 AI 放进同一个空间，自由连接，随时推进。",
    name: "项目名称",
    namePlaceholder: "我的项目",
    open: "打开项目",
    openExisting: "打开已有项目",
    readyDescription: "账号与套餐已经准备就绪。创建一个本地项目，或打开已有项目。",
    readyTitle: "一切准备就绪",
    title: "从一张空白画布开始",
  },
} as const

export function ProjectHome({
  controller,
  locale = "en",
  onEnterProject,
  onSelectionStart,
  readySummary,
  reducedMotion = false,
}: ProjectHomeProps) {
  const labels = copy[locale]
  const [createOpen, setCreateOpen] = useState(false)
  const [projectName, setProjectName] = useState("")
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const createNameInputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef(false)

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

  const runEntry = async (selectProject: () => Promise<boolean>) => {
    try {
      finish(await enterSelectedProjectFromHome(controller, selectProject, onEnterProject))
    } catch (error) {
      finish({
        message: error instanceof Error ? error.message : String(error),
        status: "failed",
      })
    }
  }

  const openProject = async () => {
    if (!begin("open")) return
    onSelectionStart?.()
    await runEntry(() => controller.openProject())
  }

  const createProject = async () => {
    const name = projectName.trim()
    if (!name || !begin("create")) return
    onSelectionStart?.()
    try {
      const result = await enterSelectedProjectFromHome(
        controller,
        () => controller.createProject(name),
        onEnterProject,
      )
      if (result.status === "entered") {
        setCreateOpen(false)
        setProjectName("")
      }
      finish(result)
    } catch (error) {
      finish({
        message: error instanceof Error ? error.message : String(error),
        status: "failed",
      })
    }
  }

  const visibleError = localError ?? controller.getSnapshot().error

  return (
    <main
      className="project-home"
      data-project-home="true"
      data-project-home-motion={reducedMotion ? "reduce" : "reveal"}
    >
      <div aria-hidden="true" className="project-home__atmosphere">
        <span className="project-home__bloom" />
        <span className="project-home__grid" />
      </div>

      <section aria-labelledby="project-home-title" className="project-home__content">
        <div aria-hidden="true" className="project-home__canvas-mark">
          <span className="project-home__connector project-home__connector--left" />
          <span className="project-home__connector project-home__connector--right" />
          <span className="project-home__node project-home__node--document">
            <FileText />
          </span>
          <span className="project-home__node project-home__node--brand">
            <ConvaxBrand label="" tone="monochrome" />
          </span>
          <span className="project-home__node project-home__node--image">
            <Image />
          </span>
          <span className="project-home__node project-home__node--message">
            <MessageSquare />
          </span>
        </div>

        <ConvaxBrand className="project-home__wordmark" label="Convax" showWordmark tone="monochrome" />
        <h1 className="project-home__title" id="project-home-title">
          {readySummary ? labels.readyTitle : labels.title}
        </h1>
        <p className="project-home__description">{readySummary ? labels.readyDescription : labels.description}</p>

        {readySummary ? (
          <dl className="project-home__ready-summary" data-project-home-ready-summary="true">
            <div>
              <dt>{locale === "zh-CN" ? "账号" : "Account"}</dt>
              <dd dir="auto">{readySummary.account}</dd>
            </div>
            <div>
              <dt>{locale === "zh-CN" ? "套餐" : "Plan"}</dt>
              <dd dir="auto">{readySummary.plan}</dd>
            </div>
          </dl>
        ) : null}

        <div className="project-home__actions">
          <Button
            className="project-home__action"
            data-project-action="create"
            disabled={pending !== null}
            onClick={() => {
              controller.clearError()
              setLocalError(null)
              setCreateOpen(true)
            }}
          >
            <FolderPlus />
            {readySummary ? labels.createFirst : labels.create}
          </Button>
          <Button
            className="project-home__action"
            data-project-action="open"
            disabled={pending !== null}
            onClick={() => void openProject()}
            variant="outline"
          >
            {pending === "open" ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <FolderOpen />}
            {readySummary ? labels.openExisting : labels.open}
          </Button>
        </div>

        {visibleError && !createOpen ? (
          <p className="project-home__error" role="alert">
            {visibleError}
          </p>
        ) : null}
      </section>

      <Dialog
        dismissible={pending !== "create"}
        initialFocusRef={createNameInputRef}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open && pending !== "create") {
            setProjectName("")
            setLocalError(null)
          }
        }}
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
            <Input
              disabled={pending === "create"}
              id="project-home-name"
              onInput={(event) => {
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
              <Button
                disabled={pending === "create"}
                onClick={() => {
                  setCreateOpen(false)
                  setProjectName("")
                  setLocalError(null)
                }}
                size="sm"
                variant="ghost"
              >
                {labels.cancel}
              </Button>
              <Button disabled={!projectName.trim() || pending === "create"} size="sm" type="submit">
                {pending === "create" ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : null}
                {labels.create}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  )
}
