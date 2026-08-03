import { createHash } from "node:crypto"
import type { DigestV2, DocumentScopeV2 } from "@convax/collaboration"

export type DocumentNativeKeyV2 = string & { readonly __documentNativeKeyV2: true }
export type ObjectNativeKeyV2 = string & { readonly __objectNativeKeyV2: true }
export type JournalSegmentNativeKeyV2 = string & { readonly __journalSegmentNativeKeyV2: true }

const digestPattern = /^[0-9a-f]{64}$/u
const uint64Pattern = /^(0|[1-9][0-9]*)$/u
const maximumUint64 = (1n << 64n) - 1n

/**
 * Native document names are opaque hashes of the complete portable scope. Raw
 * Project, Canvas and epoch identifiers never become path components.
 */
export function deriveDocumentNativeKeyV2(scope: DocumentScopeV2): DocumentNativeKeyV2 {
  validateDocumentScopeShape(scope)
  return sha256(
    Buffer.from("convax.native-document-store-key/2\0", "utf8"),
    Buffer.from(restrictedJcs(scope), "utf8"),
  ) as DocumentNativeKeyV2
}

/**
 * Immutable object names bind both the object family and portable digest. This
 * prevents one digest-looking value from aliasing objects in different stores.
 */
export function deriveObjectNativeKeyV2(objectKind: string, digest: DigestV2 | string): ObjectNativeKeyV2 {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(objectKind)) {
    throw new InvalidCollaborationNativeKeyInputError("Object kind is not canonical ASCII")
  }
  if (typeof digest !== "string" || !digestPattern.test(digest)) {
    throw new InvalidCollaborationNativeKeyInputError("Object digest must be lowercase SHA-256")
  }
  return sha256(
    Buffer.from("convax.native-object-store-key/2\0", "utf8"),
    Buffer.from(objectKind, "ascii"),
    Buffer.from("\0", "ascii"),
    Buffer.from(digest, "hex"),
  ) as ObjectNativeKeyV2
}

/** Local recovery ordering only; this value never enters portable winner rules. */
export function deriveJournalSegmentNativeKeyV2(sequence: string): JournalSegmentNativeKeyV2 {
  if (!uint64Pattern.test(sequence)) {
    throw new InvalidCollaborationNativeKeyInputError("Journal sequence must be canonical unsigned decimal")
  }
  const parsed = BigInt(sequence)
  if (parsed < 1n || parsed > maximumUint64) {
    throw new InvalidCollaborationNativeKeyInputError("Journal sequence must be in the inclusive u64 range 1..max")
  }
  return `s2-${parsed.toString(16).padStart(16, "0")}` as JournalSegmentNativeKeyV2
}

export function parseJournalSegmentNativeKeyV2(value: unknown): string {
  if (typeof value !== "string" || !/^s2-[0-9a-f]{16}$/u.test(value)) {
    throw new InvalidCollaborationNativeKeyInputError("Journal segment native key is invalid")
  }
  const parsed = BigInt(`0x${value.slice(3)}`)
  if (parsed < 1n) throw new InvalidCollaborationNativeKeyInputError("Journal sequence zero is forbidden")
  return parsed.toString(10)
}

export class InvalidCollaborationNativeKeyInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidCollaborationNativeKeyInputError"
  }
}

function validateDocumentScopeShape(scope: unknown): asserts scope is DocumentScopeV2 {
  if (!isPlainObject(scope) || !hasExactKeys(scope, ["docId", "docKind", "projectEpoch", "projectId", "shardEpoch"])) {
    throw new InvalidCollaborationNativeKeyInputError("Document scope has unsupported fields")
  }
  if (typeof scope.projectId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(scope.projectId)) {
    throw new InvalidCollaborationNativeKeyInputError("Project id is not canonical")
  }
  requireId128(scope.projectEpoch, "Project epoch")
  requireId128(scope.shardEpoch, "Shard epoch")
  if (scope.docKind === "project-index") {
    if (scope.docId !== "project-index") {
      throw new InvalidCollaborationNativeKeyInputError("ProjectIndex doc id must be project-index")
    }
    return
  }
  if (scope.docKind !== "canvas" || typeof scope.docId !== "string" || !/^cv_[0-9a-f]{64}$/u.test(scope.docId)) {
    throw new InvalidCollaborationNativeKeyInputError("Canvas document scope is invalid")
  }
}

function requireId128(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/u.test(value)) {
    throw new InvalidCollaborationNativeKeyInputError(`${label} is not canonical base64url`)
  }
  const decoded = Buffer.from(value, "base64url")
  if (decoded.byteLength !== 16 || decoded.toString("base64url") !== value) {
    throw new InvalidCollaborationNativeKeyInputError(`${label} is not canonical 16-byte base64url`)
  }
}

function restrictedJcs(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new InvalidCollaborationNativeKeyInputError("JCS number must be finite")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(restrictedJcs).join(",")}]`
  if (!isPlainObject(value)) throw new InvalidCollaborationNativeKeyInputError("JCS value must be plain data")
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${restrictedJcs(value[key])}`)
    .join(",")}}`
}

function sha256(...parts: readonly Uint8Array[]): string {
  const hash = createHash("sha256")
  for (const part of parts) hash.update(part)
  return hash.digest("hex")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
}
