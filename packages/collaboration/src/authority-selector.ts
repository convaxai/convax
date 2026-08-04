import { ordinarySha256V2, rawDomainDigestV2, structuredDigestV2 } from "./digest"
import { ProtocolAuthorityErrorV2 } from "./errors"
import { installVerifiedProtocolAuthorityV2, type VerifiedProtocolAuthorityV2 } from "./authority"
import {
  assertDenseArrayV2,
  assertExactKeysV2,
  decodeRestrictedJcsV2,
  sameBytes,
} from "./jcs"

type LowercaseSha256HexV1 = string

export interface AuthorityReleaseFileV1 {
  readonly path: string
  readonly bytes: Readonly<Uint8Array>
}

export interface AuthorityReleaseSnapshotV1 {
  readonly activePointerBytes: Readonly<Uint8Array>
  readonly files: readonly AuthorityReleaseFileV1[]
}

export interface ValidatedAuthorityReleaseV1 {
  readonly format: "convax.validated-authority-release/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly sequence: "1"
  readonly activePointerSha256: LowercaseSha256HexV1
  readonly manifestSha256: LowercaseSha256HexV1
  readonly evidenceSha256: LowercaseSha256HexV1
  readonly protocolBundleSha256: LowercaseSha256HexV1
  readonly protocolDigest: LowercaseSha256HexV1
}

const ROOT = "docs/superpowers/specs/authorities/collaboration-v10/r5"
const MANIFEST_PATH = `${ROOT}/authority.sha256`
const EVIDENCE_PATH = `${ROOT}/review-evidence.json`
const BUNDLE_PATH = `${ROOT}/protocol-schema-bundle-v2.json`
const LEGACY_MANIFEST_PATH = "docs/superpowers/specs/2026-08-01-p2p-v10-authority.sha256"
const LEGACY_MANIFEST_SHA256 = "68a78f5ffdf3222667aaa213a492c3b79db6133f2206da1067a4976138edbcde"
const MANIFEST_SHA256 = "2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed"
const EVIDENCE_SHA256 = "9a781faaa3ed28963066ba3ef28eb4367611568042bb14929feab5c2c884d678"
const BUNDLE_SHA256 = "163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786"
const PROTOCOL_DIGEST = "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5"

const MANIFEST_MEMBERS = Object.freeze([
  ["docs/superpowers/specs/2026-07-31-global-uri-protocol.md", "9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38"],
  [`${ROOT}/appendices/canvas-schema.md`, "2afb080ef3ba3aed259d1d7501b73552fe02a6e826d3a28cafc746caa314eb19"],
  [`${ROOT}/appendices/collaboration-kernel.md`, "cf262f8780b47a0d7b85c0773beebcb6cf97e059ebaa21d8c7439e3afc5c693a"],
  [`${ROOT}/appendices/control-plane.md`, "30f02414b8d4e7f4645584e845eecf67e04e89d895397a26fe543b5cab64cc63"],
  [`${ROOT}/appendices/project-persistence.md`, "5fa9ab986f8f191e595bd7c516014414962eb9d2f57a8a800e0ab0b816def654"],
  [`${ROOT}/main.md`, "4a2da5450c3b3a7d7130255a7aabe971788a09382aefbd8fa77d25c1c0931f72"],
  [BUNDLE_PATH, BUNDLE_SHA256],
] as const)

const REVIEWERS = Object.freeze([
  Object.freeze({
    role: "canvas-intent-runtime",
    task: "/root/canvas_intent_runtime",
    receiptPath: `${ROOT}/reviews/canvas-intent-runtime/receipt.json`,
    reportPath: `${ROOT}/reviews/canvas-intent-runtime/report.md`,
  }),
  Object.freeze({
    role: "collaboration-control-protocol",
    task: "/root/collaboration_api",
    receiptPath: `${ROOT}/reviews/collaboration-api/receipt.json`,
    reportPath: `${ROOT}/reviews/collaboration-api/report.md`,
  }),
  Object.freeze({
    role: "project-native-store",
    task: "/root/project_store_reviewer",
    receiptPath: `${ROOT}/reviews/project-store-reviewer/receipt.json`,
    reportPath: `${ROOT}/reviews/project-store-reviewer/report.md`,
  }),
] as const)

const FILE_PATHS = Object.freeze([
  ...MANIFEST_MEMBERS.slice(0, 5).map(([path]) => path),
  MANIFEST_PATH,
  MANIFEST_MEMBERS[5][0],
  BUNDLE_PATH,
  EVIDENCE_PATH,
  REVIEWERS[0].receiptPath,
  REVIEWERS[0].reportPath,
  REVIEWERS[1].receiptPath,
  REVIEWERS[1].reportPath,
  REVIEWERS[2].receiptPath,
  REVIEWERS[2].reportPath,
])

const ARTIFACTS = Object.freeze([
  Object.freeze({ name: "canvas-schema", format: "convax.canvas-protocol-schema/2", path: MANIFEST_MEMBERS[1][0] }),
  Object.freeze({ name: "collaboration-kernel", format: "convax.collaboration-kernel-protocol-schema/2", path: MANIFEST_MEMBERS[2][0] }),
  Object.freeze({ name: "control-plane", format: "convax.control-plane-protocol-schema/2", path: MANIFEST_MEMBERS[3][0] }),
  Object.freeze({ name: "project-persistence", format: "convax.project-persistence-protocol-schema/2", path: MANIFEST_MEMBERS[4][0] }),
] as const)

const validatedReleaseBundles = new WeakMap<object, unknown>()
const installedAuthorities = new WeakMap<object, VerifiedProtocolAuthorityV2>()

export function validateAuthorityReleaseSnapshotV1(
  snapshot: AuthorityReleaseSnapshotV1,
): ValidatedAuthorityReleaseV1 {
  try {
    assertExactKeysV2(snapshot, ["activePointerBytes", "files"], "AuthorityReleaseSnapshotV1")
    if (!(snapshot.activePointerBytes instanceof Uint8Array)) unavailable("Active pointer must be Uint8Array")
    const pointerBytes = Uint8Array.from(snapshot.activePointerBytes)
    assertDenseArrayV2(snapshot.files, "AuthorityReleaseSnapshotV1 files")
    if (snapshot.files.length !== FILE_PATHS.length) unavailable("Authority snapshot must contain exactly fifteen files")

    const files = new Map<string, Uint8Array>()
    for (let index = 0; index < FILE_PATHS.length; index += 1) {
      const file = snapshot.files[index]
      assertExactKeysV2(file, ["bytes", "path"], `AuthorityReleaseFileV1[${index}]`)
      if (file.path !== FILE_PATHS[index]) unavailable(`Authority snapshot path ${index} is not exact`)
      if (!(file.bytes instanceof Uint8Array)) unavailable(`Authority snapshot bytes ${index} must be Uint8Array`)
      files.set(file.path, Uint8Array.from(file.bytes))
    }

    const manifestBytes = requiredFile(files, MANIFEST_PATH)
    const evidenceBytes = requiredFile(files, EVIDENCE_PATH)
    const bundleBytes = requiredFile(files, BUNDLE_PATH)
    requireDigest(manifestBytes, MANIFEST_SHA256, "manifest")
    requireDigest(evidenceBytes, EVIDENCE_SHA256, "review evidence")
    requireDigest(bundleBytes, BUNDLE_SHA256, "protocol bundle")

    const pointer = decodeJcsFile(pointerBytes, "active pointer")
    validatePointer(pointer)
    if (pointer.manifestSha256 !== ordinarySha256V2(manifestBytes)
      || pointer.evidenceSha256 !== ordinarySha256V2(evidenceBytes)) {
      unavailable("Active pointer payload hashes do not match the snapshot")
    }

    validateManifest(manifestBytes, files)
    const bundle = validateBundle(bundleBytes, files)
    validateEvidence(evidenceBytes, files, bundle.protocolDigest)

    const validated = Object.freeze({
      format: "convax.validated-authority-release/1",
      authorityId: "collaboration-v10",
      revision: "r5",
      sequence: "1",
      activePointerSha256: ordinarySha256V2(pointerBytes),
      manifestSha256: MANIFEST_SHA256,
      evidenceSha256: EVIDENCE_SHA256,
      protocolBundleSha256: BUNDLE_SHA256,
      protocolDigest: PROTOCOL_DIGEST,
    })
    validatedReleaseBundles.set(validated, bundle.value)
    return validated
  } catch (error) {
    if (error instanceof ProtocolAuthorityErrorV2) throw error
    throw new ProtocolAuthorityErrorV2(
      "protocol-schema-bundle-unavailable",
      "The collaboration authority release snapshot is unavailable",
      { cause: error },
    )
  }
}

export function selectInstalledProtocolAuthorityV2(
  validated: ValidatedAuthorityReleaseV1,
): VerifiedProtocolAuthorityV2 {
  const bundle = typeof validated === "object" && validated !== null
    ? validatedReleaseBundles.get(validated)
    : undefined
  if (bundle === undefined) unavailable("The validated authority release is not the live copy-owned result")
  const existing = installedAuthorities.get(validated)
  if (existing !== undefined) return existing
  const installed = installVerifiedProtocolAuthorityV2(bundle)
  installedAuthorities.set(validated, installed)
  return installed
}

function validatePointer(value: unknown): asserts value is Record<string, unknown> & {
  manifestSha256: string
  evidenceSha256: string
} {
  assertExactKeysV2(value, [
    "authorityId", "evidencePath", "evidenceSha256", "format", "manifestPath",
    "manifestSha256", "previousSelection", "revision", "sequence",
  ], "CollaborationActiveAuthorityPointerV1")
  if (value.format !== "convax.collaboration-active-authority-pointer/1"
    || value.authorityId !== "collaboration-v10") unavailable("Active pointer identity is invalid")
  parseRevision(value.revision, "active pointer revision")
  parsePositiveUint64(value.sequence, "active pointer sequence")
  if (value.revision !== "r5" || value.sequence !== "1") unavailable("Active pointer does not select initial R5")
  requireDerivedPath(value.manifestPath, "authority.sha256", "active pointer manifest path")
  requireDerivedPath(value.evidencePath, "review-evidence.json", "active pointer evidence path")
  if (value.manifestPath !== MANIFEST_PATH || value.evidencePath !== EVIDENCE_PATH) unavailable("Active pointer derived paths are invalid")
  requireSha(value.manifestSha256, "active pointer manifest hash")
  requireSha(value.evidenceSha256, "active pointer evidence hash")
  if (value.manifestSha256 !== MANIFEST_SHA256 || value.evidenceSha256 !== EVIDENCE_SHA256) unavailable("Active pointer release hashes are invalid")
  assertExactKeysV2(value.previousSelection, ["kind", "manifestPath", "manifestSha256"], "Initial previousSelection")
  if (value.previousSelection.kind !== "legacy-manifest"
    || value.previousSelection.manifestPath !== LEGACY_MANIFEST_PATH
    || value.previousSelection.manifestSha256 !== LEGACY_MANIFEST_SHA256) {
    unavailable("Initial previousSelection is invalid")
  }
}

function validateManifest(bytes: Uint8Array, files: ReadonlyMap<string, Uint8Array>): void {
  const expected = MANIFEST_MEMBERS.map(([path, expectedDigest]) => {
    const actualDigest = ordinarySha256V2(requiredFile(files, path))
    if (actualDigest !== expectedDigest) unavailable(`Manifest member ${path} differs from the frozen release`)
    return `${expectedDigest}  ${path}\n`
  }).join("")
  if (!sameBytes(bytes, new TextEncoder().encode(expected))) unavailable("Authority manifest bytes are invalid")
}

function validateBundle(
  bytes: Uint8Array,
  files: ReadonlyMap<string, Uint8Array>,
): { protocolDigest: string; value: unknown } {
  const value = decodeJcsFile(bytes, "protocol bundle")
  assertExactKeysV2(value, ["core", "coreDigest", "format", "protocolDigest"], "ProtocolSchemaBundleV2")
  if (value.format !== "convax.protocol-schema-bundle/2") unavailable("Protocol bundle format is invalid")
  requireSha(value.coreDigest, "protocol bundle core digest")
  requireSha(value.protocolDigest, "protocol digest")
  assertExactKeysV2(value.core, [
    "artifacts", "channelContractDigest", "domainRegistry", "format", "limitsDigest",
    "protocolMajor", "typeNamespaces", "uriProtocolDigest", "yjsWireCodec",
  ], "ProtocolSchemaBundleCoreV2")
  if (value.core.format !== "convax.protocol-schema-bundle-core/2" || value.core.protocolMajor !== "2") unavailable("Protocol bundle core identity is invalid")
  assertDenseArrayV2(value.core.artifacts, "Protocol schema artifacts")
  if (value.core.artifacts.length !== ARTIFACTS.length) unavailable("Protocol schema artifact cardinality is invalid")
  for (let index = 0; index < ARTIFACTS.length; index += 1) {
    const expected = ARTIFACTS[index]
    const artifact = value.core.artifacts[index]
    assertExactKeysV2(artifact, ["artifactDigest", "format", "name"], `Protocol schema artifact ${index}`)
    const digest = rawDomainDigestV2("convax.protocol-schema-artifact/2", requiredFile(files, expected.path))
    if (artifact.name !== expected.name || artifact.format !== expected.format || artifact.artifactDigest !== digest) unavailable(`Protocol schema artifact ${index} is invalid`)
  }
  const uriDigest = ordinarySha256V2(requiredFile(files, MANIFEST_MEMBERS[0][0]))
  if (value.core.uriProtocolDigest !== uriDigest) unavailable("URI protocol digest is invalid")
  const coreDigest = structuredDigestV2("convax.protocol-schema-bundle-core/2", value.core)
  if (value.coreDigest !== coreDigest || value.protocolDigest !== coreDigest || coreDigest !== PROTOCOL_DIGEST) unavailable("Protocol core or protocol digest is invalid")
  return { protocolDigest: coreDigest, value }
}

function validateEvidence(bytes: Uint8Array, files: ReadonlyMap<string, Uint8Array>, protocolDigest: string): void {
  const value = decodeJcsFile(bytes, "review evidence")
  assertExactKeysV2(value, [
    "authorityId", "decision", "format", "manifestPath", "manifestSha256",
    "protocolBundleSha256", "protocolDigest", "reviews", "revision",
  ], "CollaborationAuthorityReviewEvidenceV1")
  if (value.format !== "convax.collaboration-authority-review-evidence/1"
    || value.authorityId !== "collaboration-v10" || value.revision !== "r5"
    || value.decision !== "UNCONDITIONAL 3/3 SIGN" || value.manifestPath !== MANIFEST_PATH
    || value.manifestSha256 !== MANIFEST_SHA256 || value.protocolBundleSha256 !== BUNDLE_SHA256
    || value.protocolDigest !== protocolDigest) unavailable("Review evidence release identity is invalid")
  assertDenseArrayV2(value.reviews, "Review evidence reviews")
  if (value.reviews.length !== REVIEWERS.length) unavailable("Review evidence must contain exact 3/3 reviews")
  for (let index = 0; index < REVIEWERS.length; index += 1) {
    const expected = REVIEWERS[index]
    const entry = value.reviews[index]
    assertExactKeysV2(entry, [
      "decision", "receiptPath", "receiptSha256", "reportPath", "reportSha256",
      "reviewerRole", "reviewerTaskPath", "scoreBasisPoints",
    ], `Review evidence entry ${index}`)
    if (entry.reviewerRole !== expected.role || entry.reviewerTaskPath !== expected.task
      || entry.decision !== "UNCONDITIONAL SIGN" || entry.receiptPath !== expected.receiptPath
      || entry.reportPath !== expected.reportPath) unavailable(`Review evidence entry ${index} identity is invalid`)
    requireScore(entry.scoreBasisPoints, `Review evidence score ${index}`)
    requireSha(entry.receiptSha256, `Review evidence receipt hash ${index}`)
    requireSha(entry.reportSha256, `Review evidence report hash ${index}`)
    const receiptBytes = requiredFile(files, expected.receiptPath)
    const reportBytes = requiredFile(files, expected.reportPath)
    requireReport(reportBytes, `review report ${index}`)
    if (ordinarySha256V2(receiptBytes) !== entry.receiptSha256 || ordinarySha256V2(reportBytes) !== entry.reportSha256) unavailable(`Review evidence payload hash ${index} is invalid`)
    validateReceipt(receiptBytes, entry, expected, protocolDigest)
  }
}

function validateReceipt(
  bytes: Uint8Array,
  evidence: Record<string, unknown>,
  expected: (typeof REVIEWERS)[number],
  protocolDigest: string,
): void {
  const value = decodeJcsFile(bytes, `review receipt ${expected.role}`)
  assertExactKeysV2(value, [
    "authorityId", "decision", "format", "manifestPath", "manifestSha256",
    "protocolBundlePath", "protocolBundleSha256", "protocolDigest", "reportPath",
    "reportSha256", "reviewerRole", "reviewerTaskPath", "revision", "scoreBasisPoints",
  ], `CollaborationAuthorityReviewReceiptV1 ${expected.role}`)
  requireScore(value.scoreBasisPoints, `Receipt score ${expected.role}`)
  requireSha(value.reportSha256, `Receipt report hash ${expected.role}`)
  if (value.format !== "convax.collaboration-authority-review-receipt/1"
    || value.authorityId !== "collaboration-v10" || value.revision !== "r5"
    || value.reviewerRole !== expected.role || value.reviewerTaskPath !== expected.task
    || value.decision !== "UNCONDITIONAL SIGN" || value.reportPath !== expected.reportPath
    || value.reportSha256 !== evidence.reportSha256 || value.scoreBasisPoints !== evidence.scoreBasisPoints
    || value.manifestPath !== MANIFEST_PATH || value.manifestSha256 !== MANIFEST_SHA256
    || value.protocolBundlePath !== BUNDLE_PATH || value.protocolBundleSha256 !== BUNDLE_SHA256
    || value.protocolDigest !== protocolDigest) unavailable(`Review receipt ${expected.role} is invalid`)
}

function decodeJcsFile(bytes: Uint8Array, label: string): Record<string, unknown> {
  if (bytes.byteLength < 2 || bytes.at(-1) !== 0x0a) unavailable(`${label} lacks its exact final LF`)
  const value = decodeRestrictedJcsV2(bytes.slice(0, -1))
  assertExactKeysV2(value, Object.keys(value as object), label)
  return value
}

function requiredFile(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const bytes = files.get(path)
  if (!bytes) unavailable(`Required authority file is missing: ${path}`)
  return bytes
}

function requireDigest(bytes: Uint8Array, expected: string, label: string): void {
  if (ordinarySha256V2(bytes) !== expected) unavailable(`${label} whole-file SHA-256 is invalid`)
}

function requireReport(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength < 2 || bytes.at(-1) !== 0x0a) unavailable(`${label} lacks its final LF`)
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    unavailable(`${label} is not UTF-8`, { cause: error })
  }
}

function requireSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) unavailable(`${label} is not lowercase SHA-256`)
}

function parsePositiveUint64(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) unavailable(`${label} is not canonical positive uint64`)
  const parsed = BigInt(value)
  if (parsed > 18_446_744_073_709_551_615n) unavailable(`${label} exceeds uint64`)
}

function parseRevision(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^r[1-9][0-9]*$/u.test(value)) unavailable(`${label} is not a directory revision`)
  parsePositiveUint64(value.slice(1), label)
}

function requireDerivedPath(value: unknown, leaf: "authority.sha256" | "review-evidence.json", label: string): void {
  if (typeof value !== "string") unavailable(`${label} is not a string`)
  const match = /^docs\/superpowers\/specs\/authorities\/collaboration-v10\/(r[1-9][0-9]*)\/(authority\.sha256|review-evidence\.json)$/u.exec(value)
  if (!match || match[2] !== leaf) unavailable(`${label} is not canonical`)
  parseRevision(match[1], label)
  if (match[1] !== "r5") unavailable(`${label} revision is invalid`)
}

function requireScore(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)
    || Object.is(value, -0) || value < 0 || value > 1000) unavailable(`${label} is invalid`)
}

function unavailable(message: string, options?: ErrorOptions): never {
  throw new ProtocolAuthorityErrorV2("protocol-schema-bundle-unavailable", message, options)
}
