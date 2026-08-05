import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  causalSignerAuthorityDigestV3,
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  localOwnerEditAuthorizationCoreDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  ordinarySha256V2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseId128V2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  protocolPromotionBridgeCoreDigestV3,
  type DocumentScopeV2,
  type LocalOwnerEditAuthorizationCoreV3,
  type LocalProjectOwnerBindingCoreV3,
  type ProtocolPromotionBridgeCoreV3,
} from "@convax/collaboration"
import {
  NodeSuccessorProjectProtocolStateStoreV3,
  type SuccessorLocalProtocolStateV3,
} from "./successor-protocol-state-store"

const temporaryRoots: string[] = []
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

describe("successor Project protocol state", () => {
  test("publishes one retry-stable new Project closure with default Canvas", async () => {
    const fixture = await createFixture()
    const state = localState("new-project")
    const first = await fixture.store.installLocal({ state, promotionId: state.ownerBinding.core.creationNonce })
    const second = await fixture.store.installLocal({ state, promotionId: state.ownerBinding.core.creationNonce })
    expect(second.stateDigest).toBe(first.stateDigest)
    const opened = await fixture.store.open(state.projectId)
    expect(opened.status).toBe("v3-local")
    if (opened.status === "v3-local") expect(opened.state.authorizations.map((item) => item.authorization.core.scope.docKind).sort()).toEqual(["canvas", "project-index"])
  })

  for (const point of ["afterClaim", "afterClosure", "afterDeviceRecord", "beforeActivePointer"] as const) {
    test(`recovers without a second writer after ${point}`, async () => {
      let crash = true
      const fixture = await createFixture({
        [point]: async () => { if (crash) { crash = false; throw new Error(point) } },
      })
      const state = localState("new-project")
      await expect(fixture.store.installLocal({ state, promotionId: state.ownerBinding.core.creationNonce })).rejects.toThrow(point)
      const interim = await fixture.store.open(state.projectId)
      expect(["promotion-recovery-required", "recovery-required"]).toContain(interim.status)
      await fixture.store.installLocal({ state, promotionId: state.ownerBinding.core.creationNonce })
      expect((await fixture.store.open(state.projectId)).status).toBe("v3-local")
    })
  }

  test("preserves exact V10 bytes and rejects another promotion closure", async () => {
    const fixture = await createFixture()
    const legacy = path.join(fixture.projectPrivateDirectory, "legacy-frame.bin")
    const legacyBytes = Uint8Array.from([0x43, 0x56, 0x58, 0x43, 0x4f, 0x4c, 0x4c, 0x32])
    await fs.writeFile(legacy, legacyBytes)
    const state = localState("v10-r5-unshared")
    await fixture.store.installLocal({ state, promotionId: state.ownerBinding.core.creationNonce })
    expect(new Uint8Array(await fs.readFile(legacy))).toEqual(legacyBytes)
    const other = { ...state, origin: { ...state.origin, verifiedLegacyClosureDigest: digest("other-legacy") } } as SuccessorLocalProtocolStateV3
    await expect(fixture.store.installLocal({ state: other, promotionId: state.ownerBinding.core.creationNonce })).rejects.toThrow("equivocation")
  })
})

async function createFixture(faults?: ConstructorParameters<typeof NodeSuccessorProjectProtocolStateStoreV3>[0]["faults"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-protocol-v3-"))
  temporaryRoots.push(root)
  const projectPrivateDirectory = path.join(root, "project")
  const deviceProtocolDirectory = path.join(root, "device")
  await fs.mkdir(projectPrivateDirectory)
  return {
    projectPrivateDirectory,
    store: new NodeSuccessorProjectProtocolStateStoreV3({ projectPrivateDirectory, deviceProtocolDirectory, faults }),
  }
}

function localState(originKind: "new-project" | "v10-r5-unshared"): SuccessorLocalProtocolStateV3 {
  const ownerPublicKey = parsePublicKeyV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 2)))
  const ownerKeyDomain = new TextEncoder().encode("convax.local-project-owner-public-key/3")
  const ownerKeyBytes = encodeRestrictedJcsV2(ownerPublicKey)
  const ownerKeyPreimage = new Uint8Array(ownerKeyDomain.length + 1 + ownerKeyBytes.length)
  ownerKeyPreimage.set(ownerKeyDomain); ownerKeyPreimage.set(ownerKeyBytes, ownerKeyDomain.length + 1)
  const projectId = `project_${"a".repeat(64)}` as never
  const projectEpoch = id(1)
  const projectIndexScope = Object.freeze({ projectId, projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id(2) })
  const canvasScope = Object.freeze({ projectId, projectEpoch, docKind: "canvas" as const, docId: parseCanvasIdV2(`cv_${"b".repeat(64)}`), shardEpoch: id(3) })
  const bindingCore: LocalProjectOwnerBindingCoreV3 = {
    format: "convax.local-project-owner-binding-core/3",
    projectId,
    projectEpoch,
    ownerKeyId: ordinarySha256V2(ownerKeyPreimage),
    ownerPublicKey,
    initialReplicaId: parseReplicaIdV2("replica_00000001"),
    initialActorId: parseActorIdV2(ownerPublicKey),
    ownerSchemaDigest: digest("project-index-schema"),
    protocolDigest: digest("protocol-v3"),
    genesisAuthorizationPolicy: {
      format: "convax.local-owner-genesis-authorization-policy/3",
      projectIndexScope,
      canvasAuthorization: "accepted-project-index-route-genesis-only",
    },
    sharingGeneration: "0",
    creationNonce: id(4),
  }
  const ownerBinding = Object.freeze({
    format: "convax.local-project-owner-binding/3" as const,
    core: bindingCore,
    coreDigest: localProjectOwnerBindingCoreDigestV3(bindingCore),
    ownerSignature: signature(),
  })
  const signerAuthority = Object.freeze({
    kind: "local-project-owner" as const,
    ownerKeyId: bindingCore.ownerKeyId,
    replicaId: bindingCore.initialReplicaId,
    actorId: bindingCore.initialActorId,
    ownerBindingCoreDigest: ownerBinding.coreDigest,
    ownerEditAuthorizationCoreDigest: digest("placeholder"),
  })
  const sourceFor = (scope: DocumentScopeV2) => originKind === "new-project"
    ? Object.freeze({ kind: "new-project" as const, creationClaimDigest: digest("claim"), genesisHeadDigest: digest(`genesis:${scope.docId}`), genesisFrontierDigest: digest(`frontier:${scope.docId}`) })
    : Object.freeze({ kind: "v10-r5" as const, r5AuthorityManifestSha256: digest("r5-manifest"), sourceHeadDigest: digest(`v2-head:${scope.docId}`), sourceFrontierDigest: digest(`v2-frontier:${scope.docId}`) })
  const scoped = [
    authorization(ownerBinding, projectIndexScope, { kind: "project-index-genesis" as const, proofDigest: digest("project-index-genesis") }),
    authorization(ownerBinding, canvasScope, { kind: "accepted-project-index-route-genesis" as const, proofDigest: digest("canvas-route") }),
  ].sort((left, right) => scopeKey(left.authorization.core.scope).localeCompare(scopeKey(right.authorization.core.scope)))
  const bridges = scoped.map((entry, index) => {
    const authority = { ...signerAuthority, ownerEditAuthorizationCoreDigest: entry.authorization.coreDigest }
    const core: ProtocolPromotionBridgeCoreV3 = {
      format: "convax.protocol-promotion-bridge-core/3",
      projectId,
      projectEpoch,
      scope: entry.authorization.core.scope,
      source: sourceFor(entry.authorization.core.scope),
      successorProtocolDigest: bindingCore.protocolDigest,
      signerAuthority: authority,
      signerAuthorityDigest: causalSignerAuthorityDigestV3(authority),
      bridgeId: id(10 + index),
    }
    return Object.freeze({ format: "convax.protocol-promotion-bridge/3" as const, core, coreDigest: protocolPromotionBridgeCoreDigestV3(core), signerPublicKey: ownerPublicKey, signerSignature: signature() })
  })
  return Object.freeze({
    format: "convax.project-protocol-state-local/3",
    projectId,
    projectEpoch,
    protocolDigest: bindingCore.protocolDigest,
    sharingGeneration: "0",
    origin: originKind === "new-project"
      ? Object.freeze({ kind: originKind, creationClaimDigest: digest("claim") })
      : Object.freeze({ kind: originKind, r5AuthorityManifestSha256: digest("r5-manifest"), verifiedLegacyClosureDigest: digest("legacy-closure") }),
    ownerBinding,
    authorizations: Object.freeze(scoped),
    bridges: Object.freeze(bridges),
  })
}

function authorization(
  binding: ReturnType<typeof localState>["ownerBinding"],
  scope: DocumentScopeV2,
  proof: { kind: "project-index-genesis" | "accepted-project-index-route-genesis"; proofDigest: ReturnType<typeof digest> },
) {
  const core: LocalOwnerEditAuthorizationCoreV3 = {
    format: "convax.local-owner-edit-authorization-core/3",
    ownerBindingCoreDigest: binding.coreDigest,
    projectId: binding.core.projectId,
    projectEpoch: binding.core.projectEpoch,
    scope,
    replicaId: binding.core.initialReplicaId,
    actorId: binding.core.initialActorId,
    actorSequenceAllocationPolicy: { format: "convax.local-owner-actor-sequence-allocation-policy/3", kind: "strict-durable-head-successor", initialSequence: "1" },
    protocolDigest: binding.core.protocolDigest,
    sharingGeneration: "0",
    expiryPolicy: "none",
  }
  return Object.freeze({ authorization: Object.freeze({ format: "convax.local-owner-edit-authorization/3" as const, core, coreDigest: localOwnerEditAuthorizationCoreDigestV3(core), ownerSignature: signature() }), proof: Object.freeze(proof) })
}

function scopeKey(scope: DocumentScopeV2) { return new TextDecoder().decode(encodeRestrictedJcsV2(scope)) }
function id(value: number) { return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => value))) }
function signature() { return parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index === 32 ? 1 : 0))) }
function digest(value: string) { return ordinarySha256V2(new TextEncoder().encode(value)) }
