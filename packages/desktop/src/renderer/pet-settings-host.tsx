import { useEffect, useRef } from "react"

const petHostProtocol = "convax.pet-host/1" as const

export interface PetSettingsProvider {
  generation: number
  pluginId: string
  settingsUrl: string
}

export interface PetSettingsConnectionIdentity {
  generation: number
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

interface PetSettingsConnectEnvelope {
  generation: number
  pluginId: string
  protocol: typeof petHostProtocol
  surface: "settings"
  type: "connect"
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

function connectionIdentity(provider: PetSettingsProvider): PetSettingsConnectionIdentity {
  return { generation: provider.generation, pluginId: provider.pluginId }
}

function sameIdentity(left: PetSettingsProvider, right: PetSettingsProvider) {
  return left.pluginId === right.pluginId && left.generation === right.generation
}

function isSettingsEnvelope(value: unknown, provider: PetSettingsProvider): value is PetSettingsConnectEnvelope {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === 5 &&
    keys.every((key) => ["generation", "pluginId", "protocol", "surface", "type"].includes(key)) &&
    value.generation === provider.generation &&
    value.pluginId === provider.pluginId &&
    value.protocol === petHostProtocol &&
    value.surface === "settings" &&
    value.type === "connect"
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
    const url = new URL(value.settingsUrl)
    return (
      url.protocol === "convax-plugin:" &&
      url.hostname === value.pluginId &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === ""
    )
  } catch {
    return false
  }
}

export class PetSettingsFrameRelay {
  readonly #client: PetSettingsHostClient
  readonly #frameWindow: FrameWindowLike
  readonly hostWindow: unknown
  #connectPromise: Promise<void> | undefined
  #connectRequested = false
  #disposed = false
  #portRelayed = false
  #provider: PetSettingsProvider

  constructor(options: {
    client: PetSettingsHostClient
    frameWindow: FrameWindowLike
    hostWindow: unknown
    provider: PetSettingsProvider
  }) {
    if (!isPetSettingsProvider(options.provider)) throw new Error("Pet settings provider is invalid")
    this.#client = options.client
    this.#frameWindow = options.frameWindow
    this.hostWindow = options.hostWindow
    this.#provider = { ...options.provider }
  }

  async frameLoaded() {
    if (this.#disposed || this.#connectRequested) return
    this.#connectRequested = true
    const identity = connectionIdentity(this.#provider)
    const connect = Promise.resolve(this.#client.connectSettings(identity))
    this.#connectPromise = connect
    try {
      await connect
    } catch (error) {
      if (!this.#disposed && sameIdentity(this.#provider, identity as PetSettingsProvider)) {
        this.#connectRequested = false
      }
      throw error
    } finally {
      if (this.#connectPromise === connect) this.#connectPromise = undefined
    }
  }

  receive(event: PetSettingsRelayEvent) {
    if (
      this.#disposed ||
      !this.#connectRequested ||
      this.#portRelayed ||
      event.source !== this.hostWindow ||
      event.ports.length !== 1 ||
      !isSettingsEnvelope(event.data, this.#provider)
    ) {
      closePorts(event.ports)
      return false
    }

    const port = event.ports[0]!
    try {
      this.#frameWindow.postMessage(event.data, "*", [port as Transferable])
      this.#portRelayed = true
      return true
    } catch {
      closePorts([port])
      this.#connectRequested = false
      void this.#disconnect(this.#provider)
      return false
    }
  }

  async replaceProvider(provider: PetSettingsProvider) {
    if (this.#disposed) return
    if (!isPetSettingsProvider(provider)) throw new Error("Pet settings provider is invalid")
    if (sameIdentity(this.#provider, provider) && this.#provider.settingsUrl === provider.settingsUrl) return
    const previous = this.#provider
    await this.#connectPromise?.catch(() => undefined)
    if (this.#connectRequested) await this.#disconnect(previous)
    this.#provider = { ...provider }
    this.#connectRequested = false
    this.#portRelayed = false
  }

  async dispose() {
    if (this.#disposed) return
    this.#disposed = true
    await this.#connectPromise?.catch(() => undefined)
    if (this.#connectRequested) await this.#disconnect(this.#provider)
    this.#connectRequested = false
    this.#portRelayed = false
  }

  async #disconnect(provider: PetSettingsProvider) {
    try {
      await this.#client.disconnectSettings(connectionIdentity(provider))
    } catch {
      // Main also closes sender-scoped ports when the trusted renderer disappears.
    }
  }
}

export function PetSettingsHost({
  client,
  provider,
}: {
  client: PetSettingsHostClient
  provider: PetSettingsProvider
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const relayRef = useRef<PetSettingsFrameRelay | null>(null)
  const trustedProvider = isPetSettingsProvider(provider) ? provider : undefined

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow
    if (!frameWindow || !trustedProvider) return
    const relay = new PetSettingsFrameRelay({ client, frameWindow, hostWindow: window, provider: trustedProvider })
    relayRef.current = relay
    const receive = (event: MessageEvent) => {
      relay.receive({ data: event.data, ports: event.ports, source: event.source })
    }
    window.addEventListener("message", receive)
    return () => {
      window.removeEventListener("message", receive)
      if (relayRef.current === relay) relayRef.current = null
      void relay.dispose()
    }
  }, [client, trustedProvider?.generation, trustedProvider?.pluginId, trustedProvider?.settingsUrl])

  if (!trustedProvider) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Pet provider unavailable.
      </div>
    )
  }

  return (
    <iframe
      className="min-h-[36rem] w-full rounded-xl border border-border bg-card"
      onLoad={() => void relayRef.current?.frameLoaded()}
      ref={iframeRef}
      sandbox="allow-scripts"
      src={trustedProvider.settingsUrl}
      title="Pet settings"
    />
  )
}
