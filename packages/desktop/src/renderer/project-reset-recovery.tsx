import type {
  ProjectCollaborationRecoveryClient,
  ProjectResetPreviewV1,
} from "@convax/project"
import { Button, LoadingSpinner } from "@convax/ui"
import { ShieldCheck, Trash2, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"

type Locale = "en" | "zh-CN"

type ResetStep = "preview" | "confirm" | "submitting" | "terminal"

export interface ProjectResetRecoveryStateProps {
  client: ProjectCollaborationRecoveryClient
  locale?: Locale
  onCancel(): void
  onPublished(projectId: string): Promise<void> | void
  onUnavailable(error?: string): void
  project: {
    id: string
    name: string
  }
  reducedMotion?: boolean
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isDigest(value: string) {
  return /^[0-9a-f]{64}$/u.test(value)
}

function requireEligiblePreview(projectId: string, preview: ProjectResetPreviewV1) {
  if (
    preview.projectId !== projectId ||
    preview.ordinaryProjectFilesPreserved !== true ||
    !isDigest(preview.privateDeletionSetDigest) ||
    !isDigest(preview.unsupportedInventoryDigest) ||
    preview.preview.length === 0
  ) {
    throw new Error("The Project reset preview is incomplete or no longer eligible.")
  }
  return preview
}

export function ProjectResetRecoveryState({
  client,
  locale = "en",
  onCancel,
  onPublished,
  onUnavailable,
  project,
  reducedMotion,
}: ProjectResetRecoveryStateProps) {
  const [preview, setPreview] = useState<ProjectResetPreviewV1 | null>(null)
  const [step, setStep] = useState<ResetStep>("preview")
  const [terminalError, setTerminalError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setPreview(null)
    setStep("preview")
    setTerminalError(null)
    void client.inspectProject(project.id)
      .then(async (inspection) => {
        if (inspection.status !== "unsupported-portable-project-version") {
          if (current) onUnavailable()
          return null
        }
        return requireEligiblePreview(project.id, await client.previewReset(project.id))
      })
      .then((nextPreview) => {
        if (current && nextPreview) setPreview(nextPreview)
      })
      .catch((error) => {
        if (current) onUnavailable(errorMessage(error))
      })
    return () => {
      current = false
    }
  }, [client, onUnavailable, project.id])

  if (!preview && step !== "terminal") return null

  const copy = locale === "zh-CN"
    ? {
        cancel: "取消",
        confirmDescription: "此操作会永久删除下列旧版 Convax 私有数据，并创建一个空白协同画布。操作不能撤销。",
        confirmTitle: "确认删除旧画布数据？",
        continue: "继续",
        deletionDigest: "删除集合摘要",
        errorDescription: "重置没有完成。旧数据仍保持关闭状态，Convax 不会自动重试。",
        errorTitle: "无法重置项目",
        inventoryDigest: "旧数据清单摘要",
        preserved: "普通项目文件会保留，包括 Notes、Generated 和项目根目录中的其他文件。",
        previewDescription: "这个项目使用已停用的画布格式。Convax 不会迁移或读取旧画布；你可以检查精确删除范围后重置为空白项目。",
        previewTitle: `重置“${project.name}”的旧画布数据`,
        reset: "删除旧数据并重置",
        scope: "将删除的私有数据",
      }
    : {
        cancel: "Cancel",
        confirmDescription: "This permanently deletes the legacy private Convax data listed below and creates an empty collaborative Canvas. This cannot be undone.",
        confirmTitle: "Delete the legacy Canvas data?",
        continue: "Continue",
        deletionDigest: "Deletion-set digest",
        errorDescription: "The reset did not finish. Legacy data remains closed and Convax will not retry automatically.",
        errorTitle: "The Project could not be reset",
        inventoryDigest: "Unsupported-inventory digest",
        preserved: "Ordinary Project files are preserved, including Notes, Generated, and other files in the Project root.",
        previewDescription: "This Project uses a retired Canvas format. Convax will not migrate or read it; review the exact deletion scope before resetting to an empty Project.",
        previewTitle: `Reset legacy Canvas data in “${project.name}”`,
        reset: "Delete legacy data and reset",
        scope: "Private data to delete",
      }

  if (step === "terminal") {
    return (
      <main className="grid size-full place-items-center bg-surface-canvas px-6 text-text-primary" data-project-reset-error="true">
        <section className="w-full max-w-xl rounded-xl border border-destructive/30 bg-surface-panel p-6 shadow-low" role="alert">
          <TriangleAlert aria-hidden className="size-6 text-destructive" />
          <h1 className="mt-4 text-lg font-semibold">{copy.errorTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{copy.errorDescription}</p>
          {terminalError ? <p className="mt-4 rounded-md bg-surface-inset px-3 py-2 text-xs leading-5">{terminalError}</p> : null}
          <Button autoFocus className="mt-6" onClick={onCancel} variant="outline">{copy.cancel}</Button>
        </section>
      </main>
    )
  }

  if (!preview) return null
  const confirming = step === "confirm" || step === "submitting"
  const submitting = step === "submitting"

  const confirmReset = async () => {
    if (submitting) return
    setStep("submitting")
    try {
      const outcome = await client.confirmReset({ projectId: project.id, token: preview.token })
      if (outcome.status !== "published") {
        throw new Error(
          outcome.reason === "team-service-unavailable"
            ? "The team service is unavailable. The reset was not published."
            : "The reset was canceled before publication.",
        )
      }
      await onPublished(outcome.projectId)
    } catch (error) {
      setTerminalError(errorMessage(error))
      setStep("terminal")
    }
  }

  return (
    <main className="grid size-full place-items-center bg-surface-canvas px-6 text-text-primary" data-project-reset-recovery="true">
      <section className="w-full max-w-2xl rounded-xl border border-border-subtle bg-surface-panel p-6 shadow-low">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-status-warning-surface text-status-warning">
            {confirming ? <TriangleAlert aria-hidden className="size-5" /> : <ShieldCheck aria-hidden className="size-5" />}
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.02em]">
              {confirming ? copy.confirmTitle : copy.previewTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {confirming ? copy.confirmDescription : copy.previewDescription}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-border-subtle bg-surface-inset p-4">
          <h2 className="text-sm font-medium">{copy.scope}</h2>
          <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-xs" data-project-reset-deletion-set="true">
            {preview.preview.map((entry) => (
              <li className="flex gap-2" key={`${entry.kind}:${entry.path}`}>
                <span className="w-16 shrink-0 text-text-tertiary">{entry.kind}</span>
                <span className="break-all text-text-secondary">{entry.path}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 grid gap-3 border-t border-border-subtle pt-4 text-xs">
            <div>
              <dt className="text-text-tertiary">{copy.deletionDigest}</dt>
              <dd className="mt-1 break-all font-mono text-text-secondary" data-project-reset-deletion-digest="true">
                {preview.privateDeletionSetDigest}
              </dd>
            </div>
            <div>
              <dt className="text-text-tertiary">{copy.inventoryDigest}</dt>
              <dd className="mt-1 break-all font-mono text-text-secondary" data-project-reset-inventory-digest="true">
                {preview.unsupportedInventoryDigest}
              </dd>
            </div>
          </dl>
        </div>

        <p className="mt-4 rounded-md bg-status-success-surface px-3 py-2 text-sm leading-6 text-status-success" data-project-reset-preserves-files="true">
          {copy.preserved}
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <Button autoFocus disabled={submitting} onClick={onCancel} variant="outline">{copy.cancel}</Button>
          {confirming ? (
            <Button disabled={submitting} onClick={() => void confirmReset()} variant="destructive">
              {submitting ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <Trash2 />}
              {copy.reset}
            </Button>
          ) : (
            <Button onClick={() => setStep("confirm")}>{copy.continue}</Button>
          )}
        </div>
      </section>
    </main>
  )
}
