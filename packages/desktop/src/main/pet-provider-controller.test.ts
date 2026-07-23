import { describe, expect, mock, test } from "bun:test"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import type { PetActivitySnapshot } from "../pet-contracts"
import {
  PetProviderConflictError,
  PetProviderController,
  type PetProviderPluginManager,
} from "./pet-provider-controller"
import { boundPetState, defaultPetState, type PetPersistedState, type PetStateWrite } from "./pet-state-store"

function provider(id = "convax-pet", version = "0.2.0"): InstalledWebPluginSummary {
  return {
    capabilities: ["pet.activity.read", "pet.activity.open", "pet.preferences.write"],
    contributes: {
      pet: {
        library: "pet-library.json",
        overlay: "pet/index.html",
        protocol: "convax.pet-host/1",
        settings: "settings/index.html",
      },
    },
    description: `${id} provider`,
    id,
    name: id,
    schema: "convax.plugin/5",
    version,
  }
}

function cloneState(state: PetPersistedState) {
  return structuredClone(state)
}

class MemoryStateStore {
  state: PetPersistedState

  constructor(initial: PetStateWrite | PetPersistedState = defaultPetState) {
    this.state = boundPetState(initial)
  }

  async read() {
    return cloneState(this.state)
  }

  async update(update: (state: PetPersistedState) => PetStateWrite | PetPersistedState) {
    this.state = boundPetState(update(cloneState(this.state)))
    return cloneState(this.state)
  }
}

function fixture(input: {
  installed?: InstalledWebPluginSummary[]
  state?: PetStateWrite | PetPersistedState
} = {}) {
  let installed = input.installed ?? []
  const digests = new Map(installed.map((plugin) => [plugin.id, `digest:${plugin.id}:${plugin.version}`]))
  const pluginManager = {
    list: mock(async () => installed),
    resolveCapabilityIdentity: mock(async (pluginId: string) => {
      const plugin = installed.find((candidate) => candidate.id === pluginId)
      return plugin ? { digest: digests.get(plugin.id) ?? `digest:${plugin.id}:${plugin.version}`, plugin } : null
    }),
  } satisfies PetProviderPluginManager
  let activityListener: ((snapshot: PetActivitySnapshot) => void) | undefined
  const unsubscribeActivity = mock(() => undefined)
  const activity = {
    getSnapshot: mock(
      (): PetActivitySnapshot => ({
        activities: [],
        revision: 1,
      }),
    ),
    subscribe: mock((listener: (snapshot: PetActivitySnapshot) => void) => {
      activityListener = listener
      return unsubscribeActivity
    }),
  }
  const window = {
    close: mock(async () => undefined),
    open: mock(async (_provider: unknown) => undefined),
  }
  const stateStore = new MemoryStateStore(input.state)
  const controller = new PetProviderController({ activity, pluginManager, stateStore, window })
  return {
    activity,
    controller,
    digests,
    emitActivity(snapshot: PetActivitySnapshot) {
      activityListener?.(snapshot)
    },
    install(...plugins: InstalledWebPluginSummary[]) {
      installed = plugins
      for (const plugin of plugins) {
        if (!digests.has(plugin.id)) digests.set(plugin.id, `digest:${plugin.id}:${plugin.version}`)
      }
    },
    pluginManager,
    stateStore,
    unsubscribeActivity,
    window,
  }
}

describe("PetProviderController", () => {
  test("keeps the feature dormant when no provider is installed", async () => {
    const value = fixture()
    await value.controller.initialize()

    expect(value.controller.getProvider()).toBeUndefined()
    expect(value.controller.getBinding()).toBeUndefined()
    expect(value.controller.getPreferences()).toEqual({ awake: false })
    expect(value.activity.subscribe).not.toHaveBeenCalled()
    expect(value.window.open).not.toHaveBeenCalled()
    expect(value.stateStore.state).toEqual(defaultPetState)
  })

  test("selects one provider generically without waking it and exposes exact installed URLs", async () => {
    const plugin = provider("soft-companion")
    const value = fixture({ installed: [plugin] })
    const changes: unknown[] = []
    value.controller.subscribeProvider((next) => changes.push(next))

    await value.controller.initialize()

    expect(value.controller.getProvider()).toMatchObject({
      digest: "digest:soft-companion:0.2.0",
      generation: 1,
      libraryUrl: "convax-plugin://soft-companion/pet-library.json",
      overlayUrl: "convax-plugin://soft-companion/pet/index.html",
      pluginId: "soft-companion",
      settingsUrl: "convax-plugin://soft-companion/settings/index.html",
      version: "0.2.0",
    })
    expect(value.controller.getProvider()?.contribution).toEqual(plugin.contributes.pet)
    expect(value.controller.getBinding()).toEqual({
      capabilities: plugin.capabilities,
      digest: "digest:soft-companion:0.2.0",
      generation: 1,
      pluginId: "soft-companion",
    })
    expect(value.stateStore.state.providerId).toBe("soft-companion")
    expect(value.stateStore.state.awake).toBe(false)
    expect(value.window.open).not.toHaveBeenCalled()
    expect(value.activity.subscribe).not.toHaveBeenCalled()
    expect(changes).toHaveLength(1)
  })

  test("keeps selection separate from explicit wake and subscribes to activity only while awake", async () => {
    const value = fixture({ installed: [provider()] })
    const preferences: unknown[] = []
    const activityChanges: PetActivitySnapshot[] = []
    value.controller.subscribePreferences((next) => preferences.push(next))
    value.controller.subscribeActivity((next) => activityChanges.push(next))
    await value.controller.initialize()

    await expect(value.controller.updatePreferences({ selectedPetId: "retired-pet" })).resolves.toEqual({
      awake: false,
      selectedPetId: "retired-pet",
    })
    expect(value.window.open).not.toHaveBeenCalled()
    expect(value.activity.subscribe).not.toHaveBeenCalled()

    await expect(value.controller.setAwake({ awake: true })).resolves.toEqual({
      awake: true,
      selectedPetId: "retired-pet",
    })
    expect(value.window.open).toHaveBeenCalledWith(value.controller.getProvider())
    expect(value.activity.subscribe).toHaveBeenCalledTimes(1)

    const nextActivity = { activities: [], revision: 2 }
    value.emitActivity(nextActivity)
    expect(activityChanges).toEqual([nextActivity])

    await value.controller.setAwake({ awake: false })
    expect(value.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(value.window.close).toHaveBeenCalled()
    expect(preferences).toContainEqual({ awake: false, selectedPetId: "retired-pet" })
    expect(value.stateStore.state.preferences).toEqual({ selectedPetId: "retired-pet" })
  })

  test("restores a previously explicit awake state and stale Plugin-owned selection", async () => {
    const value = fixture({
      installed: [provider()],
      state: {
        awake: true,
        positions: {},
        preferences: { selectedPetId: "removed-in-update" },
        providerId: "convax-pet",
        seen: {},
      },
    })

    await value.controller.initialize()

    expect(value.window.open).toHaveBeenCalledWith(value.controller.getProvider())
    expect(value.activity.subscribe).toHaveBeenCalledTimes(1)
    expect(value.controller.getPreferences()).toEqual({ awake: true, selectedPetId: "removed-in-update" })
  })

  test("increments generation and remounts an awake provider after a validated update", async () => {
    const first = provider()
    const value = fixture({ installed: [first] })
    await value.controller.initialize()
    await value.controller.setAwake({ awake: true })
    const initialGeneration = value.controller.getProvider()!.generation
    const providerChanges: unknown[] = []
    value.controller.subscribeProvider((next) => providerChanges.push(next))

    const updated = provider("convax-pet", "0.3.0")
    value.install(updated)
    value.digests.set(updated.id, "digest:updated")
    await value.controller.refresh()

    expect(value.controller.getProvider()).toMatchObject({ digest: "digest:updated", generation: initialGeneration + 1 })
    expect(value.window.close).toHaveBeenCalledTimes(1)
    expect(value.window.open).toHaveBeenCalledTimes(2)
    expect(value.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(value.activity.subscribe).toHaveBeenCalledTimes(2)
    expect(providerChanges).toHaveLength(1)

    await value.controller.refresh()
    expect(value.controller.getProvider()?.generation).toBe(initialGeneration + 1)
    expect(value.window.open).toHaveBeenCalledTimes(2)
  })

  test("tucks and removes the provider on uninstall without discarding Plugin-owned preferences", async () => {
    const value = fixture({ installed: [provider()] })
    await value.controller.initialize()
    await value.controller.updatePreferences({ selectedPetId: "violet" })
    await value.controller.setAwake({ awake: true })

    value.install()
    await value.controller.refresh()

    expect(value.controller.getProvider()).toBeUndefined()
    expect(value.controller.getPreferences()).toEqual({ awake: false, selectedPetId: "violet" })
    expect(value.stateStore.state.providerId).toBeUndefined()
    expect(value.stateStore.state.awake).toBe(false)
    expect(value.window.close).toHaveBeenCalledTimes(1)
    expect(value.unsubscribeActivity).toHaveBeenCalledTimes(1)
  })

  test("tucks a removed awake provider before reporting a replacement conflict", async () => {
    const value = fixture({ installed: [provider()] })
    await value.controller.initialize()
    await value.controller.updatePreferences({ selectedPetId: "violet" })
    await value.controller.setAwake({ awake: true })

    value.install(provider("beta-pet"), provider("alpha-pet"))
    const refresh = value.controller.refresh()

    await expect(refresh).rejects.toBeInstanceOf(PetProviderConflictError)
    await expect(refresh).rejects.toThrow("alpha-pet, beta-pet")
    expect(value.window.close).toHaveBeenCalledTimes(1)
    expect(value.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(value.controller.getProvider()).toBeUndefined()
    expect(value.stateStore.state).toMatchObject({
      awake: false,
      preferences: { selectedPetId: "violet" },
    })
    expect(value.stateStore.state.providerId).toBeUndefined()
    expect(value.controller.getPreferences()).toEqual({
      awake: false,
      selectedPetId: "violet",
    })
  })

  test("rejects ambiguous singleton activation deterministically but honors a persisted active provider", async () => {
    const alpha = provider("alpha-pet")
    const beta = provider("beta-pet")
    const ambiguous = fixture({ installed: [beta, alpha] })

    await expect(ambiguous.controller.initialize()).rejects.toBeInstanceOf(PetProviderConflictError)
    await expect(ambiguous.controller.initialize()).rejects.toThrow("alpha-pet, beta-pet")
    expect(ambiguous.window.open).not.toHaveBeenCalled()

    const selected = fixture({
      installed: [beta, alpha],
      state: {
        awake: false,
        positions: {},
        preferences: {},
        providerId: "beta-pet",
        seen: {},
      },
    })
    await selected.controller.initialize()
    expect(selected.controller.getProvider()?.pluginId).toBe("beta-pet")
  })

  test("bounds preferences and disposes subscriptions and windows idempotently", async () => {
    const value = fixture({ installed: [provider()] })
    await value.controller.initialize()
    await expect(value.controller.updatePreferences({ selectedPetId: "Bad_Id" })).rejects.toThrow("selectedPetId")
    await expect(value.controller.updatePreferences({ selectedPetId: "x".repeat(81) })).rejects.toThrow(
      "selectedPetId",
    )
    await value.controller.setAwake({ awake: true })

    await value.controller.dispose()
    await value.controller.dispose()

    expect(value.unsubscribeActivity).toHaveBeenCalledTimes(1)
    expect(value.window.close).toHaveBeenCalledTimes(1)
    await expect(value.controller.setAwake({ awake: true })).rejects.toThrow("disposed")
  })
})
