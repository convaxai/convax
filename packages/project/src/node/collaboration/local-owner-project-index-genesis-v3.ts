import {
  assertLocalOwnerAuthorityClosureV3,
  canonicalStateDigestV2,
  causalFrontierDigestV2,
  causalSignerAuthorityDigestV3,
  encodeFullUpdateV2,
  encodeRestrictedJcsV2,
  encodeStateVectorV2,
  ordinarySha256V2,
  ownerCanonicalizerDescriptorDigestV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseLocalOwnerEditAuthorizationV3,
  parseLocalProjectOwnerBindingV3,
  parseSignatureV2,
  parseUint32V2,
  parseUint64V2,
  replicaActorHeadSetDigestV2,
  stateVectorDigestV2,
  structuredDigestV2,
  yjsUpdateDigestV2,
  type DigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type LocalOwnerEditAuthorizationV3,
  type LocalProjectOwnerBindingV3,
  type SignatureV2,
} from "@convax/collaboration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  createProjectIndexYDocV2,
  encodeProjectCanonicalStateV2,
  projectIndexOwnerCanonicalizerDescriptorV2,
  type ProjectEntryRecordV2,
} from "../../collaboration/project-index"
import type {
  InitializeNativeCollaborationShardWithGenesisProofV2,
  NodeAcceptedReplicaHeadV2,
} from "./persistence-store"
import type { SuccessorGenesisEvidenceV3 } from "./successor-local-project-provisioner"

export interface LocalOwnerProjectIndexGenesisSignerPortV3 {
  sign(input: Readonly<{
    purpose: "project-index-genesis-checkpoint"
    coreDigest: DigestV2
    exactPurposeBytes: Uint8Array
  }>): Promise<SignatureV2>
}

export interface LocalOwnerProjectIndexGenesisStorePortV3 {
  initializeShardWithGenesisProof(input: InitializeNativeCollaborationShardWithGenesisProofV2): Promise<NodeAcceptedReplicaHeadV2>
}

export interface LocalOwnerProjectIndexGenesisCandidateV3 {
  readonly checkpointObjectDigest: DigestV2
  readonly checkpointExactBytes: Uint8Array
  readonly proofExactBytes: Uint8Array
  readonly proofDigest: DigestV2
  readonly acceptedBase: InitializeNativeCollaborationShardWithGenesisProofV2["acceptedBase"]
}

/** ProjectIndex local-owner genesis contains no Team-compatible synthetic author. */
export async function createLocalOwnerProjectIndexGenesisCandidateV3(input: {
  readonly scope: DocumentScopeV2 & { readonly docKind: "project-index" }
  readonly operationId: Id128V2
  readonly checkpointId: Id128V2
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly protocolDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly signer: LocalOwnerProjectIndexGenesisSignerPortV3
}): Promise<LocalOwnerProjectIndexGenesisCandidateV3> {
  const scope = requireProjectIndexScope(input.scope)
  const binding = parseLocalProjectOwnerBindingV3(input.binding)
  const authorization = parseLocalOwnerEditAuthorizationV3(input.authorization)
  const protocolDigest = parseDigestV2(input.protocolDigest)
  const authority = Object.freeze({
    kind: "local-project-owner" as const,
    ownerKeyId: binding.core.ownerKeyId,
    replicaId: binding.core.initialReplicaId,
    actorId: binding.core.initialActorId,
    ownerBindingCoreDigest: binding.coreDigest,
    ownerEditAuthorizationCoreDigest: authorization.coreDigest,
  })
  assertLocalOwnerAuthorityClosureV3({ authority, binding, authorization, projectId: scope.projectId, projectEpoch: scope.projectEpoch, scope, ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2, protocolDigest })
  const operationId = parseId128V2(input.operationId)
  const rootDirectoryId = `pd_${structuredDigestV2("convax.project-derived-identity/2", { format: "convax.project-derived-identity-core/2", scope, actorId: binding.core.initialActorId, operationId, ordinal: parseUint32V2("0"), kind: "directory" })}` as const
  const rootEntry: ProjectEntryRecordV2 = Object.freeze({
    format: "convax.project-entry/2", entryId: rootDirectoryId, kind: "directory", storageClass: null, contentPolicy: "none", provenance: "project-root", conflictSource: null,
    createdByActorId: binding.core.initialActorId, createdByOperationId: operationId,
    createdStamp: Object.freeze({ format: "convax.portable-stamp/2", lamport: parseUint64V2("0"), actorId: binding.core.initialActorId, operationId, writeOrdinal: parseUint32V2("0") }),
  })
  const document = createProjectIndexYDocV2(Object.freeze({
    format: "convax.project-index-identity/2", schema: "convax.project-index.v2", projectId: scope.projectId, projectEpoch: scope.projectEpoch, shardEpoch: scope.shardEpoch, rootDirectoryId,
    protocolDigest, schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2, uriProtocolDigest: parseDigestV2(input.uriProtocolDigest),
  }), rootEntry)
  const fullUpdate = encodeFullUpdateV2(document)
  const stateVector = encodeStateVectorV2(document)
  const frontier = Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) })
  const frontierDigest = causalFrontierDigestV2(frontier)
  const actorHeads = Object.freeze({ format: "convax.replica-actor-head-set/2" as const, scope, heads: Object.freeze([]) })
  const canonicalStateDigest = canonicalStateDigestV2(PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2, encodeProjectCanonicalStateV2(document))
  const core = Object.freeze({
    format: "convax.local-owner-project-index-genesis-checkpoint-core/3",
    scope,
    checkpointId: parseId128V2(input.checkpointId),
    ownerBindingCoreDigest: binding.coreDigest,
    ownerEditAuthorizationCoreDigest: authorization.coreDigest,
    signerAuthorityDigest: causalSignerAuthorityDigestV3(authority),
    frontierDigest,
    actorHeadBoundaryDigest: replicaActorHeadSetDigestV2(actorHeads),
    stateVectorDigest: stateVectorDigestV2(stateVector),
    canonicalStateDigest,
    fullUpdateDigest: yjsUpdateDigestV2(fullUpdate),
    fullUpdateByteLength: String(fullUpdate.byteLength),
    protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    canonicalizerDigest: ownerCanonicalizerDescriptorDigestV2(projectIndexOwnerCanonicalizerDescriptorV2(PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2)),
    validationArtifactSetDigest: parseDigestV2(input.validationArtifactSetDigest),
  })
  const coreDigest = domainDigest("convax.local-owner-project-index-genesis-checkpoint-core/3", core)
  const checkpoint = Object.freeze({
    format: "convax.local-owner-project-index-genesis-checkpoint/3",
    core,
    coreDigest,
    ownerSignature: parseSignatureV2(await input.signer.sign({ purpose: "project-index-genesis-checkpoint", coreDigest, exactPurposeBytes: signatureDigest(coreDigest) })),
  })
  const checkpointExactBytes = encodeRestrictedJcsV2(checkpoint)
  const checkpointObjectDigest = domainDigest("convax.local-owner-project-index-genesis-checkpoint-object/3", checkpoint)
  const proof = Object.freeze({ format: "convax.local-owner-project-index-genesis-proof/3", binding, authorization, checkpoint })
  const proofExactBytes = encodeRestrictedJcsV2(proof)
  document.destroy()
  return Object.freeze({
    checkpointObjectDigest,
    checkpointExactBytes,
    proofExactBytes,
    proofDigest: domainDigest("convax.local-owner-project-index-genesis-proof/3", proof),
    acceptedBase: Object.freeze({ scope, frontier, frontierDigest, actorHeads, fullUpdate, stateVector, canonicalStateDigest }),
  })
}

export async function publishLocalOwnerProjectIndexGenesisV3(input: {
  readonly candidate: LocalOwnerProjectIndexGenesisCandidateV3
  readonly store: LocalOwnerProjectIndexGenesisStorePortV3
}): Promise<SuccessorGenesisEvidenceV3> {
  const durable = await input.store.initializeShardWithGenesisProof(Object.freeze({
    scope: input.candidate.acceptedBase.scope,
    checkpointObjectDigest: input.candidate.checkpointObjectDigest,
    checkpointExactBytes: input.candidate.checkpointExactBytes,
    proofCarrierExactBytes: input.candidate.proofExactBytes,
    acceptedBase: input.candidate.acceptedBase,
  }))
  if (durable.frontierDigest !== input.candidate.acceptedBase.frontierDigest || durable.canonicalStateDigest !== input.candidate.acceptedBase.canonicalStateDigest) throw new Error("Durable ProjectIndex genesis differs from its owner-authored candidate")
  return Object.freeze({
    authorizationProofDigest: input.candidate.proofDigest,
    durableCheckpointDigest: input.candidate.checkpointObjectDigest,
    acceptedHeadDigest: durable.headDigest,
    acceptedFrontierDigest: durable.frontierDigest,
  })
}

function requireProjectIndexScope(input: DocumentScopeV2) { const scope = parseDocumentScopeV2(input); if (scope.docKind !== "project-index") throw new TypeError("Local owner ProjectIndex genesis requires ProjectIndex scope"); return scope as DocumentScopeV2 & { readonly docKind: "project-index" } }
function domainDigest(domain: `${string}/3`, value: unknown) { const d = new TextEncoder().encode(domain); const b = encodeRestrictedJcsV2(value); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return ordinarySha256V2(p) }
function signatureDigest(coreDigest: DigestV2) { return Uint8Array.from(domainDigest("convax.local-owner-project-index-genesis-checkpoint-signature/3", parseDigestV2(coreDigest)).match(/../gu)!, (pair) => Number.parseInt(pair, 16)) }
