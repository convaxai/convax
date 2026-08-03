import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  selectInstalledProtocolAuthorityV2,
  validateAuthorityReleaseSnapshotV1,
  type AuthorityReleaseSnapshotV1,
} from "./authority-selector"
import { encodeRestrictedJcsV2 } from "./jcs"
import { parseDigestV2 } from "./codecs"

const repositoryRoot = join(import.meta.dir, "../../..")
const authorityRoot = "docs/superpowers/specs/authorities/collaboration-v10/r5"
const paths = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${authorityRoot}/appendices/canvas-schema.md`,
  `${authorityRoot}/appendices/collaboration-kernel.md`,
  `${authorityRoot}/appendices/control-plane.md`,
  `${authorityRoot}/appendices/project-persistence.md`,
  `${authorityRoot}/authority.sha256`,
  `${authorityRoot}/main.md`,
  `${authorityRoot}/protocol-schema-bundle-v2.json`,
  `${authorityRoot}/review-evidence.json`,
  `${authorityRoot}/reviews/canvas-intent-runtime/receipt.json`,
  `${authorityRoot}/reviews/canvas-intent-runtime/report.md`,
  `${authorityRoot}/reviews/collaboration-api/receipt.json`,
  `${authorityRoot}/reviews/collaboration-api/report.md`,
  `${authorityRoot}/reviews/project-store-reviewer/receipt.json`,
  `${authorityRoot}/reviews/project-store-reviewer/report.md`,
])

describe("R5 authority release selector", () => {
  test("validates the exact copy-owned release and installs one private live identity", async () => {
    const snapshot = await goldenSnapshot()
    const validated = validateAuthorityReleaseSnapshotV1(snapshot)

    expect(Object.isFrozen(validated)).toBe(true)
    expect(validated).toEqual({
      format: "convax.validated-authority-release/1",
      authorityId: "collaboration-v10",
      revision: "r5",
      sequence: "1",
      activePointerSha256: "f1b6f1e09dba629ab06530b2e21c6ac451cd4c04c82ed21cd7cabfb9b7e78398",
      manifestSha256: "2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed",
      evidenceSha256: "9a781faaa3ed28963066ba3ef28eb4367611568042bb14929feab5c2c884d678",
      protocolBundleSha256: "163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786",
      protocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5",
    })
    const selected = selectInstalledProtocolAuthorityV2(validated)
    expect(selected.protocolDigest).toBe(parseDigestV2(validated.protocolDigest))
    expect(selectInstalledProtocolAuthorityV2(validated)).toBe(selected)
    expect(() => selectInstalledProtocolAuthorityV2({ ...validated })).toThrow()
  })

  test("rejects missing, extra, unsorted, aliased and tampered authority bytes with one public code", async () => {
    const golden = await goldenSnapshot()
    const hostiles: AuthorityReleaseSnapshotV1[] = [
      { ...cloneSnapshot(golden), files: cloneSnapshot(golden).files.slice(0, -1) },
      { ...cloneSnapshot(golden), files: [...cloneSnapshot(golden).files, cloneSnapshot(golden).files[0]!] },
      swapFiles(cloneSnapshot(golden), 0, 1),
      replacePath(cloneSnapshot(golden), 0, `./${paths[0]}`),
      mutatePointer(cloneSnapshot(golden)),
      mutateFile(cloneSnapshot(golden), 1),
      mutateFile(cloneSnapshot(golden), 5),
      mutateFile(cloneSnapshot(golden), 7),
      mutateFile(cloneSnapshot(golden), 8),
      mutateFile(cloneSnapshot(golden), 9),
      mutateFile(cloneSnapshot(golden), 10),
    ]

    for (const hostile of hostiles) {
      try {
        validateAuthorityReleaseSnapshotV1(hostile)
        throw new Error("hostile authority snapshot was accepted")
      } catch (error) {
        expect((error as { code?: unknown }).code).toBe("protocol-schema-bundle-unavailable")
      }
    }
  })

  test("does not retain borrowed pointer, path-array or file bytes", async () => {
    const borrowed = await goldenSnapshot()
    const validated = validateAuthorityReleaseSnapshotV1(borrowed)
    const before = JSON.stringify(validated)

    borrowed.activePointerBytes[0] = 0
    borrowed.files[0]!.bytes[0] = 0
    ;(borrowed.files as { path: string; bytes: Uint8Array }[]).reverse()

    expect(JSON.stringify(validated)).toBe(before)
    expect(Object.isFrozen(validated)).toBe(true)
    expect(selectInstalledProtocolAuthorityV2(validated).protocolDigest).toBe(parseDigestV2(validated.protocolDigest))
  })
})

async function goldenSnapshot(): Promise<{ activePointerBytes: Uint8Array; files: { path: string; bytes: Uint8Array }[] }> {
  const files = await Promise.all(paths.map(async (path) => ({
    path,
    bytes: new Uint8Array(await Bun.file(join(repositoryRoot, path)).arrayBuffer()),
  })))
  return { activePointerBytes: withLf(encodeRestrictedJcsV2({
    authorityId: "collaboration-v10",
    evidencePath: `${authorityRoot}/review-evidence.json`,
    evidenceSha256: "9a781faaa3ed28963066ba3ef28eb4367611568042bb14929feab5c2c884d678",
    format: "convax.collaboration-active-authority-pointer/1",
    manifestPath: `${authorityRoot}/authority.sha256`,
    manifestSha256: "2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed",
    previousSelection: {
      kind: "legacy-manifest",
      manifestPath: "docs/superpowers/specs/2026-08-01-p2p-v10-authority.sha256",
      manifestSha256: "68a78f5ffdf3222667aaa213a492c3b79db6133f2206da1067a4976138edbcde",
    },
    revision: "r5",
    sequence: "1",
  })), files }
}

function withLf(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 1)
  result.set(bytes)
  result[result.length - 1] = 0x0a
  return result
}

function cloneSnapshot(snapshot: AuthorityReleaseSnapshotV1): { activePointerBytes: Uint8Array; files: { path: string; bytes: Uint8Array }[] } {
  return {
    activePointerBytes: Uint8Array.from(snapshot.activePointerBytes),
    files: snapshot.files.map((file) => ({ path: file.path, bytes: Uint8Array.from(file.bytes) })),
  }
}

function mutatePointer(snapshot: ReturnType<typeof cloneSnapshot>): ReturnType<typeof cloneSnapshot> {
  snapshot.activePointerBytes[0] ^= 1
  return snapshot
}

function mutateFile(snapshot: ReturnType<typeof cloneSnapshot>, index: number): ReturnType<typeof cloneSnapshot> {
  snapshot.files[index]!.bytes[0] ^= 1
  return snapshot
}

function swapFiles(snapshot: ReturnType<typeof cloneSnapshot>, left: number, right: number): ReturnType<typeof cloneSnapshot> {
  const value = snapshot.files[left]!
  snapshot.files[left] = snapshot.files[right]!
  snapshot.files[right] = value
  return snapshot
}

function replacePath(snapshot: ReturnType<typeof cloneSnapshot>, index: number, path: string): ReturnType<typeof cloneSnapshot> {
  snapshot.files[index] = { ...snapshot.files[index]!, path }
  return snapshot
}
