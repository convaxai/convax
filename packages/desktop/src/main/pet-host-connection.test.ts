import { describe, expect, mock, test } from "bun:test"

import type { WebPluginCapability } from "../plugin-contracts"
import type {
  PetActivitySnapshot,
  PetCustomCollectionSnapshot,
  PetHostProviderBinding,
  PetPreferences,
} from "../pet-contracts"
import { PetHostConnection, type PetHostServices } from "./pet-host-connection"

const protocol = "convax.pet-host/1"
const capabilities = ["pet.activity.read", "pet.activity.open", "pet.preferences.write", "pet.custom.manage"] as const

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function request(id: string, method: string, params: unknown = {}) {
  return { id, method, params, protocol, type: "request" }
}

function fixture(
  surface: "overlay" | "settings" = "overlay",
  capabilityOverrides: readonly WebPluginCapability[] = capabilities,
  onClose = mock(() => undefined),
) {
  let currentBinding: PetHostProviderBinding = {
    capabilities: [...capabilityOverrides],
    digest: "sha256:one",
    generation: 1,
    pluginId: "convax-pet",
  }
  let activityListener: ((snapshot: PetActivitySnapshot) => void) | undefined
  let collectionListener: ((snapshot: PetCustomCollectionSnapshot) => void) | undefined
  let preferencesListener: ((preferences: PetPreferences) => void) | undefined
  const unsubscribeActivity = mock(() => undefined)
  const unsubscribeCollection = mock(() => undefined)
  const unsubscribePreferences = mock(() => undefined)
  const snapshot: PetActivitySnapshot = {
    activities: [
      {
        id: "activity-one",
        projectId: "project-one",
        projectName: "Project One",
        sessionId: "session-one",
        sessionName: "Session One",
        state: "running",
        updatedAt: 1,
      },
    ],
    revision: 4,
  }
  const collection: PetCustomCollectionSnapshot = {
    pets: [
      {
        alt: "Nova, a custom pixel companion",
        description: "A local custom companion.",
        displayName: "Nova",
        id: "custom-nova",
        source: "custom",
        spritesheetUrl: "convax-pet-asset://pet/custom-nova",
        spriteVersion: 2,
      },
    ],
    revision: 2,
  }
  const services = {
    deleteCustomPet: mock(async (_input: unknown) => collection),
    getActivitySnapshot: mock(async () => snapshot),
    getBinding: mock(() => currentBinding),
    getCustomCollection: mock(async () => collection),
    getPreferences: mock(async () => ({ awake: true, selectedPetId: "aster" })),
    importCustomPet: mock(async () => collection.pets[0]),
    moveOverlay: mock(async (_input: unknown) => undefined),
    openActivity: mock(async (_input: unknown) => undefined),
    setAwake: mock(async (input: { awake: boolean }) => ({ awake: input.awake, selectedPetId: "aster" })),
    setExpanded: mock(async (_input: unknown) => undefined),
    subscribeActivity: mock((listener: (next: PetActivitySnapshot) => void) => {
      activityListener = listener
      return unsubscribeActivity
    }),
    subscribeCustomCollection: mock((listener: (next: PetCustomCollectionSnapshot) => void) => {
      collectionListener = listener
      return unsubscribeCollection
    }),
    subscribePreferences: mock((listener: (next: PetPreferences) => void) => {
      preferencesListener = listener
      return unsubscribePreferences
    }),
    updatePreferences: mock(async (input: unknown) => ({ awake: true, ...(input as object) })),
  } satisfies PetHostServices
  const messages: unknown[] = []
  const send = mock((message: unknown) => messages.push(message))
  const connection = new PetHostConnection({ binding: currentBinding, onClose, send, services, surface })
  return {
    activity(next: PetActivitySnapshot) {
      activityListener?.(next)
    },
    binding() {
      return currentBinding
    },
    connection,
    collection(next: PetCustomCollectionSnapshot) {
      collectionListener?.(next)
    },
    onClose,
    messages,
    preferences(next: PetPreferences) {
      preferencesListener?.(next)
    },
    replaceBinding(next: Partial<PetHostProviderBinding>) {
      currentBinding = { ...currentBinding, ...next }
    },
    send,
    services,
    snapshot,
    unsubscribeActivity,
    unsubscribeCollection,
    unsubscribePreferences,
  }
}

describe("PetHostConnection", () => {
  test("dispatches exact overlay requests and clones successful results", async () => {
    const host = fixture()

    await host.connection.handle(request("snapshot", "activity.getSnapshot"))
    expect(host.messages.shift()).toEqual({
      id: "snapshot",
      ok: true,
      protocol,
      result: host.snapshot,
      type: "response",
    })
    const responseSnapshot = (host.send.mock.calls[0][0] as { result: typeof host.snapshot }).result
    host.snapshot.activities[0].projectName = "Changed after response"
    expect(responseSnapshot.activities[0].projectName).toBe("Project One")

    await host.connection.handle(request("open", "activity.open", { activityId: "activity-one", revision: 4 }))
    await host.connection.handle(request("get-preferences", "preferences.get"))
    await host.connection.handle(request("set-preferences", "preferences.update", { selectedPetId: "aster" }))
    await host.connection.handle(
      request("move", "overlay.move", {
        phase: "move",
        screenX: 404,
        screenY: 198,
        sequence: 2,
        session: "drag-one",
      }),
    )
    await host.connection.handle(request("expand", "overlay.setExpanded", { expanded: true }))

    expect(host.services.openActivity).toHaveBeenCalledWith({ activityId: "activity-one", revision: 4 })
    expect(host.services.updatePreferences).toHaveBeenCalledWith({ selectedPetId: "aster" })
    expect(host.services.moveOverlay).toHaveBeenCalledWith({
      phase: "move",
      screenX: 404,
      screenY: 198,
      sequence: 2,
      session: "drag-one",
    })
    expect(host.services.setExpanded).toHaveBeenCalledWith({ expanded: true })
    expect(host.messages.every((message) => (message as { ok?: boolean }).ok === true)).toBe(true)
  })

  test("gives settings only preferences and explicit wake or tuck", async () => {
    const host = fixture("settings")

    await host.connection.handle(request("get", "preferences.get"))
    await host.connection.handle(request("update", "preferences.update", { selectedPetId: "aster" }))
    await host.connection.handle(request("wake", "lifecycle.setAwake", { awake: true }))

    expect(host.services.setAwake).toHaveBeenCalledWith({ awake: true })
    expect(host.messages.every((message) => (message as { ok?: boolean }).ok === true)).toBe(true)

    for (const method of [
      "activity.getSnapshot",
      "activity.open",
      "overlay.move",
      "overlay.setExpanded",
      "pet.import",
      "filesystem.read",
      "ipc.invoke",
    ]) {
      await host.connection.handle(request(`deny-${method}`, method))
    }
    expect(host.messages.slice(-7).every((message) => (message as { ok?: boolean }).ok === false)).toBe(true)
    expect(host.services.getActivitySnapshot).not.toHaveBeenCalled()
    expect(host.services.openActivity).not.toHaveBeenCalled()
    expect(host.services.moveOverlay).not.toHaveBeenCalled()
  })

  test("exposes collection reads to both surfaces and collection mutations only to settings", async () => {
    const settings = fixture("settings")

    await settings.connection.handle(request("collection", "collection.get"))
    await settings.connection.handle(request("import", "collection.import"))
    await settings.connection.handle(request("delete", "collection.delete", { petId: "custom-nova" }))

    expect(settings.services.getCustomCollection).toHaveBeenCalledTimes(1)
    expect(settings.services.importCustomPet).toHaveBeenCalledTimes(1)
    expect(settings.services.deleteCustomPet).toHaveBeenCalledWith({ petId: "custom-nova" })
    expect(settings.messages.every((message) => (message as { ok?: boolean }).ok === true)).toBe(true)

    const overlay = fixture()
    await overlay.connection.handle(request("collection", "collection.get"))
    await overlay.connection.handle(request("import", "collection.import"))
    await overlay.connection.handle(request("delete", "collection.delete", { petId: "custom-nova" }))

    expect(overlay.services.getCustomCollection).toHaveBeenCalledTimes(1)
    expect(overlay.services.importCustomPet).not.toHaveBeenCalled()
    expect(overlay.services.deleteCustomPet).not.toHaveBeenCalled()
    expect(overlay.messages).toEqual([
      expect.objectContaining({ id: "collection", ok: true }),
      expect.objectContaining({ id: "import", ok: false }),
      expect.objectContaining({ id: "delete", ok: false }),
    ])
  })

  test("requires the capability belonging to each data operation", async () => {
    const noRead = fixture("overlay", ["pet.activity.open", "pet.preferences.write", "pet.custom.manage"])
    await noRead.connection.handle(request("read", "activity.getSnapshot"))
    expect(noRead.messages).toEqual([
      expect.objectContaining({ error: expect.stringContaining("pet.activity.read"), id: "read", ok: false }),
    ])

    const noOpen = fixture("overlay", ["pet.activity.read", "pet.preferences.write", "pet.custom.manage"])
    await noOpen.connection.handle(request("open", "activity.open", { activityId: "one", revision: 1 }))
    expect(noOpen.messages).toEqual([
      expect.objectContaining({ error: expect.stringContaining("pet.activity.open"), id: "open", ok: false }),
    ])

    const noPreferences = fixture("settings", ["pet.activity.read", "pet.activity.open", "pet.custom.manage"])
    await noPreferences.connection.handle(request("preferences", "preferences.get"))
    expect(noPreferences.messages).toEqual([
      expect.objectContaining({
        error: expect.stringContaining("pet.preferences.write"),
        id: "preferences",
        ok: false,
      }),
    ])

    const noCustom = fixture("settings", ["pet.activity.read", "pet.activity.open", "pet.preferences.write"])
    await noCustom.connection.handle(request("custom", "collection.get"))
    expect(noCustom.messages).toEqual([
      expect.objectContaining({
        error: expect.stringContaining("pet.custom.manage"),
        id: "custom",
        ok: false,
      }),
    ])
  })

  test("validates exact envelopes, identifiers, payload bounds, and method params", async () => {
    const host = fixture()
    await host.connection.handle({ ...request("extra", "activity.getSnapshot"), extra: true })
    await host.connection.handle({ ...request("protocol", "activity.getSnapshot"), protocol: "convax.pet-host" })
    await host.connection.handle(request("params", "activity.open", { activityId: "one", extra: true, revision: 1 }))
    await host.connection.handle(request("preferences", "preferences.update", { selectedPetId: "Bad_Id" }))
    await host.connection.handle(request("empty-preferences", "preferences.update", {}))
    await host.connection.handle(request("undefined-preferences", "preferences.update", { selectedPetId: undefined }))
    await host.connection.handle(
      request("move", "overlay.move", {
        phase: "move",
        screenX: Number.NaN,
        screenY: 0,
        sequence: 1,
        session: "drag-one",
      }),
    )
    await host.connection.handle(request("revision", "activity.open", { activityId: "one", revision: -1 }))
    await host.connection.handle(request("delete", "collection.delete", { petId: "nova" }))
    await host.connection.handle(request("delete-extra", "collection.delete", { extra: true, petId: "custom-nova" }))

    expect(host.messages).toHaveLength(10)
    expect(host.messages.every((message) => (message as { ok?: boolean }).ok === false)).toBe(true)
    expect(host.services.openActivity).not.toHaveBeenCalled()
    expect(host.services.updatePreferences).not.toHaveBeenCalled()

    await host.connection.handle(request("i".repeat(80), "activity.getSnapshot"))
    expect(host.messages.at(-1)).toMatchObject({ id: "i".repeat(80), ok: true })

    const beforeInvalidIds = host.messages.length
    await host.connection.handle(request("", "activity.getSnapshot"))
    await host.connection.handle(request("i".repeat(81), "activity.getSnapshot"))
    expect(host.messages).toHaveLength(beforeInvalidIds)

    await host.connection.handle(request("oversized", "preferences.update", { value: "x".repeat(64 * 1024) }))
    expect(host.messages.at(-1)).toMatchObject({
      error: expect.stringContaining("size limit"),
      id: "oversized",
      ok: false,
    })

    await host.connection.handle(
      request("utf8-oversized", "activity.open", { activityId: "宠".repeat(22_000), revision: 1 }),
    )
    expect(host.messages.at(-1)).toMatchObject({
      error: expect.stringContaining("size limit"),
      id: "utf8-oversized",
      ok: false,
    })
  })

  test("rejects duplicate or excessive pending request identifiers", async () => {
    const host = fixture()
    const pending = deferred<typeof host.snapshot>()
    host.services.getActivitySnapshot.mockImplementation(async () => pending.promise)

    const first = host.connection.handle(request("same", "activity.getSnapshot"))
    await host.connection.handle(request("same", "activity.getSnapshot"))
    expect(host.messages.at(-1)).toMatchObject({ error: expect.stringContaining("already pending"), ok: false })

    const additional = Array.from({ length: 63 }, (_, index) =>
      host.connection.handle(request(`pending-${index}`, "activity.getSnapshot")),
    )
    await host.connection.handle(request("overflow", "activity.getSnapshot"))
    expect(host.messages.at(-1)).toMatchObject({ error: expect.stringContaining("pending request limit"), ok: false })

    pending.resolve(host.snapshot)
    await Promise.all([first, ...additional])
  })

  test("invalidates pending and future work when provider identity changes", async () => {
    const host = fixture()
    const pending = deferred<typeof host.snapshot>()
    host.services.getActivitySnapshot.mockImplementation(async () => pending.promise)
    const handling = host.connection.handle(request("pending", "activity.getSnapshot"))

    host.replaceBinding({ digest: "sha256:two", generation: 2 })
    pending.resolve(host.snapshot)
    await handling

    expect(host.messages).toEqual([
      expect.objectContaining({ error: expect.stringContaining("changed"), id: "pending", ok: false }),
    ])
    const calls = host.services.getActivitySnapshot.mock.calls.length
    await host.connection.handle(request("future", "activity.getSnapshot"))
    expect(host.services.getActivitySnapshot).toHaveBeenCalledTimes(calls)

    const staleAtStart = fixture()
    staleAtStart.replaceBinding({ generation: 2 })
    await staleAtStart.connection.handle(request("stale", "activity.getSnapshot"))
    expect(staleAtStart.messages).toEqual([
      expect.objectContaining({ error: expect.stringContaining("changed"), id: "stale", ok: false }),
    ])
    expect(staleAtStart.services.getActivitySnapshot).not.toHaveBeenCalled()
  })

  test("contains provider binding lookup failures and closes the connection", async () => {
    const host = fixture()
    host.services.getBinding.mockImplementation(() => {
      throw new Error("binding failed")
    })

    await expect(host.connection.handle(request("binding", "activity.getSnapshot"))).resolves.toBeUndefined()
    expect(host.messages).toEqual([
      expect.objectContaining({ error: expect.stringContaining("binding"), id: "binding", ok: false }),
    ])
    expect(host.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(host.unsubscribePreferences).toHaveBeenCalledTimes(1)
  })

  test("delivers cloned activity, collection, and preference events only to eligible live surfaces", () => {
    const overlay = fixture()
    const activity = { activities: [], revision: 5 }
    const preferences = { awake: false, selectedPetId: "aster" }
    overlay.activity(activity)
    overlay.collection({
      pets: [
        {
          alt: "Nova",
          description: "Custom",
          displayName: "Nova",
          id: "custom-nova",
          source: "custom",
          spritesheetUrl: "convax-pet-asset://pet/custom-nova",
          spriteVersion: 2,
        },
      ],
      revision: 3,
    })
    overlay.preferences(preferences)
    activity.revision = 6
    preferences.selectedPetId = "comet"

    expect(overlay.messages).toEqual([
      { event: "activity.changed", payload: { activities: [], revision: 5 }, protocol, type: "event" },
      {
        event: "collection.changed",
        payload: {
          pets: [
            {
              alt: "Nova",
              description: "Custom",
              displayName: "Nova",
              id: "custom-nova",
              source: "custom",
              spritesheetUrl: "convax-pet-asset://pet/custom-nova",
              spriteVersion: 2,
            },
          ],
          revision: 3,
        },
        protocol,
        type: "event",
      },
      {
        event: "preferences.changed",
        payload: { awake: false, selectedPetId: "aster" },
        protocol,
        type: "event",
      },
    ])

    const settings = fixture("settings")
    settings.activity({ activities: [], revision: 1 })
    settings.collection({ pets: [], revision: 4 })
    settings.preferences({ awake: true })
    expect(settings.services.subscribeActivity).not.toHaveBeenCalled()
    expect(settings.messages).toEqual([
      { event: "collection.changed", payload: { pets: [], revision: 4 }, protocol, type: "event" },
      { event: "preferences.changed", payload: { awake: true }, protocol, type: "event" },
    ])

    const noRead = fixture("overlay", ["pet.activity.open", "pet.preferences.write", "pet.custom.manage"])
    noRead.activity({ activities: [], revision: 1 })
    expect(noRead.services.subscribeActivity).not.toHaveBeenCalled()
    expect(noRead.messages).toEqual([])
  })

  test("contains uncloneable events and event-time binding failures", () => {
    const uncloneable = fixture()
    expect(() =>
      uncloneable.activity({
        activities: [],
        callback: () => undefined,
        revision: 1,
      } as unknown as PetActivitySnapshot),
    ).not.toThrow()
    expect(uncloneable.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(uncloneable.unsubscribePreferences).toHaveBeenCalledTimes(1)

    const bindingFailure = fixture()
    bindingFailure.services.getBinding.mockImplementation(() => {
      throw new Error("binding failed")
    })
    expect(() => bindingFailure.activity({ activities: [], revision: 1 })).not.toThrow()
    expect(bindingFailure.messages).toEqual([])
    expect(bindingFailure.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(bindingFailure.unsubscribePreferences).toHaveBeenCalledTimes(1)
  })

  test("closes once without recursing when the transport throws", async () => {
    const host = fixture()
    host.send.mockImplementation(() => {
      throw new Error("transport failed")
    })

    await expect(host.connection.handle(request("snapshot", "activity.getSnapshot"))).resolves.toBeUndefined()
    expect(host.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(host.unsubscribePreferences).toHaveBeenCalledTimes(1)

    const calls = host.services.getActivitySnapshot.mock.calls.length
    await host.connection.handle(request("closed", "activity.getSnapshot"))
    expect(host.services.getActivitySnapshot).toHaveBeenCalledTimes(calls)
    expect(host.onClose).toHaveBeenCalledTimes(1)
  })

  test("attempts every cleanup without throwing when an unsubscribe fails", () => {
    const host = fixture()
    host.unsubscribeActivity.mockImplementation(() => {
      throw new Error("cleanup failed")
    })

    expect(() => host.connection.close()).not.toThrow()
    expect(host.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(host.unsubscribePreferences).toHaveBeenCalledTimes(1)
  })

  test("closes idempotently, unsubscribes, and suppresses stale events", async () => {
    const host = fixture()
    host.connection.close("Surface removed")
    host.connection.close("Again")
    expect(host.onClose).toHaveBeenCalledTimes(1)

    expect(host.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(host.unsubscribePreferences).toHaveBeenCalledTimes(1)
    host.activity({ activities: [], revision: 8 })
    host.preferences({ awake: false })
    await host.connection.handle(request("closed", "preferences.get"))
    expect(host.messages).toEqual([])

    const changed = fixture()
    changed.replaceBinding({ pluginId: "other-provider" })
    changed.activity({ activities: [], revision: 9 })
    expect(changed.messages).toEqual([])
    expect(changed.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(changed.unsubscribePreferences).toHaveBeenCalledTimes(1)
  })
})
