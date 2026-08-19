import type { HostMessagePort } from "@convax/agent-runtime/node/host-message-port-carrier"

interface ElectronMessagePort {
  close(): void
  off(event: "message", listener: (event: { data: unknown }) => void): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
  start(): void
}

export function asHostMessagePort(port: ElectronMessagePort): HostMessagePort {
  port.start()
  return {
    close: () => port.close(),
    onMessage(listener) {
      const receive = (event: { data: unknown }) => listener(event.data)
      port.on("message", receive)
      return () => port.off("message", receive)
    },
    postMessage: (message) => port.postMessage(message),
  }
}
