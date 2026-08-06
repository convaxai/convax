import { CollaborationCodecError } from "./errors"

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

export function encodeRestrictedJcs(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value, 0, new Set<object>()))
}

export function encodeRestrictedJcsText(value: unknown): string {
  return canonicalize(value, 0, new Set<object>())
}

export function decodeRestrictedJcs(bytes: Uint8Array): unknown {
  requireUint8Array(bytes, "restricted JCS")
  let text: string
  let parsed: unknown
  try {
    text = decoder.decode(bytes)
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    throw new CollaborationCodecError("invalid-canonical-jcs", "Restricted JCS is not valid UTF-8 JSON", { cause: error })
  }
  if (!sameBytes(encodeRestrictedJcs(parsed), bytes)) {
    throw new CollaborationCodecError("invalid-canonical-jcs", "Restricted JCS bytes are not canonical")
  }
  return parsed
}

export function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function assertExactKeys(
  value: unknown,
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isPlainDataObject(value)) invalid(`${label} must be a plain data object`)
  const actual = Object.keys(value).sort(compareUtf16)
  const expected = [...required].sort(compareUtf16)
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} has unknown or missing fields`)
  }
}

export function assertDenseArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`)
  assertArrayShape(value)
}

export function assertNfcScalarString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") invalid(`${label} must be a string`)
  if (value.normalize("NFC") !== value) invalid(`${label} must be NFC`)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) invalid(`${label} contains a lone surrogate`)
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid(`${label} contains a lone surrogate`)
    }
  }
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength
}

export function compareUtf8(left: string, right: string): number {
  return compareBytes(encoder.encode(left), encoder.encode(right))
}

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength)
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return left.byteLength - right.byteLength
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function canonicalize(value: unknown, depth: number, ancestors: Set<object>): string {
  if (depth > 128) invalid("Restricted JCS exceeds the depth limit")
  if (value === null || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "string") {
    assertNfcScalarString(value, "Restricted JCS string")
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Restricted JCS numbers must be finite")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) {
    assertArrayShape(value)
    return withAncestor(value, ancestors, () => {
      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !("value" in descriptor)) invalid("Restricted JCS arrays require data items")
        items.push(canonicalize(descriptor.value, depth + 1, ancestors))
      }
      return `[${items.join(",")}]`
    })
  }
  if (!isPlainDataObject(value)) invalid("Restricted JCS contains a non-JSON value")
  return withAncestor(value, ancestors, () => {
    const keys = assertObjectShape(value).sort(compareUtf16)
    return `{${keys.map((key) => {
      assertNfcScalarString(key, "Restricted JCS key")
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !("value" in descriptor)) invalid("Restricted JCS objects require data properties")
      return `${JSON.stringify(key)}:${canonicalize(descriptor.value, depth + 1, ancestors)}`
    }).join(",")}}`
  })
}

function assertArrayShape(value: readonly unknown[]): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) invalid("Restricted JCS arrays must use Array.prototype")
  if (Object.getOwnPropertySymbols(value).length > 0) invalid("Restricted JCS arrays cannot contain symbols")
  const names = Object.getOwnPropertyNames(value)
  const expected = Array.from({ length: value.length }, (_, index) => String(index)).concat("length")
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    invalid("Restricted JCS arrays must be dense and have no extra properties")
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor || !("value" in descriptor) || (name !== "length" && !descriptor.enumerable)) {
      invalid("Restricted JCS arrays require enumerable data items")
    }
  }
}

function assertObjectShape(value: Record<string, unknown>): string[] {
  if (Object.getOwnPropertySymbols(value).length > 0) invalid("Restricted JCS objects cannot contain symbols")
  const names = Object.getOwnPropertyNames(value)
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      invalid("Restricted JCS objects require enumerable data properties")
    }
  }
  return names
}

function withAncestor<T>(value: object, ancestors: Set<object>, task: () => T): T {
  if (ancestors.has(value)) invalid("Restricted JCS cannot contain cycles")
  ancestors.add(value)
  try {
    return task()
  } finally {
    ancestors.delete(value)
  }
}

function requireUint8Array(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) invalid(`${label} must be Uint8Array`)
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function invalid(message: string): never {
  throw new CollaborationCodecError("invalid-canonical-jcs", message)
}
