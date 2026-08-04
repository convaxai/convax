import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { assertVerifiedProtocolAuthorityV2, type VerifiedProtocolAuthorityV2 } from "./authority"
import { assertByteLengthV2 } from "./binary"
import {
  ownerCanonicalizerDescriptorDigestV2,
  parseOwnerCanonicalizerDescriptorV2,
  validateOwnerCanonicalStateBytesV2,
} from "./canonicalizer"
import { causalFrontierDigestV2 } from "./causal"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parsePeerIdV2,
  parsePublicKeyV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint64V2,
  replicaIdToYjsClientIdV2,
} from "./codecs"
import {
  KERNEL_DIGEST_DOMAINS_V2,
  KERNEL_LIMITS_V2,
  PINNED_AUTHORITY_IDENTITIES_V2,
  PROTOCOL_SCHEMA_ARTIFACTS_V2,
} from "./constants"
import type { CausalEditCoreV2, DecodedCausalEditFrameV2 } from "./contracts"
import { createWebCryptoEd25519VerifierV2, verifyExactEd25519V2 } from "./crypto"
import { canonicalStateDigestV2, ordinarySha256V2, structuredDigestV2 } from "./digest"
import {
  actualWriteEvidenceDigestV2,
  causalContextDigestV2,
  decodeCausalEditFrameV2,
  encodeCausalEditFrameV2,
  encodeCausalPayloadV2,
  signCausalEditCoreV2,
  typedIntentDigestV2,
} from "./frame"
import { encodeRestrictedJcsV2 } from "./jcs"
import { assertKernelCapacityV2 } from "./limits"
import {
  parseActualWriteEvidenceV2,
  parseCausalContextV2,
  parseCausalFrontierV2,
  parseValidationArtifactSetV2,
} from "./parse"
import {
  encodeCandidateDeltaV2,
  encodeFullUpdateV2,
  encodeStateVectorV2,
  parseStateVectorV2,
  stateVectorDigestV2,
  validateCanonicalDeltaV2,
  yjsUpdateDigestV2,
} from "./yjs-codec"
import { loadVerifiedTestAuthorityV2 } from "./authority.test-support"

const encoder = new TextEncoder()
const ZERO_16 = parseId128V2(encodeBase64urlV2(new Uint8Array(16)))
const ACTOR = parseActorIdV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 1)))
const MEMBER = parseMemberIdV2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => 2)))
const REPLICA = parseReplicaIdV2("replica_00000001")
const SIGNATURE = parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0)))
const DIGEST_A = ordinarySha256V2(encoder.encode("a"))
const DIGEST_B = ordinarySha256V2(encoder.encode("b"))
const DIGEST_C = ordinarySha256V2(encoder.encode("c"))
const SCHEMA = parseDigestV2(PROTOCOL_SCHEMA_ARTIFACTS_V2[0].artifactDigest)
const CANONICAL_STATE_FORMAT = "convax.canvas-canonical-state/2" as const
const CANONICALIZER_DESCRIPTOR = Object.freeze({
  format: "convax.owner-canonicalizer-descriptor/2" as const,
  owner: "canvas" as const,
  ownerSchemaDigest: SCHEMA,
  canonicalStateFormat: CANONICAL_STATE_FORMAT,
  canonicalStateCodec: "restricted-jcs-utf8" as const,
  exactBytePolicy: "parse-reencode-byte-equal" as const,
  unknownStatePolicy: "reject" as const,
})
const CANONICALIZER = ownerCanonicalizerDescriptorDigestV2(CANONICALIZER_DESCRIPTOR)
const SCOPE = Object.freeze({ projectId: parseProjectIdV2("project"), projectEpoch: ZERO_16, docKind: "canvas" as const, docId: parseCanvasIdV2(`cv_${"1".repeat(64)}`), shardEpoch: ZERO_16 })

function authority(): Promise<VerifiedProtocolAuthorityV2> {
  return loadVerifiedTestAuthorityV2()
}

async function fixtureFrame(): Promise<DecodedCausalEditFrameV2> {
  const verified = await authority()
  const base = new Y.Doc()
  const candidate = new Y.Doc()
  Y.applyUpdate(candidate, encodeFullUpdateV2(base))
  candidate.clientID = 1
  candidate.getMap("root").set("value", "golden")
  const baseStateVector = encodeStateVectorV2(base)
  const yjsUpdate = encodeCandidateDeltaV2(candidate, baseStateVector)
  const typedIntentJcs = encodeRestrictedJcsV2({ format: "convax.typed-intent/2", kind: "set", value: "golden" })
  const frontier = Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) })
  const artifacts = parseValidationArtifactSetV2(requiredValidationArtifacts())
  const artifactDigest = structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.validationArtifactSet, artifacts)
  const context = Object.freeze({
    format: "convax.causal-context/2" as const,
    scope: SCOPE,
    baseFrontier: frontier,
    baseFrontierDigest: causalFrontierDigestV2(frontier),
    baseStateVectorDigest: stateVectorDigestV2(baseStateVector),
    baseCanonicalStateDigest: canonicalStateDigestV2(SCHEMA, canonicalStateBytes({})),
    signerAuthority: Object.freeze({
      memberId: MEMBER, replicaId: REPLICA, actorId: ACTOR, memberAuthorizationEpoch: ZERO_16,
      replicaAuthorizationEpoch: ZERO_16, membershipSnapshotDigest: DIGEST_A,
      replicaActorCredentialCoreDigest: DIGEST_B, replicaEditAuthorizationCoreDigest: DIGEST_C,
    }),
    dependencies: Object.freeze([
      Object.freeze({ kind: "membership-snapshot" as const, digest: DIGEST_A }),
      Object.freeze({ kind: "replica-actor-credential" as const, digest: DIGEST_B }),
      Object.freeze({ kind: "replica-edit-authorization" as const, digest: DIGEST_C }),
    ]),
    validationArtifactSetDigest: artifactDigest,
  })
  const causalContextJcs = encodeRestrictedJcsV2(context)
  const intentDigest = typedIntentDigestV2(typedIntentJcs)
  const evidence = parseActualWriteEvidenceV2({
    format: "convax.actual-write-evidence/2", scope: SCOPE, owner: "canvas", ownerSchemaDigest: SCHEMA,
    intentDigest, changedPaths: ["root/value"], writes: [{ entityKind: "root", entityId: "root", field: "value", valueDigest: ordinarySha256V2(encoder.encode("golden")) }],
  })
  const actualWriteEvidenceJcs = encodeRestrictedJcsV2(evidence)
  const canonical = validateCanonicalDeltaV2({ createDocument: () => new Y.Doc() }, encodeFullUpdateV2(base), baseStateVector, yjsUpdate, REPLICA)
  const core: CausalEditCoreV2 = Object.freeze({
    format: "convax.causal-edit-core/2", scope: SCOPE, actorId: ACTOR, actorSequence: parseUint64V2("1"),
    predecessorFrameDigest: null, operationId: ZERO_16, lamport: parseUint64V2("1"), intentKind: "set", intentDigest,
    causalContextDigest: causalContextDigestV2(context), baseFrontierDigest: context.baseFrontierDigest,
    baseStateVectorDigest: context.baseStateVectorDigest, baseCanonicalStateDigest: context.baseCanonicalStateDigest,
    yjsUpdateDigest: yjsUpdateDigestV2(yjsUpdate), postStateVectorDigest: stateVectorDigestV2(canonical.postStateVector),
    postCanonicalStateDigest: canonicalStateDigestV2(SCHEMA, canonicalStateBytes({ value: "golden" })),
    actualWriteEvidenceDigest: actualWriteEvidenceDigestV2(evidence), typedIntentJcsByteLength: parseUint64V2(String(typedIntentJcs.byteLength)),
    causalContextJcsByteLength: parseUint64V2(String(causalContextJcs.byteLength)), baseStateVectorByteLength: parseUint64V2(String(baseStateVector.byteLength)),
    yjsUpdateByteLength: parseUint64V2(String(yjsUpdate.byteLength)), actualWriteEvidenceJcsByteLength: parseUint64V2(String(actualWriteEvidenceJcs.byteLength)),
    protocolDigest: parseDigestV2(PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest), ownerSchemaDigest: SCHEMA, canonicalizerDigest: CANONICALIZER,
    validationArtifactSetDigest: artifactDigest, membershipSnapshotDigest: DIGEST_A, replicaActorCredentialCoreDigest: DIGEST_B,
    replicaEditAuthorizationCoreDigest: DIGEST_C,
  })
  const header = await signCausalEditCoreV2(verified, core, { sign: async () => SIGNATURE })
  const bytes = encodeCausalEditFrameV2(verified, { header, sections: { typedIntentJcs, causalContextJcs, baseStateVector, yjsUpdate, actualWriteEvidenceJcs } })
  canonical.document.destroy()
  candidate.destroy()
  base.destroy()
  return decodeCausalEditFrameV2(verified, bytes)
}

describe("frozen v2 authority and codecs", () => {
  test("installs only the live exact R5 authority identity", async () => {
    const verified = await authority()
    expect(verified.authorityId).toBe("collaboration-v10")
    expect(verified.revision).toBe(PINNED_AUTHORITY_IDENTITIES_V2.authorityRevision)
    expect(verified.protocolDigest).toBe(parseDigestV2(PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest))
    expect(() => assertVerifiedProtocolAuthorityV2({ ...verified })).toThrow("live selection")
  })

  test("maps ReplicaIdV2 directly and rejects zero/noncanonical spellings", () => {
    expect(replicaIdToYjsClientIdV2("replica_ffffffff")).toBe(0xffff_ffff)
    expect(() => parseReplicaIdV2("replica_00000000")).toThrow()
    expect(() => parseReplicaIdV2("replica_0000000A")).toThrow()
  })

  test("matches the platform SHA-256 implementation across padding boundaries", async () => {
    for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 127, 128]) {
      const input = Uint8Array.from({ length }, (_, index) => (index * 131 + length) & 0xff)
      const platform = new Uint8Array(await crypto.subtle.digest("SHA-256", input))
      expect(ordinarySha256V2(input)).toBe(parseDigestV2(Array.from(platform, (byte) => byte.toString(16).padStart(2, "0")).join("")))
    }
  })

  test("closes the one owner canonicalizer descriptor and its exact digest", () => {
    const emptySchemaDescriptor = { ...CANONICALIZER_DESCRIPTOR, ownerSchemaDigest: parseDigestV2("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") }
    expect(new TextDecoder().decode(encodeRestrictedJcsV2(emptySchemaDescriptor))).toBe('{"canonicalStateCodec":"restricted-jcs-utf8","canonicalStateFormat":"convax.canvas-canonical-state/2","exactBytePolicy":"parse-reencode-byte-equal","format":"convax.owner-canonicalizer-descriptor/2","owner":"canvas","ownerSchemaDigest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","unknownStatePolicy":"reject"}')
    expect(ownerCanonicalizerDescriptorDigestV2(emptySchemaDescriptor)).toBe(parseDigestV2("043f386edb26fd29d9eebffc5d5154dceb263df6451eb3b2228890ce455291cd"))
    expect(ownerCanonicalizerDescriptorDigestV2({ ...emptySchemaDescriptor })).toBe(ownerCanonicalizerDescriptorDigestV2(emptySchemaDescriptor))
    for (const changed of [
      { ...emptySchemaDescriptor, owner: "project-index" },
      { ...emptySchemaDescriptor, ownerSchemaDigest: DIGEST_A },
      { ...emptySchemaDescriptor, canonicalStateFormat: "convax.project-index-canonical-state/2" },
    ]) expect(ownerCanonicalizerDescriptorDigestV2(changed)).not.toBe(ownerCanonicalizerDescriptorDigestV2(emptySchemaDescriptor))
    for (const tampered of [
      { ...emptySchemaDescriptor, canonicalStateCodec: "other" },
      { ...emptySchemaDescriptor, exactBytePolicy: "other" },
      { ...emptySchemaDescriptor, unknownStatePolicy: "other" },
    ]) expect(() => ownerCanonicalizerDescriptorDigestV2(tampered)).toThrow()
    expect(() => parseOwnerCanonicalizerDescriptorV2({ ...emptySchemaDescriptor, extra: true })).toThrow()
    const { owner: _owner, ...missingOwner } = emptySchemaDescriptor
    expect(() => parseOwnerCanonicalizerDescriptorV2(missingOwner)).toThrow()
    const ownerBytes = canonicalStateBytes({ value: "stable" })
    const retained = validateOwnerCanonicalStateBytesV2(CANONICALIZER_DESCRIPTOR, ownerBytes)
    retained[0] ^= 1
    expect(validateOwnerCanonicalStateBytesV2(CANONICALIZER_DESCRIPTOR, ownerBytes)).toEqual(ownerBytes)
    expect(() => validateOwnerCanonicalStateBytesV2(CANONICALIZER_DESCRIPTOR, encodeRestrictedJcsV2({ format: "convax.other-state/2" }))).toThrow()
    expect(() => validateOwnerCanonicalStateBytesV2(CANONICALIZER_DESCRIPTOR, encoder.encode('{"value":1, "format":"convax.canvas-canonical-state/2"}'))).toThrow()
  })

  test("matches the frozen scalar, state-vector and Ed25519 negative corpus", async () => {
    const scalar = hex("000102030405060708090a0b0c0d0e0f")
    expect(encodeBase64urlV2(scalar)).toBe("AAECAwQFBgcICQoLDA0ODw")
    expect(parsePeerIdV2("peer_aaaqeayeaudaocajbifqydiob4")).toBe(parsePeerIdV2("peer_aaaqeayeaudaocajbifqydiob4"))
    expect(replicaIdToYjsClientIdV2("replica_00010203")).toBe(66_051)
    expect(encodeBase64urlV2(hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"))).toBe("11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo")
    const emptyVector = encodeStateVectorV2(new Y.Doc())
    expect(Array.from(emptyVector)).toEqual([0])
    expect(stateVectorDigestV2(emptyVector)).toBe(parseDigestV2("87e7210e576ca5c626cdd6c1b710f2a2dc8ebe2ae09d6e4dc32d74e98115d7ca"))
    const verifier = createWebCryptoEd25519VerifierV2()
    await expect(verifyExactEd25519V2(verifier, parsePublicKeyV2(encodeBase64urlV2(hex(`01${"00".repeat(31)}`))), SIGNATURE, new Uint8Array(32))).rejects.toThrow("small-order")
    await expect(verifyExactEd25519V2(verifier, parsePublicKeyV2(encodeBase64urlV2(hex(`ed${"ff".repeat(30)}7f`))), SIGNATURE, new Uint8Array(32))).rejects.toThrow("noncanonical")
    const highScalarSignature = parseSignatureV2(encodeBase64urlV2(new Uint8Array([...hex("e6ff0e4955925b2100e8ceebbd4ffe93e6fdfc71c226b33409a570d916254f72"), ...hex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010")])))
    await expect(verifyExactEd25519V2(verifier, parsePublicKeyV2(encodeBase64urlV2(hex("98519eadf35b995233b51b5cd23e9cc5a28b639b5a4af0ec903cb960d81b7819"))), highScalarSignature, hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"))).rejects.toThrow("noncanonical")
    const mixedSignature = parseSignatureV2(encodeBase64urlV2(hex("e6ff0e4955925b2100e8ceebbd4ffe93e6fdfc71c226b33409a570d916254f72506ba7f38360d99680bdd68d13fa7116c21961d4339692254d63ee177bfcd70a")))
    expect(await verifyExactEd25519V2(verifier, parsePublicKeyV2(encodeBase64urlV2(hex("98519eadf35b995233b51b5cd23e9cc5a28b639b5a4af0ec903cb960d81b7819"))), mixedSignature, hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"))).toBe(false)
  })
})

describe("CVXCOLL2 binary closure", () => {
  test("has a stable binary golden and rejects header/payload tampering", async () => {
    const verified = await authority()
    const frame = await fixtureFrame()
    expect(new TextDecoder().decode(frame.bytes.subarray(0, 8))).toBe("CVXCOLL2")
    expect(ordinarySha256V2(frame.bytes)).toBe(parseDigestV2("829f539ea33742c96eb89a5431541c0b7e84e8976e10d2c93065b8bb73b753e6"))
    for (const offset of [30, frame.bytes.length - 1]) {
      const tampered = Uint8Array.from(frame.bytes)
      tampered[offset] ^= 1
      expect(() => decodeCausalEditFrameV2(verified, tampered)).toThrow()
    }
  })

  test("enforces every kernel byte limit at exact and +1 boundaries", async () => {
    const maxima = [
      KERNEL_LIMITS_V2.causalHeaderJcsBytes,
      KERNEL_LIMITS_V2.typedIntentJcsBytes,
      KERNEL_LIMITS_V2.causalContextJcsBytes,
      KERNEL_LIMITS_V2.stateVectorBytes,
      KERNEL_LIMITS_V2.yjsUpdateBytes,
      KERNEL_LIMITS_V2.actualWriteEvidenceJcsBytes,
      KERNEL_LIMITS_V2.causalEnvelopeBytes,
    ]
    for (const maximum of maxima) {
      expect(() => assertByteLengthV2(new Uint8Array(maximum), 0, maximum, "exact-limit")).not.toThrow()
      expect(() => assertByteLengthV2(new Uint8Array(maximum + 1), 0, maximum, "+1-limit")).toThrow()
    }
    const minimalJcs = encodeRestrictedJcsV2("x")
    expect(() => encodeCausalPayloadV2({ typedIntentJcs: sizedTypedIntent(KERNEL_LIMITS_V2.typedIntentJcsBytes), causalContextJcs: minimalJcs, baseStateVector: encodeStateVectorV2(new Y.Doc()), yjsUpdate: new Uint8Array(), actualWriteEvidenceJcs: minimalJcs })).not.toThrow()
    expect(() => encodeCausalPayloadV2({ typedIntentJcs: sizedTypedIntent(KERNEL_LIMITS_V2.typedIntentJcsBytes + 1), causalContextJcs: minimalJcs, baseStateVector: encodeStateVectorV2(new Y.Doc()), yjsUpdate: new Uint8Array(), actualWriteEvidenceJcs: minimalJcs })).toThrow()
    const verified = await authority()
    expect(() => decodeCausalEditFrameV2(verified, new Uint8Array(KERNEL_LIMITS_V2.causalEnvelopeBytes + 1))).toThrow()
    const maximumVector = sizedCanonicalStateVector(KERNEL_LIMITS_V2.stateVectorBytes)
    expect(maximumVector.byteLength).toBe(KERNEL_LIMITS_V2.stateVectorBytes)
    expect(() => parseStateVectorV2(new Uint8Array(KERNEL_LIMITS_V2.stateVectorBytes + 1))).toThrow()
    const capacities = [
      ["pending-document", KERNEL_LIMITS_V2.pendingInboxFramesPerDocument, KERNEL_LIMITS_V2.pendingInboxBytesPerDocument],
      ["pending-remote-actor", KERNEL_LIMITS_V2.pendingInboxFramesPerRemoteActor, KERNEL_LIMITS_V2.pendingInboxBytesPerRemoteActor],
      ["local-outbox-document", KERNEL_LIMITS_V2.localOutboxFramesPerDocument, KERNEL_LIMITS_V2.localOutboxBytesPerDocument],
      ["retained-durable-acks", KERNEL_LIMITS_V2.retainedDurableAcksPerFrame, undefined],
      ["project-quarantine", KERNEL_LIMITS_V2.quarantineObjectsPerProject, KERNEL_LIMITS_V2.quarantineBytesPerProject],
      ["local-recovery-branch", 1, KERNEL_LIMITS_V2.localRecoveryBranchBytes],
    ] as const
    for (const [kind, items, byteMaximum] of capacities) {
      expect(() => assertKernelCapacityV2(kind, { items, bytes: byteMaximum })).not.toThrow()
      expect(() => assertKernelCapacityV2(kind, { items: items + 1, bytes: byteMaximum })).toThrow()
      if (byteMaximum !== undefined) expect(() => assertKernelCapacityV2(kind, { items, bytes: byteMaximum + 1 })).toThrow()
    }
  })
})

describe("v2 exact count caps", () => {
  test("accepts frontier/artifact/write exact maxima and rejects +1", () => {
    const heads = Array.from({ length: 257 }, (_, index) => ({
      format: "convax.causal-head-ref/2", actorId: parseActorIdV2(encodeBase64urlV2(actorBytes(index))), actorSequence: "1",
      frameDigest: ordinarySha256V2(actorBytes(index)), lamport: "1",
    }))
    expect(parseCausalFrontierV2({ format: "convax.causal-frontier/2", heads: heads.slice(0, 256) }).heads).toHaveLength(256)
    expect(() => parseCausalFrontierV2({ format: "convax.causal-frontier/2", heads })).toThrow()
    const artifacts = Array.from({ length: 65 }, (_, index) => ({ owner: "kernel", format: `artifact-${index.toString().padStart(3, "0")}`, artifactDigest: ordinarySha256V2(actorBytes(index)) }))
    expect(parseValidationArtifactSetV2({ format: "convax.validation-artifact-set/2", artifacts: artifacts.slice(0, 64) }).artifacts).toHaveLength(64)
    expect(() => parseValidationArtifactSetV2({ format: "convax.validation-artifact-set/2", artifacts })).toThrow()
    const paths = Array.from({ length: 2_049 }, (_, index) => `p${index.toString().padStart(4, "0")}`)
    const writes = paths.map((field, index) => ({ entityKind: "node", entityId: "id", field, valueDigest: ordinarySha256V2(actorBytes(index)) }))
    const base = { format: "convax.actual-write-evidence/2", scope: SCOPE, owner: "canvas", ownerSchemaDigest: SCHEMA, intentDigest: DIGEST_A }
    expect(parseActualWriteEvidenceV2({ ...base, changedPaths: paths.slice(0, 2_048), writes: writes.slice(0, 2_048) }).writes).toHaveLength(2_048)
    expect(() => parseActualWriteEvidenceV2({ ...base, changedPaths: paths, writes: writes.slice(0, 2_048) })).toThrow()
    expect(() => parseActualWriteEvidenceV2({ ...base, changedPaths: paths.slice(0, 2_048), writes })).toThrow()
    expect(() => parseActualWriteEvidenceV2({ ...base, changedPaths: ["x".repeat(512)], writes: [] })).not.toThrow()
    expect(() => parseActualWriteEvidenceV2({ ...base, changedPaths: ["x".repeat(513)], writes: [] })).toThrow()
    const dependencyExtras = Array.from({ length: 254 }, (_, index) => ({ kind: "authorization-mutation" as const, digest: ordinarySha256V2(encoder.encode(`dependency-${index}`)) }))
      .sort((left, right) => left.digest.localeCompare(right.digest))
    const mandatory = [
      { kind: "membership-snapshot" as const, digest: DIGEST_A },
      { kind: "replica-actor-credential" as const, digest: DIGEST_B },
      { kind: "replica-edit-authorization" as const, digest: DIGEST_C },
    ]
    const context = {
      format: "convax.causal-context/2", scope: SCOPE, baseFrontier: { format: "convax.causal-frontier/2", heads: [] },
      baseFrontierDigest: causalFrontierDigestV2({ format: "convax.causal-frontier/2", heads: [] }), baseStateVectorDigest: DIGEST_A,
      baseCanonicalStateDigest: DIGEST_B, signerAuthority: { memberId: MEMBER, replicaId: REPLICA, actorId: ACTOR, memberAuthorizationEpoch: ZERO_16, replicaAuthorizationEpoch: ZERO_16, membershipSnapshotDigest: DIGEST_A, replicaActorCredentialCoreDigest: DIGEST_B, replicaEditAuthorizationCoreDigest: DIGEST_C },
      validationArtifactSetDigest: DIGEST_C,
    }
    expect(parseCausalContextV2({ ...context, dependencies: [...dependencyExtras.slice(0, 253), ...mandatory] }).dependencies).toHaveLength(256)
    expect(() => parseCausalContextV2({ ...context, dependencies: [...dependencyExtras, ...mandatory] })).toThrow()
  })
})

function actorBytes(index: number): Uint8Array {
  const bytes = new Uint8Array(32)
  new DataView(bytes.buffer).setUint32(28, index + 1, false)
  return bytes
}

function sizedTypedIntent(size: number): Uint8Array {
  const base = encodeRestrictedJcsV2({ format: "convax.typed-intent/2", kind: "x", padding: "" })
  return encodeRestrictedJcsV2({ format: "convax.typed-intent/2", kind: "x", padding: "x".repeat(size - base.byteLength) })
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16))
}

function canonicalStateBytes(value: unknown): Uint8Array {
  return encodeRestrictedJcsV2({ format: CANONICAL_STATE_FORMAT, value })
}

function requiredValidationArtifacts() {
  return {
    format: "convax.validation-artifact-set/2" as const,
    artifacts: [
      { owner: "canvas" as const, format: PROTOCOL_SCHEMA_ARTIFACTS_V2[0].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS_V2[0].artifactDigest },
      { owner: "control-plane" as const, format: PROTOCOL_SCHEMA_ARTIFACTS_V2[2].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS_V2[2].artifactDigest },
      { owner: "kernel" as const, format: PROTOCOL_SCHEMA_ARTIFACTS_V2[1].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS_V2[1].artifactDigest },
      { owner: "project-index" as const, format: PROTOCOL_SCHEMA_ARTIFACTS_V2[3].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS_V2[3].artifactDigest },
    ],
  }
}

function sizedCanonicalStateVector(size: number) {
  let entries = 0
  let baseLength = 1
  let bodyLength = 0
  while (true) {
    const next = entries + 1
    const nextBodyLength = bodyLength + encodeVarUint(entries).byteLength + 1
    const nextLength = encodeVarUint(next).byteLength + nextBodyLength
    if (nextLength > size) break
    entries = next
    bodyLength = nextBodyLength
    baseLength = nextLength
  }
  const extraBytes = size - baseLength
  if (extraBytes > entries) throw new Error("Cannot construct exact state-vector fixture")
  const output = new Uint8Array(size)
  let offset = 0
  offset = write(output, offset, encodeVarUint(entries))
  for (let index = 0; index < entries; index += 1) {
    offset = write(output, offset, encodeVarUint(index))
    offset = write(output, offset, encodeVarUint(index < extraBytes ? 128 : 0))
  }
  if (offset !== size) throw new Error("State-vector fixture length mismatch")
  return parseStateVectorV2(output)
}

function encodeVarUint(value: number): Uint8Array {
  const output: number[] = []
  let remaining = value
  do {
    let byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) byte |= 0x80
    output.push(byte)
  } while (remaining > 0)
  return Uint8Array.from(output)
}

function write(target: Uint8Array, offset: number, source: Uint8Array): number {
  target.set(source, offset)
  return offset + source.byteLength
}
