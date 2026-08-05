import {
  selectInstalledProtocolAuthorityV3,
  validateSuccessorAuthorityReleaseSnapshotV1,
} from "./authority-selector-v3"
import { loadValidatedTestAuthorityReleaseV2, readTestAuthorityFileV2 } from "./authority.test-support"
import { ordinarySha256V2 } from "./digest"
import { encodeRestrictedJcsV2 } from "./jcs"
import type { VerifiedProtocolAuthorityV3 } from "./successor-frame"

const root = "docs/superpowers/specs/authorities/collaboration-v11/r1"
const candidatePaths = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${root}/appendices/canvas-schema.md`,
  `${root}/appendices/collaboration-kernel.md`,
  `${root}/appendices/control-plane.md`,
  `${root}/appendices/project-persistence.md`,
  `${root}/authority.sha256`,
  `${root}/historical-v10-r5-pin.json`,
  `${root}/main.md`,
  `${root}/protocol-schema-bundle-v3.json`,
])
const manifestSha256 = "a9215ca975a604f6ffa2aae6afd52730006ca54030a4350ecbdf0c2ab71b9cba"
const protocolBundleSha256 = "176290fd43531506d8ab74592f4a8102835a9d50a77d4ae0571e2bd6557c4474"
const protocolDigest = "57d00c135d15339963004535c71770b10a35e301631b96ffc172c265e276ec3f"

const reviewers = Object.freeze([
  { role: "canvas-intent-runtime", directory: "canvas-intent-runtime", scoreBasisPoints: 900 },
  { role: "collaboration-control-protocol", directory: "collaboration-control-protocol", scoreBasisPoints: 901 },
  { role: "project-native-store", directory: "project-native-store", scoreBasisPoints: 902 },
] as const)

let verified: Promise<VerifiedProtocolAuthorityV3> | undefined

/**
 * Produces a live test capability through the same closed release validation and
 * selector path used by production. Review bytes are synthetic test evidence;
 * candidate authority construction is deliberately not accepted here.
 */
export function loadVerifiedTestAuthorityV3(): Promise<VerifiedProtocolAuthorityV3> {
  verified ??= (async () => {
    const reviews = reviewers.map(({ role, directory, scoreBasisPoints }) => {
      const reportPath = `${root}/reviews/${directory}/report.md`
      const receiptPath = `${root}/reviews/${directory}/receipt.json`
      const reportBytes = new TextEncoder().encode(`# ${role}\n\nUNCONDITIONAL SIGN\n`)
      const reportSha256 = ordinarySha256V2(reportBytes)
      const receiptBytes = withLf(encodeRestrictedJcsV2({
        authorityId: "collaboration-v11",
        decision: "UNCONDITIONAL SIGN",
        format: "convax.collaboration-authority-review-receipt/2",
        manifestPath: `${root}/authority.sha256`,
        manifestSha256,
        protocolBundlePath: `${root}/protocol-schema-bundle-v3.json`,
        protocolBundleSha256,
        protocolDigest,
        reportPath,
        reportSha256,
        reviewerRole: role,
        revision: "r1",
        scoreBasisPoints,
      }))
      return {
        decision: "UNCONDITIONAL SIGN" as const,
        receiptPath,
        receiptBytes,
        receiptSha256: ordinarySha256V2(receiptBytes),
        reportPath,
        reportBytes,
        reportSha256,
        reviewerRole: role,
        scoreBasisPoints,
      }
    })
    const evidenceBytes = withLf(encodeRestrictedJcsV2({
      authorityId: "collaboration-v11",
      decision: "UNCONDITIONAL 3/3 SIGN",
      format: "convax.collaboration-authority-review-evidence/2",
      manifestPath: `${root}/authority.sha256`,
      manifestSha256,
      protocolBundleSha256,
      protocolDigest,
      reviews: reviews.map(({ decision, receiptPath, receiptSha256, reportPath, reportSha256, reviewerRole, scoreBasisPoints }) => ({
        decision,
        receiptPath,
        receiptSha256,
        reportPath,
        reportSha256,
        reviewerRole,
        scoreBasisPoints,
      })),
      revision: "r1",
    }))
    const pointerBytes = withLf(encodeRestrictedJcsV2({
      authorityId: "collaboration-v11",
      evidencePath: `${root}/review-evidence.json`,
      evidenceSha256: ordinarySha256V2(evidenceBytes),
      format: "convax.collaboration-active-authority-pointer/1",
      manifestPath: `${root}/authority.sha256`,
      manifestSha256,
      previousSelection: {
        authorityId: "collaboration-v10",
        kind: "active-authority",
        pointerPath: "docs/superpowers/specs/collaboration-v10-active-authority.json",
        pointerSha256: "f1b6f1e09dba629ab06530b2e21c6ac451cd4c04c82ed21cd7cabfb9b7e78398",
        revision: "r5",
        sequence: "1",
      },
      revision: "r1",
      sequence: "1",
    }))
    const release = validateSuccessorAuthorityReleaseSnapshotV1({
      activePointerBytes: pointerBytes,
      files: [
        ...(await Promise.all(candidatePaths.map(async (path) => ({ path, bytes: await readTestAuthorityFileV2(path) })))),
        { path: `${root}/review-evidence.json`, bytes: evidenceBytes },
        ...reviews.flatMap(({ receiptPath, receiptBytes, reportPath, reportBytes }) => [
          { path: receiptPath, bytes: receiptBytes },
          { path: reportPath, bytes: reportBytes },
        ]),
      ],
    })
    return selectInstalledProtocolAuthorityV3(release, await loadValidatedTestAuthorityReleaseV2())
  })()
  return verified
}

function withLf(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 1)
  result.set(bytes)
  result[result.byteLength - 1] = 0x0a
  return result
}
