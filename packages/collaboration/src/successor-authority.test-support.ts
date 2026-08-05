import {
  selectInstalledProtocolAuthorityV3,
  validateSuccessorAuthorityReleaseSnapshotV1,
} from "./authority-selector-v3"
import { loadValidatedTestAuthorityReleaseV2, readTestAuthorityFileV2 } from "./authority.test-support"
import type { VerifiedProtocolAuthorityV3 } from "./successor-frame"

const root = "docs/superpowers/specs/authorities/collaboration-v11/r1"
const pointerPath = "docs/superpowers/specs/collaboration-v11-active-authority.json"
const releasePaths = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${root}/appendices/canvas-schema.md`,
  `${root}/appendices/collaboration-kernel.md`,
  `${root}/appendices/control-plane.md`,
  `${root}/appendices/project-persistence.md`,
  `${root}/authority.sha256`,
  `${root}/historical-v10-r5-pin.json`,
  `${root}/main.md`,
  `${root}/protocol-schema-bundle-v3.json`,
  `${root}/review-evidence.json`,
  `${root}/reviews/canvas-intent-runtime/receipt.json`,
  `${root}/reviews/canvas-intent-runtime/report.md`,
  `${root}/reviews/collaboration-control-protocol/receipt.json`,
  `${root}/reviews/collaboration-control-protocol/report.md`,
  `${root}/reviews/project-native-store/receipt.json`,
  `${root}/reviews/project-native-store/report.md`,
])

let verified: Promise<VerifiedProtocolAuthorityV3> | undefined

/**
 * Produces a live test capability through the same closed release validation and
 * selector path used by production. It consumes the selected sealed pointer and
 * review closure; candidate authority construction is deliberately not accepted.
 */
export function loadVerifiedTestAuthorityV3(): Promise<VerifiedProtocolAuthorityV3> {
  verified ??= (async () => {
    const release = validateSuccessorAuthorityReleaseSnapshotV1({
      activePointerBytes: await readTestAuthorityFileV2(pointerPath),
      files: await Promise.all(releasePaths.map(async (path) => ({
        path,
        bytes: await readTestAuthorityFileV2(path),
      }))),
    })
    return selectInstalledProtocolAuthorityV3(release, await loadValidatedTestAuthorityReleaseV2())
  })()
  return verified
}
