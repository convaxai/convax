import { createHash } from "node:crypto"
import { resolve } from "node:path"

import {
  validateSuccessorAuthorityReleaseSnapshotV1,
  validateSuccessorAuthorityCandidateSnapshotV1,
  type SuccessorAuthorityCandidateSnapshotV1,
  type SuccessorAuthorityReleaseSnapshotV1,
  type ValidatedSuccessorAuthorityCandidateV1,
  type ValidatedSuccessorAuthorityReleaseV1,
} from "../packages/collaboration/src/authority-selector-v3"
import {
  ACTIVE_AUTHORITY_POINTER_PATH,
  createNodeGitAuthorityReleaseHostV1,
  verifyCurrentCollaborationAuthorityReleaseWithHostV1,
  type CollaborationAuthorityReleaseHostV1,
  type GitAuthorityEntryV1,
  type WorktreeAuthorityEntryV1,
} from "./collaboration-authority-release"

export const V11_ACTIVE_AUTHORITY_POINTER_PATH = "docs/superpowers/specs/collaboration-v11-active-authority.json" as const
export const V11_RELEASE_DIRECTORY = "docs/superpowers/specs/authorities/collaboration-v11/r1" as const
export const V11_CANDIDATE_PATHS = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${V11_RELEASE_DIRECTORY}/appendices/canvas-schema.md`,
  `${V11_RELEASE_DIRECTORY}/appendices/collaboration-kernel.md`,
  `${V11_RELEASE_DIRECTORY}/appendices/control-plane.md`,
  `${V11_RELEASE_DIRECTORY}/appendices/project-persistence.md`,
  `${V11_RELEASE_DIRECTORY}/authority.sha256`,
  `${V11_RELEASE_DIRECTORY}/historical-v10-r5-pin.json`,
  `${V11_RELEASE_DIRECTORY}/main.md`,
  `${V11_RELEASE_DIRECTORY}/protocol-schema-bundle-v3.json`,
] as const)

export const V11_RELEASE_PATHS = Object.freeze(
  V11_CANDIDATE_PATHS.filter((path) => path.startsWith(`${V11_RELEASE_DIRECTORY}/`)),
)

export const V11_REVIEWERS = Object.freeze([
  { role: "canvas-intent-runtime", receiptPath: `${V11_RELEASE_DIRECTORY}/reviews/canvas-intent-runtime/receipt.json`, reportPath: `${V11_RELEASE_DIRECTORY}/reviews/canvas-intent-runtime/report.md` },
  { role: "collaboration-control-protocol", receiptPath: `${V11_RELEASE_DIRECTORY}/reviews/collaboration-control-protocol/receipt.json`, reportPath: `${V11_RELEASE_DIRECTORY}/reviews/collaboration-control-protocol/report.md` },
  { role: "project-native-store", receiptPath: `${V11_RELEASE_DIRECTORY}/reviews/project-native-store/receipt.json`, reportPath: `${V11_RELEASE_DIRECTORY}/reviews/project-native-store/report.md` },
] as const)
export const V11_REVIEW_EVIDENCE_PATH = `${V11_RELEASE_DIRECTORY}/review-evidence.json` as const
export const V11_REVIEWED_RELEASE_PATHS = Object.freeze([
  ...V11_CANDIDATE_PATHS,
  V11_REVIEW_EVIDENCE_PATH,
  ...V11_REVIEWERS.flatMap(({ receiptPath, reportPath }) => [receiptPath, reportPath]),
])
export const V11_REVIEWED_DIRECTORY_PATHS = Object.freeze(
  V11_REVIEWED_RELEASE_PATHS.filter((path) => path.startsWith(`${V11_RELEASE_DIRECTORY}/`)),
)

const V10_POINTER_SHA256 = "f1b6f1e09dba629ab06530b2e21c6ac451cd4c04c82ed21cd7cabfb9b7e78398"
const encoder = new TextEncoder()

export function verifyInactiveSuccessorAuthorityCandidateWithHostV1(
  host: CollaborationAuthorityReleaseHostV1,
  gitRef = "HEAD",
): ValidatedSuccessorAuthorityCandidateV1 {
  if (host.readWorktreeEntry(V11_ACTIVE_AUTHORITY_POINTER_PATH) !== null) fail("V11 active pointer must remain absent before promotion")
  if (host.readGitEntry(gitRef, V11_ACTIVE_AUTHORITY_POINTER_PATH) !== null) fail("V11 active pointer must remain absent from HEAD before promotion")
  verifyExactInventory(host, V11_RELEASE_PATHS, "eight frozen candidate files")
  verifyCurrentCollaborationAuthorityReleaseWithHostV1(host, gitRef)

  const worktree = gatherWorktreeCandidate(host)
  const validated = validateSuccessorAuthorityCandidateSnapshotV1(worktree)
  const current = gatherGitCandidate(host, gitRef)
  validateSuccessorAuthorityCandidateSnapshotV1(current)
  sameCandidate(current, worktree, "V11 worktree/HEAD")

  const history = collectHistory(host, gitRef)
  const t0 = findFreezeIndex(host, history)
  if (t0 < 0) fail("collaboration-v11-authority-freeze-t0-unavailable")
  const frozen = gatherGitCandidate(host, history[t0]!)
  for (let index = 0; index <= t0; index += 1) {
    const ref = history[index]!
    if (host.readGitEntry(ref, V11_ACTIVE_AUTHORITY_POINTER_PATH) !== null) fail(`V11 pointer appeared before promotion at ${ref}`)
    const descendant = gatherGitCandidate(host, ref)
    sameCandidate(descendant, frozen, `V11 frozen candidate at ${ref}`)
  }
  return validated
}

export function buildInitialSuccessorAuthorityPointerV1(
  manifestBytes: Readonly<Uint8Array>,
  evidenceBytes: Readonly<Uint8Array>,
): Uint8Array {
  const pointer = {
    authorityId: "collaboration-v11",
    evidencePath: V11_REVIEW_EVIDENCE_PATH,
    evidenceSha256: sha256(evidenceBytes),
    format: "convax.collaboration-active-authority-pointer/1",
    manifestPath: `${V11_RELEASE_DIRECTORY}/authority.sha256`,
    manifestSha256: sha256(manifestBytes),
    previousSelection: {
      authorityId: "collaboration-v10",
      kind: "active-authority",
      pointerPath: ACTIVE_AUTHORITY_POINTER_PATH,
      pointerSha256: V10_POINTER_SHA256,
      revision: "r5",
      sequence: "1",
    },
    revision: "r1",
    sequence: "1",
  }
  return encoder.encode(`${restrictedJcs(pointer)}\n`)
}

export function verifyReviewedSuccessorAuthorityReleaseWithHostV1(
  host: CollaborationAuthorityReleaseHostV1,
  gitRef = "HEAD",
): ValidatedSuccessorAuthorityReleaseV1 {
  requirePointerAbsent(host, gitRef)
  verifyExactInventory(host, V11_REVIEWED_DIRECTORY_PATHS, "fifteen reviewed release files")
  verifyCurrentCollaborationAuthorityReleaseWithHostV1(host, gitRef)
  verifyFrozenCandidateHistory(host, gitRef)

  const worktree = gatherReviewedWorktreeRelease(host, true)
  const validated = validateSuccessorAuthorityReleaseSnapshotV1(worktree)
  const current = gatherReviewedGitRelease(host, gitRef, true)
  validateSuccessorAuthorityReleaseSnapshotV1(current)
  sameRelease(current, worktree, "V11 reviewed worktree/HEAD")
  return validated
}

export function verifyActiveSuccessorAuthorityReleaseWithHostV1(
  host: CollaborationAuthorityReleaseHostV1,
  gitRef = "HEAD",
): ValidatedSuccessorAuthorityReleaseV1 {
  verifyExactInventory(host, V11_REVIEWED_DIRECTORY_PATHS, "fifteen reviewed release files")
  verifyCurrentCollaborationAuthorityReleaseWithHostV1(host, gitRef)
  const worktree = gatherReviewedWorktreeRelease(host, false)
  const validated = validateSuccessorAuthorityReleaseSnapshotV1(worktree)
  const current = gatherReviewedGitRelease(host, gitRef, false)
  validateSuccessorAuthorityReleaseSnapshotV1(current)
  sameRelease(current, worktree, "V11 active worktree/HEAD")

  const history = collectHistory(host, gitRef)
  const t0 = findActivationIndex(host, history)
  if (t0 < 0) fail("collaboration-v11-authority-activation-t0-unavailable")
  const frozen = gatherReviewedGitRelease(host, history[t0]!, false)
  const expectedPointer = buildInitialSuccessorAuthorityPointerV1(
    requireReleaseFile(frozen, `${V11_RELEASE_DIRECTORY}/authority.sha256`),
    requireReleaseFile(frozen, V11_REVIEW_EVIDENCE_PATH),
  )
  sameBytes(frozen.activePointerBytes, expectedPointer, "V11 T0 active pointer")
  for (let index = 0; index <= t0; index += 1) {
    const descendant = gatherReviewedGitRelease(host, history[index]!, false)
    sameRelease(descendant, frozen, `V11 activated release at ${history[index]!}`)
  }
  return validated
}

export function assembleSuccessorReviewEvidenceWithHostV1(
  host: CollaborationAuthorityReleaseHostV1,
): Uint8Array {
  if (host.readWorktreeEntry(V11_REVIEW_EVIDENCE_PATH) !== null) fail("V11 review evidence already exists")
  const manifest = requireWorktreeFile(host, `${V11_RELEASE_DIRECTORY}/authority.sha256`).bytes
  const bundle = decodeJcs(requireWorktreeFile(host, `${V11_RELEASE_DIRECTORY}/protocol-schema-bundle-v3.json`).bytes, "V11 protocol bundle")
  const reviews = V11_REVIEWERS.map((reviewer) => {
    const report = requireWorktreeFile(host, reviewer.reportPath).bytes
    const receiptBytes = requireWorktreeFile(host, reviewer.receiptPath).bytes
    const receipt = decodeJcs(receiptBytes, `V11 ${reviewer.role} receipt`)
    if (receipt.reviewerRole !== reviewer.role || receipt.reportPath !== reviewer.reportPath || receipt.reportSha256 !== sha256(report)) {
      fail(`V11 ${reviewer.role} receipt does not bind its exact report`)
    }
    if (receipt.decision !== "UNCONDITIONAL SIGN" || !Number.isSafeInteger(receipt.scoreBasisPoints)) {
      fail(`V11 ${reviewer.role} receipt is not an unconditional bounded review`)
    }
    return {
      decision: "UNCONDITIONAL SIGN",
      receiptPath: reviewer.receiptPath,
      receiptSha256: sha256(receiptBytes),
      reportPath: reviewer.reportPath,
      reportSha256: sha256(report),
      reviewerRole: reviewer.role,
      scoreBasisPoints: receipt.scoreBasisPoints,
    }
  })
  const evidence = encoder.encode(`${restrictedJcs({
    authorityId: "collaboration-v11",
    decision: "UNCONDITIONAL 3/3 SIGN",
    format: "convax.collaboration-authority-review-evidence/2",
    manifestPath: `${V11_RELEASE_DIRECTORY}/authority.sha256`,
    manifestSha256: sha256(manifest),
    protocolBundleSha256: sha256(requireWorktreeFile(host, `${V11_RELEASE_DIRECTORY}/protocol-schema-bundle-v3.json`).bytes),
    protocolDigest: bundle.protocolDigest,
    reviews,
    revision: "r1",
  })}\n`)
  const files = gatherReviewedWorktreeFiles(host, new Map([[V11_REVIEW_EVIDENCE_PATH, evidence]]))
  validateSuccessorAuthorityReleaseSnapshotV1({
    activePointerBytes: buildInitialSuccessorAuthorityPointerV1(manifest, evidence),
    files,
  })
  host.createWorktreeFileExclusive(V11_REVIEW_EVIDENCE_PATH, evidence)
  return evidence
}

export function promoteInitialSuccessorAuthorityReleaseWithHostV1(
  host: CollaborationAuthorityReleaseHostV1,
  parentGitRef = "HEAD",
): ValidatedSuccessorAuthorityReleaseV1 {
  verifyReviewedSuccessorAuthorityReleaseWithHostV1(host, parentGitRef)
  const manifest = requireWorktreeFile(host, `${V11_RELEASE_DIRECTORY}/authority.sha256`).bytes
  const evidence = requireWorktreeFile(host, V11_REVIEW_EVIDENCE_PATH).bytes
  const pointer = buildInitialSuccessorAuthorityPointerV1(manifest, evidence)
  const prospective: SuccessorAuthorityReleaseSnapshotV1 = Object.freeze({
    activePointerBytes: pointer,
    files: gatherReviewedWorktreeFiles(host),
  })
  const validated = validateSuccessorAuthorityReleaseSnapshotV1(prospective)
  host.createWorktreeFileExclusive(V11_ACTIVE_AUTHORITY_POINTER_PATH, pointer)
  return validated
}

export function verifyInactiveSuccessorAuthorityCandidateV1(options: {
  readonly repositoryRoot?: string
  readonly gitRef?: string
} = {}): ValidatedSuccessorAuthorityCandidateV1 {
  const root = resolve(options.repositoryRoot ?? new URL("..", import.meta.url).pathname)
  return verifyInactiveSuccessorAuthorityCandidateWithHostV1(
    createNodeGitAuthorityReleaseHostV1(root),
    options.gitRef,
  )
}

export function verifyReviewedSuccessorAuthorityReleaseV1(options: {
  readonly repositoryRoot?: string
  readonly gitRef?: string
} = {}): ValidatedSuccessorAuthorityReleaseV1 {
  const root = resolve(options.repositoryRoot ?? new URL("..", import.meta.url).pathname)
  return verifyReviewedSuccessorAuthorityReleaseWithHostV1(createNodeGitAuthorityReleaseHostV1(root), options.gitRef)
}

export function verifyActiveSuccessorAuthorityReleaseV1(options: {
  readonly repositoryRoot?: string
  readonly gitRef?: string
} = {}): ValidatedSuccessorAuthorityReleaseV1 {
  const root = resolve(options.repositoryRoot ?? new URL("..", import.meta.url).pathname)
  return verifyActiveSuccessorAuthorityReleaseWithHostV1(createNodeGitAuthorityReleaseHostV1(root), options.gitRef)
}

export function verifyCurrentSuccessorAuthorityGovernanceV1(options: {
  readonly repositoryRoot?: string
  readonly gitRef?: string
} = {}): "scaffolding" | "candidate" | "reviewed" | "active" {
  const root = resolve(options.repositoryRoot ?? new URL("..", import.meta.url).pathname)
  const gitRef = options.gitRef ?? "HEAD"
  const host = createNodeGitAuthorityReleaseHostV1(root)
  if (host.readWorktreeEntry(V11_ACTIVE_AUTHORITY_POINTER_PATH) !== null || host.readGitEntry(gitRef, V11_ACTIVE_AUTHORITY_POINTER_PATH) !== null) {
    verifyActiveSuccessorAuthorityReleaseWithHostV1(host, gitRef)
    return "active"
  }
  if (host.readWorktreeEntry(V11_REVIEW_EVIDENCE_PATH) !== null || host.readGitEntry(gitRef, V11_REVIEW_EVIDENCE_PATH) !== null) {
    verifyReviewedSuccessorAuthorityReleaseWithHostV1(host, gitRef)
    return "reviewed"
  }
  if (host.readGitEntry(gitRef, `${V11_RELEASE_DIRECTORY}/main.md`) !== null) {
    verifyInactiveSuccessorAuthorityCandidateWithHostV1(host, gitRef)
    return "candidate"
  }
  return "scaffolding"
}

export function assembleSuccessorReviewEvidenceV1(options: { readonly repositoryRoot?: string } = {}): Uint8Array {
  const root = resolve(options.repositoryRoot ?? new URL("..", import.meta.url).pathname)
  return assembleSuccessorReviewEvidenceWithHostV1(createNodeGitAuthorityReleaseHostV1(root))
}

export function promoteInitialSuccessorAuthorityReleaseV1(options: {
  readonly repositoryRoot?: string
  readonly parentGitRef?: string
} = {}): ValidatedSuccessorAuthorityReleaseV1 {
  const root = resolve(options.repositoryRoot ?? new URL("..", import.meta.url).pathname)
  return promoteInitialSuccessorAuthorityReleaseWithHostV1(createNodeGitAuthorityReleaseHostV1(root), options.parentGitRef)
}

function verifyExactInventory(
  host: CollaborationAuthorityReleaseHostV1,
  expectedPaths: readonly string[],
  label: string,
): void {
  const actual = [...host.listWorktreeFiles(V11_RELEASE_DIRECTORY)].sort(compareUtf8)
  const expected = [...expectedPaths].sort(compareUtf8)
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    fail(`${V11_RELEASE_DIRECTORY} must contain exactly the ${label}`)
  }
}

function requirePointerAbsent(host: CollaborationAuthorityReleaseHostV1, gitRef: string): void {
  if (host.readWorktreeEntry(V11_ACTIVE_AUTHORITY_POINTER_PATH) !== null) fail("V11 active pointer must remain absent before promotion")
  if (host.readGitEntry(gitRef, V11_ACTIVE_AUTHORITY_POINTER_PATH) !== null) fail("V11 active pointer must remain absent from HEAD before promotion")
}

function verifyFrozenCandidateHistory(host: CollaborationAuthorityReleaseHostV1, gitRef: string): void {
  const current = gatherGitCandidate(host, gitRef)
  validateSuccessorAuthorityCandidateSnapshotV1(current)
  const history = collectHistory(host, gitRef)
  const t0 = findFreezeIndex(host, history)
  if (t0 < 0) fail("collaboration-v11-authority-freeze-t0-unavailable")
  const frozen = gatherGitCandidate(host, history[t0]!)
  for (let index = 0; index <= t0; index += 1) sameCandidate(gatherGitCandidate(host, history[index]!), frozen, `V11 frozen candidate at ${history[index]!}`)
}

function gatherReviewedWorktreeRelease(host: CollaborationAuthorityReleaseHostV1, prospectivePointer: boolean): SuccessorAuthorityReleaseSnapshotV1 {
  const files = gatherReviewedWorktreeFiles(host)
  const pointer = prospectivePointer
    ? buildInitialSuccessorAuthorityPointerV1(
        requireReleaseFile({ files }, `${V11_RELEASE_DIRECTORY}/authority.sha256`),
        requireReleaseFile({ files }, V11_REVIEW_EVIDENCE_PATH),
      )
    : requireWorktreeFile(host, V11_ACTIVE_AUTHORITY_POINTER_PATH).bytes
  return Object.freeze({ activePointerBytes: new Uint8Array(pointer), files })
}

function gatherReviewedWorktreeFiles(
  host: CollaborationAuthorityReleaseHostV1,
  overrides: ReadonlyMap<string, Uint8Array> = new Map(),
): readonly { readonly path: string; readonly bytes: Uint8Array }[] {
  return Object.freeze(V11_REVIEWED_RELEASE_PATHS.map((path) => {
    const override = overrides.get(path)
    if (override !== undefined) return Object.freeze({ path, bytes: new Uint8Array(override) })
    const entry = requireWorktreeFile(host, path)
    if (entry.mode !== 0o644) fail(`${path} must have filesystem mode 0644`)
    return Object.freeze({ path, bytes: new Uint8Array(entry.bytes) })
  }))
}

function gatherReviewedGitRelease(host: CollaborationAuthorityReleaseHostV1, ref: string, prospectivePointer: boolean): SuccessorAuthorityReleaseSnapshotV1 {
  const files = Object.freeze(V11_REVIEWED_RELEASE_PATHS.map((path) => {
    const entry = requireGitBlob(host, ref, path)
    if (entry.mode !== "100644") fail(`${path} must have Git mode 100644 at ${ref}`)
    return Object.freeze({ path, bytes: new Uint8Array(entry.bytes) })
  }))
  const pointer = prospectivePointer
    ? buildInitialSuccessorAuthorityPointerV1(
        requireReleaseFile({ files }, `${V11_RELEASE_DIRECTORY}/authority.sha256`),
        requireReleaseFile({ files }, V11_REVIEW_EVIDENCE_PATH),
      )
    : (() => {
        const entry = requireGitBlob(host, ref, V11_ACTIVE_AUTHORITY_POINTER_PATH)
        if (entry.mode !== "100644") fail(`${V11_ACTIVE_AUTHORITY_POINTER_PATH} must have Git mode 100644 at ${ref}`)
        return entry.bytes
      })()
  return Object.freeze({ activePointerBytes: new Uint8Array(pointer), files })
}

function requireReleaseFile(
  release: { readonly files: readonly { readonly path: string; readonly bytes: Readonly<Uint8Array> }[] },
  path: string,
): Uint8Array {
  const file = release.files.find((candidate) => candidate.path === path)
  if (file === undefined) fail(`missing ${path}`)
  return new Uint8Array(file.bytes)
}

function sameRelease(left: SuccessorAuthorityReleaseSnapshotV1, right: SuccessorAuthorityReleaseSnapshotV1, label: string): void {
  sameBytes(left.activePointerBytes, right.activePointerBytes, `${label} pointer`)
  if (left.files.length !== right.files.length) fail(`${label} cardinality differs`)
  for (let index = 0; index < left.files.length; index += 1) {
    if (left.files[index]!.path !== right.files[index]!.path) fail(`${label} path ${index} differs`)
    sameBytes(left.files[index]!.bytes, right.files[index]!.bytes, `${label} file ${index}`)
  }
}

function findActivationIndex(host: CollaborationAuthorityReleaseHostV1, history: readonly string[]): number {
  let oldest = -1
  for (let index = 0; index < history.length; index += 1) {
    try {
      validateSuccessorAuthorityReleaseSnapshotV1(gatherReviewedGitRelease(host, history[index]!, false))
      oldest = index
    } catch {
      // Trees before the create-only pointer do not contain an active V11 release.
    }
  }
  return oldest
}

function gatherWorktreeCandidate(host: CollaborationAuthorityReleaseHostV1): SuccessorAuthorityCandidateSnapshotV1 {
  return Object.freeze({
    files: Object.freeze(V11_CANDIDATE_PATHS.map((path) => {
      const entry = requireWorktreeFile(host, path)
      if (entry.mode !== 0o644) fail(`${path} must have filesystem mode 0644`)
      return Object.freeze({ path, bytes: new Uint8Array(entry.bytes) })
    })),
  })
}

function gatherGitCandidate(host: CollaborationAuthorityReleaseHostV1, ref: string): SuccessorAuthorityCandidateSnapshotV1 {
  return Object.freeze({
    files: Object.freeze(V11_CANDIDATE_PATHS.map((path) => {
      const entry = requireGitBlob(host, ref, path)
      if (entry.mode !== "100644") fail(`${path} must have Git mode 100644 at ${ref}`)
      return Object.freeze({ path, bytes: new Uint8Array(entry.bytes) })
    })),
  })
}

function findFreezeIndex(host: CollaborationAuthorityReleaseHostV1, history: readonly string[]): number {
  let oldest = -1
  for (let index = 0; index < history.length; index += 1) {
    try {
      validateSuccessorAuthorityCandidateSnapshotV1(gatherGitCandidate(host, history[index]!))
      oldest = index
    } catch {
      // Ancestors before the create-only freeze do not contain the candidate.
    }
  }
  return oldest
}

function collectHistory(host: CollaborationAuthorityReleaseHostV1, ref: string): readonly string[] {
  const history: string[] = []
  const seen = new Set<string>()
  let current: string | null = ref
  while (current !== null) {
    if (seen.has(current)) fail("collaboration-v11-authority-first-parent-cycle")
    seen.add(current)
    history.push(current)
    current = host.firstParent(current)
  }
  return Object.freeze(history)
}

function sameCandidate(left: SuccessorAuthorityCandidateSnapshotV1, right: SuccessorAuthorityCandidateSnapshotV1, label: string): void {
  if (left.files.length !== right.files.length) fail(`${label} cardinality differs`)
  for (let index = 0; index < left.files.length; index += 1) {
    if (left.files[index]!.path !== right.files[index]!.path) fail(`${label} path ${index} differs`)
    sameBytes(left.files[index]!.bytes, right.files[index]!.bytes, `${label} file ${index}`)
  }
}

function requireWorktreeFile(host: CollaborationAuthorityReleaseHostV1, path: string): WorktreeAuthorityEntryV1 & { readonly kind: "regular"; readonly bytes: Readonly<Uint8Array> } {
  const entry = host.readWorktreeEntry(path)
  if (entry === null || entry.kind !== "regular" || entry.bytes === undefined) fail(`${path} must be a regular non-symlink worktree file`)
  return entry as WorktreeAuthorityEntryV1 & { readonly kind: "regular"; readonly bytes: Readonly<Uint8Array> }
}

function requireGitBlob(host: CollaborationAuthorityReleaseHostV1, ref: string, path: string): GitAuthorityEntryV1 & { readonly kind: "blob"; readonly bytes: Readonly<Uint8Array> } {
  const entry = host.readGitEntry(ref, path)
  if (entry === null || entry.kind !== "blob" || entry.bytes === undefined) fail(`${path} must be a Git blob at ${ref}`)
  return entry as GitAuthorityEntryV1 & { readonly kind: "blob"; readonly bytes: Readonly<Uint8Array> }
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>, label: string): void {
  if (left.byteLength !== right.byteLength) fail(`${label} byte length differs`)
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!
  if (difference !== 0) fail(`${label} bytes differ`)
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
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
    return `{${Object.keys(record).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${restrictedJcs(record[key])}`).join(",")}}`
  }
  fail("restricted JCS rejects unsupported values")
}

function decodeJcs(bytes: Readonly<Uint8Array>, label: string): Record<string, unknown> {
  if (bytes.byteLength < 2 || bytes.at(-1) !== 0x0a) fail(`${label} lacks final LF`)
  const text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes).slice(0, -1))
  const value = JSON.parse(text) as unknown
  if (value === null || Array.isArray(value) || typeof value !== "object") fail(`${label} must be an object`)
  if (restrictedJcs(value) !== text) fail(`${label} is not restricted JCS`)
  return value as Record<string, unknown>
}

function fail(message: string): never {
  throw new Error(message)
}

if (import.meta.main) {
  const command = process.argv[2]
  if (command === undefined || command === "--check-current") {
    const phase = verifyCurrentSuccessorAuthorityGovernanceV1()
    process.stdout.write(`collaboration V11/R1 governance phase ${phase} is valid\n`)
  } else if (command === "--check-candidate") {
    verifyInactiveSuccessorAuthorityCandidateV1()
    process.stdout.write("inactive collaboration V11/R1 candidate is frozen and valid\n")
  } else if (command === "--check-reviewed") {
    verifyReviewedSuccessorAuthorityReleaseV1()
    process.stdout.write("reviewed collaboration V11/R1 release is valid and inactive\n")
  } else if (command === "--check-active") {
    verifyActiveSuccessorAuthorityReleaseV1()
    process.stdout.write("active collaboration V11/R1 release and T0 ancestry are valid\n")
  } else if (command === "--assemble-evidence") {
    assembleSuccessorReviewEvidenceV1()
    process.stdout.write("collaboration V11/R1 3/3 review evidence created and validated\n")
  } else if (command === "--promote-sequence-1") {
    promoteInitialSuccessorAuthorityReleaseV1()
    process.stdout.write("collaboration V11/R1 active pointer sequence 1 created and validated\n")
  } else {
    fail("usage: bun scripts/collaboration-authority-v11-release.ts (--check-current|--check-candidate|--check-reviewed|--check-active|--assemble-evidence|--promote-sequence-1)")
  }
}
