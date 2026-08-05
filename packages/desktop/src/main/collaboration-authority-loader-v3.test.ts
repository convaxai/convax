import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  type AuthorityReleaseSnapshotV1,
  type SuccessorAuthorityReleaseSnapshotV1,
} from "@convax/collaboration"
import {
  loadCollaborationAuthoritiesV3,
  nodeCollaborationAuthoritySnapshotSourceV3,
  type CollaborationAuthoritySnapshotsV3,
} from "./collaboration-authority-loader-v3"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
const activeStagedRoot = path.resolve(import.meta.dir, "../..", ".packaging/collaboration-authority")
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

const v11Paths = [
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${v11Root}/appendices/canvas-schema.md`,
  `${v11Root}/appendices/collaboration-kernel.md`,
  `${v11Root}/appendices/control-plane.md`,
  `${v11Root}/appendices/project-persistence.md`,
  `${v11Root}/authority.sha256`,
  `${v11Root}/historical-v10-r5-pin.json`,
  `${v11Root}/main.md`,
  `${v11Root}/protocol-schema-bundle-v3.json`,
  `${v11Root}/review-evidence.json`,
  `${v11Root}/reviews/canvas-intent-runtime/receipt.json`,
  `${v11Root}/reviews/canvas-intent-runtime/report.md`,
  `${v11Root}/reviews/collaboration-control-protocol/receipt.json`,
  `${v11Root}/reviews/collaboration-control-protocol/report.md`,
  `${v11Root}/reviews/project-native-store/receipt.json`,
  `${v11Root}/reviews/project-native-store/report.md`,
] as const

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("Desktop staged V11 authority loader", () => {
  test("loads the exact active V11 release and its pinned historical V10 closure", async () => {
    const loaded = await loadCollaborationAuthoritiesV3({ explicitAuthorityRoot: activeStagedRoot })
    expect(String(loaded.successorV3.protocolDigest)).toBe("5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f")
    expect(String(loaded.historicalV2.protocolDigest)).toBe("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5")
  })

  test("validates and returns both the pinned historical V2 and reviewed V3 authorities", async () => {
    const snapshots = await reviewedSnapshots()
    const loaded = await loadCollaborationAuthoritiesV3({
      explicitAuthorityRoot: path.resolve("/injected-authority-fixture"),
      source: { async loadSnapshots() { return snapshots } },
    })
    expect(String(loaded.historicalV2.protocolDigest)).toBe("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5")
    expect(String(loaded.successorV3.protocolDigest)).toBe("5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f")
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
  return {
    activePointerBytes: await bytesFromRepository(v11PointerPath),
    files: await Promise.all(v11Paths.map(async (filePath) => ({
      path: filePath,
      bytes: await bytesFromRepository(filePath),
    }))),
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

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}
