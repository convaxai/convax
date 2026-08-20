import type { ProjectController } from "@convax/project"
import { Button, LoadingSpinner } from "@convax/ui"
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CreditCard,
  FolderKanban,
  LockKeyhole,
  PanelsTopLeft,
  RefreshCw,
  Rocket,
  Sparkles,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"

import type { PluginServiceTarget } from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { appMessage } from "./app-language"
import {
  completeConvaxOnboarding,
  deferConvaxOnboarding,
  isConvaxOnboardingAccountConnected,
  isConvaxOnboardingPaidPlan,
  nextConvaxOnboardingProgress,
  readConvaxOnboardingProgress,
  resolveConvaxOnboardingRoute,
  resolveConvaxOnboardingService,
  writeConvaxOnboardingProgress,
  type ConvaxOnboardingProgress,
  type ConvaxOnboardingStorage,
} from "./convax-onboarding-model"
import { ConvaxBrand } from "./convax-brand"
import { ProjectHome } from "./project-home"
import type { ServiceCatalogSnapshot } from "./service-catalog-controller"

export interface ConvaxOnboardingProps {
  forceOpen?: boolean
  locale?: "en" | "zh-CN"
  onDismiss?: () => void
  onEnterProject: (projectId: string) => Promise<boolean | void>
  onProgressChange?: (progress: ConvaxOnboardingProgress) => void
  onProjectSelectionStart?: () => void
  onRefreshServices: () => Promise<void>
  onServiceAction: (target: PluginServiceTarget, action: WebPluginServiceAction) => Promise<void>
  onServiceCheckout: (target: PluginServiceTarget, planKey: string) => Promise<void>
  projectController: ProjectController
  reducedMotion?: boolean
  serviceSnapshot: ServiceCatalogSnapshot
  storage: ConvaxOnboardingStorage
}

const copy = {
  en: {
    account: "Account",
    accountDescription: "Sign in once to connect Convax models, credits, subscription, and usage.",
    accountMissing: "The product account service is not available yet.",
    accountMissingDetail:
      "Convax could not find one provisioned account service with sign-in and Checkout. Refresh after provisioning finishes.",
    accountMultiple: "More than one product account service is available.",
    accountMultipleDetail:
      "Convax cannot safely choose an account service. Refresh after the product service configuration is repaired.",
    accountReady: "Your account is connected.",
    browserPending: "Finish signing in in your browser",
    browserPendingDescription: "Convax will continue automatically after the secure browser flow completes.",
    cancelSignIn: "Cancel sign-in",
    canvas: "Canvas",
    canvasDescription: "Arrange and connect your work",
    checkStatus: "Check sign-in status",
    checkoutPending: "Confirming your subscription",
    checkoutPendingDescription: "Until the service confirms a new plan, you can keep using your current plan.",
    checkoutStatus: "Checkout status: {status}",
    connectedAs: "Connected as {account}",
    continueFree: "Continue with Free plan",
    continuePlan: "Continue with current plan",
    credits: "{value} {unit} available",
    dataBoundary: "Signing in does not upload, sync, or share a local Project.",
    defer: "Do this later",
    finish: "Finish setup",
    finishDescription: "Your account and plan are ready. Finish setup and return to your current Project.",
    free: "Free",
    freeDescription: "Local Projects remain available. Connected AI usage follows the current Free credits.",
    liveCheckout: "See the current price and exact benefits in the secure browser Checkout.",
    loadingAccount: "Preparing your Convax account…",
    local: "Local Project",
    localDescription: "Your files stay on this device by default",
    plan: "Plan",
    planDescription: "Your account already includes Free. Upgrade now, or continue without subscribing.",
    planUnavailable: "No upgrade offer is currently available. You can continue with Free and upgrade later.",
    privacy: "Your password is entered only in the system browser and is never sent to the Desktop renderer.",
    productDescription: "Bring real files, Canvas, and Agent into one connected workspace.",
    refresh: "Refresh",
    recommended: "Recommended",
    reopenBrowser: "Reopen browser",
    signIn: "Sign in or create a Convax account",
    signInAction: "Sign in",
    start: "Start",
    taskAccount: "Next: Sign in",
    taskPlan: "Next: Choose a plan",
    taskReady: "Next: Start a Project",
    taskReadyActive: "Next: Finish setup",
    taskResume: "Resume onboarding",
    subscribe: "Subscribe to {plan}",
    subtitle: "Welcome to Convax",
    title: "Start with your real work",
    useLater: "You can upgrade later in Settings → Services.",
    agent: "Agent",
    agentDescription: "Act with the context you select",
  },
  "zh-CN": {
    account: "账号",
    accountDescription: "登录一次，即可连接 Convax 模型、Credits、订阅和使用记录。",
    accountMissing: "账号服务暂不可用",
    accountMissingDetail: "Convax 尚未找到同时支持登录和 Checkout 的产品账号服务。请在预置完成后刷新。",
    accountMultiple: "检测到多个产品账号服务",
    accountMultipleDetail: "Convax 无法安全选择账号服务。请在产品服务配置修复后刷新。",
    accountReady: "账号已连接。",
    browserPending: "请在浏览器中完成登录",
    browserPendingDescription: "安全登录完成后，Convax 会自动继续。",
    cancelSignIn: "取消登录",
    canvas: "Canvas",
    canvasDescription: "组织并连接你的工作",
    checkStatus: "检查登录状态",
    checkoutPending: "正在确认订阅状态",
    checkoutPendingDescription: "在服务端确认新套餐前，你可以继续使用当前套餐。",
    checkoutStatus: "Checkout 状态：{status}",
    connectedAs: "已登录为 {account}",
    continueFree: "继续使用 Free plan",
    continuePlan: "继续使用当前套餐",
    credits: "剩余 {value} {unit}",
    dataBoundary: "登录不会自动上传、同步或共享本地 Project。",
    defer: "暂时跳过",
    finish: "完成设置",
    finishDescription: "账号和套餐已经准备好。完成设置后返回当前 Project。",
    free: "Free",
    freeDescription: "本地 Project 始终可用；联网 AI 能力按当前 Free Credits 使用。",
    liveCheckout: "实时价格与准确权益将在安全的浏览器 Checkout 中显示。",
    loadingAccount: "正在准备 Convax 账号…",
    local: "本地 Project",
    localDescription: "文件默认保留在当前设备",
    plan: "套餐",
    planDescription: "账号已经包含 Free plan。你可以现在升级，也可以不订阅继续使用。",
    planUnavailable: "当前没有可用的升级方案。你可以继续使用 Free，稍后再升级。",
    privacy: "密码只在系统浏览器中输入，不会发送到 Desktop Renderer。",
    productDescription: "把真实文件、Canvas 和 Agent 放进同一个工作空间。",
    refresh: "刷新",
    recommended: "推荐",
    reopenBrowser: "重新打开浏览器",
    signIn: "登录或注册 Convax 账号",
    signInAction: "登录",
    start: "开始",
    taskAccount: "下一步：登录",
    taskPlan: "下一步：选择套餐",
    taskReady: "下一步：开始一个 Project",
    taskReadyActive: "下一步：完成设置",
    taskResume: "继续 Onboarding",
    subscribe: "订阅 {plan}",
    subtitle: "欢迎使用 Convax",
    title: "从真实工作开始",
    useLater: "稍后可在“设置 → 服务”中升级。",
    agent: "Agent",
    agentDescription: "基于你选择的上下文行动",
  },
} as const

function formatMessage(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, String(value)), template)
}

function OnboardingProgress({ locale, step }: { locale: "en" | "zh-CN"; step: 1 | 2 | 3 }) {
  const labels = copy[locale]
  const steps = [labels.account, labels.plan, labels.start]
  return (
    <ol
      aria-label={locale === "zh-CN" ? "Onboarding 进度" : "Onboarding progress"}
      className="convax-onboarding__progress"
    >
      {steps.map((label, index) => {
        const number = index + 1
        const current = number === step
        const complete = number < step
        return (
          <li aria-current={current ? "step" : undefined} data-complete={complete || undefined} key={label}>
            <span aria-hidden="true">{complete ? <Check /> : number}</span>
            <strong>{label}</strong>
          </li>
        )
      })}
    </ol>
  )
}

function OnboardingShell({
  children,
  locale,
  onDefer,
  reducedMotion,
  step,
}: {
  children: ReactNode
  locale: "en" | "zh-CN"
  onDefer: () => void
  reducedMotion: boolean
  step: 1 | 2 | 3
}) {
  return (
    <main
      className="convax-onboarding"
      data-convax-onboarding="true"
      data-convax-onboarding-motion={reducedMotion ? "reduce" : "reveal"}
      data-convax-onboarding-step={step}
    >
      <div aria-hidden="true" className="project-home__atmosphere">
        <span className="project-home__bloom" />
        <span className="project-home__grid" />
      </div>
      <section className="convax-onboarding__surface">
        <header className="convax-onboarding__header">
          <ConvaxBrand label="Convax" showWordmark tone="monochrome" />
          <div className="convax-onboarding__header-actions">
            <OnboardingProgress locale={locale} step={step} />
            <button className="convax-onboarding__defer" onClick={onDefer} type="button">
              <span>{copy[locale].defer}</span>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>
        {children}
      </section>
    </main>
  )
}

export interface ConvaxOnboardingTaskCardProps {
  activeProject?: boolean
  locale?: "en" | "zh-CN"
  onResume: () => void
  placement?: "floating" | "sidebar"
  progress: ConvaxOnboardingProgress
  serviceSnapshot: ServiceCatalogSnapshot
}

export function ConvaxOnboardingTaskCard({
  activeProject = false,
  locale = "en",
  onResume,
  placement = "sidebar",
  progress,
  serviceSnapshot,
}: ConvaxOnboardingTaskCardProps) {
  const labels = copy[locale]
  const resolution = resolveConvaxOnboardingService(serviceSnapshot)
  const route = resolveConvaxOnboardingRoute(progress, resolution)
  if (route === "complete") return null
  const completedSteps = route === "account" ? 0 : route === "plan" ? 1 : 2
  const taskLabel =
    route === "account"
      ? labels.taskAccount
      : route === "plan"
        ? labels.taskPlan
        : activeProject
          ? labels.taskReadyActive
          : labels.taskReady

  return (
    <button
      aria-label={`${labels.taskResume}: ${taskLabel}`}
      className="convax-onboarding-task"
      data-convax-onboarding-task="true"
      data-placement={placement}
      onClick={onResume}
      type="button"
    >
      <span aria-hidden="true" className="convax-onboarding-task__icon">
        <Rocket />
      </span>
      <span className="convax-onboarding-task__content">
        <span className="convax-onboarding-task__title">
          <strong>{taskLabel}</strong>
          <ChevronRight aria-hidden="true" />
        </span>
        <span className="convax-onboarding-task__progress-row">
          <span
            aria-label={locale === "zh-CN" ? `已完成 ${completedSteps}/3` : `${completedSteps} of 3 steps completed`}
            aria-valuemax={3}
            aria-valuemin={0}
            aria-valuenow={completedSteps}
            className="convax-onboarding-task__track"
            role="progressbar"
          >
            <span style={{ width: `${(completedSteps / 3) * 100}%` }} />
          </span>
          <small>{completedSteps}/3</small>
        </span>
      </span>
    </button>
  )
}

function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "danger" | "neutral" }) {
  return (
    <div className="convax-onboarding__notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  )
}

export function ConvaxOnboarding({
  forceOpen = false,
  locale = "en",
  onDismiss,
  onEnterProject,
  onProgressChange,
  onProjectSelectionStart,
  onRefreshServices,
  onServiceAction,
  onServiceCheckout,
  projectController,
  reducedMotion = false,
  serviceSnapshot,
  storage,
}: ConvaxOnboardingProps) {
  const labels = copy[locale]
  const [progress, setProgress] = useState<ConvaxOnboardingProgress>(() => readConvaxOnboardingProgress(storage))
  const [resumeRequested, setResumeRequested] = useState(false)
  const [authorizationAttempted, setAuthorizationAttempted] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const resolution = useMemo(() => resolveConvaxOnboardingService(serviceSnapshot), [serviceSnapshot])
  const route = resolveConvaxOnboardingRoute(progress, resolution)
  const service = resolution.kind === "available" ? resolution.service : undefined
  const projectSnapshot = useSyncExternalStore(
    projectController.subscribe,
    projectController.getSnapshot,
    projectController.getSnapshot,
  )
  const activeProject = projectSnapshot.projects.find((project) => project.id === projectSnapshot.activeProjectId)

  const persist = useCallback(
    (next: ConvaxOnboardingProgress) => {
      writeConvaxOnboardingProgress(storage, next)
      setProgress(next)
      onProgressChange?.(next)
    },
    [onProgressChange, storage],
  )

  const defer = () => {
    persist(deferConvaxOnboarding(progress))
    setResumeRequested(false)
    onDismiss?.()
  }

  useEffect(() => {
    if (!service || !isConvaxOnboardingAccountConnected(service) || progress.completed) return
    const desiredStep = isConvaxOnboardingPaidPlan(service)
      ? "ready"
      : progress.step === "account"
        ? "plan"
        : progress.step
    if (desiredStep !== progress.step) persist(nextConvaxOnboardingProgress(progress, desiredStep))
  }, [persist, progress, service])

  if (route === "complete") {
    return (
      <ProjectHome
        controller={projectController}
        locale={locale}
        onEnterProject={onEnterProject}
        onSelectionStart={onProjectSelectionStart}
        reducedMotion={reducedMotion}
      />
    )
  }

  if (progress.deferred && !forceOpen && !resumeRequested) {
    return (
      <div className="convax-onboarding-deferred" data-convax-onboarding-deferred="true">
        <ProjectHome
          controller={projectController}
          locale={locale}
          onEnterProject={onEnterProject}
          onSelectionStart={onProjectSelectionStart}
          reducedMotion={reducedMotion}
        />
        <ConvaxOnboardingTaskCard
          activeProject={Boolean(activeProject)}
          locale={locale}
          onResume={() => setResumeRequested(true)}
          placement="floating"
          progress={progress}
          serviceSnapshot={serviceSnapshot}
        />
      </div>
    )
  }

  if (route === "ready" && service?.status) {
    const account =
      service.status.account.availability === "available" ? service.status.account.displayName : service.name
    const plan = service.status.plan.availability === "available" ? service.status.plan.name : labels.free
    if (activeProject) {
      return (
        <OnboardingShell locale={locale} onDefer={defer} reducedMotion={reducedMotion} step={3}>
          <div className="convax-onboarding__centered" data-convax-onboarding-ready="true">
            <div aria-hidden="true" className="convax-onboarding__hero-icon">
              <Check />
            </div>
            <p className="convax-onboarding__eyebrow">{labels.start}</p>
            <h1>{labels.finish}</h1>
            <p>{labels.finishDescription}</p>
            <div className="convax-onboarding__actions">
              <Button
                onClick={async () => {
                  setLocalError(null)
                  try {
                    const entered = await onEnterProject(activeProject.id)
                    if (entered !== false) persist(completeConvaxOnboarding(progress))
                  } catch (error) {
                    setLocalError(error instanceof Error ? error.message : String(error))
                  }
                }}
              >
                <Check />
                {labels.finish}
              </Button>
            </div>
            {localError ? <Notice tone="danger">{localError}</Notice> : null}
          </div>
        </OnboardingShell>
      )
    }
    return (
      <ProjectHome
        controller={projectController}
        locale={locale}
        onEnterProject={async (projectId) => {
          const entered = await onEnterProject(projectId)
          if (entered !== false) persist(completeConvaxOnboarding(progress))
          return entered
        }}
        onSelectionStart={onProjectSelectionStart}
        readySummary={{ account, plan }}
        reducedMotion={reducedMotion}
      />
    )
  }

  const pendingAction = serviceSnapshot.actions?.find(
    ({ target }) => target.pluginId === service?.target.pluginId && target.serviceId === service.target.serviceId,
  )?.action
  const authorizationPending = pendingAction === "authorize" || pendingAction === "reauthorize"
  const visibleError =
    localError ?? service?.error ?? (resolution.kind === "unavailable" ? resolution.error : undefined)

  if (route === "account") {
    const unavailableTitle =
      resolution.kind === "unavailable"
        ? resolution.reason === "ambiguous"
          ? labels.accountMultiple
          : labels.accountMissing
        : undefined
    const unavailableDescription =
      resolution.kind === "unavailable"
        ? resolution.reason === "ambiguous"
          ? labels.accountMultipleDetail
          : labels.accountMissingDetail
        : undefined
    const configured = service?.status?.credential.configured === true
    const authorizeAction: WebPluginServiceAction =
      configured && service?.actions.includes("reauthorize") ? "reauthorize" : "authorize"

    const runAuthorization = async () => {
      if (!service) return
      setAuthorizationAttempted(true)
      setLocalError(null)
      try {
        await onServiceAction(service.target, authorizeAction)
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : String(error))
      }
    }

    return (
      <OnboardingShell locale={locale} onDefer={defer} reducedMotion={reducedMotion} step={1}>
        {authorizationPending && service ? (
          <div className="convax-onboarding__centered" data-convax-onboarding-browser-pending="true">
            <div aria-hidden="true" className="convax-onboarding__hero-icon">
              <LockKeyhole />
            </div>
            <p className="convax-onboarding__eyebrow">{labels.account}</p>
            <h1>{labels.browserPending}</h1>
            <p>{labels.browserPendingDescription}</p>
            <div className="convax-onboarding__actions">
              <Button
                disabled={!service.actions.includes("authorization.cancel")}
                onClick={() => void onServiceAction(service.target, "authorization.cancel")}
                variant="outline"
              >
                <X />
                {labels.cancelSignIn}
              </Button>
              <Button onClick={() => void onRefreshServices()} variant="ghost">
                <RefreshCw />
                {labels.checkStatus}
              </Button>
            </div>
          </div>
        ) : (
          <div className="convax-onboarding__account-layout">
            <div className="convax-onboarding__intro">
              <p className="convax-onboarding__eyebrow">{labels.subtitle}</p>
              <h1>{labels.title}</h1>
              <p>{labels.productDescription}</p>
              <div className="convax-onboarding__concepts" aria-label={labels.productDescription}>
                <div>
                  <FolderKanban />
                  <span>
                    <strong>{labels.local}</strong>
                    <small>{labels.localDescription}</small>
                  </span>
                </div>
                <div>
                  <PanelsTopLeft />
                  <span>
                    <strong>{labels.canvas}</strong>
                    <small>{labels.canvasDescription}</small>
                  </span>
                </div>
                <div>
                  <Bot />
                  <span>
                    <strong>{labels.agent}</strong>
                    <small>{labels.agentDescription}</small>
                  </span>
                </div>
              </div>
              <Notice>
                <LockKeyhole />
                {labels.dataBoundary}
              </Notice>
            </div>
            <aside className="convax-onboarding__account-card">
              <div aria-hidden="true" className="convax-onboarding__hero-icon">
                <Sparkles />
              </div>
              <h2>{unavailableTitle ?? labels.signIn}</h2>
              <p>{unavailableDescription ?? labels.accountDescription}</p>
              {resolution.kind === "loading" ? (
                <div className="convax-onboarding__loading">
                  <LoadingSpinner reducedMotion={reducedMotion} />
                  {labels.loadingAccount}
                </div>
              ) : service ? (
                <Button className="w-full justify-center" onClick={() => void runAuthorization()}>
                  <ArrowRight />
                  {authorizationAttempted || visibleError ? labels.reopenBrowser : labels.signInAction}
                </Button>
              ) : (
                <Button className="w-full justify-center" onClick={() => void onRefreshServices()} variant="outline">
                  <RefreshCw />
                  {labels.refresh}
                </Button>
              )}
              <p className="convax-onboarding__privacy">
                <LockKeyhole />
                {labels.privacy}
              </p>
              {visibleError ? <Notice tone="danger">{visibleError}</Notice> : null}
              {authorizationAttempted && service ? (
                <Button
                  className="w-full justify-center"
                  onClick={() => void onRefreshServices()}
                  size="sm"
                  variant="ghost"
                >
                  <RefreshCw />
                  {labels.checkStatus}
                </Button>
              ) : null}
            </aside>
          </div>
        )}
      </OnboardingShell>
    )
  }

  if (!service?.status) return null
  const status = service.status
  const currentPlan = status.plan.availability === "available" ? status.plan : undefined
  const credits = status.credits.availability === "available" ? status.credits : undefined
  const checkout = status.billing.availability === "available" ? status.billing.checkout : undefined
  const offers =
    checkout?.availability === "available" ? checkout.plans.filter((offer) => offer.key !== currentPlan?.key) : []
  const checkoutPending = checkout?.availability === "available" ? checkout.pending : undefined
  const checkoutBusy = pendingAction === "checkout"

  const runCheckout = async (planKey: string) => {
    setLocalError(null)
    try {
      await onServiceCheckout(service.target, planKey)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }

  const continueWithFree = () => persist(nextConvaxOnboardingProgress(progress, "ready"))

  return (
    <OnboardingShell locale={locale} onDefer={defer} reducedMotion={reducedMotion} step={2}>
      <div className="convax-onboarding__plan-heading">
        <p className="convax-onboarding__eyebrow">{labels.plan}</p>
        <h1>{labels.planDescription}</h1>
        <p>
          {formatMessage(labels.connectedAs, {
            account: status.account.availability === "available" ? status.account.displayName : service.name,
          })}
        </p>
      </div>

      {checkoutBusy || checkoutPending ? (
        <Notice>
          <LoadingSpinner reducedMotion={reducedMotion} />
          <span>
            <strong>{labels.checkoutPending}</strong>
            <small>{labels.checkoutPendingDescription}</small>
            {checkoutPending ? (
              <small>{formatMessage(labels.checkoutStatus, { status: checkoutPending.status })}</small>
            ) : null}
          </span>
        </Notice>
      ) : null}

      <div className="convax-onboarding__plans">
        <article className="convax-onboarding__plan-card" data-current="true">
          <header>
            <div>
              <span>{currentPlan?.name ?? labels.free}</span>
              <strong>{labels.free}</strong>
            </div>
            <Check />
          </header>
          <p>{labels.freeDescription}</p>
          {credits ? (
            <small>{formatMessage(labels.credits, { unit: credits.unit, value: credits.remaining })}</small>
          ) : null}
        </article>

        {offers.map((offer, index) => (
          <article className="convax-onboarding__plan-card" data-recommended={index === 0 || undefined} key={offer.key}>
            <header>
              <div>
                <span>{offer.name}</span>
                <strong>
                  {offer.name}
                  {offer.billingInterval
                    ? ` · ${appMessage(locale, `services.interval.${offer.billingInterval}`)}`
                    : ""}
                </strong>
              </div>
              {index === 0 ? <em>{labels.recommended}</em> : <CreditCard />}
            </header>
            <p>{labels.liveCheckout}</p>
            <Button
              className="w-full justify-center"
              disabled={checkoutBusy}
              onClick={() => void runCheckout(offer.key)}
            >
              {checkoutBusy ? <LoadingSpinner reducedMotion={reducedMotion} size="sm" /> : <CreditCard />}
              {formatMessage(labels.subscribe, { plan: offer.name })}
            </Button>
          </article>
        ))}
      </div>

      {offers.length === 0 && !checkoutBusy ? <Notice>{labels.planUnavailable}</Notice> : null}
      {visibleError ? <Notice tone="danger">{visibleError}</Notice> : null}

      <div className="convax-onboarding__plan-actions">
        <Button onClick={continueWithFree} variant="outline">
          <ArrowRight />
          {currentPlan?.key === "free" || !currentPlan ? labels.continueFree : labels.continuePlan}
        </Button>
        <Button onClick={() => void onRefreshServices()} variant="ghost">
          <RefreshCw />
          {labels.refresh}
        </Button>
        <p>{labels.useLater}</p>
      </div>
    </OnboardingShell>
  )
}
