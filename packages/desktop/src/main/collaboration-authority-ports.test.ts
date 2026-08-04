import { describe, expect, test } from "bun:test"
import {
  causalFrontierDigestV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseUint64V2,
  type DecodedCausalEditFrameV2,
} from "@convax/collaboration"

import {
  createCurrentLocalReplicaAuthorityPortV2,
  createIncomingReplicaAuthorityVerificationPortV2,
  type CurrentLocalReplicaAuthoritySourceV2,
} from "./collaboration-authority-ports"

const encoder = new TextEncoder()
const digest = (value: string) => ordinarySha256V2(encoder.encode(value))
const id = (value: number) => parseId128V2(Buffer.alloc(16, value).toString("base64url"))
const actor = parseActorIdV2(Buffer.alloc(32, 2).toString("base64url"))
const scope = Object.freeze({
  projectId: parseProjectIdV2("project"),
  projectEpoch: id(1),
  docKind: "canvas" as const,
  docId: parseCanvasIdV2(`cv_${"a".repeat(64)}`),
  shardEpoch: id(2),
})
const frontier = Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) })

describe("production collaboration authority adapters", () => {
  test("derives actor sequence only from the accepted actor head", async () => {
    const operationId = id(3)
    const ownerSchemaDigest = digest("canvas-schema")
    const source: CurrentLocalReplicaAuthoritySourceV2 = {
      async resolveCurrent() {
        return {
          scope,
          operationId,
          baseFrontierDigest: causalFrontierDigestV2(frontier),
          ownerSchemaDigest,
          signerAuthority: {
            memberId: parseMemberIdV2(id(4)),
            replicaId: parseReplicaIdV2("replica_0000002a"),
            actorId: actor,
            memberAuthorizationEpoch: id(5),
            replicaAuthorizationEpoch: id(6),
            membershipSnapshotDigest: digest("membership"),
            replicaActorCredentialCoreDigest: digest("credential"),
            replicaEditAuthorizationCoreDigest: digest("edit-authorization"),
          },
          dependencies: [],
          validationArtifacts: { format: "convax.validation-artifact-set/2" as const, artifacts: [] },
          signer: { async sign() { throw new Error("not invoked by adapter") } },
        }
      },
    }
    const port = createCurrentLocalReplicaAuthorityPortV2({ actorId: actor, source })
    const first = await port.prepareFinalFrameAuthority({ scope, operationId, baseFrontier: frontier, previousActorHead: null, ownerSchemaDigest })
    expect(first).not.toBe("pending")
    expect(first).not.toBe("rejected")
    if (typeof first === "string") throw new Error("unexpected")
    expect(String(first.actorSequence)).toBe("1")
    expect(first.predecessorFrameDigest).toBeNull()
    const prior = Object.freeze({ format: "convax.causal-head-ref/2" as const, actorId: actor, actorSequence: parseUint64V2("8"), frameDigest: digest("prior"), lamport: parseUint64V2("9") })
    const next = await port.prepareFinalFrameAuthority({ scope, operationId, baseFrontier: frontier, previousActorHead: prior, ownerSchemaDigest })
    if (typeof next === "string") throw new Error("unexpected")
    expect(String(next.actorSequence)).toBe("9")
    expect(next.predecessorFrameDigest).toBe(prior.frameDigest)
  })

  test("rejects authority evidence copied from another frame", async () => {
    const frame = {
      frameDigest: digest("frame"),
      header: { core: {
        scope,
        actorId: actor,
        membershipSnapshotDigest: digest("membership"),
        replicaActorCredentialCoreDigest: digest("credential"),
        replicaEditAuthorizationCoreDigest: digest("edit"),
      } },
    } as unknown as DecodedCausalEditFrameV2
    const port = createIncomingReplicaAuthorityVerificationPortV2({
      async verify() {
        return {
          scope,
          frameDigest: digest("other-frame"),
          actorId: actor,
          membershipSnapshotDigest: frame.header.core.membershipSnapshotDigest,
          replicaActorCredentialCoreDigest: frame.header.core.replicaActorCredentialCoreDigest,
          replicaEditAuthorizationCoreDigest: frame.header.core.replicaEditAuthorizationCoreDigest,
          replicaPublicKey: parsePublicKeyV2(Buffer.alloc(32, 3).toString("base64url")),
        }
      },
    })
    await expect(port.verifyFrameAuthority(frame)).rejects.toThrow("another frame")
  })
})
