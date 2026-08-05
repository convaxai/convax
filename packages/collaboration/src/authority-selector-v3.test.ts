import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  selectInstalledProtocolAuthorityV3,
  validateSuccessorAuthorityCandidateSnapshotV1,
  validateSuccessorAuthorityReleaseSnapshotV1,
  type SuccessorAuthorityCandidateSnapshotV1,
} from "./authority-selector-v3"
import { validateAuthorityReleaseSnapshotV1 } from "./authority-selector"
import { encodeRestrictedJcsV2 } from "./jcs"

const repositoryRoot = join(import.meta.dir, "../../..")
const root = "docs/superpowers/specs/authorities/collaboration-v11/r1"
const pointerPath = "docs/superpowers/specs/collaboration-v11-active-authority.json"
const manifestSha256 = "351634036ae88bbe843430bb11b3e9d46e6b9bcd865df4aaf55e50fe55dfb1b4"
const protocolBundleSha256 = "180199f3e77e5f4daa9c914f97b8e9a08293ba70e201656efe3bd0c10af70d6c"
const protocolDigest = "5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f"
const paths = [
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${root}/appendices/canvas-schema.md`,
  `${root}/appendices/collaboration-kernel.md`,
  `${root}/appendices/control-plane.md`,
  `${root}/appendices/project-persistence.md`,
  `${root}/authority.sha256`,
  `${root}/historical-v10-r5-pin.json`,
  `${root}/main.md`,
  `${root}/protocol-schema-bundle-v3.json`,
] as const
const releasePaths = [
  ...paths,
  `${root}/review-evidence.json`,
  `${root}/reviews/canvas-intent-runtime/receipt.json`,
  `${root}/reviews/canvas-intent-runtime/report.md`,
  `${root}/reviews/collaboration-control-protocol/receipt.json`,
  `${root}/reviews/collaboration-control-protocol/report.md`,
  `${root}/reviews/project-native-store/receipt.json`,
  `${root}/reviews/project-native-store/report.md`,
] as const

describe("V11/R1 successor authority candidate", () => {
  test("validates the exact frozen candidate and copies borrowed bytes", async () => {
    const candidate = await fixture()
    const validated = validateSuccessorAuthorityCandidateSnapshotV1(candidate)
    expect(validated).toEqual({
      format: "convax.validated-authority-candidate/1",
      authorityId: "collaboration-v11",
      revision: "r1",
      manifestSha256,
      protocolBundleSha256,
      protocolDigest,
      historicalProtocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5",
    })
    candidate.files[0]!.bytes[0] ^= 1
    expect(validated.protocolDigest).toBe(protocolDigest)
  })

  test("rejects missing, extra, order, path alias and tampered bytes with one code", async () => {
    const golden = await fixture()
    const cases: SuccessorAuthorityCandidateSnapshotV1[] = [
      { files: clone(golden).files.slice(0, -1) },
      { files: [...clone(golden).files, clone(golden).files[0]!] },
      swap(clone(golden), 0, 1),
      replacePath(clone(golden), 0, `./${paths[0]}`),
      mutate(clone(golden), 1),
      mutate(clone(golden), 5),
      mutate(clone(golden), 6),
      mutate(clone(golden), 8),
    ]
    for (const hostile of cases) {
      try {
        validateSuccessorAuthorityCandidateSnapshotV1(hostile)
        throw new Error("hostile candidate accepted")
      } catch (error) {
        expect((error as { code?: unknown }).code).toBe("protocol-schema-bundle-unavailable")
      }
    }
  })

  test("does not activate V3 without the exact active pointer and 3/3 evidence closure", async () => {
    const candidate = await fixture()
    expect(() => validateSuccessorAuthorityReleaseSnapshotV1({
      activePointerBytes: new TextEncoder().encode("{}\n"),
      files: candidate.files,
    })).toThrow()
  })

  test("accepts only the exact active pointer CAS and exact 3/3 evidence order", async () => {
    const release = await reviewedFixture()
    const { pointer, ...snapshot } = release
    const validated = validateSuccessorAuthorityReleaseSnapshotV1(snapshot)
    expect(validated.sequence).toBe("1")
    expect(validated.authorityId).toBe("collaboration-v11")

    const wrongCas = { ...snapshot, activePointerBytes: withLf(encodeRestrictedJcsV2({
      ...pointer,
      previousSelection: { ...pointer.previousSelection, pointerSha256: "0".repeat(64) },
    })) }
    expect(() => validateSuccessorAuthorityReleaseSnapshotV1(wrongCas)).toThrow()

    const reordered = { ...snapshot, files: [...snapshot.files] }
    const last = reordered.files.at(-1)!
    reordered.files[reordered.files.length - 1] = reordered.files[reordered.files.length - 2]!
    reordered.files[reordered.files.length - 2] = last
    expect(() => validateSuccessorAuthorityReleaseSnapshotV1(reordered)).toThrow()
  })

  test("installs a copy-owned four-artifact V11 closure plus the complete live R5 dependency", async () => {
    const release = await reviewedFixture()
    const { pointer: _pointer, ...snapshot } = release
    const validated = validateSuccessorAuthorityReleaseSnapshotV1(snapshot)
    const historical = validateAuthorityReleaseSnapshotV1(await historicalFixture())
    const authority = selectInstalledProtocolAuthorityV3(validated, historical)

    expect(authority.artifactRefs.map(({ name }) => name)).toEqual([
      "canvas-schema", "collaboration-kernel", "control-plane", "project-persistence",
    ])
    expect(authority.historicalAuthority.snapshot).toHaveLength(15)
    expect(String(authority.historicalAuthority.protocolDigest)).toBe(historical.protocolDigest)
    expect(Object.isFrozen(authority.artifactRefs)).toBe(true)
    expect(Object.isFrozen(authority.historicalAuthority.snapshot)).toBe(true)
    snapshot.files[1]!.bytes.fill(0)
    expect(String(authority.artifactRefs[0]!.artifactDigest)).toBe("f75341f2b4d6685ade2708c4a843dddc4cd4c573c981e8cfed0f54c4093533ee")
  })
})

async function fixture(): Promise<{ files: { path: string; bytes: Uint8Array }[] }> {
  return {
    files: await Promise.all(paths.map(async (path) => ({
      path,
      bytes: new Uint8Array(await Bun.file(join(repositoryRoot, path)).arrayBuffer()),
    }))),
  }
}

function clone(value: SuccessorAuthorityCandidateSnapshotV1): { files: { path: string; bytes: Uint8Array }[] } {
  return { files: value.files.map((file) => ({ path: file.path, bytes: Uint8Array.from(file.bytes) })) }
}

function mutate(value: ReturnType<typeof clone>, index: number): ReturnType<typeof clone> {
  value.files[index]!.bytes[0] ^= 1
  return value
}

function swap(value: ReturnType<typeof clone>, left: number, right: number): ReturnType<typeof clone> {
  const item = value.files[left]!
  value.files[left] = value.files[right]!
  value.files[right] = item
  return value
}

function withLf(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from([...bytes, 0x0a])
}

function replacePath(value: ReturnType<typeof clone>, index: number, path: string): ReturnType<typeof clone> {
  value.files[index] = { ...value.files[index]!, path }
  return value
}

async function reviewedFixture() {
  const activePointerBytes = await readRepositoryFile(pointerPath)
  const pointer = JSON.parse(new TextDecoder().decode(activePointerBytes)) as {
    readonly previousSelection: { readonly pointerSha256: string }
  }
  return {
    activePointerBytes,
    files: await Promise.all(releasePaths.map(async (path) => ({ path, bytes: await readRepositoryFile(path) }))),
    pointer,
  }
}

async function readRepositoryFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(join(repositoryRoot, path)).arrayBuffer())
}

async function historicalFixture() {
  const historicalRoot = "docs/superpowers/specs/authorities/collaboration-v10/r5"
  const historicalPaths = [
    "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
    `${historicalRoot}/appendices/canvas-schema.md`,
    `${historicalRoot}/appendices/collaboration-kernel.md`,
    `${historicalRoot}/appendices/control-plane.md`,
    `${historicalRoot}/appendices/project-persistence.md`,
    `${historicalRoot}/authority.sha256`,
    `${historicalRoot}/main.md`,
    `${historicalRoot}/protocol-schema-bundle-v2.json`,
    `${historicalRoot}/review-evidence.json`,
    `${historicalRoot}/reviews/canvas-intent-runtime/receipt.json`,
    `${historicalRoot}/reviews/canvas-intent-runtime/report.md`,
    `${historicalRoot}/reviews/collaboration-api/receipt.json`,
    `${historicalRoot}/reviews/collaboration-api/report.md`,
    `${historicalRoot}/reviews/project-store-reviewer/receipt.json`,
    `${historicalRoot}/reviews/project-store-reviewer/report.md`,
  ]
  return {
    activePointerBytes: new Uint8Array(await Bun.file(join(repositoryRoot, "docs/superpowers/specs/collaboration-v10-active-authority.json")).arrayBuffer()),
    files: await Promise.all(historicalPaths.map(async (path) => ({
      path,
      bytes: new Uint8Array(await Bun.file(join(repositoryRoot, path)).arrayBuffer()),
    }))),
  }
}
