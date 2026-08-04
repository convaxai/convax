import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseUint32V2,
  parseUint64V2,
} from "./codecs"
import { PINNED_AUTHORITY_IDENTITIES_V2, PROTOCOL_SCHEMA_ARTIFACTS_V2 } from "./constants"
import type {
  RemoteIngressCompletedStagingEvidenceV2,
  RemoteIngressImmutableObjectPersistencePortV2,
  RemoteIngressQuotaReservationPortEvidenceV2,
  RemoteIngressReservationPortEvidenceV2,
  RemoteIngressStagingPersistencePortV2,
  ReserveRemoteIngressRequestV2,
} from "./contracts"
import { ordinarySha256V2 } from "./digest"
import {
  assertRemoteImmutableIngressObjectReceiptV2,
  assertRemoteTransferAttemptBindingV2,
  createRemoteIngressCapabilityFactoryV2,
} from "./remote-ingress"
import { loadVerifiedTestAuthorityV2 } from "./authority.test-support"

const bytes = new TextEncoder().encode("hello")
const id = (fill: number) => parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => fill)))
const digest = (value: string) => ordinarySha256V2(new TextEncoder().encode(value))
const stableKey = Object.freeze({
  projectId: parseProjectIdV2("project"),
  projectEpoch: id(1),
  sourceMemberId: parseMemberIdV2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => 2))),
  transferId: id(3),
})

function request(): ReserveRemoteIngressRequestV2 {
  return Object.freeze({
    stableKey,
    exactManifestDigest: digest("manifest"),
    signedOfferEvidenceClosureRecordDigest: digest("offer"),
    kind: "causal-frame",
    scope: null,
    subjectDigest: digest("subject"),
    ordinarySha256: ordinarySha256V2(bytes),
    declaredByteLength: parseUint64V2(String(bytes.byteLength)),
    accountedAdmissionByteLength: parseUint64V2(String(bytes.byteLength)),
    chunkBytes: "4096",
    chunkCount: parseUint32V2("1"),
  })
}

function quota(input = request()): RemoteIngressQuotaReservationPortEvidenceV2 {
  return Object.freeze({
    limitsDigest: digestLiteral(PINNED_AUTHORITY_IDENTITIES_V2.limitsDigest),
    stableKey,
    exactManifestDigest: input.exactManifestDigest,
    kind: input.kind,
    sourceMemberId: stableKey.sourceMemberId,
    chargedClosureCount: "1",
    accountedAdmissionByteLength: input.accountedAdmissionByteLength,
    resultingProjectChargedClosureCount: parseUint32V2("1"),
    resultingProjectAccountedAdmissionByteLength: parseUint64V2(String(bytes.byteLength)),
    resultingSourceMemberChargedClosureCount: parseUint32V2("1"),
    resultingSourceMemberAccountedAdmissionByteLength: parseUint64V2(String(bytes.byteLength)),
    admissionEpochHeadRecordDigest: digest("epoch-head"),
    admissionTransitionRecordDigest: digest("transition"),
    memberQuotaRecordDigest: digest("member-quota"),
  })
}

function reservationEvidence(input = request()): RemoteIngressReservationPortEvidenceV2 {
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

function completedEvidence(input = request()): RemoteIngressCompletedStagingEvidenceV2 {
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

function ports(overrides?: { quota?: RemoteIngressQuotaReservationPortEvidenceV2 }) {
  let cursorClosed = 0
  let read = 0
  const staging: RemoteIngressStagingPersistencePortV2 = {
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
              chunkIndex: parseUint32V2("0"),
              byteOffset: parseUint64V2("0"),
              exactByteLength: parseUint32V2(String(bytes.byteLength)),
              exactChunkSha256: ordinarySha256V2(bytes),
              exactChunkBytes: bytes,
            }
            return { status: "complete" as const, exactByteLength: parseUint64V2(String(bytes.byteLength)), ordinarySha256: ordinarySha256V2(bytes) }
          },
          closePersistedCursor() { cursorClosed += 1 },
        },
      }
    },
  }
  const immutable: RemoteIngressImmutableObjectPersistencePortV2 = {
    async putImmutableCompletedRemoteIngress(validated) {
      const evidence = validated.completed.evidence
      return { status: "durable", evidence: { ...evidence, immutableObjectDigest: digest("immutable") } }
    },
  }
  return { staging, immutable, cursorClosed: () => cursorClosed }
}

describe("R5 remote-ingress capability chain", () => {
  test("mints reservation/completion capabilities, enforces one sequential cursor and defensive chunks", async () => {
    const authority = await loadVerifiedTestAuthorityV2()
    const adapters = ports()
    const factory = createRemoteIngressCapabilityFactoryV2(authority, adapters.staging, adapters.immutable)
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
    const authority = await loadVerifiedTestAuthorityV2()
    const over = { ...quota(), resultingSourceMemberChargedClosureCount: parseUint32V2("513") }
    const adapters = ports({ quota: over })
    const factory = createRemoteIngressCapabilityFactoryV2(authority, adapters.staging, adapters.immutable)
    await expect(factory.reserve(request())).rejects.toThrow("frozen caps")
  })

  test("requires owner validation before immutable durability and keeps attempt bindings non-structural", async () => {
    const authority = await loadVerifiedTestAuthorityV2()
    const adapters = ports()
    const factory = createRemoteIngressCapabilityFactoryV2(authority, adapters.staging, adapters.immutable)
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
      ownerArtifactDigest: digestLiteral(PROTOCOL_SCHEMA_ARTIFACTS_V2[1].artifactDigest),
    })
    const durable = await factory.putImmutable(validated)
    if (durable.status === "rejected") throw new Error(durable.code)
    expect(() => assertRemoteImmutableIngressObjectReceiptV2(durable.receipt)).not.toThrow()
    expect(() => assertRemoteImmutableIngressObjectReceiptV2({ ...durable.receipt })).toThrow("live immutable")
    const binding = factory.attemptBindings.bind({
      kind: request().kind,
      stableKey,
      projectId: stableKey.projectId,
      projectEpoch: stableKey.projectEpoch,
      sourceMemberId: stableKey.sourceMemberId,
      exactManifestDigest: request().exactManifestDigest,
      subjectDigest: request().subjectDigest,
    })
    expect(() => assertRemoteTransferAttemptBindingV2(binding, factory.attemptBindings)).not.toThrow()
    expect(() => assertRemoteTransferAttemptBindingV2({ ...binding }, factory.attemptBindings)).toThrow("live transfer-attempt")
  })
})

function digestLiteral(value: string) {
  return value as ReturnType<typeof digest>
}
