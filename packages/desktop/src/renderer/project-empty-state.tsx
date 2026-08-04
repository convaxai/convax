import { Button, Input, Loading, LoadingSpinner } from "@convax/ui"
import { ArrowRight, Check, Copy, FolderOpen, RotateCcw, TriangleAlert, UserPlus, Users } from "lucide-react"
import { useEffect, useRef, useState } from "react"

type CollaborationSetupAction = "continue" | "create" | "join"

export interface ProjectCollaborationPendingStateProps {
  locale?: "en" | "zh-CN"
  onCreateTeam?(projectId: string): Promise<{ invitation: string | null }>
  onJoinTeam?(input: { invitation: string; projectId: string }): Promise<void>
  onReady?(projectId: string): Promise<void> | void
  projectId?: string
  reducedMotion?: boolean
}

export function ProjectCollaborationPendingState({
  locale = "en",
  onCreateTeam,
  onJoinTeam,
  onReady,
  projectId,
  reducedMotion,
}: ProjectCollaborationPendingStateProps) {
  const [invitation, setInvitation] = useState("")
  const [createdInvitation, setCreatedInvitation] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [joining, setJoining] = useState(false)
  const [pending, setPending] = useState<CollaborationSetupAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const operationRef = useRef(0)
  const available = Boolean(projectId && onCreateTeam && onJoinTeam)
  useEffect(() => {
    operationRef.current += 1
    setInvitation("")
    setCreatedInvitation(null)
    setCopied(false)
    setJoining(false)
    setPending(null)
    setError(null)
  }, [projectId])
  const copy = locale === "zh-CN"
    ? {
        create: "创建团队并启用协同",
        continue: "继续进入项目",
        copy: "复制邀请",
        copyUnavailable: "无法访问剪贴板，请手动选择并复制邀请。",
        copied: "已复制",
        createdDescription: "团队已创建。请先保存或分享这个一次性邀请，然后继续进入项目。",
        createdInvitation: "团队邀请",
        description: "项目结构已安全保存在本机。创建和编辑画布需要先完成团队身份初始化，或连接一位持有当前团队授权的成员。",
        invitation: "邀请凭证",
        invitationPlaceholder: "粘贴团队邀请凭证",
        join: "加入已有团队",
        joinSubmit: "验证并加入",
        title: "等待团队协同授权",
      }
    : {
        create: "Create team and enable collaboration",
        continue: "Continue to Project",
        copy: "Copy invitation",
        copyUnavailable: "Clipboard access is unavailable. Select and copy the invitation manually.",
        copied: "Copied",
        createdDescription: "The team is ready. Save or share this one-time invitation before continuing to the Project.",
        createdInvitation: "Team invitation",
        description: "The Project structure is safely stored locally. Creating or editing a Canvas requires team identity setup or a connection to a member holding current team authority.",
        invitation: "Invitation credential",
        invitationPlaceholder: "Paste a team invitation credential",
        join: "Join an existing team",
        joinSubmit: "Verify and join",
        title: "Team collaboration authority required",
      }

  const execute = async (action: CollaborationSetupAction) => {
    if (!available || pending || !projectId || !onCreateTeam || !onJoinTeam) return
    const exactInvitation = invitation.trim()
    if (action === "join" && !exactInvitation) return
    const operation = operationRef.current + 1
    operationRef.current = operation
    setPending(action)
    setError(null)
    try {
      if (action === "continue") {
        await onReady?.(projectId)
      } else if (action === "create") {
        const result = await onCreateTeam(projectId)
        if (operationRef.current !== operation) return
        if (result.invitation) {
          setCreatedInvitation(result.invitation)
          setCopied(false)
          return
        }
      } else {
        await onJoinTeam({ invitation: exactInvitation, projectId })
      }
      if (operationRef.current === operation) await onReady?.(projectId)
    } catch (cause) {
      if (operationRef.current === operation) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (operationRef.current === operation) setPending(null)
    }
  }

  return (
    <div className="grid size-full place-items-center bg-background p-8" data-project-collaboration-pending="true">
      <section
        aria-labelledby="project-collaboration-pending-title"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-card p-5 text-center shadow-sm"
      >
        <TriangleAlert aria-hidden className="mx-auto size-6 text-status-warning" />
        <h2 className="mt-3 text-base font-semibold text-card-foreground" id="project-collaboration-pending-title">
          {copy.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.description}</p>
        {available && createdInvitation ? (
          <div className="mt-5 space-y-3 text-left">
            <p className="text-sm leading-6 text-muted-foreground">{copy.createdDescription}</p>
            <label className="block text-xs font-medium text-card-foreground" htmlFor="project-created-team-invitation">
              {copy.createdInvitation}
            </label>
            <textarea
              className="min-h-28 w-full resize-y rounded-md border border-border-subtle bg-surface-inset px-3 py-2 font-mono text-xs text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              id="project-created-team-invitation"
              readOnly
              value={createdInvitation}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                disabled={pending !== null}
                onClick={() => {
                  setError(null)
                  if (!navigator.clipboard?.writeText) {
                    setError(copy.copyUnavailable)
                    return
                  }
                  void navigator.clipboard.writeText(createdInvitation).then(
                    () => setCopied(true),
                    (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                }}
                variant="outline"
              >
                {copied ? <Check /> : <Copy />}
                {copied ? copy.copied : copy.copy}
              </Button>
              <Button disabled={pending !== null} onClick={() => void execute("continue")}>
                {pending === "continue" ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <ArrowRight />}
                {copy.continue}
              </Button>
            </div>
            {error ? <p className="text-xs leading-5 text-status-danger" role="alert">{error}</p> : null}
          </div>
        ) : available ? (
          <div className="mt-5 space-y-3 text-left">
            <Button
              className="w-full justify-center"
              data-project-collaboration-action="create"
              disabled={pending !== null}
              onClick={() => void execute("create")}
            >
              {pending === "create" ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <Users />}
              {copy.create}
            </Button>
            {joining ? (
              <form
                className="rounded-md border border-border-subtle bg-surface-inset p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void execute("join")
                }}
              >
                <label className="mb-1.5 block text-xs font-medium text-card-foreground" htmlFor="project-team-invitation">
                  {copy.invitation}
                </label>
                <Input
                  autoComplete="off"
                  disabled={pending !== null}
                  id="project-team-invitation"
                  onInput={(event) => {
                    setInvitation(event.currentTarget.value)
                    setError(null)
                  }}
                  placeholder={copy.invitationPlaceholder}
                  value={invitation}
                />
                <Button
                  className="mt-3 w-full justify-center"
                  data-project-collaboration-action="join-submit"
                  disabled={pending !== null || !invitation.trim()}
                  size="sm"
                  type="submit"
                  variant="outline"
                >
                  {pending === "join" ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <UserPlus />}
                  {copy.joinSubmit}
                </Button>
              </form>
            ) : (
              <Button
                className="w-full justify-center"
                data-project-collaboration-action="join"
                disabled={pending !== null}
                onClick={() => setJoining(true)}
                variant="outline"
              >
                <UserPlus />
                {copy.join}
              </Button>
            )}
            {error ? <p className="text-xs leading-5 text-status-danger" role="alert">{error}</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

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
