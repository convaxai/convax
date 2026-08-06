import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseUint32,
  parseUint64,
} from "./codecs"
import { CURRENT_PROTOCOL_IDENTITIES, PROTOCOL_SCHEMA_ARTIFACTS } from "./constants"
import type {
  RemoteIngressCompletedStagingEvidence,
  RemoteIngressImmutableObjectPersistencePort,
  RemoteIngressQuotaReservationPortEvidence,
  RemoteIngressReservationPortEvidence,
  RemoteIngressStagingPersistencePort,
  ReserveRemoteIngressRequest,
} from "./contracts"
import { ordinarySha256 } from "./digest"
import {
  assertRemoteImmutableIngressObjectReceipt,
  assertRemoteTransferAttemptBinding,
  createRemoteIngressCapabilityFactory,
} from "./remote-ingress"
import { loadVerifiedTestAuthority } from "./authority.test-support"

const bytes = new TextEncoder().encode("hello")
const id = (fill: number) => parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => fill)))
const digest = (value: string) => ordinarySha256(new TextEncoder().encode(value))
const stableKey = Object.freeze({
  projectId: parseProjectId("project"),
  projectEpoch: id(1),
  sourceMemberId: parseMemberId(encodeBase64url(Uint8Array.from({ length: 16 }, () => 2))),
  transferId: id(3),
})

function request(): ReserveRemoteIngressRequest {
  return Object.freeze({
    stableKey,
    exactManifestDigest: digest("manifest"),
    signedOfferEvidenceClosureRecordDigest: digest("offer"),
    kind: "causal-frame",
    scope: null,
    subjectDigest: digest("subject"),
    ordinarySha256: ordinarySha256(bytes),
    declaredByteLength: parseUint64(String(bytes.byteLength)),
    accountedAdmissionByteLength: parseUint64(String(bytes.byteLength)),
    chunkBytes: "4096",
    chunkCount: parseUint32("1"),
  })
}

function quota(input = request()): RemoteIngressQuotaReservationPortEvidence {
  return Object.freeze({
    limitsDigest: digestLiteral(CURRENT_PROTOCOL_IDENTITIES.limitsDigest),
    stableKey,
    exactManifestDigest: input.exactManifestDigest,
    kind: input.kind,
    sourceMemberId: stableKey.sourceMemberId,
    chargedClosureCount: "1",
    accountedAdmissionByteLength: input.accountedAdmissionByteLength,
    resultingProjectChargedClosureCount: parseUint32("1"),
    resultingProjectAccountedAdmissionByteLength: parseUint64(String(bytes.byteLength)),
    resultingSourceMemberChargedClosureCount: parseUint32("1"),
    resultingSourceMemberAccountedAdmissionByteLength: parseUint64(String(bytes.byteLength)),
    admissionEpochHeadRecordDigest: digest("epoch-head"),
    admissionTransitionRecordDigest: digest("transition"),
    memberQuotaRecordDigest: digest("member-quota"),
  })
}

function reservationEvidence(input = request()): RemoteIngressReservationPortEvidence {
  return Object.freeze({
    stableKey,
    exactManifestDigest: input.exactManifestDigest,
    signedOfferEvidenceClosureRecordDigest: input.signedOfferEvidenceClosureRecordDigest,
    reservationRecordDigest: digest("reservation"),
    currentChunkSetHeadRecordDigest: digest("chunk-head"),
    kind: input.kind,
    scope: input.scope,
    subjectDigest: input.subjectDigest,
    ordinarySha256: input.ordinarySha256,
    declaredByteLength: input.declaredByteLength,
    chunkBytes: input.chunkBytes,
    chunkCount: input.chunkCount,
    quota: quota(input),
  })
}

function completedEvidence(input = request()): RemoteIngressCompletedStagingEvidence {
  const reserved = reservationEvidence(input)
  return Object.freeze({
    stableKey,
    exactManifestDigest: reserved.exactManifestDigest,
    signedOfferEvidenceClosureRecordDigest: reserved.signedOfferEvidenceClosureRecordDigest,
    reservationRecordDigest: reserved.reservationRecordDigest,
    finalChunkSetHeadRecordDigest: digest("final-chunk-head"),
    durableChunkSetDigest: digest("chunk-set"),
    kind: reserved.kind,
    scope: reserved.scope,
    subjectDigest: reserved.subjectDigest,
    ordinarySha256: reserved.ordinarySha256,
    exactByteLength: reserved.declaredByteLength,
    chunkBytes: reserved.chunkBytes,
    chunkCount: reserved.chunkCount,
    quota: reserved.quota,
  })
}

function ports(overrides?: { quota?: RemoteIngressQuotaReservationPortEvidence }) {
  let cursorClosed = 0
  let read = 0
  const staging: RemoteIngressStagingPersistencePort = {
    async reserveRemoteIngress(input) {
      const evidence = { ...reservationEvidence(input), quota: overrides?.quota ?? quota(input) }
      return { status: "reserved", evidence }
    },
    async completeRemoteIngressStaging() {
      return { status: "complete", evidence: completedEvidence() }
    },
    async openRemoteIngressSequentialCursor() {
      return {
        status: "opened",
        handle: {
          async nextPersistedChunk() {
            if (read++ === 0) return {
              status: "chunk" as const,
              chunkIndex: parseUint32("0"),
              byteOffset: parseUint64("0"),
              exactByteLength: parseUint32(String(bytes.byteLength)),
              exactChunkSha256: ordinarySha256(bytes),
              exactChunkBytes: bytes,
            }
            return { status: "complete" as const, exactByteLength: parseUint64(String(bytes.byteLength)), ordinarySha256: ordinarySha256(bytes) }
          },
          closePersistedCursor() { cursorClosed += 1 },
        },
      }
    },
  }
  const immutable: RemoteIngressImmutableObjectPersistencePort = {
    async putImmutableCompletedRemoteIngress(validated) {
      const evidence = validated.completed.evidence
      return { status: "durable", evidence: { ...evidence, immutableObjectDigest: digest("immutable") } }
    },
  }
  return { staging, immutable, cursorClosed: () => cursorClosed }
}

describe("Remote-ingress capability chain", () => {
  test("mints reservation/completion capabilities, enforces one sequential cursor and defensive chunks", async () => {
    const authority = await loadVerifiedTestAuthority()
    const adapters = ports()
    const factory = createRemoteIngressCapabilityFactory(authority, adapters.staging, adapters.immutable)
    const reserved = await factory.reserve(request())
    if (reserved.status === "rejected") throw new Error(reserved.code)
    await expect(factory.complete({ ...reserved.receipt } as typeof reserved.receipt)).rejects.toThrow("structural")
    const completed = await factory.complete(reserved.receipt)
    if (completed.status === "rejected") throw new Error(completed.code)
    const cursor = await completed.completed.openSequentialCursor()
    await expect(completed.completed.openSequentialCursor()).rejects.toThrow("already open")
    const chunk = await cursor.next()
    if (chunk.status !== "chunk") throw new Error("chunk missing")
    expect(chunk.exactChunkBytes).toEqual(bytes)
    expect(chunk.exactChunkBytes).not.toBe(bytes)
    expect((await cursor.next()).status).toBe("complete")
    expect(adapters.cursorClosed()).toBe(1)
  })

  test("rejects quota cap +1 before minting a reservation receipt", async () => {
    const authority = await loadVerifiedTestAuthority()
    const over = { ...quota(), resultingSourceMemberChargedClosureCount: parseUint32("513") }
    const adapters = ports({ quota: over })
    const factory = createRemoteIngressCapabilityFactory(authority, adapters.staging, adapters.immutable)
    await expect(factory.reserve(request())).rejects.toThrow("frozen caps")
  })

  test("requires owner validation before immutable durability and keeps attempt bindings non-structural", async () => {
    const authority = await loadVerifiedTestAuthority()
    const adapters = ports()
    const factory = createRemoteIngressCapabilityFactory(authority, adapters.staging, adapters.immutable)
    const reserved = await factory.reserve(request())
    if (reserved.status === "rejected") throw new Error(reserved.code)
    const completed = await factory.complete(reserved.receipt)
    if (completed.status === "rejected") throw new Error(completed.code)
    const validated = factory.acceptOwnerValidation(completed.completed, {
      kind: completed.completed.evidence.kind,
      scope: null,
      subjectDigest: completed.completed.evidence.subjectDigest,
      ordinarySha256: completed.completed.evidence.ordinarySha256,
      exactByteLength: completed.completed.evidence.exactByteLength,
      protocolDigest: authority.protocolDigest,
      ownerArtifactDigest: digestLiteral(PROTOCOL_SCHEMA_ARTIFACTS[1].artifactDigest),
    })
    const durable = await factory.putImmutable(validated)
    if (durable.status === "rejected") throw new Error(durable.code)
    expect(() => assertRemoteImmutableIngressObjectReceipt(durable.receipt)).not.toThrow()
    expect(() => assertRemoteImmutableIngressObjectReceipt({ ...durable.receipt })).toThrow("live immutable")
    const binding = factory.attemptBindings.bind({
      kind: request().kind,
      stableKey,
      projectId: stableKey.projectId,
      projectEpoch: stableKey.projectEpoch,
      sourceMemberId: stableKey.sourceMemberId,
      exactManifestDigest: request().exactManifestDigest,
      subjectDigest: request().subjectDigest,
    })
    expect(() => assertRemoteTransferAttemptBinding(binding, factory.attemptBindings)).not.toThrow()
    expect(() => assertRemoteTransferAttemptBinding({ ...binding }, factory.attemptBindings)).toThrow("live transfer-attempt")
  })
})

function digestLiteral(value: string) {
  return value as ReturnType<typeof digest>
}
