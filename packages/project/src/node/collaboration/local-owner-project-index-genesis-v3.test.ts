import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  localOwnerEditAuthorizationCoreDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  ordinarySha256V2,
  parseActorIdV2,
  parseId128V2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  type LocalOwnerEditAuthorizationCoreV3,
  type LocalProjectOwnerBindingCoreV3,
} from "@convax/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "../../collaboration/project-index"
import { createLocalOwnerProjectIndexGenesisCandidateV3, publishLocalOwnerProjectIndexGenesisV3 } from "./local-owner-project-index-genesis-v3"

test("local-owner ProjectIndex genesis publishes an exact durable author closure without Team identity", async () => {
  const built = authority()
  const candidate = await createLocalOwnerProjectIndexGenesisCandidateV3({
    scope: built.scope,
    operationId: id(5),
    checkpointId: id(6),
    binding: built.binding,
    authorization: built.authorization,
    protocolDigest: built.binding.core.protocolDigest,
    uriProtocolDigest: digest("uri"),
    validationArtifactSetDigest: digest("v11-artifacts"),
    signer: { async sign(input) { expect(input.exactPurposeBytes).toHaveLength(32); return signature() } },
  })
  const text = new TextDecoder().decode(candidate.proofExactBytes)
  expect(text).not.toContain("memberId")
  expect(text).not.toContain("membership")
  const evidence = await publishLocalOwnerProjectIndexGenesisV3({
    candidate,
    store: {
      async initializeShardWithGenesisProof(input) {
        expect(input.checkpointExactBytes).toEqual(candidate.checkpointExactBytes)
        expect(input.proofCarrierExactBytes).toEqual(candidate.proofExactBytes)
        return Object.freeze({ ...input.acceptedBase, headDigest: digest("durable-head") })
      },
    },
  })
  expect(evidence).toEqual({
    authorizationProofDigest: candidate.proofDigest,
    durableCheckpointDigest: candidate.checkpointObjectDigest,
    acceptedHeadDigest: digest("durable-head"),
    acceptedFrontierDigest: candidate.acceptedBase.frontierDigest,
  })
})

function authority() {
  const projectId = `project_${"a".repeat(64)}` as never
  const projectEpoch = id(1)
  const scope = Object.freeze({ projectId, projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id(2) })
  const ownerPublicKey = parsePublicKeyV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 3)))
  const core: LocalProjectOwnerBindingCoreV3 = Object.freeze({
    format: "convax.local-project-owner-binding-core/3", projectId, projectEpoch,
    ownerKeyId: structuredDigest("convax.local-project-owner-public-key/3", ownerPublicKey), ownerPublicKey,
    initialReplicaId: parseReplicaIdV2("replica_00000001"), initialActorId: parseActorIdV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 4))),
    protocolDigest: digest("protocol-v3"),
    genesisAuthorizationPolicy: Object.freeze({ format: "convax.local-owner-genesis-authorization-policy/3", projectIndexScope: scope, canvasAuthorization: "accepted-project-index-route-genesis-only" }),
    sharingGeneration: "0", creationNonce: id(3),
  })
  const binding = Object.freeze({ format: "convax.local-project-owner-binding/3" as const, core, coreDigest: localProjectOwnerBindingCoreDigestV3(core), ownerSignature: signature() })
  const authorizationCore: LocalOwnerEditAuthorizationCoreV3 = Object.freeze({
    format: "convax.local-owner-edit-authorization-core/3", ownerBindingCoreDigest: binding.coreDigest, projectId, projectEpoch, scope,
    replicaId: core.initialReplicaId, actorId: core.initialActorId, ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    actorSequenceAllocationPolicy: Object.freeze({ format: "convax.local-owner-actor-sequence-allocation-policy/3", kind: "strict-durable-head-successor", initialSequence: "1" }),
    protocolDigest: core.protocolDigest, sharingGeneration: "0", expiryPolicy: "none",
  })
  const authorization = Object.freeze({ format: "convax.local-owner-edit-authorization/3" as const, core: authorizationCore, coreDigest: localOwnerEditAuthorizationCoreDigestV3(authorizationCore), ownerSignature: signature() })
  return { scope, binding, authorization }
}

function structuredDigest(domain: string, value: unknown) { const d = new TextEncoder().encode(domain); const b = encodeRestrictedJcsV2(value); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return ordinarySha256V2(p) }
function signature() { return parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index === 32 ? 1 : 0))) }
function id(byte: number) { return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => byte))) }
function digest(value: string) { return ordinarySha256V2(new TextEncoder().encode(value)) }
