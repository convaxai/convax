import { describe, expect, test } from "bun:test"
import type { Digest, DocumentScope } from "@convax/collaboration"
import {
  deriveDocumentNativeKey,
  deriveJournalSegmentNativeKey,
  deriveObjectNativeKey,
  InvalidCollaborationNativeKeyInputError,
  parseJournalSegmentNativeKey,
} from "./native-store-keys"

const id = (byte: number) => Buffer.alloc(16, byte).toString("base64url")
const scope = {
  projectId: "project-a",
  projectEpoch: id(1),
  docKind: "project-index",
  docId: "project-index",
  shardEpoch: id(2),
} as DocumentScope

describe("Native collaboration keys", () => {
  test("derives stable opaque document and kind-separated object keys", () => {
    const documentKey = deriveDocumentNativeKey(scope)
    expect(documentKey).toMatch(/^[0-9a-f]{64}$/)
    expect(documentKey).not.toContain("project-a")
    expect(deriveDocumentNativeKey({ ...scope })).toBe(documentKey)

    const digest = "a".repeat(64) as Digest
    expect(deriveObjectNativeKey("frame", digest)).toMatch(/^[0-9a-f]{64}$/)
    expect(deriveObjectNativeKey("frame", digest)).not.toBe(deriveObjectNativeKey("checkpoint", digest))
  })

  test("uses canonical non-zero u64 local segment keys", () => {
    expect(String(deriveJournalSegmentNativeKey("1"))).toBe("s2-0000000000000001")
    expect(String(deriveJournalSegmentNativeKey("18446744073709551615"))).toBe("s2-ffffffffffffffff")
    expect(parseJournalSegmentNativeKey("s2-000000000000000a")).toBe("10")
    expect(() => deriveJournalSegmentNativeKey("0")).toThrow(InvalidCollaborationNativeKeyInputError)
    expect(() => deriveJournalSegmentNativeKey("01")).toThrow(InvalidCollaborationNativeKeyInputError)
  })

  test("keeps ProjectIndex and Canvas physical shards distinct", () => {
    const canvas = {
      ...scope,
      docKind: "canvas",
      docId: `cv_${"b".repeat(64)}`,
    } as DocumentScope
    expect(deriveDocumentNativeKey(canvas)).not.toBe(deriveDocumentNativeKey(scope))
    expect(() => deriveDocumentNativeKey({ ...canvas, docId: "canvas-main" } as never)).toThrow(
      InvalidCollaborationNativeKeyInputError,
    )
  })
})
