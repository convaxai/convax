import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  validateAuthorityReleaseSnapshotV1,
  type AuthorityReleaseFileV1,
  type AuthorityReleaseSnapshotV1,
} from "@convax/collaboration"

import {
  ACTIVE_AUTHORITY_POINTER_PATH,
  AUTHORITY_SNAPSHOT_PATHS,
  LEGACY_AUTHORITY_MANIFEST_PATH,
  RELEASE_DIRECTORY,
  RELEASE_EVIDENCE_PATH,
  RELEASE_MANIFEST_PATH,
  R5_RELEASE_PATHS,
  buildInitialCollaborationAuthorityPointerV1,
  promoteInitialCollaborationAuthorityReleaseWithHostV1,
  verifyCurrentCollaborationAuthorityReleaseWithHostV1,
  type CollaborationAuthorityReleaseHostV1,
  type GitAuthorityEntryV1,
  type WorktreeAuthorityEntryV1,
} from "./collaboration-authority-release"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))

class FakeHost implements CollaborationAuthorityReleaseHostV1 {
  readonly worktree = new Map<string, WorktreeAuthorityEntryV1>()
  readonly gitTrees = new Map<string, Map<string, GitAuthorityEntryV1>>()
  readonly parents = new Map<string, string | null>()
  readonly reads: string[] = []
  readonly writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = []
  extraFiles: string[] = []

  readWorktreeEntry(path: string): WorktreeAuthorityEntryV1 | null {
    this.reads.push(`worktree:${path}`)
    return this.worktree.get(path) ?? null
  }

  listWorktreeFiles(directory: string): readonly string[] {
    this.reads.push(`list:${directory}`)
    return [...this.worktree.keys(), ...this.extraFiles].filter((path) => path.startsWith(`${directory}/`))
  }

  readGitEntry(ref: string, path: string): GitAuthorityEntryV1 | null {
    this.reads.push(`git:${ref}:${path}`)
    return this.gitTrees.get(ref)?.get(path) ?? null
  }

  firstParent(ref: string): string | null {
    this.reads.push(`parent:${ref}`)
    if (!this.parents.has(ref)) throw new Error(`unknown fake Git ref ${ref}`)
    return this.parents.get(ref) ?? null
  }

  createWorktreeFileExclusive(path: string, bytes: Readonly<Uint8Array>): void {
    if (this.worktree.has(path)) throw new Error(`EEXIST: ${path}`)
    const copy = new Uint8Array(bytes)
    this.writes.push({ path, bytes: copy })
    this.worktree.set(path, regular(copy))
  }
}

describe("collaboration authority static release checker", () => {
  test("Git checkout policy preserves every authority identity byte as LF on Windows", () => {
    const paths = [ACTIVE_AUTHORITY_POINTER_PATH, ...AUTHORITY_SNAPSHOT_PATHS]
    const result = Bun.spawnSync(["git", "-C", repositoryRoot, "check-attr", "-z", "text", "eol", "--", ...paths], {
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(new TextDecoder().decode(result.stderr)).toBe("")
    expect(result.exitCode).toBe(0)

    const fields = new TextDecoder().decode(result.stdout).split("\0")
    expect(fields.pop()).toBe("")
    const attributes = new Map<string, Map<string, string>>()
    for (let index = 0; index < fields.length; index += 3) {
      const path = fields[index]
      const attribute = fields[index + 1]
      const value = fields[index + 2]
      const values = attributes.get(path) ?? new Map<string, string>()
      values.set(attribute, value)
      attributes.set(path, values)
    }

    expect([...attributes.keys()]).toEqual(paths)
    for (const path of paths) {
      expect(attributes.get(path)).toEqual(
        new Map([
          ["text", "set"],
          ["eol", "lf"],
        ]),
      )
    }
  })

  test("golden selector, static verifier, and initial promoter accept the same sealed release", () => {
    const promotionHost = createPromotionHost()
    const promoted = promoteInitialCollaborationAuthorityReleaseWithHostV1(promotionHost, "base")
    expect(promotionHost.writes).toHaveLength(1)
    expect(promotionHost.writes[0]!.path).toBe(ACTIVE_AUTHORITY_POINTER_PATH)

    const promotedSnapshot = snapshotFromHost(promotionHost)
    expect(promoted).toEqual(validateAuthorityReleaseSnapshotV1(promotedSnapshot))

    const currentHost = createCurrentHost(promotedSnapshot)
    expect(verifyCurrentCollaborationAuthorityReleaseWithHostV1(currentHost, "HEAD")).toEqual(
      validateAuthorityReleaseSnapshotV1(promotedSnapshot),
    )
    expect(currentHost.reads.some((read) => read.includes(LEGACY_AUTHORITY_MANIFEST_PATH))).toBe(false)
  })

  test("hostile byte corpus is rejected by both direct selector and static verifier", () => {
    const goldenHost = createPromotionHost()
    promoteInitialCollaborationAuthorityReleaseWithHostV1(goldenHost, "base")
    const golden = snapshotFromHost(goldenHost)
    const hostileCases = [
      mutateSnapshot(golden, "pointer"),
      mutateSnapshot(golden, AUTHORITY_SNAPSHOT_PATHS[0]),
      mutateSnapshot(golden, RELEASE_MANIFEST_PATH),
      mutateSnapshot(golden, RELEASE_EVIDENCE_PATH),
      mutateSnapshot(golden, AUTHORITY_SNAPSHOT_PATHS.at(-1)!),
    ]

    for (const hostile of hostileCases) {
      expect(() => validateAuthorityReleaseSnapshotV1(hostile)).toThrow()
      expect(() => verifyCurrentCollaborationAuthorityReleaseWithHostV1(createCurrentHost(hostile), "HEAD")).toThrow()
    }
  })

  test("borrowed mutable byte arrays cannot change a validated or installed result", () => {
    const fixture = readFixtureFiles()
    const manifest = fixture.get(RELEASE_MANIFEST_PATH)!
    const evidence = fixture.get(RELEASE_EVIDENCE_PATH)!
    const pointer = buildInitialCollaborationAuthorityPointerV1(manifest, evidence)
    const borrowedFiles = AUTHORITY_SNAPSHOT_PATHS.map((path) => ({ path, bytes: fixture.get(path)! }))
    const borrowedSnapshot = { activePointerBytes: pointer, files: borrowedFiles }
    const before = validateAuthorityReleaseSnapshotV1(borrowedSnapshot)

    pointer.fill(0)
    for (const file of borrowedFiles) (file.bytes as Uint8Array).fill(0)
    expect(before).toEqual({
      ...before,
      activePointerSha256: before.activePointerSha256,
    })

    const promotionHost = createPromotionHost()
    const sourceManifest = promotionHost.worktree.get(RELEASE_MANIFEST_PATH)!.bytes as Uint8Array
    const promoted = promoteInitialCollaborationAuthorityReleaseWithHostV1(promotionHost, "base")
    sourceManifest.fill(0)
    expect(promoted.format).toBe("convax.validated-authority-release/1")
    expect(promotionHost.writes[0]!.bytes.every((byte) => byte === 0)).toBe(false)
  })

  test("every initial-promotion precondition failure performs zero pointer writes", () => {
    const cases: Array<(host: FakeHost) => void> = [
      (host) => host.worktree.set(ACTIVE_AUTHORITY_POINTER_PATH, regular(new Uint8Array([1]))),
      (host) => host.gitTrees.get("base")!.set(ACTIVE_AUTHORITY_POINTER_PATH, blob(new Uint8Array([1]))),
      (host) => host.worktree.delete(LEGACY_AUTHORITY_MANIFEST_PATH),
      (host) => host.worktree.set(LEGACY_AUTHORITY_MANIFEST_PATH, { kind: "symlink", mode: 0o777 }),
      (host) => host.worktree.set(LEGACY_AUTHORITY_MANIFEST_PATH, regular(new Uint8Array([1]), 0o600)),
      (host) => host.worktree.set(LEGACY_AUTHORITY_MANIFEST_PATH, regular(new Uint8Array([1]))),
      (host) => host.gitTrees.get("base")!.set(LEGACY_AUTHORITY_MANIFEST_PATH, blob(new Uint8Array([1]), "100755")),
      (host) => host.worktree.delete(RELEASE_MANIFEST_PATH),
      (host) => host.extraFiles.push(`${RELEASE_DIRECTORY}/unexpected.txt`),
      (host) => {
        const evidence = host.worktree.get(RELEASE_EVIDENCE_PATH)!.bytes as Uint8Array
        evidence[0] = evidence[0]! ^ 1
      },
    ]

    for (const arrange of cases) {
      const host = createPromotionHost()
      arrange(host)
      expect(() => promoteInitialCollaborationAuthorityReleaseWithHostV1(host, "base")).toThrow()
      expect(host.writes).toHaveLength(0)
      if (cases.indexOf(arrange) !== 0) expect(host.worktree.has(ACTIVE_AUTHORITY_POINTER_PATH)).toBe(false)
    }
  })

  test("current verification rejects history gaps, mode drift, sealed-byte drift, and an extra R5 file", () => {
    const promotedHost = createPromotionHost()
    promoteInitialCollaborationAuthorityReleaseWithHostV1(promotedHost, "base")
    const snapshot = snapshotFromHost(promotedHost)

    const unavailableHistory = createCurrentHost(snapshot)
    unavailableHistory.parents.set("HEAD", "missing")
    expect(() => verifyCurrentCollaborationAuthorityReleaseWithHostV1(unavailableHistory, "HEAD")).toThrow()

    const wrongMode = createCurrentHost(snapshot)
    wrongMode.gitTrees.get("HEAD")!.set(RELEASE_MANIFEST_PATH, blob(snapshot.files[5]!.bytes, "100755"))
    expect(() => verifyCurrentCollaborationAuthorityReleaseWithHostV1(wrongMode, "HEAD")).toThrow()

    const drift = createCurrentHost(snapshot)
    drift.gitTrees.get("HEAD")!.set(RELEASE_MANIFEST_PATH, blob(flip(snapshot.files[5]!.bytes)))
    expect(() => verifyCurrentCollaborationAuthorityReleaseWithHostV1(drift, "HEAD")).toThrow()

    const extra = createCurrentHost(snapshot)
    extra.extraFiles.push(`${RELEASE_DIRECTORY}/unexpected.txt`)
    expect(() => verifyCurrentCollaborationAuthorityReleaseWithHostV1(extra, "HEAD")).toThrow()
  })
})

function createPromotionHost(): FakeHost {
  const host = new FakeHost()
  for (const [path, bytes] of readFixtureFiles()) host.worktree.set(path, regular(bytes))
  const legacy = new Uint8Array(readFileSync(join(repositoryRoot, LEGACY_AUTHORITY_MANIFEST_PATH)))
  host.worktree.set(LEGACY_AUTHORITY_MANIFEST_PATH, regular(legacy))
  host.gitTrees.set("base", new Map([[LEGACY_AUTHORITY_MANIFEST_PATH, blob(legacy)]]))
  host.parents.set("base", null)
  return host
}

function createCurrentHost(snapshot: AuthorityReleaseSnapshotV1): FakeHost {
  const host = new FakeHost()
  host.worktree.set(ACTIVE_AUTHORITY_POINTER_PATH, regular(snapshot.activePointerBytes))
  for (const file of snapshot.files) host.worktree.set(file.path, regular(file.bytes))

  const releaseTree = new Map<string, GitAuthorityEntryV1>()
  releaseTree.set(ACTIVE_AUTHORITY_POINTER_PATH, blob(snapshot.activePointerBytes))
  for (const file of snapshot.files) releaseTree.set(file.path, blob(file.bytes))
  host.gitTrees.set("HEAD", cloneGitTree(releaseTree))
  host.gitTrees.set("T0", cloneGitTree(releaseTree))
  host.gitTrees.set("base", new Map())
  host.parents.set("HEAD", "T0")
  host.parents.set("T0", "base")
  host.parents.set("base", null)
  return host
}

function snapshotFromHost(host: FakeHost): AuthorityReleaseSnapshotV1 {
  return {
    activePointerBytes: host.worktree.get(ACTIVE_AUTHORITY_POINTER_PATH)!.bytes!,
    files: AUTHORITY_SNAPSHOT_PATHS.map((path) => ({ path, bytes: host.worktree.get(path)!.bytes! })),
  }
}

function readFixtureFiles(): Map<string, Uint8Array> {
  return new Map(
    AUTHORITY_SNAPSHOT_PATHS.map((path) => [path, new Uint8Array(readFileSync(join(repositoryRoot, path)))]),
  )
}

function mutateSnapshot(snapshot: AuthorityReleaseSnapshotV1, target: "pointer" | string): AuthorityReleaseSnapshotV1 {
  return {
    activePointerBytes:
      target === "pointer" ? flip(snapshot.activePointerBytes) : new Uint8Array(snapshot.activePointerBytes),
    files: snapshot.files.map(
      (file): AuthorityReleaseFileV1 => ({
        path: file.path,
        bytes: file.path === target ? flip(file.bytes) : new Uint8Array(file.bytes),
      }),
    ),
  }
}

function regular(bytes: Readonly<Uint8Array>, mode = 0o644): WorktreeAuthorityEntryV1 {
  return { kind: "regular", mode, bytes: new Uint8Array(bytes) }
}

function blob(bytes: Readonly<Uint8Array>, mode = "100644"): GitAuthorityEntryV1 {
  return { kind: "blob", mode, bytes: new Uint8Array(bytes) }
}

function cloneGitTree(tree: ReadonlyMap<string, GitAuthorityEntryV1>): Map<string, GitAuthorityEntryV1> {
  return new Map(
    [...tree].map(([path, entry]) => [
      path,
      { ...entry, bytes: entry.bytes === undefined ? undefined : new Uint8Array(entry.bytes) },
    ]),
  )
}

function flip(bytes: Readonly<Uint8Array>): Uint8Array {
  const result = new Uint8Array(bytes)
  result[0] = result[0]! ^ 1
  return result
}

test("the exported R5 inventory remains the exact fourteen-file subset", () => {
  expect(R5_RELEASE_PATHS).toHaveLength(14)
  expect(AUTHORITY_SNAPSHOT_PATHS).toHaveLength(15)
})
