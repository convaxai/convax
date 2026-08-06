import type { CurrentProtocolAuthority } from "./authority"
import { installCurrentProtocolAuthority } from "./current-protocol"

/**
 * Tests install the same current protocol capability production installs. There
 * is no docs-backed release snapshot and no second authority to select.
 */
export function loadVerifiedTestAuthority(): Promise<CurrentProtocolAuthority> {
  return Promise.resolve(installCurrentProtocolAuthority())
}
