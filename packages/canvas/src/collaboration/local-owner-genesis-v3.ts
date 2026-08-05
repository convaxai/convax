import {
  assertLocalOwnerAuthorityClosureV3,
  canonicalStateDigestV2,
  causalFrontierDigestV2,
  causalSignerAuthorityDigestV3,
  encodeFullUpdateV2,
  encodeRestrictedJcsV2,
  decodeRestrictedJcsV2,
  encodeStateVectorV2,
  ordinarySha256V2,
  ownerCanonicalizerDescriptorDigestV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseLocalOwnerEditAuthorizationV3,
  parseLocalProjectOwnerBindingV3,
  parseSignatureV2,
  verifyExactEd25519V2,
  verifyLocalOwnerAuthorityV3,
  replicaActorHeadSetDigestV2,
  stateVectorDigestV2,
  yjsUpdateDigestV2,
  type CausalFrontierV2,
  type DigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type LocalOwnerEditAuthorizationV3,
  type LocalProjectOwnerBindingV3,
  type SignatureV2,
  type Ed25519VerifierPortV2,
  type LocalOwnerSharingStatePortV3,
  type StateVectorV2,
} from "@convax/collaboration"
import type * as Y from "yjs"
import { CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "./session"
import { canvasOwnerCanonicalizerDescriptorV2 } from "./validation"
import { createCanvasYDocV2, encodeCanvasCanonicalStateV2 } from "./ydoc"

export interface LocalOwnerCanvasGenesisCheckpointCoreV3 {
  readonly format: "convax.local-owner-canvas-genesis-checkpoint-core/3"
  readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
  readonly checkpointId: Id128V2
  readonly ownerBindingCoreDigest: DigestV2
  readonly ownerEditAuthorizationCoreDigest: DigestV2
  readonly signerAuthorityDigest: DigestV2
  readonly projectIndexRouteDependencyFrameDigest: DigestV2
  readonly frontierDigest: DigestV2
  readonly actorHeadBoundaryDigest: DigestV2
  readonly stateVectorDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
  readonly fullUpdateDigest: DigestV2
  readonly fullUpdateByteLength: string
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly canonicalizerDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
}

export interface LocalOwnerCanvasGenesisCheckpointV3 {
  readonly format: "convax.local-owner-canvas-genesis-checkpoint/3"
  readonly core: LocalOwnerCanvasGenesisCheckpointCoreV3
  readonly coreDigest: DigestV2
  readonly ownerSignature: SignatureV2
}

export interface LocalOwnerCanvasGenesisProofV3 {
  readonly format: "convax.local-owner-canvas-genesis-proof/3"
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly checkpoint: LocalOwnerCanvasGenesisCheckpointV3
}

export interface LocalOwnerCanvasGenesisAcceptedBaseV3 {
  readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
  readonly frontier: CausalFrontierV2
  readonly frontierDigest: DigestV2
  readonly actorHeads: Readonly<{
    format: "convax.replica-actor-head-set/2"
    scope: DocumentScopeV2 & { readonly docKind: "canvas" }
    heads: readonly []
  }>
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVectorV2
  readonly canonicalStateDigest: DigestV2
}

export interface LocalOwnerCanvasGenesisCandidateV3 {
  readonly document: Y.Doc
  readonly checkpoint: LocalOwnerCanvasGenesisCheckpointV3
  readonly checkpointObjectDigest: DigestV2
  readonly checkpointExactBytes: Uint8Array
  readonly proof: LocalOwnerCanvasGenesisProofV3
  readonly proofExactBytes: Uint8Array
  readonly proofDigest: DigestV2
  readonly acceptedBase: LocalOwnerCanvasGenesisAcceptedBaseV3
}

export interface LocalOwnerCanvasGenesisSignerPortV3 {
  sign(input: Readonly<{
    purpose: "canvas-genesis-checkpoint"
    coreDigest: DigestV2
    exactPurposeBytes: Uint8Array
  }>): Promise<SignatureV2>
}

/**
 * Canvas-owned local-author genesis. Its author is only the exact V3 owner
 * binding/authorization closure; it contains no Team member, reservation,
 * membership snapshot, service bundle, or fabricated compatibility principal.
 */
export async function createLocalOwnerCanvasGenesisCandidateV3(input: {
  readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
  readonly projectIndexRouteDependencyFrameDigest: DigestV2
  readonly checkpointId: Id128V2
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly protocolDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly signer: LocalOwnerCanvasGenesisSignerPortV3
}): Promise<LocalOwnerCanvasGenesisCandidateV3> {
  const scope = requireCanvasScope(input.scope)
  const binding = parseLocalProjectOwnerBindingV3(input.binding)
  const authorization = parseLocalOwnerEditAuthorizationV3(input.authorization)
  const protocolDigest = parseDigestV2(input.protocolDigest)
  const routeFrameDigest = parseDigestV2(input.projectIndexRouteDependencyFrameDigest)
  const signerAuthority = Object.freeze({
    kind: "local-project-owner" as const,
    ownerKeyId: binding.core.ownerKeyId,
    replicaId: binding.core.initialReplicaId,
    actorId: binding.core.initialActorId,
    ownerBindingCoreDigest: binding.coreDigest,
    ownerEditAuthorizationCoreDigest: authorization.coreDigest,
  })
  assertLocalOwnerAuthorityClosureV3({
    authority: signerAuthority,
    binding,
    authorization,
    projectId: scope.projectId,
    projectEpoch: scope.projectEpoch,
    scope,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    protocolDigest,
  })
  const document = createCanvasYDocV2(
    scope,
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    protocolDigest,
    routeFrameDigest,
    binding.core.initialReplicaId,
  )
  const fullUpdate = encodeFullUpdateV2(document)
  const stateVector = encodeStateVectorV2(document)
  const frontier = Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) })
  const frontierDigest = causalFrontierDigestV2(frontier)
  const actorHeads = Object.freeze({ format: "convax.replica-actor-head-set/2" as const, scope, heads: Object.freeze([]) as readonly [] })
  const canonicalStateDigest = canonicalStateDigestV2(
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    encodeCanvasCanonicalStateV2(document, scope),
  )
  const core: LocalOwnerCanvasGenesisCheckpointCoreV3 = Object.freeze({
    format: "convax.local-owner-canvas-genesis-checkpoint-core/3",
    scope,
    checkpointId: parseId128V2(input.checkpointId),
    ownerBindingCoreDigest: binding.coreDigest,
    ownerEditAuthorizationCoreDigest: authorization.coreDigest,
    signerAuthorityDigest: causalSignerAuthorityDigestV3(signerAuthority),
    projectIndexRouteDependencyFrameDigest: routeFrameDigest,
    frontierDigest,
    actorHeadBoundaryDigest: replicaActorHeadSetDigestV2(actorHeads),
    stateVectorDigest: stateVectorDigestV2(stateVector),
    canonicalStateDigest,
    fullUpdateDigest: yjsUpdateDigestV2(fullUpdate),
    fullUpdateByteLength: String(fullUpdate.byteLength),
    protocolDigest,
    schemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    canonicalizerDigest: ownerCanonicalizerDescriptorDigestV2(
      canvasOwnerCanonicalizerDescriptorV2(CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2),
    ),
    validationArtifactSetDigest: parseDigestV2(input.validationArtifactSetDigest),
  })
  const coreDigest = localOwnerCanvasGenesisCheckpointCoreDigestV3(core)
  const checkpoint: LocalOwnerCanvasGenesisCheckpointV3 = Object.freeze({
    format: "convax.local-owner-canvas-genesis-checkpoint/3",
    core,
    coreDigest,
    ownerSignature: parseSignatureV2(await input.signer.sign({
      purpose: "canvas-genesis-checkpoint",
      coreDigest,
      exactPurposeBytes: localOwnerCanvasGenesisCheckpointSignatureDigestV3(coreDigest),
    })),
  })
  const checkpointExactBytes = encodeRestrictedJcsV2(checkpoint)
  const checkpointObjectDigest = domainDigest("convax.local-owner-canvas-genesis-checkpoint-object/3", checkpoint)
  const proof: LocalOwnerCanvasGenesisProofV3 = Object.freeze({
    format: "convax.local-owner-canvas-genesis-proof/3",
    binding,
    authorization,
    checkpoint,
  })
  const proofExactBytes = encodeRestrictedJcsV2(proof)
  return Object.freeze({
    document,
    checkpoint,
    checkpointObjectDigest,
    checkpointExactBytes,
    proof,
    proofExactBytes,
    proofDigest: domainDigest("convax.local-owner-canvas-genesis-proof/3", proof),
    acceptedBase: Object.freeze({ scope, frontier, frontierDigest, actorHeads, fullUpdate, stateVector, canonicalStateDigest }),
  })
}

export function localOwnerCanvasGenesisCheckpointCoreDigestV3(core: LocalOwnerCanvasGenesisCheckpointCoreV3): DigestV2 {
  return domainDigest("convax.local-owner-canvas-genesis-checkpoint-core/3", core)
}

export function localOwnerCanvasGenesisCheckpointSignatureDigestV3(coreDigest: DigestV2): Uint8Array {
  return digestBytes(domainDigest("convax.local-owner-canvas-genesis-checkpoint-signature/3", parseDigestV2(coreDigest)))
}

export type LocalOwnerCanvasGenesisProofVerificationV3 =
  | Readonly<{
      status: "validated"
      proofDigest: DigestV2
      checkpointObjectDigest: DigestV2
      scope: DocumentScopeV2 & { readonly docKind: "canvas" }
      projectIndexRouteDependencyFrameDigest: DigestV2
    }>
  | Readonly<{ status: "rejected" }>

/** Exact successor proof validation used only by ProjectIndex route activation. */
export async function verifyLocalOwnerCanvasGenesisProofV3(input: Readonly<{
  exactBytes: Uint8Array
  protocolDigest: DigestV2
  sharingState: LocalOwnerSharingStatePortV3
  verifier: Ed25519VerifierPortV2
}>): Promise<LocalOwnerCanvasGenesisProofVerificationV3> {
  try {
    const value = decodeRestrictedJcsV2(input.exactBytes)
    exactObject(value, ["format", "binding", "authorization", "checkpoint"])
    if (value.format !== "convax.local-owner-canvas-genesis-proof/3") return rejected()
    const binding = parseLocalProjectOwnerBindingV3(value.binding)
    const authorization = parseLocalOwnerEditAuthorizationV3(value.authorization)
    const checkpointValue = value.checkpoint
    exactObject(checkpointValue, ["format", "core", "coreDigest", "ownerSignature"])
    if (checkpointValue.format !== "convax.local-owner-canvas-genesis-checkpoint/3") return rejected()
    const core = checkpointValue.core
    exactObject(core, [
      "format", "scope", "checkpointId", "ownerBindingCoreDigest", "ownerEditAuthorizationCoreDigest",
      "signerAuthorityDigest", "projectIndexRouteDependencyFrameDigest", "frontierDigest",
      "actorHeadBoundaryDigest", "stateVectorDigest", "canonicalStateDigest", "fullUpdateDigest",
      "fullUpdateByteLength", "protocolDigest", "schemaDigest", "canonicalizerDigest", "validationArtifactSetDigest",
    ])
    if (core.format !== "convax.local-owner-canvas-genesis-checkpoint-core/3") return rejected()
    const scope = requireCanvasScope(core.scope as DocumentScopeV2)
    const parsedCore: LocalOwnerCanvasGenesisCheckpointCoreV3 = Object.freeze({
      format: core.format,
      scope,
      checkpointId: parseId128V2(core.checkpointId),
      ownerBindingCoreDigest: parseDigestV2(core.ownerBindingCoreDigest),
      ownerEditAuthorizationCoreDigest: parseDigestV2(core.ownerEditAuthorizationCoreDigest),
      signerAuthorityDigest: parseDigestV2(core.signerAuthorityDigest),
      projectIndexRouteDependencyFrameDigest: parseDigestV2(core.projectIndexRouteDependencyFrameDigest),
      frontierDigest: parseDigestV2(core.frontierDigest),
      actorHeadBoundaryDigest: parseDigestV2(core.actorHeadBoundaryDigest),
      stateVectorDigest: parseDigestV2(core.stateVectorDigest),
      canonicalStateDigest: parseDigestV2(core.canonicalStateDigest),
      fullUpdateDigest: parseDigestV2(core.fullUpdateDigest),
      fullUpdateByteLength: requireByteLength(core.fullUpdateByteLength),
      protocolDigest: parseDigestV2(core.protocolDigest),
      schemaDigest: parseDigestV2(core.schemaDigest),
      canonicalizerDigest: parseDigestV2(core.canonicalizerDigest),
      validationArtifactSetDigest: parseDigestV2(core.validationArtifactSetDigest),
    })
    const coreDigest = localOwnerCanvasGenesisCheckpointCoreDigestV3(parsedCore)
    if (parseDigestV2(checkpointValue.coreDigest) !== coreDigest ||
      parsedCore.protocolDigest !== parseDigestV2(input.protocolDigest) ||
      parsedCore.schemaDigest !== CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 ||
      parsedCore.ownerBindingCoreDigest !== binding.coreDigest ||
      parsedCore.ownerEditAuthorizationCoreDigest !== authorization.coreDigest) return rejected()
    const authority = Object.freeze({
      kind: "local-project-owner" as const,
      ownerKeyId: binding.core.ownerKeyId,
      replicaId: binding.core.initialReplicaId,
      actorId: binding.core.initialActorId,
      ownerBindingCoreDigest: binding.coreDigest,
      ownerEditAuthorizationCoreDigest: authorization.coreDigest,
    })
    if (parsedCore.signerAuthorityDigest !== causalSignerAuthorityDigestV3(authority)) return rejected()
    const verified = await verifyLocalOwnerAuthorityV3({
      authority, binding, authorization,
      projectId: scope.projectId, projectEpoch: scope.projectEpoch, scope,
      ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
      protocolDigest: parsedCore.protocolDigest,
      sharingState: input.sharingState,
      verifier: input.verifier,
    })
    if (verified === "rejected") return rejected()
    const ownerSignature = parseSignatureV2(checkpointValue.ownerSignature)
    if (!await verifyExactEd25519V2(input.verifier, binding.core.ownerPublicKey, ownerSignature, localOwnerCanvasGenesisCheckpointSignatureDigestV3(coreDigest))) return rejected()
    const checkpoint: LocalOwnerCanvasGenesisCheckpointV3 = Object.freeze({
      format: checkpointValue.format,
      core: parsedCore,
      coreDigest,
      ownerSignature,
    })
    const proof: LocalOwnerCanvasGenesisProofV3 = Object.freeze({ format: value.format, binding, authorization, checkpoint })
    return Object.freeze({
      status: "validated",
      proofDigest: domainDigest("convax.local-owner-canvas-genesis-proof/3", proof),
      checkpointObjectDigest: domainDigest("convax.local-owner-canvas-genesis-checkpoint-object/3", checkpoint),
      scope,
      projectIndexRouteDependencyFrameDigest: parsedCore.projectIndexRouteDependencyFrameDigest,
    })
  } catch {
    return rejected()
  }
}

function requireCanvasScope(input: unknown): DocumentScopeV2 & { readonly docKind: "canvas" } {
  const scope = parseDocumentScopeV2(input)
  if (scope.docKind !== "canvas") throw new TypeError("Local owner Canvas genesis requires a Canvas scope")
  return scope as DocumentScopeV2 & { readonly docKind: "canvas" }
}

function domainDigest(domain: `${string}/3`, value: unknown): DigestV2 {
  const d = new TextEncoder().encode(domain)
  const b = encodeRestrictedJcsV2(value)
  const p = new Uint8Array(d.length + 1 + b.length)
  p.set(d); p.set(b, d.length + 1)
  return ordinarySha256V2(p)
}

function digestBytes(digest: DigestV2): Uint8Array {
  return Uint8Array.from(digest.match(/../gu)!, (pair) => Number.parseInt(pair, 16))
}
function rejected(): LocalOwnerCanvasGenesisProofVerificationV3 { return Object.freeze({ status: "rejected" }) }
function exactObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Local owner Canvas genesis proof object is invalid")
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("Local owner Canvas genesis proof keys differ")
}
function requireByteLength(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > 335544320n) throw new Error("Canvas genesis byte length is invalid")
  return value
}
