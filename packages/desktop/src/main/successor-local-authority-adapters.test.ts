import { describe, expect, mock, test } from "bun:test"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parseReplicaIdV2,
  type LocalOwnerEditAuthorizationV3,
  type LocalProjectOwnerBindingV3,
  type ProtocolPromotionBridgeV3,
} from "@convax/collaboration"
import type { OpenSuccessorProjectProtocolStateV3 } from "@convax/project/node"

import { createExactSuccessorLocalAuthoritySourcesV3 } from "./successor-local-authority-adapters"

const PROJECT_ID = parseProjectIdV2("project-v3-exact-source")
const PROJECT_EPOCH = parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(1)))
const SCOPE = Object.freeze({
  projectId: PROJECT_ID,
  projectEpoch: PROJECT_EPOCH,
  docKind: "canvas" as const,
  docId: parseCanvasIdV2(`cv_${"a".repeat(64)}`),
  shardEpoch: parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(2))),
})
const PROTOCOL = parseDigestV2("1".repeat(64))
const SCHEMA = parseDigestV2("2".repeat(64))
const BINDING_DIGEST = parseDigestV2("3".repeat(64))
const AUTHORIZATION_DIGEST = parseDigestV2("4".repeat(64))
const BRIDGE_DIGEST = parseDigestV2("5".repeat(64))
const REPLICA = parseReplicaIdV2("replica_00000001")
const ACTOR = parseActorIdV2(encodeBase64urlV2(new Uint8Array(32).fill(6)))

describe("exact successor local authority adapters", () => {
  test("requires active protocol state before exposing owner records or bridge", async () => {
    const fixture = authorityFixture()
    const protocolOpen = mock(async () => fixture.opened)
    const ownerResolve = mock(async () => fixture.resolved)
    const sources = createExactSuccessorLocalAuthoritySourcesV3({
      protocolStore: { open: protocolOpen },
      ownerStore: { resolveExact: ownerResolve },
    })

    expect(await sources.records.resolveExact({
      projectId: PROJECT_ID,
      projectEpoch: PROJECT_EPOCH,
      scope: SCOPE,
      ownerSchemaDigest: SCHEMA,
      protocolDigest: PROTOCOL,
    })).toBe(fixture.resolved)
    expect(await sources.promotionBridge.resolveExact({ scope: SCOPE, protocolDigest: PROTOCOL })).toBe(BRIDGE_DIGEST)
    expect(protocolOpen).toHaveBeenCalledTimes(2)
    expect(ownerResolve).toHaveBeenCalledTimes(1)
  })

  test("does not activate an owner record when protocol state is absent or mismatched", async () => {
    const fixture = authorityFixture()
    const ownerResolve = mock(async () => fixture.resolved)
    const request = {
      projectId: PROJECT_ID,
      projectEpoch: PROJECT_EPOCH,
      scope: SCOPE,
      ownerSchemaDigest: SCHEMA,
      protocolDigest: PROTOCOL,
    }
    const absent = createExactSuccessorLocalAuthoritySourcesV3({
      protocolStore: { async open() { return { status: "not-installed" } } },
      ownerStore: { resolveExact: ownerResolve },
    })
    expect(await absent.records.resolveExact(request)).toBe("missing")
    expect(await absent.promotionBridge.resolveExact({ scope: SCOPE, protocolDigest: PROTOCOL })).toBe("missing")

    const mismatched = createExactSuccessorLocalAuthoritySourcesV3({
      protocolStore: { async open() { return { ...fixture.opened, state: { ...fixture.opened.state, protocolDigest: parseDigestV2("9".repeat(64)) } } } },
      ownerStore: { resolveExact: ownerResolve },
    })
    expect(await mismatched.records.resolveExact(request)).toBe("rejected")
    expect(ownerResolve).not.toHaveBeenCalled()
  })
})

function authorityFixture() {
  const binding = { coreDigest: BINDING_DIGEST } as LocalProjectOwnerBindingV3
  const authorization = {
    coreDigest: AUTHORIZATION_DIGEST,
    core: { scope: SCOPE, ownerSchemaDigest: SCHEMA },
  } as LocalOwnerEditAuthorizationV3
  const bridge = {
    coreDigest: BRIDGE_DIGEST,
    core: { scope: SCOPE, successorProtocolDigest: PROTOCOL },
  } as ProtocolPromotionBridgeV3
  const opened = {
    status: "v3-local" as const,
    stateDigest: parseDigestV2("6".repeat(64)),
    state: {
      format: "convax.project-protocol-state-local/3" as const,
      projectId: PROJECT_ID,
      projectEpoch: PROJECT_EPOCH,
      protocolDigest: PROTOCOL,
      sharingGeneration: "0" as const,
      origin: { kind: "new-project" as const, creationClaimDigest: parseDigestV2("0".repeat(64)) },
      ownerBinding: binding,
      authorizations: [{ authorization, proof: { kind: "project-index-genesis" as const, proofDigest: parseDigestV2("7".repeat(64)) } }],
      bridges: [bridge],
    },
  } as OpenSuccessorProjectProtocolStateV3 & { status: "v3-local" }
  return {
    opened,
    resolved: {
      binding,
      authorization,
      authority: {
        kind: "local-project-owner" as const,
        ownerKeyId: parseDigestV2("8".repeat(64)),
        replicaId: REPLICA,
        actorId: ACTOR,
        ownerBindingCoreDigest: BINDING_DIGEST,
        ownerEditAuthorizationCoreDigest: AUTHORIZATION_DIGEST,
      },
    },
  }
}
