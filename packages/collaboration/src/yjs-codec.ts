import * as Y from "yjs"
import type { ReplicaIdV2, StateVectorV2 } from "./codecs"
import { replicaIdToYjsClientIdV2 } from "./codecs"
import { KERNEL_LIMITS_V2 } from "./constants"
import { rawDomainDigestV2 } from "./digest"
import { CollaborationCodecErrorV2, CollaborationKernelErrorV2 } from "./errors"
import { assertByteLengthV2, assertUint8ArrayV2, cloneBytesV2, sameBytes } from "./binary"

export const LOCAL_CANDIDATE_ORIGIN_V2 = Object.freeze({ format: "convax.local-candidate-origin/2" })
export const ACCEPTED_FRAME_ORIGIN_V2 = Object.freeze({ format: "convax.accepted-frame-origin/2" })
export const RECONSTRUCTION_ORIGIN_V2 = Object.freeze({ format: "convax.reconstruction-origin/2" })

export interface YjsDocumentFactoryV2 {
  createDocument(): Y.Doc
}

export function createYjsDocumentV2(): Y.Doc {
  return new Y.Doc()
}

export function encodeStateVectorV2(document: Y.Doc): StateVectorV2 {
  requireDoc(document)
  const bytes = Y.encodeStateVector(document)
  return parseStateVectorV2(bytes)
}

export function parseStateVectorV2(value: Uint8Array): StateVectorV2 {
  assertByteLengthV2(value, 1, KERNEL_LIMITS_V2.stateVectorBytes, "StateVectorV2")
  assertCanonicalVarUintSequence(value)
  return cloneBytesV2(value, "StateVectorV2") as StateVectorV2
}

export function stateVectorDigestV2(value: Uint8Array) {
  return rawDomainDigestV2("convax.state-vector/2", parseStateVectorV2(value))
}

export function yjsUpdateDigestV2(value: Uint8Array) {
  assertByteLengthV2(value, 0, KERNEL_LIMITS_V2.yjsUpdateBytes, "Yjs update-v1 delta")
  return rawDomainDigestV2("convax.yjs-update/2", value)
}

export function encodeFullUpdateV2(document: Y.Doc, maximum = 32 * 1024 * 1024): Uint8Array {
  requireDoc(document)
  const update = Y.encodeStateAsUpdate(document)
  assertByteLengthV2(update, 0, maximum, "Yjs full update-v1")
  return cloneBytesV2(update)
}

export function encodeCandidateDeltaV2(candidate: Y.Doc, baseStateVector: StateVectorV2): Uint8Array {
  requireDoc(candidate)
  const update = Y.encodeStateAsUpdate(candidate, parseStateVectorV2(baseStateVector))
  assertByteLengthV2(update, 0, KERNEL_LIMITS_V2.yjsUpdateBytes, "Yjs update-v1 delta")
  return cloneBytesV2(update)
}

export function applyUpdateV1V2(document: Y.Doc, update: Uint8Array, origin: object): void {
  requireDoc(document)
  assertUint8ArrayV2(update, "Yjs update-v1")
  Y.applyUpdate(document, cloneBytesV2(update), origin)
}

export function cloneExactBaseDocumentV2(
  factory: YjsDocumentFactoryV2,
  fullBaseUpdate: Uint8Array,
  expectedBaseStateVector: StateVectorV2,
  replicaId?: ReplicaIdV2,
): Y.Doc {
  assertByteLengthV2(fullBaseUpdate, 0, 32 * 1024 * 1024, "canonical full-base update")
  const document = factory.createDocument()
  if (!(document instanceof Y.Doc)) throw new CollaborationKernelErrorV2("invalid-owner-result", "Document factory must return Y.Doc")
  try {
    applyUpdateV1V2(document, fullBaseUpdate, RECONSTRUCTION_ORIGIN_V2)
    const actual = encodeStateVectorV2(document)
    if (!sameBytes(actual, parseStateVectorV2(expectedBaseStateVector))) {
      throw new CollaborationKernelErrorV2("exact-base-unavailable", "Reconstructed base state vector is not byte-identical")
    }
    if (replicaId !== undefined) document.clientID = replicaIdToYjsClientIdV2(replicaId)
    return document
  } catch (error) {
    document.destroy()
    throw error
  }
}

export function assertUpdateAuthoredByReplicaV2(update: Uint8Array, replicaId: ReplicaIdV2): void {
  assertByteLengthV2(update, 0, KERNEL_LIMITS_V2.yjsUpdateBytes, "Yjs update-v1 delta")
  const expected = replicaIdToYjsClientIdV2(replicaId)
  let decoded: ReturnType<typeof Y.decodeUpdate>
  try {
    decoded = Y.decodeUpdate(update)
  } catch (error) {
    throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "Yjs update-v1 cannot be decoded", { cause: error })
  }
  for (const struct of decoded.structs) {
    if (struct.id.client !== expected) {
      throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "Yjs update authors a struct under a client id other than the signer replica id")
    }
  }
}

export function validateCanonicalDeltaV2(
  factory: YjsDocumentFactoryV2,
  fullBaseUpdate: Uint8Array,
  baseStateVector: StateVectorV2,
  update: Uint8Array,
  replicaId: ReplicaIdV2,
): { readonly document: Y.Doc; readonly postStateVector: StateVectorV2 } {
  assertUpdateAuthoredByReplicaV2(update, replicaId)
  const document = cloneExactBaseDocumentV2(factory, fullBaseUpdate, baseStateVector)
  try {
    applyUpdateV1V2(document, update, ACCEPTED_FRAME_ORIGIN_V2)
    const reencoded = Y.encodeStateAsUpdate(document, baseStateVector)
    if (!sameBytes(reencoded, update)) {
      throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "Yjs update is not byte-identical after exact-base isolated apply")
    }
    return Object.freeze({ document, postStateVector: encodeStateVectorV2(document) })
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
    if (clients.has(client.value)) throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "State vector contains a duplicate client")
    clients.add(client.value)
  }
  if (offset !== bytes.byteLength) throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "State vector contains trailing bytes")
}

function readCanonicalVarUint(bytes: Uint8Array, start: number): { value: number; offset: number } {
  let value = 0
  let multiplier = 1
  let offset = start
  let count = 0
  while (offset < bytes.byteLength && count < 8) {
    const byte = bytes[offset++]!
    value += (byte & 0x7f) * multiplier
    if (!Number.isSafeInteger(value)) throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "State-vector varuint overflows")
    count += 1
    if ((byte & 0x80) === 0) {
      if (count > 1 && byte === 0) throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "State-vector varuint is not minimally encoded")
      return { value, offset }
    }
    multiplier *= 128
  }
  throw new CollaborationCodecErrorV2("unsupported-yjs-codec", "State-vector varuint is truncated or overlong")
}

function requireDoc(value: unknown): asserts value is Y.Doc {
  if (!(value instanceof Y.Doc)) throw new CollaborationKernelErrorV2("invalid-owner-result", "Expected a Y.Doc")
}
