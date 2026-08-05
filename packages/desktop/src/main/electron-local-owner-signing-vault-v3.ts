import {
  localOwnerEditAuthorizationCoreDigestV3,
  localOwnerEditAuthorizationSignatureDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  localProjectOwnerBindingSignatureDigestV3,
  localProjectOwnerKeyIdV3,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parseProtocolPromotionBridgeCoreV3,
  parsePublicKeyV2,
  parseReplicaIdV2,
  protocolPromotionBridgeCoreDigestV3,
  protocolPromotionBridgeSignatureDigestV3,
  type Id128V2,
  type ProjectIdV2,
} from "@convax/collaboration"
import type {
  SuccessorOwnerKeyIdentityV3,
  SuccessorOwnerSigningPortV3,
} from "@convax/project/node"

import { ElectronReplicaSigningVaultV2 } from "./electron-replica-signing-vault"

/**
 * V3 local-owner adapter over the existing OS-encrypted replica vault. The full
 * Project/epoch/claim context deterministically chooses the initial replica, and
 * every signing operation reopens and rechecks that exact identity before signing.
 */
export class ElectronLocalOwnerSigningVaultV3 implements SuccessorOwnerSigningPortV3 {
  constructor(private readonly replicas: ElectronReplicaSigningVaultV2) {}

  async resolveIdentity(input: Readonly<{
    claimDigest: ReturnType<typeof parseDigestV2>
    projectId: ProjectIdV2
    projectEpoch: Id128V2
  }>): Promise<SuccessorOwnerKeyIdentityV3> {
    const context = normalizeContext(input)
    const replicaId = replicaIdFromClaim(context.claimDigest)
    const key = await this.replicas.createReplicaKey({ ...context, replicaId })
    const ownerPublicKey = parsePublicKeyV2(key.publicKey)
    return Object.freeze({
      ownerKeyId: localProjectOwnerKeyIdV3(ownerPublicKey),
      ownerPublicKey,
      replicaId,
      actorId: parseActorIdV2(ownerPublicKey),
    })
  }

  async signBinding(input: Parameters<SuccessorOwnerSigningPortV3["signBinding"]>[0]) {
    const identity = await this.requireIdentity(input)
    const core = input.core
    if (
      core.projectId !== input.projectId || core.projectEpoch !== input.projectEpoch ||
      core.ownerKeyId !== identity.ownerKeyId || core.ownerPublicKey !== identity.ownerPublicKey ||
      core.initialReplicaId !== identity.replicaId || core.initialActorId !== identity.actorId
    ) throw new Error("Local owner binding crossed its exact signing identity")
    const coreDigest = localProjectOwnerBindingCoreDigestV3(core)
    return Object.freeze({
      format: "convax.local-project-owner-binding/3" as const,
      core,
      coreDigest,
      ownerSignature: await identity.signer.sign(localProjectOwnerBindingSignatureDigestV3(coreDigest)),
    })
  }

  async signAuthorization(input: Parameters<SuccessorOwnerSigningPortV3["signAuthorization"]>[0]) {
    const identity = await this.requireIdentity(input)
    const core = input.core
    if (
      core.projectId !== input.projectId || core.projectEpoch !== input.projectEpoch ||
      core.replicaId !== identity.replicaId || core.actorId !== identity.actorId
    ) throw new Error("Local owner authorization crossed its exact signing identity")
    const coreDigest = localOwnerEditAuthorizationCoreDigestV3(core)
    return Object.freeze({
      format: "convax.local-owner-edit-authorization/3" as const,
      core,
      coreDigest,
      ownerSignature: await identity.signer.sign(localOwnerEditAuthorizationSignatureDigestV3(coreDigest)),
    })
  }

  async signBridge(input: Parameters<SuccessorOwnerSigningPortV3["signBridge"]>[0]) {
    const identity = await this.requireIdentity(input)
    const core = parseProtocolPromotionBridgeCoreV3(input.core)
    if (
      core.projectId !== input.projectId || core.projectEpoch !== input.projectEpoch ||
      core.signerAuthority.kind !== "local-project-owner" ||
      core.signerAuthority.ownerKeyId !== identity.ownerKeyId ||
      core.signerAuthority.replicaId !== identity.replicaId ||
      core.signerAuthority.actorId !== identity.actorId
    ) throw new Error("Protocol promotion bridge crossed its exact signing identity")
    const coreDigest = protocolPromotionBridgeCoreDigestV3(core)
    return Object.freeze({
      format: "convax.protocol-promotion-bridge/3" as const,
      core,
      coreDigest,
      signerPublicKey: identity.ownerPublicKey,
      signerSignature: await identity.signer.sign(protocolPromotionBridgeSignatureDigestV3(coreDigest)),
    })
  }

  private async requireIdentity(input: {
    readonly claimDigest: ReturnType<typeof parseDigestV2>
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly identity: SuccessorOwnerKeyIdentityV3
  }) {
    const context = normalizeContext(input)
    const identity = await this.resolveIdentity(context)
    if (
      identity.ownerKeyId !== input.identity.ownerKeyId ||
      identity.ownerPublicKey !== input.identity.ownerPublicKey ||
      identity.replicaId !== input.identity.replicaId ||
      identity.actorId !== input.identity.actorId
    ) throw new Error("Local owner signing identity crossed its provisioning claim")
    const signer = await this.replicas.openSigner({
      projectId: context.projectId,
      projectEpoch: context.projectEpoch,
      replicaId: identity.replicaId,
      expectedPublicKey: identity.ownerPublicKey,
    })
    if (typeof signer === "string") throw new Error(`Local owner signing key is ${signer}`)
    return Object.freeze({ ...identity, signer })
  }
}

function normalizeContext(input: {
  readonly claimDigest: ReturnType<typeof parseDigestV2>
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
}) {
  return Object.freeze({
    claimDigest: parseDigestV2(input.claimDigest),
    projectId: parseProjectIdV2(input.projectId),
    projectEpoch: parseId128V2(input.projectEpoch),
  })
}

function replicaIdFromClaim(claimDigest: ReturnType<typeof parseDigestV2>) {
  const first = claimDigest.slice(0, 8)
  return parseReplicaIdV2(`replica_${first === "00000000" ? "00000001" : first}`)
}
