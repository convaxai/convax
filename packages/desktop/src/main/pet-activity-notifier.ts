import type {
  PetActivitySnapshot,
  PetActivitySummary,
  PetPreferences,
  PetVisibleActivityState,
} from "../pet-contracts"

export interface PetActivityNotificationOptions {
  body: string
  title: string
}

export interface PetActivityNotification {
  close(): void
  on(event: "click" | "close", listener: () => void): unknown
  show(): void
}

export interface PetActivityNotificationMainWindow {
  isDestroyed(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  isVisible(): boolean
}

export interface PetActivityNotifierOptions {
  createNotification(options: PetActivityNotificationOptions): PetActivityNotification | undefined
  getMainWindow(): PetActivityNotificationMainWindow | null
  onError?(error: unknown): void
  openActivity(activityId: string): Promise<unknown> | unknown
}

const notificationTitles: Partial<Record<PetVisibleActivityState, string>> = {
  blocked: "Agent task blocked",
  "needs-input": "Agent needs your input",
  ready: "Agent task completed",
}

function activitySignature(activity: PetActivitySummary) {
  return `${activity.state}:${activity.updatedAt}`
}

function activitySignatures(snapshot: PetActivitySnapshot) {
  return new Map(snapshot.activities.map((activity) => [activity.id, activitySignature(activity)]))
}

function notificationBody(activity: PetActivitySummary) {
  return `${activity.sessionName} · ${activity.projectName}`.slice(0, 240)
}

export class PetActivityNotifier {
  readonly #notifications = new Set<PetActivityNotification>()
  readonly #options: PetActivityNotifierOptions
  #awake = false
  #baselinePending = true
  #disposed = false
  #latestSnapshot: PetActivitySnapshot | undefined
  #signatures = new Map<string, string>()

  constructor(options: PetActivityNotifierOptions) {
    this.#options = options
  }

  updatePreferences(preferences: Pick<PetPreferences, "awake">) {
    if (this.#disposed || preferences.awake === this.#awake) return
    this.#awake = preferences.awake
    this.#baselinePending = true
    if (!this.#awake) this.#closeNotifications()
    if (this.#latestSnapshot) {
      this.#signatures = activitySignatures(this.#latestSnapshot)
      this.#baselinePending = false
    } else {
      this.#signatures.clear()
    }
  }

  updateActivity(snapshot: PetActivitySnapshot) {
    if (this.#disposed) return
    this.#latestSnapshot = structuredClone(snapshot)
    const nextSignatures = activitySignatures(snapshot)
    if (!this.#awake || this.#baselinePending) {
      this.#signatures = nextSignatures
      this.#baselinePending = false
      return
    }

    const shouldNotify = this.#shouldNotify()
    for (const activity of snapshot.activities) {
      const title = notificationTitles[activity.state]
      if (!title || this.#signatures.get(activity.id) === activitySignature(activity) || !shouldNotify) continue
      this.#show(activity, title)
    }
    this.#signatures = nextSignatures
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#closeNotifications()
    this.#signatures.clear()
    this.#latestSnapshot = undefined
  }

  #shouldNotify() {
    const window = this.#options.getMainWindow()
    return (
      !window ||
      window.isDestroyed() ||
      !window.isVisible() ||
      window.isMinimized() ||
      !window.isFocused()
    )
  }

  #show(activity: PetActivitySummary, title: string) {
    let notification: PetActivityNotification | undefined
    try {
      notification = this.#options.createNotification({
        body: notificationBody(activity),
        title,
      })
      if (!notification) return
      this.#notifications.add(notification)
      notification.on("close", () => {
        if (notification) this.#notifications.delete(notification)
      })
      notification.on("click", () => {
        notification?.close()
        try {
          void Promise.resolve(this.#options.openActivity(activity.id)).catch((error) => this.#report(error))
        } catch (error) {
          this.#report(error)
        }
      })
      notification.show()
    } catch (error) {
      if (notification) this.#notifications.delete(notification)
      this.#report(error)
    }
  }

  #closeNotifications() {
    for (const notification of [...this.#notifications]) {
      try {
        notification.close()
      } catch (error) {
        this.#report(error)
      }
    }
    this.#notifications.clear()
  }

  #report(error: unknown) {
    try {
      this.#options.onError?.(error)
    } catch {}
  }
}
