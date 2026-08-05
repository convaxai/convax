import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint64V2,
} from "./codecs"
import { ordinarySha256V2 } from "./digest"
import { encodeRestrictedJcsV2 } from "./jcs"
import { causalFrontierDigestV2 } from "./causal"
import { encodeStateVectorV2, stateVectorDigestV2, yjsUpdateDigestV2 } from "./yjs-codec"
import { actualWriteEvidenceDigestV2 } from "./frame"
import { causalSignerAuthorityDigestV3, type LocalProjectOwnerSignerAuthorityV3 } from "./successor-authority"
import {
  causalContextDigestV3,
  causalEditCoreDigestV3,
  createCandidateSuccessorProtocolAuthorityV3,
  decodeCausalEditFrameV3,
  decodeSelectedCausalEditFrame,
  encodeCausalEditFrameV3,
  parseCausalContextV3,
  parseCausalEditCoreV3,
} from "./successor-frame"
import { loadVerifiedTestAuthorityV2 } from "./authority.test-support"

const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill)
const digest = (fill: number) => parseDigestV2(ordinarySha256V2(bytes(3, fill)))
const PROJECT = parseProjectIdV2("project")
const EPOCH = parseId128V2(encodeBase64urlV2(bytes(16, 2)))
const SHARD = parseId128V2(encodeBase64urlV2(bytes(16, 3)))
const ACTOR = parseActorIdV2(encodeBase64urlV2(bytes(32, 4)))
const REPLICA = parseReplicaIdV2("replica_00000001")
const CANVAS = parseCanvasIdV2(`cv_${"6".repeat(64)}`)
const PROTOCOL = digest(7)
const SCHEMA = digest(8)
const CANONICALIZER = digest(9)
const ARTIFACTS = digest(10)
const OWNER_BINDING = digest(11)
const OWNER_AUTH = digest(12)
const scope = { projectId: PROJECT, projectEpoch: EPOCH, docKind: "canvas" as const, docId: CANVAS, shardEpoch: SHARD }
const frontier = { format: "convax.causal-frontier/2" as const, heads: [] }
const authority: LocalProjectOwnerSignerAuthorityV3 = {
  kind: "local-project-owner",
  ownerKeyId: digest(13),
  replicaId: REPLICA,
  actorId: ACTOR,
  ownerBindingCoreDigest: OWNER_BINDING,
  ownerEditAuthorizationCoreDigest: OWNER_AUTH,
}

function fixture() {
  const vector = encodeStateVectorV2(new Y.Doc())
  const intentJcs = encodeRestrictedJcsV2({
    format: "convax.typed-intent/2",
    kind: "canvas.node.create",
    value: { id: "n1" },
  })
  const intentDigest = rawDigest("convax.typed-intent/3", intentJcs)
  const context = {
    format: "convax.causal-context/3" as const,
    scope,
    baseFrontier: frontier,
    baseFrontierDigest: causalFrontierDigestV2(frontier),
    baseStateVectorDigest: stateVectorDigestV2(vector),
    baseCanonicalStateDigest: digest(14),
    signerAuthority: authority,
    dependencies: [
      { kind: "local-owner-binding" as const, digest: OWNER_BINDING },
      { kind: "local-owner-edit-authorization" as const, digest: OWNER_AUTH },
    ],
    validationArtifactSetDigest: ARTIFACTS,
  }
  const contextJcs = encodeRestrictedJcsV2(context)
  const evidence = {
    format: "convax.actual-write-evidence/2" as const,
    scope,
    owner: "canvas" as const,
    ownerSchemaDigest: SCHEMA,
    intentDigest,
    changedPaths: [],
    writes: [],
  }
  const evidenceJcs = encodeRestrictedJcsV2(evidence)
  const update = new Uint8Array()
  const core = {
    format: "convax.causal-edit-core/3" as const,
    scope,
    actorId: ACTOR,
    actorSequence: parseUint64V2("1"),
    predecessorFrameDigest: digest(15),
    operationId: parseId128V2(encodeBase64urlV2(bytes(16, 16))),
    lamport: parseUint64V2("1"),
    intentKind: "canvas.node.create",
    intentDigest,
    causalContextDigest: causalContextDigestV3(context),
    baseFrontierDigest: context.baseFrontierDigest,
    baseStateVectorDigest: context.baseStateVectorDigest,
    baseCanonicalStateDigest: context.baseCanonicalStateDigest,
    yjsUpdateDigest: yjsUpdateDigestV2(update),
    postStateVectorDigest: stateVectorDigestV2(vector),
    postCanonicalStateDigest: digest(17),
    actualWriteEvidenceDigest: actualWriteEvidenceDigestV2(evidence),
    typedIntentJcsByteLength: parseUint64V2(String(intentJcs.byteLength)),
    causalContextJcsByteLength: parseUint64V2(String(contextJcs.byteLength)),
    baseStateVectorByteLength: parseUint64V2(String(vector.byteLength)),
    yjsUpdateByteLength: parseUint64V2("0"),
    actualWriteEvidenceJcsByteLength: parseUint64V2(String(evidenceJcs.byteLength)),
    protocolDigest: PROTOCOL,
    ownerSchemaDigest: SCHEMA,
    canonicalizerDigest: CANONICALIZER,
    validationArtifactSetDigest: ARTIFACTS,
    signerAuthorityKind: authority.kind,
    signerAuthorityDigest: causalSignerAuthorityDigestV3(authority),
  }
  const header = {
    format: "convax.causal-edit-frame/3" as const,
    core,
    coreDigest: causalEditCoreDigestV3(core, PROTOCOL),
    replicaSignature: parseSignatureV2(encodeBase64urlV2(bytes(64, 18))),
  }
  return {
    header,
    sections: {
      typedIntentJcs: intentJcs,
      causalContextJcs: contextJcs,
      baseStateVector: vector,
      yjsUpdate: update,
      actualWriteEvidenceJcs: evidenceJcs,
    },
  }
}

describe("non-production CVXCOLL3 candidate codec", () => {
  test("round-trips a stable bounded golden and rejects every sampled tamper", () => {
    const gate = createCandidateSuccessorProtocolAuthorityV3(PROTOCOL),
      input = fixture(),
      encoded = encodeCausalEditFrameV3(gate, input)
    expect(new TextDecoder().decode(encoded.subarray(0, 8))).toBe("CVXCOLL3")
    expect(ordinarySha256V2(encoded)).toBe(
      parseDigestV2("97e58b42f2ca147cdd546451a55a4c14b61570619896f34bd8f46e348ab99795"),
    )
    expect(decodeCausalEditFrameV3(gate, encoded).header.core.signerAuthorityKind).toBe("local-project-owner")
    for (const offset of [0, 11, 30, encoded.length - 1]) {
      const tampered = Uint8Array.from(encoded)
      tampered[offset] ^= 1
      expect(() => decodeCausalEditFrameV3(gate, tampered)).toThrow()
    }
  })

  test("rejects cross-kind, missing, extra, unsorted, duplicate, wildcard and nullable predecessor shapes", () => {
    const { header, sections } = fixture(),
      context = JSON.parse(new TextDecoder().decode(sections.causalContextJcs))
    expect(() =>
      parseCausalContextV3({ ...context, signerAuthority: { ...context.signerAuthority, memberId: "x" } }),
    ).toThrow()
    expect(() => parseCausalContextV3({ ...context, dependencies: context.dependencies.slice(1) })).toThrow()
    expect(() => parseCausalContextV3({ ...context, dependencies: [...context.dependencies].reverse() })).toThrow()
    expect(() =>
      parseCausalContextV3({ ...context, dependencies: [...context.dependencies, context.dependencies[1]] }),
    ).toThrow()
    expect(() => parseCausalEditCoreV3({ ...header.core, predecessorFrameDigest: null }, PROTOCOL)).toThrow()
    expect(() => parseCausalEditCoreV3({ ...header.core, unexpected: true }, PROTOCOL)).toThrow()
  })

  test("production dispatch accepts verified V2 only and rejects V3 before inner parsing", async () => {
    const gate = createCandidateSuccessorProtocolAuthorityV3(PROTOCOL),
      encoded = encodeCausalEditFrameV3(gate, fixture())
    const verifiedV2 = await loadVerifiedTestAuthorityV2()
    expect(() => decodeSelectedCausalEditFrame(encoded, verifiedV2)).toThrow("unavailable")
    const unknown = Uint8Array.from(encoded)
    unknown.set(new TextEncoder().encode("CVXCOLL9"))
    expect(() => decodeSelectedCausalEditFrame(unknown, verifiedV2)).toThrow("Unknown")
    expect(() => decodeSelectedCausalEditFrame(new Uint8Array(2 * 1024 * 1024 + 1), verifiedV2)).toThrow("outer bound")
  })
})

function rawDigest(domain: string, value: Uint8Array) {
  const prefix = new TextEncoder().encode(domain),
    input = new Uint8Array(prefix.length + 1 + value.length)
  input.set(prefix)
  input[prefix.length] = 0
  input.set(value, prefix.length + 1)
  return ordinarySha256V2(input)
}
