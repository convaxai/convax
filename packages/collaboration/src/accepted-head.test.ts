import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import {
  createAcceptedHeadMaterializationEvidence,
  createLocalAcceptedHeadMaterializationEvidence,
  parseAcceptedHeadDurableDeltaMetadata,
  replicaActorHeadSetDigest,
  validateAcceptedHeadMaterializationEvidence,
} from "./accepted-head"
import { causalFrontierDigest } from "./causal"
import { encodeBase64url, parseActorId, parseDigest, parseId128, parseProjectId, parseUint64 } from "./codecs"
import type { AcceptedHeadMaterializationEvidence, AcceptedHeadView } from "./ports"
import { encodeCandidateDelta, encodeFullUpdate, encodeStateVector, yjsUpdateDigest } from "./yjs-codec"
import * as publicSurface from "./index"

describe("accepted-head delta commitment evidence", () => {
  test("does not expose the private issuer from the package root", () => {
    expect("createAcceptedHeadMaterializationEvidence" in publicSurface).toBe(false)
    expect("createLocalAcceptedHeadMaterializationEvidence" in publicSurface).toBe(false)
  })

  test("binds one metadata-only transition to the exact prior head and frame", () => {
    const fixture = evidenceFixture()
    try {
      const accepted = validateAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        evidence: fixture.evidence,
      })
      expect(accepted).not.toBe("rejected")
      if (accepted === "rejected") throw new Error("expected accepted delta evidence")
      expect(accepted.transition.frontierDigest).toBe(causalFrontierDigest(fixture.resultingFrontier))
      expect(replicaActorHeadSetDigest(accepted.transition.actorHeads)).toBe(fixture.evidence.resultingActorHeadsDigest)
      expect(accepted.transition.stateVector).toEqual(encodeStateVector(fixture.postDocument))
      expect(accepted.transition.canonicalStateDigest).toBe(digest("5"))
      expect(accepted.transition.materializationDigest).toBe(fixture.evidence.resultingMaterializationDigest)
      expect(accepted.durableDelta.stateVector).toEqual(accepted.transition.stateVector)
      expect(fixture.evidence.work).toEqual({
        fullUpdateEncodes: 0,
        historicalBytesVisited: 0,
        candidateFullClones: 0,
      })
      expect("fullUpdate" in fixture.evidence).toBe(false)
      expect("fullUpdateDigest" in fixture.evidence).toBe(false)
      expect("baseMaterializedStateDigest" in fixture.evidence).toBe(false)
      expect("stateVector" in fixture.evidence).toBe(false)
      expect("resultingFrontier" in fixture.evidence).toBe(false)
      expect("resultingActorHeads" in fixture.evidence).toBe(false)
      expect(() => parseAcceptedHeadDurableDeltaMetadata(fixture.evidence)).toThrow(
        "AcceptedHeadDurableDeltaMetadata",
      )
    } finally {
      fixture.baseDocument.destroy()
      fixture.postDocument.destroy()
    }
  })

  test("local evidence has no full-update work and reports candidate clone structure", () => {
    const fixture = evidenceFixture()
    try {
      const local = createLocalAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        nextHead: fixture.nextHead,
        resultingFrontier: fixture.resultingFrontier,
        postStateVector: encodeStateVector(fixture.postDocument),
        yjsUpdateDigest: fixture.yjsUpdateDigest,
        canonicalStateDigest: digest("5"),
        candidateFullClones: 1,
      })
      expect(local.work).toEqual({
        fullUpdateEncodes: 0,
        historicalBytesVisited: 0,
        candidateFullClones: 1,
      })
      expect(local.resultingMaterializationDigest).toBe(fixture.evidence.resultingMaterializationDigest)
    } finally {
      fixture.baseDocument.destroy()
      fixture.postDocument.destroy()
    }
  })

  test("rejects stale metadata, cross-frame reuse, structural clones, and digest tampering", () => {
    const fixture = evidenceFixture()
    try {
      expect(rejects(fixture, { previous: { ...fixture.previous, headDigest: digest("9") } })).toBe(true)
      expect(rejects(fixture, { ref: { ...fixture.ref, frameDigest: digest("8") } })).toBe(true)
      expect(rejects(fixture, { evidence: { ...fixture.evidence } as AcceptedHeadMaterializationEvidence })).toBe(true)
      expect(rejects(fixture, {
        evidence: {
          ...fixture.evidence,
          resultingMaterializationDigest: digest("7"),
        } as AcceptedHeadMaterializationEvidence,
      })).toBe(true)
      const staleVector = Uint8Array.of(1) as AcceptedHeadView["stateVector"]
      expect(rejects(fixture, { previous: { ...fixture.previous, stateVector: staleVector } })).toBe(true)
    } finally {
      fixture.baseDocument.destroy()
      fixture.postDocument.destroy()
    }
  })

  test("does not visit or bind historical full-update bytes on the hot validator", () => {
    const fixture = evidenceFixture()
    try {
      fixture.previous.fullUpdate.fill(0xff)
      const accepted = validateAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        evidence: fixture.evidence,
      })
      expect(accepted).not.toBe("rejected")
      expect(fixture.evidence.work.historicalBytesVisited).toBe(0)
    } finally {
      fixture.baseDocument.destroy()
      fixture.postDocument.destroy()
    }
  })

  test("mutable durable projections cannot alter the private issued transition", () => {
    const fixture = evidenceFixture()
    try {
      const expected = encodeStateVector(fixture.postDocument)
      const first = validateAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        evidence: fixture.evidence,
      })
      expect(first).not.toBe("rejected")
      if (first === "rejected") throw new Error("expected private issued transition")
      first.durableDelta.stateVector.fill(0xff)
      const second = validateAcceptedHeadMaterializationEvidence({
        previous: fixture.previous,
        ref: fixture.ref,
        evidence: fixture.evidence,
      })
      expect(second).not.toBe("rejected")
      if (second === "rejected") throw new Error("expected private issued transition")
      expect(second.transition.stateVector).toEqual(expected)
      expect(second.durableDelta.stateVector).toEqual(expected)
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
    materializationDigest: digest("6"),
  })
  Y.applyUpdate(postDocument, previous.fullUpdate)
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
  const update = encodeCandidateDelta(postDocument, previous.stateVector)
  const updateDigest = yjsUpdateDigest(update)
  const evidence = createAcceptedHeadMaterializationEvidence({
    previous,
    ref,
    nextHead,
    resultingFrontier,
    postStateVector: encodeStateVector(postDocument),
    yjsUpdateDigest: updateDigest,
    canonicalStateDigest: digest("5"),
  })
  return {
    baseDocument,
    postDocument,
    previous,
    ref,
    nextHead,
    resultingFrontier,
    yjsUpdateDigest: updateDigest,
    evidence,
  }
}

function rejects(
  fixture: ReturnType<typeof evidenceFixture>,
  change: Partial<{
    previous: AcceptedHeadView
    ref: typeof fixture.ref
    evidence: AcceptedHeadMaterializationEvidence
  }>,
): boolean {
  return validateAcceptedHeadMaterializationEvidence({
    previous: change.previous ?? fixture.previous,
    ref: change.ref ?? fixture.ref,
    evidence: change.evidence ?? fixture.evidence,
  }) === "rejected"
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
