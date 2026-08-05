import {
  ordinarySha256V2,
  parseDigestV2,
  parseDocumentScopeV2,
  type DecodedCausalEditFrameV2,
  type DecodedCausalEditFrameV3,
  type DigestV2,
  type DocumentOwnerKindV2,
  type DocumentScopeV2,
} from "@convax/collaboration"
import type {
  InitializeNativeCollaborationShardWithGenesisProofV2,
  NodeAcceptedReplicaHeadV2,
} from "./persistence-store"

export interface ProjectDocumentGenesisPredecessorV2 {
  readonly frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3
  readonly acceptedFrontierDigest: DigestV2
}

export interface VerifiedProjectDocumentGenesisCandidateV2<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly checkpointObjectDigest: DigestV2
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly proofCarrierExactBytes: Readonly<Uint8Array>
  readonly acceptedBase: InitializeNativeCollaborationShardWithGenesisProofV2["acceptedBase"]
}

export type PrepareProjectDocumentGenesisResultV2<K extends DocumentOwnerKindV2> =
  | Readonly<{ status: "verified"; candidate: VerifiedProjectDocumentGenesisCandidateV2<K> }>
  | Readonly<{ status: "pending" | "rejected" }>

/**
 * Owner-specific authoring remains outside Project. A future successor can supply
 * another implementation only after its authority is selected; this port does
 * not infer signer kind, membership, or sharing state.
 */
export interface ProjectDocumentGenesisVerifierPortV2<K extends DocumentOwnerKindV2> {
  prepare(input: {
    readonly scope: DocumentScopeV2 & { readonly docKind: K }
    readonly predecessor: ProjectDocumentGenesisPredecessorV2
    readonly signal?: AbortSignal
  }): Promise<PrepareProjectDocumentGenesisResultV2<K>>
}

export interface ProjectDocumentGenesisStorePortV2 {
  initializeShardWithGenesisProof(
    input: InitializeNativeCollaborationShardWithGenesisProofV2,
  ): Promise<NodeAcceptedReplicaHeadV2>
}

export interface DurableProjectDocumentGenesisIdentityV2<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly predecessorFrameDigest: DigestV2
  readonly stagedProjectIndexFrontierDigest: DigestV2
  readonly checkpointObjectDigest: DigestV2
  readonly checkpointExactBytesSha256: DigestV2
  readonly proofCarrierExactBytesSha256: DigestV2
  readonly fullUpdateDigest: DigestV2
  readonly stateVectorDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
  readonly durableHeadDigest: DigestV2
}

/**
 * Project-owned publication barrier for an owner-verified document genesis.
 * It never constructs a Canvas, chooses an author, or treats a pending author as
 * permission. The exact accepted base must survive the native store round trip.
 */
export async function stageDurableProjectDocumentGenesisV2<K extends DocumentOwnerKindV2>(input: {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly predecessor: ProjectDocumentGenesisPredecessorV2
  readonly verifier: ProjectDocumentGenesisVerifierPortV2<K>
  readonly store: ProjectDocumentGenesisStorePortV2
  readonly signal?: AbortSignal
}): Promise<DurableProjectDocumentGenesisIdentityV2<K> | "pending" | "rejected"> {
  assertNotAborted(input.signal)
  const scope = parseDocumentScopeV2(input.scope) as DocumentScopeV2 & { readonly docKind: K }
  const predecessorScope = input.predecessor.frame.header.core.scope
  if (
    predecessorScope.docKind !== "project-index" ||
    predecessorScope.projectId !== scope.projectId ||
    predecessorScope.projectEpoch !== scope.projectEpoch
  ) throw new Error("Document genesis predecessor is not the same ProjectIndex epoch")

  const predecessorFrameDigest = parseDigestV2(input.predecessor.frame.frameDigest)
  const stagedProjectIndexFrontierDigest = parseDigestV2(input.predecessor.acceptedFrontierDigest)
  const prepared = await input.verifier.prepare({ scope, predecessor: input.predecessor, signal: input.signal })
  assertNotAborted(input.signal)
  if (prepared.status !== "verified") return prepared.status
  const candidate = cloneCandidate(prepared.candidate, scope)
  const durable = await input.store.initializeShardWithGenesisProof(candidate)
  if (
    !sameScope(durable.scope, scope) ||
    durable.frontierDigest !== candidate.acceptedBase.frontierDigest ||
    durable.canonicalStateDigest !== candidate.acceptedBase.canonicalStateDigest ||
    !sameBytes(durable.fullUpdate, candidate.acceptedBase.fullUpdate) ||
    !sameBytes(durable.stateVector, candidate.acceptedBase.stateVector)
  ) throw new Error("Durable genesis store returned a different accepted base")

  return Object.freeze({
    scope,
    predecessorFrameDigest,
    stagedProjectIndexFrontierDigest,
    checkpointObjectDigest: candidate.checkpointObjectDigest,
    checkpointExactBytesSha256: ordinarySha256V2(candidate.checkpointExactBytes),
    proofCarrierExactBytesSha256: ordinarySha256V2(candidate.proofCarrierExactBytes),
    fullUpdateDigest: ordinarySha256V2(candidate.acceptedBase.fullUpdate),
    stateVectorDigest: ordinarySha256V2(candidate.acceptedBase.stateVector),
    canonicalStateDigest: candidate.acceptedBase.canonicalStateDigest,
    durableHeadDigest: durable.headDigest,
  })
}

function cloneCandidate<K extends DocumentOwnerKindV2>(
  value: VerifiedProjectDocumentGenesisCandidateV2<K>,
  expectedScope: DocumentScopeV2 & { readonly docKind: K },
): InitializeNativeCollaborationShardWithGenesisProofV2 {
  const scope = parseDocumentScopeV2(value.scope)
  if (!sameScope(scope, expectedScope)) throw new Error("Verified document genesis crossed scope")
  const acceptedScope = parseDocumentScopeV2(value.acceptedBase.scope)
  if (!sameScope(acceptedScope, expectedScope)) throw new Error("Verified document genesis base crossed scope")
  if (!(value.checkpointExactBytes instanceof Uint8Array) || value.checkpointExactBytes.byteLength < 1) {
    throw new Error("Verified document genesis checkpoint bytes are invalid")
  }
  if (!(value.proofCarrierExactBytes instanceof Uint8Array) || value.proofCarrierExactBytes.byteLength < 1) {
    throw new Error("Verified document genesis proof carrier bytes are invalid")
  }
  return Object.freeze({
    scope: expectedScope,
    checkpointObjectDigest: parseDigestV2(value.checkpointObjectDigest),
    checkpointExactBytes: new Uint8Array(value.checkpointExactBytes),
    proofCarrierExactBytes: new Uint8Array(value.proofCarrierExactBytes),
    acceptedBase: Object.freeze({
      ...value.acceptedBase,
      scope: expectedScope,
      fullUpdate: new Uint8Array(value.acceptedBase.fullUpdate),
      stateVector: new Uint8Array(value.acceptedBase.stateVector) as typeof value.acceptedBase.stateVector,
    }),
  })
}

function sameScope(left: DocumentScopeV2, right: DocumentScopeV2): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false
  return true
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Document genesis was canceled", "AbortError")
}
