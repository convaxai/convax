import {
  applyYjsUpdate,
  assertDenseArray,
  assertDocumentOwnerRuntime,
  assertExactKeys,
  canonicalStateDigest as computeCanonicalStateDigest,
  causalFrontierDigest,
  decodeRestrictedJcs,
  encodeFullUpdate,
  encodeRestrictedJcs,
  encodeStateVector,
  ordinarySha256,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseMemberId,
  parseReplicaCheckpoint,
  parseReplicaId,
  parseSignature,
  parseUint32,
  parseUint64,
  parseValidationArtifactSet,
  replicaActorHeadSetDigest,
  replicaCheckpointCoreDigest,
  replicaCheckpointObjectDigest,
  replicaIdToYjsClientId,
  stateVectorDigest,
  structuredDigest,
  yjsUpdateDigest,
  type ActorId,
  type CausalFrontier,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type Id128,
  type MemberId,
  type ReplicaCheckpointCore,
  type ReplicaCheckpoint,
  type ReplicaActorHeadSet,
  type ReplicaId,
  type Signature,
  type StateVector,
  type Uint32,
  type Uint64,
  type ValidationArtifactRef,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import * as Y from "yjs"
import type { CanvasIdentity } from "./types"
import { assertCanvasIdentity } from "./validation"
import {
  createCanvasReconstructionYDoc,
  createCanvasYDoc,
  validateCanvasYDoc,
} from "./ydoc"

const MAGIC = new TextEncoder().encode("CVXCGP03")
const MAX_CARRIER_BYTES = 335_544_320
const INDEX_KEYS = [
  "format", "scope", "checkpointObjectDigest", "fullUpdateDigest", "stateVectorDigest",
  "canonicalStateDigest", "authorAuthorityKind", "authorAuthorityDigest",
  "ownerSchemaDigest", "canonicalizerDigest",
  "validationArtifactSetDigest", "validationArtifacts", "sections", "totalSectionBytes", "protocolDigest",
] as const

export type CanvasGenesisProofCarrierExactBytes = Readonly<Uint8Array>

export interface CanvasGenesisProofCarrierSectionLocation {
  readonly byteOffset: Uint64
  readonly byteLength: Uint64
  readonly sha256: Digest
}

type SingletonSectionKind =
  | "checkpoint-author-authority"
  | "checkpoint-canonical-state"
  | "checkpoint-full-update"
  | "checkpoint-state-vector"
  | "checkpoint-wrapper"

export type CanvasGenesisProofCarrierSection = CanvasGenesisProofCarrierSectionLocation & Readonly<{
  kind: SingletonSectionKind | "validation-artifact"
  ordinal: Uint32
  subject: Readonly<Record<string, unknown>>
}>

export interface CanvasGenesisProofCarrierIndex {
  readonly format: "convax.canvas-genesis-proof-carrier"
  readonly scope: DocumentScope
  readonly checkpointObjectDigest: Digest
  readonly fullUpdateDigest: Digest
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly authorAuthorityKind: "local-project-owner" | "team-replica"
  readonly authorAuthorityDigest: Digest
  readonly ownerSchemaDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly validationArtifacts: readonly ValidationArtifactRef[]
  readonly sections: readonly CanvasGenesisProofCarrierSection[]
  readonly totalSectionBytes: Uint64
  readonly protocolDigest: Digest
}

export interface ValidatedCanvasGenesisIdentity {
  readonly checkpointObjectDigest: Digest
  readonly scope: DocumentScope
  readonly identity: CanvasIdentity
  readonly authorActorId: ActorId
  readonly authorAuthorityDigest: Digest
}

export type ValidateCanvasGenesisProofCarrierResult =
  | Readonly<{
      status: "validated"
      exactBytesSha256: Digest
      canvasArtifactDigest: Digest
      identity: ValidatedCanvasGenesisIdentity
    }>
  | Readonly<{
      status: "pending"
      exactBytesSha256: Digest
      canvasArtifactDigest: Digest
      code: "canvas-genesis-proof-dependency-pending"
    }>
  | Readonly<{
      status: "rejected"
      exactBytesSha256: Digest
      canvasArtifactDigest: Digest
      code:
        | "canvas-genesis-proof-envelope-invalid"
        | "canvas-genesis-proof-limit-exceeded"
        | "canvas-genesis-proof-section-invalid"
        | "canvas-genesis-proof-authority-invalid"
        | "canvas-genesis-proof-artifact-mismatch"
        | "canvas-genesis-proof-state-invalid"
    }>

export interface CanvasGenesisHistoricalAuthorVerificationInput {
  readonly scope: DocumentScope
  readonly checkpoint: ReplicaCheckpoint
  readonly authorAuthorityKind: "local-project-owner" | "team-replica"
  readonly authorAuthorityDigest: Digest
  readonly authorAuthorityExactBytes: Readonly<Uint8Array>
  readonly validationArtifacts: readonly Readonly<{
    artifact: ValidationArtifactRef
    exactBytes: Readonly<Uint8Array>
  }>[]
}

export type CanvasGenesisHistoricalAuthorVerificationResult =
  | Readonly<{
      status: "verified"
      authorActorId: ActorId
      authorReplicaId: ReplicaId
      authorAuthorityDigest: Digest
    }>
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "rejected" }>

/**
 * Synchronous Control-plane edge. The implementation verifies the retained exact
 * credential, membership, reservation, trust and checkpoint-signature closure.
 * Canvas deliberately does not redeclare those Control-owned codecs.
 */
export interface CanvasGenesisHistoricalAuthorVerifierPort {
  verifyHistoricalAuthor(
    input: CanvasGenesisHistoricalAuthorVerificationInput,
  ): CanvasGenesisHistoricalAuthorVerificationResult
}

declare const canvasGenesisProofCarrierVerifierBrand: unique symbol
declare const canvasGenesisProofCarrierVerifierFactoryBrand: unique symbol

export interface CanvasGenesisProofCarrierVerifier {
  (exactBytes: CanvasGenesisProofCarrierExactBytes): ValidateCanvasGenesisProofCarrierResult
  readonly canvasArtifactDigest: Digest
  readonly [canvasGenesisProofCarrierVerifierBrand]: true
}

export type CreateCanvasGenesisProofCarrierVerifierResult =
  | Readonly<{ status: "created"; verifier: CanvasGenesisProofCarrierVerifier }>
  | Readonly<{
      status: "rejected"
      code: "canvas-runtime-artifact-mismatch" | "canvas-runtime-invalid"
    }>

export interface CanvasGenesisProofCarrierVerifierFactory {
  readonly canvasArtifactDigest: Digest
  createVerifier(runtime: DocumentOwnerRuntime<"canvas">): CreateCanvasGenesisProofCarrierVerifierResult
  readonly [canvasGenesisProofCarrierVerifierFactoryBrand]: true
}

const liveFactories = new WeakSet<object>()
const liveVerifiers = new WeakSet<object>()

/** Composition-only installer: a structural authority cannot pass Kernel's live authority check. */
export function installCanvasGenesisProofCarrierVerifierFactory(input: {
  readonly authority: CurrentProtocolAuthority
  readonly historicalAuthorVerifier: CanvasGenesisHistoricalAuthorVerifierPort
}): CanvasGenesisProofCarrierVerifierFactory {
  const canvasArtifactDigest = selectedCanvasArtifact(input.authority)
  if (typeof input.historicalAuthorVerifier?.verifyHistoricalAuthor !== "function") {
    throw new TypeError("Canvas genesis historical-author verifier is invalid")
  }
  const factory = Object.freeze({
    canvasArtifactDigest,
    createVerifier(runtime: DocumentOwnerRuntime<"canvas">): CreateCanvasGenesisProofCarrierVerifierResult {
      try {
        assertDocumentOwnerRuntime(runtime, input.authority)
      } catch {
        return Object.freeze({ status: "rejected", code: "canvas-runtime-invalid" })
      }
      if (runtime.artifactDigest !== canvasArtifactDigest || runtime.protocolPort.owner !== "canvas") {
        return Object.freeze({ status: "rejected", code: "canvas-runtime-artifact-mismatch" })
      }
      const verifier = createVerifier(input.authority, runtime, input.historicalAuthorVerifier)
      liveVerifiers.add(verifier)
      return Object.freeze({ status: "created", verifier })
    },
  }) as CanvasGenesisProofCarrierVerifierFactory
  liveFactories.add(factory)
  return factory
}

export interface CanvasGenesisBuildAuthor {
  readonly checkpointId: Id128
  readonly authorMemberId: MemberId
  readonly authorReplicaId: ReplicaId
  readonly authorActorId: ActorId
  readonly authorAuthorizationDigest: Digest
  readonly authorAuthorityKind: "local-project-owner" | "team-replica"
  readonly authorAuthorityDigest: Digest
  readonly authorAuthorityExactBytes: Readonly<Uint8Array>
  readonly validationArtifacts: readonly Readonly<{
    artifact: ValidationArtifactRef
    exactBytes: Readonly<Uint8Array>
  }>[]
  signCheckpointCoreDigest(coreDigest: Digest): Promise<Signature>
}

export interface CanvasGenesisAcceptedBase {
  readonly scope: DocumentScope
  readonly frontier: CausalFrontier
  readonly frontierDigest: Digest
  readonly actorHeads: ReplicaActorHeadSet
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVector
  readonly canonicalStateDigest: Digest
}

export type BuildCanvasGenesisProofCarrierResult =
  | Readonly<{
      status: "built"
      checkpointObjectDigest: Digest
      checkpointExactBytes: Readonly<Uint8Array>
      proofCarrierExactBytes: CanvasGenesisProofCarrierExactBytes
      acceptedBase: CanvasGenesisAcceptedBase
      validatedIdentity: ValidatedCanvasGenesisIdentity
    }>
  | Readonly<{ status: "pending" | "rejected" }>

export async function buildCanvasGenesisProofCarrier(input: {
  readonly authority: CurrentProtocolAuthority
  readonly runtime: DocumentOwnerRuntime<"canvas">
  readonly verifier: CanvasGenesisProofCarrierVerifier
  readonly scope: DocumentScope
  readonly projectIndexRouteDependencyFrameDigest: Digest
  readonly author: CanvasGenesisBuildAuthor
}): Promise<BuildCanvasGenesisProofCarrierResult> {
  try {
    assertDocumentOwnerRuntime(input.runtime, input.authority)
    const canvasArtifactDigest = selectedCanvasArtifact(input.authority)
    if (
      !liveVerifiers.has(input.verifier) ||
      input.verifier.canvasArtifactDigest !== canvasArtifactDigest ||
      input.runtime.artifactDigest !== canvasArtifactDigest
    ) return Object.freeze({ status: "rejected" })
    const scope = parseDocumentScope(input.scope)
    if (scope.docKind !== "canvas") return Object.freeze({ status: "rejected" })
    const author = parseBuildAuthor(input.author)
    const validationArtifacts = selectedValidationArtifacts(input.authority)
    if (!sameArtifactMaterial(author.validationArtifacts, validationArtifacts)) {
      return Object.freeze({ status: "rejected" })
    }
    const document = createCanvasYDoc(
      scope,
      canvasArtifactDigest,
      input.authority.protocolDigest,
      parseDigest(input.projectIndexRouteDependencyFrameDigest),
      author.authorReplicaId,
    )
    try {
      const fullUpdate = encodeFullUpdate(document)
      const stateVector = encodeStateVector(document)
      const canonicalState = input.runtime.protocolPort.canonicalStateBytes(document)
      if (canonicalState === "rejected") return Object.freeze({ status: "rejected" })
      const canonicalStateDigest = computeCanonicalStateDigest(canvasArtifactDigest, canonicalState)
      const frontier: CausalFrontier = Object.freeze({ format: "convax.causal-frontier", heads: Object.freeze([]) })
      const actorHeads: ReplicaActorHeadSet = Object.freeze({
        format: "convax.replica-actor-head-set",
        scope,
        heads: Object.freeze([]),
      })
      const validationArtifactSetDigest = structuredDigest(
        "convax.validation-artifact-set",
        { format: "convax.validation-artifact-set", artifacts: validationArtifacts },
      )
      const checkpointCore: ReplicaCheckpointCore = Object.freeze({
        format: "convax.replica-checkpoint-core",
        scope,
        checkpointId: author.checkpointId,
        authorMemberId: author.authorMemberId,
        authorReplicaId: author.authorReplicaId,
        authorActorId: author.authorActorId,
        authorAuthorizationDigest: author.authorAuthorizationDigest,
        directParentCheckpointDigests: Object.freeze([]),
        baseFrontierDigest: causalFrontierDigest(frontier),
        computedFrontierDigest: causalFrontierDigest(frontier),
        actorHeadBoundaryDigest: replicaActorHeadSetDigest(actorHeads),
        stateVectorDigest: stateVectorDigest(stateVector),
        canonicalStateDigest,
        fullUpdateDigest: yjsUpdateDigest(fullUpdate),
        fullUpdateByteLength: parseUint64(String(fullUpdate.byteLength)),
        protocolDigest: input.authority.protocolDigest,
        schemaDigest: canvasArtifactDigest,
        canonicalizerDigest: input.runtime.protocolPort.canonicalizerDigest,
        validationArtifactSetDigest,
      })
      const coreDigest = replicaCheckpointCoreDigest(checkpointCore)
      const checkpoint: ReplicaCheckpoint = parseReplicaCheckpoint({
        format: "convax.replica-checkpoint",
        core: checkpointCore,
        coreDigest,
        replicaSignature: parseSignature(await author.signCheckpointCoreDigest(coreDigest)),
      })
      const checkpointExactBytes = encodeRestrictedJcs(checkpoint)
      const checkpointObjectDigest = replicaCheckpointObjectDigest(checkpoint)
      const proofCarrierExactBytes = encodeCarrier({
        scope,
        checkpoint,
        checkpointObjectDigest,
        canonicalState,
        fullUpdate,
        stateVector,
        author,
        validationArtifacts,
      })
      const verified = input.verifier(proofCarrierExactBytes)
      if (verified.status !== "validated") return Object.freeze({ status: verified.status })
      return Object.freeze({
        status: "built",
        checkpointObjectDigest,
        checkpointExactBytes: new Uint8Array(checkpointExactBytes),
        proofCarrierExactBytes: new Uint8Array(proofCarrierExactBytes),
        acceptedBase: Object.freeze({
          scope,
          frontier,
          frontierDigest: causalFrontierDigest(frontier),
          actorHeads,
          fullUpdate: new Uint8Array(fullUpdate),
          stateVector: new Uint8Array(stateVector) as StateVector,
          canonicalStateDigest,
        }),
        validatedIdentity: verified.identity,
      })
    } finally {
      document.destroy()
    }
  } catch {
    return Object.freeze({ status: "rejected" })
  }
}

function createVerifier(
  authority: CurrentProtocolAuthority,
  runtime: DocumentOwnerRuntime<"canvas">,
  authorVerifier: CanvasGenesisHistoricalAuthorVerifierPort,
): CanvasGenesisProofCarrierVerifier {
  const canvasArtifactDigest = runtime.artifactDigest
  const callable = ((inputBytes: Readonly<Uint8Array>): ValidateCanvasGenesisProofCarrierResult => {
    const exactBytes = inputBytes instanceof Uint8Array ? new Uint8Array(inputBytes) : new Uint8Array()
    const exactBytesSha256 = ordinarySha256(exactBytes)
    const reject = (code: Extract<ValidateCanvasGenesisProofCarrierResult, { status: "rejected" }>["code"]) =>
      Object.freeze({ status: "rejected" as const, exactBytesSha256, canvasArtifactDigest, code })
    if (!(inputBytes instanceof Uint8Array)) return reject("canvas-genesis-proof-envelope-invalid")
    if (exactBytes.byteLength > MAX_CARRIER_BYTES) return reject("canvas-genesis-proof-limit-exceeded")
    let decoded: DecodedCarrier
    try {
      decoded = decodeCarrier(exactBytes)
    } catch {
      return reject("canvas-genesis-proof-envelope-invalid")
    }
    const selectedArtifacts = selectedValidationArtifacts(authority)
    if (
      decoded.index.ownerSchemaDigest !== canvasArtifactDigest ||
      decoded.index.protocolDigest !== authority.protocolDigest ||
      decoded.index.canonicalizerDigest !== runtime.protocolPort.canonicalizerDigest ||
      !sameArtifacts(decoded.index.validationArtifacts, selectedArtifacts)
    ) return reject("canvas-genesis-proof-artifact-mismatch")
    try {
      validateSectionSubjects(decoded)
    } catch {
      return reject("canvas-genesis-proof-section-invalid")
    }
    let checkpoint: ReplicaCheckpoint
    try {
      checkpoint = parseReplicaCheckpoint(decodeExactJcs(decoded.sections[4]!))
      if (
        replicaCheckpointObjectDigest(checkpoint) !== decoded.index.checkpointObjectDigest ||
        !sameScope(checkpoint.core.scope, decoded.index.scope) ||
        checkpoint.core.protocolDigest !== decoded.index.protocolDigest ||
        checkpoint.core.schemaDigest !== decoded.index.ownerSchemaDigest ||
        checkpoint.core.canonicalizerDigest !== decoded.index.canonicalizerDigest ||
        checkpoint.core.validationArtifactSetDigest !== decoded.index.validationArtifactSetDigest ||
        checkpoint.core.fullUpdateDigest !== decoded.index.fullUpdateDigest ||
        checkpoint.core.stateVectorDigest !== decoded.index.stateVectorDigest ||
        checkpoint.core.canonicalStateDigest !== decoded.index.canonicalStateDigest ||
        checkpoint.core.fullUpdateByteLength !== String(decoded.sections[2]!.byteLength) ||
        checkpoint.core.directParentCheckpointDigests.length !== 0
      ) return reject("canvas-genesis-proof-section-invalid")
    } catch {
      return reject("canvas-genesis-proof-section-invalid")
    }
    let authorResult: CanvasGenesisHistoricalAuthorVerificationResult
    try {
      authorResult = authorVerifier.verifyHistoricalAuthor({
        scope: decoded.index.scope,
        checkpoint,
        authorAuthorityKind: decoded.index.authorAuthorityKind,
        authorAuthorityDigest: decoded.index.authorAuthorityDigest,
        authorAuthorityExactBytes: new Uint8Array(decoded.sections[0]!),
        validationArtifacts: decoded.index.validationArtifacts.map((artifact, index) => Object.freeze({
          artifact,
          exactBytes: new Uint8Array(decoded.sections[index + 5]!),
        })),
      })
    } catch {
      return reject("canvas-genesis-proof-authority-invalid")
    }
    if (authorResult.status === "pending") {
      return Object.freeze({
        status: "pending", exactBytesSha256, canvasArtifactDigest,
        code: "canvas-genesis-proof-dependency-pending",
      })
    }
    if (
      authorResult.status !== "verified" ||
      parseActorId(authorResult.authorActorId) !== checkpoint.core.authorActorId ||
      parseReplicaId(authorResult.authorReplicaId) !== checkpoint.core.authorReplicaId ||
      parseDigest(authorResult.authorAuthorityDigest) !== decoded.index.authorAuthorityDigest
    ) return reject("canvas-genesis-proof-authority-invalid")

    const document = createCanvasReconstructionYDoc()
    try {
      const fullUpdate = decoded.sections[2]!
      const stateVector = decoded.sections[3]!
      applyYjsUpdate(document, fullUpdate, Object.freeze({ format: "convax.canvas-genesis-proof-origin" }))
      if (!sameBytes(encodeFullUpdate(document), fullUpdate) || !sameBytes(encodeStateVector(document), stateVector)) {
        return reject("canvas-genesis-proof-state-invalid")
      }
      const authorClientId = replicaIdToYjsClientId(authorResult.authorReplicaId)
      const stateClients = [...Y.decodeStateVector(stateVector).keys()]
      if (stateClients.length !== 1 || stateClients[0] !== authorClientId) {
        return reject("canvas-genesis-proof-authority-invalid")
      }
      const validatedBase = runtime.protocolPort.validateBase(document)
      if (typeof validatedBase === "string") return reject("canvas-genesis-proof-state-invalid")
      const canonicalState = runtime.protocolPort.canonicalStateBytes(document)
      if (
        canonicalState === "rejected" ||
        !sameBytes(canonicalState, decoded.sections[1]!) ||
        computeCanonicalStateDigest(canvasArtifactDigest, canonicalState) !== decoded.index.canonicalStateDigest ||
        yjsUpdateDigest(fullUpdate) !== decoded.index.fullUpdateDigest ||
        stateVectorDigest(stateVector) !== decoded.index.stateVectorDigest
      ) return reject("canvas-genesis-proof-state-invalid")
      const snapshot = validateCanvasYDoc(document, decoded.index.scope)
      assertCanvasIdentity(snapshot.identity, decoded.index.scope)
      if (
        snapshot.identity.ownerSchemaDigest !== decoded.index.ownerSchemaDigest ||
        snapshot.identity.protocolDigest !== decoded.index.protocolDigest ||
        snapshot.identity.canonicalizerDigest !== decoded.index.canonicalizerDigest
      ) return reject("canvas-genesis-proof-state-invalid")
      const identity: ValidatedCanvasGenesisIdentity = Object.freeze({
        checkpointObjectDigest: decoded.index.checkpointObjectDigest,
        scope: cloneScope(decoded.index.scope),
        identity: Object.freeze({ ...snapshot.identity }),
        authorActorId: authorResult.authorActorId,
        authorAuthorityDigest: authorResult.authorAuthorityDigest,
      })
      return Object.freeze({ status: "validated", exactBytesSha256, canvasArtifactDigest, identity })
    } catch {
      return reject("canvas-genesis-proof-state-invalid")
    } finally {
      document.destroy()
    }
  }) as CanvasGenesisProofCarrierVerifier
  Object.defineProperty(callable, "canvasArtifactDigest", { value: canvasArtifactDigest, enumerable: true })
  return Object.freeze(callable)
}

interface ParsedBuildAuthor extends Omit<CanvasGenesisBuildAuthor, "validationArtifacts"> {
  readonly validationArtifacts: readonly Readonly<{ artifact: ValidationArtifactRef; exactBytes: Uint8Array }>[]
}

function parseBuildAuthor(author: CanvasGenesisBuildAuthor): ParsedBuildAuthor {
  if (typeof author.signCheckpointCoreDigest !== "function") throw new TypeError("Checkpoint signer is invalid")
  return Object.freeze({
    ...author,
    checkpointId: parseId128(author.checkpointId),
    authorMemberId: parseMemberId(author.authorMemberId),
    authorReplicaId: parseReplicaId(author.authorReplicaId),
    authorActorId: parseActorId(author.authorActorId),
    authorAuthorizationDigest: parseDigest(author.authorAuthorizationDigest),
    authorAuthorityKind: parseAuthorAuthorityKind(author.authorAuthorityKind),
    authorAuthorityDigest: parseDigest(author.authorAuthorityDigest),
    authorAuthorityExactBytes: cloneBytes(author.authorAuthorityExactBytes),
    validationArtifacts: Object.freeze(author.validationArtifacts.map((entry) => Object.freeze({
      artifact: parseValidationArtifactSet({ format: "convax.validation-artifact-set", artifacts: [entry.artifact] }).artifacts[0]!,
      exactBytes: cloneBytes(entry.exactBytes),
    }))),
  })
}

function encodeCarrier(input: {
  scope: DocumentScope
  checkpoint: ReplicaCheckpoint
  checkpointObjectDigest: Digest
  canonicalState: Uint8Array
  fullUpdate: Uint8Array
  stateVector: Uint8Array
  author: ParsedBuildAuthor
  validationArtifacts: readonly ValidationArtifactRef[]
}): Uint8Array {
  const sectionBytes = [
    input.author.authorAuthorityExactBytes,
    input.canonicalState,
    input.fullUpdate,
    input.stateVector,
    encodeRestrictedJcs(input.checkpoint),
    ...input.author.validationArtifacts.map((entry) => entry.exactBytes),
  ].map((bytes) => new Uint8Array(bytes))
  const singleton = [
    ["checkpoint-author-authority", { kind: "canvas-genesis-author-authority", authorityKind: input.author.authorAuthorityKind, authorityDigest: input.author.authorAuthorityDigest }],
    ["checkpoint-canonical-state", { kind: "canonical-state", canonicalStateDigest: input.checkpoint.core.canonicalStateDigest }],
    ["checkpoint-full-update", { kind: "yjs-update", fullUpdateDigest: input.checkpoint.core.fullUpdateDigest }],
    ["checkpoint-state-vector", { kind: "state-vector", stateVectorDigest: input.checkpoint.core.stateVectorDigest }],
    ["checkpoint-wrapper", { kind: "replica-checkpoint-object", checkpointObjectDigest: input.checkpointObjectDigest }],
  ] as const
  let offset = 0n
  const sections: CanvasGenesisProofCarrierSection[] = []
  for (let index = 0; index < sectionBytes.length; index += 1) {
    const bytes = sectionBytes[index]!
    const semantic = index < 5
      ? singleton[index]!
      : ["validation-artifact", { kind: "validation-artifact", artifact: input.validationArtifacts[index - 5]! }] as const
    sections.push(Object.freeze({
      kind: semantic[0],
      ordinal: parseUint32(String(index < 5 ? 0 : index - 5)),
      subject: Object.freeze(semantic[1]),
      byteOffset: parseUint64(offset.toString()),
      byteLength: parseUint64(String(bytes.byteLength)),
      sha256: ordinarySha256(bytes),
    }))
    offset += BigInt(bytes.byteLength)
  }
  const index: CanvasGenesisProofCarrierIndex = Object.freeze({
    format: "convax.canvas-genesis-proof-carrier",
    scope: input.scope,
    checkpointObjectDigest: input.checkpointObjectDigest,
    fullUpdateDigest: input.checkpoint.core.fullUpdateDigest,
    stateVectorDigest: input.checkpoint.core.stateVectorDigest,
    canonicalStateDigest: input.checkpoint.core.canonicalStateDigest,
    authorAuthorityKind: input.author.authorAuthorityKind,
    authorAuthorityDigest: input.author.authorAuthorityDigest,
    ownerSchemaDigest: input.checkpoint.core.schemaDigest,
    canonicalizerDigest: input.checkpoint.core.canonicalizerDigest,
    validationArtifactSetDigest: input.checkpoint.core.validationArtifactSetDigest,
    validationArtifacts: Object.freeze([...input.validationArtifacts]),
    sections: Object.freeze(sections),
    totalSectionBytes: parseUint64(offset.toString()),
    protocolDigest: input.checkpoint.core.protocolDigest,
  })
  const indexBytes = encodeRestrictedJcs(index)
  const total = MAGIC.byteLength + 8 + indexBytes.byteLength + Number(offset)
  if (total > MAX_CARRIER_BYTES) throw new RangeError("Canvas genesis carrier exceeds the current limit")
  const output = new Uint8Array(total)
  output.set(MAGIC, 0)
  writeU64be(output, MAGIC.byteLength, BigInt(indexBytes.byteLength))
  output.set(indexBytes, MAGIC.byteLength + 8)
  let cursor = MAGIC.byteLength + 8 + indexBytes.byteLength
  for (const bytes of sectionBytes) {
    output.set(bytes, cursor)
    cursor += bytes.byteLength
  }
  return output
}

interface DecodedCarrier {
  readonly index: CanvasGenesisProofCarrierIndex
  readonly sections: readonly Uint8Array[]
}

function decodeCarrier(exactBytes: Uint8Array): DecodedCarrier {
  if (exactBytes.byteLength < 16 || !sameBytes(exactBytes.subarray(0, 8), MAGIC)) throw new TypeError("bad magic")
  const indexLength = readU64be(exactBytes, 8)
  if (indexLength > BigInt(exactBytes.byteLength - 16) || indexLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("bad index length")
  const indexEnd = 16 + Number(indexLength)
  const indexBytes = exactBytes.slice(16, indexEnd)
  const decoded = decodeRestrictedJcs(indexBytes)
  if (!sameBytes(encodeRestrictedJcs(decoded), indexBytes)) throw new TypeError("non-exact index")
  const index = parseCarrierIndex(decoded)
  if (BigInt(index.totalSectionBytes) !== BigInt(exactBytes.byteLength - indexEnd)) throw new RangeError("trailing section bytes")
  const sections = index.sections.map((section) => {
    const start = BigInt(section.byteOffset)
    const length = BigInt(section.byteLength)
    if (start + length > BigInt(exactBytes.byteLength - indexEnd)) throw new RangeError("section outside envelope")
    const bytes = exactBytes.slice(indexEnd + Number(start), indexEnd + Number(start + length))
    if (ordinarySha256(bytes) !== section.sha256) throw new TypeError("section hash mismatch")
    return bytes
  })
  return Object.freeze({ index, sections: Object.freeze(sections) })
}

function parseCarrierIndex(value: unknown): CanvasGenesisProofCarrierIndex {
  assertExactKeys(value, INDEX_KEYS, "CanvasGenesisProofCarrierIndex")
  if (value.format !== "convax.canvas-genesis-proof-carrier") throw new TypeError("bad format")
  assertDenseArray(value.validationArtifacts, "Canvas genesis validation artifacts")
  const artifacts = parseValidationArtifactSet({
    format: "convax.validation-artifact-set",
    artifacts: value.validationArtifacts,
  }).artifacts
  if (artifacts.length < 4) throw new TypeError("Canvas genesis artifact set is incomplete")
  assertDenseArray(value.sections, "Canvas genesis sections")
  if (value.sections.length !== 5 + artifacts.length) throw new TypeError("Canvas genesis section count is invalid")
  const sections = value.sections.map(parseSection)
  let offset = 0n
  for (const section of sections) {
    if (BigInt(section.byteOffset) !== offset) throw new TypeError("Canvas genesis sections are not contiguous")
    offset += BigInt(section.byteLength)
  }
  const totalSectionBytes = parseUint64(value.totalSectionBytes)
  if (BigInt(totalSectionBytes) !== offset) throw new TypeError("Canvas genesis total section length is invalid")
  const validationArtifactSetDigest = parseDigest(value.validationArtifactSetDigest)
  if (validationArtifactSetDigest !== structuredDigest("convax.validation-artifact-set", {
    format: "convax.validation-artifact-set", artifacts,
  })) throw new TypeError("Canvas genesis validation artifact set digest mismatches")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    checkpointObjectDigest: parseDigest(value.checkpointObjectDigest),
    fullUpdateDigest: parseDigest(value.fullUpdateDigest),
    stateVectorDigest: parseDigest(value.stateVectorDigest),
    canonicalStateDigest: parseDigest(value.canonicalStateDigest),
    authorAuthorityKind: parseAuthorAuthorityKind(value.authorAuthorityKind),
    authorAuthorityDigest: parseDigest(value.authorAuthorityDigest),
    ownerSchemaDigest: parseDigest(value.ownerSchemaDigest),
    canonicalizerDigest: parseDigest(value.canonicalizerDigest),
    validationArtifactSetDigest,
    validationArtifacts: artifacts,
    sections: Object.freeze(sections),
    totalSectionBytes,
    protocolDigest: parseDigest(value.protocolDigest),
  })
}

function parseSection(value: unknown): CanvasGenesisProofCarrierSection {
  assertExactKeys(value, ["kind", "ordinal", "subject", "byteOffset", "byteLength", "sha256"], "Canvas genesis section")
  const kinds = new Set<string>([
    "checkpoint-author-authority", "checkpoint-canonical-state", "checkpoint-full-update",
    "checkpoint-state-vector", "checkpoint-wrapper", "validation-artifact",
  ])
  if (typeof value.kind !== "string" || !kinds.has(value.kind)) throw new TypeError("unknown section kind")
  return Object.freeze({
    kind: value.kind as CanvasGenesisProofCarrierSection["kind"],
    ordinal: parseUint32(value.ordinal),
    subject: parseSubject(value.kind, value.subject),
    byteOffset: parseUint64(value.byteOffset),
    byteLength: parseUint64(value.byteLength),
    sha256: parseDigest(value.sha256),
  })
}

function parseSubject(kind: string, value: unknown): Readonly<Record<string, unknown>> {
  if (kind === "checkpoint-author-authority") {
    assertExactKeys(value, ["kind", "authorityKind", "authorityDigest"], "Canvas genesis authority subject")
    if (value.kind !== "canvas-genesis-author-authority") throw new TypeError("wrong authority subject kind")
    return Object.freeze({
      kind: value.kind,
      authorityKind: parseAuthorAuthorityKind(value.authorityKind),
      authorityDigest: parseDigest(value.authorityDigest),
    })
  }
  const key = {
    "checkpoint-canonical-state": ["canonical-state", "canonicalStateDigest"],
    "checkpoint-full-update": ["yjs-update", "fullUpdateDigest"],
    "checkpoint-state-vector": ["state-vector", "stateVectorDigest"],
    "checkpoint-wrapper": ["replica-checkpoint-object", "checkpointObjectDigest"],
  }[kind]
  if (key !== undefined) {
    assertExactKeys(value, ["kind", key[1]!], "Canvas genesis digest subject")
    if (value.kind !== key[0]) throw new TypeError("wrong digest subject kind")
    return Object.freeze({ kind: value.kind, [key[1]!]: parseDigest(value[key[1]!]) })
  }
  assertExactKeys(value, ["kind", "artifact"], "Canvas genesis artifact subject")
  if (value.kind !== "validation-artifact") throw new TypeError("wrong artifact subject kind")
  const artifact = parseValidationArtifactSet({ format: "convax.validation-artifact-set", artifacts: [value.artifact] }).artifacts[0]!
  return Object.freeze({ kind: value.kind, artifact })
}

function validateSectionSubjects(decoded: DecodedCarrier): void {
  const expectedKinds = [
    "checkpoint-author-authority", "checkpoint-canonical-state", "checkpoint-full-update",
    "checkpoint-state-vector", "checkpoint-wrapper",
  ] as const
  expectedKinds.forEach((kind, index) => {
    const section = decoded.index.sections[index]!
    if (section.kind !== kind || section.ordinal !== "0") throw new TypeError("singleton order mismatch")
  })
  const mirrors: readonly [number, string, Digest][] = [
    [0, "authorityDigest", decoded.index.authorAuthorityDigest],
    [1, "canonicalStateDigest", decoded.index.canonicalStateDigest],
    [2, "fullUpdateDigest", decoded.index.fullUpdateDigest],
    [3, "stateVectorDigest", decoded.index.stateVectorDigest],
    [4, "checkpointObjectDigest", decoded.index.checkpointObjectDigest],
  ]
  for (const [index, key, digest] of mirrors) if (decoded.index.sections[index]!.subject[key] !== digest) throw new TypeError("subject mirror mismatch")
  if (decoded.index.sections[0]!.subject.authorityKind !== decoded.index.authorAuthorityKind) {
    throw new TypeError("authority kind mirror mismatch")
  }
  decoded.index.validationArtifacts.forEach((artifact, ordinal) => {
    const section = decoded.index.sections[ordinal + 5]!
    if (
      section.kind !== "validation-artifact" ||
      section.ordinal !== String(ordinal) ||
      !sameJcs(section.subject.artifact, artifact)
    ) throw new TypeError("validation artifact section mismatch")
  })
}

function parseAuthorAuthorityKind(value: unknown): "local-project-owner" | "team-replica" {
  if (value !== "local-project-owner" && value !== "team-replica") {
    throw new TypeError("Canvas genesis author authority kind is invalid")
  }
  return value
}

function selectedCanvasArtifact(authority: CurrentProtocolAuthority): Digest {
  const artifact = authority.protocolSchemaBundle.core.artifacts.find((entry) => entry.name === "canvas-schema")
  if (!artifact) throw new TypeError("Selected current authority has no Canvas artifact")
  return parseDigest(artifact.artifactDigest)
}

function selectedValidationArtifacts(authority: CurrentProtocolAuthority): readonly ValidationArtifactRef[] {
  const byName = new Map(authority.protocolSchemaBundle.core.artifacts.map((artifact) => [artifact.name, artifact]))
  const ref = (owner: ValidationArtifactRef["owner"], name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence") => {
    const artifact = byName.get(name)
    if (!artifact) throw new TypeError(`Selected current authority has no ${name} artifact`)
    return Object.freeze({ owner, format: artifact.format, artifactDigest: artifact.artifactDigest })
  }
  return parseValidationArtifactSet({
    format: "convax.validation-artifact-set",
    artifacts: [
      ref("canvas", "canvas-schema"),
      ref("control-plane", "control-plane"),
      ref("kernel", "collaboration-kernel"),
      ref("project-index", "project-persistence"),
    ],
  }).artifacts
}

function sameArtifactMaterial(
  material: readonly Readonly<{ artifact: ValidationArtifactRef; exactBytes: Uint8Array }>[],
  expected: readonly ValidationArtifactRef[],
): boolean {
  return material.length === expected.length && material.every((entry, index) =>
    sameJcs(entry.artifact, expected[index]) && entry.exactBytes.byteLength > 0)
}

function sameArtifacts(left: readonly ValidationArtifactRef[], right: readonly ValidationArtifactRef[]): boolean {
  return left.length === right.length && left.every((entry, index) => sameJcs(entry, right[index]))
}

function decodeExactJcs(bytes: Uint8Array): unknown {
  const value = decodeRestrictedJcs(bytes)
  if (!sameBytes(encodeRestrictedJcs(value), bytes)) throw new TypeError("JCS bytes are not exact")
  return value
}

function cloneScope(scope: DocumentScope): DocumentScope {
  return Object.freeze({ ...parseDocumentScope(scope) })
}

function sameScope(left: DocumentScope, right: DocumentScope): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}

function sameJcs(left: unknown, right: unknown): boolean {
  return sameBytes(encodeRestrictedJcs(left), encodeRestrictedJcs(right))
}

function cloneBytes(value: Readonly<Uint8Array>): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 1) throw new TypeError("Exact material bytes are invalid")
  return new Uint8Array(value)
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false
  return true
}

function readU64be(bytes: Uint8Array, offset: number): bigint {
  let value = 0n
  for (let index = 0; index < 8; index += 1) value = (value << 8n) | BigInt(bytes[offset + index]!)
  return value
}

function writeU64be(bytes: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    bytes[offset + index] = Number(value & 0xffn)
    value >>= 8n
  }
}
