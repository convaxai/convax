import { describe, expect, mock, test } from "bun:test"

import type { PetActivitySnapshot, PetActivitySummary } from "../pet-contracts"
import {
  PetActivityNotifier,
  type PetActivityNotification,
  type PetActivityNotificationOptions,
} from "./pet-activity-notifier"

class FakeNotification implements PetActivityNotification {
  readonly listeners = new Map<"click" | "close", Set<() => void>>()
  closed = false
  shown = false

  constructor(readonly options: PetActivityNotificationOptions) {}

  close() {
    this.closed = true
    this.emit("close")
  }

  emit(event: "click" | "close") {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }

  on(event: "click" | "close", listener: () => void) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  show() {
    this.shown = true
  }
}

function activity(
  state: PetActivitySummary["state"],
  options: Partial<PetActivitySummary> = {},
): PetActivitySummary {
  return {
    id: "activity-one",
    projectId: "project-one",
    projectName: "Convax",
    sessionId: "session-one",
    sessionName: "Fix Pet",
    state,
    updatedAt: 1,
    ...options,
  }
}

function snapshot(activities: PetActivitySummary[], revision = 1): PetActivitySnapshot {
  return { activities, revision }
}

function fixture(options: { focused?: boolean } = {}) {
  const notifications: FakeNotification[] = []
  const openActivity = mock(async (_activityId: string) => undefined)
  const window = {
    isDestroyed: () => false,
    isFocused: () => options.focused === true,
    isMinimized: () => false,
    isVisible: () => true,
  }
  const notifier = new PetActivityNotifier({
    createNotification: (notificationOptions) => {
      const notification = new FakeNotification(notificationOptions)
      notifications.push(notification)
      return notification
    },
    getMainWindow: () => window,
    openActivity,
  })
  return { notifications, notifier, openActivity }
}

describe("PetActivityNotifier", () => {
  test("uses the first awake snapshot as a baseline and notifies new background terminal states once", () => {
    const value = fixture()
    value.notifier.updatePreferences({ awake: true })
    value.notifier.updateActivity(snapshot([activity("running")]))
    expect(value.notifications).toHaveLength(0)

    value.notifier.updateActivity(snapshot([activity("ready", { updatedAt: 2 })], 2))

    expect(value.notifications).toHaveLength(1)
    expect(value.notifications[0]?.options).toEqual({
      body: "Fix Pet · Convax",
      title: "Agent task completed",
    })
    expect(value.notifications[0]?.shown).toBeTrue()

    value.notifier.updateActivity(snapshot([activity("ready", { updatedAt: 2 })], 3))
    expect(value.notifications).toHaveLength(1)
  })

  test("distinguishes blocked and input-required activity without exposing message content", () => {
    const value = fixture()
    value.notifier.updatePreferences({ awake: true })
    value.notifier.updateActivity(snapshot([]))

    value.notifier.updateActivity(
      snapshot(
        [
          activity("blocked", { id: "blocked", sessionName: "Blocked task", updatedAt: 2 }),
          activity("needs-input", { id: "question", sessionName: "Question task", updatedAt: 3 }),
        ],
        2,
      ),
    )

    expect(value.notifications.map((item) => item.options)).toEqual([
      { body: "Blocked task · Convax", title: "Agent task blocked" },
      { body: "Question task · Convax", title: "Agent needs your input" },
    ])
  })

  test("consumes transitions while the main window is foregrounded", () => {
    const value = fixture({ focused: true })
    value.notifier.updatePreferences({ awake: true })
    value.notifier.updateActivity(snapshot([activity("running")]))
    value.notifier.updateActivity(snapshot([activity("ready", { updatedAt: 2 })], 2))
    expect(value.notifications).toHaveLength(0)

    value.notifier.updateActivity(snapshot([activity("ready", { updatedAt: 2 })], 3))
    expect(value.notifications).toHaveLength(0)
  })

  test("opens the matching activity on click and closes every live notification on dispose", async () => {
    const value = fixture()
    value.notifier.updatePreferences({ awake: true })
    value.notifier.updateActivity(snapshot([]))
    value.notifier.updateActivity(
      snapshot(
        [
          activity("ready", { id: "ready", updatedAt: 2 }),
          activity("blocked", { id: "blocked", updatedAt: 3 }),
        ],
        2,
      ),
    )

    value.notifications[0]?.emit("click")
    await Promise.resolve()
    expect(value.openActivity).toHaveBeenCalledWith("ready")
    expect(value.notifications[0]?.closed).toBeTrue()

    value.notifier.dispose()
    expect(value.notifications.every((notification) => notification.closed)).toBeTrue()
  })

  test("does not replay activity accumulated while the Pet was tucked", () => {
    const value = fixture()
    value.notifier.updatePreferences({ awake: true })
    value.notifier.updateActivity(snapshot([activity("running")]))
    value.notifier.updatePreferences({ awake: false })
    value.notifier.updateActivity(snapshot([activity("ready", { updatedAt: 2 })], 2))
    value.notifier.updatePreferences({ awake: true })
    expect(value.notifications).toHaveLength(0)

    value.notifier.updateActivity(snapshot([activity("running", { updatedAt: 3 })], 3))
    value.notifier.updateActivity(snapshot([activity("ready", { updatedAt: 4 })], 4))
    expect(value.notifications).toHaveLength(1)
  })
})
