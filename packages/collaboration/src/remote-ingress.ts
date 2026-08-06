import { assertCurrentProtocolAuthority, type CurrentProtocolAuthority } from "./authority"
import { cloneBytes } from "./binary"
import {
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseUint32,
  parseUint64,
} from "./codecs"
import { CURRENT_PROTOCOL_IDENTITIES } from "./constants"
import type {
  CompletedRemoteUpdateIngress,
  CompleteRemoteIngressStagingPortResult,
  FullyValidatedRemoteIngressStaging,
  PutImmutableCompletedRemoteIngressPortResult,
  RemoteImmutableIngressObjectReceipt,
  RemoteIngressByteCursorRead,
  RemoteIngressByteCursor,
  RemoteIngressCompletedStagingEvidence,
  RemoteIngressImmutableObjectPersistencePort,
  RemoteIngressKind,
  RemoteIngressOwnerValidationEvidence,
  RemoteIngressReservationReceipt,
  RemoteIngressStagingPersistencePort,
  RemoteTransferAttemptBindingFactory,
  RemoteTransferAttemptBinding,
  ReserveRemoteIngressPortResult,
  ReserveRemoteIngressRequest,
  StableRemoteTransferKey,
  UpdateIngressChunkBytes,
} from "./contracts"
import { ordinarySha256 } from "./digest"
import { CollaborationKernelError } from "./errors"
import { encodeRestrictedJcs } from "./jcs"
import { parseDocumentScope } from "./parse"

const TOKEN = /^[a-z][a-z0-9-]{0,127}$/u
const MAX_PROJECT_OBJECTS = 8192n
const MAX_PROJECT_BYTES = 536_870_912n
const MAX_MEMBER_OBJECTS = 512n
const MAX_MEMBER_BYTES = 134_217_728n

export type ReserveRemoteIngressCapabilityResult =
  | Readonly<{ status: "reserved"; receipt: RemoteIngressReservationReceipt }>
  | Exclude<ReserveRemoteIngressPortResult, { status: "reserved" }>

export type CompleteRemoteIngressCapabilityResult<K extends RemoteIngressKind> =
  | Readonly<{ status: "complete"; completed: CompletedRemoteUpdateIngress<K> }>
  | Exclude<CompleteRemoteIngressStagingPortResult, { status: "complete" }>

export type PutImmutableRemoteIngressCapabilityResult<K extends RemoteIngressKind> =
  | Readonly<{ status: "durable"; receipt: RemoteImmutableIngressObjectReceipt<K> }>
  | Exclude<PutImmutableCompletedRemoteIngressPortResult<K>, { status: "durable" }>

export interface RemoteIngressCapabilityFactory {
  reserve(request: ReserveRemoteIngressRequest): Promise<ReserveRemoteIngressCapabilityResult>
  complete<K extends RemoteIngressKind>(
    reservation: RemoteIngressReservationReceipt & { readonly kind: K },
  ): Promise<CompleteRemoteIngressCapabilityResult<K>>
  acceptOwnerValidation<K extends RemoteIngressKind>(
    completed: CompletedRemoteUpdateIngress<K>,
    evidence: RemoteIngressOwnerValidationEvidence<K>,
  ): FullyValidatedRemoteIngressStaging<K>
  putImmutable<K extends RemoteIngressKind>(
    validated: FullyValidatedRemoteIngressStaging<K>,
  ): Promise<PutImmutableRemoteIngressCapabilityResult<K>>
  readonly attemptBindings: RemoteTransferAttemptBindingFactory
  dispose(): void
}

interface ReservationRecord {
  readonly factory: object
  readonly request: ReserveRemoteIngressRequest
}

interface CompletedRecord {
  readonly factory: object
  readonly reservation: RemoteIngressReservationReceipt
  readonly evidence: RemoteIngressCompletedStagingEvidence
  cursorOpen: boolean
}

interface ValidatedRecord {
  readonly factory: object
  readonly completed: CompletedRemoteUpdateIngress
  readonly evidence: RemoteIngressOwnerValidationEvidence<RemoteIngressKind>
}

const liveFactories = new WeakSet<object>()
const reservations = new WeakMap<object, ReservationRecord>()
const completedIngresses = new WeakMap<object, CompletedRecord>()
const validatedIngresses = new WeakMap<object, ValidatedRecord>()
const immutableReceipts = new WeakMap<object, FactoryIdentity>()
const attemptBindingFactories = new WeakMap<object, FactoryIdentity>()
const attemptBindings = new WeakMap<object, FactoryIdentity>()

interface FactoryIdentity {
  readonly isDisposed: () => boolean
}

export function createRemoteIngressCapabilityFactory(
  authority: CurrentProtocolAuthority,
  staging: RemoteIngressStagingPersistencePort,
  immutable: RemoteIngressImmutableObjectPersistencePort,
): RemoteIngressCapabilityFactory {
  assertCurrentProtocolAuthority(authority)
  let disposed = false
  const identity: FactoryIdentity = Object.freeze({ isDisposed: () => disposed })
  const attemptFactory = createAttemptBindingFactory(identity, () => disposed)
  const factory = Object.freeze({
    async reserve(requestValue: ReserveRemoteIngressRequest): Promise<ReserveRemoteIngressCapabilityResult> {
      requireLive()
      const request = normalizeReservationRequest(requestValue)
      const result = await staging.reserveRemoteIngress(request)
      if (result.status === "rejected") return result
      validateReservationEvidence(result.evidence, request)
      const receipt = Object.freeze(copyReservationEvidence(result.evidence)) as RemoteIngressReservationReceipt
      reservations.set(receipt, { factory: identity, request })
      return Object.freeze({ status: "reserved", receipt })
    },
    async complete<K extends RemoteIngressKind>(
      reservation: RemoteIngressReservationReceipt & { readonly kind: K },
    ): Promise<CompleteRemoteIngressCapabilityResult<K>> {
      requireLive()
      const record = requireReservation(reservation, identity)
      const result = await staging.completeRemoteIngressStaging(reservation)
      if (result.status === "rejected") return result
      validateCompletedEvidence(result.evidence, reservation, record.request)
      const evidence = Object.freeze(copyCompletedEvidence(result.evidence)) as RemoteIngressCompletedStagingEvidence & { readonly kind: K }
      let completed!: CompletedRemoteUpdateIngress<K>
      completed = Object.freeze({
        evidence,
        openSequentialCursor: () => openCursor(staging, completed, identity),
      }) as CompletedRemoteUpdateIngress<K>
      completedIngresses.set(completed, { factory: identity, reservation, evidence, cursorOpen: false })
      return Object.freeze({ status: "complete", completed })
    },
    acceptOwnerValidation<K extends RemoteIngressKind>(
      completed: CompletedRemoteUpdateIngress<K>,
      evidenceValue: RemoteIngressOwnerValidationEvidence<K>,
    ): FullyValidatedRemoteIngressStaging<K> {
      requireLive()
      const completedRecord = requireCompleted(completed, identity)
      const evidence = normalizeOwnerValidationEvidence(evidenceValue, completedRecord.evidence, authority)
      const validated = Object.freeze({ completed, ownerArtifactDigest: evidence.ownerArtifactDigest }) as FullyValidatedRemoteIngressStaging<K>
      validatedIngresses.set(validated, { factory: identity, completed, evidence })
      return validated
    },
    async putImmutable<K extends RemoteIngressKind>(
      validated: FullyValidatedRemoteIngressStaging<K>,
    ): Promise<PutImmutableRemoteIngressCapabilityResult<K>> {
      requireLive()
      const validation = requireValidated(validated, identity)
      const completedRecord = requireCompleted(validation.completed, identity)
      const result = await immutable.putImmutableCompletedRemoteIngress(validated)
      if (result.status === "rejected") return result
      validateImmutableEvidence(result.evidence, completedRecord.evidence)
      const receipt = Object.freeze({ ...result.evidence, stableKey: Object.freeze({ ...result.evidence.stableKey }), quota: copyQuota(result.evidence.quota) }) as RemoteImmutableIngressObjectReceipt<K>
      immutableReceipts.set(receipt, identity)
      return Object.freeze({ status: "durable", receipt })
    },
    attemptBindings: attemptFactory,
    dispose() {
      disposed = true
    },
  }) as RemoteIngressCapabilityFactory
  liveFactories.add(factory)
  return factory

  function requireLive(): void {
    if (disposed) throw new CollaborationKernelError("disposed", "Remote-ingress capability factory is disposed")
  }
}

export function assertRemoteTransferAttemptBinding(
  binding: unknown,
  factory: RemoteTransferAttemptBindingFactory,
): asserts binding is RemoteTransferAttemptBinding<RemoteIngressKind> {
  const identity = isObject(factory) ? attemptBindingFactories.get(factory) : undefined
  if (!isObject(binding) || !identity || identity.isDisposed() || identity !== attemptBindings.get(binding)) {
    invalid("A live transfer-attempt binding from the selected factory is required")
  }
}

export function assertRemoteImmutableIngressObjectReceipt(
  receipt: unknown,
): asserts receipt is RemoteImmutableIngressObjectReceipt<RemoteIngressKind> {
  const identity = isObject(receipt) ? immutableReceipts.get(receipt) : undefined
  if (!identity || identity.isDisposed()) invalid("A live immutable remote-ingress receipt is required")
}

async function openCursor(
  staging: RemoteIngressStagingPersistencePort,
  completed: CompletedRemoteUpdateIngress,
  identity: object,
): Promise<RemoteIngressByteCursor> {
  const record = requireCompleted(completed, identity)
  if (isFactoryIdentity(identity) && identity.isDisposed()) throw new CollaborationKernelError("disposed", "Remote-ingress capability factory is disposed")
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
    async next(): Promise<RemoteIngressByteCursorRead> {
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
        const bytes = cloneBytes(value.exactChunkBytes, "remote-ingress chunk")
        const length = BigInt(value.exactByteLength)
        if (
          BigInt(value.chunkIndex) !== expectedIndex
          || BigInt(value.byteOffset) !== expectedOffset
          || length !== BigInt(bytes.byteLength)
          || length < 1n
          || length > chunkCapacity
          || ordinarySha256(bytes) !== value.exactChunkSha256
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
  }) as RemoteIngressByteCursor
}

function createAttemptBindingFactory(identity: FactoryIdentity, isDisposed: () => boolean): RemoteTransferAttemptBindingFactory {
  const factory = Object.freeze({
    bind<K extends RemoteIngressKind>(input: Parameters<RemoteTransferAttemptBindingFactory["bind"]>[0] & { readonly kind: K }): RemoteTransferAttemptBinding<K> {
      if (isDisposed()) throw new CollaborationKernelError("disposed", "Transfer-attempt factory is disposed")
      requireToken(input.kind, "remote-ingress kind")
      const stableKey = normalizeStableKey(input.stableKey)
      if (
        stableKey.projectId !== parseProjectId(input.projectId)
        || stableKey.projectEpoch !== parseId128(input.projectEpoch)
        || stableKey.sourceMemberId !== parseMemberId(input.sourceMemberId)
      ) invalid("Transfer-attempt binding duplicates mismatch its stable key")
      const binding = Object.freeze({
        kind: input.kind,
        stableKey,
        projectId: stableKey.projectId,
        projectEpoch: stableKey.projectEpoch,
        sourceMemberId: stableKey.sourceMemberId,
        exactManifestDigest: parseDigest(input.exactManifestDigest),
        subjectDigest: parseDigest(input.subjectDigest),
      }) as RemoteTransferAttemptBinding<K>
      attemptBindings.set(binding, identity)
      return binding
    },
  }) as RemoteTransferAttemptBindingFactory
  attemptBindingFactories.set(factory, identity)
  return factory
}

function normalizeReservationRequest(value: ReserveRemoteIngressRequest): ReserveRemoteIngressRequest {
  requireToken(value.kind, "remote-ingress kind")
  const declared = BigInt(parseUint64(value.declaredByteLength))
  const accounted = BigInt(parseUint64(value.accountedAdmissionByteLength))
  const chunkBytes = parseChunkBytes(value.chunkBytes)
  const chunks = BigInt(parseUint32(value.chunkCount))
  if (accounted < declared) invalid("Remote-ingress accounted length is smaller than its declared bytes")
  const expectedChunks = declared === 0n ? 0n : (declared + BigInt(chunkBytes) - 1n) / BigInt(chunkBytes)
  if (chunks !== expectedChunks) invalid("Remote-ingress chunk count mismatches declared bytes")
  return Object.freeze({
    stableKey: normalizeStableKey(value.stableKey),
    exactManifestDigest: parseDigest(value.exactManifestDigest),
    signedOfferEvidenceClosureRecordDigest: parseDigest(value.signedOfferEvidenceClosureRecordDigest),
    kind: value.kind,
    scope: value.scope === null ? null : parseDocumentScope(value.scope),
    subjectDigest: parseDigest(value.subjectDigest),
    ordinarySha256: parseDigest(value.ordinarySha256),
    declaredByteLength: parseUint64(value.declaredByteLength),
    accountedAdmissionByteLength: parseUint64(value.accountedAdmissionByteLength),
    chunkBytes,
    chunkCount: parseUint32(value.chunkCount),
  })
}

function validateReservationEvidence(evidence: import("./contracts").RemoteIngressReservationPortEvidence, request: ReserveRemoteIngressRequest): void {
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
  parseDigest(evidence.reservationRecordDigest)
  parseDigest(evidence.currentChunkSetHeadRecordDigest)
  validateQuota(evidence.quota, request)
}

function validateCompletedEvidence(
  evidence: RemoteIngressCompletedStagingEvidence,
  reservation: RemoteIngressReservationReceipt,
  request: ReserveRemoteIngressRequest,
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
  parseDigest(evidence.finalChunkSetHeadRecordDigest)
  parseDigest(evidence.durableChunkSetDigest)
  validateQuota(evidence.quota, request)
}

function normalizeOwnerValidationEvidence<K extends RemoteIngressKind>(
  value: RemoteIngressOwnerValidationEvidence<K>,
  completed: RemoteIngressCompletedStagingEvidence,
  authority: CurrentProtocolAuthority,
): RemoteIngressOwnerValidationEvidence<K> {
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

function validateImmutableEvidence<K extends RemoteIngressKind>(
  evidence: import("./contracts").RemoteImmutableIngressObjectPortEvidence<K>,
  completed: RemoteIngressCompletedStagingEvidence,
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
  parseDigest(evidence.immutableObjectDigest)
}

function validateQuota(quota: import("./contracts").RemoteIngressQuotaReservationPortEvidence, request: ReserveRemoteIngressRequest): void {
  if (
    quota.limitsDigest !== CURRENT_PROTOCOL_IDENTITIES.limitsDigest
    || !sameValue(quota.stableKey, request.stableKey)
    || quota.exactManifestDigest !== request.exactManifestDigest
    || quota.kind !== request.kind
    || quota.sourceMemberId !== request.stableKey.sourceMemberId
    || quota.chargedClosureCount !== "1"
    || quota.accountedAdmissionByteLength !== request.accountedAdmissionByteLength
  ) invalid("Remote-ingress quota evidence mirrors mismatch")
  if (
    BigInt(parseUint32(quota.resultingProjectChargedClosureCount)) > MAX_PROJECT_OBJECTS
    || BigInt(parseUint64(quota.resultingProjectAccountedAdmissionByteLength)) > MAX_PROJECT_BYTES
    || BigInt(parseUint32(quota.resultingSourceMemberChargedClosureCount)) > MAX_MEMBER_OBJECTS
    || BigInt(parseUint64(quota.resultingSourceMemberAccountedAdmissionByteLength)) > MAX_MEMBER_BYTES
  ) invalid("Remote-ingress quota evidence exceeds the frozen caps")
  parseDigest(quota.admissionEpochHeadRecordDigest)
  parseDigest(quota.admissionTransitionRecordDigest)
  parseDigest(quota.memberQuotaRecordDigest)
}

function normalizeStableKey(value: StableRemoteTransferKey): StableRemoteTransferKey {
  return Object.freeze({
    projectId: parseProjectId(value.projectId),
    projectEpoch: parseId128(value.projectEpoch),
    sourceMemberId: parseMemberId(value.sourceMemberId),
    transferId: parseId128(value.transferId),
  })
}

function copyReservationEvidence(value: import("./contracts").RemoteIngressReservationPortEvidence) {
  return { ...value, stableKey: normalizeStableKey(value.stableKey), quota: copyQuota(value.quota) }
}

function copyCompletedEvidence(value: RemoteIngressCompletedStagingEvidence) {
  return { ...value, stableKey: normalizeStableKey(value.stableKey), quota: copyQuota(value.quota) }
}

function copyQuota(value: import("./contracts").RemoteIngressQuotaReservationPortEvidence) {
  return Object.freeze({ ...value, stableKey: normalizeStableKey(value.stableKey) })
}

function requireReservation(value: object, identity: object): ReservationRecord {
  const record = reservations.get(value)
  if (!record || record.factory !== identity) invalid("Remote-ingress reservation receipt is structural, stale or cross-factory")
  return record
}

function requireCompleted(value: object, identity: object): CompletedRecord {
  const record = completedIngresses.get(value)
  if (!record || record.factory !== identity) invalid("Completed remote ingress is structural, stale or cross-factory")
  return record
}

function requireValidated(value: object, identity: object): ValidatedRecord {
  const record = validatedIngresses.get(value)
  if (!record || record.factory !== identity) invalid("Validated remote ingress is structural, stale or cross-factory")
  return record
}

function parseChunkBytes(value: string): UpdateIngressChunkBytes {
  if (!["4096", "8192", "16384", "32768", "65536", "131072", "262144"].includes(value)) {
    invalid("Remote-ingress chunk size is invalid")
  }
  return value as UpdateIngressChunkBytes
}

function requireToken(value: string, label: string): void {
  if (!TOKEN.test(value) || value.normalize("NFC") !== value) invalid(`${label} is invalid`)
}

function sameValue(left: unknown, right: unknown): boolean {
  const decoder = new TextDecoder()
  return decoder.decode(encodeRestrictedJcs(left)) === decoder.decode(encodeRestrictedJcs(right))
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}

function isFactoryIdentity(value: object): value is FactoryIdentity {
  return "isDisposed" in value && typeof value.isDisposed === "function"
}

function invalid(message: string): never {
  throw new CollaborationKernelError("invalid-codec", message)
}
