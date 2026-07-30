import { Button, Loading, LoadingSpinner } from "@convax/ui"
import { FolderOpen, RotateCcw, TriangleAlert } from "lucide-react"

export function ProjectRecoveryState({
  error,
  locale = "en",
  onOpenProject,
  onRetry,
  opening = false,
  reducedMotion,
  retrying = false,
}: {
  error?: string | null
  locale?: "en" | "zh-CN"
  onOpenProject: () => void
  onRetry: () => void
  opening?: boolean
  reducedMotion?: boolean
  retrying?: boolean
}) {
  const labels =
    locale === "zh-CN"
      ? {
          description: "已登记的项目暂时不可用。你可以重新连接项目文件夹，或重试加载。",
          open: "重新打开项目",
          retry: "重试",
          title: "无法恢复上次的项目",
        }
      : {
          description:
            "Your registered Projects are temporarily unavailable. Reconnect a Project folder or try loading again.",
          open: "Open a Project",
          retry: "Try again",
          title: "Your last Project could not be restored",
        }

  return (
    <main
      className="grid size-full place-items-center bg-surface-canvas px-6 text-text-primary"
      data-project-recovery="true"
    >
      <section className="w-full max-w-md rounded-xl border border-border-subtle bg-surface-panel p-6 shadow-low">
        <div
          aria-hidden
          className="grid size-10 place-items-center rounded-lg bg-status-warning-surface text-status-warning"
        >
          <TriangleAlert className="size-5" />
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-[-0.02em]">{labels.title}</h1>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{labels.description}</p>
        {error ? (
          <p className="mt-4 rounded-md bg-surface-inset px-3 py-2 text-xs leading-5 text-text-secondary" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button disabled={opening || retrying} onClick={onOpenProject}>
            {opening ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <FolderOpen />}
            {labels.open}
          </Button>
          <Button disabled={opening || retrying} onClick={onRetry} variant="outline">
            {retrying ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <RotateCcw />}
            {labels.retry}
          </Button>
        </div>
      </section>
    </main>
  )
}

export function ProjectLoadingState({
  projectName,
  reducedMotion,
}: {
  projectName: string
  reducedMotion?: boolean
}) {
  return (
    <div className="grid size-full place-items-center bg-background">
      <Loading
        description="Loading canvases and project files"
        label={`Opening ${projectName}…`}
        layout="surface"
        reducedMotion={reducedMotion}
        tone="brand"
      />
    </div>
  )
}

export function ProjectRegistryLoadingState({
  locale = "en",
  reducedMotion,
}: {
  locale?: "en" | "zh-CN"
  reducedMotion?: boolean
}) {
  return (
    <div className="grid size-full place-items-center bg-surface-canvas">
      <Loading
        description={locale === "zh-CN" ? "正在恢复你的工作区" : "Restoring your workspace"}
        label={locale === "zh-CN" ? "正在加载项目…" : "Loading Projects…"}
        layout="surface"
        reducedMotion={reducedMotion}
        tone="brand"
      />
    </div>
  )
}
