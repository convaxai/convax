import {
  ordinarySha256V2,
  parseDigestV2,
  parseDocumentScopeV2,
  type DecodedCausalEditFrameV2,
  type DigestV2,
  type DocumentOwnerKindV2,
  type DocumentScopeV2,
} from "@convax/collaboration"
import type {
  InitializeNativeCollaborationShardWithGenesisProofV2,
  NodeAcceptedReplicaHeadV2,
} from "@convax/project/node"

export interface DocumentGenesisPredecessorV2 {
  /** Exact already-durable ProjectIndex stage frame F. */
  readonly frame: DecodedCausalEditFrameV2
  /** Exact resulting frontier digest returned inside the Kernel commit barrier. */
  readonly acceptedFrontierDigest: DigestV2
}

export interface VerifiedDocumentGenesisCandidateV2<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly checkpointObjectDigest: DigestV2
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly proofCarrierExactBytes: Readonly<Uint8Array>
  readonly acceptedBase: InitializeNativeCollaborationShardWithGenesisProofV2["acceptedBase"]
}

export type PrepareDocumentGenesisResultV2<K extends DocumentOwnerKindV2> =
  | Readonly<{ status: "verified"; candidate: VerifiedDocumentGenesisCandidateV2<K> }>
  | Readonly<{ status: "pending" | "rejected" }>

/** Owner adapter: Canvas constructs/validates CVXCGP02; this generic layer never does. */
export interface DocumentGenesisVerifierPortV2<K extends DocumentOwnerKindV2> {
  prepare(input: {
    readonly scope: DocumentScopeV2 & { readonly docKind: K }
    readonly predecessor: DocumentGenesisPredecessorV2
    readonly signal?: AbortSignal
  }): Promise<PrepareDocumentGenesisResultV2<K>>
}

export interface DurableDocumentGenesisStorePortV2 {
  initializeShardWithGenesisProof(
    input: InitializeNativeCollaborationShardWithGenesisProofV2,
  ): Promise<NodeAcceptedReplicaHeadV2>
}

export interface DurableDocumentGenesisIdentityV2<K extends DocumentOwnerKindV2> {
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
 * One Project-sole-writer barrier: verified owner bytes are defensively copied,
 * installed with their proof carrier, reopened identity is checked, and only then
 * may ProjectIndex activation consume the returned G/F/frontier tuple.
 */
export async function stageDurableDocumentGenesisV2<K extends DocumentOwnerKindV2>(input: {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly predecessor: DocumentGenesisPredecessorV2
  readonly verifier: DocumentGenesisVerifierPortV2<K>
  readonly store: DurableDocumentGenesisStorePortV2
  readonly signal?: AbortSignal
}): Promise<DurableDocumentGenesisIdentityV2<K> | "pending" | "rejected"> {
  assertNotAborted(input.signal)
  const scope = parseDocumentScopeV2(input.scope) as DocumentScopeV2 & { readonly docKind: K }
  const predecessorScope = input.predecessor.frame.header.core.scope
  if (
    predecessorScope.docKind !== "project-index" ||
    predecessorScope.projectId !== scope.projectId ||
    predecessorScope.projectEpoch !== scope.projectEpoch
  ) {
    throw new Error("Document genesis predecessor is not the same ProjectIndex epoch")
  }
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
  ) {
    throw new Error("Durable genesis store returned a different accepted base")
  }
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
  value: VerifiedDocumentGenesisCandidateV2<K>,
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
