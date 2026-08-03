import { CollaborationCodecErrorV2 } from "./errors"
import { sameBytes } from "./jcs"

export function cloneBytesV2(value: Uint8Array, label = "binary value"): Uint8Array {
  assertUint8ArrayV2(value, label)
  return Uint8Array.from(value)
}

export function assertUint8ArrayV2(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new CollaborationCodecErrorV2("invalid-binary", `${label} must be Uint8Array`)
}

export function assertByteLengthV2(value: Uint8Array, minimum: number, maximum: number, label: string): void {
  assertUint8ArrayV2(value, label)
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || maximum < minimum) {
    throw new RangeError("Invalid byte-length bounds")
  }
  if (value.byteLength < minimum || value.byteLength > maximum) {
    throw new CollaborationCodecErrorV2("invalid-binary", `${label} must contain ${minimum}..${maximum} bytes`)
  }
}

export { sameBytes }
