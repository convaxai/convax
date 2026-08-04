import { describe, expect, test } from "bun:test"
import {
  checkpointContentCertificateCoreDigestV2,
  encodeBase64urlV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseSignatureV2,
  parseUint64V2,
  stableCheckpointSetCoreDigestV2,
  type CheckpointContentCertificateCoreV2,
  type StableCheckpointSetCoreV2,
} from "@convax/collaboration"
import { CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2 } from "@convax/project/collaboration-protocol"
import {
  CollaborationMembershipServiceV2,
  CollaborationMetadataControlServiceV2,
  InMemoryAtomicControlStateStore,
  createCheckpointAttestationAdmissionFactoryV2,
  createProjectBootstrapAuthorizationFactoryV2,
  type CollaborationControlProjectStateV2,
  type ControlDigestSignaturePortV2,
  type MetadataControlSignaturePortV2,
} from "../src"

const signature = parseSignatureV2(encodeBase64urlV2(new Uint8Array(64).fill(42)))
const publicKey = parsePublicKeyV2(encodeBase64urlV2(new Uint8Array(32).fill(7)))
const id = (value: number) => parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(value)))
const digest = (value: string) => parseDigestV2(value.repeat(64))
const projectId = parseProjectIdV2("metadata-project")
const ownerMemberId = parseMemberIdV2(id(2))
const protocolDigest = parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest)

const controlSignatures: ControlDigestSignaturePortV2 = {
  serviceKeyId: (purpose) => `${purpose}-key`,
  signServiceDigest: async () => signature,
  verifyPublicKeyDigest: async () => true,
}

const metadataSignatures: MetadataControlSignaturePortV2 = {
  serviceKeyId: (purpose) => `${purpose}-key`,
  signServiceDigest: async () => signature,
  verifyPublicKeyDigest: async () => true,
}

describe("checkpoint/floor metadata control", () => {
  test("admits only an isolated-attester result and signs pruning only for the exact current editor set", async () => {
    const store = new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>()
    const membership = new CollaborationMembershipServiceV2(store, { nowEpochMilliseconds: () => 1_000 }, { fill: (target) => target.fill(3) }, controlSignatures, {
      registrySequence: parseUint64V2("0"),
      registryRootDigest: digest("1"),
      schemaDigest: digest("2"),
      validationArtifactSetDigest: digest("3"),
      uriProtocolDigest: digest("6"),
      trustBundleDigest: digest("4"),
    }, { verifyInstalledCurrentFloor: async () => true })
    const bootstrapFactory = createProjectBootstrapAuthorizationFactoryV2({ verify: async () => true })
    const bootstrapRequest = Object.freeze({
      projectId,
      projectEpoch: id(5),
      projectIndexShardEpoch: id(9),
      initializationAuthorityDigest: digest("c"),
      initialProjectIndexCheckpointDigest: digest("d"),
      initialProjectIndexFullUpdateDigest: digest("e"),
      initialProjectIndexStateVectorDigest: digest("f"),
      initialProjectIndexCanonicalStateDigest: digest("a"),
      ownerMemberId,
      ownerMemberSigningPublicKey: publicKey,
    })
    const bootstrapAuthorization = await bootstrapFactory.authorize({ ...bootstrapRequest, evidence: "deployment" })
    if (bootstrapAuthorization === "rejected") throw new Error("bootstrap rejected")
    const bootstrap = await membership.bootstrapProject(bootstrapRequest, bootstrapAuthorization)
    const service = new CollaborationMetadataControlServiceV2(store, metadataSignatures)
    const scope = Object.freeze({ projectId, projectEpoch: bootstrap.membershipSnapshot.core.projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id(9) })
    const certificateCore: CheckpointContentCertificateCoreV2 = Object.freeze({
      format: "convax.checkpoint-content-certificate-core/2",
      scope,
      checkpointDigest: digest("5"),
      parentCertificateDigests: [],
      computedFrontierDigest: digest("6"),
      actorHeadBoundaryDigest: digest("7"),
      stateVectorDigest: digest("8"),
      canonicalStateDigest: digest("9"),
      fullUpdateDigest: digest("a"),
      protocolDigest,
      schemaDigest: digest("2"),
      canonicalizerDigest: digest("b"),
      validationArtifactSetDigest: digest("3"),
      trustBundleDigest: digest("4"),
      contentStatus: "service-validated-causal-closure",
      serviceKeyPurpose: "content-attestation",
      serviceKeyId: "content-key",
    })
    const certificate = Object.freeze({ format: "convax.checkpoint-content-certificate/2" as const, core: certificateCore, coreDigest: checkpointContentCertificateCoreDigestV2(certificateCore), serviceSignature: signature })
    const admissionFactory = createCheckpointAttestationAdmissionFactoryV2({ verify: async ({ evidence }) => evidence === "isolated-attester-receipt" })
    expect(await admissionFactory.authorize({ certificate, evidence: "forged" })).toBe("rejected")
    const admission = await admissionFactory.authorize({ certificate, evidence: "isolated-attester-receipt" })
    if (admission === "rejected") throw new Error("attestation rejected")
    expect(await service.admitCheckpointCertificate(projectId, certificate, admission)).toEqual(certificate)
    await expect(service.admitCheckpointCertificate(projectId, certificate, admission)).rejects.toMatchObject({ code: "invalid-proof" })

    const stableSetCore: StableCheckpointSetCoreV2 = Object.freeze({
      format: "convax.stable-checkpoint-set-core/2",
      scope,
      priorSetDigest: null,
      contentCertificateDigests: [certificate.coreDigest],
      mergedFrontierDigest: certificate.core.computedFrontierDigest,
      actorHeadBoundaryDigest: certificate.core.actorHeadBoundaryDigest,
      membershipSnapshotDigest: bootstrap.membershipSnapshot.coreDigest,
      protocolDigest,
      validationArtifactSetDigest: digest("3"),
    })
    const prunable = await service.publishStableCheckpointSet(projectId, stableSetCore, [])
    expect(prunable.core.stableSetCore).toEqual(stableSetCore)
    expect(prunable.core.floorAckDigests).toEqual([])
    expect(stableCheckpointSetCoreDigestV2(prunable.core.stableSetCore)).toBe(stableCheckpointSetCoreDigestV2(stableSetCore))
    expect(await service.publishStableCheckpointSet(projectId, stableSetCore, [])).toEqual(prunable)
  })
})
