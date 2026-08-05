import type { DigestV2, Id128V2, MemberIdV2, ProjectIdV2, PublicKeyV2, ReplicaIdV2, ActorIdV2, SignatureV2 } from "./codecs"
import { parseActorIdV2, parseDigestV2, parseId128V2, parseMemberIdV2, parseProjectIdV2, parsePublicKeyV2, parseReplicaIdV2, parseSignatureV2 } from "./codecs"
import type { DocumentScopeV2 } from "./contracts"
import { ordinarySha256V2 } from "./digest"
import { verifyExactEd25519V2, type Ed25519VerifierPortV2 } from "./crypto"
import { failCodec } from "./errors"
import { assertDenseArrayV2, assertExactKeysV2, compareBytesV2, decodeRestrictedJcsV2, encodeRestrictedJcsV2 } from "./jcs"
import { parseDocumentScopeV2 } from "./parse"

export interface ProjectSharingHandoffDocumentHeadV3 {
  readonly scope: DocumentScopeV2
  readonly acceptedFrontierDigest: DigestV2
  readonly acceptedHeadDigest: DigestV2
}

export interface ProjectSharingHandoffCoreV3 {
  readonly format: "convax.project-sharing-handoff-core/3"
  readonly handoffId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly previousOwnerBindingCoreDigest: DigestV2
  readonly previousOwnerKeyId: DigestV2
  readonly sharingGeneration: "1"
  readonly projectIndexHead: ProjectSharingHandoffDocumentHeadV3 & { readonly scope: DocumentScopeV2 & { readonly docKind: "project-index" } }
  readonly liveCanvasHeads: readonly ProjectSharingHandoffDocumentHeadV3[]
  readonly serviceTrustBundleDigest: DigestV2
  readonly initialMembershipSnapshotDigest: DigestV2
  readonly initialOwnerMemberId: MemberIdV2
  readonly initialOwnerReplicaId: ReplicaIdV2
  readonly initialOwnerActorId: ActorIdV2
  readonly initialReplicaActorCredentialCoreDigest: DigestV2
  readonly initialReplicaEditAuthorizationCoreDigest: DigestV2
  readonly successorProtocolDigest: DigestV2
}

export interface ProjectSharingHandoffReceiptV3 {
  readonly format: "convax.project-sharing-handoff-receipt/3"
  readonly core: ProjectSharingHandoffCoreV3
  readonly coreDigest: DigestV2
  readonly ownerSignature: SignatureV2
  readonly serviceSigningPublicKey: PublicKeyV2
  readonly serviceSigningKeyId: DigestV2
  readonly serviceSignature: SignatureV2
}

export type ProjectSharingHandoffSubmitResultV3 =
  | Readonly<{ status: "committed"; receipt: ProjectSharingHandoffReceiptV3 }>
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "rejected" }>

export interface ProjectSharingHandoffSubmissionPortV3 {
  submit(input: Readonly<{ handoffId: Id128V2; coreDigest: DigestV2; encodedReceipt: Uint8Array }>): Promise<ProjectSharingHandoffSubmitResultV3>
}

export interface ProjectSharingServiceTrustPortV3 {
  resolve(input: Readonly<{ trustBundleDigest: DigestV2; serviceSigningKeyId: DigestV2 }>): Promise<Readonly<{ status: "verified"; publicKey: PublicKeyV2 }> | Readonly<{ status: "pending" | "rejected" }>>
}

const CORE_DOMAIN = "convax.project-sharing-handoff-core/3"
const KEY_DOMAIN = "convax.project-sharing-service-public-key/3"
const OWNER_KEY_DOMAIN = "convax.local-project-owner-public-key/3"

export function parseProjectSharingHandoffCoreV3(value: unknown): ProjectSharingHandoffCoreV3 {
  assertExactKeysV2(value, ["format", "handoffId", "projectId", "projectEpoch", "previousOwnerBindingCoreDigest", "previousOwnerKeyId", "sharingGeneration", "projectIndexHead", "liveCanvasHeads", "serviceTrustBundleDigest", "initialMembershipSnapshotDigest", "initialOwnerMemberId", "initialOwnerReplicaId", "initialOwnerActorId", "initialReplicaActorCredentialCoreDigest", "initialReplicaEditAuthorizationCoreDigest", "successorProtocolDigest"], "ProjectSharingHandoffCoreV3")
  if (value.format !== CORE_DOMAIN || value.sharingGeneration !== "1") failCodec("Project sharing handoff discriminator is invalid")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const projectIndexHead = parseHead(value.projectIndexHead, projectId, projectEpoch)
  if (projectIndexHead.scope.docKind !== "project-index") failCodec("Project sharing handoff requires one ProjectIndex head")
  assertDenseArrayV2(value.liveCanvasHeads, "ProjectSharingHandoffCoreV3.liveCanvasHeads")
  const liveCanvasHeads = value.liveCanvasHeads.map((head) => parseHead(head, projectId, projectEpoch))
  for (const head of liveCanvasHeads) if (head.scope.docKind !== "canvas") failCodec("Project sharing handoff live set may contain only Canvas heads")
  for (let index = 1; index < liveCanvasHeads.length; index += 1) {
    if (compareBytesV2(encodeRestrictedJcsV2(liveCanvasHeads[index - 1]!.scope), encodeRestrictedJcsV2(liveCanvasHeads[index]!.scope)) >= 0) failCodec("Project sharing handoff Canvas heads must be strictly sorted and duplicate-free")
  }
  return Object.freeze({
    format: value.format, handoffId: parseId128V2(value.handoffId), projectId, projectEpoch,
    previousOwnerBindingCoreDigest: parseDigestV2(value.previousOwnerBindingCoreDigest), previousOwnerKeyId: parseDigestV2(value.previousOwnerKeyId), sharingGeneration: value.sharingGeneration,
    projectIndexHead: projectIndexHead as ProjectSharingHandoffCoreV3["projectIndexHead"], liveCanvasHeads: Object.freeze(liveCanvasHeads),
    serviceTrustBundleDigest: parseDigestV2(value.serviceTrustBundleDigest), initialMembershipSnapshotDigest: parseDigestV2(value.initialMembershipSnapshotDigest),
    initialOwnerMemberId: parseMemberIdV2(value.initialOwnerMemberId), initialOwnerReplicaId: parseReplicaIdV2(value.initialOwnerReplicaId), initialOwnerActorId: parseActorIdV2(value.initialOwnerActorId),
    initialReplicaActorCredentialCoreDigest: parseDigestV2(value.initialReplicaActorCredentialCoreDigest), initialReplicaEditAuthorizationCoreDigest: parseDigestV2(value.initialReplicaEditAuthorizationCoreDigest), successorProtocolDigest: parseDigestV2(value.successorProtocolDigest),
  })
}

export function projectSharingHandoffCoreDigestV3(value: ProjectSharingHandoffCoreV3): DigestV2 { return digestDomain(CORE_DOMAIN, parseProjectSharingHandoffCoreV3(value)) }

export function parseProjectSharingHandoffReceiptV3(value: unknown): ProjectSharingHandoffReceiptV3 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "ownerSignature", "serviceSigningPublicKey", "serviceSigningKeyId", "serviceSignature"], "ProjectSharingHandoffReceiptV3")
  if (value.format !== "convax.project-sharing-handoff-receipt/3") failCodec("Project sharing handoff receipt format is invalid")
  const core = parseProjectSharingHandoffCoreV3(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  const serviceSigningPublicKey = parsePublicKeyV2(value.serviceSigningPublicKey)
  const serviceSigningKeyId = parseDigestV2(value.serviceSigningKeyId)
  if (coreDigest !== projectSharingHandoffCoreDigestV3(core) || serviceSigningKeyId !== digestDomain(KEY_DOMAIN, serviceSigningPublicKey)) failCodec("Project sharing handoff receipt digest closure is invalid")
  return Object.freeze({ format: value.format, core, coreDigest, ownerSignature: parseSignatureV2(value.ownerSignature), serviceSigningPublicKey, serviceSigningKeyId, serviceSignature: parseSignatureV2(value.serviceSignature) })
}

export async function verifyProjectSharingHandoffReceiptV3(input: Readonly<{
  receipt: ProjectSharingHandoffReceiptV3
  ownerPublicKey: PublicKeyV2
  expectedOwnerKeyId: DigestV2
  verifier: Ed25519VerifierPortV2
  serviceTrust: ProjectSharingServiceTrustPortV3
}>): Promise<"verified" | "pending" | "rejected"> {
  let receipt: ProjectSharingHandoffReceiptV3
  try {
    receipt = parseProjectSharingHandoffReceiptV3(input.receipt)
    const ownerPublicKey = parsePublicKeyV2(input.ownerPublicKey)
    if (receipt.core.previousOwnerKeyId !== parseDigestV2(input.expectedOwnerKeyId)) return "rejected"
    if (receipt.core.previousOwnerKeyId !== digestDomain(OWNER_KEY_DOMAIN, ownerPublicKey)) return "rejected"
    const service = await input.serviceTrust.resolve({ trustBundleDigest: receipt.core.serviceTrustBundleDigest, serviceSigningKeyId: receipt.serviceSigningKeyId })
    if (service.status !== "verified") return service.status
    if (service.publicKey !== receipt.serviceSigningPublicKey) return "rejected"
    const purpose = signaturePurpose(receipt.coreDigest)
    if (!await verifyExactEd25519V2(input.verifier, ownerPublicKey, receipt.ownerSignature, purpose)) return "rejected"
    if (!await verifyExactEd25519V2(input.verifier, receipt.serviceSigningPublicKey, receipt.serviceSignature, purpose)) return "rejected"
    return "verified"
  } catch { return "rejected" }
}

/** Enforces byte-idempotency by handoff id; same id with different bytes is equivocation. */
export class InMemoryProjectSharingHandoffSubmissionV3 implements ProjectSharingHandoffSubmissionPortV3 {
  private readonly committed = new Map<Id128V2, Readonly<{ digest: DigestV2; bytes: Uint8Array; receipt: ProjectSharingHandoffReceiptV3 }>>()
  async submit(input: Readonly<{ handoffId: Id128V2; coreDigest: DigestV2; encodedReceipt: Uint8Array }>): Promise<ProjectSharingHandoffSubmitResultV3> {
    const handoffId = parseId128V2(input.handoffId); const coreDigest = parseDigestV2(input.coreDigest)
    const receipt = parseProjectSharingHandoffReceiptV3(decodeRestrictedJcsV2(input.encodedReceipt))
    if (receipt.core.handoffId !== handoffId || receipt.coreDigest !== coreDigest) return Object.freeze({ status: "rejected" })
    const current = this.committed.get(handoffId)
    if (current) return current.digest === coreDigest && equalBytes(current.bytes, input.encodedReceipt) ? Object.freeze({ status: "committed", receipt: current.receipt }) : Object.freeze({ status: "rejected" })
    this.committed.set(handoffId, Object.freeze({ digest: coreDigest, bytes: input.encodedReceipt.slice(), receipt }))
    return Object.freeze({ status: "committed", receipt })
  }
}

function parseHead(value: unknown, projectId: ProjectIdV2, projectEpoch: Id128V2): ProjectSharingHandoffDocumentHeadV3 {
  assertExactKeysV2(value, ["scope", "acceptedFrontierDigest", "acceptedHeadDigest"], "ProjectSharingHandoffDocumentHeadV3")
  const scope = parseDocumentScopeV2(value.scope)
  if (scope.projectId !== projectId || scope.projectEpoch !== projectEpoch) failCodec("Project sharing handoff head crossed its Project epoch")
  return Object.freeze({ scope, acceptedFrontierDigest: parseDigestV2(value.acceptedFrontierDigest), acceptedHeadDigest: parseDigestV2(value.acceptedHeadDigest) })
}
function digestDomain(domain: string, value: unknown): DigestV2 { const d = new TextEncoder().encode(domain); const b = encodeRestrictedJcsV2(value); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return ordinarySha256V2(p) }
function signaturePurpose(digest: DigestV2): Uint8Array { const d = new TextEncoder().encode("convax.project-sharing-handoff-signature/3"); const b = Uint8Array.from(digest.match(/../gu)!.map((x) => Number.parseInt(x, 16))); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return Uint8Array.from(ordinarySha256V2(p).match(/../gu)!.map((x) => Number.parseInt(x, 16))) }
function equalBytes(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((v, i) => v === b[i]) }
