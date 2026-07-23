import { ipcRenderer } from "electron"

const petHostConnectChannel = "pet:connect-host"
const petHostProtocol = "convax.pet-host/1"

interface PetConnectEnvelope {
  pluginId: string
  protocol: typeof petHostProtocol
  surface: "overlay"
  type: "connect"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPetConnectEnvelope(value: unknown): value is PetConnectEnvelope {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === 4 &&
    keys.every((key) => ["pluginId", "protocol", "surface", "type"].includes(key)) &&
    value.protocol === petHostProtocol &&
    value.type === "connect" &&
    value.surface === "overlay" &&
    typeof value.pluginId === "string" &&
    value.pluginId.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.pluginId)
  )
}

let connected = false
ipcRenderer.on(petHostConnectChannel, (event, envelope: unknown) => {
  const ports = event.ports ?? []
  if (connected || window.top !== window || !isPetConnectEnvelope(envelope) || ports.length !== 1) {
    for (const port of ports) port.close()
    return
  }
  connected = true
  const port = ports[0]!
  try {
    window.postMessage(envelope, "*", [port])
  } catch {
    connected = false
    port.close()
  }
})
