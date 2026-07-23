import {
  type InstalledWebPluginSummary,
  requireWebPluginId,
  requireWebPluginRelativePath,
  type WebPluginCapability,
  type WebPluginPetContribution,
} from "../plugin-contracts"
import {
  type PetActivitySnapshot,
  type PetHostProviderBinding,
  type PetPreferences,
  type PetPreferencesUpdate,
} from "../pet-contracts"
import type { PetPersistedState, PetStateWrite } from "./pet-state-store"

type Awaitable<Value> = Promise<Value> | Value
type Listener<Value> = (value: Value) => void
type Unsubscribe = () => void

export interface PetProviderPluginManager {
  list(): Promise<readonly InstalledWebPluginSummary[]>
  resolveCapabilityIdentity(pluginId: string): Promise<{
    digest: string
    plugin: InstalledWebPluginSummary
  } | null>
}

export interface PetProviderActivitySource {
  getSnapshot(): PetActivitySnapshot
  subscribe(listener: Listener<PetActivitySnapshot>): Unsubscribe
}

export interface PetProviderStateStore {
  read(): Promise<PetPersistedState>
  update(update: (state: PetPersistedState) => PetStateWrite | PetPersistedState): Promise<PetPersistedState>
}

export interface InstalledPetProvider extends PetHostProviderBinding {
  readonly contribution: WebPluginPetContribution
  readonly libraryUrl: string
  readonly overlayUrl: string
  readonly settingsUrl: string
  readonly version: string
}

export interface PetProviderWindowPort {
  close(): Awaitable<void>
  open(provider: InstalledPetProvider): Awaitable<void>
}

export interface PetProviderControllerOptions {
  activity: PetProviderActivitySource
  pluginManager: PetProviderPluginManager
  stateStore: PetProviderStateStore
  window: PetProviderWindowPort
}

export class PetProviderConflictError extends Error {
  readonly providerIds: readonly string[]

  constructor(providerIds: readonly string[]) {
    const sorted = [...providerIds].sort((left, right) => left.localeCompare(right))
    super(`Multiple Pet feature providers are installed: ${sorted.join(", ")}`)
    this.name = "PetProviderConflictError"
    this.providerIds = Object.freeze(sorted)
  }
}

function cloneActivity(snapshot: PetActivitySnapshot): PetActivitySnapshot {
  return structuredClone(snapshot)
}

function cloneBinding(binding: PetHostProviderBinding): PetHostProviderBinding {
  return {
    capabilities: [...binding.capabilities],
    digest: binding.digest,
    generation: binding.generation,
    pluginId: binding.pluginId,
  }
}

function cloneContribution(contribution: WebPluginPetContribution): WebPluginPetContribution {
  return {
    library: contribution.library,
    overlay: contribution.overlay,
    protocol: contribution.protocol,
    settings: contribution.settings,
  }
}

function cloneProvider(provider: InstalledPetProvider): InstalledPetProvider {
  return {
    ...cloneBinding(provider),
    contribution: cloneContribution(provider.contribution),
    libraryUrl: provider.libraryUrl,
    overlayUrl: provider.overlayUrl,
    settingsUrl: provider.settingsUrl,
    version: provider.version,
  }
}

function freezeProvider(provider: InstalledPetProvider): InstalledPetProvider {
  return Object.freeze({
    ...provider,
    capabilities: Object.freeze([...provider.capabilities]),
    contribution: Object.freeze(cloneContribution(provider.contribution)),
  })
}

function providerAssetUrl(pluginId: string, path: string, label: string) {
  const id = requireWebPluginId(pluginId)
  const relativePath = requireWebPluginRelativePath(path, label)
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `convax-plugin://${id}/${encodedPath}`
}

function sameProviderIdentity(left: InstalledPetProvider | undefined, right: InstalledPetProvider | undefined) {
  return left?.pluginId === right?.pluginId && left?.digest === right?.digest
}

function preferencesFromState(state: PetPersistedState): PetPreferences {
  return {
    awake: state.awake,
    ...(state.preferences.selectedPetId === undefined
      ? {}
      : { selectedPetId: state.preferences.selectedPetId }),
  }
}

function requireSelectedPetId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new Error("Pet selectedPetId is invalid")
  }
  return value
}

function requireAwake(value: unknown) {
  if (typeof value !== "boolean") throw new Error("Pet awake state is invalid")
  return value
}

export class PetProviderController {
  readonly #activity: PetProviderActivitySource
  readonly #activityListeners = new Set<Listener<PetActivitySnapshot>>()
  readonly #pluginManager: PetProviderPluginManager
  readonly #preferencesListeners = new Set<Listener<PetPreferences>>()
  readonly #providerListeners = new Set<Listener<InstalledPetProvider | undefined>>()
  readonly #stateStore: PetProviderStateStore
  readonly #window: PetProviderWindowPort
  #activityUnsubscribe: Unsubscribe | undefined
  #disposed = false
  #generation = 0
  #initialized = false
  #mutationTail: Promise<void> = Promise.resolve()
  #provider: InstalledPetProvider | undefined
  #state: PetPersistedState | undefined

  constructor(options: PetProviderControllerOptions) {
    this.#activity = options.activity
    this.#pluginManager = options.pluginManager
    this.#stateStore = options.stateStore
    this.#window = options.window
  }

  initialize() {
    return this.#exclusive(() => this.#initialize())
  }

  refresh() {
    return this.#exclusive(() => this.#refresh())
  }

  getProvider(): InstalledPetProvider | undefined {
    return this.#provider === undefined ? undefined : cloneProvider(this.#provider)
  }

  getBinding(): PetHostProviderBinding | undefined {
    return this.#provider === undefined ? undefined : cloneBinding(this.#provider)
  }

  getPreferences(): PetPreferences {
    const state = this.#requireState()
    return preferencesFromState(state)
  }

  getActivitySnapshot(): PetActivitySnapshot {
    this.#assertUsable()
    return cloneActivity(this.#activity.getSnapshot())
  }

  subscribeProvider(listener: Listener<InstalledPetProvider | undefined>): Unsubscribe {
    this.#assertUsable()
    this.#providerListeners.add(listener)
    return () => this.#providerListeners.delete(listener)
  }

  subscribePreferences(listener: Listener<PetPreferences>): Unsubscribe {
    this.#assertUsable()
    this.#preferencesListeners.add(listener)
    return () => this.#preferencesListeners.delete(listener)
  }

  subscribeActivity(listener: Listener<PetActivitySnapshot>): Unsubscribe {
    this.#assertUsable()
    this.#activityListeners.add(listener)
    return () => this.#activityListeners.delete(listener)
  }

  updatePreferences(input: PetPreferencesUpdate): Promise<PetPreferences> {
    return this.#exclusive(async () => {
      this.#assertInitialized()
      const selectedPetId = requireSelectedPetId(input?.selectedPetId)
      this.#state = await this.#stateStore.update((state) => ({
        ...state,
        preferences: { selectedPetId },
      }))
      const preferences = preferencesFromState(this.#state)
      this.#emit(this.#preferencesListeners, preferences, (value) => ({ ...value }))
      return { ...preferences }
    })
  }

  setAwake(input: { awake: boolean }): Promise<PetPreferences> {
    return this.#exclusive(async () => {
      this.#assertInitialized()
      const awake = requireAwake(input?.awake)
      const current = this.#requireState()
      if (current.awake === awake) return preferencesFromState(current)
      if (awake && this.#provider === undefined) throw new Error("No Pet feature provider is installed")

      this.#state = await this.#persistProviderState(awake, this.#provider?.pluginId)
      if (awake) {
        try {
          await this.#openAwakeProvider()
        } catch (error) {
          this.#state = await this.#persistProviderState(false, this.#provider?.pluginId)
          this.#emitPreferences()
          throw error
        }
      } else {
        this.#stopActivity()
        await this.#window.close()
      }
      this.#emitPreferences()
      return preferencesFromState(this.#state)
    })
  }

  dispose(): Promise<void> {
    return this.#exclusive(async () => {
      if (this.#disposed) return
      this.#disposed = true
      const wasAwake = this.#state?.awake === true
      this.#stopActivity()
      if (wasAwake) await this.#window.close()
      this.#activityListeners.clear()
      this.#preferencesListeners.clear()
      this.#providerListeners.clear()
    }, true)
  }

  async #initialize() {
    this.#assertUsable()
    if (this.#initialized) return

    const state = await this.#stateStore.read()
    const nextProvider = await this.#resolveProvider(state.providerId, undefined)
    const samePersistedProvider =
      nextProvider !== undefined && state.providerId !== undefined && nextProvider.pluginId === state.providerId
    const awake = samePersistedProvider ? state.awake : false

    this.#state = state
    this.#provider = nextProvider
    if (nextProvider !== undefined || state.providerId !== undefined || state.awake !== awake) {
      this.#state = await this.#persistProviderState(awake, nextProvider?.pluginId)
    }
    this.#initialized = true
    if (nextProvider !== undefined) this.#emitProvider()

    if (awake) {
      try {
        await this.#openAwakeProvider()
      } catch (error) {
        this.#state = await this.#persistProviderState(false, nextProvider?.pluginId)
        this.#emitPreferences()
        throw error
      }
    }
  }

  async #refresh() {
    this.#assertInitialized()
    const currentProvider = this.#provider
    const currentState = this.#requireState()
    let nextProvider: InstalledPetProvider | undefined
    try {
      nextProvider = await this.#resolveProvider(currentState.providerId, currentProvider)
    } catch (error) {
      if (
        error instanceof PetProviderConflictError &&
        currentProvider !== undefined &&
        !error.providerIds.includes(currentProvider.pluginId)
      ) {
        if (currentState.awake) {
          this.#stopActivity()
          await this.#window.close()
        }
        this.#provider = undefined
        this.#state = await this.#persistProviderState(false, undefined)
        this.#emitProvider()
        if (currentState.awake) this.#emitPreferences()
      }
      throw error
    }

    if (sameProviderIdentity(currentProvider, nextProvider)) return

    const wasAwake = currentState.awake
    if (wasAwake) {
      this.#stopActivity()
      await this.#window.close()
    }

    this.#provider = nextProvider
    const sameProviderId =
      currentProvider !== undefined && nextProvider !== undefined && currentProvider.pluginId === nextProvider.pluginId
    const awake = wasAwake && sameProviderId
    this.#state = await this.#persistProviderState(awake, nextProvider?.pluginId)
    this.#emitProvider()
    if (awake) {
      try {
        await this.#openAwakeProvider()
      } catch (error) {
        this.#state = await this.#persistProviderState(false, nextProvider?.pluginId)
        this.#emitPreferences()
        throw error
      }
    }
    if (wasAwake !== awake) this.#emitPreferences()
  }

  async #resolveProvider(
    preferredProviderId: string | undefined,
    currentProvider: InstalledPetProvider | undefined,
  ): Promise<InstalledPetProvider | undefined> {
    const candidates = (await this.#pluginManager.list())
      .filter((plugin) => plugin.contributes.pet !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (candidates.length === 0) return undefined

    let candidate: InstalledWebPluginSummary | undefined
    if (candidates.length === 1) {
      candidate = candidates[0]
    } else {
      candidate = candidates.find((plugin) => plugin.id === preferredProviderId)
      if (candidate === undefined) throw new PetProviderConflictError(candidates.map((plugin) => plugin.id))
    }

    const identity = await this.#pluginManager.resolveCapabilityIdentity(candidate.id)
    if (identity === null || identity.plugin.id !== candidate.id) {
      throw new Error(`Pet feature provider is no longer installed: ${candidate.id}`)
    }
    const plugin = identity.plugin
    const contribution = plugin.contributes.pet
    if (contribution === undefined) {
      throw new Error(`Pet feature provider is no longer installed: ${candidate.id}`)
    }
    const generation =
      currentProvider?.pluginId === plugin.id && currentProvider.digest === identity.digest
        ? currentProvider.generation
        : ++this.#generation
    return freezeProvider({
      capabilities: [...plugin.capabilities] as WebPluginCapability[],
      contribution,
      digest: identity.digest,
      generation,
      libraryUrl: providerAssetUrl(plugin.id, contribution.library, "Pet library path"),
      overlayUrl: providerAssetUrl(plugin.id, contribution.overlay, "Pet overlay path"),
      pluginId: plugin.id,
      settingsUrl: providerAssetUrl(plugin.id, contribution.settings, "Pet settings path"),
      version: plugin.version,
    })
  }

  async #persistProviderState(awake: boolean, providerId: string | undefined) {
    return this.#stateStore.update((state) => {
      const { providerId: _previousProviderId, ...rest } = state
      return {
        ...rest,
        awake,
        ...(providerId === undefined ? {} : { providerId }),
      }
    })
  }

  async #openAwakeProvider() {
    const provider = this.#provider
    if (provider === undefined) throw new Error("No Pet feature provider is installed")
    await this.#window.open(cloneProvider(provider))
    try {
      this.#activityUnsubscribe = this.#activity.subscribe((snapshot) => {
        const cloned = cloneActivity(snapshot)
        this.#emit(this.#activityListeners, cloned, cloneActivity)
      })
    } catch (error) {
      await Promise.resolve(this.#window.close()).catch(() => undefined)
      throw error
    }
  }

  #stopActivity() {
    const unsubscribe = this.#activityUnsubscribe
    this.#activityUnsubscribe = undefined
    try {
      unsubscribe?.()
    } catch {}
  }

  #emitProvider() {
    this.#emit(
      this.#providerListeners,
      this.#provider,
      (provider) => (provider === undefined ? undefined : cloneProvider(provider)),
    )
  }

  #emitPreferences() {
    const preferences = preferencesFromState(this.#requireState())
    this.#emit(this.#preferencesListeners, preferences, (value) => ({ ...value }))
  }

  #emit<Value>(listeners: Set<Listener<Value>>, value: Value, clone: (value: Value) => Value) {
    for (const listener of listeners) {
      try {
        listener(clone(value))
      } catch {}
    }
  }

  #assertInitialized() {
    this.#assertUsable()
    if (!this.#initialized) throw new Error("Pet provider controller is not initialized")
  }

  #assertUsable() {
    if (this.#disposed) throw new Error("Pet provider controller is disposed")
  }

  #requireState() {
    this.#assertUsable()
    if (this.#state === undefined) throw new Error("Pet provider controller is not initialized")
    return this.#state
  }

  #exclusive<Result>(operation: () => Promise<Result>, allowDisposed = false) {
    const guarded = () => {
      if (!allowDisposed) this.#assertUsable()
      return operation()
    }
    const result = this.#mutationTail.then(guarded, guarded)
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
