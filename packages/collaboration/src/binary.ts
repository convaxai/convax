import { CollaborationCodecError } from "./errors"
import { sameBytes } from "./jcs"

export function cloneBytes(value: Uint8Array, label = "binary value"): Uint8Array {
  assertUint8Array(value, label)
  return Uint8Array.from(value)
}

export function assertUint8Array(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new CollaborationCodecError("invalid-binary", `${label} must be Uint8Array`)
}

export function assertByteLength(value: Uint8Array, minimum: number, maximum: number, label: string): void {
  assertUint8Array(value, label)
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || maximum < minimum) {
    throw new RangeError("Invalid byte-length bounds")
  }
  if (value.byteLength < minimum || value.byteLength > maximum) {
    throw new CollaborationCodecError("invalid-binary", `${label} must contain ${minimum}..${maximum} bytes`)
  }
}

export { sameBytes }
