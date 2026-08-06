import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { assertCurrentProtocolAuthority, type CurrentProtocolAuthority } from "./authority"
import { assertByteLength } from "./binary"
import {
  ownerCanonicalizerDescriptorDigest,
  parseOwnerCanonicalizerDescriptor,
  validateOwnerCanonicalStateBytes,
} from "./canonicalizer"
import { causalFrontierDigest } from "./causal"
import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parsePeerId,
  parsePublicKey,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint64,
  replicaIdToYjsClientId,
} from "./codecs"
import {
  KERNEL_DIGEST_DOMAINS,
  KERNEL_LIMITS,
  CURRENT_PROTOCOL_IDENTITIES,
  PROTOCOL_SCHEMA_ARTIFACTS,
} from "./constants"
import type { CausalEditCore, DecodedCausalEditFrame } from "./contracts"
import { createWebCryptoEd25519Verifier, verifyExactEd25519 } from "./crypto"
import { canonicalStateDigest, ordinarySha256, structuredDigest } from "./digest"
import {
  actualWriteEvidenceDigest,
  causalContextDigest,
  decodeCausalEditFrame,
  encodeCausalEditFrame,
  encodeCausalPayload,
  signCausalEditCore,
  typedIntentDigest,
} from "./frame"
import { encodeRestrictedJcs } from "./jcs"
import { assertKernelCapacity } from "./limits"
import {
  parseActualWriteEvidence,
  parseCausalContext,
  parseCausalFrontier,
  parseValidationArtifactSet,
} from "./parse"
import {
  encodeCandidateDelta,
  encodeFullUpdate,
  encodeStateVector,
  parseStateVector,
  stateVectorDigest,
  validateCanonicalDelta,
  yjsUpdateDigest,
} from "./yjs-codec"
import { loadVerifiedTestAuthority } from "./authority.test-support"

const encoder = new TextEncoder()
const ZERO_16 = parseId128(encodeBase64url(new Uint8Array(16)))
const ACTOR = parseActorId(encodeBase64url(Uint8Array.from({ length: 32 }, () => 1)))
const MEMBER = parseMemberId(encodeBase64url(Uint8Array.from({ length: 16 }, () => 2)))
const REPLICA = parseReplicaId("replica_00000001")
const SIGNATURE = parseSignature(encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0)))
const DIGEST_A = ordinarySha256(encoder.encode("a"))
const DIGEST_B = ordinarySha256(encoder.encode("b"))
const DIGEST_C = ordinarySha256(encoder.encode("c"))
const SCHEMA = parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest)
const CANONICAL_STATE_FORMAT = "convax.canvas-canonical-state" as const
const CANONICALIZER_DESCRIPTOR = Object.freeze({
  format: "convax.owner-canonicalizer-descriptor" as const,
  owner: "canvas" as const,
  ownerSchemaDigest: SCHEMA,
  canonicalStateFormat: CANONICAL_STATE_FORMAT,
  canonicalStateCodec: "restricted-jcs-utf8" as const,
  exactBytePolicy: "parse-reencode-byte-equal" as const,
  unknownStatePolicy: "reject" as const,
})
const CANONICALIZER = ownerCanonicalizerDescriptorDigest(CANONICALIZER_DESCRIPTOR)
const SCOPE = Object.freeze({ projectId: parseProjectId("project"), projectEpoch: ZERO_16, docKind: "canvas" as const, docId: parseCanvasId(`cv_${"1".repeat(64)}`), shardEpoch: ZERO_16 })

function authority(): Promise<CurrentProtocolAuthority> {
  return loadVerifiedTestAuthority()
}

async function fixtureFrame(): Promise<DecodedCausalEditFrame> {
  const verified = await authority()
  const base = new Y.Doc()
  const candidate = new Y.Doc()
  Y.applyUpdate(candidate, encodeFullUpdate(base))
  candidate.clientID = 1
  candidate.getMap("root").set("value", "golden")
  const baseStateVector = encodeStateVector(base)
  const yjsUpdate = encodeCandidateDelta(candidate, baseStateVector)
  const typedIntentJcs = encodeRestrictedJcs({ format: "convax.typed-intent", kind: "set", value: "golden" })
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const artifacts = parseValidationArtifactSet(requiredValidationArtifacts())
  const artifactDigest = structuredDigest(KERNEL_DIGEST_DOMAINS.validationArtifactSet, artifacts)
  const context = Object.freeze({
    format: "convax.causal-context" as const,
    scope: SCOPE,
    baseFrontier: frontier,
    baseFrontierDigest: causalFrontierDigest(frontier),
    baseStateVectorDigest: stateVectorDigest(baseStateVector),
    baseCanonicalStateDigest: canonicalStateDigest(SCHEMA, canonicalStateBytes({})),
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
  const causalContextJcs = encodeRestrictedJcs(context)
  const intentDigest = typedIntentDigest(typedIntentJcs)
  const evidence = parseActualWriteEvidence({
    format: "convax.actual-write-evidence", scope: SCOPE, owner: "canvas", ownerSchemaDigest: SCHEMA,
    intentDigest, changedPaths: ["root/value"], writes: [{ entityKind: "root", entityId: "root", field: "value", valueDigest: ordinarySha256(encoder.encode("golden")) }],
  })
  const actualWriteEvidenceJcs = encodeRestrictedJcs(evidence)
  const canonical = validateCanonicalDelta({ createDocument: () => new Y.Doc() }, encodeFullUpdate(base), baseStateVector, yjsUpdate, REPLICA)
  const core: CausalEditCore = Object.freeze({
    format: "convax.causal-edit-core", scope: SCOPE, actorId: ACTOR, actorSequence: parseUint64("1"),
    predecessorFrameDigest: null, operationId: ZERO_16, lamport: parseUint64("1"), intentKind: "set", intentDigest,
    causalContextDigest: causalContextDigest(context), baseFrontierDigest: context.baseFrontierDigest,
    baseStateVectorDigest: context.baseStateVectorDigest, baseCanonicalStateDigest: context.baseCanonicalStateDigest,
    yjsUpdateDigest: yjsUpdateDigest(yjsUpdate), postStateVectorDigest: stateVectorDigest(canonical.postStateVector),
    postCanonicalStateDigest: canonicalStateDigest(SCHEMA, canonicalStateBytes({ value: "golden" })),
    actualWriteEvidenceDigest: actualWriteEvidenceDigest(evidence), typedIntentJcsByteLength: parseUint64(String(typedIntentJcs.byteLength)),
    causalContextJcsByteLength: parseUint64(String(causalContextJcs.byteLength)), baseStateVectorByteLength: parseUint64(String(baseStateVector.byteLength)),
    yjsUpdateByteLength: parseUint64(String(yjsUpdate.byteLength)), actualWriteEvidenceJcsByteLength: parseUint64(String(actualWriteEvidenceJcs.byteLength)),
    protocolDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest), ownerSchemaDigest: SCHEMA, canonicalizerDigest: CANONICALIZER,
    validationArtifactSetDigest: artifactDigest, membershipSnapshotDigest: DIGEST_A, replicaActorCredentialCoreDigest: DIGEST_B,
    replicaEditAuthorizationCoreDigest: DIGEST_C,
  })
  const header = await signCausalEditCore(verified, core, { sign: async () => SIGNATURE })
  const bytes = encodeCausalEditFrame(verified, { header, sections: { typedIntentJcs, causalContextJcs, baseStateVector, yjsUpdate, actualWriteEvidenceJcs } })
  canonical.document.destroy()
  candidate.destroy()
  base.destroy()
  return decodeCausalEditFrame(verified, bytes)
}

describe("current protocol authority and codecs", () => {
  test("installs only the live current authority identity", async () => {
    const verified = await authority()
    expect(verified.protocolDigest).toBe(parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest))
    expect(verified.artifactDigests).toHaveLength(4)
    expect(() => assertCurrentProtocolAuthority({ ...verified })).toThrow("live installation")
  })

  test("maps ReplicaId directly and rejects zero/noncanonical spellings", () => {
    expect(replicaIdToYjsClientId("replica_ffffffff")).toBe(0xffff_ffff)
    expect(() => parseReplicaId("replica_00000000")).toThrow()
    expect(() => parseReplicaId("replica_0000000A")).toThrow()
  })

  test("matches the platform SHA-256 implementation across padding boundaries", async () => {
    for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 127, 128]) {
      const input = Uint8Array.from({ length }, (_, index) => (index * 131 + length) & 0xff)
      const platform = new Uint8Array(await crypto.subtle.digest("SHA-256", input))
      expect(ordinarySha256(input)).toBe(parseDigest(Array.from(platform, (byte) => byte.toString(16).padStart(2, "0")).join("")))
    }
  })

  test("closes the one owner canonicalizer descriptor and its exact digest", () => {
    const emptySchemaDescriptor = { ...CANONICALIZER_DESCRIPTOR, ownerSchemaDigest: parseDigest("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") }
    expect(new TextDecoder().decode(encodeRestrictedJcs(emptySchemaDescriptor))).toBe('{"canonicalStateCodec":"restricted-jcs-utf8","canonicalStateFormat":"convax.canvas-canonical-state","exactBytePolicy":"parse-reencode-byte-equal","format":"convax.owner-canonicalizer-descriptor","owner":"canvas","ownerSchemaDigest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","unknownStatePolicy":"reject"}')
    expect(ownerCanonicalizerDescriptorDigest(emptySchemaDescriptor)).toBe(parseDigest("5779d138e8cb93127fee8fbf7c0d7007486a5f3df36585451762a9c8696ebfaa"))
    expect(ownerCanonicalizerDescriptorDigest({ ...emptySchemaDescriptor })).toBe(ownerCanonicalizerDescriptorDigest(emptySchemaDescriptor))
    for (const changed of [
      { ...emptySchemaDescriptor, owner: "project-index" },
      { ...emptySchemaDescriptor, ownerSchemaDigest: DIGEST_A },
      { ...emptySchemaDescriptor, canonicalStateFormat: "convax.project-index-canonical-state" },
    ]) expect(ownerCanonicalizerDescriptorDigest(changed)).not.toBe(ownerCanonicalizerDescriptorDigest(emptySchemaDescriptor))
    for (const tampered of [
      { ...emptySchemaDescriptor, canonicalStateCodec: "other" },
      { ...emptySchemaDescriptor, exactBytePolicy: "other" },
      { ...emptySchemaDescriptor, unknownStatePolicy: "other" },
    ]) expect(() => ownerCanonicalizerDescriptorDigest(tampered)).toThrow()
    expect(() => parseOwnerCanonicalizerDescriptor({ ...emptySchemaDescriptor, extra: true })).toThrow()
    const { owner: _owner, ...missingOwner } = emptySchemaDescriptor
    expect(() => parseOwnerCanonicalizerDescriptor(missingOwner)).toThrow()
    const ownerBytes = canonicalStateBytes({ value: "stable" })
    const retained = validateOwnerCanonicalStateBytes(CANONICALIZER_DESCRIPTOR, ownerBytes)
    retained[0] ^= 1
    expect(validateOwnerCanonicalStateBytes(CANONICALIZER_DESCRIPTOR, ownerBytes)).toEqual(ownerBytes)
    expect(() => validateOwnerCanonicalStateBytes(CANONICALIZER_DESCRIPTOR, encodeRestrictedJcs({ format: "convax.other-state" }))).toThrow()
    expect(() => validateOwnerCanonicalStateBytes(CANONICALIZER_DESCRIPTOR, encoder.encode('{"value":1, "format":"convax.canvas-canonical-state"}'))).toThrow()
  })

  test("matches the frozen scalar, state-vector and Ed25519 negative corpus", async () => {
    const scalar = hex("000102030405060708090a0b0c0d0e0f")
    expect(encodeBase64url(scalar)).toBe("AAECAwQFBgcICQoLDA0ODw")
    expect(parsePeerId("peer_aaaqeayeaudaocajbifqydiob4")).toBe(parsePeerId("peer_aaaqeayeaudaocajbifqydiob4"))
    expect(replicaIdToYjsClientId("replica_00010203")).toBe(66_051)
    expect(encodeBase64url(hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"))).toBe("11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo")
    const emptyVector = encodeStateVector(new Y.Doc())
    expect(Array.from(emptyVector)).toEqual([0])
    expect(stateVectorDigest(emptyVector)).toBe(parseDigest("e292d997898cbe962397c003466f384c738ee0f4cffa4dcb22601c3547147563"))
    const verifier = createWebCryptoEd25519Verifier()
    await expect(verifyExactEd25519(verifier, parsePublicKey(encodeBase64url(hex(`01${"00".repeat(31)}`))), SIGNATURE, new Uint8Array(32))).rejects.toThrow("small-order")
    await expect(verifyExactEd25519(verifier, parsePublicKey(encodeBase64url(hex(`ed${"ff".repeat(30)}7f`))), SIGNATURE, new Uint8Array(32))).rejects.toThrow("noncanonical")
    const highScalarSignature = parseSignature(encodeBase64url(new Uint8Array([...hex("e6ff0e4955925b2100e8ceebbd4ffe93e6fdfc71c226b33409a570d916254f72"), ...hex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010")])))
    await expect(verifyExactEd25519(verifier, parsePublicKey(encodeBase64url(hex("98519eadf35b995233b51b5cd23e9cc5a28b639b5a4af0ec903cb960d81b7819"))), highScalarSignature, hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"))).rejects.toThrow("noncanonical")
    const mixedSignature = parseSignature(encodeBase64url(hex("e6ff0e4955925b2100e8ceebbd4ffe93e6fdfc71c226b33409a570d916254f72506ba7f38360d99680bdd68d13fa7116c21961d4339692254d63ee177bfcd70a")))
    expect(await verifyExactEd25519(verifier, parsePublicKey(encodeBase64url(hex("98519eadf35b995233b51b5cd23e9cc5a28b639b5a4af0ec903cb960d81b7819"))), mixedSignature, hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"))).toBe(false)
  })
})

describe("CVXCOLL binary closure", () => {
  test("has a stable binary golden and rejects header/payload tampering", async () => {
    const verified = await authority()
    const frame = await fixtureFrame()
    const magic = frame.bytes.subarray(0, 8)
    expect(new TextDecoder().decode(magic.subarray(0, 7))).toBe("CVXCOLL")
    expect(magic[7]).toBe(0)
    expect(ordinarySha256(frame.bytes)).toBe(parseDigest("44270f5822614f18db7e9b5c48d1f3b2944a851bb3e498764e7f7770cc3f4066"))
    for (const offset of [30, frame.bytes.length - 1]) {
      const tampered = Uint8Array.from(frame.bytes)
      tampered[offset] ^= 1
      expect(() => decodeCausalEditFrame(verified, tampered)).toThrow()
    }
  })

  test("enforces every kernel byte limit at exact and +1 boundaries", async () => {
    const maxima = [
      KERNEL_LIMITS.causalHeaderJcsBytes,
      KERNEL_LIMITS.typedIntentJcsBytes,
      KERNEL_LIMITS.causalContextJcsBytes,
      KERNEL_LIMITS.stateVectorBytes,
      KERNEL_LIMITS.yjsUpdateBytes,
      KERNEL_LIMITS.actualWriteEvidenceJcsBytes,
      KERNEL_LIMITS.causalEnvelopeBytes,
    ]
    for (const maximum of maxima) {
      expect(() => assertByteLength(new Uint8Array(maximum), 0, maximum, "exact-limit")).not.toThrow()
      expect(() => assertByteLength(new Uint8Array(maximum + 1), 0, maximum, "+1-limit")).toThrow()
    }
    const minimalJcs = encodeRestrictedJcs("x")
    expect(() => encodeCausalPayload({ typedIntentJcs: sizedTypedIntent(KERNEL_LIMITS.typedIntentJcsBytes), causalContextJcs: minimalJcs, baseStateVector: encodeStateVector(new Y.Doc()), yjsUpdate: new Uint8Array(), actualWriteEvidenceJcs: minimalJcs })).not.toThrow()
    expect(() => encodeCausalPayload({ typedIntentJcs: sizedTypedIntent(KERNEL_LIMITS.typedIntentJcsBytes + 1), causalContextJcs: minimalJcs, baseStateVector: encodeStateVector(new Y.Doc()), yjsUpdate: new Uint8Array(), actualWriteEvidenceJcs: minimalJcs })).toThrow()
    const verified = await authority()
    expect(() => decodeCausalEditFrame(verified, new Uint8Array(KERNEL_LIMITS.causalEnvelopeBytes + 1))).toThrow()
    const maximumVector = sizedCanonicalStateVector(KERNEL_LIMITS.stateVectorBytes)
    expect(maximumVector.byteLength).toBe(KERNEL_LIMITS.stateVectorBytes)
    expect(() => parseStateVector(new Uint8Array(KERNEL_LIMITS.stateVectorBytes + 1))).toThrow()
    const capacities = [
      ["pending-document", KERNEL_LIMITS.pendingInboxFramesPerDocument, KERNEL_LIMITS.pendingInboxBytesPerDocument],
      ["pending-remote-actor", KERNEL_LIMITS.pendingInboxFramesPerRemoteActor, KERNEL_LIMITS.pendingInboxBytesPerRemoteActor],
      ["local-outbox-document", KERNEL_LIMITS.localOutboxFramesPerDocument, KERNEL_LIMITS.localOutboxBytesPerDocument],
      ["retained-durable-acks", KERNEL_LIMITS.retainedDurableAcksPerFrame, undefined],
      ["project-quarantine", KERNEL_LIMITS.quarantineObjectsPerProject, KERNEL_LIMITS.quarantineBytesPerProject],
      ["local-recovery-branch", 1, KERNEL_LIMITS.localRecoveryBranchBytes],
    ] as const
    for (const [kind, items, byteMaximum] of capacities) {
      expect(() => assertKernelCapacity(kind, { items, bytes: byteMaximum })).not.toThrow()
      expect(() => assertKernelCapacity(kind, { items: items + 1, bytes: byteMaximum })).toThrow()
      if (byteMaximum !== undefined) expect(() => assertKernelCapacity(kind, { items, bytes: byteMaximum + 1 })).toThrow()
    }
  })
})

describe("v2 exact count caps", () => {
  test("accepts frontier/artifact/write exact maxima and rejects +1", () => {
    const heads = Array.from({ length: 257 }, (_, index) => ({
      format: "convax.causal-head-ref", actorId: parseActorId(encodeBase64url(actorBytes(index))), actorSequence: "1",
      frameDigest: ordinarySha256(actorBytes(index)), lamport: "1",
    }))
    expect(parseCausalFrontier({ format: "convax.causal-frontier", heads: heads.slice(0, 256) }).heads).toHaveLength(256)
    expect(() => parseCausalFrontier({ format: "convax.causal-frontier", heads })).toThrow()
    const artifacts = Array.from({ length: 65 }, (_, index) => ({ owner: "kernel", format: `artifact-${index.toString().padStart(3, "0")}`, artifactDigest: ordinarySha256(actorBytes(index)) }))
    expect(parseValidationArtifactSet({ format: "convax.validation-artifact-set", artifacts: artifacts.slice(0, 64) }).artifacts).toHaveLength(64)
    expect(() => parseValidationArtifactSet({ format: "convax.validation-artifact-set", artifacts })).toThrow()
    const paths = Array.from({ length: 2_049 }, (_, index) => `p${index.toString().padStart(4, "0")}`)
    const writes = paths.map((field, index) => ({ entityKind: "node", entityId: "id", field, valueDigest: ordinarySha256(actorBytes(index)) }))
    const base = { format: "convax.actual-write-evidence", scope: SCOPE, owner: "canvas", ownerSchemaDigest: SCHEMA, intentDigest: DIGEST_A }
    expect(parseActualWriteEvidence({ ...base, changedPaths: paths.slice(0, 2_048), writes: writes.slice(0, 2_048) }).writes).toHaveLength(2_048)
    expect(() => parseActualWriteEvidence({ ...base, changedPaths: paths, writes: writes.slice(0, 2_048) })).toThrow()
    expect(() => parseActualWriteEvidence({ ...base, changedPaths: paths.slice(0, 2_048), writes })).toThrow()
    expect(() => parseActualWriteEvidence({ ...base, changedPaths: ["x".repeat(512)], writes: [] })).not.toThrow()
    expect(() => parseActualWriteEvidence({ ...base, changedPaths: ["x".repeat(513)], writes: [] })).toThrow()
    const dependencyExtras = Array.from({ length: 254 }, (_, index) => ({ kind: "authorization-mutation" as const, digest: ordinarySha256(encoder.encode(`dependency-${index}`)) }))
      .sort((left, right) => left.digest.localeCompare(right.digest))
    const mandatory = [
      { kind: "membership-snapshot" as const, digest: DIGEST_A },
      { kind: "replica-actor-credential" as const, digest: DIGEST_B },
      { kind: "replica-edit-authorization" as const, digest: DIGEST_C },
    ]
    const context = {
      format: "convax.causal-context", scope: SCOPE, baseFrontier: { format: "convax.causal-frontier", heads: [] },
      baseFrontierDigest: causalFrontierDigest({ format: "convax.causal-frontier", heads: [] }), baseStateVectorDigest: DIGEST_A,
      baseCanonicalStateDigest: DIGEST_B, signerAuthority: { memberId: MEMBER, replicaId: REPLICA, actorId: ACTOR, memberAuthorizationEpoch: ZERO_16, replicaAuthorizationEpoch: ZERO_16, membershipSnapshotDigest: DIGEST_A, replicaActorCredentialCoreDigest: DIGEST_B, replicaEditAuthorizationCoreDigest: DIGEST_C },
      validationArtifactSetDigest: DIGEST_C,
    }
    expect(parseCausalContext({ ...context, dependencies: [...dependencyExtras.slice(0, 253), ...mandatory] }).dependencies).toHaveLength(256)
    expect(() => parseCausalContext({ ...context, dependencies: [...dependencyExtras, ...mandatory] })).toThrow()
  })
})

function actorBytes(index: number): Uint8Array {
  const bytes = new Uint8Array(32)
  new DataView(bytes.buffer).setUint32(28, index + 1, false)
  return bytes
}

function sizedTypedIntent(size: number): Uint8Array {
  const base = encodeRestrictedJcs({ format: "convax.typed-intent", kind: "x", padding: "" })
  return encodeRestrictedJcs({ format: "convax.typed-intent", kind: "x", padding: "x".repeat(size - base.byteLength) })
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16))
}

function canonicalStateBytes(value: unknown): Uint8Array {
  return encodeRestrictedJcs({ format: CANONICAL_STATE_FORMAT, value })
}

function requiredValidationArtifacts() {
  return {
    format: "convax.validation-artifact-set" as const,
    artifacts: [
      { owner: "canvas" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[0].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest },
      { owner: "control-plane" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[2].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS[2].artifactDigest },
      { owner: "kernel" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[1].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS[1].artifactDigest },
      { owner: "project-index" as const, format: PROTOCOL_SCHEMA_ARTIFACTS[3].format, artifactDigest: PROTOCOL_SCHEMA_ARTIFACTS[3].artifactDigest },
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
  return parseStateVector(output)
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
