import { describe, expect, test } from "bun:test"
import * as Y from "yjs"

import { causalFrontierDigest } from "./causal"
import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseProjectId,
  parseReplicaId,
  parseSignature,
} from "./codecs"
import { CURRENT_PROTOCOL_IDENTITIES, KERNEL_DIGEST_DOMAINS } from "./constants"
import { canonicalStateDigest, hexToBytes, ordinarySha256, structuredDigest } from "./digest"
import {
  actualWriteEvidenceDigest,
  causalContextDigest,
  encodeCausalPayload,
  typedIntentDigest,
} from "./frame"
import { encodeRestrictedJcs } from "./jcs"
import { localOwnerEditAuthorizationCoreDigest } from "./local-owner-authority"
import {
  IMMEDIATE_PREDECESSOR_PROTOCOL,
  immediatePredecessorLocalOwnerEditAuthorizationCoreDigest,
  verifyImmediatePredecessorFrame,
} from "./migration"
import { causalSignerAuthorityDigest, parseActualWriteEvidence, parseCausalContext } from "./parse"
import { encodeCandidateDelta, encodeStateVector, stateVectorDigest, yjsUpdateDigest } from "./yjs-codec"

const ZERO_ID = parseId128(encodeBase64url(new Uint8Array(16)))
const ACTOR = parseActorId(encodeBase64url(Uint8Array.from({ length: 32 }, () => 1)))
const REPLICA = parseReplicaId("replica_00000001")
const SIGNATURE = parseSignature(encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0)))
const DIGEST_A = ordinarySha256(new TextEncoder().encode("a"))
const DIGEST_B = ordinarySha256(new TextEncoder().encode("b"))
const SCOPE = Object.freeze({
  projectId: parseProjectId("project"),
  projectEpoch: ZERO_ID,
  docKind: "canvas" as const,
  docId: parseCanvasId(`cv_${"1".repeat(64)}`),
  shardEpoch: ZERO_ID,
})

describe("sealed immediate-predecessor frame migration", () => {
  test("reconstructs the exact db8 local-owner authorization without widening the current helper", () => {
    const predecessorCore = Object.freeze({
      format: "convax.local-owner-edit-authorization-core" as const,
      scope: SCOPE,
      replicaId: REPLICA,
      actorId: ACTOR,
      ownerBindingDigest: DIGEST_A,
      protocolDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest,
      ownerSchemaDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest,
      expiryPolicy: "none" as const,
    })
    expect(immediatePredecessorLocalOwnerEditAuthorizationCoreDigest(predecessorCore)).toBe(
      parseDigest("a7f42a71e6728562f6405f0bf33bec237daf024cdabddf30fab4ff915752cfa7"),
    )
    expect(() => localOwnerEditAuthorizationCoreDigest(predecessorCore)).toThrow("current protocol")
    expect(() => immediatePredecessorLocalOwnerEditAuthorizationCoreDigest({
      ...predecessorCore,
      protocolDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest),
    })).toThrow("sealed immediate-predecessor")
  })

  test("returns a delta only after exact 8295 binding and signature verification", async () => {
    const bytes = fixtureFrame(IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest)
    let verifiedPurpose: Uint8Array | undefined
    const frame = await verifyImmediatePredecessorFrame(bytes, {
      verify: async (input) => {
        verifiedPurpose = input.purposeDigest
        return input.signerAuthority.kind === "local-project-owner"
      },
    })
    expect(frame.scope).toEqual(SCOPE)
    expect(frame.yjsUpdate.byteLength).toBeGreaterThan(0)
    expect(verifiedPurpose?.byteLength).toBe(32)
  })

  test("never admits current, unknown, corrupt, or unsigned bytes", async () => {
    const verifier = { verify: async () => true }
    await expect(verifyImmediatePredecessorFrame(fixtureFrame(CURRENT_PROTOCOL_IDENTITIES.protocolDigest), verifier)).rejects.toThrow("expected protocol")
    await expect(verifyImmediatePredecessorFrame(fixtureFrame(DIGEST_A), verifier)).rejects.toThrow("expected protocol")
    const corrupt = fixtureFrame(IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest)
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1
    await expect(verifyImmediatePredecessorFrame(corrupt, verifier)).rejects.toThrow("SHA-256")
    await expect(verifyImmediatePredecessorFrame(fixtureFrame(IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest), { verify: async () => false })).rejects.toThrow("signature")
  })
})

function fixtureFrame(protocolDigest: string): Uint8Array {
  const base = new Y.Doc()
  const candidate = new Y.Doc()
  candidate.clientID = 1
  candidate.getMap("root").set("value", "preserved")
  const baseStateVector = encodeStateVector(base)
  const yjsUpdate = encodeCandidateDelta(candidate, baseStateVector)
  const typedIntentJcs = encodeRestrictedJcs({ format: "convax.typed-intent", kind: "set" })
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const signerAuthority = Object.freeze({
    kind: "local-project-owner" as const,
    replicaId: REPLICA,
    actorId: ACTOR,
    ownerBindingDigest: DIGEST_A,
    ownerEditAuthorizationCoreDigest: DIGEST_B,
  })
  const context = parseCausalContext({
    format: "convax.causal-context",
    scope: SCOPE,
    baseFrontier: frontier,
    baseFrontierDigest: causalFrontierDigest(frontier),
    baseStateVectorDigest: stateVectorDigest(baseStateVector),
    baseCanonicalStateDigest: canonicalStateDigest(IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest, canonicalState({})),
    signerAuthority,
    dependencies: [
      { kind: "local-owner-binding", digest: DIGEST_A },
      { kind: "local-owner-edit-authorization", digest: DIGEST_B },
    ],
    validationArtifactSetDigest: DIGEST_A,
  })
  const causalContextJcs = encodeRestrictedJcs(context)
  const intentDigest = typedIntentDigest(typedIntentJcs)
  const evidence = parseActualWriteEvidence({
    format: "convax.actual-write-evidence",
    scope: SCOPE,
    owner: "canvas",
    ownerSchemaDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest,
    intentDigest,
    changedPaths: ["root/value"],
    writes: [{ entityKind: "root", entityId: "root", field: "value", valueDigest: DIGEST_A }],
  })
  const actualWriteEvidenceJcs = encodeRestrictedJcs(evidence)
  const core = Object.freeze({
    format: "convax.causal-edit-core",
    scope: SCOPE,
    actorId: ACTOR,
    actorSequence: "1",
    predecessorFrameDigest: null,
    operationId: ZERO_ID,
    lamport: "1",
    intentKind: "set",
    intentDigest,
    causalContextDigest: causalContextDigest(context),
    baseFrontierDigest: context.baseFrontierDigest,
    baseStateVectorDigest: context.baseStateVectorDigest,
    baseCanonicalStateDigest: context.baseCanonicalStateDigest,
    yjsUpdateDigest: yjsUpdateDigest(yjsUpdate),
    postStateVectorDigest: stateVectorDigest(encodeStateVector(candidate)),
    postCanonicalStateDigest: canonicalStateDigest(IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest, canonicalState({ value: "preserved" })),
    actualWriteEvidenceDigest: actualWriteEvidenceDigest(evidence),
    typedIntentJcsByteLength: String(typedIntentJcs.byteLength),
    causalContextJcsByteLength: String(causalContextJcs.byteLength),
    baseStateVectorByteLength: String(baseStateVector.byteLength),
    yjsUpdateByteLength: String(yjsUpdate.byteLength),
    actualWriteEvidenceJcsByteLength: String(actualWriteEvidenceJcs.byteLength),
    protocolDigest,
    ownerSchemaDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest,
    canonicalizerDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.canvasCanonicalizerDigest,
    validationArtifactSetDigest: context.validationArtifactSetDigest,
    signerAuthorityKind: signerAuthority.kind,
    signerAuthorityDigest: causalSignerAuthorityDigest(signerAuthority),
  })
  const headerJcs = encodeRestrictedJcs({
    format: "convax.causal-edit-frame",
    core,
    coreDigest: structuredDigest(KERNEL_DIGEST_DOMAINS.causalEditCore, core),
    replicaSignature: SIGNATURE,
  })
  const payload = encodeCausalPayload({ typedIntentJcs, causalContextJcs, baseStateVector, yjsUpdate, actualWriteEvidenceJcs })
  const frame = new Uint8Array(88 + headerJcs.byteLength + payload.byteLength)
  frame.set(new TextEncoder().encode("CVXCOLL"))
  const view = new DataView(frame.buffer)
  view.setUint16(8, 1, false)
  view.setUint8(10, 1)
  view.setUint32(12, headerJcs.byteLength, false)
  view.setBigUint64(16, BigInt(payload.byteLength), false)
  frame.set(hexToBytes(ordinarySha256(headerJcs)), 24)
  frame.set(hexToBytes(ordinarySha256(payload)), 56)
  frame.set(headerJcs, 88)
  frame.set(payload, 88 + headerJcs.byteLength)
  base.destroy()
  candidate.destroy()
  return frame
}

function canonicalState(root: Record<string, unknown>): Uint8Array {
  return encodeRestrictedJcs({ format: "convax.canvas-canonical-state", root })
}
