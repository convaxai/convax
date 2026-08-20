import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

import { CURRENT_PROTOCOL_IDENTITIES } from "../src/constants"

const packageRoot = join(import.meta.dir, "..")
const temporary = mkdtempSync(join(packageRoot, ".convax-collaboration-pack-"))
const isolatedEnvironment = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary }
const descriptorPath = join(packageRoot, "protocol", "current.json")
const expectedRuntimeKeys = Object.freeze([
  "ACCEPTED_FRAME_OUTBOX_REQUIREMENT",
  "CHECKPOINT_VALIDATION_CARRIER_LIMITS",
  "CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES",
  "CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME",
  "CURRENT_PROTOCOL_DESCRIPTOR_FORMAT",
  "CURRENT_PROTOCOL_IDENTITIES",
  "CollaborationKernel",
  "OWNER_STATE_CANONICAL_KEY_PATH_POLICY",
  "OWNER_STATE_COMMITMENT_CODEC",
  "OWNER_STATE_MAX_CANONICAL_KEY_UTF8_BYTES",
  "OWNER_STATE_MAX_CANONICAL_NAME_UTF8_BYTES",
  "TransientSessionUndoCoordinator",
  "acceptedHeadMaterializedStateDigest",
  "applyYjsUpdate",
  "assertBoundedNfcString",
  "assertDenseArray",
  "assertDocumentOwnerRuntime",
  "assertExactPruningCoverage",
  "assertExactKeys",
  "assertNfcScalarString",
  "assertOwnerExternalFactPort",
  "assertRemoteImmutableIngressObjectReceipt",
  "assertRemoteTransferAttemptBinding",
  "compareBytes",
  "compareDecodedBase64url",
  "comparePortableStamps",
  "compareUtf8",
  "consumeOwnerStateCommitmentDigest",
  "createRemoteIngressCapabilityFactory",
  "createSelectedDocumentOwnerArtifactFactory",
  "createWebCryptoEd25519Verifier",
  "createYjsDocument",
  "causalFrontierDigest",
  "causalHeadRefFromDecodedFrame",
  "causalSignerAuthorityDigest",
  "canonicalStateDigest",
  "collaborationLatencyStages",
  "checkpointContentCertificateCoreDigest",
  "checkpointContentCertificateObjectDigest",
  "decodeCausalEditFrame",
  "decodeBase64url",
  "decodeCheckpointValidationCarrier",
  "decodeRestrictedJcs",
  "documentScopeDigest",
  "encodeBase64url",
  "encodeFullUpdate",
  "encodeCheckpointValidationCarrier",
  "encodeRestrictedJcsText",
  "encodeRestrictedJcs",
  "encodeStateVector",
  "frameObjectRefFromDecodedFrame",
  "incrementUint64",
  "incomingFrameClosure",
  "inspectAcceptedFrameObject",
  "isPlainDataObject",
  "ordinarySha256",
  "rawDomainDigest",
  "ownerCanonicalizerDescriptorDigest",
  "ownerStateCommitmentDescriptorDigest",
  "materializeAcceptedFrame",
  "maxCausalFrontier",
  "parseActorId",
  "parseAcceptedHeadDurableDeltaMetadata",
  "parseCausalSignerAuthority",
  "parseCanvasId",
  "parseCheckpointContentCertificateCore",
  "parseCheckpointContentCertificate",
  "parseCheckpointValidationCarrierIndexBytes",
  "parseCheckpointValidationCarrierIndex",
  "parseCheckpointValidationCarrierPreamble",
  "parseDigest",
  "parseDocumentScope",
  "parseId128",
  "parseLocalOwnerEditAuthorizationCore",
  "parseMemberId",
  "parseOwnerStateCommitmentDescriptor",
  "parsePeerId",
  "parsePortableStamp",
  "parsePrunableCheckpointSetCertificateCore",
  "parsePrunableCheckpointSetCertificate",
  "parseProjectId",
  "parsePublicKey",
  "parseReplicaId",
  "parseReplicaCausalFloorAckCore",
  "parseReplicaCausalFloorAck",
  "parseReplicaCheckpointCore",
  "parseReplicaCheckpoint",
  "parseSessionId",
  "parseSignature",
  "parseUint32",
  "parseUint64",
  "parseValidationArtifactSet",
  "parseStableCheckpointSetCore",
  "prunableCheckpointSetCertificateCoreDigest",
  "prunableCheckpointSetCertificateObjectDigest",
  "replicaCausalFloorAckCoreDigest",
  "replicaCausalFloorAckObjectDigest",
  "replicaCheckpointCoreDigest",
  "replicaCheckpointObjectDigest",
  "replicaIdToYjsClientId",
  "replicaActorHeadSetDigest",
  "currentProtocolDescriptor",
  "encodeCurrentProtocolDescriptor",
  "installCurrentProtocolAuthority",
  "localOwnerEditAuthorizationCoreDigest",
  "parseCurrentProtocolDescriptor",
  "stableCheckpointSetCoreDigest",
  "stateVectorDigest",
  "structuredDigest",
  "uint32ToNumber",
  "uint64ToBigInt",
  "validateAcceptedHeadMaterializationEvidence",
  "yjsUpdateDigest",
  "verifyExactEd25519",
].sort())
const expectedMigrationRuntimeKeys = Object.freeze([
  "IMMEDIATE_PREDECESSOR_PROTOCOL",
  "assertImmediatePredecessorCheckpointMaterializesHead",
  "createImmediatePredecessorReplaySession",
  "immediatePredecessorLocalOwnerEditAuthorizationCoreDigest",
  "verifyImmediatePredecessorCheckpoint",
  "verifyImmediatePredecessorFrame",
].sort())

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
  if (!manifest.exports || JSON.stringify(Object.keys(manifest.exports)) !== JSON.stringify([".", "./migration"])) {
    throw new Error("Packed collaboration manifest must expose only the current root and sealed migration entry")
  }

  const packagedDescriptorFile = archiveFiles.get("package/protocol/current.json")
  if (!packagedDescriptorFile) throw new Error("Packed current protocol descriptor is missing")
  const packagedDescriptor = JSON.parse(await packagedDescriptorFile.text()) as {
    artifacts?: readonly { digest?: string; name?: string }[]
  }
  if (!Array.isArray(packagedDescriptor.artifacts) || packagedDescriptor.artifacts.length !== 4) {
    throw new Error("Packed current protocol descriptor has an invalid artifact closure")
  }
  for (const artifact of packagedDescriptor.artifacts) {
    if (typeof artifact.name !== "string" || typeof artifact.digest !== "string") {
      throw new Error("Packed current protocol descriptor has an invalid artifact entry")
    }
    const artifactFile = archiveFiles.get(`package/protocol/artifacts/${artifact.name}.json`)
    if (!artifactFile) throw new Error(`Packed current protocol artifact is missing: ${artifact.name}`)
    const bytes = new Uint8Array(await artifactFile.arrayBuffer())
    if (bytes.at(-1) !== 0x0a) throw new Error(`Packed current protocol artifact lacks its exact trailing LF: ${artifact.name}`)
    if (protocolArtifactDigest(bytes) !== artifact.digest) {
      throw new Error(`Packed current protocol artifact digest mismatch: ${artifact.name}`)
    }
  }

  const declarationFile = archiveFiles.get("package/dist/index.d.ts")
  if (!declarationFile) throw new Error("Packed root declaration is missing")
  assertExactRootDeclaration(await declarationFile.text())
  if (!archiveFiles.has("package/dist/migration.d.ts")) throw new Error("Packed migration declaration is missing")

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

  await Bun.write(join(fixture, "current.json"), await Bun.file(descriptorPath).bytes())

  await Bun.write(join(consumer, "index.ts"), `
import {
  CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME,
  CURRENT_PROTOCOL_DESCRIPTOR_FORMAT,
  currentProtocolDescriptor,
  encodeCurrentProtocolDescriptor,
  installCurrentProtocolAuthority,
  parseCurrentProtocolDescriptor,
} from "@convax/collaboration"
import {
  ACCEPTED_FRAME_OUTBOX_REQUIREMENT,
  canonicalStateDigest,
  checkpointContentCertificateObjectDigest,
  consumeOwnerStateCommitmentDigest,
  decodeCheckpointValidationCarrier,
  createYjsDocument,
  CollaborationKernel,
  createRemoteIngressCapabilityFactory,
  createSelectedDocumentOwnerArtifactFactory,
  encodeRestrictedJcs,
  parseDigest,
  parseReplicaCheckpoint,
  parseCheckpointValidationCarrierPreamble,
  rawDomainDigest,
  materializeAcceptedFrame,
  parseAcceptedHeadDurableDeltaMetadata,
  ownerStateCommitmentDescriptorDigest,
  parseOwnerStateCommitmentDescriptor,
  structuredDigest,
  stateVectorDigest,
  validateAcceptedHeadMaterializationEvidence,
  yjsUpdateDigest,
} from "@convax/collaboration"
import type {
  AcceptedFrameAtomicCommitPortEvidence,
  AcceptedFrameAtomicQuarantinePortEvidence,
  AcceptedHeadDurableDeltaMetadata,
  AcceptedHeadIdentityView,
  AcceptedHeadTransitionView,
  CollaborationPersistencePort,
  CommitAcceptedFramePortRequest,
  CommitAcceptedFramePortResult,
  CurrentProtocolArtifactDescriptor,
  CurrentProtocolDescriptor,
  CurrentProtocolTypeNamespaceDescriptor,
  CurrentProtocolYjsWireCodecDescriptor,
  DocumentOwnerRuntime,
  RemoteIngressCapabilityFactory,
  CheckpointValidationCarrierIndex,
  OwnerStateCommitmentDescriptor,
  SelectedDocumentOwnerArtifactDefinition,
  ValidatedAcceptedHeadTransition,
} from "@convax/collaboration"
import {
  IMMEDIATE_PREDECESSOR_PROTOCOL,
  assertImmediatePredecessorCheckpointMaterializesHead,
  createImmediatePredecessorReplaySession,
  immediatePredecessorLocalOwnerEditAuthorizationCoreDigest,
  verifyImmediatePredecessorCheckpoint,
  verifyImmediatePredecessorFrame,
} from "@convax/collaboration/migration"
import type {
  ImmediatePredecessorCheckpointSignatureVerifier,
  ImmediatePredecessorOwnerProjectionPort,
  ImmediatePredecessorReplayHead,
  ImmediatePredecessorReplaySession,
  ImmediatePredecessorSignatureVerifier,
  VerifiedImmediatePredecessorCheckpoint,
  VerifiedImmediatePredecessorFrame,
} from "@convax/collaboration/migration"
declare const descriptor: CurrentProtocolDescriptor
void descriptor
void CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME
void CURRENT_PROTOCOL_DESCRIPTOR_FORMAT
void currentProtocolDescriptor
void encodeCurrentProtocolDescriptor
void installCurrentProtocolAuthority
void parseCurrentProtocolDescriptor
void CollaborationKernel
void ACCEPTED_FRAME_OUTBOX_REQUIREMENT
void canonicalStateDigest
void checkpointContentCertificateObjectDigest
void consumeOwnerStateCommitmentDigest
void decodeCheckpointValidationCarrier
void createYjsDocument
void createRemoteIngressCapabilityFactory
void createSelectedDocumentOwnerArtifactFactory
void encodeRestrictedJcs
void parseDigest
void parseReplicaCheckpoint
void parseCheckpointValidationCarrierPreamble
void rawDomainDigest
void materializeAcceptedFrame
void parseAcceptedHeadDurableDeltaMetadata
void ownerStateCommitmentDescriptorDigest
void parseOwnerStateCommitmentDescriptor
void structuredDigest
void stateVectorDigest
void validateAcceptedHeadMaterializationEvidence
void yjsUpdateDigest
void IMMEDIATE_PREDECESSOR_PROTOCOL
void assertImmediatePredecessorCheckpointMaterializesHead
void createImmediatePredecessorReplaySession
void immediatePredecessorLocalOwnerEditAuthorizationCoreDigest
void verifyImmediatePredecessorCheckpoint
void verifyImmediatePredecessorFrame
void (undefined as ImmediatePredecessorCheckpointSignatureVerifier | ImmediatePredecessorOwnerProjectionPort | ImmediatePredecessorReplayHead | ImmediatePredecessorReplaySession | ImmediatePredecessorSignatureVerifier | VerifiedImmediatePredecessorCheckpoint | VerifiedImmediatePredecessorFrame | undefined)
void (undefined as AcceptedFrameAtomicCommitPortEvidence | AcceptedFrameAtomicQuarantinePortEvidence | AcceptedHeadDurableDeltaMetadata | AcceptedHeadIdentityView | AcceptedHeadTransitionView | CheckpointValidationCarrierIndex | CollaborationPersistencePort | CommitAcceptedFramePortRequest | CommitAcceptedFramePortResult | DocumentOwnerRuntime | OwnerStateCommitmentDescriptor | RemoteIngressCapabilityFactory | SelectedDocumentOwnerArtifactDefinition<"canvas"> | ValidatedAcceptedHeadTransition | undefined)
void (undefined as CurrentProtocolArtifactDescriptor | CurrentProtocolTypeNamespaceDescriptor | CurrentProtocolYjsWireCodecDescriptor | undefined)
`)
  await Bun.write(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { lib: ["ES2022", "DOM"], module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: false, strict: true, target: "ES2022", types: [] },
    include: ["index.ts"],
  }))
  const typecheck = Bun.spawnSync({ cmd: [join(packageRoot, "node_modules", ".bin", "tsc"), "-p", "tsconfig.json"], cwd: consumer, env: isolatedEnvironment, stdout: "pipe", stderr: "pipe" })
  requireSuccess(typecheck, "external consumer positive typecheck")

  await Bun.write(join(consumer, "negative.ts"), `
import { signCausalEditCore, verifyFrozenProtocolAuthority } from "@convax/collaboration"
import type { CollaborationFailureCode, CollaborationPersistencePort, CompareAndCommitReplicaHeadPortResult, ProtocolAuthorityError } from "@convax/collaboration"
declare const persistence: CollaborationPersistencePort
void signCausalEditCore
void verifyFrozenProtocolAuthority
void persistence.putImmutableFrame
void persistence.putReplicationOutboxRef
void persistence.appendFrameJournal
void persistence.compareAndCommitReplicaHead
void (undefined as CollaborationFailureCode | CompareAndCommitReplicaHeadPortResult | ProtocolAuthorityError | undefined)
`)
  await Bun.write(join(consumer, "tsconfig-negative.json"), JSON.stringify({
    compilerOptions: { lib: ["ES2022", "DOM"], module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: false, strict: true, target: "ES2022", types: [] },
    include: ["negative.ts"],
  }))
  const negative = Bun.spawnSync({ cmd: [join(packageRoot, "node_modules", ".bin", "tsc"), "-p", "tsconfig-negative.json"], cwd: consumer, env: isolatedEnvironment, stdout: "pipe", stderr: "pipe" })
  if (negative.exitCode === 0) throw new Error("Legacy sign, verify, and error imports unexpectedly compiled")
  const negativeOutput = `${negative.stdout.toString()}\n${negative.stderr.toString()}`
  for (const forbidden of ["signCausalEditCore", "verifyFrozenProtocolAuthority", "CollaborationFailureCode", "CompareAndCommitReplicaHeadPortResult", "ProtocolAuthorityError", "putImmutableFrame", "putReplicationOutboxRef", "appendFrameJournal", "compareAndCommitReplicaHead"]) {
    if (!negativeOutput.includes(forbidden)) throw new Error(`Negative typecheck did not reject ${forbidden}`)
  }

  await Bun.write(join(consumer, "runtime.mjs"), runtimeConsumerSource())
  const runtime = Bun.spawnSync({ cmd: [process.execPath, "runtime.mjs"], cwd: consumer, env: isolatedEnvironment, stdout: "pipe", stderr: "pipe" })
  requireSuccess(runtime, "external consumer runtime")
  console.log("collaboration current-protocol pack consumer passed")
} finally {
  rmSync(temporary, { recursive: true, force: true })
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
    "ActorId", "Digest", "DocumentOwnerRuntime", "DocumentScope", "Id128", "MemberId",
    "PeerId", "ProjectId", "ReplicaId", "SelectedDocumentOwnerArtifactDefinition", "Signature",
    "CheckpointContentCertificate", "CollaborationPersistencePort", "RemoteIngressCapabilityFactory",
    "CollaborationLatencyDiagnostic", "CollaborationLatencyDiagnosticsPort", "CollaborationLatencySample",
    "CollaborationLatencyStage", "AcceptedHeadIdentityView", "AcceptedHeadTransitionView",
    "AcceptedHeadDurableDeltaMetadata", "ValidatedAcceptedHeadTransition",
    "CommitAcceptedFramePortRequest", "CommitAcceptedFramePortResult",
    "AcceptedFrameAtomicCommitPortEvidence", "AcceptedFrameAtomicQuarantinePortEvidence",
    "OwnerStateCommitmentDescriptor",
    "CheckpointCarrierSection", "CheckpointValidationCarrierIndex", "CheckpointValidationCarrierPreamble",
    "ReplicaCheckpoint", "Uint64", "ValidationArtifactSet",
    "YjsDocumentFactory",
  ]) if (!typeNames.has(required)) throw new Error(`Packed root declaration omits required type ${required}`)
  if (/\bexport\s*\*/u.test(text) || /\bdefault\b/u.test(text)) throw new Error("Packed root declaration contains wildcard or default exports")
}

function runtimeConsumerSource(): string {
  return `
import * as collaboration from "@convax/collaboration"
import * as migration from "@convax/collaboration/migration"
const expectedKeys = ${JSON.stringify(expectedRuntimeKeys)}
const expectedMigrationKeys = ${JSON.stringify(expectedMigrationRuntimeKeys)}
if (JSON.stringify(Object.keys(collaboration).sort()) !== JSON.stringify(expectedKeys)) throw new Error("public runtime namespace is not exact")
if (JSON.stringify(Object.keys(migration).sort()) !== JSON.stringify(expectedMigrationKeys)) throw new Error("migration runtime namespace is not exact")
if (migration.IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest !== "8295f918e8f7b8297c080db03672fc410542280f639d9b40a8e324e560f07ae9") throw new Error("migration predecessor identity drifted")
function mustReject(bytes) {
  try { collaboration.parseCurrentProtocolDescriptor(bytes) } catch (error) {
    if (error?.code === "protocol-schema-bundle-unavailable") return
    throw error
  }
  throw new Error("drifted descriptor was accepted")
}
const packaged = new Uint8Array(await Bun.file(new URL("./fixture/current.json", import.meta.url)).arrayBuffer())
const descriptor = collaboration.parseCurrentProtocolDescriptor(packaged)
if (!Object.isFrozen(descriptor) || descriptor.format !== collaboration.CURRENT_PROTOCOL_DESCRIPTOR_FORMAT) throw new Error("packaged descriptor is invalid")
if (descriptor.protocolDigest !== ${JSON.stringify(CURRENT_PROTOCOL_IDENTITIES.protocolDigest)}) throw new Error("packaged descriptor digest is not the built digest")
if (collaboration.CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME !== "current.json") throw new Error("descriptor file name is not exact")
const drifted = Uint8Array.from(packaged); drifted[3] ^= 1; mustReject(drifted)
mustReject(packaged.slice(0, -1))
mustReject(new Uint8Array(0))
const authority = collaboration.installCurrentProtocolAuthority(descriptor)
if (authority.protocolDigest !== descriptor.protocolDigest) throw new Error("current authority installation failed")
if (collaboration.installCurrentProtocolAuthority(descriptor) !== authority) throw new Error("current authority is not process-stable")
try { collaboration.installCurrentProtocolAuthority({ ...descriptor }); throw new Error("structural descriptor clone was accepted") } catch (error) {
  if (error?.code !== "protocol-schema-bundle-unavailable") throw error
}
for (const subpath of ["authority", "current-protocol", "checkpoint-carrier", "kernel", "owner-runtime", "remote-ingress", "ports", "frame", "yjs-codec", "undo", "dist/index.js"]) {
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

function protocolArtifactDigest(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(new TextEncoder().encode("convax.protocol-schema-artifact"))
    .update(Uint8Array.of(0))
    .update(bytes)
    .digest("hex")
}
