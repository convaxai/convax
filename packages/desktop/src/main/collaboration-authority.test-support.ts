import { installCurrentProtocolAuthority, type CurrentProtocolAuthority } from "@convax/collaboration"

/** Installs the same current protocol capability Main composes at startup. */
export function loadHistoricalTestAuthority(): Promise<CurrentProtocolAuthority> {
  return Promise.resolve(installCurrentProtocolAuthority())
}
