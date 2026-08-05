import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  causalSignerAuthorityDigestV3,
  createWebCryptoEd25519VerifierV2,
  encodeBase64urlV2,
  ordinarySha256V2,
  parseCanvasIdV2,
  parseId128V2,
  parseProjectIdV2,
  verifyLocalOwnerAuthorityV3,
} from "@convax/collaboration"

import { ElectronLocalOwnerSigningVaultV3 } from "./electron-local-owner-signing-vault-v3"
import { ElectronReplicaSigningVaultV2, type ElectronSafeStoragePortV2 } from "./electron-replica-signing-vault"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("ElectronLocalOwnerSigningVaultV3", () => {
  test("reuses one Project/epoch/claim-bound OS key and signs all exact V3 purposes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-local-owner-v3-"))
    roots.push(root)
    const storage = fakeSafeStorage()
    const directory = path.join(root, "keys")
    const vault = new ElectronLocalOwnerSigningVaultV3(new ElectronReplicaSigningVaultV2(directory, storage))
    const context = {
      projectId: parseProjectIdV2("project-local-owner-v3"),
      projectEpoch: id(1),
      claimDigest: digest("claim"),
    }
    const identity = await vault.resolveIdentity(context)
    const restarted = new ElectronLocalOwnerSigningVaultV3(new ElectronReplicaSigningVaultV2(directory, storage))
    expect(await restarted.resolveIdentity(context)).toEqual(identity)

    const projectIndexScope = Object.freeze({
      projectId: context.projectId,
      projectEpoch: context.projectEpoch,
      docKind: "project-index" as const,
      docId: "project-index" as const,
      shardEpoch: id(2),
    })
    const canvasScope = Object.freeze({
      projectId: context.projectId,
      projectEpoch: context.projectEpoch,
      docKind: "canvas" as const,
      docId: parseCanvasIdV2(`cv_${"a".repeat(64)}`),
      shardEpoch: id(3),
    })
    const protocolDigest = digest("protocol")
    const binding = await restarted.signBinding({
      ...context,
      identity,
      core: Object.freeze({
        format: "convax.local-project-owner-binding-core/3" as const,
        projectId: context.projectId,
        projectEpoch: context.projectEpoch,
        ownerKeyId: identity.ownerKeyId,
        ownerPublicKey: identity.ownerPublicKey,
        initialReplicaId: identity.replicaId,
        initialActorId: identity.actorId,
        protocolDigest,
        genesisAuthorizationPolicy: Object.freeze({
          format: "convax.local-owner-genesis-authorization-policy/3" as const,
          projectIndexScope,
          canvasAuthorization: "accepted-project-index-route-genesis-only" as const,
        }),
        sharingGeneration: "0" as const,
        creationNonce: id(4),
      }),
    })
    const authorization = await restarted.signAuthorization({
      ...context,
      identity,
      core: Object.freeze({
        format: "convax.local-owner-edit-authorization-core/3" as const,
        ownerBindingCoreDigest: binding.coreDigest,
        projectId: context.projectId,
        projectEpoch: context.projectEpoch,
        scope: canvasScope,
        replicaId: identity.replicaId,
        actorId: identity.actorId,
        ownerSchemaDigest: digest("canvas-schema"),
        actorSequenceAllocationPolicy: Object.freeze({
          format: "convax.local-owner-actor-sequence-allocation-policy/3" as const,
          kind: "strict-durable-head-successor" as const,
          initialSequence: "1" as const,
        }),
        protocolDigest,
        sharingGeneration: "0" as const,
        expiryPolicy: "none" as const,
      }),
    })
    const authority = Object.freeze({
      kind: "local-project-owner" as const,
      ownerKeyId: identity.ownerKeyId,
      replicaId: identity.replicaId,
      actorId: identity.actorId,
      ownerBindingCoreDigest: binding.coreDigest,
      ownerEditAuthorizationCoreDigest: authorization.coreDigest,
    })
    expect(await verifyLocalOwnerAuthorityV3({
      authority,
      binding,
      authorization,
      projectId: context.projectId,
      projectEpoch: context.projectEpoch,
      scope: canvasScope,
      ownerSchemaDigest: authorization.core.ownerSchemaDigest,
      protocolDigest,
      sharingState: { async resolve() { return "unshared" as const } },
      verifier: createWebCryptoEd25519VerifierV2(),
    })).not.toBe("rejected")

    const bridge = await restarted.signBridge({
      ...context,
      identity,
      core: Object.freeze({
        format: "convax.protocol-promotion-bridge-core/3" as const,
        projectId: context.projectId,
        projectEpoch: context.projectEpoch,
        scope: canvasScope,
        source: Object.freeze({
          kind: "new-project" as const,
          creationClaimDigest: context.claimDigest,
          genesisHeadDigest: digest("head"),
          genesisFrontierDigest: digest("frontier"),
        }),
        successorProtocolDigest: protocolDigest,
        signerAuthority: authority,
        signerAuthorityDigest: causalSignerAuthorityDigestV3(authority),
        bridgeId: id(5),
      }),
    })
    expect(bridge.signerPublicKey).toBe(identity.ownerPublicKey)
  })

  test("rejects a caller-supplied identity or Project crossing before signing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-local-owner-v3-"))
    roots.push(root)
    const vault = new ElectronLocalOwnerSigningVaultV3(new ElectronReplicaSigningVaultV2(path.join(root, "keys"), fakeSafeStorage()))
    const context = { projectId: parseProjectIdV2("project-a"), projectEpoch: id(1), claimDigest: digest("claim") }
    const identity = await vault.resolveIdentity(context)
    await expect(vault.signAuthorization({
      ...context,
      identity: { ...identity, replicaId: "replica_00000002" as never },
      core: {} as never,
    })).rejects.toThrow("crossed")
  })
})

function fakeSafeStorage(): ElectronSafeStoragePortV2 {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString: (plainText) => Buffer.from(Uint8Array.from(Buffer.from(plainText), (byte) => byte ^ 0xa5)),
    decryptString: (encrypted) => Buffer.from(encrypted).map((byte) => byte ^ 0xa5).toString(),
  }
}

function id(value: number) {
  return parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(value)))
}

function digest(value: string) {
  return ordinarySha256V2(new TextEncoder().encode(value))
}
