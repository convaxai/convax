import path from "node:path"

import type { VerifiedProtocolAuthorityV2 } from "@convax/collaboration"
import { loadCollaborationAuthoritiesV3 } from "./collaboration-authority-loader-v3"

const stagedAuthorityRoot = path.resolve(import.meta.dir, "../..", ".packaging/collaboration-authority")

let historicalAuthority: Promise<VerifiedProtocolAuthorityV2> | undefined

/** Loads V10 only through the active V11 dual-release staging and historical pin. */
export function loadHistoricalTestAuthorityV2(): Promise<VerifiedProtocolAuthorityV2> {
  historicalAuthority ??= loadCollaborationAuthoritiesV3({
    explicitAuthorityRoot: stagedAuthorityRoot,
  }).then(({ historicalV2 }) => historicalV2)
  return historicalAuthority
}
