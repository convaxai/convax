import {
  CHECKPOINT_VALIDATION_CARRIER_LIMITS,
  CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES,
  assertDocumentOwnerRuntime,
  checkpointContentCertificateCoreDigest,
  parseCheckpointContentCertificateCore,
  parseCheckpointContentCertificate,
  parseCheckpointValidationCarrierIndexBytes,
  parseCheckpointValidationCarrierPreamble,
  parseSignature,
  uint64ToBigInt,
  type CheckpointCarrierSection,
  type CheckpointContentCertificateCore,
  type CheckpointContentCertificate,
  type CheckpointValidationCarrierIndex,
  type Digest,
  type DocumentOwnerRuntime,
  type Signature,
  type Uint64,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"

export const CHECKPOINT_ATTESTER_CONTENT_TYPE_V2 = "application/vnd.convax.checkpoint-validation-carrier-v2"

export interface EphemeralCheckpointSectionV2 {
  readonly descriptor: CheckpointCarrierSection
  /** Opens process-scoped bytes. The handle becomes invalid when its request is destroyed. */
  open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>
}

export interface EphemeralCheckpointSectionWriterV2 {
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>
  finish(signal: AbortSignal): Promise<Readonly<{
    handle: EphemeralCheckpointSectionV2
    byteLength: Uint64
    sha256: Digest
  }>>
}

export interface EphemeralCheckpointRequestV2 {
  createSection(descriptor: CheckpointCarrierSection): Promise<EphemeralCheckpointSectionWriterV2>
  /** Must invalidate every section handle and destroy all payload bytes. */
  destroy(): Promise<void>
}

/** This is an isolated process-scoped byte store, never a durable control-plane adapter. */
export interface CheckpointAttesterEphemeralStoreV2 {
  /** Removes unrecoverable bytes left by a crashed attester before the first request is served. */
  cleanupStale(): Promise<void>
  createRequest(requestId: string): Promise<EphemeralCheckpointRequestV2>
}

export interface VerifiedCheckpointClosureV2 {
  readonly parentCertificateDigests: readonly Digest[]
  readonly computedFrontierDigest: Digest
  readonly actorHeadBoundaryDigest: Digest
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly fullUpdateDigest: Digest
  readonly trustBundleDigest: Digest
}

export interface ResolvedCheckpointValidationAuthorityV2 {
  /** Live exact selected owner runtime instantiated from this carrier's declarative artifact set. */
  readonly ownerRuntime: DocumentOwnerRuntime
  readonly validationArtifactSetDigest: Digest
  verifyCausalClosure(input: Readonly<{
    index: CheckpointValidationCarrierIndex
    sections: readonly EphemeralCheckpointSectionV2[]
    signal: AbortSignal
  }>): Promise<VerifiedCheckpointClosureV2 | "rejected" | "unavailable">
}

/** Resolves only artifact-bound executable authority; repository-current owner code is not a fallback. */
export interface CheckpointValidationArtifactResolverV2 {
  resolve(input: Readonly<{
    index: CheckpointValidationCarrierIndex
    sections: readonly EphemeralCheckpointSectionV2[]
    signal: AbortSignal
  }>): Promise<ResolvedCheckpointValidationAuthorityV2 | "rejected" | "unavailable">
}

export interface CheckpointContentCertificateSignerPortV2 {
  serviceKeyId(purpose: "content-attestation"): string
  signServiceDigest(purpose: "content-attestation", digest: Digest): Promise<Signature>
}

export interface CheckpointAttesterAuditV2 {
  record(record: Readonly<{
    format: "convax.checkpoint-attester-audit"
    requestId: string
    byteCount: Uint64
    sectionDigests: readonly Digest[]
    outcome: "certified" | "rejected" | "unavailable" | "cancelled" | "failed"
    resultDigest: Digest | null
    rejectionCode: string | null
    cleanup: "destroyed" | "failed"
  }>): Promise<void>
}

export interface CheckpointAttesterOptionsV2 {
  readonly protocolAuthority: CurrentProtocolAuthority
  readonly ephemeralStore: CheckpointAttesterEphemeralStoreV2
  readonly artifactResolver: CheckpointValidationArtifactResolverV2
  readonly signer: CheckpointContentCertificateSignerPortV2
  readonly audit: CheckpointAttesterAuditV2
  readonly createRequestId: () => string
}

interface AttestationResultV2 {
  readonly certificate: CheckpointContentCertificate
  readonly byteCount: bigint
  readonly sectionDigests: readonly Digest[]
}

interface AttestationProgressV2 {
  byteCount: bigint
  sectionDigests: readonly Digest[]
}

class AttesterRequestErrorV2 extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly outcome: "rejected" | "unavailable" | "cancelled" | "failed",
  ) {
    super(code)
    this.name = "AttesterRequestErrorV2"
  }
}

/** Separate isolated streaming endpoint. Never mount this on the ordinary control router. */
export function createIsolatedCheckpointAttesterV2Handler(
  options?: CheckpointAttesterOptionsV2,
): (request: Request) => Promise<Response> {
  let staleCleanup: Promise<void> | null = null
  return async (request) => {
    const url = new URL(request.url)
    if (url.pathname !== "/api/v2/attester/checkpoints") return response(404, "endpoint-not-found")
    if (request.method !== "POST") return response(405, "method-not-allowed")
    if (!options) return response(503, "attester-adapters-unavailable")
    if (request.headers.get("content-type") !== CHECKPOINT_ATTESTER_CONTENT_TYPE_V2) return response(415, "invalid-content-type")
    if (request.headers.has("content-encoding")) return response(415, "carrier-compression-forbidden")
    if (request.body === null) return response(400, "carrier-truncated")
    let declaredLength: bigint | null
    try {
      declaredLength = declaredContentLength(request.headers.get("content-length"))
    } catch {
      return response(400, "content-length-invalid")
    }
    if (declaredLength !== null && declaredLength > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.carrierBytes)) {
      return response(413, "carrier-too-large")
    }

    const requestId = options.createRequestId()
    let ephemeral: EphemeralCheckpointRequestV2 | null = null
    let byteCount = 0n
    let sectionDigests: readonly Digest[] = Object.freeze([])
    let resultDigest: Digest | null = null
    let outcome: "certified" | "rejected" | "unavailable" | "cancelled" | "failed" = "failed"
    let rejectionCode: string | null = null
    let cleanup: "destroyed" | "failed" = "destroyed"
    let result: AttestationResultV2 | null = null
    let responseStatus = 500
    const progress: AttestationProgressV2 = { byteCount: 0n, sectionDigests: Object.freeze([]) }
    try {
      staleCleanup ??= options.ephemeralStore.cleanupStale()
      await staleCleanup
      throwIfAborted(request.signal)
      ephemeral = await options.ephemeralStore.createRequest(requestId)
      result = await attestCarrier(request.body, request.signal, ephemeral, options, progress)
      byteCount = result.byteCount
      sectionDigests = result.sectionDigests
      resultDigest = result.certificate.coreDigest
      outcome = "certified"
    } catch (error) {
      const normalized = normalizeError(error, request.signal)
      byteCount = progress.byteCount
      sectionDigests = progress.sectionDigests
      outcome = normalized.outcome
      rejectionCode = normalized.code
      responseStatus = normalized.status
    } finally {
      if (ephemeral !== null) {
        try {
          await ephemeral.destroy()
        } catch {
          cleanup = "failed"
          outcome = "failed"
          rejectionCode = "ephemeral-cleanup-failed"
          responseStatus = 500
          result = null
          resultDigest = null
        }
      }
      try {
        await options.audit.record(Object.freeze({
          format: "convax.checkpoint-attester-audit",
          requestId,
          byteCount: String(byteCount) as Uint64,
          sectionDigests,
          outcome,
          resultDigest,
          rejectionCode,
          cleanup,
        }))
      } catch {
        outcome = "failed"
        rejectionCode = "attester-audit-failed"
        responseStatus = 500
        result = null
      }
    }
    if (result !== null && outcome === "certified") {
      return Response.json(result.certificate, { status: 200, headers: { "cache-control": "no-store" } })
    }
    return response(responseStatus, rejectionCode ?? "attestation-failed")
  }
}

async function attestCarrier(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  ephemeral: EphemeralCheckpointRequestV2,
  options: CheckpointAttesterOptionsV2,
  progress: AttestationProgressV2,
): Promise<AttestationResultV2> {
  const stream = new CarrierStreamReaderV2(body, signal)
  let index: CheckpointValidationCarrierIndex
  let sections: readonly EphemeralCheckpointSectionV2[]
  try {
    const preamble = await stream.readExactly(CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES)
    const { indexByteLength } = parseCheckpointValidationCarrierPreamble(preamble)
    const indexBytes = await stream.readExactly(Number(uint64ToBigInt(indexByteLength)))
    index = parseCheckpointValidationCarrierIndexBytes(indexBytes)
    progress.sectionDigests = Object.freeze(index.sections.map((section) => section.sha256))
    const expectedLength = BigInt(CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES)
      + uint64ToBigInt(indexByteLength)
      + uint64ToBigInt(index.totalSectionBytes)
    if (expectedLength > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.carrierBytes)) reject("carrier-too-large", 413)

    const handles: EphemeralCheckpointSectionV2[] = []
    for (const descriptor of index.sections) {
      throwIfAborted(signal)
      const writer = await ephemeral.createSection(descriptor)
      await stream.pipeExactly(uint64ToBigInt(descriptor.byteLength), writer)
      const accepted = await writer.finish(signal)
      if (uint64ToBigInt(accepted.byteLength) !== uint64ToBigInt(descriptor.byteLength) || accepted.sha256 !== descriptor.sha256) {
        reject("carrier-section-hash-mismatch", 400)
      }
      if (!sameSectionDescriptor(accepted.handle.descriptor, descriptor)) reject("ephemeral-section-binding-mismatch", 500)
      handles.push(accepted.handle)
    }
    await stream.requireEnd()
    progress.byteCount = stream.byteCount
    if (stream.byteCount !== expectedLength) reject("carrier-length-mismatch", 400)
    sections = Object.freeze(handles)
  } catch (error) {
    progress.byteCount = stream.byteCount
    throw normalizeCarrierError(error, signal)
  } finally {
    await stream.cancel()
  }

  throwIfAborted(signal)
  const authority = await options.artifactResolver.resolve({ index, sections, signal })
  if (authority === "unavailable") unavailable("validation-artifact-authority-unavailable")
  if (authority === "rejected") reject("validation-artifact-authority-rejected", 422)
  try {
    assertDocumentOwnerRuntime(authority.ownerRuntime, options.protocolAuthority)
  } catch {
    unavailable("selected-owner-runtime-unavailable")
  }
  const ownerProtocolPort = authority.ownerRuntime.protocolPort
  if (options.protocolAuthority.protocolDigest !== index.protocolDigest) unavailable("selected-protocol-authority-unavailable")
  if (authority.validationArtifactSetDigest !== index.validationArtifactSetDigest) reject("validation-artifact-set-mismatch", 422)
  if (ownerProtocolPort.owner !== index.scope.docKind) reject("owner-protocol-kind-mismatch", 422)
  const verification = await authority.verifyCausalClosure({ index, sections, signal })
  if (verification === "unavailable") unavailable("checkpoint-validation-unavailable")
  if (verification === "rejected") reject("checkpoint-validation-rejected", 422)
  throwIfAborted(signal)

  const serviceKeyId = options.signer.serviceKeyId("content-attestation")
  const core = parseCheckpointContentCertificateCore(Object.freeze({
    format: "convax.checkpoint-content-certificate-core",
    scope: index.scope,
    checkpointDigest: index.proposalCheckpointDigest,
    parentCertificateDigests: verification.parentCertificateDigests,
    computedFrontierDigest: verification.computedFrontierDigest,
    actorHeadBoundaryDigest: verification.actorHeadBoundaryDigest,
    stateVectorDigest: verification.stateVectorDigest,
    canonicalStateDigest: verification.canonicalStateDigest,
    fullUpdateDigest: verification.fullUpdateDigest,
    protocolDigest: index.protocolDigest,
    schemaDigest: ownerProtocolPort.schemaDigest,
    canonicalizerDigest: ownerProtocolPort.canonicalizerDigest,
    validationArtifactSetDigest: index.validationArtifactSetDigest,
    trustBundleDigest: verification.trustBundleDigest,
    contentStatus: "service-validated-causal-closure",
    serviceKeyPurpose: "content-attestation",
    serviceKeyId,
  } satisfies CheckpointContentCertificateCore))
  const coreDigest = checkpointContentCertificateCoreDigest(core)
  const serviceSignature = parseSignature(await options.signer.signServiceDigest("content-attestation", coreDigest))
  throwIfAborted(signal)
  const certificate = parseCheckpointContentCertificate(Object.freeze({
    format: "convax.checkpoint-content-certificate",
    core,
    coreDigest,
    serviceSignature,
  }))
  return Object.freeze({ certificate, byteCount: stream.byteCount, sectionDigests: Object.freeze(index.sections.map((section) => section.sha256)) })
}

class CarrierStreamReaderV2 {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private pending: Uint8Array = new Uint8Array(0)
  byteCount = 0n

  constructor(body: ReadableStream<Uint8Array>, private readonly signal: AbortSignal) {
    this.reader = body.getReader()
  }

  async readExactly(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0) reject("carrier-length-invalid", 400)
    const result = new Uint8Array(length)
    let offset = 0
    while (offset < length) {
      const chunk = await this.take(length - offset)
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  async pipeExactly(length: bigint, writer: EphemeralCheckpointSectionWriterV2): Promise<void> {
    let remaining = length
    while (remaining > 0n) {
      const maximum = remaining > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(remaining)
      const chunk = await this.take(maximum)
      await writer.write(chunk, this.signal)
      remaining -= BigInt(chunk.byteLength)
    }
  }

  async requireEnd(): Promise<void> {
    if (this.pending.byteLength > 0) reject("carrier-trailing-bytes", 400)
    const result = await abortable(this.reader.read(), this.signal)
    if (!result.done) {
      this.acceptChunk(result.value)
      reject("carrier-trailing-bytes", 400)
    }
  }

  async cancel(): Promise<void> {
    try { await this.reader.cancel() } catch { /* cleanup owns payload disposal */ }
    this.reader.releaseLock()
    this.pending = new Uint8Array(0)
  }

  private async take(maximum: number): Promise<Uint8Array> {
    throwIfAborted(this.signal)
    while (this.pending.byteLength === 0) {
      const result = await abortable(this.reader.read(), this.signal)
      if (result.done) reject("carrier-truncated", 400)
      this.acceptChunk(result.value)
    }
    const length = Math.min(maximum, this.pending.byteLength)
    const result = this.pending.subarray(0, length)
    this.pending = this.pending.subarray(length)
    return result
  }

  private acceptChunk(value: Uint8Array): void {
    if (!(value instanceof Uint8Array) || value.byteLength < 1) reject("carrier-stream-invalid", 400)
    this.byteCount += BigInt(value.byteLength)
    if (this.byteCount > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.carrierBytes)) reject("carrier-too-large", 413)
    this.pending = value
  }
}

function declaredContentLength(value: string | null): bigint | null {
  if (value === null) return null
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new TypeError("Invalid Content-Length")
  return BigInt(value)
}

function sameSectionDescriptor(left: CheckpointCarrierSection, right: CheckpointCarrierSection): boolean {
  return left.ordinal === right.ordinal
    && left.kind === right.kind
    && left.subjectDigest === right.subjectDigest
    && left.byteOffset === right.byteOffset
    && left.byteLength === right.byteLength
    && left.sha256 === right.sha256
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  return new Promise<T>((resolve, rejectPromise) => {
    const abort = () => rejectPromise(new DOMException("Attestation cancelled", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value) },
      (error) => { signal.removeEventListener("abort", abort); rejectPromise(error) },
    )
  })
}

function normalizeCarrierError(error: unknown, signal: AbortSignal): AttesterRequestErrorV2 {
  if (error instanceof AttesterRequestErrorV2) return error
  if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return new AttesterRequestErrorV2("attestation-cancelled", 408, "cancelled")
  return new AttesterRequestErrorV2("carrier-invalid", 400, "rejected")
}

function normalizeError(error: unknown, signal: AbortSignal): AttesterRequestErrorV2 {
  if (error instanceof AttesterRequestErrorV2) return error
  if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return new AttesterRequestErrorV2("attestation-cancelled", 408, "cancelled")
  return new AttesterRequestErrorV2("attestation-failed", 500, "failed")
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Attestation cancelled", "AbortError")
}

function reject(code: string, status: number): never {
  throw new AttesterRequestErrorV2(code, status, "rejected")
}

function unavailable(code: string): never {
  throw new AttesterRequestErrorV2(code, 503, "unavailable")
}

function response(status: number, code: string): Response {
  return Response.json({ format: "convax.api-error", code }, { status, headers: { "cache-control": "no-store" } })
}
