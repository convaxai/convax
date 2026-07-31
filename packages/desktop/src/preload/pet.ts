import { ipcRenderer } from "electron"
import { isPetHostConnect } from "@convax/plugin-sdk/pet"

const petHostConnectChannel = "pet:connect-host"

let connected = false
ipcRenderer.on(petHostConnectChannel, (event, envelope: unknown) => {
  const ports = event.ports ?? []
  if (
    connected ||
    window.top !== window ||
    !isPetHostConnect(envelope, "overlay", window.location.hostname) ||
    window.location.protocol !== "convax-plugin:" ||
    window.location.hostname !== envelope.pluginId ||
    ports.length !== 1
  ) {
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
