import { installCurrentProtocolAuthority, type VerifiedProtocolAuthorityV2 } from "@convax/collaboration"

/** Contract tests use the same current protocol capability the service ships. */
export function loadApiTestProtocolAuthorityV2(): Promise<VerifiedProtocolAuthorityV2> {
  return Promise.resolve(installCurrentProtocolAuthority())
}
