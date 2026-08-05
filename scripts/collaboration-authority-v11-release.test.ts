import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  ACTIVE_AUTHORITY_POINTER_PATH,
  AUTHORITY_SNAPSHOT_PATHS,
  type CollaborationAuthorityReleaseHostV1,
  type GitAuthorityEntryV1,
  type WorktreeAuthorityEntryV1,
} from "./collaboration-authority-release"
import {
  V11_ACTIVE_AUTHORITY_POINTER_PATH,
  V11_CANDIDATE_PATHS,
  V11_RELEASE_DIRECTORY,
  V11_REVIEWED_RELEASE_PATHS,
  V11_REVIEWERS,
  assembleSuccessorReviewEvidenceWithHostV1,
  buildInitialSuccessorAuthorityPointerV1,
  promoteInitialSuccessorAuthorityReleaseWithHostV1,
  verifyActiveSuccessorAuthorityReleaseWithHostV1,
  verifyInactiveSuccessorAuthorityCandidateWithHostV1,
  verifyReviewedSuccessorAuthorityReleaseWithHostV1,
} from "./collaboration-authority-v11-release"

const repositoryRoot = join(import.meta.dir, "..")
const V11_PROTOCOL_DIGEST = "5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f"

class FakeHost implements CollaborationAuthorityReleaseHostV1 {
  readonly worktree = new Map<string, WorktreeAuthorityEntryV1>()
  readonly gitTrees = new Map<string, Map<string, GitAuthorityEntryV1>>()
  readonly parents = new Map<string, string | null>()
  extraFiles: string[] = []

  readWorktreeEntry(path: string): WorktreeAuthorityEntryV1 | null { return this.worktree.get(path) ?? null }
  listWorktreeFiles(directory: string): readonly string[] {
    return [...this.worktree.keys(), ...this.extraFiles].filter((path) => path.startsWith(`${directory}/`))
  }
  readGitEntry(ref: string, path: string): GitAuthorityEntryV1 | null { return this.gitTrees.get(ref)?.get(path) ?? null }
  firstParent(ref: string): string | null {
    if (!this.parents.has(ref)) throw new Error(`unknown ref ${ref}`)
    return this.parents.get(ref) ?? null
  }
  createWorktreeFileExclusive(path: string, value: Readonly<Uint8Array>): void {
    if (this.worktree.has(path)) throw new Error(`exclusive write collision ${path}`)
    this.worktree.set(path, regular(new Uint8Array(value)))
  }
}

describe("inactive V11/R1 freeze verifier", () => {
  test("accepts an absent pointer, exact R5 pin and sealed V11 descendant", () => {
    const host = fixture()
    expect(verifyInactiveSuccessorAuthorityCandidateWithHostV1(host, "HEAD").protocolDigest)
      .toBe(V11_PROTOCOL_DIGEST)
  })

  test("rejects pointer installation before review and pointer CAS", () => {
    const worktreePointer = fixture()
    worktreePointer.worktree.set(V11_ACTIVE_AUTHORITY_POINTER_PATH, regular(Uint8Array.of(1)))
    expect(() => verifyInactiveSuccessorAuthorityCandidateWithHostV1(worktreePointer, "HEAD")).toThrow()

    const gitPointer = fixture()
    gitPointer.gitTrees.get("HEAD")!.set(V11_ACTIVE_AUTHORITY_POINTER_PATH, blob(Uint8Array.of(1)))
    expect(() => verifyInactiveSuccessorAuthorityCandidateWithHostV1(gitPointer, "HEAD")).toThrow()
  })

  test("rejects missing, extra, symlink and filesystem mode drift", () => {
    const cases: Array<(host: FakeHost) => void> = [
      (host) => host.worktree.delete(V11_CANDIDATE_PATHS[1]),
      (host) => host.extraFiles.push(`${V11_RELEASE_DIRECTORY}/unexpected.txt`),
      (host) => host.worktree.set(V11_CANDIDATE_PATHS[2], { kind: "symlink", mode: 0o777 }),
      (host) => host.worktree.set(V11_CANDIDATE_PATHS[3], regular(bytes(V11_CANDIDATE_PATHS[3]), 0o600)),
    ]
    for (const arrange of cases) {
      const host = fixture()
      arrange(host)
      expect(() => verifyInactiveSuccessorAuthorityCandidateWithHostV1(host, "HEAD")).toThrow()
    }
  })

  test("rejects Git non-blob, mode drift, tamper and descendant mutation", () => {
    const nonBlob = fixture()
    nonBlob.gitTrees.get("HEAD")!.set(V11_CANDIDATE_PATHS[1], { kind: "tree", mode: "040000" })
    expect(() => verifyInactiveSuccessorAuthorityCandidateWithHostV1(nonBlob, "HEAD")).toThrow()

    const mode = fixture()
    mode.gitTrees.get("HEAD")!.set(V11_CANDIDATE_PATHS[2], blob(bytes(V11_CANDIDATE_PATHS[2]), "100755"))
    expect(() => verifyInactiveSuccessorAuthorityCandidateWithHostV1(mode, "HEAD")).toThrow()

    const tamper = fixture()
    tamper.gitTrees.get("HEAD")!.set(V11_CANDIDATE_PATHS[3], blob(flip(bytes(V11_CANDIDATE_PATHS[3]))))
    expect(() => verifyInactiveSuccessorAuthorityCandidateWithHostV1(tamper, "HEAD")).toThrow()

    const descendant = fixture()
    descendant.gitTrees.get("HEAD")!.set(V11_CANDIDATE_PATHS[4], blob(flip(bytes(V11_CANDIDATE_PATHS[4]))))
    descendant.worktree.set(V11_CANDIDATE_PATHS[4], regular(flip(bytes(V11_CANDIDATE_PATHS[4]))))
    expect(() => verifyInactiveSuccessorAuthorityCandidateWithHostV1(descendant, "HEAD")).toThrow()
  })
})

describe("reviewed and active V11/R1 governance", () => {
  test("assembles exact 3/3 evidence and validates the reviewed inactive release", () => {
    const host = reviewedFixture()
    expect(verifyReviewedSuccessorAuthorityReleaseWithHostV1(host).protocolDigest)
      .toBe(V11_PROTOCOL_DIGEST)
  })

  test("creates only the pointer after a committed reviewed release and seals active descendants", () => {
    const host = reviewedFixture()
    const before = new Set(host.worktree.keys())
    promoteInitialSuccessorAuthorityReleaseWithHostV1(host)
    expect([...host.worktree.keys()].filter((path) => !before.has(path))).toEqual([V11_ACTIVE_AUTHORITY_POINTER_PATH])

    const reviewed = host.gitTrees.get("HEAD")!
    const active = cloneTree(reviewed)
    active.set(V11_ACTIVE_AUTHORITY_POINTER_PATH, blob(host.worktree.get(V11_ACTIVE_AUTHORITY_POINTER_PATH)!.bytes!))
    host.gitTrees.set("REVIEWED", reviewed)
    host.gitTrees.set("HEAD", cloneTree(active))
    host.gitTrees.set("ACTIVE_T0", cloneTree(active))
    host.parents.set("HEAD", "ACTIVE_T0")
    host.parents.set("ACTIVE_T0", "REVIEWED")
    host.parents.set("REVIEWED", "V11T0")
    expect(verifyActiveSuccessorAuthorityReleaseWithHostV1(host).sequence).toBe("1")

    host.gitTrees.get("HEAD")!.set(V11_REVIEWED_RELEASE_PATHS[2]!, blob(flip(bytes(V11_REVIEWED_RELEASE_PATHS[2]!))))
    host.worktree.set(V11_REVIEWED_RELEASE_PATHS[2]!, regular(flip(bytes(V11_REVIEWED_RELEASE_PATHS[2]!))))
    expect(() => verifyActiveSuccessorAuthorityReleaseWithHostV1(host)).toThrow()
  })

  test("pointer builder is canonical and evidence-bound", () => {
    const manifest = bytes(`${V11_RELEASE_DIRECTORY}/authority.sha256`)
    const evidence = new TextEncoder().encode("{}\n")
    const first = buildInitialSuccessorAuthorityPointerV1(manifest, evidence)
    const second = buildInitialSuccessorAuthorityPointerV1(manifest, evidence)
    expect(first).toEqual(second)
    expect(new TextDecoder().decode(first).endsWith("\n")).toBe(true)
  })
})

function fixture(): FakeHost {
  const host = new FakeHost()
  const v10Paths = [ACTIVE_AUTHORITY_POINTER_PATH, ...AUTHORITY_SNAPSHOT_PATHS]
  const allPaths = [...new Set([...v10Paths, ...V11_CANDIDATE_PATHS])]
  for (const path of allPaths) host.worktree.set(path, regular(bytes(path)))

  const r5Tree = new Map<string, GitAuthorityEntryV1>()
  for (const path of v10Paths) r5Tree.set(path, blob(bytes(path)))
  const v11Tree = cloneTree(r5Tree)
  for (const path of V11_CANDIDATE_PATHS) v11Tree.set(path, blob(bytes(path)))
  host.gitTrees.set("HEAD", cloneTree(v11Tree))
  host.gitTrees.set("V11T0", cloneTree(v11Tree))
  host.gitTrees.set("R5T0", cloneTree(r5Tree))
  host.gitTrees.set("base", new Map())
  host.parents.set("HEAD", "V11T0")
  host.parents.set("V11T0", "R5T0")
  host.parents.set("R5T0", "base")
  host.parents.set("base", null)
  return host
}

function reviewedFixture(): FakeHost {
  const host = fixture()
  const manifestPath = `${V11_RELEASE_DIRECTORY}/authority.sha256`
  const bundlePath = `${V11_RELEASE_DIRECTORY}/protocol-schema-bundle-v3.json`
  const manifestSha256 = sha(bytes(manifestPath))
  const protocolBundleSha256 = sha(bytes(bundlePath))
  const protocolDigest = JSON.parse(new TextDecoder().decode(bytes(bundlePath))) .protocolDigest as string
  for (const reviewer of V11_REVIEWERS) {
    const report = new TextEncoder().encode(`# ${reviewer.role} frozen review\n\nUNCONDITIONAL SIGN\n`)
    const receipt = encodeJcs({
      authorityId: "collaboration-v11",
      decision: "UNCONDITIONAL SIGN",
      format: "convax.collaboration-authority-review-receipt/2",
      manifestPath,
      manifestSha256,
      protocolBundlePath: bundlePath,
      protocolBundleSha256,
      protocolDigest,
      reportPath: reviewer.reportPath,
      reportSha256: sha(report),
      reviewerRole: reviewer.role,
      revision: "r1",
      scoreBasisPoints: 900,
    })
    host.worktree.set(reviewer.reportPath, regular(report))
    host.worktree.set(reviewer.receiptPath, regular(receipt))
  }
  const evidence = assembleSuccessorReviewEvidenceWithHostV1(host)
  const reviewed = cloneTree(host.gitTrees.get("HEAD")!)
  for (const path of V11_REVIEWED_RELEASE_PATHS) {
    const entry = host.worktree.get(path)
    if (entry === undefined) throw new Error(`missing reviewed fixture path ${path}`)
    reviewed.set(path, blob(entry.bytes!))
  }
  host.gitTrees.set("HEAD", reviewed)
  host.parents.set("HEAD", "V11T0")
  expect(evidence.byteLength).toBeGreaterThan(0)
  return host
}

function bytes(path: string): Uint8Array { return new Uint8Array(readFileSync(join(repositoryRoot, path))) }
function regular(value: Uint8Array, mode = 0o644): WorktreeAuthorityEntryV1 { return { kind: "regular", mode, bytes: new Uint8Array(value) } }
function blob(value: Uint8Array, mode = "100644"): GitAuthorityEntryV1 { return { kind: "blob", mode, bytes: new Uint8Array(value) } }
function flip(value: Uint8Array): Uint8Array { const copy = new Uint8Array(value); copy[0] ^= 1; return copy }
function cloneTree(value: ReadonlyMap<string, GitAuthorityEntryV1>): Map<string, GitAuthorityEntryV1> {
  return new Map([...value].map(([path, entry]) => [path, { ...entry, bytes: entry.bytes === undefined ? undefined : new Uint8Array(entry.bytes) }]))
}
function sha(value: Readonly<Uint8Array>): string { return createHash("sha256").update(new Uint8Array(value)).digest("hex") }
function encodeJcs(value: unknown): Uint8Array { return new TextEncoder().encode(`${jcs(value)}\n`) }
function jcs(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${jcs(record[key])}`).join(",")}}`
}
