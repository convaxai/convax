import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  validateAuthorityReleaseSnapshotV1,
  type AuthorityReleaseFileV1,
  type AuthorityReleaseSnapshotV1,
  type ValidatedAuthorityReleaseV1,
} from "@convax/collaboration"

export const ACTIVE_AUTHORITY_POINTER_PATH = "docs/superpowers/specs/collaboration-v10-active-authority.json" as const
export const LEGACY_AUTHORITY_MANIFEST_PATH = "docs/superpowers/specs/2026-08-01-p2p-v10-authority.sha256" as const
export const LEGACY_AUTHORITY_MANIFEST_SHA256 =
  "68a78f5ffdf3222667aaa213a492c3b79db6133f2206da1067a4976138edbcde" as const
export const RELEASE_DIRECTORY = "docs/superpowers/specs/authorities/collaboration-v10/r5" as const
export const RELEASE_MANIFEST_PATH = `${RELEASE_DIRECTORY}/authority.sha256` as const
export const RELEASE_EVIDENCE_PATH = `${RELEASE_DIRECTORY}/review-evidence.json` as const

export const AUTHORITY_SNAPSHOT_PATHS = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${RELEASE_DIRECTORY}/appendices/canvas-schema.md`,
  `${RELEASE_DIRECTORY}/appendices/collaboration-kernel.md`,
  `${RELEASE_DIRECTORY}/appendices/control-plane.md`,
  `${RELEASE_DIRECTORY}/appendices/project-persistence.md`,
  RELEASE_MANIFEST_PATH,
  `${RELEASE_DIRECTORY}/main.md`,
  `${RELEASE_DIRECTORY}/protocol-schema-bundle-v2.json`,
  RELEASE_EVIDENCE_PATH,
  `${RELEASE_DIRECTORY}/reviews/canvas-intent-runtime/receipt.json`,
  `${RELEASE_DIRECTORY}/reviews/canvas-intent-runtime/report.md`,
  `${RELEASE_DIRECTORY}/reviews/collaboration-api/receipt.json`,
  `${RELEASE_DIRECTORY}/reviews/collaboration-api/report.md`,
  `${RELEASE_DIRECTORY}/reviews/project-store-reviewer/receipt.json`,
  `${RELEASE_DIRECTORY}/reviews/project-store-reviewer/report.md`,
] as const)

export const R5_RELEASE_PATHS = Object.freeze(
  AUTHORITY_SNAPSHOT_PATHS.filter((path) => path.startsWith(`${RELEASE_DIRECTORY}/`)),
)

export interface WorktreeAuthorityEntryV1 {
  readonly kind: "regular" | "symlink" | "directory" | "other"
  readonly mode: number
  readonly bytes?: Readonly<Uint8Array>
}

export interface GitAuthorityEntryV1 {
  readonly kind: "blob" | "tree" | "commit" | "other"
  readonly mode: string
  readonly bytes?: Readonly<Uint8Array>
}

export interface CollaborationAuthorityReleaseHostV1 {
  readWorktreeEntry(path: string): WorktreeAuthorityEntryV1 | null
  listWorktreeFiles(directory: string): readonly string[]
  readGitEntry(ref: string, path: string): GitAuthorityEntryV1 | null
  firstParent(ref: string): string | null
  createWorktreeFileExclusive(path: string, bytes: Readonly<Uint8Array>): void
}

export interface VerifyCollaborationAuthorityReleaseOptionsV1 {
  readonly repositoryRoot?: string
  readonly gitRef?: string
}

export interface PromoteInitialCollaborationAuthorityReleaseOptionsV1 {
  readonly repositoryRoot?: string
  readonly parentGitRef?: string
}

const encoder = new TextEncoder()

export function buildInitialCollaborationAuthorityPointerV1(
  manifestBytes: Readonly<Uint8Array>,
  evidenceBytes: Readonly<Uint8Array>,
): Uint8Array {
  const pointer = {
    authorityId: "collaboration-v10",
    evidencePath: RELEASE_EVIDENCE_PATH,
    evidenceSha256: sha256(evidenceBytes),
    format: "convax.collaboration-active-authority-pointer/1",
    manifestPath: RELEASE_MANIFEST_PATH,
    manifestSha256: sha256(manifestBytes),
    previousSelection: {
      kind: "legacy-manifest",
      manifestPath: LEGACY_AUTHORITY_MANIFEST_PATH,
      manifestSha256: LEGACY_AUTHORITY_MANIFEST_SHA256,
    },
    revision: "r5",
    sequence: "1",
  }
  return encoder.encode(`${restrictedJcs(pointer)}\n`)
}

export function verifyCurrentCollaborationAuthorityReleaseWithHostV1(
  host: CollaborationAuthorityReleaseHostV1,
  gitRef = "HEAD",
): ValidatedAuthorityReleaseV1 {
  verifyR5WorktreeInventory(host)
  const worktreeSnapshot = gatherWorktreeSnapshot(host)
  const validated = validateAuthorityReleaseSnapshotV1(worktreeSnapshot)

  const history = collectFirstParentHistory(host, gitRef)
  if (history.length === 0) fail("collaboration-authority-history-unavailable")

  const currentGitSnapshot = gatherGitSnapshot(host, gitRef)
  validateAuthorityReleaseSnapshotV1(currentGitSnapshot)
  requireSameBytes(
    currentGitSnapshot.activePointerBytes,
    worktreeSnapshot.activePointerBytes,
    `${ACTIVE_AUTHORITY_POINTER_PATH} worktree/HEAD`,
  )
  for (let index = 0; index < AUTHORITY_SNAPSHOT_PATHS.length; index += 1) {
    const path = AUTHORITY_SNAPSHOT_PATHS[index]!
    requireSameBytes(
      currentGitSnapshot.files[index]!.bytes,
      worktreeSnapshot.files[index]!.bytes,
      `${path} worktree/HEAD`,
    )
  }

  const t0Index = findInitialPromotionIndex(host, history)
  if (t0Index < 0) fail("collaboration-authority-t0-unavailable")
  const t0Snapshot = gatherGitSnapshot(host, history[t0Index]!)
  const initialPointer = buildInitialCollaborationAuthorityPointerV1(
    requireSnapshotFile(t0Snapshot, RELEASE_MANIFEST_PATH).bytes,
    requireSnapshotFile(t0Snapshot, RELEASE_EVIDENCE_PATH).bytes,
  )
  requireSameBytes(t0Snapshot.activePointerBytes, initialPointer, "T0 active authority pointer")

  for (let index = 0; index <= t0Index; index += 1) {
    const ref = history[index]!
    const pointer = requireGitBlob(host, ref, ACTIVE_AUTHORITY_POINTER_PATH)
    if (pointer.mode !== "100644") fail(`${ACTIVE_AUTHORITY_POINTER_PATH} must have Git mode 100644 at ${ref}`)
    for (const sealed of t0Snapshot.files) {
      const descendant = requireGitBlob(host, ref, sealed.path)
      if (descendant.mode !== "100644") fail(`${sealed.path} must have Git mode 100644 at ${ref}`)
      requireSameBytes(descendant.bytes!, sealed.bytes, `${sealed.path} sealed at ${ref}`)
    }
  }

  return validated
}

export function promoteInitialCollaborationAuthorityReleaseWithHostV1(
  host: CollaborationAuthorityReleaseHostV1,
  parentGitRef = "HEAD",
): ValidatedAuthorityReleaseV1 {
  if (host.readWorktreeEntry(ACTIVE_AUTHORITY_POINTER_PATH) !== null) {
    fail("initial collaboration authority pointer already exists in worktree")
  }
  if (host.readGitEntry(parentGitRef, ACTIVE_AUTHORITY_POINTER_PATH) !== null) {
    fail("initial collaboration authority pointer already exists in parent Git tree")
  }

  const legacyWorktree = requireWorktreeFile(host, LEGACY_AUTHORITY_MANIFEST_PATH)
  if (legacyWorktree.mode !== 0o644) fail(`${LEGACY_AUTHORITY_MANIFEST_PATH} must have filesystem mode 0644`)
  requireSha256(legacyWorktree.bytes!, LEGACY_AUTHORITY_MANIFEST_SHA256, LEGACY_AUTHORITY_MANIFEST_PATH)
  const legacyGit = requireGitBlob(host, parentGitRef, LEGACY_AUTHORITY_MANIFEST_PATH)
  if (legacyGit.mode !== "100644") fail(`${LEGACY_AUTHORITY_MANIFEST_PATH} must have Git mode 100644`)
  requireSha256(
    legacyGit.bytes!,
    LEGACY_AUTHORITY_MANIFEST_SHA256,
    `${LEGACY_AUTHORITY_MANIFEST_PATH} in parent Git tree`,
  )
  requireSameBytes(legacyGit.bytes!, legacyWorktree.bytes!, `${LEGACY_AUTHORITY_MANIFEST_PATH} worktree/parent`)

  verifyR5WorktreeInventory(host)
  const files = gatherWorktreeAuthorityFiles(host)
  const pointerBytes = buildInitialCollaborationAuthorityPointerV1(
    requireAuthorityFile(files, RELEASE_MANIFEST_PATH).bytes,
    requireAuthorityFile(files, RELEASE_EVIDENCE_PATH).bytes,
  )
  const candidateSnapshot = immutableSnapshot(pointerBytes, files)
  validateAuthorityReleaseSnapshotV1(candidateSnapshot)

  host.createWorktreeFileExclusive(ACTIVE_AUTHORITY_POINTER_PATH, new Uint8Array(pointerBytes))
  const installedSnapshot = gatherWorktreeSnapshot(host)
  requireSameBytes(installedSnapshot.activePointerBytes, pointerBytes, "installed active authority pointer")
  return validateAuthorityReleaseSnapshotV1(installedSnapshot)
}

export function verifyCurrentCollaborationAuthorityReleaseV1(
  options: VerifyCollaborationAuthorityReleaseOptionsV1 = {},
): ValidatedAuthorityReleaseV1 {
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot()
  return verifyCurrentCollaborationAuthorityReleaseWithHostV1(
    createNodeGitAuthorityReleaseHostV1(repositoryRoot),
    options.gitRef,
  )
}

export function promoteInitialCollaborationAuthorityReleaseV1(
  options: PromoteInitialCollaborationAuthorityReleaseOptionsV1 = {},
): ValidatedAuthorityReleaseV1 {
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot()
  return promoteInitialCollaborationAuthorityReleaseWithHostV1(
    createNodeGitAuthorityReleaseHostV1(repositoryRoot),
    options.parentGitRef,
  )
}

export function createNodeGitAuthorityReleaseHostV1(repositoryRoot: string): CollaborationAuthorityReleaseHostV1 {
  const absoluteRoot = resolve(repositoryRoot)
  return Object.freeze({
    readWorktreeEntry(path: string): WorktreeAuthorityEntryV1 | null {
      requireRepositoryPath(path)
      const absolutePath = join(absoluteRoot, path)
      let stat
      try {
        stat = lstatSync(absolutePath)
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
      const mode = stat.mode & 0o777
      if (stat.isSymbolicLink()) return Object.freeze({ kind: "symlink" as const, mode })
      if (stat.isDirectory()) return Object.freeze({ kind: "directory" as const, mode })
      if (!stat.isFile()) return Object.freeze({ kind: "other" as const, mode })
      return Object.freeze({ kind: "regular" as const, mode, bytes: new Uint8Array(readFileSync(absolutePath)) })
    },
    listWorktreeFiles(directory: string): readonly string[] {
      requireRepositoryPath(directory)
      const results: string[] = []
      const visit = (relativeDirectory: string): void => {
        for (const item of readdirSync(join(absoluteRoot, relativeDirectory), { withFileTypes: true })) {
          const path = `${relativeDirectory}/${item.name}`
          if (item.isDirectory()) visit(path)
          else results.push(path)
        }
      }
      visit(directory)
      return Object.freeze(results.sort(compareUtf8))
    },
    readGitEntry(ref: string, path: string): GitAuthorityEntryV1 | null {
      requireGitRef(ref)
      requireRepositoryPath(path)
      const tree = git(absoluteRoot, ["ls-tree", "-z", ref, "--", path], true)
      if (tree.byteLength === 0) return null
      const record = decodeUtf8(tree).replace(/\0$/u, "")
      const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40,64})\t(.+)$/u.exec(record)
      if (match === null || match[4] !== path) fail(`invalid Git tree entry for ${path} at ${ref}`)
      const kind = match[2] as "blob" | "tree" | "commit"
      const bytes = kind === "blob" ? git(absoluteRoot, ["cat-file", "blob", match[3]!]) : undefined
      return Object.freeze({ kind, mode: match[1]!, bytes: bytes === undefined ? undefined : new Uint8Array(bytes) })
    },
    firstParent(ref: string): string | null {
      requireGitRef(ref)
      const commit = decodeUtf8(git(absoluteRoot, ["cat-file", "commit", ref], true))
      const parents = commit
        .split("\n")
        .filter((line) => line.startsWith("parent "))
        .map((line) => line.slice("parent ".length))
      if (parents.length === 0) return null
      if (parents.some((parent) => !/^[0-9a-f]{40,64}$/u.test(parent))) fail(`invalid parent identity at ${ref}`)
      return parents[0]!
    },
    createWorktreeFileExclusive(path: string, bytes: Readonly<Uint8Array>): void {
      requireRepositoryPath(path)
      writeFileSync(join(absoluteRoot, path), new Uint8Array(bytes), { flag: "wx", mode: 0o644 })
    },
  })
}

function gatherWorktreeSnapshot(host: CollaborationAuthorityReleaseHostV1): AuthorityReleaseSnapshotV1 {
  const pointer = requireWorktreeFile(host, ACTIVE_AUTHORITY_POINTER_PATH)
  if (pointer.mode !== 0o644) fail(`${ACTIVE_AUTHORITY_POINTER_PATH} must have filesystem mode 0644`)
  return immutableSnapshot(pointer.bytes!, gatherWorktreeAuthorityFiles(host))
}

function gatherWorktreeAuthorityFiles(host: CollaborationAuthorityReleaseHostV1): readonly AuthorityReleaseFileV1[] {
  return Object.freeze(
    AUTHORITY_SNAPSHOT_PATHS.map((path) => {
      const entry = requireWorktreeFile(host, path)
      if (entry.mode !== 0o644) fail(`${path} must have filesystem mode 0644`)
      return immutableFile(path, entry.bytes!)
    }),
  )
}

function gatherGitSnapshot(host: CollaborationAuthorityReleaseHostV1, ref: string): AuthorityReleaseSnapshotV1 {
  const pointer = requireGitBlob(host, ref, ACTIVE_AUTHORITY_POINTER_PATH)
  if (pointer.mode !== "100644") fail(`${ACTIVE_AUTHORITY_POINTER_PATH} must have Git mode 100644 at ${ref}`)
  const files = AUTHORITY_SNAPSHOT_PATHS.map((path) => {
    const entry = requireGitBlob(host, ref, path)
    if (entry.mode !== "100644") fail(`${path} must have Git mode 100644 at ${ref}`)
    return immutableFile(path, entry.bytes!)
  })
  return immutableSnapshot(pointer.bytes!, files)
}

function verifyR5WorktreeInventory(host: CollaborationAuthorityReleaseHostV1): void {
  const actual = [...host.listWorktreeFiles(RELEASE_DIRECTORY)].sort(compareUtf8)
  const expected = [...R5_RELEASE_PATHS].sort(compareUtf8)
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    fail(`${RELEASE_DIRECTORY} must contain exactly the fourteen sealed release files`)
  }
}

function collectFirstParentHistory(host: CollaborationAuthorityReleaseHostV1, head: string): readonly string[] {
  const history: string[] = []
  const seen = new Set<string>()
  let current: string | null = head
  while (current !== null) {
    if (seen.has(current)) fail("collaboration-authority-first-parent-cycle")
    seen.add(current)
    history.push(current)
    current = host.firstParent(current)
  }
  return Object.freeze(history)
}

function findInitialPromotionIndex(host: CollaborationAuthorityReleaseHostV1, history: readonly string[]): number {
  let oldest = -1
  for (let index = 0; index < history.length; index += 1) {
    const ref = history[index]!
    const pointerEntry = host.readGitEntry(ref, ACTIVE_AUTHORITY_POINTER_PATH)
    if (pointerEntry === null) continue
    if (pointerEntry.kind !== "blob" || pointerEntry.mode !== "100644" || pointerEntry.bytes === undefined) continue
    try {
      const snapshot = gatherGitSnapshot(host, ref)
      const expected = buildInitialCollaborationAuthorityPointerV1(
        requireSnapshotFile(snapshot, RELEASE_MANIFEST_PATH).bytes,
        requireSnapshotFile(snapshot, RELEASE_EVIDENCE_PATH).bytes,
      )
      requireSameBytes(snapshot.activePointerBytes, expected, `initial pointer at ${ref}`)
      validateAuthorityReleaseSnapshotV1(snapshot)
      oldest = index
    } catch {
      // A non-candidate ancestor is expected before the create-only initial promotion.
    }
  }
  return oldest
}

function immutableSnapshot(
  activePointerBytes: Readonly<Uint8Array>,
  files: readonly AuthorityReleaseFileV1[],
): AuthorityReleaseSnapshotV1 {
  return Object.freeze({
    activePointerBytes: new Uint8Array(activePointerBytes),
    files: Object.freeze(files.map((file) => immutableFile(file.path, file.bytes))),
  })
}

function immutableFile(path: string, bytes: Readonly<Uint8Array>): AuthorityReleaseFileV1 {
  return Object.freeze({ path, bytes: new Uint8Array(bytes) })
}

function requireSnapshotFile(snapshot: AuthorityReleaseSnapshotV1, path: string): AuthorityReleaseFileV1 {
  return requireAuthorityFile(snapshot.files, path)
}

function requireAuthorityFile(files: readonly AuthorityReleaseFileV1[], path: string): AuthorityReleaseFileV1 {
  const matches = files.filter((file) => file.path === path)
  if (matches.length !== 1) fail(`missing or duplicate authority file ${path}`)
  return matches[0]!
}

function requireWorktreeFile(
  host: CollaborationAuthorityReleaseHostV1,
  path: string,
): WorktreeAuthorityEntryV1 & { readonly kind: "regular"; readonly bytes: Readonly<Uint8Array> } {
  const entry = host.readWorktreeEntry(path)
  if (entry === null || entry.kind !== "regular" || entry.bytes === undefined) {
    fail(`${path} must be a regular non-symlink worktree file`)
  }
  return entry as WorktreeAuthorityEntryV1 & { readonly kind: "regular"; readonly bytes: Readonly<Uint8Array> }
}

function requireGitBlob(
  host: CollaborationAuthorityReleaseHostV1,
  ref: string,
  path: string,
): GitAuthorityEntryV1 & { readonly kind: "blob"; readonly bytes: Readonly<Uint8Array> } {
  const entry = host.readGitEntry(ref, path)
  if (entry === null || entry.kind !== "blob" || entry.bytes === undefined) {
    fail(`${path} must be a Git blob at ${ref}`)
  }
  return entry as GitAuthorityEntryV1 & { readonly kind: "blob"; readonly bytes: Readonly<Uint8Array> }
}

function requireSha256(bytes: Readonly<Uint8Array>, expected: string, label: string): void {
  const actual = sha256(bytes)
  if (actual !== expected) fail(`${label} SHA-256 mismatch: expected ${expected}, received ${actual}`)
}

function sha256(bytes: Readonly<Uint8Array>): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
}

function restrictedJcs(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("restricted JCS accepts only safe integers")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(restrictedJcs).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${restrictedJcs(record[key])}`)
      .join(",")}}`
  }
  fail("restricted JCS rejects unsupported values")
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

function requireSameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>, label: string): void {
  if (left.byteLength !== right.byteLength) fail(`${label} byte length mismatch`)
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) fail(`${label} byte mismatch at offset ${index}`)
  }
}

function requireRepositoryPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`invalid repository-relative path ${JSON.stringify(path)}`)
  }
}

function requireGitRef(ref: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}^~:-]*$/u.test(ref) || ref.startsWith("-") || ref.includes("..")) {
    fail(`invalid Git ref ${JSON.stringify(ref)}`)
  }
}

function git(repositoryRoot: string, args: readonly string[], _required: true): Uint8Array
function git(repositoryRoot: string, args: readonly string[], _required: boolean): Uint8Array {
  const result = Bun.spawnSync(["git", "-C", repositoryRoot, ...args], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode === 0) return new Uint8Array(result.stdout)
  fail(`Git command failed: ${decodeUtf8(result.stderr).trim()}`)
}

function decodeUtf8(bytes: Readonly<Uint8Array>): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes))
}

function defaultRepositoryRoot(): string {
  return fileURLToPath(new URL("..", import.meta.url))
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function fail(message: string): never {
  throw new Error(message)
}

function runCli(): void {
  const command = process.argv[2]
  if (command === "--check" && process.argv.length === 3) {
    verifyCurrentCollaborationAuthorityReleaseV1()
    process.stdout.write("collaboration authority release is valid\n")
    return
  }
  if (command === "--promote-sequence-1" && process.argv.length === 3) {
    promoteInitialCollaborationAuthorityReleaseV1()
    process.stdout.write("collaboration authority sequence 1 created and validated\n")
    return
  }
  fail("usage: bun scripts/collaboration-authority-release.ts (--check|--promote-sequence-1)")
}

if (import.meta.main) runCli()
