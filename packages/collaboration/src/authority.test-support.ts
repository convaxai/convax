import {
  selectInstalledProtocolAuthorityV2,
  validateAuthorityReleaseSnapshotV1,
} from "./authority-selector"
import type { VerifiedProtocolAuthorityV2 } from "./authority"

const activePointer = "docs/superpowers/specs/collaboration-v10-active-authority.json"
const paths = Object.freeze({
  canonicalMain: "docs/superpowers/specs/authorities/collaboration-v10/r5/main.md",
  canvasSchema: "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md",
  collaborationKernel: "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md",
  controlPlane: "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md",
  projectPersistence: "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md",
})

const releasePaths = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  paths.canvasSchema,
  paths.collaborationKernel,
  paths.controlPlane,
  paths.projectPersistence,
  "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256",
  paths.canonicalMain,
  "docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json",
  "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md",
])

let verified: Promise<VerifiedProtocolAuthorityV2> | undefined

export function loadVerifiedTestAuthorityV2(): Promise<VerifiedProtocolAuthorityV2> {
  verified ??= (async () => {
    const validated = validateAuthorityReleaseSnapshotV1({
      activePointerBytes: await readTestAuthorityFileV2(activePointer),
      files: await Promise.all(
        releasePaths.map(async (path) => ({ path, bytes: await readTestAuthorityFileV2(path) })),
      ),
    })
    return selectInstalledProtocolAuthorityV2(validated)
  })()
  return verified
}

export async function readTestAuthorityFileV2(relativeFromRepository: string): Promise<Uint8Array> {
  const configuredRoot = process.env.CONVAX_R5_AUTHORITY_ROOT
  const location = configuredRoot
    ? `${configuredRoot.replace(/\/$/u, "")}/${relativeFromRepository}`
    : new URL(`../../../${relativeFromRepository}`, import.meta.url)
  return new Uint8Array(await Bun.file(location).arrayBuffer())
}

export { activePointer as TEST_ACTIVE_POINTER_PATH_V2, paths as TEST_AUTHORITY_PATHS_V2, releasePaths as TEST_RELEASE_PATHS_V2 }
