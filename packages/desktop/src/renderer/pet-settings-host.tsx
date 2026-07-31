import { useEffect, useRef, useState } from "react"
import { isPetHostConnect, type PetHostSettingsConnect } from "@convax/plugin-sdk/pet"
import { parseWebPluginAssetUrl } from "../plugin-asset-contract"

export interface PetSettingsProvider {
  generation: number
  pluginId: string
  settingsUrl: string
}

export interface PetSettingsConnectionIdentity {
  generation: number
  connectionId: string
  pluginId: string
}

export interface PetSettingsHostClient {
  connectSettings(input: PetSettingsConnectionIdentity): Promise<void>
  disconnectSettings(input: PetSettingsConnectionIdentity): Promise<void> | void
  getProvider(): Promise<PetSettingsProvider | undefined>
  onProviderChanged(listener: () => void): () => void
}

interface PortLike {
  close(): void
}

interface FrameWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void
}

interface PetSettingsRelayEvent {
  data: unknown
  ports: readonly PortLike[]
  source: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPluginId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function defaultPetSettingsConnectionId() {
  return "settings-" + globalThis.crypto.randomUUID()
}

function requirePetSettingsConnectionId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 80 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Pet settings connection id is invalid")
  }
  return value
}

function sameIdentity(left: PetSettingsProvider, right: PetSettingsProvider) {
  return left.pluginId === right.pluginId && left.generation === right.generation
}

function isSettingsEnvelope(
  value: unknown,
  identity: PetSettingsConnectionIdentity,
): value is PetHostSettingsConnect {
  return (
    isPetHostConnect(value, "settings", identity.pluginId) &&
    value.connectionId === identity.connectionId &&
    value.generation === identity.generation
  )
}

function closePorts(ports: readonly PortLike[]) {
  for (const port of ports) {
    try {
      port.close()
    } catch {}
  }
}

export function isPetSettingsProvider(value: unknown): value is PetSettingsProvider {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (
    keys.length !== 3 ||
    !keys.every((key) => ["generation", "pluginId", "settingsUrl"].includes(key)) ||
    !isGeneration(value.generation) ||
    !isPluginId(value.pluginId) ||
    typeof value.settingsUrl !== "string"
  ) {
    return false
  }
  try {
    return parseWebPluginAssetUrl(value.settingsUrl).identity.pluginId === value.pluginId
  } catch {
    return false
  }
}

export type PetSettingsProviderSnapshot =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "error" }
  | { provider: PetSettingsProvider; status: "ready" }

function cloneProvider(provider: PetSettingsProvider): PetSettingsProvider {
  return { ...provider }
}

function cloneProviderSnapshot(snapshot: PetSettingsProviderSnapshot): PetSettingsProviderSnapshot {
  return snapshot.status === "ready" ? { provider: cloneProvider(snapshot.provider), status: "ready" } : { ...snapshot }
}

export class PetSettingsProviderLoader {
  readonly #client: PetSettingsHostClient
  readonly #listeners = new Set<(snapshot: PetSettingsProviderSnapshot) => void>()
  #disposed = false
  #request = 0
  #snapshot: PetSettingsProviderSnapshot = { status: "loading" }
  #started = false
  #unsubscribe: (() => void) | undefined

  constructor(client: PetSettingsHostClient) {
    this.#client = client
  }

  getSnapshot() {
    return cloneProviderSnapshot(this.#snapshot)
  }

  subscribe(listener: (snapshot: PetSettingsProviderSnapshot) => void) {
    if (this.#disposed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start() {
    if (this.#disposed || this.#started) return
    this.#started = true
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = this.#client.onProviderChanged(() => this.#refresh())
    } catch {
      if (!this.#disposed) this.#setSnapshot({ status: "error" })
      return
    }
    if (this.#disposed) {
      try {
        unsubscribe()
      } catch {}
      return
    }
    this.#unsubscribe = unsubscribe
    this.#refresh()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#request += 1
    try {
      this.#unsubscribe?.()
    } catch {}
    this.#unsubscribe = undefined
    this.#listeners.clear()
  }

  #refresh() {
    if (this.#disposed) return
    const request = ++this.#request
    this.#setSnapshot({ status: "loading" })
    if (this.#disposed || request !== this.#request) return
    let providerQuery: Promise<PetSettingsProvider | undefined>
    try {
      providerQuery = this.#client.getProvider()
    } catch {
      if (!this.#disposed && request === this.#request) this.#setSnapshot({ status: "error" })
      return
    }
    void providerQuery.then(
      (provider) => {
        if (this.#disposed || request !== this.#request) return
        if (provider === undefined) {
          this.#setSnapshot({ status: "absent" })
        } else if (isPetSettingsProvider(provider)) {
          this.#setSnapshot({ provider: cloneProvider(provider), status: "ready" })
        } else {
          this.#setSnapshot({ status: "error" })
        }
      },
      () => {
        if (!this.#disposed && request === this.#request) this.#setSnapshot({ status: "error" })
      },
    )
  }

  #setSnapshot(snapshot: PetSettingsProviderSnapshot) {
    this.#snapshot = cloneProviderSnapshot(snapshot)
    for (const listener of [...this.#listeners]) {
      try {
        listener(cloneProviderSnapshot(snapshot))
      } catch {}
    }
  }
}

export type PetSettingsFrameStatus = "idle" | "loading" | "connected" | "unavailable"

interface PetSettingsFrameLoadTarget {
  frameLoaded(): Promise<void> | void
}

export class PetSettingsFrameLifecycle {
  #binding: string | undefined
  #deliveredTarget: PetSettingsFrameLoadTarget | undefined
  #deliveredVersion = 0
  #loadVersion = 0
  #pendingBinding: string | undefined
  #pendingLoadVersion = 0
  #target: PetSettingsFrameLoadTarget | undefined

  prepare(binding: string) {
    return () => this.loaded(binding)
  }

  bind(binding: string) {
    if (binding === this.#binding) return
    this.#binding = binding
    this.#deliveredTarget = undefined
    this.#deliveredVersion = 0
    this.#loadVersion = this.#pendingBinding === binding ? this.#pendingLoadVersion : 0
    this.#pendingBinding = undefined
    this.#pendingLoadVersion = 0
    this.#target = undefined
  }

  attach(binding: string, target: PetSettingsFrameLoadTarget) {
    if (binding !== this.#binding) return () => undefined
    this.#target = target
    this.#deliver()
    return () => {
      if (this.#target === target) this.#target = undefined
    }
  }

  loaded(binding: string) {
    if (binding !== this.#binding) {
      if (binding === this.#pendingBinding) {
        this.#pendingLoadVersion += 1
      } else {
        this.#pendingBinding = binding
        this.#pendingLoadVersion = 1
      }
      return
    }
    this.#loadVersion += 1
    this.#deliver()
  }

  #deliver() {
    const target = this.#target
    if (
      !target ||
      this.#loadVersion === 0 ||
      (this.#deliveredVersion === this.#loadVersion && this.#deliveredTarget === target)
    )
      return
    this.#deliveredVersion = this.#loadVersion
    this.#deliveredTarget = target
    try {
      void Promise.resolve(target.frameLoaded()).catch(() => undefined)
    } catch {}
  }
}

export class PetSettingsFrameRelay {
  readonly #client: PetSettingsHostClient
  readonly #frameWindow: FrameWindowLike
  readonly #createConnectionId: () => string
  readonly #statusListeners = new Set<(status: PetSettingsFrameStatus) => void>()
  readonly hostWindow: unknown
  #activeIdentity: PetSettingsConnectionIdentity | undefined
  #disposed = false
  #loadEpoch = 0
  #portRelayed = false
  #provider: PetSettingsProvider
  #status: PetSettingsFrameStatus = "idle"

  constructor(options: {
    client: PetSettingsHostClient
    frameWindow: FrameWindowLike
    createConnectionId?: () => string
    hostWindow: unknown
    provider: PetSettingsProvider
  }) {
    if (!isPetSettingsProvider(options.provider)) throw new Error("Pet settings provider is invalid")
    this.#client = options.client
    this.#frameWindow = options.frameWindow
    this.#createConnectionId = options.createConnectionId ?? defaultPetSettingsConnectionId
    this.hostWindow = options.hostWindow
    this.#provider = { ...options.provider }
  }

  getStatus() {
    return this.#status
  }

  subscribeStatus(listener: (status: PetSettingsFrameStatus) => void) {
    if (this.#disposed) return () => undefined
    this.#statusListeners.add(listener)
    return () => this.#statusListeners.delete(listener)
  }

  async frameLoaded() {
    if (this.#disposed) return
    const epoch = ++this.#loadEpoch
    const previous = this.#activeIdentity
    this.#activeIdentity = undefined
    this.#portRelayed = false
    this.#setStatus("loading")
    if (previous) await this.#disconnect(previous)
    if (this.#disposed || epoch !== this.#loadEpoch) return

    let connectionId: string
    try {
      connectionId = requirePetSettingsConnectionId(this.#createConnectionId())
    } catch {
      this.#setStatus("unavailable")
      return
    }
    const identity: PetSettingsConnectionIdentity = {
      connectionId,
      generation: this.#provider.generation,
      pluginId: this.#provider.pluginId,
    }
    this.#activeIdentity = identity
    try {
      await this.#client.connectSettings(identity)
      if (this.#disposed || epoch !== this.#loadEpoch || this.#activeIdentity !== identity) {
        await this.#disconnect(identity)
        return
      }
      this.#setStatus(this.#portRelayed ? "connected" : "loading")
    } catch {
      if (this.#disposed || epoch !== this.#loadEpoch || this.#activeIdentity !== identity) {
        await this.#disconnect(identity)
        return
      }
      this.#setStatus("unavailable")
    }
  }

  receive(event: PetSettingsRelayEvent) {
    const identity = this.#activeIdentity
    if (
      this.#disposed ||
      identity === undefined ||
      this.#status === "unavailable" ||
      this.#portRelayed ||
      event.source !== this.hostWindow ||
      event.ports.length !== 1 ||
      !isSettingsEnvelope(event.data, identity)
    ) {
      closePorts(event.ports)
      return false
    }

    const port = event.ports[0]!
    try {
      this.#frameWindow.postMessage(event.data, "*", [port as Transferable])
      this.#portRelayed = true
      this.#setStatus("connected")
      return true
    } catch {
      closePorts([port])
      this.#setStatus("unavailable")
      void this.#disconnect(identity)
      return false
    }
  }

  async replaceProvider(provider: PetSettingsProvider) {
    if (this.#disposed) return
    if (!isPetSettingsProvider(provider)) throw new Error("Pet settings provider is invalid")
    if (sameIdentity(this.#provider, provider) && this.#provider.settingsUrl === provider.settingsUrl) return
    this.#loadEpoch += 1
    const previous = this.#activeIdentity
    this.#activeIdentity = undefined
    this.#portRelayed = false
    this.#setStatus("idle")
    this.#provider = { ...provider }
    if (previous) await this.#disconnect(previous)
  }

  async dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#loadEpoch += 1
    const identity = this.#activeIdentity
    this.#activeIdentity = undefined
    this.#portRelayed = false
    if (identity) await this.#disconnect(identity)
    this.#statusListeners.clear()
  }

  async #disconnect(identity: PetSettingsConnectionIdentity) {
    try {
      await this.#client.disconnectSettings(identity)
    } catch {
      // Main also closes sender-scoped ports when the trusted renderer disappears.
    }
  }

  #setStatus(status: PetSettingsFrameStatus) {
    if (this.#status === status) return
    this.#status = status
    for (const listener of this.#statusListeners) listener(status)
  }
}

export function PetSettingsHost({
  client,
  frameStatus: injectedFrameStatus,
  provider,
}: {
  client: PetSettingsHostClient
  frameStatus?: PetSettingsFrameStatus
  provider: PetSettingsProvider
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const relayRef = useRef<PetSettingsFrameRelay | null>(null)
  const trustedProvider = isPetSettingsProvider(provider) ? provider : undefined
  const bindingKey = trustedProvider ? `${trustedProvider.pluginId}:${trustedProvider.generation}` : "unavailable"
  const frameKey = trustedProvider ? `${bindingKey}:${trustedProvider.settingsUrl}` : bindingKey
  const frameLifecycleRef = useRef<PetSettingsFrameLifecycle | null>(null)
  if (!frameLifecycleRef.current) frameLifecycleRef.current = new PetSettingsFrameLifecycle()
  const frameLifecycle = frameLifecycleRef.current
  const frameLoaded = frameLifecycle.prepare(frameKey)
  const [frameSnapshot, setFrameSnapshot] = useState<{ key: string; status: PetSettingsFrameStatus }>({
    key: frameKey,
    status: "loading",
  })
  const frameStatus = injectedFrameStatus ?? (frameSnapshot.key === frameKey ? frameSnapshot.status : "loading")

  useEffect(() => {
    frameLifecycle.bind(frameKey)
    const frameWindow = iframeRef.current?.contentWindow
    if (!frameWindow || !trustedProvider) return
    setFrameSnapshot({ key: frameKey, status: "loading" })
    const relay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow: window, provider: trustedProvider })
    relayRef.current = relay
    const detachFrame = frameLifecycle.attach(frameKey, relay)
    const receive = (event: MessageEvent) => {
      relay.receive({ data: event.data, ports: event.ports, source: event.source })
    }
    let active = true
    let unsubscribeStatus: () => void = () => undefined
    const teardown = () => {
      if (!active) return
      active = false
      window.removeEventListener("message", receive)
      detachFrame()
      unsubscribeStatus()
      if (relayRef.current === relay) relayRef.current = null
      void relay.dispose()
    }
    unsubscribeStatus = relay.subscribeStatus((status) => {
      if (!active) return
      setFrameSnapshot({ key: frameKey, status })
      if (status === "unavailable") teardown()
    })
    window.addEventListener("message", receive)
    return teardown
  }, [client, frameKey, frameLifecycle, trustedProvider])

  if (!trustedProvider || frameStatus === "unavailable") {
    return (
      <div
        className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground"
        data-pet-settings-status="unavailable"
        role="status"
      >
        Pet provider unavailable.
      </div>
    )
  }

  return (
    <iframe
      className="min-h-[36rem] w-full rounded-xl border border-border bg-card"
      data-pet-settings-binding={bindingKey}
      data-pet-settings-status={frameStatus}
      key={frameKey}
      onLoad={frameLoaded}
      ref={iframeRef}
      sandbox="allow-scripts"
      src={trustedProvider.settingsUrl}
      title="Pet settings"
    />
  )
}
