import type { VerifiedProtocolAuthorityV2 } from "./authority"
import { installCurrentProtocolAuthority } from "./current-protocol"

/**
 * Tests install the same current protocol capability production installs. There
 * is no docs-backed release snapshot and no second authority to select.
 */
export function loadVerifiedTestAuthorityV2(): Promise<VerifiedProtocolAuthorityV2> {
  return Promise.resolve(installCurrentProtocolAuthority())
}
