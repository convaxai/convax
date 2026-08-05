import { describe, expect, test } from "bun:test"
import {
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
  type LocalOwnerEditAuthorizationCoreV3,
  type LocalProjectOwnerBindingCoreV3,
} from "@convax/collaboration"
import { CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "./session"
import { createLocalOwnerCanvasGenesisCandidateV3, verifyLocalOwnerCanvasGenesisProofV3 } from "./local-owner-genesis-v3"

describe("V3 local-owner Canvas genesis", () => {
  test("binds the empty Canvas/checkpoint to exact owner evidence without Team compatibility fields", async () => {
    const fixture = authority()
    const first = await createLocalOwnerCanvasGenesisCandidateV3({
      scope: fixture.scope,
      projectIndexRouteDependencyFrameDigest: digest("route-frame"),
      checkpointId: id(9),
      binding: fixture.binding,
      authorization: fixture.authorization,
      protocolDigest: fixture.binding.core.protocolDigest,
      validationArtifactSetDigest: digest("v11-artifacts"),
      signer: { async sign(input) { expect(input.exactPurposeBytes).toHaveLength(32); return signature() } },
    })
    const second = await createLocalOwnerCanvasGenesisCandidateV3({
      scope: fixture.scope,
      projectIndexRouteDependencyFrameDigest: digest("route-frame"),
      checkpointId: id(9),
      binding: fixture.binding,
      authorization: fixture.authorization,
      protocolDigest: fixture.binding.core.protocolDigest,
      validationArtifactSetDigest: digest("v11-artifacts"),
      signer: { async sign() { return signature() } },
    })
    expect(second.checkpointExactBytes).toEqual(first.checkpointExactBytes)
    expect(second.proofExactBytes).toEqual(first.proofExactBytes)
    expect(first.acceptedBase.frontier.heads).toEqual([])
    expect(first.checkpoint.core.projectIndexRouteDependencyFrameDigest).toBe(digest("route-frame"))
    const proofText = new TextDecoder().decode(first.proofExactBytes)
    expect(proofText).not.toContain("memberId")
    expect(proofText).not.toContain("membership")
    expect(proofText).not.toContain("reservation")
    expect(proofText).not.toContain("serviceTrust")
    const verified = await verifyLocalOwnerCanvasGenesisProofV3({
      exactBytes: first.proofExactBytes,
      protocolDigest: fixture.binding.core.protocolDigest,
      sharingState: { async resolve() { return "unshared" as const } },
      verifier: { async verify() { return true } },
    })
    expect(verified).toEqual({
      status: "validated",
      proofDigest: first.proofDigest,
      checkpointObjectDigest: first.checkpointObjectDigest,
      scope: fixture.scope,
      projectIndexRouteDependencyFrameDigest: digest("route-frame"),
    })
  })
})

function authority() {
  const projectId = `project_${"a".repeat(64)}` as never
  const projectEpoch = id(1)
  const scope = Object.freeze({ projectId, projectEpoch, docKind: "canvas" as const, docId: parseCanvasIdV2(`cv_${"b".repeat(64)}`), shardEpoch: id(2) })
  const projectIndexScope = Object.freeze({ projectId, projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id(3) })
  const ownerPublicKey = parsePublicKeyV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 4)))
  const ownerKeyId = structuredDigest("convax.local-project-owner-public-key/3", ownerPublicKey)
  const core: LocalProjectOwnerBindingCoreV3 = Object.freeze({
    format: "convax.local-project-owner-binding-core/3",
    projectId,
    projectEpoch,
    ownerKeyId,
    ownerPublicKey,
    initialReplicaId: parseReplicaIdV2("replica_00000001"),
    initialActorId: parseActorIdV2(ownerPublicKey),
    protocolDigest: digest("protocol-v3"),
    genesisAuthorizationPolicy: Object.freeze({ format: "convax.local-owner-genesis-authorization-policy/3", projectIndexScope, canvasAuthorization: "accepted-project-index-route-genesis-only" }),
    sharingGeneration: "0",
    creationNonce: id(4),
  })
  const binding = Object.freeze({ format: "convax.local-project-owner-binding/3" as const, core, coreDigest: localProjectOwnerBindingCoreDigestV3(core), ownerSignature: signature() })
  const authorizationCore: LocalOwnerEditAuthorizationCoreV3 = Object.freeze({
    format: "convax.local-owner-edit-authorization-core/3",
    ownerBindingCoreDigest: binding.coreDigest,
    projectId,
    projectEpoch,
    scope,
    replicaId: core.initialReplicaId,
    actorId: core.initialActorId,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    actorSequenceAllocationPolicy: Object.freeze({ format: "convax.local-owner-actor-sequence-allocation-policy/3", kind: "strict-durable-head-successor", initialSequence: "1" }),
    protocolDigest: core.protocolDigest,
    sharingGeneration: "0",
    expiryPolicy: "none",
  })
  const authorization = Object.freeze({ format: "convax.local-owner-edit-authorization/3" as const, core: authorizationCore, coreDigest: localOwnerEditAuthorizationCoreDigestV3(authorizationCore), ownerSignature: signature() })
  return { scope, binding, authorization }
}

function structuredDigest(domain: string, value: unknown) { const d = new TextEncoder().encode(domain); const b = encodeRestrictedJcsV2(value); const p = new Uint8Array(d.length + 1 + b.length); p.set(d); p.set(b, d.length + 1); return ordinarySha256V2(p) }
function signature() { return parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 4 : index === 32 ? 1 : 0))) }
function id(byte: number) { return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => byte))) }
function digest(value: string) { return ordinarySha256V2(new TextEncoder().encode(value)) }
