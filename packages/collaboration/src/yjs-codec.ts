import * as Y from "yjs"
import type { ReplicaId, StateVector } from "./codecs"
import { replicaIdToYjsClientId } from "./codecs"
import { KERNEL_LIMITS } from "./constants"
import { rawDomainDigest } from "./digest"
import { CollaborationCodecError, CollaborationKernelError } from "./errors"
import { assertByteLength, assertUint8Array, cloneBytes, sameBytes } from "./binary"

export const LOCAL_CANDIDATE_ORIGIN = Object.freeze({ format: "convax.local-candidate-origin/2" })
export const ACCEPTED_FRAME_ORIGIN = Object.freeze({ format: "convax.accepted-frame-origin/2" })
export const RECONSTRUCTION_ORIGIN = Object.freeze({ format: "convax.reconstruction-origin/2" })

export interface YjsDocumentFactory {
  createDocument(): Y.Doc
}

export function createYjsDocument(): Y.Doc {
  return new Y.Doc()
}

export function encodeStateVector(document: Y.Doc): StateVector {
  requireDoc(document)
  const bytes = Y.encodeStateVector(document)
  return parseStateVector(bytes)
}

export function parseStateVector(value: Uint8Array): StateVector {
  assertByteLength(value, 1, KERNEL_LIMITS.stateVectorBytes, "StateVector")
  assertCanonicalVarUintSequence(value)
  return cloneBytes(value, "StateVector") as StateVector
}

export function stateVectorDigest(value: Uint8Array) {
  return rawDomainDigest("convax.state-vector/2", parseStateVector(value))
}

export function yjsUpdateDigest(value: Uint8Array) {
  assertByteLength(value, 0, KERNEL_LIMITS.yjsUpdateBytes, "Yjs update-v1 delta")
  return rawDomainDigest("convax.yjs-update/2", value)
}

export function encodeFullUpdate(document: Y.Doc, maximum = 32 * 1024 * 1024): Uint8Array {
  requireDoc(document)
  const update = Y.encodeStateAsUpdate(document)
  assertByteLength(update, 0, maximum, "Yjs full update-v1")
  return cloneBytes(update)
}

export function encodeCandidateDelta(candidate: Y.Doc, baseStateVector: StateVector): Uint8Array {
  requireDoc(candidate)
  const update = Y.encodeStateAsUpdate(candidate, parseStateVector(baseStateVector))
  assertByteLength(update, 0, KERNEL_LIMITS.yjsUpdateBytes, "Yjs update-v1 delta")
  return cloneBytes(update)
}

export function applyYjsUpdate(document: Y.Doc, update: Uint8Array, origin: object): void {
  requireDoc(document)
  assertUint8Array(update, "Yjs update-v1")
  Y.applyUpdate(document, cloneBytes(update), origin)
}

export function cloneExactBaseDocument(
  factory: YjsDocumentFactory,
  fullBaseUpdate: Uint8Array,
  expectedBaseStateVector: StateVector,
  replicaId?: ReplicaId,
): Y.Doc {
  assertByteLength(fullBaseUpdate, 0, 32 * 1024 * 1024, "canonical full-base update")
  const document = factory.createDocument()
  if (!(document instanceof Y.Doc)) throw new CollaborationKernelError("invalid-owner-result", "Document factory must return Y.Doc")
  try {
    applyYjsUpdate(document, fullBaseUpdate, RECONSTRUCTION_ORIGIN)
    const actual = encodeStateVector(document)
    if (!sameBytes(actual, parseStateVector(expectedBaseStateVector))) {
      throw new CollaborationKernelError("exact-base-unavailable", "Reconstructed base state vector is not byte-identical")
    }
    if (replicaId !== undefined) document.clientID = replicaIdToYjsClientId(replicaId)
    return document
  } catch (error) {
    document.destroy()
    throw error
  }
}

export function assertUpdateAuthoredByReplica(update: Uint8Array, replicaId: ReplicaId): void {
  assertByteLength(update, 0, KERNEL_LIMITS.yjsUpdateBytes, "Yjs update-v1 delta")
  const expected = replicaIdToYjsClientId(replicaId)
  let decoded: ReturnType<typeof Y.decodeUpdate>
  try {
    decoded = Y.decodeUpdate(update)
  } catch (error) {
    throw new CollaborationCodecError("unsupported-yjs-codec", "Yjs update-v1 cannot be decoded", { cause: error })
  }
  for (const struct of decoded.structs) {
    if (struct.id.client !== expected) {
      throw new CollaborationCodecError("unsupported-yjs-codec", "Yjs update authors a struct under a client id other than the signer replica id")
    }
  }
}

export function validateCanonicalDelta(
  factory: YjsDocumentFactory,
  fullBaseUpdate: Uint8Array,
  baseStateVector: StateVector,
  update: Uint8Array,
  replicaId: ReplicaId,
): { readonly document: Y.Doc; readonly postStateVector: StateVector } {
  assertUpdateAuthoredByReplica(update, replicaId)
  const document = cloneExactBaseDocument(factory, fullBaseUpdate, baseStateVector)
  try {
    applyYjsUpdate(document, update, ACCEPTED_FRAME_ORIGIN)
    const reencoded = Y.encodeStateAsUpdate(document, baseStateVector)
    if (!sameBytes(reencoded, update)) {
      throw new CollaborationCodecError("unsupported-yjs-codec", "Yjs update is not byte-identical after exact-base isolated apply")
    }
    return Object.freeze({ document, postStateVector: encodeStateVector(document) })
  } catch (error) {
    document.destroy()
    throw error
  }
}

function assertCanonicalVarUintSequence(bytes: Uint8Array): void {
  let offset = 0
  const entryCount = readCanonicalVarUint(bytes, offset)
  offset = entryCount.offset
  const clients = new Set<number>()
  for (let index = 0; index < entryCount.value; index += 1) {
    const client = readCanonicalVarUint(bytes, offset)
    offset = client.offset
    const clock = readCanonicalVarUint(bytes, offset)
    offset = clock.offset
    if (clients.has(client.value)) throw new CollaborationCodecError("unsupported-yjs-codec", "State vector contains a duplicate client")
    clients.add(client.value)
  }
  if (offset !== bytes.byteLength) throw new CollaborationCodecError("unsupported-yjs-codec", "State vector contains trailing bytes")
}

function readCanonicalVarUint(bytes: Uint8Array, start: number): { value: number; offset: number } {
  let value = 0
  let multiplier = 1
  let offset = start
  let count = 0
  while (offset < bytes.byteLength && count < 8) {
    const byte = bytes[offset++]!
    value += (byte & 0x7f) * multiplier
    if (!Number.isSafeInteger(value)) throw new CollaborationCodecError("unsupported-yjs-codec", "State-vector varuint overflows")
    count += 1
    if ((byte & 0x80) === 0) {
      if (count > 1 && byte === 0) throw new CollaborationCodecError("unsupported-yjs-codec", "State-vector varuint is not minimally encoded")
      return { value, offset }
    }
    multiplier *= 128
  }
  throw new CollaborationCodecError("unsupported-yjs-codec", "State-vector varuint is truncated or overlong")
}

function requireDoc(value: unknown): asserts value is Y.Doc {
  if (!(value instanceof Y.Doc)) throw new CollaborationKernelError("invalid-owner-result", "Expected a Y.Doc")
}
