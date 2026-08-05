import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import {
  generateSuccessorAuthorityReleaseV1,
  verifyGeneratedSuccessorAuthorityReleaseV1,
} from "../../../scripts/collaboration-authority-v11/generate"

const packageRoot = join(import.meta.dir, "..")
const repositoryRoot = join(packageRoot, "../..")
const temporary = mkdtempSync(join(packageRoot, ".convax-collaboration-pack-"))
const isolatedEnvironment = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary }
const authorityRoot = "docs/superpowers/specs/authorities/collaboration-v10/r5"
const snapshotPaths = Object.freeze([
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
const expectedRuntimeKeys = Object.freeze([
  "CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2",
  "CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES_V2",
  "CollaborationKernelV2",
  "TransientSessionUndoCoordinatorV2",
  "applyUpdateV1V2",
  "assertBoundedNfcStringV2",
  "assertDenseArrayV2",
  "assertDocumentOwnerRuntimeV2",
  "assertExactPruningCoverageV2",
  "assertExactKeysV2",
  "assertNfcScalarStringV2",
  "assertOwnerExternalFactPortV2",
  "assertRemoteImmutableIngressObjectReceiptV2",
  "assertRemoteTransferAttemptBindingV2",
  "compareBytesV2",
  "compareDecodedBase64urlV2",
  "comparePortableStampsV2",
  "compareUtf8V2",
  "createRemoteIngressCapabilityFactoryV2",
  "createSelectedDocumentOwnerArtifactFactoryV2",
  "createWebCryptoEd25519VerifierV2",
  "createYjsDocumentV2",
  "causalFrontierDigestV2",
  "causalHeadRefFromDecodedFrameV2",
  "canonicalStateDigestV2",
  "checkpointContentCertificateCoreDigestV2",
  "checkpointContentCertificateObjectDigestV2",
  "decodeCausalEditFrameV2",
  "decodeBase64urlV2",
  "decodeCheckpointValidationCarrierV2",
  "decodeRestrictedJcsV2",
  "documentScopeDigestV2",
  "encodeBase64urlV2",
  "encodeFullUpdateV2",
  "encodeCheckpointValidationCarrierV2",
  "encodeRestrictedJcsTextV2",
  "encodeRestrictedJcsV2",
  "encodeStateVectorV2",
  "frameObjectRefFromDecodedFrameV2",
  "incrementUint64V2",
  "incomingFrameClosureV2",
  "inspectAcceptedFrameObjectV2",
  "isPlainDataObject",
  "ordinarySha256V2",
  "rawDomainDigestV2",
  "ownerCanonicalizerDescriptorDigestV2",
  "materializeAcceptedFrameV2",
  "maxCausalFrontierV2",
  "parseActorIdV2",
  "parseCanvasIdV2",
  "parseCheckpointContentCertificateCoreV2",
  "parseCheckpointContentCertificateV2",
  "parseCheckpointValidationCarrierIndexBytesV2",
  "parseCheckpointValidationCarrierIndexV2",
  "parseCheckpointValidationCarrierPreambleV2",
  "parseDigestV2",
  "parseDocumentScopeV2",
  "parseId128V2",
  "parseMemberIdV2",
  "parsePeerIdV2",
  "parsePortableStampV2",
  "parsePrunableCheckpointSetCertificateCoreV2",
  "parsePrunableCheckpointSetCertificateV2",
  "parseProjectIdV2",
  "parsePublicKeyV2",
  "parseReplicaIdV2",
  "parseReplicaCausalFloorAckCoreV2",
  "parseReplicaCausalFloorAckV2",
  "parseReplicaCheckpointCoreV2",
  "parseReplicaCheckpointV2",
  "parseSessionIdV2",
  "parseSignatureV2",
  "parseUint32V2",
  "parseUint64V2",
  "parseValidationArtifactSetV2",
  "parseStableCheckpointSetCoreV2",
  "prunableCheckpointSetCertificateCoreDigestV2",
  "prunableCheckpointSetCertificateObjectDigestV2",
  "replicaCausalFloorAckCoreDigestV2",
  "replicaCausalFloorAckObjectDigestV2",
  "replicaCheckpointCoreDigestV2",
  "replicaCheckpointObjectDigestV2",
  "replicaIdToYjsClientIdV2",
  "replicaActorHeadSetDigestV2",
  "selectInstalledProtocolAuthorityV2",
  "selectInstalledProtocolAuthorityV3",
  "selectedSuccessorValidationArtifactSetV3",
  "stableCheckpointSetCoreDigestV2",
  "stateVectorDigestV2",
  "structuredDigestV2",
  "uint32ToNumberV2",
  "uint64ToBigIntV2",
  "validateAuthorityReleaseSnapshotV1",
  "validateSuccessorAuthorityCandidateSnapshotV1",
  "validateSuccessorAuthorityReleaseSnapshotV1",
  "yjsUpdateDigestV2",
  "CollaborationKernelV3",
  "InMemoryProjectSharingHandoffSubmissionV3",
  "SUCCESSOR_AUTHORITY_DOMAINS_V3",
  "SUCCESSOR_CAUSAL_EDIT_MAGIC_V3",
  "SUCCESSOR_PROMOTION_DOMAINS_V3",
  "assertLocalOwnerAuthorityClosureV3",
  "causalHeadRefFromDecodedFrameV3",
  "causalSignerAuthorityDigestV3",
  "createCandidateIncomingFrameAdmissionStrategyV3",
  "createSelectedIncomingAuthorityVerificationPortV3",
  "decodeCausalEditFrameV3",
  "decodeSelectedCausalEditFrame",
  "frameObjectRefFromDecodedFrameV3",
  "incomingFrameClosureV3",
  "inspectAcceptedFrameObjectV3",
  "localOwnerEditAuthorizationCoreDigestV3",
  "localOwnerEditAuthorizationSignatureDigestV3",
  "localProjectOwnerBindingCoreDigestV3",
  "localProjectOwnerBindingSignatureDigestV3",
  "localProjectOwnerKeyIdV3",
  "materializeAcceptedFrameV3",
  "parseCausalAuthorityDependenciesV3",
  "parseCausalSignerAuthorityV3",
  "parseLocalOwnerActorSequenceAllocationPolicyV3",
  "parseLocalOwnerEditAuthorizationCoreV3",
  "parseLocalOwnerEditAuthorizationV3",
  "parseLocalOwnerGenesisAuthorizationPolicyV3",
  "parseLocalProjectOwnerBindingCoreV3",
  "parseLocalProjectOwnerBindingV3",
  "parseProjectSharingHandoffCoreV3",
  "parseProjectSharingHandoffProposalV3",
  "parseProjectSharingHandoffReceiptV3",
  "parseProtocolPromotionBridgeCoreV3",
  "parseProtocolPromotionBridgeV3",
  "parseProtocolPromotionSourceV3",
  "projectSharingHandoffCoreDigestV3",
  "projectSharingHandoffSignatureDigestV3",
  "protocolPromotionBridgeCoreDigestV3",
  "protocolPromotionBridgeSignatureDigestV3",
  "verifyLocalOwnerAuthorityV3",
  "verifyProjectSharingHandoffProposalV3",
  "verifyProjectSharingHandoffReceiptV3",
  "verifyProtocolPromotionBridgeV3",
].sort())

verifyGeneratedSuccessorAuthorityReleaseV1(generateSuccessorAuthorityReleaseV1())
if (await Bun.file(join(repositoryRoot, "docs/superpowers/specs/collaboration-v11-active-authority.json")).exists()) {
  throw new Error("Packed collaboration cannot activate V11 before its exact reviewed pointer promotion")
}

try {
  const pack = Bun.spawnSync({
    cmd: [process.execPath, "pm", "pack", "--ignore-scripts", "--destination", temporary, "--quiet"],
    cwd: packageRoot,
    env: isolatedEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  })
  requireSuccess(pack, "pack")
  const tarballs = readdirSync(temporary).filter((entry) => entry.endsWith(".tgz"))
  if (tarballs.length !== 1) throw new Error(`Expected one tarball, received ${tarballs.length}`)
  const tarball = join(temporary, tarballs[0]!)
  const archive = new Bun.Archive(Bun.gunzipSync(await Bun.file(tarball).bytes()))
  const archiveFiles = await archive.files()
  const entries = [...archiveFiles.keys()]
  if (entries.some((entry) => entry.startsWith("package/src/") || entry.startsWith("package/scripts/") || entry.includes("tsconfig"))) {
    throw new Error("Packed collaboration tarball leaked source, scripts or tsconfig")
  }

  const manifestFile = archiveFiles.get("package/package.json")
  if (!manifestFile) throw new Error("Packed collaboration manifest is missing")
  const manifestText = await manifestFile.text()
  if (/"(?:catalog|workspace):/u.test(manifestText)) throw new Error("Packed manifest contains an unresolved workspace protocol")
  const manifest = JSON.parse(manifestText) as {
    dependencies?: Record<string, string>
    exports?: Record<string, unknown>
  }
  if (JSON.stringify(manifest.dependencies) !== JSON.stringify({ yjs: "13.6.31" })) {
    throw new Error("Packed collaboration manifest must declare only exact yjs@13.6.31")
  }
  if (!manifest.exports || JSON.stringify(Object.keys(manifest.exports)) !== JSON.stringify(["."])) {
    throw new Error("Packed collaboration manifest must expose only the package root")
  }

  const declarationFile = archiveFiles.get("package/dist/index.d.ts")
  if (!declarationFile) throw new Error("Packed root declaration is missing")
  assertExactRootDeclaration(await declarationFile.text())

  const consumer = join(temporary, "consumer")
  const fixture = join(consumer, "fixture")
  mkdirSync(fixture, { recursive: true })
  await Bun.write(join(consumer, "package.json"), JSON.stringify({ name: "collaboration-public-consumer", private: true, type: "module" }))
  const install = Bun.spawnSync({
    cmd: [process.execPath, "add", "--exact", "--ignore-scripts", "--backend=copyfile", "--cache-dir", join(temporary, "bun-cache"), tarball],
    cwd: consumer,
    env: isolatedEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  })
  requireSuccess(install, "external consumer install")

  await Promise.all(snapshotPaths.map(async (path, index) => {
    await Bun.write(join(fixture, `${index}.bin`), await Bun.file(join(repositoryRoot, path)).bytes())
  }))
  await Bun.write(join(fixture, "pointer.bin"), activePointerBytes())

  await Bun.write(join(consumer, "index.ts"), `
import {
  selectInstalledProtocolAuthorityV2,
  selectInstalledProtocolAuthorityV3,
  validateAuthorityReleaseSnapshotV1,
  validateSuccessorAuthorityCandidateSnapshotV1,
  validateSuccessorAuthorityReleaseSnapshotV1,
} from "@convax/collaboration"
import {
  canonicalStateDigestV2,
  checkpointContentCertificateObjectDigestV2,
  decodeCheckpointValidationCarrierV2,
  createYjsDocumentV2,
  CollaborationKernelV2,
  createRemoteIngressCapabilityFactoryV2,
  createSelectedDocumentOwnerArtifactFactoryV2,
  encodeRestrictedJcsV2,
  parseDigestV2,
  parseReplicaCheckpointV2,
  parseCheckpointValidationCarrierPreambleV2,
  rawDomainDigestV2,
  materializeAcceptedFrameV2,
  structuredDigestV2,
  stateVectorDigestV2,
  yjsUpdateDigestV2,
} from "@convax/collaboration"
import type {
  AuthorityReleaseFileV1,
  AuthorityReleaseSnapshotV1,
  CollaborationPersistencePortV2,
  DocumentOwnerRuntimeV2,
  RemoteIngressCapabilityFactoryV2,
  CheckpointValidationCarrierIndexV2,
  SelectedDocumentOwnerArtifactDefinitionV2,
  ValidatedAuthorityReleaseV1,
  SuccessorAuthorityCandidateSnapshotV1,
  SuccessorAuthorityReleaseSnapshotV1,
  ValidatedSuccessorAuthorityReleaseV1,
} from "@convax/collaboration"
declare const file: AuthorityReleaseFileV1
declare const snapshot: AuthorityReleaseSnapshotV1
declare const validated: ValidatedAuthorityReleaseV1
void file
void snapshot
void validated
void selectInstalledProtocolAuthorityV2
void selectInstalledProtocolAuthorityV3
void validateAuthorityReleaseSnapshotV1
void validateSuccessorAuthorityCandidateSnapshotV1
void validateSuccessorAuthorityReleaseSnapshotV1
void CollaborationKernelV2
void canonicalStateDigestV2
void checkpointContentCertificateObjectDigestV2
void decodeCheckpointValidationCarrierV2
void createYjsDocumentV2
void createRemoteIngressCapabilityFactoryV2
void createSelectedDocumentOwnerArtifactFactoryV2
void encodeRestrictedJcsV2
void parseDigestV2
void parseReplicaCheckpointV2
void parseCheckpointValidationCarrierPreambleV2
void rawDomainDigestV2
void materializeAcceptedFrameV2
void structuredDigestV2
void stateVectorDigestV2
void yjsUpdateDigestV2
void (undefined as CheckpointValidationCarrierIndexV2 | CollaborationPersistencePortV2 | DocumentOwnerRuntimeV2 | RemoteIngressCapabilityFactoryV2 | SelectedDocumentOwnerArtifactDefinitionV2<"canvas"> | undefined)
void (undefined as SuccessorAuthorityCandidateSnapshotV1 | SuccessorAuthorityReleaseSnapshotV1 | ValidatedSuccessorAuthorityReleaseV1 | undefined)
`)
  await Bun.write(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { lib: ["ES2022", "DOM"], module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: false, strict: true, target: "ES2022", types: [] },
    include: ["index.ts"],
  }))
  const typecheck = Bun.spawnSync({ cmd: [join(packageRoot, "node_modules", ".bin", "tsc"), "-p", "tsconfig.json"], cwd: consumer, env: isolatedEnvironment, stdout: "pipe", stderr: "pipe" })
  requireSuccess(typecheck, "external consumer positive typecheck")

  await Bun.write(join(consumer, "negative.ts"), `
import { signCausalEditCoreV2, verifyFrozenProtocolAuthorityV2 } from "@convax/collaboration"
import type { CollaborationFailureCodeV2, ProtocolAuthorityErrorV2 } from "@convax/collaboration"
void signCausalEditCoreV2
void verifyFrozenProtocolAuthorityV2
void (undefined as CollaborationFailureCodeV2 | ProtocolAuthorityErrorV2 | undefined)
`)
  await Bun.write(join(consumer, "tsconfig-negative.json"), JSON.stringify({
    compilerOptions: { lib: ["ES2022", "DOM"], module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: false, strict: true, target: "ES2022", types: [] },
    include: ["negative.ts"],
  }))
  const negative = Bun.spawnSync({ cmd: [join(packageRoot, "node_modules", ".bin", "tsc"), "-p", "tsconfig-negative.json"], cwd: consumer, env: isolatedEnvironment, stdout: "pipe", stderr: "pipe" })
  if (negative.exitCode === 0) throw new Error("Legacy sign, verify, and error imports unexpectedly compiled")
  const negativeOutput = `${negative.stdout.toString()}\n${negative.stderr.toString()}`
  for (const forbidden of ["signCausalEditCoreV2", "verifyFrozenProtocolAuthorityV2", "CollaborationFailureCodeV2", "ProtocolAuthorityErrorV2"]) {
    if (!negativeOutput.includes(forbidden)) throw new Error(`Negative typecheck did not reject ${forbidden}`)
  }

  await Bun.write(join(consumer, "runtime.mjs"), runtimeConsumerSource(snapshotPaths))
  const runtime = Bun.spawnSync({ cmd: [process.execPath, "runtime.mjs"], cwd: consumer, env: isolatedEnvironment, stdout: "pipe", stderr: "pipe" })
  requireSuccess(runtime, "external consumer runtime")
  console.log("collaboration authority-selector pack consumer passed")
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

function activePointerBytes(): Uint8Array {
  const text = JSON.stringify({
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
  })
  return new TextEncoder().encode(`${text}\n`)
}

function assertExactRootDeclaration(text: string): void {
  const source = ts.createSourceFile("index.d.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  if (source.parseDiagnostics.length > 0) throw new Error("Packed root declaration is invalid TypeScript")
  const runtimeNames: string[] = []
  const typeNames = new Set<string>()
  for (const [index, statement] of source.statements.entries()) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      throw new Error(`Packed root export declaration ${index} is not an explicit named re-export`)
    }
    for (const element of statement.exportClause.elements) {
      if (statement.isTypeOnly || element.isTypeOnly) typeNames.add(element.name.text)
      else runtimeNames.push(element.name.text)
    }
  }
  if (JSON.stringify(runtimeNames.sort()) !== JSON.stringify(expectedRuntimeKeys)) throw new Error("Packed root runtime declarations are not the exact Task 3 closure")
  for (const required of [
    "ActorIdV2", "DigestV2", "DocumentOwnerRuntimeV2", "DocumentScopeV2", "Id128V2", "MemberIdV2",
    "PeerIdV2", "ProjectIdV2", "ReplicaIdV2", "SelectedDocumentOwnerArtifactDefinitionV2", "SignatureV2",
    "CheckpointContentCertificateV2", "CollaborationPersistencePortV2", "RemoteIngressCapabilityFactoryV2",
    "CheckpointCarrierSectionV2", "CheckpointValidationCarrierIndexV2", "CheckpointValidationCarrierPreambleV2",
    "ReplicaCheckpointV2", "Uint64V2", "ValidationArtifactSetV2",
    "YjsDocumentFactoryV2",
  ]) if (!typeNames.has(required)) throw new Error(`Packed root declaration omits required type ${required}`)
  if (/\bexport\s*\*/u.test(text) || /\bdefault\b/u.test(text)) throw new Error("Packed root declaration contains wildcard or default exports")
}

function runtimeConsumerSource(paths: readonly string[]): string {
  return `
import * as collaboration from "@convax/collaboration"
const expectedKeys = ${JSON.stringify(expectedRuntimeKeys)}
if (JSON.stringify(Object.keys(collaboration).sort()) !== JSON.stringify(expectedKeys)) throw new Error("public runtime namespace is not exact")
const paths = ${JSON.stringify(paths)}
async function snapshot() {
  const files = await Promise.all(paths.map(async (path, index) => ({ path, bytes: new Uint8Array(await Bun.file(new URL(\`./fixture/\${index}.bin\`, import.meta.url)).arrayBuffer()) })))
  const activePointerBytes = new Uint8Array(await Bun.file(new URL("./fixture/pointer.bin", import.meta.url)).arrayBuffer())
  return { activePointerBytes, files }
}
function clone(value) { return { activePointerBytes: Uint8Array.from(value.activePointerBytes), files: value.files.map((file) => ({ path: file.path, bytes: Uint8Array.from(file.bytes) })) } }
function mustReject(value) {
  try { collaboration.validateAuthorityReleaseSnapshotV1(value) } catch (error) {
    if (error?.code === "protocol-schema-bundle-unavailable") return
    throw error
  }
  throw new Error("hostile snapshot was accepted")
}
const golden = await snapshot()
const validated = collaboration.validateAuthorityReleaseSnapshotV1(golden)
if (!Object.isFrozen(validated) || validated.protocolDigest !== "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5") throw new Error("validated release is invalid")
const authority = collaboration.selectInstalledProtocolAuthorityV2(validated)
if (authority.revision !== "r5" || authority.protocolDigest !== validated.protocolDigest) throw new Error("Task 3 live authority selection failed")
const missing = clone(golden); missing.files.pop(); mustReject(missing)
const extra = clone(golden); extra.files.push(extra.files[0]); mustReject(extra)
const unsorted = clone(golden); [unsorted.files[0], unsorted.files[1]] = [unsorted.files[1], unsorted.files[0]]; mustReject(unsorted)
const alias = clone(golden); alias.files[0].path = \`./\${alias.files[0].path}\`; mustReject(alias)
for (const index of [1, 5, 7, 8, 9, 10]) { const hostile = clone(golden); hostile.files[index].bytes[0] ^= 1; mustReject(hostile) }
const hostilePointer = clone(golden); hostilePointer.activePointerBytes[0] ^= 1; mustReject(hostilePointer)
const borrowed = clone(golden)
const copyOwned = collaboration.validateAuthorityReleaseSnapshotV1(borrowed)
const before = JSON.stringify(copyOwned)
borrowed.activePointerBytes[0] = 0
borrowed.files[0].bytes[0] = 0
borrowed.files.reverse()
if (JSON.stringify(copyOwned) !== before || !Object.isFrozen(copyOwned)) throw new Error("validation result retained borrowed input")
for (const subpath of ["authority", "authority-selector", "checkpoint-carrier", "kernel", "owner-runtime", "remote-ingress", "ports", "frame", "yjs-codec", "undo", "dist/index.js"]) {
  try { await import(\`@convax/collaboration/\${subpath}\`); throw new Error(\`deep subpath resolved: \${subpath}\`) } catch (error) {
    if (String(error).includes("deep subpath resolved")) throw error
  }
}
`
}

function requireSuccess(result: ReturnType<typeof Bun.spawnSync>, label: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed\n${result.stdout.toString()}\n${result.stderr.toString()}`)
  }
}
