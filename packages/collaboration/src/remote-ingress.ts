import { assertVerifiedProtocolAuthorityV2, type VerifiedProtocolAuthorityV2 } from "./authority"
import { cloneBytesV2 } from "./binary"
import {
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseUint32V2,
  parseUint64V2,
} from "./codecs"
import { PINNED_AUTHORITY_IDENTITIES_V2 } from "./constants"
import type {
  CompletedRemoteUpdateIngressV2,
  CompleteRemoteIngressStagingPortResultV2,
  FullyValidatedRemoteIngressStagingV2,
  PutImmutableCompletedRemoteIngressPortResultV2,
  RemoteImmutableIngressObjectReceiptV2,
  RemoteIngressByteCursorReadV2,
  RemoteIngressByteCursorV2,
  RemoteIngressCompletedStagingEvidenceV2,
  RemoteIngressImmutableObjectPersistencePortV2,
  RemoteIngressKindV2,
  RemoteIngressOwnerValidationEvidenceV2,
  RemoteIngressReservationReceiptV2,
  RemoteIngressStagingPersistencePortV2,
  RemoteTransferAttemptBindingFactoryV2,
  RemoteTransferAttemptBindingV2,
  ReserveRemoteIngressPortResultV2,
  ReserveRemoteIngressRequestV2,
  StableRemoteTransferKeyV2,
  UpdateIngressChunkBytesV2,
} from "./contracts"
import { ordinarySha256V2 } from "./digest"
import { CollaborationKernelErrorV2 } from "./errors"
import { encodeRestrictedJcsV2 } from "./jcs"
import { parseDocumentScopeV2 } from "./parse"

const TOKEN = /^[a-z][a-z0-9-]{0,127}$/u
const MAX_PROJECT_OBJECTS = 8192n
const MAX_PROJECT_BYTES = 536_870_912n
const MAX_MEMBER_OBJECTS = 512n
const MAX_MEMBER_BYTES = 134_217_728n

export type ReserveRemoteIngressCapabilityResultV2 =
  | Readonly<{ status: "reserved"; receipt: RemoteIngressReservationReceiptV2 }>
  | Exclude<ReserveRemoteIngressPortResultV2, { status: "reserved" }>

export type CompleteRemoteIngressCapabilityResultV2<K extends RemoteIngressKindV2> =
  | Readonly<{ status: "complete"; completed: CompletedRemoteUpdateIngressV2<K> }>
  | Exclude<CompleteRemoteIngressStagingPortResultV2, { status: "complete" }>

export type PutImmutableRemoteIngressCapabilityResultV2<K extends RemoteIngressKindV2> =
  | Readonly<{ status: "durable"; receipt: RemoteImmutableIngressObjectReceiptV2<K> }>
  | Exclude<PutImmutableCompletedRemoteIngressPortResultV2<K>, { status: "durable" }>

export interface RemoteIngressCapabilityFactoryV2 {
  reserve(request: ReserveRemoteIngressRequestV2): Promise<ReserveRemoteIngressCapabilityResultV2>
  complete<K extends RemoteIngressKindV2>(
    reservation: RemoteIngressReservationReceiptV2 & { readonly kind: K },
  ): Promise<CompleteRemoteIngressCapabilityResultV2<K>>
  acceptOwnerValidation<K extends RemoteIngressKindV2>(
    completed: CompletedRemoteUpdateIngressV2<K>,
    evidence: RemoteIngressOwnerValidationEvidenceV2<K>,
  ): FullyValidatedRemoteIngressStagingV2<K>
  putImmutable<K extends RemoteIngressKindV2>(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
  ): Promise<PutImmutableRemoteIngressCapabilityResultV2<K>>
  readonly attemptBindings: RemoteTransferAttemptBindingFactoryV2
  dispose(): void
}

interface ReservationRecordV2 {
  readonly factory: object
  readonly request: ReserveRemoteIngressRequestV2
}

interface CompletedRecordV2 {
  readonly factory: object
  readonly reservation: RemoteIngressReservationReceiptV2
  readonly evidence: RemoteIngressCompletedStagingEvidenceV2
  cursorOpen: boolean
}

interface ValidatedRecordV2 {
  readonly factory: object
  readonly completed: CompletedRemoteUpdateIngressV2
  readonly evidence: RemoteIngressOwnerValidationEvidenceV2<RemoteIngressKindV2>
}

const liveFactories = new WeakSet<object>()
const reservations = new WeakMap<object, ReservationRecordV2>()
const completedIngresses = new WeakMap<object, CompletedRecordV2>()
const validatedIngresses = new WeakMap<object, ValidatedRecordV2>()
const immutableReceipts = new WeakMap<object, FactoryIdentityV2>()
const attemptBindingFactories = new WeakMap<object, FactoryIdentityV2>()
const attemptBindings = new WeakMap<object, FactoryIdentityV2>()

interface FactoryIdentityV2 {
  readonly isDisposed: () => boolean
}

export function createRemoteIngressCapabilityFactoryV2(
  authority: VerifiedProtocolAuthorityV2,
  staging: RemoteIngressStagingPersistencePortV2,
  immutable: RemoteIngressImmutableObjectPersistencePortV2,
): RemoteIngressCapabilityFactoryV2 {
  assertVerifiedProtocolAuthorityV2(authority)
  let disposed = false
  const identity: FactoryIdentityV2 = Object.freeze({ isDisposed: () => disposed })
  const attemptFactory = createAttemptBindingFactory(identity, () => disposed)
  const factory = Object.freeze({
    async reserve(requestValue: ReserveRemoteIngressRequestV2): Promise<ReserveRemoteIngressCapabilityResultV2> {
      requireLive()
      const request = normalizeReservationRequest(requestValue)
      const result = await staging.reserveRemoteIngress(request)
      if (result.status === "rejected") return result
      validateReservationEvidence(result.evidence, request)
      const receipt = Object.freeze(copyReservationEvidence(result.evidence)) as RemoteIngressReservationReceiptV2
      reservations.set(receipt, { factory: identity, request })
      return Object.freeze({ status: "reserved", receipt })
    },
    async complete<K extends RemoteIngressKindV2>(
      reservation: RemoteIngressReservationReceiptV2 & { readonly kind: K },
    ): Promise<CompleteRemoteIngressCapabilityResultV2<K>> {
      requireLive()
      const record = requireReservation(reservation, identity)
      const result = await staging.completeRemoteIngressStaging(reservation)
      if (result.status === "rejected") return result
      validateCompletedEvidence(result.evidence, reservation, record.request)
      const evidence = Object.freeze(copyCompletedEvidence(result.evidence)) as RemoteIngressCompletedStagingEvidenceV2 & { readonly kind: K }
      let completed!: CompletedRemoteUpdateIngressV2<K>
      completed = Object.freeze({
        evidence,
        openSequentialCursor: () => openCursor(staging, completed, identity),
      }) as CompletedRemoteUpdateIngressV2<K>
      completedIngresses.set(completed, { factory: identity, reservation, evidence, cursorOpen: false })
      return Object.freeze({ status: "complete", completed })
    },
    acceptOwnerValidation<K extends RemoteIngressKindV2>(
      completed: CompletedRemoteUpdateIngressV2<K>,
      evidenceValue: RemoteIngressOwnerValidationEvidenceV2<K>,
    ): FullyValidatedRemoteIngressStagingV2<K> {
      requireLive()
      const completedRecord = requireCompleted(completed, identity)
      const evidence = normalizeOwnerValidationEvidence(evidenceValue, completedRecord.evidence, authority)
      const validated = Object.freeze({ completed, ownerArtifactDigest: evidence.ownerArtifactDigest }) as FullyValidatedRemoteIngressStagingV2<K>
      validatedIngresses.set(validated, { factory: identity, completed, evidence })
      return validated
    },
    async putImmutable<K extends RemoteIngressKindV2>(
      validated: FullyValidatedRemoteIngressStagingV2<K>,
    ): Promise<PutImmutableRemoteIngressCapabilityResultV2<K>> {
      requireLive()
      const validation = requireValidated(validated, identity)
      const completedRecord = requireCompleted(validation.completed, identity)
      const result = await immutable.putImmutableCompletedRemoteIngress(validated)
      if (result.status === "rejected") return result
      validateImmutableEvidence(result.evidence, completedRecord.evidence)
      const receipt = Object.freeze({ ...result.evidence, stableKey: Object.freeze({ ...result.evidence.stableKey }), quota: copyQuota(result.evidence.quota) }) as RemoteImmutableIngressObjectReceiptV2<K>
      immutableReceipts.set(receipt, identity)
      return Object.freeze({ status: "durable", receipt })
    },
    attemptBindings: attemptFactory,
    dispose() {
      disposed = true
    },
  }) as RemoteIngressCapabilityFactoryV2
  liveFactories.add(factory)
  return factory

  function requireLive(): void {
    if (disposed) throw new CollaborationKernelErrorV2("disposed", "Remote-ingress capability factory is disposed")
  }
}

export function assertRemoteTransferAttemptBindingV2(
  binding: unknown,
  factory: RemoteTransferAttemptBindingFactoryV2,
): asserts binding is RemoteTransferAttemptBindingV2<RemoteIngressKindV2> {
  const identity = isObject(factory) ? attemptBindingFactories.get(factory) : undefined
  if (!isObject(binding) || !identity || identity.isDisposed() || identity !== attemptBindings.get(binding)) {
    invalid("A live transfer-attempt binding from the selected factory is required")
  }
}

export function assertRemoteImmutableIngressObjectReceiptV2(
  receipt: unknown,
): asserts receipt is RemoteImmutableIngressObjectReceiptV2<RemoteIngressKindV2> {
  const identity = isObject(receipt) ? immutableReceipts.get(receipt) : undefined
  if (!identity || identity.isDisposed()) invalid("A live immutable remote-ingress receipt is required")
}

async function openCursor(
  staging: RemoteIngressStagingPersistencePortV2,
  completed: CompletedRemoteUpdateIngressV2,
  identity: object,
): Promise<RemoteIngressByteCursorV2> {
  const record = requireCompleted(completed, identity)
  if (isFactoryIdentity(identity) && identity.isDisposed()) throw new CollaborationKernelErrorV2("disposed", "Remote-ingress capability factory is disposed")
  if (record.cursorOpen) invalid("Remote-ingress cursor is already open")
  record.cursorOpen = true
  const opened = await staging.openRemoteIngressSequentialCursor(record.evidence)
  if (opened.status === "rejected") {
    record.cursorOpen = false
    invalid(`Remote-ingress cursor rejected: ${opened.code}`)
  }
  let closed = false
  let expectedIndex = 0n
  let expectedOffset = 0n
  const expectedChunks = BigInt(record.evidence.chunkCount)
  const chunkCapacity = BigInt(record.evidence.chunkBytes)
  const handle = opened.handle
  const close = () => {
    if (closed) return
    closed = true
    record.cursorOpen = false
    handle.closePersistedCursor()
  }
  return Object.freeze({
    async next(): Promise<RemoteIngressByteCursorReadV2> {
      if (closed) invalid("Remote-ingress cursor is closed")
      try {
        const value = await handle.nextPersistedChunk()
        if (value.status === "complete") {
          if (
            expectedIndex !== expectedChunks
            || value.exactByteLength !== record.evidence.exactByteLength
            || value.ordinarySha256 !== record.evidence.ordinarySha256
            || expectedOffset !== BigInt(record.evidence.exactByteLength)
          ) invalid("Remote-ingress cursor completion mirrors mismatch")
          close()
          return Object.freeze({ ...value })
        }
        const bytes = cloneBytesV2(value.exactChunkBytes, "remote-ingress chunk")
        const length = BigInt(value.exactByteLength)
        if (
          BigInt(value.chunkIndex) !== expectedIndex
          || BigInt(value.byteOffset) !== expectedOffset
          || length !== BigInt(bytes.byteLength)
          || length < 1n
          || length > chunkCapacity
          || ordinarySha256V2(bytes) !== value.exactChunkSha256
          || expectedIndex >= expectedChunks
        ) invalid("Remote-ingress cursor chunk is non-contiguous or corrupt")
        expectedIndex += 1n
        expectedOffset += length
        if (expectedOffset > BigInt(record.evidence.exactByteLength)) invalid("Remote-ingress cursor exceeded declared bytes")
        return Object.freeze({ ...value, exactChunkBytes: bytes })
      } catch (error) {
        close()
        throw error
      }
    },
    close,
  }) as RemoteIngressByteCursorV2
}

function createAttemptBindingFactory(identity: FactoryIdentityV2, isDisposed: () => boolean): RemoteTransferAttemptBindingFactoryV2 {
  const factory = Object.freeze({
    bind<K extends RemoteIngressKindV2>(input: Parameters<RemoteTransferAttemptBindingFactoryV2["bind"]>[0] & { readonly kind: K }): RemoteTransferAttemptBindingV2<K> {
      if (isDisposed()) throw new CollaborationKernelErrorV2("disposed", "Transfer-attempt factory is disposed")
      requireToken(input.kind, "remote-ingress kind")
      const stableKey = normalizeStableKey(input.stableKey)
      if (
        stableKey.projectId !== parseProjectIdV2(input.projectId)
        || stableKey.projectEpoch !== parseId128V2(input.projectEpoch)
        || stableKey.sourceMemberId !== parseMemberIdV2(input.sourceMemberId)
      ) invalid("Transfer-attempt binding duplicates mismatch its stable key")
      const binding = Object.freeze({
        kind: input.kind,
        stableKey,
        projectId: stableKey.projectId,
        projectEpoch: stableKey.projectEpoch,
        sourceMemberId: stableKey.sourceMemberId,
        exactManifestDigest: parseDigestV2(input.exactManifestDigest),
        subjectDigest: parseDigestV2(input.subjectDigest),
      }) as RemoteTransferAttemptBindingV2<K>
      attemptBindings.set(binding, identity)
      return binding
    },
  }) as RemoteTransferAttemptBindingFactoryV2
  attemptBindingFactories.set(factory, identity)
  return factory
}

function normalizeReservationRequest(value: ReserveRemoteIngressRequestV2): ReserveRemoteIngressRequestV2 {
  requireToken(value.kind, "remote-ingress kind")
  const declared = BigInt(parseUint64V2(value.declaredByteLength))
  const accounted = BigInt(parseUint64V2(value.accountedAdmissionByteLength))
  const chunkBytes = parseChunkBytes(value.chunkBytes)
  const chunks = BigInt(parseUint32V2(value.chunkCount))
  if (accounted < declared) invalid("Remote-ingress accounted length is smaller than its declared bytes")
  const expectedChunks = declared === 0n ? 0n : (declared + BigInt(chunkBytes) - 1n) / BigInt(chunkBytes)
  if (chunks !== expectedChunks) invalid("Remote-ingress chunk count mismatches declared bytes")
  return Object.freeze({
    stableKey: normalizeStableKey(value.stableKey),
    exactManifestDigest: parseDigestV2(value.exactManifestDigest),
    signedOfferEvidenceClosureRecordDigest: parseDigestV2(value.signedOfferEvidenceClosureRecordDigest),
    kind: value.kind,
    scope: value.scope === null ? null : parseDocumentScopeV2(value.scope),
    subjectDigest: parseDigestV2(value.subjectDigest),
    ordinarySha256: parseDigestV2(value.ordinarySha256),
    declaredByteLength: parseUint64V2(value.declaredByteLength),
    accountedAdmissionByteLength: parseUint64V2(value.accountedAdmissionByteLength),
    chunkBytes,
    chunkCount: parseUint32V2(value.chunkCount),
  })
}

function validateReservationEvidence(evidence: import("./contracts").RemoteIngressReservationPortEvidenceV2, request: ReserveRemoteIngressRequestV2): void {
  if (
    !sameValue(evidence.stableKey, request.stableKey)
    || evidence.exactManifestDigest !== request.exactManifestDigest
    || evidence.signedOfferEvidenceClosureRecordDigest !== request.signedOfferEvidenceClosureRecordDigest
    || evidence.kind !== request.kind
    || !sameValue(evidence.scope, request.scope)
    || evidence.subjectDigest !== request.subjectDigest
    || evidence.ordinarySha256 !== request.ordinarySha256
    || evidence.declaredByteLength !== request.declaredByteLength
    || evidence.chunkBytes !== request.chunkBytes
    || evidence.chunkCount !== request.chunkCount
  ) invalid("Remote-ingress reservation evidence mirrors mismatch")
  parseDigestV2(evidence.reservationRecordDigest)
  parseDigestV2(evidence.currentChunkSetHeadRecordDigest)
  validateQuota(evidence.quota, request)
}

function validateCompletedEvidence(
  evidence: RemoteIngressCompletedStagingEvidenceV2,
  reservation: RemoteIngressReservationReceiptV2,
  request: ReserveRemoteIngressRequestV2,
): void {
  if (
    !sameValue(evidence.stableKey, reservation.stableKey)
    || evidence.exactManifestDigest !== reservation.exactManifestDigest
    || evidence.signedOfferEvidenceClosureRecordDigest !== reservation.signedOfferEvidenceClosureRecordDigest
    || evidence.reservationRecordDigest !== reservation.reservationRecordDigest
    || evidence.kind !== reservation.kind
    || !sameValue(evidence.scope, reservation.scope)
    || evidence.subjectDigest !== reservation.subjectDigest
    || evidence.ordinarySha256 !== reservation.ordinarySha256
    || evidence.exactByteLength !== reservation.declaredByteLength
    || evidence.chunkBytes !== reservation.chunkBytes
    || evidence.chunkCount !== reservation.chunkCount
    || !sameValue(evidence.quota, reservation.quota)
  ) invalid("Remote-ingress completion evidence mirrors mismatch")
  parseDigestV2(evidence.finalChunkSetHeadRecordDigest)
  parseDigestV2(evidence.durableChunkSetDigest)
  validateQuota(evidence.quota, request)
}

function normalizeOwnerValidationEvidence<K extends RemoteIngressKindV2>(
  value: RemoteIngressOwnerValidationEvidenceV2<K>,
  completed: RemoteIngressCompletedStagingEvidenceV2,
  authority: VerifiedProtocolAuthorityV2,
): RemoteIngressOwnerValidationEvidenceV2<K> {
  if (
    value.kind !== completed.kind
    || !sameValue(value.scope, completed.scope)
    || value.subjectDigest !== completed.subjectDigest
    || value.ordinarySha256 !== completed.ordinarySha256
    || value.exactByteLength !== completed.exactByteLength
    || value.protocolDigest !== authority.protocolDigest
    || !authority.artifactDigests.includes(value.ownerArtifactDigest)
  ) invalid("Remote-ingress owner validation evidence mirrors mismatch")
  return Object.freeze({ ...value })
}

function validateImmutableEvidence<K extends RemoteIngressKindV2>(
  evidence: import("./contracts").RemoteImmutableIngressObjectPortEvidenceV2<K>,
  completed: RemoteIngressCompletedStagingEvidenceV2,
): void {
  const comparable = {
    stableKey: evidence.stableKey,
    exactManifestDigest: evidence.exactManifestDigest,
    signedOfferEvidenceClosureRecordDigest: evidence.signedOfferEvidenceClosureRecordDigest,
    reservationRecordDigest: evidence.reservationRecordDigest,
    finalChunkSetHeadRecordDigest: evidence.finalChunkSetHeadRecordDigest,
    durableChunkSetDigest: evidence.durableChunkSetDigest,
    kind: evidence.kind,
    scope: evidence.scope,
    subjectDigest: evidence.subjectDigest,
    ordinarySha256: evidence.ordinarySha256,
    exactByteLength: evidence.exactByteLength,
    chunkBytes: completed.chunkBytes,
    chunkCount: completed.chunkCount,
    quota: evidence.quota,
  }
  if (!sameValue(comparable, completed)) invalid("Remote-ingress immutable-object evidence mirrors mismatch")
  parseDigestV2(evidence.immutableObjectDigest)
}

function validateQuota(quota: import("./contracts").RemoteIngressQuotaReservationPortEvidenceV2, request: ReserveRemoteIngressRequestV2): void {
  if (
    quota.limitsDigest !== PINNED_AUTHORITY_IDENTITIES_V2.limitsDigest
    || !sameValue(quota.stableKey, request.stableKey)
    || quota.exactManifestDigest !== request.exactManifestDigest
    || quota.kind !== request.kind
    || quota.sourceMemberId !== request.stableKey.sourceMemberId
    || quota.chargedClosureCount !== "1"
    || quota.accountedAdmissionByteLength !== request.accountedAdmissionByteLength
  ) invalid("Remote-ingress quota evidence mirrors mismatch")
  if (
    BigInt(parseUint32V2(quota.resultingProjectChargedClosureCount)) > MAX_PROJECT_OBJECTS
    || BigInt(parseUint64V2(quota.resultingProjectAccountedAdmissionByteLength)) > MAX_PROJECT_BYTES
    || BigInt(parseUint32V2(quota.resultingSourceMemberChargedClosureCount)) > MAX_MEMBER_OBJECTS
    || BigInt(parseUint64V2(quota.resultingSourceMemberAccountedAdmissionByteLength)) > MAX_MEMBER_BYTES
  ) invalid("Remote-ingress quota evidence exceeds the frozen caps")
  parseDigestV2(quota.admissionEpochHeadRecordDigest)
  parseDigestV2(quota.admissionTransitionRecordDigest)
  parseDigestV2(quota.memberQuotaRecordDigest)
}

function normalizeStableKey(value: StableRemoteTransferKeyV2): StableRemoteTransferKeyV2 {
  return Object.freeze({
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    sourceMemberId: parseMemberIdV2(value.sourceMemberId),
    transferId: parseId128V2(value.transferId),
  })
}

function copyReservationEvidence(value: import("./contracts").RemoteIngressReservationPortEvidenceV2) {
  return { ...value, stableKey: normalizeStableKey(value.stableKey), quota: copyQuota(value.quota) }
}

function copyCompletedEvidence(value: RemoteIngressCompletedStagingEvidenceV2) {
  return { ...value, stableKey: normalizeStableKey(value.stableKey), quota: copyQuota(value.quota) }
}

function copyQuota(value: import("./contracts").RemoteIngressQuotaReservationPortEvidenceV2) {
  return Object.freeze({ ...value, stableKey: normalizeStableKey(value.stableKey) })
}

function requireReservation(value: object, identity: object): ReservationRecordV2 {
  const record = reservations.get(value)
  if (!record || record.factory !== identity) invalid("Remote-ingress reservation receipt is structural, stale or cross-factory")
  return record
}

function requireCompleted(value: object, identity: object): CompletedRecordV2 {
  const record = completedIngresses.get(value)
  if (!record || record.factory !== identity) invalid("Completed remote ingress is structural, stale or cross-factory")
  return record
}

function requireValidated(value: object, identity: object): ValidatedRecordV2 {
  const record = validatedIngresses.get(value)
  if (!record || record.factory !== identity) invalid("Validated remote ingress is structural, stale or cross-factory")
  return record
}

function parseChunkBytes(value: string): UpdateIngressChunkBytesV2 {
  if (!["4096", "8192", "16384", "32768", "65536", "131072", "262144"].includes(value)) {
    invalid("Remote-ingress chunk size is invalid")
  }
  return value as UpdateIngressChunkBytesV2
}

function requireToken(value: string, label: string): void {
  if (!TOKEN.test(value) || value.normalize("NFC") !== value) invalid(`${label} is invalid`)
}

function sameValue(left: unknown, right: unknown): boolean {
  const decoder = new TextDecoder()
  return decoder.decode(encodeRestrictedJcsV2(left)) === decoder.decode(encodeRestrictedJcsV2(right))
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}

function isFactoryIdentity(value: object): value is FactoryIdentityV2 {
  return "isDisposed" in value && typeof value.isDisposed === "function"
}

function invalid(message: string): never {
  throw new CollaborationKernelErrorV2("invalid-codec", message)
}
