import { createWebPluginAssetHandler, webPluginAssetScheme, type WebPluginAssetResolver } from "./plugin-asset-protocol"

export const petWindowPartition = "convax-pet-overlay"
const petOverlayRendererContext = "convax-pet-overlay://host/index.html"

interface PetProtocolPort {
  handle(scheme: string, handler: (request: Request) => Promise<Response>): void
  unhandle(scheme: string): void
}

interface PetSessionFactory {
  fromPartition(partition: string, options: { cache: boolean }): { protocol: PetProtocolPort }
}

export function registerPetPluginSessionProtocol(sessions: PetSessionFactory, manager: WebPluginAssetResolver) {
  const petSession = sessions.fromPartition(petWindowPartition, { cache: false })
  const handler = createWebPluginAssetHandler(manager, { rendererUrl: petOverlayRendererContext })
  petSession.protocol.handle(webPluginAssetScheme, handler)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    petSession.protocol.unhandle(webPluginAssetScheme)
  }
}
