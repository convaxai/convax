import { describe, expect, mock, test } from "bun:test"
import type {
  ActorIdV2,
  LocalProjectOwnerSignerAuthorityV3,
  ReplicaSignerPortV2,
  ValidationArtifactSetV2,
} from "@convax/collaboration"
import {
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  encodeBase64urlV2,
  parseId128V2,
  parseUint64V2,
} from "@convax/collaboration"

import {
  LocalProjectAuthorityUnavailableErrorV3,
  createCurrentLocalOwnerAuthorityPortV3,
  openSelectedProjectCollaborationRuntimeV3,
} from "./successor-collaboration-production-runtime"
import { createProjectCollaborationMaterializerRegistryV2 } from "./collaboration-production-runtime"
import type { CurrentLocalOwnerAuthorityEvidenceV3 } from "./local-owner-authority-source-v3"

const DIGEST_A = parseDigestV2("a".repeat(64))
const DIGEST_B = parseDigestV2("b".repeat(64))
const DIGEST_C = parseDigestV2("c".repeat(64))
const ACTOR = parseActorIdV2(encodeBase64urlV2(new Uint8Array(32).fill(1)))
const SCOPE = parseDocumentScopeV2({
  projectId: "project-local-v3",
  projectEpoch: encodeBase64urlV2(new Uint8Array(16).fill(2)),
  docKind: "canvas" as const,
  docId: `cv_${"1".repeat(64)}`,
  shardEpoch: encodeBase64urlV2(new Uint8Array(16).fill(3)),
})

describe("V3 local Project production composition", () => {
  test("open, edit and restart select only local runtime and keep Team/network factories cold", async () => {
    const durable = { edits: [] as string[] }
    const constructors = {
      team: mock(() => { throw new Error("Team must stay cold") }),
      control: mock(() => { throw new Error("Control must stay cold") }),
      rendezvous: mock(() => { throw new Error("rendezvous must stay cold") }),
      peerjs: mock(() => { throw new Error("PeerJS must stay cold") }),
    }
    const openV10 = mock(async () => {
      constructors.team(); constructors.control(); constructors.rendezvous(); constructors.peerjs()
      return { protocol: "v10" as const }
    })
    const openLocal = mock(async () => ({
      protocol: "v3-local" as const,
      edit(value: string) { durable.edits.push(value) },
      read() { return [...durable.edits] },
    }))

    const first = await openSelectedProjectCollaborationRuntimeV3({
      selection: { protocol: "v11-r1-local-owner" }, openV10, openV3Local: openLocal,
    })
    if (first.protocol !== "v3-local") throw new Error("unexpected runtime")
    first.edit("canvas-a")

    const restarted = await openSelectedProjectCollaborationRuntimeV3({
      selection: { protocol: "v11-r1-local-owner" }, openV10, openV3Local: openLocal,
    })
    if (restarted.protocol !== "v3-local") throw new Error("unexpected runtime")
    expect(restarted.read()).toEqual(["canvas-a"])
    expect(openV10).not.toHaveBeenCalled()
    expect(openLocal).toHaveBeenCalledTimes(2)
    for (const factory of Object.values(constructors)) expect(factory).not.toHaveBeenCalled()
  })

  test("first actor frame binds the exact promotion bridge; later frames bind the accepted predecessor", async () => {
    const source = mock(async () => evidence())
    const bridge = mock(async () => DIGEST_C)
    const port = createCurrentLocalOwnerAuthorityPortV3({
      actorId: ACTOR,
      protocolDigest: DIGEST_A,
      source: { resolveCurrent: source },
      promotionBridge: { resolveExact: bridge },
      validationArtifacts: artifacts(),
    })

    const first = await port.prepareFinalFrameAuthority({
      scope: SCOPE,
      operationId: parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(4))),
      baseFrontier: { format: "convax.causal-frontier/2", heads: [] },
      previousActorHead: null,
      ownerSchemaDigest: DIGEST_B,
    })
    if (typeof first === "string") throw new Error(first)
    expect(String(first.actorSequence)).toBe("1")
    expect(first.predecessorFrameDigest).toBe(DIGEST_C)
    expect(first.dependencies.at(-1)).toEqual({ kind: "protocol-promotion-bridge", digest: DIGEST_C })

    const next = await port.prepareFinalFrameAuthority({
      scope: SCOPE,
      operationId: parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(5))),
      baseFrontier: { format: "convax.causal-frontier/2", heads: [] },
      previousActorHead: {
        format: "convax.causal-head-ref/2",
        actorId: ACTOR,
        actorSequence: parseUint64V2("7"),
        frameDigest: DIGEST_B,
        lamport: parseUint64V2("7"),
      },
      ownerSchemaDigest: DIGEST_B,
    })
    if (typeof next === "string") throw new Error(next)
    expect(String(next.actorSequence)).toBe("8")
    expect(next.predecessorFrameDigest).toBe(DIGEST_B)
    expect(next.dependencies.some((item) => item.kind === "protocol-promotion-bridge")).toBe(false)
    expect(bridge).toHaveBeenCalledTimes(1)
  })

  test("local-authority-unavailable is reachable only from explicit missing/corrupt/ambiguous evidence", async () => {
    const openV10 = mock(async () => "v10")
    const openV3Local = mock(async () => "v3")
    for (const reason of ["owner-key-missing", "evidence-corrupt", "promotion-ambiguous"] as const) {
      expect(() => openSelectedProjectCollaborationRuntimeV3({
        selection: { protocol: "local-authority-unavailable", reason }, openV10, openV3Local,
      })).toThrow(new LocalProjectAuthorityUnavailableErrorV3(reason))
    }
    expect(openV10).not.toHaveBeenCalled()
    expect(openV3Local).not.toHaveBeenCalled()
  })

  test("durable accepted-frame observation reaches the scope materializer", () => {
    const observeAcceptedFrame = mock(() => undefined)
    const registry = createProjectCollaborationMaterializerRegistryV2()
    registry.register({
      scope: SCOPE,
      materializer: {
        async inspectFrame() { throw new Error("unused") },
        async applyAcceptedFrame() { throw new Error("unused") },
        observeAcceptedFrame,
        actorHeadsDigest() { throw new Error("unused") },
      },
    })
    const ref = {
      scope: SCOPE,
      frameDigest: DIGEST_A,
      actorId: ACTOR,
      actorSequence: parseUint64V2("1"),
      operationId: parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(6))),
    }
    const exactBytes = new Uint8Array([1, 2, 3])

    registry.observeAcceptedFrame?.(ref, exactBytes)

    expect(observeAcceptedFrame).toHaveBeenCalledTimes(1)
    expect(observeAcceptedFrame).toHaveBeenCalledWith(ref, exactBytes)
  })
})

function evidence(): CurrentLocalOwnerAuthorityEvidenceV3 {
  const authority = Object.freeze({
    kind: "local-project-owner" as const,
    ownerKeyId: DIGEST_A,
    replicaId: "local-owner-replica",
    actorId: ACTOR,
    ownerBindingCoreDigest: DIGEST_A,
    ownerEditAuthorizationCoreDigest: DIGEST_B,
  }) as LocalProjectOwnerSignerAuthorityV3
  return Object.freeze({
    authority,
    binding: {} as CurrentLocalOwnerAuthorityEvidenceV3["binding"],
    authorization: {} as CurrentLocalOwnerAuthorityEvidenceV3["authorization"],
    dependencies: Object.freeze([
      Object.freeze({ kind: "local-owner-binding" as const, digest: DIGEST_A }),
      Object.freeze({ kind: "local-owner-edit-authorization" as const, digest: DIGEST_B }),
    ]),
    signer: { publicKey: DIGEST_A, async sign() { return "signature" } } as unknown as ReplicaSignerPortV2,
  })
}

function artifacts(): ValidationArtifactSetV2 {
  return Object.freeze({ format: "convax.validation-artifact-set/2", artifacts: [] })
}
