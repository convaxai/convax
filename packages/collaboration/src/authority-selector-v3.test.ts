import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  selectInstalledProtocolAuthorityV3,
  validateSuccessorAuthorityCandidateSnapshotV1,
  validateSuccessorAuthorityReleaseSnapshotV1,
  type SuccessorAuthorityCandidateSnapshotV1,
} from "./authority-selector-v3"
import { validateAuthorityReleaseSnapshotV1 } from "./authority-selector"
import { ordinarySha256V2 } from "./digest"
import { encodeRestrictedJcsV2 } from "./jcs"

const repositoryRoot = join(import.meta.dir, "../../..")
const root = "docs/superpowers/specs/authorities/collaboration-v11/r1"
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

describe("V11/R1 successor authority candidate", () => {
  test("validates the exact inactive candidate and copies borrowed bytes", async () => {
    const candidate = await fixture()
    const validated = validateSuccessorAuthorityCandidateSnapshotV1(candidate)
    expect(validated).toEqual({
      format: "convax.validated-authority-candidate/1",
      authorityId: "collaboration-v11",
      revision: "r1",
      manifestSha256: "7d16f8d267869e317dca1bd2a1a2ee8bac95b4ca46cf952cf9dde6cab8170ab1",
      protocolBundleSha256: "928bfc9f30ec3cc2c680879b4e893cb483b855b4d877125befbe1574097cb4e6",
      protocolDigest: "471c7cc66bc89be61fd79d20aae46bb46cc5b737adc2b576f58423dafffc42e4",
      historicalProtocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5",
    })
    candidate.files[0]!.bytes[0] ^= 1
    expect(validated.protocolDigest).toBe("471c7cc66bc89be61fd79d20aae46bb46cc5b737adc2b576f58423dafffc42e4")
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

  test("does not activate V3 without the future exact pointer and 3/3 evidence closure", async () => {
    const candidate = await fixture()
    expect(() => validateSuccessorAuthorityReleaseSnapshotV1({
      activePointerBytes: new TextEncoder().encode("{}\n"),
      files: candidate.files,
    })).toThrow()
  })

  test("accepts only the exact future pointer CAS and exact 3/3 evidence order", async () => {
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
    expect(String(authority.artifactRefs[0]!.artifactDigest)).toBe("b36c8ea5155b4d3c42bf6ee3bd588334631ad3e8ae3df4a9a19bd3db24d82955")
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

function replacePath(value: ReturnType<typeof clone>, index: number, path: string): ReturnType<typeof clone> {
  value.files[index] = { ...value.files[index]!, path }
  return value
}

async function reviewedFixture() {
  const candidate = await fixture()
  const reviewers = [
    { role: "canvas-intent-runtime", directory: "canvas-intent-runtime" },
    { role: "collaboration-control-protocol", directory: "collaboration-control-protocol" },
    { role: "project-native-store", directory: "project-native-store" },
  ] as const
  const reviews = reviewers.map(({ role, directory }, index) => {
    const reportPath = `${root}/reviews/${directory}/report.md`
    const receiptPath = `${root}/reviews/${directory}/receipt.json`
    const reportBytes = new TextEncoder().encode(`# ${role}\n\nUNCONDITIONAL SIGN\n`)
    const reportSha256 = ordinarySha256V2(reportBytes)
    const receiptBytes = withLf(encodeRestrictedJcsV2({
      authorityId: "collaboration-v11",
      decision: "UNCONDITIONAL SIGN",
      format: "convax.collaboration-authority-review-receipt/2",
      manifestPath: `${root}/authority.sha256`,
      manifestSha256: "7d16f8d267869e317dca1bd2a1a2ee8bac95b4ca46cf952cf9dde6cab8170ab1",
      protocolBundlePath: `${root}/protocol-schema-bundle-v3.json`,
      protocolBundleSha256: "928bfc9f30ec3cc2c680879b4e893cb483b855b4d877125befbe1574097cb4e6",
      protocolDigest: "471c7cc66bc89be61fd79d20aae46bb46cc5b737adc2b576f58423dafffc42e4",
      reportPath,
      reportSha256,
      reviewerRole: role,
      revision: "r1",
      scoreBasisPoints: 900 + index,
    }))
    return { role, reportPath, receiptPath, reportBytes, reportSha256, receiptBytes, receiptSha256: ordinarySha256V2(receiptBytes), scoreBasisPoints: 900 + index }
  })
  const evidenceBytes = withLf(encodeRestrictedJcsV2({
    authorityId: "collaboration-v11",
    decision: "UNCONDITIONAL 3/3 SIGN",
    format: "convax.collaboration-authority-review-evidence/2",
    manifestPath: `${root}/authority.sha256`,
    manifestSha256: "7d16f8d267869e317dca1bd2a1a2ee8bac95b4ca46cf952cf9dde6cab8170ab1",
    protocolBundleSha256: "928bfc9f30ec3cc2c680879b4e893cb483b855b4d877125befbe1574097cb4e6",
    protocolDigest: "471c7cc66bc89be61fd79d20aae46bb46cc5b737adc2b576f58423dafffc42e4",
    reviews: reviews.map((review) => ({
      decision: "UNCONDITIONAL SIGN",
      receiptPath: review.receiptPath,
      receiptSha256: review.receiptSha256,
      reportPath: review.reportPath,
      reportSha256: review.reportSha256,
      reviewerRole: review.role,
      scoreBasisPoints: review.scoreBasisPoints,
    })),
    revision: "r1",
  }))
  const pointer = {
    authorityId: "collaboration-v11",
    evidencePath: `${root}/review-evidence.json`,
    evidenceSha256: ordinarySha256V2(evidenceBytes),
    format: "convax.collaboration-active-authority-pointer/1",
    manifestPath: `${root}/authority.sha256`,
    manifestSha256: "7d16f8d267869e317dca1bd2a1a2ee8bac95b4ca46cf952cf9dde6cab8170ab1",
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
  }
  return {
    activePointerBytes: withLf(encodeRestrictedJcsV2(pointer)),
    files: [
      ...candidate.files,
      { path: `${root}/review-evidence.json`, bytes: evidenceBytes },
      ...reviews.flatMap((review) => [
        { path: review.receiptPath, bytes: review.receiptBytes },
        { path: review.reportPath, bytes: review.reportBytes },
      ]),
    ],
    pointer,
  }
}

function withLf(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 1)
  result.set(bytes)
  result[result.byteLength - 1] = 0x0a
  return result
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
