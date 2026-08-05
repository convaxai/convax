import type {
  ActorIdV2,
  DigestV2,
  Id128V2,
  MemberIdV2,
  ProjectIdV2,
  PublicKeyV2,
  ReplicaIdV2,
  SignatureV2,
} from "./codecs"
import type { DocumentScopeV2 } from "./contracts"
import {
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
} from "./codecs"
import { ordinarySha256V2 } from "./digest"
import { verifyExactEd25519V2, type Ed25519VerifierPortV2 } from "./crypto"
import { failCodec } from "./errors"
import { assertDenseArrayV2, assertExactKeysV2, compareUtf8V2, encodeRestrictedJcsV2 } from "./jcs"
import { parseDocumentScopeV2 } from "./parse"

export const SUCCESSOR_AUTHORITY_DOMAINS_V3 = Object.freeze({
  localOwnerBindingCore: "convax.local-project-owner-binding-core/3",
  localOwnerEditAuthorizationCore: "convax.local-owner-edit-authorization-core/3",
  causalSignerAuthority: "convax.causal-signer-authority/3",
} as const)

export interface LocalProjectOwnerSignerAuthorityV3 {
  readonly kind: "local-project-owner"
  readonly ownerKeyId: DigestV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly ownerBindingCoreDigest: DigestV2
  readonly ownerEditAuthorizationCoreDigest: DigestV2
}

export interface TeamReplicaSignerAuthorityV3 {
  readonly kind: "team-replica"
  readonly memberId: MemberIdV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly replicaActorCredentialCoreDigest: DigestV2
  readonly replicaEditAuthorizationCoreDigest: DigestV2
}

export type CausalSignerAuthorityV3 =
  | LocalProjectOwnerSignerAuthorityV3
  | TeamReplicaSignerAuthorityV3

export type CausalAuthorityDependencyKindV3 =
  | "local-owner-binding"
  | "local-owner-edit-authorization"
  | "membership-snapshot"
  | "replica-actor-credential"
  | "replica-edit-authorization"

export interface CausalAuthorityDependencyRefV3 {
  readonly kind: CausalAuthorityDependencyKindV3
  readonly digest: DigestV2
}

export interface LocalProjectOwnerBindingCoreV3 {
  readonly format: "convax.local-project-owner-binding-core/3"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly ownerKeyId: DigestV2
  readonly ownerPublicKey: PublicKeyV2
  readonly initialReplicaId: ReplicaIdV2
  readonly initialActorId: ActorIdV2
  readonly protocolDigest: DigestV2
  readonly genesisAuthorizationPolicy: LocalOwnerGenesisAuthorizationPolicyV3
  readonly sharingGeneration: "0"
  readonly creationNonce: Id128V2
}

export interface LocalOwnerGenesisAuthorizationPolicyV3 {
  readonly format: "convax.local-owner-genesis-authorization-policy/3"
  readonly projectIndexScope: DocumentScopeV2 & { readonly docKind: "project-index" }
  readonly canvasAuthorization: "accepted-project-index-route-genesis-only"
}

export interface LocalOwnerActorSequenceAllocationPolicyV3 {
  readonly format: "convax.local-owner-actor-sequence-allocation-policy/3"
  readonly kind: "strict-durable-head-successor"
  readonly initialSequence: "1"
}

export interface LocalProjectOwnerBindingV3 {
  readonly format: "convax.local-project-owner-binding/3"
  readonly core: LocalProjectOwnerBindingCoreV3
  readonly coreDigest: DigestV2
  readonly ownerSignature: SignatureV2
}

export interface LocalOwnerEditAuthorizationCoreV3 {
  readonly format: "convax.local-owner-edit-authorization-core/3"
  readonly ownerBindingCoreDigest: DigestV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly ownerSchemaDigest: DigestV2
  readonly actorSequenceAllocationPolicy: LocalOwnerActorSequenceAllocationPolicyV3
  readonly protocolDigest: DigestV2
  readonly sharingGeneration: "0"
  readonly expiryPolicy: "none"
}

export interface LocalOwnerEditAuthorizationV3 {
  readonly format: "convax.local-owner-edit-authorization/3"
  readonly core: LocalOwnerEditAuthorizationCoreV3
  readonly coreDigest: DigestV2
  readonly ownerSignature: SignatureV2
}

export interface LocalOwnerSharingStatePortV3 {
  resolve(projectId: ProjectIdV2, projectEpoch: Id128V2): Promise<"unshared" | "shared" | "ambiguous">
}

export type VerifiedLocalOwnerAuthorityV3 = Readonly<{
  authority: LocalProjectOwnerSignerAuthorityV3
  ownerPublicKey: PublicKeyV2
}>

export function parseCausalSignerAuthorityV3(value: unknown): CausalSignerAuthorityV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) failCodec("CausalSignerAuthorityV3 must be an object")
  const source = value as Record<string, unknown>
  if (source.kind === "local-project-owner") {
    assertExactKeysV2(source, ["kind", "ownerKeyId", "replicaId", "actorId", "ownerBindingCoreDigest", "ownerEditAuthorizationCoreDigest"], "LocalProjectOwnerSignerAuthorityV3")
    return Object.freeze({
      kind: source.kind,
      ownerKeyId: parseDigestV2(source.ownerKeyId),
      replicaId: parseReplicaIdV2(source.replicaId),
      actorId: parseActorIdV2(source.actorId),
      ownerBindingCoreDigest: parseDigestV2(source.ownerBindingCoreDigest),
      ownerEditAuthorizationCoreDigest: parseDigestV2(source.ownerEditAuthorizationCoreDigest),
    })
  }
  if (source.kind === "team-replica") {
    assertExactKeysV2(source, [
      "kind", "memberId", "replicaId", "actorId", "memberAuthorizationEpoch",
      "replicaAuthorizationEpoch", "membershipSnapshotDigest",
      "replicaActorCredentialCoreDigest", "replicaEditAuthorizationCoreDigest",
    ], "TeamReplicaSignerAuthorityV3")
    return Object.freeze({
      kind: source.kind,
      memberId: parseMemberIdV2(source.memberId),
      replicaId: parseReplicaIdV2(source.replicaId),
      actorId: parseActorIdV2(source.actorId),
      memberAuthorizationEpoch: parseId128V2(source.memberAuthorizationEpoch),
      replicaAuthorizationEpoch: parseId128V2(source.replicaAuthorizationEpoch),
      membershipSnapshotDigest: parseDigestV2(source.membershipSnapshotDigest),
      replicaActorCredentialCoreDigest: parseDigestV2(source.replicaActorCredentialCoreDigest),
      replicaEditAuthorizationCoreDigest: parseDigestV2(source.replicaEditAuthorizationCoreDigest),
    })
  }
  failCodec("CausalSignerAuthorityV3 kind is invalid")
}

export function causalSignerAuthorityDigestV3(value: CausalSignerAuthorityV3): DigestV2 {
  return structuredDigestV3(SUCCESSOR_AUTHORITY_DOMAINS_V3.causalSignerAuthority, parseCausalSignerAuthorityV3(value))
}

export function parseCausalAuthorityDependenciesV3(
  value: unknown,
  authorityInput: CausalSignerAuthorityV3,
): readonly CausalAuthorityDependencyRefV3[] {
  assertDenseArrayV2(value, "CausalAuthorityDependencyRefV3[]")
  const authority = parseCausalSignerAuthorityV3(authorityInput)
  const allowed = new Set<CausalAuthorityDependencyKindV3>([
    "local-owner-binding", "local-owner-edit-authorization", "membership-snapshot",
    "replica-actor-credential", "replica-edit-authorization",
  ])
  const dependencies = value.map((entry, index) => {
    assertExactKeysV2(entry, ["kind", "digest"], `CausalAuthorityDependencyRefV3[${index}]`)
    if (typeof entry.kind !== "string" || !allowed.has(entry.kind as CausalAuthorityDependencyKindV3)) failCodec("Causal authority dependency kind is invalid")
    return Object.freeze({ kind: entry.kind as CausalAuthorityDependencyKindV3, digest: parseDigestV2(entry.digest) })
  })
  for (let index = 1; index < dependencies.length; index += 1) {
    const left = dependencies[index - 1]!
    const right = dependencies[index]!
    const order = compareUtf8V2(left.kind, right.kind) || compareUtf8V2(left.digest, right.digest)
    if (order >= 0) failCodec("Causal authority dependencies must be strictly sorted and duplicate-free")
  }
  const expected = authority.kind === "local-project-owner"
    ? [
        { kind: "local-owner-binding", digest: authority.ownerBindingCoreDigest },
        { kind: "local-owner-edit-authorization", digest: authority.ownerEditAuthorizationCoreDigest },
      ] as const
    : [
        { kind: "membership-snapshot", digest: authority.membershipSnapshotDigest },
        { kind: "replica-actor-credential", digest: authority.replicaActorCredentialCoreDigest },
        { kind: "replica-edit-authorization", digest: authority.replicaEditAuthorizationCoreDigest },
      ] as const
  if (dependencies.length !== expected.length || expected.some((item) => !dependencies.some((dependency) => dependency.kind === item.kind && dependency.digest === item.digest))) {
    failCodec("Causal authority dependency closure is not exact for its signer kind")
  }
  return Object.freeze(dependencies)
}

export function parseLocalProjectOwnerBindingCoreV3(value: unknown): LocalProjectOwnerBindingCoreV3 {
  assertExactKeysV2(value, [
    "format", "projectId", "projectEpoch", "ownerKeyId", "ownerPublicKey",
    "initialReplicaId", "initialActorId", "protocolDigest",
    "genesisAuthorizationPolicy", "sharingGeneration", "creationNonce",
  ], "LocalProjectOwnerBindingCoreV3")
  if (value.format !== "convax.local-project-owner-binding-core/3" || value.sharingGeneration !== "0") failCodec("Local Project owner binding discriminator is invalid")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const genesisAuthorizationPolicy = parseLocalOwnerGenesisAuthorizationPolicyV3(value.genesisAuthorizationPolicy)
  if (genesisAuthorizationPolicy.projectIndexScope.projectId !== projectId ||
    genesisAuthorizationPolicy.projectIndexScope.projectEpoch !== projectEpoch) {
    failCodec("Local Project owner genesis policy crossed its Project or epoch")
  }
  return Object.freeze({
    format: value.format,
    projectId,
    projectEpoch,
    ownerKeyId: parseDigestV2(value.ownerKeyId),
    ownerPublicKey: parsePublicKeyV2(value.ownerPublicKey),
    initialReplicaId: parseReplicaIdV2(value.initialReplicaId),
    initialActorId: parseActorIdV2(value.initialActorId),
    protocolDigest: parseDigestV2(value.protocolDigest),
    genesisAuthorizationPolicy,
    sharingGeneration: value.sharingGeneration,
    creationNonce: parseId128V2(value.creationNonce),
  })
}

export function parseLocalOwnerGenesisAuthorizationPolicyV3(value: unknown): LocalOwnerGenesisAuthorizationPolicyV3 {
  assertExactKeysV2(value, ["format", "projectIndexScope", "canvasAuthorization"], "LocalOwnerGenesisAuthorizationPolicyV3")
  if (value.format !== "convax.local-owner-genesis-authorization-policy/3" ||
    value.canvasAuthorization !== "accepted-project-index-route-genesis-only") {
    failCodec("Local owner genesis authorization policy is invalid")
  }
  const projectIndexScope = parseDocumentScopeV2(value.projectIndexScope)
  if (projectIndexScope.docKind !== "project-index") failCodec("Local owner genesis policy requires an exact ProjectIndex scope")
  return Object.freeze({
    format: value.format,
    projectIndexScope: projectIndexScope as DocumentScopeV2 & { readonly docKind: "project-index" },
    canvasAuthorization: value.canvasAuthorization,
  })
}

export function parseLocalOwnerActorSequenceAllocationPolicyV3(value: unknown): LocalOwnerActorSequenceAllocationPolicyV3 {
  assertExactKeysV2(value, ["format", "kind", "initialSequence"], "LocalOwnerActorSequenceAllocationPolicyV3")
  if (value.format !== "convax.local-owner-actor-sequence-allocation-policy/3" ||
    value.kind !== "strict-durable-head-successor" || value.initialSequence !== "1") {
    failCodec("Local owner actor sequence allocation policy is invalid")
  }
  return Object.freeze({ format: value.format, kind: value.kind, initialSequence: value.initialSequence })
}

export function localProjectOwnerBindingCoreDigestV3(value: LocalProjectOwnerBindingCoreV3): DigestV2 {
  return structuredDigestV3(SUCCESSOR_AUTHORITY_DOMAINS_V3.localOwnerBindingCore, parseLocalProjectOwnerBindingCoreV3(value))
}

export function localProjectOwnerKeyIdV3(publicKey: PublicKeyV2): DigestV2 {
  return structuredDigestV3("convax.local-project-owner-public-key/3", parsePublicKeyV2(publicKey))
}

export function localProjectOwnerBindingSignatureDigestV3(coreDigest: DigestV2): Uint8Array {
  return successorSignaturePurposeV3("convax.local-project-owner-binding-signature/3", parseDigestV2(coreDigest))
}

export function parseLocalProjectOwnerBindingV3(value: unknown): LocalProjectOwnerBindingV3 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "ownerSignature"], "LocalProjectOwnerBindingV3")
  if (value.format !== "convax.local-project-owner-binding/3") failCodec("Local Project owner binding format is invalid")
  const core = parseLocalProjectOwnerBindingCoreV3(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== localProjectOwnerBindingCoreDigestV3(core) || core.ownerKeyId !== structuredDigestV3("convax.local-project-owner-public-key/3", core.ownerPublicKey)) failCodec("Local Project owner binding digest closure is invalid")
  return Object.freeze({ format: value.format, core, coreDigest, ownerSignature: parseSignatureV2(value.ownerSignature) })
}

export function parseLocalOwnerEditAuthorizationCoreV3(value: unknown): LocalOwnerEditAuthorizationCoreV3 {
  assertExactKeysV2(value, ["format", "ownerBindingCoreDigest", "projectId", "projectEpoch", "scope", "replicaId", "actorId", "ownerSchemaDigest", "actorSequenceAllocationPolicy", "protocolDigest", "sharingGeneration", "expiryPolicy"], "LocalOwnerEditAuthorizationCoreV3")
  if (value.format !== "convax.local-owner-edit-authorization-core/3" || value.sharingGeneration !== "0" || value.expiryPolicy !== "none") failCodec("Local owner edit authorization discriminator is invalid")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const scope = parseDocumentScopeV2(value.scope)
  if (scope.projectId !== projectId || scope.projectEpoch !== projectEpoch) failCodec("Local owner edit authorization scope crossed its Project or epoch")
  return Object.freeze({
    format: value.format,
    ownerBindingCoreDigest: parseDigestV2(value.ownerBindingCoreDigest),
    projectId,
    projectEpoch,
    scope,
    replicaId: parseReplicaIdV2(value.replicaId),
    actorId: parseActorIdV2(value.actorId),
    ownerSchemaDigest: parseDigestV2(value.ownerSchemaDigest),
    actorSequenceAllocationPolicy: parseLocalOwnerActorSequenceAllocationPolicyV3(value.actorSequenceAllocationPolicy),
    protocolDigest: parseDigestV2(value.protocolDigest),
    sharingGeneration: value.sharingGeneration,
    expiryPolicy: value.expiryPolicy,
  })
}

export function localOwnerEditAuthorizationCoreDigestV3(value: LocalOwnerEditAuthorizationCoreV3): DigestV2 {
  return structuredDigestV3(SUCCESSOR_AUTHORITY_DOMAINS_V3.localOwnerEditAuthorizationCore, parseLocalOwnerEditAuthorizationCoreV3(value))
}

export function localOwnerEditAuthorizationSignatureDigestV3(coreDigest: DigestV2): Uint8Array {
  return successorSignaturePurposeV3("convax.local-owner-edit-authorization-signature/3", parseDigestV2(coreDigest))
}

export function parseLocalOwnerEditAuthorizationV3(value: unknown): LocalOwnerEditAuthorizationV3 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "ownerSignature"], "LocalOwnerEditAuthorizationV3")
  if (value.format !== "convax.local-owner-edit-authorization/3") failCodec("Local owner edit authorization format is invalid")
  const core = parseLocalOwnerEditAuthorizationCoreV3(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== localOwnerEditAuthorizationCoreDigestV3(core)) failCodec("Local owner edit authorization core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, ownerSignature: parseSignatureV2(value.ownerSignature) })
}

export function assertLocalOwnerAuthorityClosureV3(input: {
  readonly authority: LocalProjectOwnerSignerAuthorityV3
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly ownerSchemaDigest: DigestV2
  readonly protocolDigest: DigestV2
}): void {
  const authority = parseCausalSignerAuthorityV3(input.authority)
  if (authority.kind !== "local-project-owner") failCodec("Local owner authority kind is invalid")
  const binding = parseLocalProjectOwnerBindingV3(input.binding)
  const authorization = parseLocalOwnerEditAuthorizationV3(input.authorization)
  const projectId = parseProjectIdV2(input.projectId)
  const projectEpoch = parseId128V2(input.projectEpoch)
  const scope = parseDocumentScopeV2(input.scope)
  const ownerSchemaDigest = parseDigestV2(input.ownerSchemaDigest)
  const protocolDigest = parseDigestV2(input.protocolDigest)
  if (authority.ownerKeyId !== binding.core.ownerKeyId || authority.ownerBindingCoreDigest !== binding.coreDigest ||
    authority.ownerEditAuthorizationCoreDigest !== authorization.coreDigest || authority.replicaId !== authorization.core.replicaId ||
    authority.actorId !== authorization.core.actorId || authorization.core.ownerBindingCoreDigest !== binding.coreDigest ||
    binding.core.initialReplicaId !== authority.replicaId || binding.core.initialActorId !== authority.actorId ||
    binding.core.projectId !== projectId || authorization.core.projectId !== projectId ||
    binding.core.projectEpoch !== projectEpoch || authorization.core.projectEpoch !== projectEpoch ||
    authorization.core.ownerSchemaDigest !== ownerSchemaDigest || binding.core.protocolDigest !== protocolDigest ||
    authorization.core.protocolDigest !== protocolDigest || !sameDocumentScopeV3(authorization.core.scope, scope)) {
    failCodec("Local owner authority graph crossed its exact Project, signer, or protocol binding")
  }
}

/**
 * Successor admission gate. The Project-external sharing tombstone is checked
 * before either signature so a restored pre-sharing Project directory cannot
 * reactivate its owner key.
 */
export async function verifyLocalOwnerAuthorityV3(input: {
  readonly authority: LocalProjectOwnerSignerAuthorityV3
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly ownerSchemaDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly sharingState: LocalOwnerSharingStatePortV3
  readonly verifier: Ed25519VerifierPortV2
}): Promise<VerifiedLocalOwnerAuthorityV3 | "rejected"> {
  const projectId = parseProjectIdV2(input.projectId)
  const projectEpoch = parseId128V2(input.projectEpoch)
  if (!input.sharingState || typeof input.sharingState.resolve !== "function" || !input.verifier || typeof input.verifier.verify !== "function") failCodec("Local owner verifier ports are required")
  if (await input.sharingState.resolve(projectId, projectEpoch) !== "unshared") return "rejected"
  try {
    assertLocalOwnerAuthorityClosureV3({ ...input, projectId, projectEpoch })
    const binding = parseLocalProjectOwnerBindingV3(input.binding)
    const authorization = parseLocalOwnerEditAuthorizationV3(input.authorization)
    const bindingOk = await verifyExactEd25519V2(input.verifier,
      binding.core.ownerPublicKey,
      binding.ownerSignature,
      successorSignaturePurposeV3("convax.local-project-owner-binding-signature/3", binding.coreDigest),
    )
    if (!bindingOk) return "rejected"
    const authorizationOk = await verifyExactEd25519V2(input.verifier,
      binding.core.ownerPublicKey,
      authorization.ownerSignature,
      successorSignaturePurposeV3("convax.local-owner-edit-authorization-signature/3", authorization.coreDigest),
    )
    if (!authorizationOk) return "rejected"
    return Object.freeze({ authority: parseCausalSignerAuthorityV3(input.authority) as LocalProjectOwnerSignerAuthorityV3, ownerPublicKey: binding.core.ownerPublicKey })
  } catch {
    return "rejected"
  }
}

function sameDocumentScopeV3(leftInput: DocumentScopeV2, rightInput: DocumentScopeV2): boolean {
  const left = parseDocumentScopeV2(leftInput)
  const right = parseDocumentScopeV2(rightInput)
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
}

function structuredDigestV3(domain: `${string}/3`, value: unknown): DigestV2 {
  const domainBytes = new TextEncoder().encode(domain)
  const bytes = encodeRestrictedJcsV2(value)
  const preimage = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  preimage.set(domainBytes)
  preimage[domainBytes.byteLength] = 0
  preimage.set(bytes, domainBytes.byteLength + 1)
  return ordinarySha256V2(preimage)
}

function successorSignaturePurposeV3(domain: `${string}/3`, digest: DigestV2): Uint8Array {
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16)
  const domainBytes = new TextEncoder().encode(domain)
  const preimage = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  preimage.set(domainBytes)
  preimage[domainBytes.byteLength] = 0
  preimage.set(bytes, domainBytes.byteLength + 1)
  return hexToBytesV3(ordinarySha256V2(preimage))
}

function hexToBytesV3(digest: DigestV2): Uint8Array {
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16)
  return bytes
}
