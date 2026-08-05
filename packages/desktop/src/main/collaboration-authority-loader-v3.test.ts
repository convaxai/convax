import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  type AuthorityReleaseSnapshotV1,
  type SuccessorAuthorityReleaseSnapshotV1,
} from "@convax/collaboration"
import {
  loadCollaborationAuthoritiesV3,
  nodeCollaborationAuthoritySnapshotSourceV3,
  type CollaborationAuthoritySnapshotsV3,
} from "./collaboration-authority-loader-v3"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
const currentV10StagedRoot = path.resolve(import.meta.dir, "../..", ".packaging/collaboration-authority")
const v10PointerPath = "docs/superpowers/specs/collaboration-v10-active-authority.json"
const v11PointerPath = "docs/superpowers/specs/collaboration-v11-active-authority.json"
const v10Root = "docs/superpowers/specs/authorities/collaboration-v10/r5"
const v11Root = "docs/superpowers/specs/authorities/collaboration-v11/r1"
const temporaryRoots: string[] = []

const v10Paths = [
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${v10Root}/appendices/canvas-schema.md`,
  `${v10Root}/appendices/collaboration-kernel.md`,
  `${v10Root}/appendices/control-plane.md`,
  `${v10Root}/appendices/project-persistence.md`,
  `${v10Root}/authority.sha256`,
  `${v10Root}/main.md`,
  `${v10Root}/protocol-schema-bundle-v2.json`,
  `${v10Root}/review-evidence.json`,
  `${v10Root}/reviews/canvas-intent-runtime/receipt.json`,
  `${v10Root}/reviews/canvas-intent-runtime/report.md`,
  `${v10Root}/reviews/collaboration-api/receipt.json`,
  `${v10Root}/reviews/collaboration-api/report.md`,
  `${v10Root}/reviews/project-store-reviewer/receipt.json`,
  `${v10Root}/reviews/project-store-reviewer/report.md`,
] as const

const v11CandidatePaths = [
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${v11Root}/appendices/canvas-schema.md`,
  `${v11Root}/appendices/collaboration-kernel.md`,
  `${v11Root}/appendices/control-plane.md`,
  `${v11Root}/appendices/project-persistence.md`,
  `${v11Root}/authority.sha256`,
  `${v11Root}/historical-v10-r5-pin.json`,
  `${v11Root}/main.md`,
  `${v11Root}/protocol-schema-bundle-v3.json`,
] as const

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("Desktop staged V11 authority loader", () => {
  test("fails closed while the current staged product contains no V11 active pointer", async () => {
    await expect(loadCollaborationAuthoritiesV3({ explicitAuthorityRoot: currentV10StagedRoot }))
      .rejects.toThrow("wrong exact inventory")
  })

  test("validates and returns both the pinned historical V2 and reviewed V3 authorities", async () => {
    const snapshots = await reviewedSnapshots()
    const loaded = await loadCollaborationAuthoritiesV3({
      explicitAuthorityRoot: path.resolve("/injected-authority-fixture"),
      source: { async loadSnapshots() { return snapshots } },
    })
    expect(String(loaded.historicalV2.protocolDigest)).toBe("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5")
    expect(String(loaded.successorV3.protocolDigest)).toBe("57d00c135d15339963004535c71770b10a35e301631b96ffc172c265e276ec3f")
    expect(loaded.successorV3.artifactRefs.map((artifact) => artifact.name)).toEqual([
      "canvas-schema", "collaboration-kernel", "control-plane", "project-persistence",
    ])
    expect(loaded.successorV3.historicalAuthority.snapshot).toHaveLength(15)
    expect(String(loaded.successorV3.historicalAuthority.protocolDigest)).toBe(String(loaded.historicalV2.protocolDigest))
  })

  test("rejects relative roots, path aliases and a tampered pinned V10 closure", async () => {
    await expect(loadCollaborationAuthoritiesV3({ explicitAuthorityRoot: "relative" }))
      .rejects.toThrow("explicit absolute")

    const aliased = cloneSnapshots(await reviewedSnapshots())
    aliased.successorV3.files[0]!.path = `./${aliased.successorV3.files[0]!.path}`
    await expect(loadCollaborationAuthoritiesV3({
      explicitAuthorityRoot: path.resolve("/injected-authority-fixture"),
      source: { async loadSnapshots() { return aliased } },
    })).rejects.toMatchObject({ code: "protocol-schema-bundle-unavailable" })

    const tamperedHistorical = cloneSnapshots(await reviewedSnapshots())
    tamperedHistorical.historicalV2.files[1]!.bytes[0] ^= 1
    await expect(loadCollaborationAuthoritiesV3({
      explicitAuthorityRoot: path.resolve("/injected-authority-fixture"),
      source: { async loadSnapshots() { return tamperedHistorical } },
    })).rejects.toMatchObject({ code: "protocol-schema-bundle-unavailable" })
  })

  test("accepts only an exact 0644 regular-file staging tree", async () => {
    const goldenRoot = await materialize(await reviewedSnapshots())
    const loaded = await loadCollaborationAuthoritiesV3({ explicitAuthorityRoot: goldenRoot })
    expect(loaded.successorV3.revision).toBe("r1")

    const modeRoot = await materialize(await reviewedSnapshots())
    await chmod(path.join(modeRoot, v11PointerPath), 0o600)
    await expect(nodeCollaborationAuthoritySnapshotSourceV3.loadSnapshots(modeRoot))
      .rejects.toThrow("mode must be 0644")

    const symlinkRoot = await materialize(await reviewedSnapshots())
    await rm(path.join(symlinkRoot, v11PointerPath))
    await symlink(path.join(symlinkRoot, v10PointerPath), path.join(symlinkRoot, v11PointerPath))
    await expect(nodeCollaborationAuthoritySnapshotSourceV3.loadSnapshots(symlinkRoot))
      .rejects.toThrow("contains a symlink")

    const inventoryRoot = await materialize(await reviewedSnapshots())
    await mkdir(path.join(inventoryRoot, "unexpected-empty-directory"))
    await expect(nodeCollaborationAuthoritySnapshotSourceV3.loadSnapshots(inventoryRoot))
      .rejects.toThrow("wrong directory inventory")

    const oversizedRoot = await materialize(await reviewedSnapshots())
    await truncate(path.join(oversizedRoot, `${v11Root}/main.md`), 4 * 1024 * 1024 + 1)
    await expect(nodeCollaborationAuthoritySnapshotSourceV3.loadSnapshots(oversizedRoot))
      .rejects.toThrow("file exceeds its size bound")
  })
})

async function reviewedSnapshots(): Promise<CollaborationAuthoritySnapshotsV3> {
  const historicalV2: AuthorityReleaseSnapshotV1 = {
    activePointerBytes: await bytesFromRepository(v10PointerPath),
    files: await Promise.all(v10Paths.map(async (filePath) => ({
      path: filePath,
      bytes: await bytesFromRepository(filePath),
    }))),
  }
  return { historicalV2, successorV3: await reviewedSuccessorFixture() }
}

async function reviewedSuccessorFixture(): Promise<SuccessorAuthorityReleaseSnapshotV1> {
  const candidate = await Promise.all(v11CandidatePaths.map(async (filePath) => ({
    path: filePath,
    bytes: await bytesFromRepository(filePath),
  })))
  const reviewers = [
    { role: "canvas-intent-runtime", directory: "canvas-intent-runtime" },
    { role: "collaboration-control-protocol", directory: "collaboration-control-protocol" },
    { role: "project-native-store", directory: "project-native-store" },
  ] as const
  const reviews = reviewers.map(({ role, directory }, index) => {
    const reportPath = `${v11Root}/reviews/${directory}/report.md`
    const receiptPath = `${v11Root}/reviews/${directory}/receipt.json`
    const reportBytes = new TextEncoder().encode(`# ${role}\n\nUNCONDITIONAL SIGN\n`)
    const reportSha256 = ordinarySha256V2(reportBytes)
    const scoreBasisPoints = 900 + index
    const receiptBytes = withLf(encodeRestrictedJcsV2({
      authorityId: "collaboration-v11",
      decision: "UNCONDITIONAL SIGN",
      format: "convax.collaboration-authority-review-receipt/2",
      manifestPath: `${v11Root}/authority.sha256`,
      manifestSha256: "a9215ca975a604f6ffa2aae6afd52730006ca54030a4350ecbdf0c2ab71b9cba",
      protocolBundlePath: `${v11Root}/protocol-schema-bundle-v3.json`,
      protocolBundleSha256: "176290fd43531506d8ab74592f4a8102835a9d50a77d4ae0571e2bd6557c4474",
      protocolDigest: "57d00c135d15339963004535c71770b10a35e301631b96ffc172c265e276ec3f",
      reportPath,
      reportSha256,
      reviewerRole: role,
      revision: "r1",
      scoreBasisPoints,
    }))
    return { receiptPath, receiptBytes, reportPath, reportBytes, reportSha256, role, scoreBasisPoints }
  })
  const evidenceBytes = withLf(encodeRestrictedJcsV2({
    authorityId: "collaboration-v11",
    decision: "UNCONDITIONAL 3/3 SIGN",
    format: "convax.collaboration-authority-review-evidence/2",
    manifestPath: `${v11Root}/authority.sha256`,
    manifestSha256: "a9215ca975a604f6ffa2aae6afd52730006ca54030a4350ecbdf0c2ab71b9cba",
    protocolBundleSha256: "176290fd43531506d8ab74592f4a8102835a9d50a77d4ae0571e2bd6557c4474",
    protocolDigest: "57d00c135d15339963004535c71770b10a35e301631b96ffc172c265e276ec3f",
    reviews: reviews.map((review) => ({
      decision: "UNCONDITIONAL SIGN",
      receiptPath: review.receiptPath,
      receiptSha256: ordinarySha256V2(review.receiptBytes),
      reportPath: review.reportPath,
      reportSha256: review.reportSha256,
      reviewerRole: review.role,
      scoreBasisPoints: review.scoreBasisPoints,
    })),
    revision: "r1",
  }))
  const pointerBytes = withLf(encodeRestrictedJcsV2({
    authorityId: "collaboration-v11",
    evidencePath: `${v11Root}/review-evidence.json`,
    evidenceSha256: ordinarySha256V2(evidenceBytes),
    format: "convax.collaboration-active-authority-pointer/1",
    manifestPath: `${v11Root}/authority.sha256`,
    manifestSha256: "a9215ca975a604f6ffa2aae6afd52730006ca54030a4350ecbdf0c2ab71b9cba",
    previousSelection: {
      authorityId: "collaboration-v10",
      kind: "active-authority",
      pointerPath: v10PointerPath,
      pointerSha256: "f1b6f1e09dba629ab06530b2e21c6ac451cd4c04c82ed21cd7cabfb9b7e78398",
      revision: "r5",
      sequence: "1",
    },
    revision: "r1",
    sequence: "1",
  }))
  return {
    activePointerBytes: pointerBytes,
    files: [
      ...candidate,
      { path: `${v11Root}/review-evidence.json`, bytes: evidenceBytes },
      ...reviews.flatMap((review) => [
        { path: review.receiptPath, bytes: review.receiptBytes },
        { path: review.reportPath, bytes: review.reportBytes },
      ]),
    ],
  }
}

async function materialize(snapshots: CollaborationAuthoritySnapshotsV3): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "convax-v11-authority-"))
  temporaryRoots.push(root)
  const files = new Map<string, Uint8Array>([
    [v10PointerPath, Uint8Array.from(snapshots.historicalV2.activePointerBytes)],
    [v11PointerPath, Uint8Array.from(snapshots.successorV3.activePointerBytes)],
  ])
  for (const file of [...snapshots.historicalV2.files, ...snapshots.successorV3.files]) {
    const existing = files.get(file.path)
    if (existing !== undefined && !sameBytes(existing, file.bytes)) throw new Error(`fixture collision at ${file.path}`)
    files.set(file.path, Uint8Array.from(file.bytes))
  }
  for (const [filePath, bytes] of files) {
    const absolute = path.join(root, filePath)
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, bytes, { mode: 0o644 })
    await chmod(absolute, 0o644)
  }
  return root
}

function cloneSnapshots(value: CollaborationAuthoritySnapshotsV3): {
  historicalV2: { activePointerBytes: Uint8Array; files: { path: string; bytes: Uint8Array }[] }
  successorV3: { activePointerBytes: Uint8Array; files: { path: string; bytes: Uint8Array }[] }
} {
  const clone = (snapshot: AuthorityReleaseSnapshotV1 | SuccessorAuthorityReleaseSnapshotV1) => ({
    activePointerBytes: Uint8Array.from(snapshot.activePointerBytes),
    files: snapshot.files.map((file) => ({ path: file.path, bytes: Uint8Array.from(file.bytes) })),
  })
  return { historicalV2: clone(value.historicalV2), successorV3: clone(value.successorV3) }
}

async function bytesFromRepository(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(repositoryRoot, filePath)))
}

function withLf(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 1)
  result.set(bytes)
  result[result.byteLength - 1] = 0x0a
  return result
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}
