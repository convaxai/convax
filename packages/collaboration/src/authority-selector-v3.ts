import {
  installVerifiedSuccessorProtocolAuthorityV3,
  type HistoricalProtocolAuthorityClosureV3,
  type SuccessorProtocolSchemaArtifactRefV3,
  type VerifiedProtocolAuthorityV3,
} from "./successor-frame"
import { ordinarySha256V2 } from "./digest"
import { parseDigestV2 } from "./codecs"
import { ProtocolAuthorityErrorV2 } from "./errors"
import { assertDenseArrayV2, assertExactKeysV2, decodeRestrictedJcsV2, sameBytes } from "./jcs"
import {
  selectInstalledProtocolAuthorityV2,
  type AuthorityReleaseFileV1,
  type ValidatedAuthorityReleaseV1,
} from "./authority-selector"

export interface SuccessorAuthorityCandidateSnapshotV1 {
  readonly files: readonly AuthorityReleaseFileV1[]
}

export interface SuccessorAuthorityReleaseSnapshotV1 extends SuccessorAuthorityCandidateSnapshotV1 {
  readonly activePointerBytes: Readonly<Uint8Array>
}

export interface ValidatedSuccessorAuthorityCandidateV1 {
  readonly format: "convax.validated-authority-candidate/1"
  readonly authorityId: "collaboration-v11"
  readonly revision: "r1"
  readonly manifestSha256: string
  readonly protocolBundleSha256: string
  readonly protocolDigest: string
  readonly historicalProtocolDigest: string
}

export interface ValidatedSuccessorAuthorityReleaseV1 extends Omit<ValidatedSuccessorAuthorityCandidateV1, "format"> {
  readonly format: "convax.validated-authority-release/1"
  readonly sequence: "1"
  readonly activePointerSha256: string
  readonly evidenceSha256: string
}

const ROOT = "docs/superpowers/specs/authorities/collaboration-v11/r1"
const V10_POINTER_PATH = "docs/superpowers/specs/collaboration-v10-active-authority.json"
const V10_POINTER_SHA256 = "f1b6f1e09dba629ab06530b2e21c6ac451cd4c04c82ed21cd7cabfb9b7e78398"
const MANIFEST_PATH = `${ROOT}/authority.sha256`
const EVIDENCE_PATH = `${ROOT}/review-evidence.json`
const BUNDLE_PATH = `${ROOT}/protocol-schema-bundle-v3.json`
const HISTORICAL_PIN_PATH = `${ROOT}/historical-v10-r5-pin.json`
const MANIFEST_SHA256 = "351634036ae88bbe843430bb11b3e9d46e6b9bcd865df4aaf55e50fe55dfb1b4"
const BUNDLE_SHA256 = "180199f3e77e5f4daa9c914f97b8e9a08293ba70e201656efe3bd0c10af70d6c"
const HISTORICAL_PIN_SHA256 = "ac17fd5a5ee5b989909266bc58d616a1476a286ea7f27f7cda5819c0a857f369"
const PROTOCOL_DIGEST = "5fe693c9eb0485814fcbe11b6f0136bbc97870184530748ef58502c22ce7865f"
const HISTORICAL_PROTOCOL_DIGEST = "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5"

const MEMBERS = Object.freeze([
  ["docs/superpowers/specs/2026-07-31-global-uri-protocol.md", "9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38"],
  [`${ROOT}/appendices/canvas-schema.md`, "2d6d756c764ee4510f3e3afbe37a16d42311dcd29e58e91f4811a44486f5a22e"],
  [`${ROOT}/appendices/collaboration-kernel.md`, "194ab07c03feba59c39b90de3ebfa02bba64cdc39884b25dfbd47a364c8b7068"],
  [`${ROOT}/appendices/control-plane.md`, "f27070b5b5560be44a3319c61e6f362d3e44ce9892cd04d4bf9af38060400e9a"],
  [`${ROOT}/appendices/project-persistence.md`, "27d0fa4ffe6ef743655e1fac395da75316030a25d4e582c7e55ea68189a7fcd3"],
  [HISTORICAL_PIN_PATH, HISTORICAL_PIN_SHA256],
  [`${ROOT}/main.md`, "58ef4eb781f87bd0d0ef7e0b11bf5f238fca55fca0efd9f7e9b4c256e338f9ca"],
  [BUNDLE_PATH, BUNDLE_SHA256],
] as const)

const CANDIDATE_PATHS = Object.freeze([
  ...MEMBERS.slice(0, 5).map(([path]) => path),
  MANIFEST_PATH,
  ...MEMBERS.slice(5).map(([path]) => path),
])

const REVIEWERS = Object.freeze([
  { role: "canvas-intent-runtime", receiptPath: `${ROOT}/reviews/canvas-intent-runtime/receipt.json`, reportPath: `${ROOT}/reviews/canvas-intent-runtime/report.md` },
  { role: "collaboration-control-protocol", receiptPath: `${ROOT}/reviews/collaboration-control-protocol/receipt.json`, reportPath: `${ROOT}/reviews/collaboration-control-protocol/report.md` },
  { role: "project-native-store", receiptPath: `${ROOT}/reviews/project-native-store/receipt.json`, reportPath: `${ROOT}/reviews/project-native-store/report.md` },
] as const)

const RELEASE_PATHS = Object.freeze([
  ...CANDIDATE_PATHS,
  EVIDENCE_PATH,
  REVIEWERS[0].receiptPath,
  REVIEWERS[0].reportPath,
  REVIEWERS[1].receiptPath,
  REVIEWERS[1].reportPath,
  REVIEWERS[2].receiptPath,
  REVIEWERS[2].reportPath,
])

const ARTIFACTS = Object.freeze([
  { name: "canvas-schema", format: "convax.canvas-protocol-schema/3", path: MEMBERS[1][0] },
  { name: "collaboration-kernel", format: "convax.collaboration-kernel-protocol-schema/3", path: MEMBERS[2][0] },
  { name: "control-plane", format: "convax.control-plane-protocol-schema/3", path: MEMBERS[3][0] },
  { name: "project-persistence", format: "convax.project-persistence-protocol-schema/3", path: MEMBERS[4][0] },
] as const)

const HISTORICAL_SNAPSHOT = Object.freeze([
  ["docs/superpowers/specs/2026-07-31-global-uri-protocol.md", "9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md", "2afb080ef3ba3aed259d1d7501b73552fe02a6e826d3a28cafc746caa314eb19"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md", "cf262f8780b47a0d7b85c0773beebcb6cf97e059ebaa21d8c7439e3afc5c693a"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md", "30f02414b8d4e7f4645584e845eecf67e04e89d895397a26fe543b5cab64cc63"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md", "5fa9ab986f8f191e595bd7c516014414962eb9d2f57a8a800e0ab0b816def654"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256", "2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/main.md", "4a2da5450c3b3a7d7130255a7aabe971788a09382aefbd8fa77d25c1c0931f72"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json", "163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json", "9a781faaa3ed28963066ba3ef28eb4367611568042bb14929feab5c2c884d678"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json", "0aa11f79e829c875b84b1d3607d464fca64a694f2d9c91df3932a476519209a7"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md", "1944cb5819705a3d2884dcd3b028a0941ab8393f360ecf5ae3e0c69f2ccce018"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json", "30102acddfa9446b67456378d786a19a39b2277b244599d72e4a246732b0441b"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md", "5aadfe677d23469b1d285c9a73198712f3fa48638a95ac01f6a123f07c2bef14"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json", "a4ed7f37cdd33aa982b92c1df85a50371b465fef199b4675057c2d28f34f9c28"],
  ["docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md", "23f5a210a2bba2a2cacae95e19c39b0bd8cbd338c4580be480678ed0438a3fbc"],
] as const)

interface InstalledSuccessorBundleClosureV1 {
  readonly protocolBundleSha256: ReturnType<typeof parseDigestV2>
  readonly artifactRefs: readonly SuccessorProtocolSchemaArtifactRefV3[]
  readonly historicalAuthorityPinSha256: ReturnType<typeof parseDigestV2>
  readonly historicalAuthority: HistoricalProtocolAuthorityClosureV3
}

const candidateBundles = new WeakMap<object, InstalledSuccessorBundleClosureV1>()
const releaseBundles = new WeakMap<object, InstalledSuccessorBundleClosureV1>()
const installed = new WeakMap<object, VerifiedProtocolAuthorityV3>()

export function validateSuccessorAuthorityCandidateSnapshotV1(
  snapshot: SuccessorAuthorityCandidateSnapshotV1,
): ValidatedSuccessorAuthorityCandidateV1 {
  try {
    assertExactKeysV2(snapshot, ["files"], "SuccessorAuthorityCandidateSnapshotV1")
    const files = exactFiles(snapshot.files, CANDIDATE_PATHS)
    const bundle = validateCandidate(files)
    const validated = Object.freeze({
      format: "convax.validated-authority-candidate/1" as const,
      authorityId: "collaboration-v11" as const,
      revision: "r1" as const,
      manifestSha256: MANIFEST_SHA256,
      protocolBundleSha256: BUNDLE_SHA256,
      protocolDigest: PROTOCOL_DIGEST,
      historicalProtocolDigest: HISTORICAL_PROTOCOL_DIGEST,
    })
    candidateBundles.set(validated, bundle)
    return validated
  } catch (error) {
    unavailable("The successor collaboration authority candidate is unavailable", error)
  }
}

export function validateSuccessorAuthorityReleaseSnapshotV1(
  snapshot: SuccessorAuthorityReleaseSnapshotV1,
): ValidatedSuccessorAuthorityReleaseV1 {
  try {
    assertExactKeysV2(snapshot, ["activePointerBytes", "files"], "SuccessorAuthorityReleaseSnapshotV1")
    if (!(snapshot.activePointerBytes instanceof Uint8Array)) throw new Error("successor pointer bytes must be Uint8Array")
    const files = exactFiles(snapshot.files, RELEASE_PATHS)
    const bundle = validateCandidate(files)
    const evidenceBytes = requiredFile(files, EVIDENCE_PATH)
    const evidenceSha256 = ordinarySha256V2(evidenceBytes)
    const pointer = decodeJcs(snapshot.activePointerBytes, "successor active pointer")
    validatePointer(pointer, evidenceSha256)
    validateEvidence(evidenceBytes, files)
    const validated = Object.freeze({
      format: "convax.validated-authority-release/1" as const,
      authorityId: "collaboration-v11" as const,
      revision: "r1" as const,
      sequence: "1" as const,
      activePointerSha256: ordinarySha256V2(snapshot.activePointerBytes),
      manifestSha256: MANIFEST_SHA256,
      evidenceSha256,
      protocolBundleSha256: BUNDLE_SHA256,
      protocolDigest: PROTOCOL_DIGEST,
      historicalProtocolDigest: HISTORICAL_PROTOCOL_DIGEST,
    })
    releaseBundles.set(validated, bundle)
    return validated
  } catch (error) {
    unavailable("The successor collaboration authority release is unavailable", error)
  }
}

export function selectInstalledProtocolAuthorityV3(
  validated: ValidatedSuccessorAuthorityReleaseV1,
  historical: ValidatedAuthorityReleaseV1,
): VerifiedProtocolAuthorityV3 {
  const bundle = typeof validated === "object" && validated !== null ? releaseBundles.get(validated) : undefined
  if (bundle === undefined) unavailable("The V11 authority is not a live fully reviewed release")
  const v2 = selectInstalledProtocolAuthorityV2(historical)
  if (v2.protocolDigest !== validated.historicalProtocolDigest) unavailable("The live V10 historical authority does not match V11")
  const existing = installed.get(validated)
  if (existing !== undefined) return existing
  const authority = installVerifiedSuccessorProtocolAuthorityV3({
    protocolDigest: parseDigestV2(validated.protocolDigest),
    protocolBundleSha256: bundle.protocolBundleSha256,
    artifactRefs: bundle.artifactRefs,
    historicalAuthorityPinSha256: bundle.historicalAuthorityPinSha256,
    historicalAuthority: bundle.historicalAuthority,
  })
  installed.set(validated, authority)
  return authority
}

function validateCandidate(files: ReadonlyMap<string, Uint8Array>): InstalledSuccessorBundleClosureV1 {
  const manifest = requiredFile(files, MANIFEST_PATH)
  const bundleBytes = requiredFile(files, BUNDLE_PATH)
  requireDigest(manifest, MANIFEST_SHA256, "V11 manifest")
  requireDigest(bundleBytes, BUNDLE_SHA256, "V11 bundle")
  requireDigest(requiredFile(files, HISTORICAL_PIN_PATH), HISTORICAL_PIN_SHA256, "V10 historical pin")
  const expectedManifest = MEMBERS.map(([path, digest]) => {
    requireDigest(requiredFile(files, path), digest, `V11 member ${path}`)
    return `${digest}  ${path}\n`
  }).join("")
  if (!sameBytes(manifest, new TextEncoder().encode(expectedManifest))) throw new Error("V11 manifest bytes differ")
  const historicalAuthority = validateHistoricalPin(decodeJcs(requiredFile(files, HISTORICAL_PIN_PATH), "V10 historical pin"))
  const bundle = decodeJcs(bundleBytes, "V11 protocol bundle")
  assertExactKeysV2(bundle, ["core", "coreDigest", "format", "protocolDigest"], "ProtocolSchemaBundleV3")
  if (bundle.format !== "convax.protocol-schema-bundle/3" || bundle.coreDigest !== PROTOCOL_DIGEST || bundle.protocolDigest !== PROTOCOL_DIGEST) throw new Error("V11 bundle identity differs")
  const core = bundle.core as Record<string, unknown>
  assertExactKeysV2(core, ["artifacts", "digestDomains", "format", "frameMagic", "historicalAuthorityPinSha256", "historicalProtocolDigest", "ownerIntentFormat", "protocolMajor", "typeNamespaces", "uriProtocolDigest", "yjsWireCodec"], "ProtocolSchemaBundleCoreV3")
  if (core.format !== "convax.protocol-schema-bundle-core/3" || core.protocolMajor !== "3" || core.frameMagic !== "CVXCOLL3" || core.ownerIntentFormat !== "convax.typed-intent/2" || core.historicalAuthorityPinSha256 !== HISTORICAL_PIN_SHA256 || core.historicalProtocolDigest !== HISTORICAL_PROTOCOL_DIGEST) throw new Error("V11 bundle core identity differs")
  const artifactValues = core.artifacts
  assertDenseArrayV2(artifactValues, "V11 artifacts")
  if (artifactValues.length !== ARTIFACTS.length) throw new Error("V11 artifact count differs")
  for (let index = 0; index < ARTIFACTS.length; index += 1) {
    const actual = artifactValues[index] as Record<string, unknown>
    const expected = ARTIFACTS[index]!
    assertExactKeysV2(actual, ["artifactDigest", "format", "name"], `V11 artifact ${index}`)
    const digest = domainDigestV3("convax.protocol-schema-artifact/3", requiredFile(files, expected.path))
    if (actual.name !== expected.name || actual.format !== expected.format || actual.artifactDigest !== digest) throw new Error(`V11 artifact ${index} differs`)
  }
  if (domainDigestV3("convax.protocol-schema-bundle-core/3", encodeRestrictedJcsForDigest(core)) !== PROTOCOL_DIGEST) throw new Error("V11 protocol digest differs")
  const artifactRefs = Object.freeze(ARTIFACTS.map((expected, index) => {
    const actual = artifactValues[index] as Record<string, unknown>
    return Object.freeze({
      name: expected.name,
      format: expected.format,
      artifactDigest: parseDigestV2(actual.artifactDigest),
    })
  }))
  return Object.freeze({
    protocolBundleSha256: parseDigestV2(BUNDLE_SHA256),
    artifactRefs,
    historicalAuthorityPinSha256: parseDigestV2(HISTORICAL_PIN_SHA256),
    historicalAuthority,
  })
}

function validateHistoricalPin(value: Record<string, unknown>): HistoricalProtocolAuthorityClosureV3 {
  assertExactKeysV2(value, ["activePointer", "authorityId", "evidence", "format", "manifest", "protocolBundle", "revision", "snapshot"], "HistoricalAuthorityPinV1")
  if (value.format !== "convax.historical-authority-pin/1" || value.authorityId !== "collaboration-v10" || value.revision !== "r5") throw new Error("historical authority identity differs")
  assertDenseArrayV2(value.snapshot, "historical R5 snapshot")
  if (value.snapshot.length !== 15) throw new Error("historical R5 snapshot must have fifteen members")
  const activePointer = exactPin(value.activePointer, ["path", "sha256"], "historical active pointer")
  const manifest = exactPin(value.manifest, ["path", "sha256"], "historical manifest")
  const evidence = exactPin(value.evidence, ["path", "sha256"], "historical evidence")
  const bundle = value.protocolBundle as Record<string, unknown>
  assertExactKeysV2(bundle, ["path", "protocolDigest", "sha256"], "historical protocol bundle")
  if (activePointer.path !== V10_POINTER_PATH || activePointer.sha256 !== V10_POINTER_SHA256
    || manifest.path !== "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256"
    || manifest.sha256 !== "2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed"
    || evidence.path !== "docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json"
    || evidence.sha256 !== "9a781faaa3ed28963066ba3ef28eb4367611568042bb14929feab5c2c884d678"
    || bundle.path !== "docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json"
    || bundle.sha256 !== "163cabcd8ab5f45acd1fdf7309c747185a6132c9765585a310515f3c968ca786"
    || bundle.protocolDigest !== HISTORICAL_PROTOCOL_DIGEST) throw new Error("historical authority closure differs")
  const snapshotInput = value.snapshot as readonly unknown[]
  const snapshot = Object.freeze(HISTORICAL_SNAPSHOT.map(([path, sha256], index) => {
    const member = exactPin(snapshotInput[index], ["path", "sha256"], `historical snapshot ${index}`)
    if (member.path !== path || member.sha256 !== sha256) throw new Error(`historical snapshot ${index} differs`)
    return Object.freeze({ path, sha256: parseDigestV2(sha256) })
  }))
  return Object.freeze({
    format: "convax.historical-authority-pin/1",
    authorityId: "collaboration-v10",
    revision: "r5",
    activePointerSha256: parseDigestV2(V10_POINTER_SHA256),
    manifestSha256: parseDigestV2(manifest.sha256),
    evidenceSha256: parseDigestV2(evidence.sha256),
    protocolBundleSha256: parseDigestV2(bundle.sha256),
    protocolDigest: parseDigestV2(HISTORICAL_PROTOCOL_DIGEST),
    snapshot,
  })
}

function exactPin(value: unknown, keys: readonly string[], label: string): Record<string, string> {
  assertExactKeysV2(value, keys, label)
  const record = value as Record<string, unknown>
  for (const key of keys) if (typeof record[key] !== "string") throw new Error(`${label} ${key} differs`)
  return record as Record<string, string>
}

function validatePointer(value: Record<string, unknown>, evidenceSha256: string): void {
  assertExactKeysV2(value, ["authorityId", "evidencePath", "evidenceSha256", "format", "manifestPath", "manifestSha256", "previousSelection", "revision", "sequence"], "SuccessorActiveAuthorityPointerV1")
  if (value.format !== "convax.collaboration-active-authority-pointer/1" || value.authorityId !== "collaboration-v11" || value.revision !== "r1" || value.sequence !== "1" || value.manifestPath !== MANIFEST_PATH || value.manifestSha256 !== MANIFEST_SHA256 || value.evidencePath !== EVIDENCE_PATH || value.evidenceSha256 !== evidenceSha256) throw new Error("successor pointer identity differs")
  assertExactKeysV2(value.previousSelection, ["authorityId", "kind", "pointerPath", "pointerSha256", "revision", "sequence"], "Successor previousSelection")
  if (value.previousSelection.kind !== "active-authority" || value.previousSelection.authorityId !== "collaboration-v10" || value.previousSelection.revision !== "r5" || value.previousSelection.sequence !== "1" || value.previousSelection.pointerPath !== V10_POINTER_PATH || value.previousSelection.pointerSha256 !== V10_POINTER_SHA256) throw new Error("successor pointer CAS predecessor differs")
}

function validateEvidence(bytes: Uint8Array, files: ReadonlyMap<string, Uint8Array>): void {
  const value = decodeJcs(bytes, "V11 review evidence")
  assertExactKeysV2(value, ["authorityId", "decision", "format", "manifestPath", "manifestSha256", "protocolBundleSha256", "protocolDigest", "reviews", "revision"], "SuccessorReviewEvidenceV1")
  if (value.format !== "convax.collaboration-authority-review-evidence/2" || value.authorityId !== "collaboration-v11" || value.revision !== "r1" || value.decision !== "UNCONDITIONAL 3/3 SIGN" || value.manifestPath !== MANIFEST_PATH || value.manifestSha256 !== MANIFEST_SHA256 || value.protocolBundleSha256 !== BUNDLE_SHA256 || value.protocolDigest !== PROTOCOL_DIGEST) throw new Error("V11 evidence identity differs")
  assertDenseArrayV2(value.reviews, "V11 reviews")
  if (value.reviews.length !== REVIEWERS.length) throw new Error("V11 requires exact 3/3 reviews")
  for (let index = 0; index < REVIEWERS.length; index += 1) {
    const expected = REVIEWERS[index]!
    const entry = value.reviews[index]
    assertExactKeysV2(entry, ["decision", "receiptPath", "receiptSha256", "reportPath", "reportSha256", "reviewerRole", "scoreBasisPoints"], `V11 review ${index}`)
    if (entry.reviewerRole !== expected.role || entry.decision !== "UNCONDITIONAL SIGN" || entry.receiptPath !== expected.receiptPath || entry.reportPath !== expected.reportPath) throw new Error(`V11 review ${index} identity differs`)
    requireDigest(requiredFile(files, expected.receiptPath), entry.receiptSha256, `V11 receipt ${index}`)
    requireDigest(requiredFile(files, expected.reportPath), entry.reportSha256, `V11 report ${index}`)
    validateReceipt(requiredFile(files, expected.receiptPath), entry, expected)
  }
}

function validateReceipt(bytes: Uint8Array, evidence: Record<string, unknown>, reviewer: (typeof REVIEWERS)[number]): void {
  const value = decodeJcs(bytes, `V11 receipt ${reviewer.role}`)
  assertExactKeysV2(value, ["authorityId", "decision", "format", "manifestPath", "manifestSha256", "protocolBundlePath", "protocolBundleSha256", "protocolDigest", "reportPath", "reportSha256", "reviewerRole", "revision", "scoreBasisPoints"], `V11 receipt ${reviewer.role}`)
  if (value.format !== "convax.collaboration-authority-review-receipt/2" || value.authorityId !== "collaboration-v11" || value.revision !== "r1" || value.reviewerRole !== reviewer.role || value.decision !== "UNCONDITIONAL SIGN" || value.reportPath !== reviewer.reportPath || value.reportSha256 !== evidence.reportSha256 || value.scoreBasisPoints !== evidence.scoreBasisPoints || value.manifestPath !== MANIFEST_PATH || value.manifestSha256 !== MANIFEST_SHA256 || value.protocolBundlePath !== BUNDLE_PATH || value.protocolBundleSha256 !== BUNDLE_SHA256 || value.protocolDigest !== PROTOCOL_DIGEST) throw new Error(`V11 receipt ${reviewer.role} differs`)
}

function exactFiles(input: readonly AuthorityReleaseFileV1[], paths: readonly string[]): ReadonlyMap<string, Uint8Array> {
  assertDenseArrayV2(input, "successor authority files")
  if (input.length !== paths.length) throw new Error(`successor authority requires exactly ${paths.length} files`)
  const files = new Map<string, Uint8Array>()
  for (let index = 0; index < paths.length; index += 1) {
    const file = input[index]
    assertExactKeysV2(file, ["bytes", "path"], `successor authority file ${index}`)
    if (file.path !== paths[index] || !(file.bytes instanceof Uint8Array)) throw new Error(`successor authority file ${index} differs`)
    files.set(file.path, Uint8Array.from(file.bytes))
  }
  return files
}

function decodeJcs(bytes: Readonly<Uint8Array>, label: string): Record<string, unknown> {
  if (bytes.byteLength < 2 || bytes.at(-1) !== 0x0a) throw new Error(`${label} lacks final LF`)
  return decodeRestrictedJcsV2(Uint8Array.from(bytes).slice(0, -1)) as Record<string, unknown>
}

function requiredFile(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const bytes = files.get(path)
  if (bytes === undefined) throw new Error(`missing ${path}`)
  return bytes
}

function requireDigest(bytes: Uint8Array, expected: unknown, label: string): void {
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/u.test(expected) || ordinarySha256V2(bytes) !== expected) throw new Error(`${label} digest differs`)
}

function encodeRestrictedJcsForDigest(value: unknown): Uint8Array {
  const canonical = (entry: unknown): string => {
    if (entry === null || typeof entry === "boolean" || typeof entry === "number" || typeof entry === "string") return JSON.stringify(entry)
    if (Array.isArray(entry)) return `[${entry.map(canonical).join(",")}]`
    if (!entry || typeof entry !== "object") throw new Error("V11 bundle contains unsupported JCS value")
    const object = entry as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`
  }
  return new TextEncoder().encode(canonical(value))
}

function domainDigestV3(domain: `${string}/3`, bytes: Uint8Array): string {
  const domainBytes = new TextEncoder().encode(domain)
  const preimage = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  preimage.set(domainBytes)
  preimage[domainBytes.byteLength] = 0
  preimage.set(bytes, domainBytes.byteLength + 1)
  return ordinarySha256V2(preimage)
}

function unavailable(message: string, cause?: unknown): never {
  if (cause instanceof ProtocolAuthorityErrorV2) throw cause
  throw new ProtocolAuthorityErrorV2("protocol-schema-bundle-unavailable", message, { cause })
}
