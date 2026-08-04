import {
  selectInstalledProtocolAuthorityV2,
  validateAuthorityReleaseSnapshotV1,
  type AuthorityReleaseSnapshotV1,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"

const paths = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/main.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md",
] as const)

let selected: Promise<VerifiedProtocolAuthorityV2> | null = null

export function loadApiTestProtocolAuthorityV2(): Promise<VerifiedProtocolAuthorityV2> {
  selected ??= load()
  return selected
}

async function load(): Promise<VerifiedProtocolAuthorityV2> {
  const snapshot: AuthorityReleaseSnapshotV1 = {
    activePointerBytes: await bytes("docs/superpowers/specs/collaboration-v10-active-authority.json"),
    files: await Promise.all(paths.map(async (path) => Object.freeze({ path, bytes: await bytes(path) }))),
  }
  return selectInstalledProtocolAuthorityV2(validateAuthorityReleaseSnapshotV1(snapshot))
}

async function bytes(path: string): Promise<Uint8Array> {
  const rootRelative = new URL(`../../../${path}`, import.meta.url)
  return new Uint8Array(await Bun.file(rootRelative).arrayBuffer())
}
