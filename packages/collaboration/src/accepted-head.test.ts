import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import {
  createAcceptedHeadMaterializationEvidence,
  createLocalAcceptedHeadMaterializationEvidence,
  replicaActorHeadSetDigest,
  validateAcceptedHeadMaterializationEvidence,
} from "./accepted-head"
import { causalFrontierDigest } from "./causal"
import { encodeBase64url, parseActorId, parseDigest, parseId128, parseProjectId, parseUint64 } from "./codecs"
import type { AcceptedHeadMaterializationEvidence, AcceptedHeadView } from "./ports"
import { encodeFullUpdate, encodeStateVector } from "./yjs-codec"
import { nativeOrdinarySha256, ordinarySha256 } from "./digest"
import * as publicSurface from "./index"

describe("accepted-head materialization evidence", () => {
  test("native SHA has portable parity and falls back when subtle fails", async () => {
    const bytes = new TextEncoder().encode("accepted-head-native-parity")
    expect(await nativeOrdinarySha256(bytes)).toBe(ordinarySha256(bytes))
    expect(
      await nativeOrdinarySha256(bytes, {
        digest: async () => {
          throw new Error("subtle unavailable")
        },
      }),
    ).toBe(ordinarySha256(bytes))
  })
  test("does not expose the evidence issuer from the package root", () => {
    expect("createAcceptedHeadMaterializationEvidence" in publicSurface).toBe(false)
  })

  test("binds one validated post state to the exact base, frame, frontier, and actor heads", () => {
    const baseDocument = new Y.Doc()
    const postDocument = new Y.Doc()
    const scope = projectIndexScope()
    const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
    const actorHeads = Object.freeze({
      format: "convax.replica-actor-head-set" as const,
      scope,
      heads: Object.freeze([]),
    })
    const previous: AcceptedHeadView = Object.freeze({
      scope,
      headDigest: digest("1"),
      frontier,
      frontierDigest: causalFrontierDigest(frontier),
      actorHeads,
      fullUpdate: encodeFullUpdate(baseDocument),
      stateVector: encodeStateVector(baseDocument),
      canonicalStateDigest: digest("2"),
    })
    Y.applyUpdate(postDocument, previous.fullUpdate)
    postDocument.getMap("entries").set("resource", { kind: "file" })
    const ref = Object.freeze({
      scope,
      frameDigest: digest("3"),
      actorId: actorId(),
      actorSequence: parseUint64("1"),
      operationId: parseId128(encodeBase64url(new Uint8Array(16).fill(4))),
    })
    const nextHead = Object.freeze({
      format: "convax.causal-head-ref" as const,
      actorId: ref.actorId,
      actorSequence: ref.actorSequence,
      frameDigest: ref.frameDigest,
      lamport: parseUint64("1"),
    })
    const resultingFrontier = Object.freeze({
      format: "convax.causal-frontier" as const,
      heads: Object.freeze([nextHead]),
    })
    const evidence = createAcceptedHeadMaterializationEvidence({
      previous,
      ref,
      nextHead,
      resultingFrontier,
      postDocument,
      canonicalStateDigest: digest("5"),
    })

    const accepted = validateAcceptedHeadMaterializationEvidence({ previous, ref, evidence })
    expect(accepted).not.toBe("rejected")
    if (accepted === "rejected") throw new Error("expected accepted materialization evidence")
    expect(accepted.headDigest).toBe(previous.headDigest)
    expect(accepted.frontierDigest).toBe(causalFrontierDigest(resultingFrontier))
    expect(replicaActorHeadSetDigest(accepted.actorHeads)).toBe(evidence.resultingActorHeadsDigest)
    expect(accepted.fullUpdate).toEqual(encodeFullUpdate(postDocument))
    expect(accepted.stateVector).toEqual(encodeStateVector(postDocument))
    expect(accepted.canonicalStateDigest).toBe(digest("5"))
    expect(
      validateAcceptedHeadMaterializationEvidence({
        previous,
        ref,
        evidence: { ...evidence },
      }),
    ).toBe("rejected")

    baseDocument.destroy()
    postDocument.destroy()
  })

  test("async local evidence has exact sync parity and remains privately authoritative", async () => {
    const fixture = evidenceFixture()
    try {
      const local = await createLocalAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        nextHead: fixture.nextHead,
        resultingFrontier: fixture.resultingFrontier,
        postDocument: fixture.postDocument,
        canonicalStateDigest: digest("5"),
      })
      expect(local).toEqual(fixture.evidence)
      local.fullUpdate.fill(0xff)
      local.stateVector.fill(0xff)
      const accepted = validateAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        evidence: local,
      })
      expect(accepted).not.toBe("rejected")
      if (accepted === "rejected") throw new Error("expected private local evidence")
      expect(accepted.fullUpdate).toEqual(encodeFullUpdate(fixture.postDocument))
      expect(accepted.stateVector).toEqual(encodeStateVector(fixture.postDocument))
      expect(accepted.frontierDigest).toBe(causalFrontierDigest(fixture.resultingFrontier))
    } finally {
      fixture.baseDocument.destroy()
      fixture.postDocument.destroy()
    }
  })

  test("rejects stale bases, mismatched frames, and mutated post-state fields", () => {
    const fixture = evidenceFixture()
    try {
      expect(
        validateAcceptedHeadMaterializationEvidence({
          previous: { ...fixture.previous, headDigest: digest("9") },
          ref: fixture.ref,
          evidence: fixture.evidence,
        }),
      ).toBe("rejected")
      expect(
        validateAcceptedHeadMaterializationEvidence({
          previous: fixture.previous,
          ref: { ...fixture.ref, frameDigest: digest("8") },
          evidence: fixture.evidence,
        }),
      ).toBe("rejected")
      const changedFullUpdate = Uint8Array.from(fixture.evidence.fullUpdate)
      changedFullUpdate[0] = (changedFullUpdate[0] ?? 0) ^ 1
      expect(rejects(fixture, { fullUpdate: changedFullUpdate })).toBe(true)
      expect(
        rejects(fixture, { stateVector: Uint8Array.of(1) as AcceptedHeadMaterializationEvidence["stateVector"] }),
      ).toBe(true)
      expect(rejects(fixture, { canonicalStateDigest: digest("7") })).toBe(true)
    } finally {
      fixture.baseDocument.destroy()
      fixture.postDocument.destroy()
    }
  })

  test("ignores in-place mutation of issued public typed-array bytes", () => {
    const fixture = evidenceFixture()
    try {
      const expected = encodeFullUpdate(fixture.postDocument)
      fixture.evidence.fullUpdate[0] = (fixture.evidence.fullUpdate[0] ?? 0) ^ 1
      const accepted = validateAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        evidence: fixture.evidence,
      })
      expect(accepted).not.toBe("rejected")
      if (accepted === "rejected") throw new Error("expected private issued bytes")
      expect(accepted.fullUpdate).toEqual(expected)
      expect(accepted.fullUpdate).not.toEqual(fixture.evidence.fullUpdate)
    } finally {
      fixture.baseDocument.destroy()
      fixture.postDocument.destroy()
    }
  })
})

function evidenceFixture() {
  const baseDocument = new Y.Doc()
  const postDocument = new Y.Doc()
  const scope = projectIndexScope()
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const actorHeads = Object.freeze({
    format: "convax.replica-actor-head-set" as const,
    scope,
    heads: Object.freeze([]),
  })
  const previous: AcceptedHeadView = Object.freeze({
    scope,
    headDigest: digest("1"),
    frontier,
    frontierDigest: causalFrontierDigest(frontier),
    actorHeads,
    fullUpdate: encodeFullUpdate(baseDocument),
    stateVector: encodeStateVector(baseDocument),
    canonicalStateDigest: digest("2"),
  })
  postDocument.getMap("entries").set("resource", "value")
  const ref = Object.freeze({
    scope,
    frameDigest: digest("3"),
    actorId: actorId(),
    actorSequence: parseUint64("1"),
    operationId: parseId128(encodeBase64url(new Uint8Array(16).fill(4))),
  })
  const nextHead = Object.freeze({
    format: "convax.causal-head-ref" as const,
    actorId: ref.actorId,
    actorSequence: ref.actorSequence,
    frameDigest: ref.frameDigest,
    lamport: parseUint64("1"),
  })
  const resultingFrontier = Object.freeze({
    format: "convax.causal-frontier" as const,
    heads: Object.freeze([nextHead]),
  })
  const evidence = createAcceptedHeadMaterializationEvidence({
    previous,
    ref,
    nextHead,
    resultingFrontier,
    postDocument,
    canonicalStateDigest: digest("5"),
  })
  return { baseDocument, postDocument, previous, ref, nextHead, resultingFrontier, evidence }
}

function rejects(
  fixture: ReturnType<typeof evidenceFixture>,
  change: Partial<AcceptedHeadMaterializationEvidence>,
): boolean {
  return (
    validateAcceptedHeadMaterializationEvidence({
      previous: fixture.previous,
      ref: fixture.ref,
      evidence: { ...fixture.evidence, ...change },
    }) === "rejected"
  )
}

function projectIndexScope() {
  return Object.freeze({
    projectId: parseProjectId("benchmark-project"),
    projectEpoch: parseId128(encodeBase64url(new Uint8Array(16).fill(1))),
    docKind: "project-index" as const,
    docId: "project-index" as const,
    shardEpoch: parseId128(encodeBase64url(new Uint8Array(16).fill(2))),
  })
}

function actorId() {
  return parseActorId(encodeBase64url(new Uint8Array(32).fill(6)))
}

function digest(character: string) {
  return parseDigest(character.repeat(64))
}
