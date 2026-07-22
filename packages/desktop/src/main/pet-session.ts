import { petAssetScheme } from "./pet-asset-protocol"

export const petWindowPartition = "convax-pet-overlay"

interface PetProtocolPort {
  handle(scheme: string, handler: (request: Request) => Promise<Response>): void
  unhandle(scheme: string): void
}

interface PetSessionFactory {
  fromPartition(partition: string, options: { cache: boolean }): { protocol: PetProtocolPort }
}

export function registerPetAssetSessionProtocol(
  sessions: PetSessionFactory,
  handler: (request: Request) => Promise<Response>,
) {
  const petSession = sessions.fromPartition(petWindowPartition, { cache: false })
  petSession.protocol.handle(petAssetScheme, handler)
  return () => petSession.protocol.unhandle(petAssetScheme)
}
