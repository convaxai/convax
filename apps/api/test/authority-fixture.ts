import { installCurrentProtocolAuthority, type CurrentProtocolAuthority } from "@convax/collaboration"

/** Contract tests use the same current protocol capability the service ships. */
export function loadApiTestProtocolAuthorityV2(): Promise<CurrentProtocolAuthority> {
  return Promise.resolve(installCurrentProtocolAuthority())
}
