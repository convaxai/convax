import { afterEach, describe, expect, mock, test } from "bun:test"

import { petIpcChannels } from "../pet-contracts"

type InvokeHandler = (event: unknown, input?: unknown) => unknown
type EventHandler = (event: unknown, input?: unknown) => unknown
const invokeHandlers = new Map<string, InvokeHandler>()
const eventHandlers = new Map<string, EventHandler>()

mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => invokeHandlers.set(channel, handler),
    on: (channel: string, handler: EventHandler) => eventHandlers.set(channel, handler),
    removeHandler: (channel: string) => invokeHandlers.delete(channel),
    removeListener: (channel: string) => eventHandlers.delete(channel),
  },
}))

const trustedMain = { sender: { id: 1 } }
const trustedPet = { sender: { id: 2 } }
const untrusted = { sender: { id: 3 } }
const importedPet = {
  alt: "Custom pet",
  assetUrl: "convax-pet-asset://pet/custom%3Aone",
  description: "A custom pet",
  id: "custom:one",
  name: "Custom",
  source: "custom" as const,
  spriteVersion: 2 as const,
}

afterEach(() => {
  invokeHandlers.clear()
  eventHandlers.clear()
})

describe("registerPetIpc", () => {
  test("separates settings and overlay senders and resolves opaque navigation only in main", async () => {
    const activityId = "activity-1"
    const mainWindow = { webContents: { send: mock(() => undefined) } }
    const activity = {
      getSnapshot: mock(() => ({ activities: [], revision: 4 })),
      markSeen: mock(async () => undefined),
      resolveActivity: mock((id: string) =>
        id === activityId ? { projectId: "project-a", sessionId: "session-a" } : null,
      ),
    }
    const controller = {
      deleteCustom: mock(async () => undefined),
      importCustom: mock(async () => importedPet),
      listPets: mock(async () => ({ awake: false, pets: [] })),
      select: mock(async () => undefined),
      setAwake: mock(async () => undefined),
      subscribe: mock(() => () => undefined),
    }
    const overlay = {
      moveBy: mock(async () => undefined),
      setExpanded: mock(async () => undefined),
    }
    const { registerPetIpc } = await import("./pet-ipc")
    const dispose = registerPetIpc(controller, activity, overlay, {
      getMainWindow: () => mainWindow,
      isTrustedMainSender: (event) => event === trustedMain,
      isTrustedPetSender: (event) => event === trustedPet,
      selectCustomPetFile: async () => null,
    })

    await expect(invokeHandlers.get(petIpcChannels.list)?.(untrusted)).rejects.toThrow("untrusted renderer")
    await expect(invokeHandlers.get(petIpcChannels.list)?.(trustedPet)).rejects.toThrow("untrusted renderer")
    await expect(
      invokeHandlers.get(petIpcChannels.navigate)?.(trustedPet, { activityId: "unknown" }),
    ).rejects.toThrow("no longer available")

    await invokeHandlers.get(petIpcChannels.navigate)?.(trustedPet, { activityId })
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(petIpcChannels.navigate, {
      activityId,
      projectId: "project-a",
      sessionId: "session-a",
    })
    expect(activity.markSeen).not.toHaveBeenCalled()

    await invokeHandlers.get(petIpcChannels.markDisplayed)?.(trustedMain, { activityId })
    expect(activity.markSeen).toHaveBeenCalledWith(activityId, 4)
    dispose()
  })

  test("bounds overlay drag and keeps file selection in main", async () => {
    const controller = {
      deleteCustom: mock(async () => undefined),
      importCustom: mock(async (_file: string) => importedPet),
      listPets: mock(async () => ({ awake: false, pets: [] })),
      select: mock(async () => undefined),
      setAwake: mock(async () => undefined),
      subscribe: mock(() => () => undefined),
    }
    const activity = {
      getSnapshot: mock(() => ({ activities: [], revision: 0 })),
      markSeen: mock(async () => undefined),
      resolveActivity: mock(() => null),
    }
    const overlay = { moveBy: mock(async () => undefined), setExpanded: mock(async () => undefined) }
    const { registerPetIpc } = await import("./pet-ipc")
    const dispose = registerPetIpc(controller, activity, overlay, {
      getMainWindow: () => null,
      isTrustedMainSender: (event) => event === trustedMain,
      isTrustedPetSender: (event) => event === trustedPet,
      selectCustomPetFile: async () => "/private/source.webp",
    })

    await invokeHandlers.get(petIpcChannels.importCustom)?.(trustedMain)
    expect(controller.importCustom).toHaveBeenCalledWith("/private/source.webp")
    eventHandlers.get(petIpcChannels.drag)?.(trustedPet, { dx: 12, dy: -4, phase: "move" })
    expect(overlay.moveBy).toHaveBeenCalledWith({ x: 12, y: -4 }, false)
    expect(() => eventHandlers.get(petIpcChannels.drag)?.(trustedPet, { dx: 600, dy: 0, phase: "end" })).toThrow(
      "bounded",
    )
    expect(() => eventHandlers.get(petIpcChannels.drag)?.(untrusted, { dx: 1, dy: 1, phase: "end" })).toThrow(
      "untrusted renderer",
    )
    dispose()
  })
})
