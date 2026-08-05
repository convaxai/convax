import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  localOwnerEditAuthorizationCoreDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  ordinarySha256V2,
  projectSharingHandoffCoreDigestV3,
  parseActorIdV2,
  parseId128V2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  type LocalOwnerEditAuthorizationCoreV3,
  type LocalProjectOwnerBindingCoreV3,
  type ProjectSharingHandoffCoreV3,
} from "@convax/collaboration"
import { NodeSuccessorLocalOwnerAuthorityStoreV3 } from "./successor-local-owner-store"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

describe("successor local-owner durable evidence", () => {
  test("persists one exact local-owner graph and rejects cross-Project replacement", async () => {
    const fixture = await createFixture()
    await fixture.store.installUnshared(fixture.authority)
    expect((await fixture.store.open(fixture.bindingCore.projectId, fixture.bindingCore.projectEpoch)).status).toBe("unshared")

    const crossed = authority({ projectId: `project_${"c".repeat(64)}` as never })
    await expect(fixture.store.installUnshared(crossed.authority)).rejects.toThrow("equivocation")
  })

  test("device tombstone dominates a restored unshared Project and rejects rollback", async () => {
    const fixture = await createFixture()
    await fixture.store.installUnshared(fixture.authority)
    await fixture.store.recordSharingTombstone({
      projectId: fixture.bindingCore.projectId,
      projectEpoch: fixture.bindingCore.projectEpoch,
      sharingGeneration: "2",
      receiptDigest: digest("receipt-2"),
    })
    await expect(fixture.store.resolve(fixture.bindingCore.projectId, fixture.bindingCore.projectEpoch)).resolves.toBe("shared")
    await expect(fixture.store.installUnshared(fixture.authority)).rejects.toThrow("cannot reinstall")
    await expect(fixture.store.recordSharingTombstone({
      projectId: fixture.bindingCore.projectId,
      projectEpoch: fixture.bindingCore.projectEpoch,
      sharingGeneration: "1",
      receiptDigest: digest("receipt-1"),
    })).rejects.toThrow("rollback")
  })

  test("resumes the exact tombstone after a crash before publication", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-successor-owner-crash-"))
    roots.push(root)
    const projectPrivateDirectory = path.join(root, "project-private")
    const deviceDirectory = path.join(root, "device")
    await fs.mkdir(projectPrivateDirectory)
    let crash = true
    const store = new NodeSuccessorLocalOwnerAuthorityStoreV3({
      projectPrivateDirectory,
      deviceAuthorityDirectory: deviceDirectory,
      faults: { async beforeTombstoneRename() { if (crash) { crash = false; throw new Error("crash") } } },
    })
    const built = authority()
    const input = {
      projectId: built.bindingCore.projectId,
      projectEpoch: built.bindingCore.projectEpoch,
      sharingGeneration: "1",
      receiptDigest: digest("receipt"),
    }
    await expect(store.recordSharingTombstone(input)).rejects.toThrow("crash")
    await store.recordSharingTombstone(input)
    await expect(store.resolve(input.projectId, input.projectEpoch)).resolves.toBe("shared")
  })

  test("fails closed on corrupt device evidence", async () => {
    const fixture = await createFixture()
    await fixture.store.installUnshared(fixture.authority)
    await fs.mkdir(fixture.deviceDirectory, { mode: 0o700 })
    const key = await tombstoneFilename(fixture.bindingCore.projectId, fixture.bindingCore.projectEpoch)
    await fs.writeFile(path.join(fixture.deviceDirectory, key), "corrupt")
    await expect(fixture.store.resolve(fixture.bindingCore.projectId, fixture.bindingCore.projectEpoch)).resolves.toBe("ambiguous")
  })

  test("installs one exact sharing CAS and permanently closes local owner", async () => {
    const fixture = await createFixture(); await fixture.store.installUnshared(fixture.authority)
    const handoff = sharingHandoff(fixture.bindingCore)
    await fixture.store.installSharingHandoff(handoff)
    await fixture.store.installSharingHandoff(handoff)
    const opened = await fixture.store.open(fixture.bindingCore.projectId, fixture.bindingCore.projectEpoch)
    expect(opened.status).toBe("shared")
    await expect(fixture.store.installUnshared(fixture.authority)).rejects.toThrow("cannot reinstall")
    await expect(fixture.store.installSharingHandoff({ ...handoff, teamArtifacts: { ...handoff.teamArtifacts, membershipSnapshotDigest: digest("wrong") } })).rejects.toThrow("closure")
  })

  test("recovers tombstone after Project CAS committed but publication crashed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-successor-handoff-crash-")); roots.push(root)
    const projectPrivateDirectory = path.join(root, "project-private"); const deviceAuthorityDirectory = path.join(root, "device"); await fs.mkdir(projectPrivateDirectory)
    let crash = true
    const store = new NodeSuccessorLocalOwnerAuthorityStoreV3({ projectPrivateDirectory, deviceAuthorityDirectory, faults: { async beforeTombstoneRename() { if (crash) { crash = false; throw new Error("crash") } } } })
    const built = authority(); await store.installUnshared(built.authority); const handoff = sharingHandoff(built.bindingCore)
    await expect(store.installSharingHandoff(handoff)).rejects.toThrow("crash")
    expect((await store.open(built.bindingCore.projectId, built.bindingCore.projectEpoch)).status).toBe("shared")
    await expect(store.recoverSharingHandoff(built.bindingCore.projectId, built.bindingCore.projectEpoch)).resolves.toBe("recovered")
    await expect(store.resolve(built.bindingCore.projectId, built.bindingCore.projectEpoch)).resolves.toBe("shared")
  })
})

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-successor-owner-"))
  roots.push(root)
  const projectPrivateDirectory = path.join(root, "project-private")
  const deviceDirectory = path.join(root, "device")
  await fs.mkdir(projectPrivateDirectory)
  const built = authority()
  return {
    ...built,
    deviceDirectory,
    store: new NodeSuccessorLocalOwnerAuthorityStoreV3({ projectPrivateDirectory, deviceAuthorityDirectory: deviceDirectory }),
  }
}

function authority(overrides: { projectId?: LocalProjectOwnerBindingCoreV3["projectId"] } = {}) {
  const ownerPublicKey = parsePublicKeyV2(encodeBase64urlV2(Buffer.alloc(32, 2)))
  const ownerKeyDomain = new TextEncoder().encode("convax.local-project-owner-public-key/3")
  const ownerKeyBytes = encodeRestrictedJcsV2(ownerPublicKey)
  const ownerKeyPreimage = new Uint8Array(ownerKeyDomain.byteLength + 1 + ownerKeyBytes.byteLength)
  ownerKeyPreimage.set(ownerKeyDomain)
  ownerKeyPreimage.set(ownerKeyBytes, ownerKeyDomain.byteLength + 1)
  const bindingCore: LocalProjectOwnerBindingCoreV3 = {
    format: "convax.local-project-owner-binding-core/3",
    projectId: overrides.projectId ?? `project_${"a".repeat(64)}` as never,
    projectEpoch: parseId128V2(encodeBase64urlV2(Buffer.alloc(16, 1))),
    ownerKeyId: ordinarySha256V2(ownerKeyPreimage),
    ownerPublicKey,
    initialReplicaId: parseReplicaIdV2("replica_00000001"),
    initialActorId: parseActorIdV2(encodeBase64urlV2(Buffer.alloc(32, 3))),
    ownerSchemaDigest: digest("owner-schema"),
    protocolDigest: digest("protocol"),
    genesisAuthorizationPolicy: {
      format: "convax.local-owner-genesis-authorization-policy/3",
      projectIndexScope: {
        projectId: overrides.projectId ?? `project_${"a".repeat(64)}` as never,
        projectEpoch: parseId128V2(encodeBase64urlV2(Buffer.alloc(16, 1))),
        docKind: "project-index",
        docId: "project-index",
        shardEpoch: parseId128V2(encodeBase64urlV2(Buffer.alloc(16, 5))),
      },
      canvasAuthorization: "accepted-project-index-route-genesis-only",
    },
    sharingGeneration: "0",
    creationNonce: parseId128V2(encodeBase64urlV2(Buffer.alloc(16, 4))),
  }
  const binding = {
    format: "convax.local-project-owner-binding/3" as const,
    core: bindingCore,
    coreDigest: localProjectOwnerBindingCoreDigestV3(bindingCore),
    ownerSignature: signature(),
  }
  const authorizationCore: LocalOwnerEditAuthorizationCoreV3 = {
    format: "convax.local-owner-edit-authorization-core/3",
    ownerBindingCoreDigest: binding.coreDigest,
    projectId: bindingCore.projectId,
    projectEpoch: bindingCore.projectEpoch,
    scope: bindingCore.genesisAuthorizationPolicy.projectIndexScope,
    replicaId: bindingCore.initialReplicaId,
    actorId: bindingCore.initialActorId,
    actorSequenceAllocationPolicy: {
      format: "convax.local-owner-actor-sequence-allocation-policy/3",
      kind: "strict-durable-head-successor",
      initialSequence: "1",
    },
    protocolDigest: bindingCore.protocolDigest,
    sharingGeneration: "0",
    expiryPolicy: "none",
  }
  return {
    bindingCore,
    authority: {
      binding,
      authorization: {
        format: "convax.local-owner-edit-authorization/3" as const,
        core: authorizationCore,
        coreDigest: localOwnerEditAuthorizationCoreDigestV3(authorizationCore),
        ownerSignature: signature(),
      },
    },
  }
}

function signature() {
  return parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index === 32 ? 1 : 0)))
}

function digest(value: string) { return ordinarySha256V2(new TextEncoder().encode(value)) }

function sharingHandoff(binding: LocalProjectOwnerBindingCoreV3) {
  const membershipSnapshotDigest = digest("membership"); const replicaActorCredentialCoreDigest = digest("credential"); const replicaEditAuthorizationCoreDigest = digest("edit")
  const core: ProjectSharingHandoffCoreV3 = {
    format: "convax.project-sharing-handoff-core/3", handoffId: binding.creationNonce, projectId: binding.projectId, projectEpoch: binding.projectEpoch,
    previousOwnerBindingCoreDigest: localProjectOwnerBindingCoreDigestV3(binding), previousOwnerKeyId: binding.ownerKeyId, sharingGeneration: "1",
    projectIndexHead: { scope: binding.genesisAuthorizationPolicy.projectIndexScope, acceptedFrontierDigest: digest("frontier"), acceptedHeadDigest: digest("head") }, liveCanvasHeads: [],
    serviceTrustBundleDigest: digest("trust"), initialMembershipSnapshotDigest: membershipSnapshotDigest, initialOwnerMemberId: parseId128V2(encodeBase64urlV2(Buffer.alloc(16, 7))) as never,
    initialOwnerReplicaId: binding.initialReplicaId, initialOwnerActorId: binding.initialActorId, initialReplicaActorCredentialCoreDigest: replicaActorCredentialCoreDigest,
    initialReplicaEditAuthorizationCoreDigest: replicaEditAuthorizationCoreDigest, successorProtocolDigest: binding.protocolDigest,
  }
  const serviceSigningPublicKey = parsePublicKeyV2(encodeBase64urlV2(Buffer.alloc(32, 9)))
  const domain = new TextEncoder().encode("convax.project-sharing-service-public-key/3"); const key = encodeRestrictedJcsV2(serviceSigningPublicKey); const preimage = new Uint8Array(domain.length + 1 + key.length); preimage.set(domain); preimage.set(key, domain.length + 1)
  const receipt = { format: "convax.project-sharing-handoff-receipt/3" as const, core, coreDigest: projectSharingHandoffCoreDigestV3(core), ownerSignature: signature(), serviceSigningPublicKey, serviceSigningKeyId: ordinarySha256V2(preimage), serviceSignature: signature() }
  return { receipt, receiptDigest: ordinarySha256V2(encodeRestrictedJcsV2(receipt)), teamArtifacts: { membershipSnapshotDigest, replicaActorCredentialCoreDigest, replicaEditAuthorizationCoreDigest } }
}

async function tombstoneFilename(projectId: string, projectEpoch: string) {
  const { createHash } = await import("node:crypto")
  return `${createHash("sha256").update(`${projectId}\0${projectEpoch}`).digest("hex")}.jcs`
}
