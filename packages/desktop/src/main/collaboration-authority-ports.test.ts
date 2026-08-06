import { describe, expect, test } from "bun:test"
import {
  causalFrontierDigest,
  CURRENT_PROTOCOL_IDENTITIES,
  ordinarySha256,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseUint64,
  type DecodedCausalEditFrame,
} from "@convax/collaboration"

import {
  createCurrentLocalReplicaAuthorityPort,
  createIncomingReplicaAuthorityVerificationPort,
  type CurrentLocalReplicaAuthoritySource,
} from "./collaboration-authority-ports"
import {
  createLocalFirstCurrentLocalReplicaAuthoritySource,
  createLocalProjectOwnerCurrentLocalReplicaAuthoritySource,
} from "./collaboration-production-runtime"

const encoder = new TextEncoder()
const digest = (value: string) => ordinarySha256(encoder.encode(value))
const id = (value: number) => parseId128(Buffer.alloc(16, value).toString("base64url"))
const actor = parseActorId(Buffer.alloc(32, 2).toString("base64url"))
const scope = Object.freeze({
  projectId: parseProjectId("project"),
  projectEpoch: id(1),
  docKind: "canvas" as const,
  docId: parseCanvasId(`cv_${"a".repeat(64)}`),
  shardEpoch: id(2),
})
const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })

describe("production collaboration authority adapters", () => {
  test("derives actor sequence only from the accepted actor head", async () => {
    const operationId = id(3)
    const ownerSchemaDigest = digest("canvas-schema")
    const source: CurrentLocalReplicaAuthoritySource = {
      async resolveCurrent() {
        return {
          scope,
          operationId,
          baseFrontierDigest: causalFrontierDigest(frontier),
          ownerSchemaDigest,
          signerAuthority: {
            kind: "team-replica" as const,
            memberId: parseMemberId(id(4)),
            replicaId: parseReplicaId("replica_0000002a"),
            actorId: actor,
            memberAuthorizationEpoch: id(5),
            replicaAuthorizationEpoch: id(6),
            membershipSnapshotDigest: digest("membership"),
            replicaActorCredentialCoreDigest: digest("credential"),
            replicaEditAuthorizationCoreDigest: digest("edit-authorization"),
          },
          dependencies: [],
          validationArtifacts: { format: "convax.validation-artifact-set" as const, artifacts: [] },
          signer: { async sign() { throw new Error("not invoked by adapter") } },
        }
      },
    }
    const port = createCurrentLocalReplicaAuthorityPort({ actorId: actor, source })
    const first = await port.prepareFinalFrameAuthority({ scope, operationId, baseFrontier: frontier, previousActorHead: null, ownerSchemaDigest })
    expect(first).not.toBe("pending")
    expect(first).not.toBe("rejected")
    if (typeof first === "string") throw new Error("unexpected")
    expect(String(first.actorSequence)).toBe("1")
    expect(first.predecessorFrameDigest).toBeNull()
    const prior = Object.freeze({ format: "convax.causal-head-ref" as const, actorId: actor, actorSequence: parseUint64("8"), frameDigest: digest("prior"), lamport: parseUint64("9") })
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
    } as unknown as DecodedCausalEditFrame
    const port = createIncomingReplicaAuthorityVerificationPort({
      async verify() {
        return {
          scope,
          frameDigest: digest("other-frame"),
          actorId: actor,
          signerAuthority: {
            kind: "team-replica" as const,
            memberId: parseMemberId(id(4)),
            replicaId: parseReplicaId("replica_0000002a"),
            actorId: actor,
            memberAuthorizationEpoch: id(5),
            replicaAuthorizationEpoch: id(6),
            membershipSnapshotDigest: digest("membership"),
            replicaActorCredentialCoreDigest: digest("credential"),
            replicaEditAuthorizationCoreDigest: digest("edit"),
          },
          replicaPublicKey: parsePublicKey(Buffer.alloc(32, 3).toString("base64url")),
        }
      },
    })
    await expect(port.verifyFrameAuthority(frame)).rejects.toThrow("another frame")
  })

  test("authorizes an unshared local Project and switches to Team only after a durable Team state", async () => {
    const operationId = id(7)
    const ownerSchemaDigest = digest("canvas-schema")
    const replicaId = parseReplicaId("replica_0000002a")
    const local = createLocalProjectOwnerCurrentLocalReplicaAuthoritySource({
      protocolDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest),
      async resolveOwner() {
        return {
          binding: {
            projectId: scope.projectId,
            projectEpoch: scope.projectEpoch,
            replicaId,
            actorId: actor,
            bindingDigest: digest("owner-binding"),
            protocolDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest),
          },
          validationArtifacts: { format: "convax.validation-artifact-set", artifacts: [] },
          signer: { async sign() { throw new Error("not invoked by source") } },
        }
      },
    })
    let shared = false
    let teamCalls = 0
    const selected = createLocalFirstCurrentLocalReplicaAuthoritySource({
      localOwner: local,
      team: {
        async resolveCurrent() {
          teamCalls += 1
          return "pending"
        },
      },
      async teamState() { return shared ? "active" : "missing" },
    })
    const request = { scope, actorId: actor, operationId, baseFrontierDigest: causalFrontierDigest(frontier), ownerSchemaDigest }
    const localEvidence = await selected.resolveCurrent(request)
    if (typeof localEvidence === "string") throw new Error("local owner should authorize")
    expect(localEvidence.signerAuthority.kind).toBe("local-project-owner")
    expect(localEvidence.dependencies.map((entry) => entry.kind)).toEqual([
      "local-owner-binding",
      "local-owner-edit-authorization",
    ])
    expect(teamCalls).toBe(0)
    shared = true
    expect(await selected.resolveCurrent(request)).toBe("pending")
    expect(teamCalls).toBe(1)
  })
})
