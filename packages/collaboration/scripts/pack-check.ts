import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const packageRoot = join(import.meta.dir, "..")
const temporary = mkdtempSync(join(packageRoot, ".convax-collaboration-pack-"))
const isolatedEnvironment = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary }
const descriptorPath = join(packageRoot, "protocol", "current.json")
const expectedRuntimeKeys = Object.freeze([
  "CHECKPOINT_VALIDATION_CARRIER_LIMITS",
  "CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES",
  "CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME",
  "CURRENT_PROTOCOL_DESCRIPTOR_FORMAT",
  "CollaborationKernel",
  "TransientSessionUndoCoordinator",
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
  "createRemoteIngressCapabilityFactory",
  "createSelectedDocumentOwnerArtifactFactory",
  "createWebCryptoEd25519Verifier",
  "createYjsDocument",
  "causalFrontierDigest",
  "causalHeadRefFromDecodedFrame",
  "canonicalStateDigest",
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
  "materializeAcceptedFrame",
  "maxCausalFrontier",
  "parseActorId",
  "parseCanvasId",
  "parseCheckpointContentCertificateCore",
  "parseCheckpointContentCertificate",
  "parseCheckpointValidationCarrierIndexBytes",
  "parseCheckpointValidationCarrierIndex",
  "parseCheckpointValidationCarrierPreamble",
  "parseDigest",
  "parseDocumentScope",
  "parseId128",
  "parseMemberId",
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
  "parseCurrentProtocolDescriptor",
  "stableCheckpointSetCoreDigest",
  "stateVectorDigest",
  "structuredDigest",
  "uint32ToNumber",
  "uint64ToBigInt",
  "yjsUpdateDigest",
  "verifyExactEd25519",
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
  canonicalStateDigest,
  checkpointContentCertificateObjectDigest,
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
  structuredDigest,
  stateVectorDigest,
  yjsUpdateDigest,
} from "@convax/collaboration"
import type {
  CollaborationPersistencePort,
  CurrentProtocolArtifactDescriptor,
  CurrentProtocolDescriptor,
  CurrentProtocolTypeNamespaceDescriptor,
  CurrentProtocolYjsWireCodecDescriptor,
  DocumentOwnerRuntime,
  RemoteIngressCapabilityFactory,
  CheckpointValidationCarrierIndex,
  SelectedDocumentOwnerArtifactDefinition,
} from "@convax/collaboration"
declare const descriptor: CurrentProtocolDescriptor
void descriptor
void CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME
void CURRENT_PROTOCOL_DESCRIPTOR_FORMAT
void currentProtocolDescriptor
void encodeCurrentProtocolDescriptor
void installCurrentProtocolAuthority
void parseCurrentProtocolDescriptor
void CollaborationKernel
void canonicalStateDigest
void checkpointContentCertificateObjectDigest
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
void structuredDigest
void stateVectorDigest
void yjsUpdateDigest
void (undefined as CheckpointValidationCarrierIndex | CollaborationPersistencePort | DocumentOwnerRuntime | RemoteIngressCapabilityFactory | SelectedDocumentOwnerArtifactDefinition<"canvas"> | undefined)
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
import type { CollaborationFailureCode, ProtocolAuthorityError } from "@convax/collaboration"
void signCausalEditCore
void verifyFrozenProtocolAuthority
void (undefined as CollaborationFailureCode | ProtocolAuthorityError | undefined)
`)
  await Bun.write(join(consumer, "tsconfig-negative.json"), JSON.stringify({
    compilerOptions: { lib: ["ES2022", "DOM"], module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: false, strict: true, target: "ES2022", types: [] },
    include: ["negative.ts"],
  }))
  const negative = Bun.spawnSync({ cmd: [join(packageRoot, "node_modules", ".bin", "tsc"), "-p", "tsconfig-negative.json"], cwd: consumer, env: isolatedEnvironment, stdout: "pipe", stderr: "pipe" })
  if (negative.exitCode === 0) throw new Error("Legacy sign, verify, and error imports unexpectedly compiled")
  const negativeOutput = `${negative.stdout.toString()}\n${negative.stderr.toString()}`
  for (const forbidden of ["signCausalEditCore", "verifyFrozenProtocolAuthority", "CollaborationFailureCode", "ProtocolAuthorityError"]) {
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
    "CheckpointCarrierSection", "CheckpointValidationCarrierIndex", "CheckpointValidationCarrierPreamble",
    "ReplicaCheckpoint", "Uint64", "ValidationArtifactSet",
    "YjsDocumentFactory",
  ]) if (!typeNames.has(required)) throw new Error(`Packed root declaration omits required type ${required}`)
  if (/\bexport\s*\*/u.test(text) || /\bdefault\b/u.test(text)) throw new Error("Packed root declaration contains wildcard or default exports")
}

function runtimeConsumerSource(): string {
  return `
import * as collaboration from "@convax/collaboration"
const expectedKeys = ${JSON.stringify(expectedRuntimeKeys)}
if (JSON.stringify(Object.keys(collaboration).sort()) !== JSON.stringify(expectedKeys)) throw new Error("public runtime namespace is not exact")
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
if (descriptor.protocolDigest !== "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5") throw new Error("packaged descriptor digest is not the built digest")
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
