import type { PluginCapabilityConnectInput, PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import {
  pluginCapabilityProtocolV1,
  pluginHostFailure,
  type DesktopPluginHostCommand,
  type DesktopPluginHostResponse,
  type PluginCapabilityProtocol,
} from "../plugin-host-protocol"

const maximumCapabilityRequestBytes = 1024 * 1024

/**
 * Renderer adapter for one principal-bound main connection. It contains no
 * Canvas or Web-node policy; a Web MessagePort is merely one possible sink.
 */
export class RendererPluginHostConnection {
  private closed = false
  private connectionId: string | undefined
  private readonly connectPromise: Promise<string>
  private readonly unsubscribe: () => void

  constructor(
    private readonly client: PluginCapabilityRendererClient,
    input: PluginCapabilityConnectInput,
    private readonly onCommand: (command: DesktopPluginHostCommand) => void,
    private readonly expectedProtocol: PluginCapabilityProtocol = pluginCapabilityProtocolV1,
  ) {
    this.unsubscribe = client.onEvent((event) => {
      if (this.closed || event.connectionId !== this.connectionId) return
      this.onCommand(event.command)
    })
    this.connectPromise = client.connect(input).then(({ connectionId, protocol }) => {
      if (protocol !== this.expectedProtocol) throw new Error("Plugin capability protocol mismatch")
      if (this.closed) {
        void client.disconnect({ connectionId }).catch(() => undefined)
        throw new Error("Plugin capability connection was closed")
      }
      this.connectionId = connectionId
      return connectionId
    })
    void this.connectPromise.catch(() => undefined)
  }

  async dispatch(request: unknown): Promise<DesktopPluginHostResponse | null> {
    const id = requestId(request)
    try {
      if (this.closed) throw new Error("Plugin capability connection was closed")
      assertSerializedSize(request, maximumCapabilityRequestBytes)
      const connectionId = await this.connectPromise
      return await this.client.call({ connectionId, request })
    } catch (error) {
      if (!id) return null
      return pluginHostFailure(id, error, this.expectedProtocol)
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    const connectionId = this.connectionId
    if (connectionId) void this.client.disconnect({ connectionId }).catch(() => undefined)
  }
}

function assertSerializedSize(value: unknown, maximumBytes: number) {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error("Plugin capability request must be JSON-serializable")
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new Error(`Plugin capability request exceeds ${maximumBytes} bytes`)
  }
}

export function isProjectCanvasCapabilityRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const method = (value as Record<string, unknown>).method
  return (
    method === "projects.list" ||
    method === "canvas.catalog.list" ||
    method === "canvas.document.get" ||
    method === "canvas.nodes.query" ||
    method === "canvas.transaction.execute" ||
    method === "canvas.events.subscribe" ||
    method === "canvas.events.unsubscribe"
  )
}

function requestId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).id
  return typeof id === "string" && id && id.length <= 128 ? id : null
}
