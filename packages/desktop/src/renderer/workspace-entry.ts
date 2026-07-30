export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ProjectActivationSnapshot {
  activeProjectId: string | null
  changingActiveProject: boolean
  error: string | null
}

export interface ProjectActivationPort extends SnapshotStore<ProjectActivationSnapshot> {
  activate(projectId: string): Promise<void>
}

export interface ProjectCanvasScopeSnapshot {
  busy: boolean
  error: string | null
  projectId: string | null
}

export interface WorkbenchScopeSnapshot {
  activeInput?: {
    canvasId?: string
    kind: string
    projectId: string
  } | null
  changingInput: boolean
  error: string | null
  projectId: string | null
}

export interface WorkspaceEntryScheduler {
  clearTimeout(handle: unknown): void
  setTimeout(callback: () => void, delayMs: number): unknown
}

export interface WorkspaceMountScheduler extends WorkspaceEntryScheduler {
  clearFrame(handle: unknown): void
  requestFrame(callback: () => void): unknown
}

export interface WorkspaceEntryDependencies {
  catalog: SnapshotStore<ProjectCanvasScopeSnapshot>
  project: ProjectActivationPort
  readLastCanvas(projectId: string): string | undefined
  reconcile(projectId: string, preferredCanvasId?: string): Promise<boolean>
  showWorkspace(): void
  workbench: SnapshotStore<WorkbenchScopeSnapshot>
}

export interface WorkspaceEntryRequest {
  canvasId?: string
  projectId: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface WorkspaceEntryLease {
  readonly canvasId?: string
  readonly projectId: string
  validate(scope?: "canvas" | "project"): boolean
}

const defaultScheduler: WorkspaceEntryScheduler = {
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
}

const defaultTimeoutMs = 10_000

/**
 * Desktop composition coordinator for entering a Project workspace.
 *
 * Project, catalog, and Workbench remain independent state owners. This class only
 * sequences their public capabilities and commits the Desktop surface after every
 * owner confirms the requested scope.
 */
export class WorkspaceEntryCoordinator {
  private request = 0

  constructor(
    private readonly dependencies: WorkspaceEntryDependencies,
    private readonly scheduler: WorkspaceEntryScheduler = defaultScheduler,
  ) {}

  cancelPendingEntry() {
    this.request += 1
  }

  async enter(input: WorkspaceEntryRequest): Promise<boolean> {
    return Boolean(await this.acquire(input))
  }

  async acquire(input: WorkspaceEntryRequest): Promise<WorkspaceEntryLease | null> {
    const request = ++this.request
    const isCurrent = () => request === this.request
    const deadline = input.timeoutMs === undefined ? defaultTimeoutMs : input.timeoutMs
    const timeout = createTimeoutBudget(deadline)

    throwIfAborted(input.signal)
    await waitForProjectTransition(this.dependencies.project, timeout.remaining(), input.signal, this.scheduler)
    if (!isCurrent()) return null

    let project = this.dependencies.project.getSnapshot()
    if (project.activeProjectId !== input.projectId) {
      await this.dependencies.project.activate(input.projectId)
      if (!isCurrent()) return null
      throwIfAborted(input.signal)
      project = this.dependencies.project.getSnapshot()
      if (project.error) throw new Error(project.error)
      if (project.activeProjectId !== input.projectId) return null
    }

    await waitForProjectWorkspaceScope({
      catalog: this.dependencies.catalog,
      projectId: input.projectId,
      scheduler: this.scheduler,
      signal: input.signal,
      timeoutMs: timeout.remaining(),
      workbench: this.dependencies.workbench,
    })
    if (!isCurrent()) return null

    const preferredCanvasId = input.canvasId ?? this.dependencies.readLastCanvas(input.projectId)
    const reconciled = await this.dependencies.reconcile(input.projectId, preferredCanvasId)
    throwIfAborted(input.signal)
    if (!isCurrent() || !reconciled) return null

    project = this.dependencies.project.getSnapshot()
    if (project.activeProjectId !== input.projectId || project.changingActiveProject) return null
    if (project.error) throw new Error(project.error)

    const mountedInput = this.dependencies.workbench.getSnapshot().activeInput
    const canvasId =
      mountedInput?.kind === "canvas" && mountedInput.projectId === input.projectId
        ? mountedInput.canvasId
        : undefined
    throwIfAborted(input.signal)
    this.dependencies.showWorkspace()
    return {
      ...(canvasId ? { canvasId } : {}),
      projectId: input.projectId,
      validate: (scope = "project") => {
        if (!isCurrent()) return false
        const liveProject = this.dependencies.project.getSnapshot()
        const liveWorkbench = this.dependencies.workbench.getSnapshot()
        if (
          liveProject.activeProjectId !== input.projectId ||
          liveProject.changingActiveProject ||
          liveWorkbench.projectId !== input.projectId ||
          liveWorkbench.changingInput
        ) {
          return false
        }
        if (scope === "project") return true
        const liveInput = liveWorkbench.activeInput
        return (
          canvasId !== undefined &&
          liveInput?.kind === "canvas" &&
          liveInput.projectId === input.projectId &&
          liveInput.canvasId === canvasId
        )
      },
    }
  }
}

export function waitForProjectWorkspaceScope(input: {
  catalog: SnapshotStore<ProjectCanvasScopeSnapshot>
  projectId: string
  scheduler?: WorkspaceEntryScheduler
  signal?: AbortSignal
  timeoutMs?: number
  workbench: SnapshotStore<WorkbenchScopeSnapshot>
}) {
  return waitForStores({
    errorMessage: "The selected Project did not finish opening.",
    evaluate: () => {
      const catalog = input.catalog.getSnapshot()
      const workbench = input.workbench.getSnapshot()
      if (
        catalog.projectId !== input.projectId ||
        workbench.projectId !== input.projectId ||
        catalog.busy ||
        workbench.changingInput
      ) {
        return "pending"
      }
      if (catalog.error) return new Error(catalog.error)
      if (workbench.error) return new Error(workbench.error)
      return "ready"
    },
    scheduler: input.scheduler ?? defaultScheduler,
    signal: input.signal,
    stores: [input.catalog, input.workbench],
    timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
  })
}

/**
 * Waits for a React-owned workspace target after the Desktop surface transition.
 * The injected scheduler keeps the DOM-free coordination deterministic in tests.
 */
export function waitForMountedWorkspaceTarget<T>(input: {
  read(): T | null | undefined
  scheduler?: WorkspaceMountScheduler
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<T> {
  throwIfAborted(input.signal)
  const initial = input.read()
  if (initial !== null && initial !== undefined) return Promise.resolve(initial)
  const scheduler =
    input.scheduler ??
    ({
      ...defaultScheduler,
      clearFrame: (handle) => cancelAnimationFrame(handle as number),
      requestFrame: (callback) => requestAnimationFrame(callback),
    } satisfies WorkspaceMountScheduler)
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs
  if (timeoutMs <= 0) return Promise.reject(new Error("The selected workspace target did not finish mounting."))

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let frame: unknown
    let timer: unknown
    const finish = (value?: T, error?: unknown) => {
      if (settled) return
      settled = true
      if (frame !== undefined) scheduler.clearFrame(frame)
      if (timer !== undefined) scheduler.clearTimeout(timer)
      input.signal?.removeEventListener("abort", onAbort)
      if (error !== undefined) reject(toError(error))
      else resolve(value as T)
    }
    const check = () => {
      const value = input.read()
      if (value !== null && value !== undefined) {
        finish(value)
        return
      }
      frame = scheduler.requestFrame(check)
    }
    const onAbort = () => finish(undefined, input.signal?.reason ?? new DOMException("Aborted", "AbortError"))

    input.signal?.addEventListener("abort", onAbort, { once: true })
    timer = scheduler.setTimeout(
      () => finish(undefined, new Error("The selected workspace target did not finish mounting.")),
      timeoutMs,
    )
    check()
  })
}

async function waitForProjectTransition(
  project: SnapshotStore<ProjectActivationSnapshot>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  scheduler: WorkspaceEntryScheduler,
) {
  return waitForStores({
    errorMessage: "The active Project did not finish changing.",
    evaluate: () => {
      const snapshot = project.getSnapshot()
      if (snapshot.changingActiveProject) return "pending"
      return snapshot.error ? new Error(snapshot.error) : "ready"
    },
    scheduler,
    signal,
    stores: [project],
    timeoutMs,
  })
}

type WaitEvaluation = "pending" | "ready" | Error

function waitForStores(input: {
  errorMessage: string
  evaluate(): WaitEvaluation
  scheduler: WorkspaceEntryScheduler
  signal?: AbortSignal
  stores: Array<SnapshotStore<unknown>>
  timeoutMs: number
}) {
  throwIfAborted(input.signal)
  const initial = input.evaluate()
  if (initial === "ready") return Promise.resolve()
  if (initial instanceof Error) return Promise.reject(initial)
  if (input.timeoutMs <= 0) return Promise.reject(new Error(input.errorMessage))

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: unknown
    const stops: Array<() => void> = []
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      if (timer !== undefined) input.scheduler.clearTimeout(timer)
      for (const stop of stops) stop()
      input.signal?.removeEventListener("abort", onAbort)
      if (error !== undefined) reject(toError(error))
      else resolve()
    }
    const check = () => {
      const result = input.evaluate()
      if (result === "ready") finish()
      else if (result instanceof Error) finish(result)
    }
    const onAbort = () => finish(input.signal?.reason ?? new DOMException("Aborted", "AbortError"))

    for (const store of input.stores) stops.push(store.subscribe(check))
    input.signal?.addEventListener("abort", onAbort, { once: true })
    timer = input.scheduler.setTimeout(() => finish(new Error(input.errorMessage)), input.timeoutMs)
    check()
  })
}

function createTimeoutBudget(timeoutMs: number) {
  const startedAt = Date.now()
  return {
    remaining: () => Math.max(0, timeoutMs - (Date.now() - startedAt)),
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw toError(signal.reason ?? new DOMException("Aborted", "AbortError"))
}

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value))
}
