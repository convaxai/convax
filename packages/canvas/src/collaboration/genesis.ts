import {
  applyUpdateV1V2,
  assertDenseArrayV2,
  assertDocumentOwnerRuntimeV2,
  assertExactKeysV2,
  canonicalStateDigestV2,
  causalFrontierDigestV2,
  decodeRestrictedJcsV2,
  encodeFullUpdateV2,
  encodeRestrictedJcsV2,
  encodeStateVectorV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseMemberIdV2,
  parseReplicaCheckpointV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint32V2,
  parseUint64V2,
  parseValidationArtifactSetV2,
  replicaActorHeadSetDigestV2,
  replicaCheckpointCoreDigestV2,
  replicaCheckpointObjectDigestV2,
  replicaIdToYjsClientIdV2,
  stateVectorDigestV2,
  structuredDigestV2,
  yjsUpdateDigestV2,
  type ActorIdV2,
  type CausalFrontierV2,
  type DigestV2,
  type DocumentOwnerRuntimeV2,
  type DocumentScopeV2,
  type Id128V2,
  type MemberIdV2,
  type ReplicaCheckpointCoreV2,
  type ReplicaCheckpointV2,
  type ReplicaActorHeadSetV2,
  type ReplicaIdV2,
  type SignatureV2,
  type StateVectorV2,
  type Uint32V2,
  type Uint64V2,
  type ValidationArtifactRefV2,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"
import * as Y from "yjs"
import type { CanvasIdentityV2 } from "./types"
import { assertCanvasIdentityV2 } from "./validation"
import {
  createCanvasReconstructionYDocV2,
  createCanvasYDocV2,
  validateCanvasYDocV2,
} from "./ydoc"

const MAGIC = new TextEncoder().encode("CVXCGP02")
const MAX_CARRIER_BYTES = 335_544_320
const INDEX_KEYS = [
  "format", "scope", "checkpointObjectDigest", "fullUpdateDigest", "stateVectorDigest",
  "canonicalStateDigest", "checkpointAuthorCredentialCoreDigest",
  "checkpointAuthorReservationReceiptCoreDigest", "checkpointAuthorMembershipSnapshotCoreDigest",
  "serviceTrustBundleCoreDigest", "ownerSchemaDigest", "canonicalizerDigest",
  "validationArtifactSetDigest", "validationArtifacts", "sections", "totalSectionBytes", "protocolDigest",
] as const

export type CanvasGenesisProofCarrierExactBytesV2 = Readonly<Uint8Array>

export interface CanvasGenesisProofCarrierSectionLocationV2 {
  readonly byteOffset: Uint64V2
  readonly byteLength: Uint64V2
  readonly sha256: DigestV2
}

type SingletonSectionKindV2 =
  | "checkpoint-author-credential"
  | "checkpoint-author-membership-snapshot"
  | "checkpoint-author-reservation-receipt"
  | "checkpoint-canonical-state"
  | "checkpoint-full-update"
  | "checkpoint-state-vector"
  | "checkpoint-wrapper"
  | "service-trust-bundle"

export type CanvasGenesisProofCarrierSectionV2 = CanvasGenesisProofCarrierSectionLocationV2 & Readonly<{
  kind: SingletonSectionKindV2 | "validation-artifact"
  ordinal: Uint32V2
  subject: Readonly<Record<string, unknown>>
}>

export interface CanvasGenesisProofCarrierIndexV2 {
  readonly format: "convax.canvas-genesis-proof-carrier/2"
  readonly scope: DocumentScopeV2
  readonly checkpointObjectDigest: DigestV2
  readonly fullUpdateDigest: DigestV2
  readonly stateVectorDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
  readonly checkpointAuthorCredentialCoreDigest: DigestV2
  readonly checkpointAuthorReservationReceiptCoreDigest: DigestV2
  readonly checkpointAuthorMembershipSnapshotCoreDigest: DigestV2
  readonly serviceTrustBundleCoreDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
  readonly canonicalizerDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly validationArtifacts: readonly ValidationArtifactRefV2[]
  readonly sections: readonly CanvasGenesisProofCarrierSectionV2[]
  readonly totalSectionBytes: Uint64V2
  readonly protocolDigest: DigestV2
}

export interface ValidatedCanvasGenesisIdentityV2 {
  readonly checkpointObjectDigest: DigestV2
  readonly scope: DocumentScopeV2
  readonly identity: CanvasIdentityV2
  readonly authorActorId: ActorIdV2
  readonly authorCredentialCoreDigest: DigestV2
}

export type ValidateCanvasGenesisProofCarrierResultV2 =
  | Readonly<{
      status: "validated"
      exactBytesSha256: DigestV2
      canvasArtifactDigest: DigestV2
      identity: ValidatedCanvasGenesisIdentityV2
    }>
  | Readonly<{
      status: "pending"
      exactBytesSha256: DigestV2
      canvasArtifactDigest: DigestV2
      code: "canvas-genesis-proof-dependency-pending"
    }>
  | Readonly<{
      status: "rejected"
      exactBytesSha256: DigestV2
      canvasArtifactDigest: DigestV2
      code:
        | "canvas-genesis-proof-envelope-invalid"
        | "canvas-genesis-proof-limit-exceeded"
        | "canvas-genesis-proof-section-invalid"
        | "canvas-genesis-proof-authority-invalid"
        | "canvas-genesis-proof-artifact-mismatch"
        | "canvas-genesis-proof-state-invalid"
    }>

export interface CanvasGenesisHistoricalAuthorVerificationInputV2 {
  readonly scope: DocumentScopeV2
  readonly checkpoint: ReplicaCheckpointV2
  readonly checkpointAuthorCredentialExactBytes: Readonly<Uint8Array>
  readonly checkpointAuthorMembershipSnapshotExactBytes: Readonly<Uint8Array>
  readonly checkpointAuthorReservationReceiptExactBytes: Readonly<Uint8Array>
  readonly serviceTrustBundleExactBytes: Readonly<Uint8Array>
  readonly validationArtifacts: readonly Readonly<{
    artifact: ValidationArtifactRefV2
    exactBytes: Readonly<Uint8Array>
  }>[]
}

export type CanvasGenesisHistoricalAuthorVerificationResultV2 =
  | Readonly<{
      status: "verified"
      authorActorId: ActorIdV2
      authorReplicaId: ReplicaIdV2
      authorCredentialCoreDigest: DigestV2
    }>
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "rejected" }>

/**
 * Synchronous Control-plane edge. The implementation verifies the retained exact
 * credential, membership, reservation, trust and checkpoint-signature closure.
 * Canvas deliberately does not redeclare those Control-owned codecs.
 */
export interface CanvasGenesisHistoricalAuthorVerifierPortV2 {
  verifyHistoricalAuthor(
    input: CanvasGenesisHistoricalAuthorVerificationInputV2,
  ): CanvasGenesisHistoricalAuthorVerificationResultV2
}

declare const canvasGenesisProofCarrierVerifierBrandV2: unique symbol
declare const canvasGenesisProofCarrierVerifierFactoryBrandV2: unique symbol

export interface CanvasGenesisProofCarrierVerifierV2 {
  (exactBytes: CanvasGenesisProofCarrierExactBytesV2): ValidateCanvasGenesisProofCarrierResultV2
  readonly canvasArtifactDigest: DigestV2
  readonly [canvasGenesisProofCarrierVerifierBrandV2]: true
}

export type CreateCanvasGenesisProofCarrierVerifierResultV2 =
  | Readonly<{ status: "created"; verifier: CanvasGenesisProofCarrierVerifierV2 }>
  | Readonly<{
      status: "rejected"
      code: "canvas-runtime-artifact-mismatch" | "canvas-runtime-invalid"
    }>

export interface CanvasGenesisProofCarrierVerifierFactoryV2 {
  readonly canvasArtifactDigest: DigestV2
  createVerifier(runtime: DocumentOwnerRuntimeV2<"canvas">): CreateCanvasGenesisProofCarrierVerifierResultV2
  readonly [canvasGenesisProofCarrierVerifierFactoryBrandV2]: true
}

const liveFactories = new WeakSet<object>()
const liveVerifiers = new WeakSet<object>()

/** Composition-only installer: a structural authority cannot pass Kernel's live authority check. */
export function installCanvasGenesisProofCarrierVerifierFactoryV2(input: {
  readonly authority: VerifiedProtocolAuthorityV2
  readonly historicalAuthorVerifier: CanvasGenesisHistoricalAuthorVerifierPortV2
}): CanvasGenesisProofCarrierVerifierFactoryV2 {
  const canvasArtifactDigest = selectedCanvasArtifact(input.authority)
  if (typeof input.historicalAuthorVerifier?.verifyHistoricalAuthor !== "function") {
    throw new TypeError("Canvas genesis historical-author verifier is invalid")
  }
  const factory = Object.freeze({
    canvasArtifactDigest,
    createVerifier(runtime: DocumentOwnerRuntimeV2<"canvas">): CreateCanvasGenesisProofCarrierVerifierResultV2 {
      try {
        assertDocumentOwnerRuntimeV2(runtime, input.authority)
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
  }) as CanvasGenesisProofCarrierVerifierFactoryV2
  liveFactories.add(factory)
  return factory
}

export interface CanvasGenesisBuildAuthorV2 {
  readonly checkpointId: Id128V2
  readonly authorMemberId: MemberIdV2
  readonly authorReplicaId: ReplicaIdV2
  readonly authorActorId: ActorIdV2
  readonly authorAuthorizationDigest: DigestV2
  readonly checkpointAuthorCredentialCoreDigest: DigestV2
  readonly checkpointAuthorCredentialExactBytes: Readonly<Uint8Array>
  readonly checkpointAuthorMembershipSnapshotCoreDigest: DigestV2
  readonly checkpointAuthorMembershipSnapshotExactBytes: Readonly<Uint8Array>
  readonly checkpointAuthorReservationReceiptCoreDigest: DigestV2
  readonly checkpointAuthorReservationReceiptExactBytes: Readonly<Uint8Array>
  readonly serviceTrustBundleCoreDigest: DigestV2
  readonly serviceTrustBundleExactBytes: Readonly<Uint8Array>
  readonly validationArtifacts: readonly Readonly<{
    artifact: ValidationArtifactRefV2
    exactBytes: Readonly<Uint8Array>
  }>[]
  signCheckpointCoreDigest(coreDigest: DigestV2): Promise<SignatureV2>
}

export interface CanvasGenesisAcceptedBaseV2 {
  readonly scope: DocumentScopeV2
  readonly frontier: CausalFrontierV2
  readonly frontierDigest: DigestV2
  readonly actorHeads: ReplicaActorHeadSetV2
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVectorV2
  readonly canonicalStateDigest: DigestV2
}

export type BuildCanvasGenesisProofCarrierResultV2 =
  | Readonly<{
      status: "built"
      checkpointObjectDigest: DigestV2
      checkpointExactBytes: Readonly<Uint8Array>
      proofCarrierExactBytes: CanvasGenesisProofCarrierExactBytesV2
      acceptedBase: CanvasGenesisAcceptedBaseV2
      validatedIdentity: ValidatedCanvasGenesisIdentityV2
    }>
  | Readonly<{ status: "pending" | "rejected" }>

export async function buildCanvasGenesisProofCarrierV2(input: {
  readonly authority: VerifiedProtocolAuthorityV2
  readonly runtime: DocumentOwnerRuntimeV2<"canvas">
  readonly verifier: CanvasGenesisProofCarrierVerifierV2
  readonly scope: DocumentScopeV2
  readonly projectIndexRouteDependencyFrameDigest: DigestV2
  readonly author: CanvasGenesisBuildAuthorV2
}): Promise<BuildCanvasGenesisProofCarrierResultV2> {
  try {
    assertDocumentOwnerRuntimeV2(input.runtime, input.authority)
    const canvasArtifactDigest = selectedCanvasArtifact(input.authority)
    if (
      !liveVerifiers.has(input.verifier) ||
      input.verifier.canvasArtifactDigest !== canvasArtifactDigest ||
      input.runtime.artifactDigest !== canvasArtifactDigest
    ) return Object.freeze({ status: "rejected" })
    const scope = parseDocumentScopeV2(input.scope)
    if (scope.docKind !== "canvas") return Object.freeze({ status: "rejected" })
    const author = parseBuildAuthor(input.author)
    const validationArtifacts = selectedValidationArtifacts(input.authority)
    if (!sameArtifactMaterial(author.validationArtifacts, validationArtifacts)) {
      return Object.freeze({ status: "rejected" })
    }
    const document = createCanvasYDocV2(
      scope,
      canvasArtifactDigest,
      input.authority.protocolDigest,
      parseDigestV2(input.projectIndexRouteDependencyFrameDigest),
      author.authorReplicaId,
    )
    try {
      const fullUpdate = encodeFullUpdateV2(document)
      const stateVector = encodeStateVectorV2(document)
      const canonicalState = input.runtime.protocolPort.canonicalStateBytes(document)
      if (canonicalState === "rejected") return Object.freeze({ status: "rejected" })
      const canonicalStateDigest = canonicalStateDigestV2(canvasArtifactDigest, canonicalState)
      const frontier: CausalFrontierV2 = Object.freeze({ format: "convax.causal-frontier/2", heads: Object.freeze([]) })
      const actorHeads: ReplicaActorHeadSetV2 = Object.freeze({
        format: "convax.replica-actor-head-set/2",
        scope,
        heads: Object.freeze([]),
      })
      const validationArtifactSetDigest = structuredDigestV2(
        "convax.validation-artifact-set/2",
        { format: "convax.validation-artifact-set/2", artifacts: validationArtifacts },
      )
      const checkpointCore: ReplicaCheckpointCoreV2 = Object.freeze({
        format: "convax.replica-checkpoint-core/2",
        scope,
        checkpointId: author.checkpointId,
        authorMemberId: author.authorMemberId,
        authorReplicaId: author.authorReplicaId,
        authorActorId: author.authorActorId,
        authorAuthorizationDigest: author.authorAuthorizationDigest,
        directParentCheckpointDigests: Object.freeze([]),
        baseFrontierDigest: causalFrontierDigestV2(frontier),
        computedFrontierDigest: causalFrontierDigestV2(frontier),
        actorHeadBoundaryDigest: replicaActorHeadSetDigestV2(actorHeads),
        stateVectorDigest: stateVectorDigestV2(stateVector),
        canonicalStateDigest,
        fullUpdateDigest: yjsUpdateDigestV2(fullUpdate),
        fullUpdateByteLength: parseUint64V2(String(fullUpdate.byteLength)),
        protocolDigest: input.authority.protocolDigest,
        schemaDigest: canvasArtifactDigest,
        canonicalizerDigest: input.runtime.protocolPort.canonicalizerDigest,
        validationArtifactSetDigest,
      })
      const coreDigest = replicaCheckpointCoreDigestV2(checkpointCore)
      const checkpoint: ReplicaCheckpointV2 = parseReplicaCheckpointV2({
        format: "convax.replica-checkpoint/2",
        core: checkpointCore,
        coreDigest,
        replicaSignature: parseSignatureV2(await author.signCheckpointCoreDigest(coreDigest)),
      })
      const checkpointExactBytes = encodeRestrictedJcsV2(checkpoint)
      const checkpointObjectDigest = replicaCheckpointObjectDigestV2(checkpoint)
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
          frontierDigest: causalFrontierDigestV2(frontier),
          actorHeads,
          fullUpdate: new Uint8Array(fullUpdate),
          stateVector: new Uint8Array(stateVector) as StateVectorV2,
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
  authority: VerifiedProtocolAuthorityV2,
  runtime: DocumentOwnerRuntimeV2<"canvas">,
  authorVerifier: CanvasGenesisHistoricalAuthorVerifierPortV2,
): CanvasGenesisProofCarrierVerifierV2 {
  const canvasArtifactDigest = runtime.artifactDigest
  const callable = ((inputBytes: Readonly<Uint8Array>): ValidateCanvasGenesisProofCarrierResultV2 => {
    const exactBytes = inputBytes instanceof Uint8Array ? new Uint8Array(inputBytes) : new Uint8Array()
    const exactBytesSha256 = ordinarySha256V2(exactBytes)
    const reject = (code: Extract<ValidateCanvasGenesisProofCarrierResultV2, { status: "rejected" }>["code"]) =>
      Object.freeze({ status: "rejected" as const, exactBytesSha256, canvasArtifactDigest, code })
    if (!(inputBytes instanceof Uint8Array)) return reject("canvas-genesis-proof-envelope-invalid")
    if (exactBytes.byteLength > MAX_CARRIER_BYTES) return reject("canvas-genesis-proof-limit-exceeded")
    let decoded: DecodedCarrierV2
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
    let checkpoint: ReplicaCheckpointV2
    try {
      checkpoint = parseReplicaCheckpointV2(decodeExactJcs(decoded.sections[6]!))
      if (
        replicaCheckpointObjectDigestV2(checkpoint) !== decoded.index.checkpointObjectDigest ||
        !sameScope(checkpoint.core.scope, decoded.index.scope) ||
        checkpoint.core.protocolDigest !== decoded.index.protocolDigest ||
        checkpoint.core.schemaDigest !== decoded.index.ownerSchemaDigest ||
        checkpoint.core.canonicalizerDigest !== decoded.index.canonicalizerDigest ||
        checkpoint.core.validationArtifactSetDigest !== decoded.index.validationArtifactSetDigest ||
        checkpoint.core.fullUpdateDigest !== decoded.index.fullUpdateDigest ||
        checkpoint.core.stateVectorDigest !== decoded.index.stateVectorDigest ||
        checkpoint.core.canonicalStateDigest !== decoded.index.canonicalStateDigest ||
        checkpoint.core.fullUpdateByteLength !== String(decoded.sections[4]!.byteLength) ||
        checkpoint.core.directParentCheckpointDigests.length !== 0
      ) return reject("canvas-genesis-proof-section-invalid")
    } catch {
      return reject("canvas-genesis-proof-section-invalid")
    }
    let authorResult: CanvasGenesisHistoricalAuthorVerificationResultV2
    try {
      authorResult = authorVerifier.verifyHistoricalAuthor({
        scope: decoded.index.scope,
        checkpoint,
        checkpointAuthorCredentialExactBytes: new Uint8Array(decoded.sections[0]!),
        checkpointAuthorMembershipSnapshotExactBytes: new Uint8Array(decoded.sections[1]!),
        checkpointAuthorReservationReceiptExactBytes: new Uint8Array(decoded.sections[2]!),
        serviceTrustBundleExactBytes: new Uint8Array(decoded.sections[7]!),
        validationArtifacts: decoded.index.validationArtifacts.map((artifact, index) => Object.freeze({
          artifact,
          exactBytes: new Uint8Array(decoded.sections[index + 8]!),
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
      parseActorIdV2(authorResult.authorActorId) !== checkpoint.core.authorActorId ||
      parseReplicaIdV2(authorResult.authorReplicaId) !== checkpoint.core.authorReplicaId ||
      parseDigestV2(authorResult.authorCredentialCoreDigest) !== decoded.index.checkpointAuthorCredentialCoreDigest
    ) return reject("canvas-genesis-proof-authority-invalid")

    const document = createCanvasReconstructionYDocV2()
    try {
      const fullUpdate = decoded.sections[4]!
      const stateVector = decoded.sections[5]!
      applyUpdateV1V2(document, fullUpdate, Object.freeze({ format: "convax.canvas-genesis-proof-origin/2" }))
      if (!sameBytes(encodeFullUpdateV2(document), fullUpdate) || !sameBytes(encodeStateVectorV2(document), stateVector)) {
        return reject("canvas-genesis-proof-state-invalid")
      }
      const authorClientId = replicaIdToYjsClientIdV2(authorResult.authorReplicaId)
      const stateClients = [...Y.decodeStateVector(stateVector).keys()]
      if (stateClients.length !== 1 || stateClients[0] !== authorClientId) {
        return reject("canvas-genesis-proof-authority-invalid")
      }
      const validatedBase = runtime.protocolPort.validateBase(document)
      if (typeof validatedBase === "string") return reject("canvas-genesis-proof-state-invalid")
      const canonicalState = runtime.protocolPort.canonicalStateBytes(document)
      if (
        canonicalState === "rejected" ||
        !sameBytes(canonicalState, decoded.sections[3]!) ||
        canonicalStateDigestV2(canvasArtifactDigest, canonicalState) !== decoded.index.canonicalStateDigest ||
        yjsUpdateDigestV2(fullUpdate) !== decoded.index.fullUpdateDigest ||
        stateVectorDigestV2(stateVector) !== decoded.index.stateVectorDigest
      ) return reject("canvas-genesis-proof-state-invalid")
      const snapshot = validateCanvasYDocV2(document, decoded.index.scope)
      assertCanvasIdentityV2(snapshot.identity, decoded.index.scope)
      if (
        snapshot.identity.ownerSchemaDigest !== decoded.index.ownerSchemaDigest ||
        snapshot.identity.protocolDigest !== decoded.index.protocolDigest ||
        snapshot.identity.canonicalizerDigest !== decoded.index.canonicalizerDigest
      ) return reject("canvas-genesis-proof-state-invalid")
      const identity: ValidatedCanvasGenesisIdentityV2 = Object.freeze({
        checkpointObjectDigest: decoded.index.checkpointObjectDigest,
        scope: cloneScope(decoded.index.scope),
        identity: Object.freeze({ ...snapshot.identity }),
        authorActorId: authorResult.authorActorId,
        authorCredentialCoreDigest: authorResult.authorCredentialCoreDigest,
      })
      return Object.freeze({ status: "validated", exactBytesSha256, canvasArtifactDigest, identity })
    } catch {
      return reject("canvas-genesis-proof-state-invalid")
    } finally {
      document.destroy()
    }
  }) as CanvasGenesisProofCarrierVerifierV2
  Object.defineProperty(callable, "canvasArtifactDigest", { value: canvasArtifactDigest, enumerable: true })
  return Object.freeze(callable)
}

interface ParsedBuildAuthorV2 extends Omit<CanvasGenesisBuildAuthorV2, "validationArtifacts"> {
  readonly validationArtifacts: readonly Readonly<{ artifact: ValidationArtifactRefV2; exactBytes: Uint8Array }>[]
}

function parseBuildAuthor(author: CanvasGenesisBuildAuthorV2): ParsedBuildAuthorV2 {
  if (typeof author.signCheckpointCoreDigest !== "function") throw new TypeError("Checkpoint signer is invalid")
  return Object.freeze({
    ...author,
    checkpointId: parseId128V2(author.checkpointId),
    authorMemberId: parseMemberIdV2(author.authorMemberId),
    authorReplicaId: parseReplicaIdV2(author.authorReplicaId),
    authorActorId: parseActorIdV2(author.authorActorId),
    authorAuthorizationDigest: parseDigestV2(author.authorAuthorizationDigest),
    checkpointAuthorCredentialCoreDigest: parseDigestV2(author.checkpointAuthorCredentialCoreDigest),
    checkpointAuthorCredentialExactBytes: cloneBytes(author.checkpointAuthorCredentialExactBytes),
    checkpointAuthorMembershipSnapshotCoreDigest: parseDigestV2(author.checkpointAuthorMembershipSnapshotCoreDigest),
    checkpointAuthorMembershipSnapshotExactBytes: cloneBytes(author.checkpointAuthorMembershipSnapshotExactBytes),
    checkpointAuthorReservationReceiptCoreDigest: parseDigestV2(author.checkpointAuthorReservationReceiptCoreDigest),
    checkpointAuthorReservationReceiptExactBytes: cloneBytes(author.checkpointAuthorReservationReceiptExactBytes),
    serviceTrustBundleCoreDigest: parseDigestV2(author.serviceTrustBundleCoreDigest),
    serviceTrustBundleExactBytes: cloneBytes(author.serviceTrustBundleExactBytes),
    validationArtifacts: Object.freeze(author.validationArtifacts.map((entry) => Object.freeze({
      artifact: parseValidationArtifactSetV2({ format: "convax.validation-artifact-set/2", artifacts: [entry.artifact] }).artifacts[0]!,
      exactBytes: cloneBytes(entry.exactBytes),
    }))),
  })
}

function encodeCarrier(input: {
  scope: DocumentScopeV2
  checkpoint: ReplicaCheckpointV2
  checkpointObjectDigest: DigestV2
  canonicalState: Uint8Array
  fullUpdate: Uint8Array
  stateVector: Uint8Array
  author: ParsedBuildAuthorV2
  validationArtifacts: readonly ValidationArtifactRefV2[]
}): Uint8Array {
  const sectionBytes = [
    input.author.checkpointAuthorCredentialExactBytes,
    input.author.checkpointAuthorMembershipSnapshotExactBytes,
    input.author.checkpointAuthorReservationReceiptExactBytes,
    input.canonicalState,
    input.fullUpdate,
    input.stateVector,
    encodeRestrictedJcsV2(input.checkpoint),
    input.author.serviceTrustBundleExactBytes,
    ...input.author.validationArtifacts.map((entry) => entry.exactBytes),
  ].map((bytes) => new Uint8Array(bytes))
  const singleton = [
    ["checkpoint-author-credential", { kind: "replica-actor-credential-core", coreDigest: input.author.checkpointAuthorCredentialCoreDigest }],
    ["checkpoint-author-membership-snapshot", { kind: "membership-snapshot-core", coreDigest: input.author.checkpointAuthorMembershipSnapshotCoreDigest }],
    ["checkpoint-author-reservation-receipt", { kind: "replica-id-reservation-receipt-core", coreDigest: input.author.checkpointAuthorReservationReceiptCoreDigest }],
    ["checkpoint-canonical-state", { kind: "canonical-state", canonicalStateDigest: input.checkpoint.core.canonicalStateDigest }],
    ["checkpoint-full-update", { kind: "yjs-update", fullUpdateDigest: input.checkpoint.core.fullUpdateDigest }],
    ["checkpoint-state-vector", { kind: "state-vector", stateVectorDigest: input.checkpoint.core.stateVectorDigest }],
    ["checkpoint-wrapper", { kind: "replica-checkpoint-object", checkpointObjectDigest: input.checkpointObjectDigest }],
    ["service-trust-bundle", { kind: "service-trust-bundle-core", coreDigest: input.author.serviceTrustBundleCoreDigest }],
  ] as const
  let offset = 0n
  const sections: CanvasGenesisProofCarrierSectionV2[] = []
  for (let index = 0; index < sectionBytes.length; index += 1) {
    const bytes = sectionBytes[index]!
    const semantic = index < 8
      ? singleton[index]!
      : ["validation-artifact", { kind: "validation-artifact", artifact: input.validationArtifacts[index - 8]! }] as const
    sections.push(Object.freeze({
      kind: semantic[0],
      ordinal: parseUint32V2(String(index < 8 ? 0 : index - 8)),
      subject: Object.freeze(semantic[1]),
      byteOffset: parseUint64V2(offset.toString()),
      byteLength: parseUint64V2(String(bytes.byteLength)),
      sha256: ordinarySha256V2(bytes),
    }))
    offset += BigInt(bytes.byteLength)
  }
  const index: CanvasGenesisProofCarrierIndexV2 = Object.freeze({
    format: "convax.canvas-genesis-proof-carrier/2",
    scope: input.scope,
    checkpointObjectDigest: input.checkpointObjectDigest,
    fullUpdateDigest: input.checkpoint.core.fullUpdateDigest,
    stateVectorDigest: input.checkpoint.core.stateVectorDigest,
    canonicalStateDigest: input.checkpoint.core.canonicalStateDigest,
    checkpointAuthorCredentialCoreDigest: input.author.checkpointAuthorCredentialCoreDigest,
    checkpointAuthorReservationReceiptCoreDigest: input.author.checkpointAuthorReservationReceiptCoreDigest,
    checkpointAuthorMembershipSnapshotCoreDigest: input.author.checkpointAuthorMembershipSnapshotCoreDigest,
    serviceTrustBundleCoreDigest: input.author.serviceTrustBundleCoreDigest,
    ownerSchemaDigest: input.checkpoint.core.schemaDigest,
    canonicalizerDigest: input.checkpoint.core.canonicalizerDigest,
    validationArtifactSetDigest: input.checkpoint.core.validationArtifactSetDigest,
    validationArtifacts: Object.freeze([...input.validationArtifacts]),
    sections: Object.freeze(sections),
    totalSectionBytes: parseUint64V2(offset.toString()),
    protocolDigest: input.checkpoint.core.protocolDigest,
  })
  const indexBytes = encodeRestrictedJcsV2(index)
  const total = MAGIC.byteLength + 8 + indexBytes.byteLength + Number(offset)
  if (total > MAX_CARRIER_BYTES) throw new RangeError("Canvas genesis carrier exceeds the R5 limit")
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

interface DecodedCarrierV2 {
  readonly index: CanvasGenesisProofCarrierIndexV2
  readonly sections: readonly Uint8Array[]
}

function decodeCarrier(exactBytes: Uint8Array): DecodedCarrierV2 {
  if (exactBytes.byteLength < 16 || !sameBytes(exactBytes.subarray(0, 8), MAGIC)) throw new TypeError("bad magic")
  const indexLength = readU64be(exactBytes, 8)
  if (indexLength > BigInt(exactBytes.byteLength - 16) || indexLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("bad index length")
  const indexEnd = 16 + Number(indexLength)
  const indexBytes = exactBytes.slice(16, indexEnd)
  const decoded = decodeRestrictedJcsV2(indexBytes)
  if (!sameBytes(encodeRestrictedJcsV2(decoded), indexBytes)) throw new TypeError("non-exact index")
  const index = parseCarrierIndex(decoded)
  if (BigInt(index.totalSectionBytes) !== BigInt(exactBytes.byteLength - indexEnd)) throw new RangeError("trailing section bytes")
  const sections = index.sections.map((section) => {
    const start = BigInt(section.byteOffset)
    const length = BigInt(section.byteLength)
    if (start + length > BigInt(exactBytes.byteLength - indexEnd)) throw new RangeError("section outside envelope")
    const bytes = exactBytes.slice(indexEnd + Number(start), indexEnd + Number(start + length))
    if (ordinarySha256V2(bytes) !== section.sha256) throw new TypeError("section hash mismatch")
    return bytes
  })
  return Object.freeze({ index, sections: Object.freeze(sections) })
}

function parseCarrierIndex(value: unknown): CanvasGenesisProofCarrierIndexV2 {
  assertExactKeysV2(value, INDEX_KEYS, "CanvasGenesisProofCarrierIndexV2")
  if (value.format !== "convax.canvas-genesis-proof-carrier/2") throw new TypeError("bad format")
  assertDenseArrayV2(value.validationArtifacts, "Canvas genesis validation artifacts")
  const artifacts = parseValidationArtifactSetV2({
    format: "convax.validation-artifact-set/2",
    artifacts: value.validationArtifacts,
  }).artifacts
  if (artifacts.length < 4) throw new TypeError("Canvas genesis artifact set is incomplete")
  assertDenseArrayV2(value.sections, "Canvas genesis sections")
  if (value.sections.length !== 8 + artifacts.length) throw new TypeError("Canvas genesis section count is invalid")
  const sections = value.sections.map(parseSection)
  let offset = 0n
  for (const section of sections) {
    if (BigInt(section.byteOffset) !== offset) throw new TypeError("Canvas genesis sections are not contiguous")
    offset += BigInt(section.byteLength)
  }
  const totalSectionBytes = parseUint64V2(value.totalSectionBytes)
  if (BigInt(totalSectionBytes) !== offset) throw new TypeError("Canvas genesis total section length is invalid")
  const validationArtifactSetDigest = parseDigestV2(value.validationArtifactSetDigest)
  if (validationArtifactSetDigest !== structuredDigestV2("convax.validation-artifact-set/2", {
    format: "convax.validation-artifact-set/2", artifacts,
  })) throw new TypeError("Canvas genesis validation artifact set digest mismatches")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    checkpointObjectDigest: parseDigestV2(value.checkpointObjectDigest),
    fullUpdateDigest: parseDigestV2(value.fullUpdateDigest),
    stateVectorDigest: parseDigestV2(value.stateVectorDigest),
    canonicalStateDigest: parseDigestV2(value.canonicalStateDigest),
    checkpointAuthorCredentialCoreDigest: parseDigestV2(value.checkpointAuthorCredentialCoreDigest),
    checkpointAuthorReservationReceiptCoreDigest: parseDigestV2(value.checkpointAuthorReservationReceiptCoreDigest),
    checkpointAuthorMembershipSnapshotCoreDigest: parseDigestV2(value.checkpointAuthorMembershipSnapshotCoreDigest),
    serviceTrustBundleCoreDigest: parseDigestV2(value.serviceTrustBundleCoreDigest),
    ownerSchemaDigest: parseDigestV2(value.ownerSchemaDigest),
    canonicalizerDigest: parseDigestV2(value.canonicalizerDigest),
    validationArtifactSetDigest,
    validationArtifacts: artifacts,
    sections: Object.freeze(sections),
    totalSectionBytes,
    protocolDigest: parseDigestV2(value.protocolDigest),
  })
}

function parseSection(value: unknown): CanvasGenesisProofCarrierSectionV2 {
  assertExactKeysV2(value, ["kind", "ordinal", "subject", "byteOffset", "byteLength", "sha256"], "Canvas genesis section")
  const kinds = new Set<string>([
    "checkpoint-author-credential", "checkpoint-author-membership-snapshot",
    "checkpoint-author-reservation-receipt", "checkpoint-canonical-state", "checkpoint-full-update",
    "checkpoint-state-vector", "checkpoint-wrapper", "service-trust-bundle", "validation-artifact",
  ])
  if (typeof value.kind !== "string" || !kinds.has(value.kind)) throw new TypeError("unknown section kind")
  return Object.freeze({
    kind: value.kind as CanvasGenesisProofCarrierSectionV2["kind"],
    ordinal: parseUint32V2(value.ordinal),
    subject: parseSubject(value.kind, value.subject),
    byteOffset: parseUint64V2(value.byteOffset),
    byteLength: parseUint64V2(value.byteLength),
    sha256: parseDigestV2(value.sha256),
  })
}

function parseSubject(kind: string, value: unknown): Readonly<Record<string, unknown>> {
  const coreKind = {
    "checkpoint-author-credential": "replica-actor-credential-core",
    "checkpoint-author-membership-snapshot": "membership-snapshot-core",
    "checkpoint-author-reservation-receipt": "replica-id-reservation-receipt-core",
    "service-trust-bundle": "service-trust-bundle-core",
  }[kind]
  if (coreKind !== undefined) {
    assertExactKeysV2(value, ["kind", "coreDigest"], "Canvas genesis core subject")
    if (value.kind !== coreKind) throw new TypeError("wrong core subject kind")
    return Object.freeze({ kind: value.kind, coreDigest: parseDigestV2(value.coreDigest) })
  }
  const key = {
    "checkpoint-canonical-state": ["canonical-state", "canonicalStateDigest"],
    "checkpoint-full-update": ["yjs-update", "fullUpdateDigest"],
    "checkpoint-state-vector": ["state-vector", "stateVectorDigest"],
    "checkpoint-wrapper": ["replica-checkpoint-object", "checkpointObjectDigest"],
  }[kind]
  if (key !== undefined) {
    assertExactKeysV2(value, ["kind", key[1]!], "Canvas genesis digest subject")
    if (value.kind !== key[0]) throw new TypeError("wrong digest subject kind")
    return Object.freeze({ kind: value.kind, [key[1]!]: parseDigestV2(value[key[1]!]) })
  }
  assertExactKeysV2(value, ["kind", "artifact"], "Canvas genesis artifact subject")
  if (value.kind !== "validation-artifact") throw new TypeError("wrong artifact subject kind")
  const artifact = parseValidationArtifactSetV2({ format: "convax.validation-artifact-set/2", artifacts: [value.artifact] }).artifacts[0]!
  return Object.freeze({ kind: value.kind, artifact })
}

function validateSectionSubjects(decoded: DecodedCarrierV2): void {
  const expectedKinds = [
    "checkpoint-author-credential", "checkpoint-author-membership-snapshot",
    "checkpoint-author-reservation-receipt", "checkpoint-canonical-state", "checkpoint-full-update",
    "checkpoint-state-vector", "checkpoint-wrapper", "service-trust-bundle",
  ] as const
  expectedKinds.forEach((kind, index) => {
    const section = decoded.index.sections[index]!
    if (section.kind !== kind || section.ordinal !== "0") throw new TypeError("singleton order mismatch")
  })
  const mirrors: readonly [number, string, DigestV2][] = [
    [0, "coreDigest", decoded.index.checkpointAuthorCredentialCoreDigest],
    [1, "coreDigest", decoded.index.checkpointAuthorMembershipSnapshotCoreDigest],
    [2, "coreDigest", decoded.index.checkpointAuthorReservationReceiptCoreDigest],
    [3, "canonicalStateDigest", decoded.index.canonicalStateDigest],
    [4, "fullUpdateDigest", decoded.index.fullUpdateDigest],
    [5, "stateVectorDigest", decoded.index.stateVectorDigest],
    [6, "checkpointObjectDigest", decoded.index.checkpointObjectDigest],
    [7, "coreDigest", decoded.index.serviceTrustBundleCoreDigest],
  ]
  for (const [index, key, digest] of mirrors) if (decoded.index.sections[index]!.subject[key] !== digest) throw new TypeError("subject mirror mismatch")
  decoded.index.validationArtifacts.forEach((artifact, ordinal) => {
    const section = decoded.index.sections[ordinal + 8]!
    if (
      section.kind !== "validation-artifact" ||
      section.ordinal !== String(ordinal) ||
      !sameJcs(section.subject.artifact, artifact)
    ) throw new TypeError("validation artifact section mismatch")
  })
}

function selectedCanvasArtifact(authority: VerifiedProtocolAuthorityV2): DigestV2 {
  const artifact = authority.protocolSchemaBundle.core.artifacts.find((entry) => entry.name === "canvas-schema")
  if (!artifact) throw new TypeError("Selected R5 authority has no Canvas artifact")
  return parseDigestV2(artifact.artifactDigest)
}

function selectedValidationArtifacts(authority: VerifiedProtocolAuthorityV2): readonly ValidationArtifactRefV2[] {
  const byName = new Map(authority.protocolSchemaBundle.core.artifacts.map((artifact) => [artifact.name, artifact]))
  const ref = (owner: ValidationArtifactRefV2["owner"], name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence") => {
    const artifact = byName.get(name)
    if (!artifact) throw new TypeError(`Selected R5 authority has no ${name} artifact`)
    return Object.freeze({ owner, format: artifact.format, artifactDigest: artifact.artifactDigest })
  }
  return parseValidationArtifactSetV2({
    format: "convax.validation-artifact-set/2",
    artifacts: [
      ref("canvas", "canvas-schema"),
      ref("control-plane", "control-plane"),
      ref("kernel", "collaboration-kernel"),
      ref("project-index", "project-persistence"),
    ],
  }).artifacts
}

function sameArtifactMaterial(
  material: readonly Readonly<{ artifact: ValidationArtifactRefV2; exactBytes: Uint8Array }>[],
  expected: readonly ValidationArtifactRefV2[],
): boolean {
  return material.length === expected.length && material.every((entry, index) =>
    sameJcs(entry.artifact, expected[index]) && entry.exactBytes.byteLength > 0)
}

function sameArtifacts(left: readonly ValidationArtifactRefV2[], right: readonly ValidationArtifactRefV2[]): boolean {
  return left.length === right.length && left.every((entry, index) => sameJcs(entry, right[index]))
}

function decodeExactJcs(bytes: Uint8Array): unknown {
  const value = decodeRestrictedJcsV2(bytes)
  if (!sameBytes(encodeRestrictedJcsV2(value), bytes)) throw new TypeError("JCS bytes are not exact")
  return value
}

function cloneScope(scope: DocumentScopeV2): DocumentScopeV2 {
  return Object.freeze({ ...parseDocumentScopeV2(scope) })
}

function sameScope(left: DocumentScopeV2, right: DocumentScopeV2): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}

function sameJcs(left: unknown, right: unknown): boolean {
  return sameBytes(encodeRestrictedJcsV2(left), encodeRestrictedJcsV2(right))
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
