import { installCurrentProtocolAuthority, type VerifiedProtocolAuthorityV2 } from "@convax/collaboration"

/** Installs the same current protocol capability Main composes at startup. */
export function loadHistoricalTestAuthorityV2(): Promise<VerifiedProtocolAuthorityV2> {
  return Promise.resolve(installCurrentProtocolAuthority())
}
