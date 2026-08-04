import { describe, expect, test } from "bun:test"
import type { DigestV2, DocumentScopeV2 } from "@convax/collaboration"
import {
  deriveDocumentNativeKeyV2,
  deriveJournalSegmentNativeKeyV2,
  deriveObjectNativeKeyV2,
  InvalidCollaborationNativeKeyInputError,
  parseJournalSegmentNativeKeyV2,
} from "./native-store-keys"

const id = (byte: number) => Buffer.alloc(16, byte).toString("base64url")
const scope = {
  projectId: "project-a",
  projectEpoch: id(1),
  docKind: "project-index",
  docId: "project-index",
  shardEpoch: id(2),
} as DocumentScopeV2

describe("R5 native collaboration keys", () => {
  test("derives stable opaque document and kind-separated object keys", () => {
    const documentKey = deriveDocumentNativeKeyV2(scope)
    expect(documentKey).toMatch(/^[0-9a-f]{64}$/)
    expect(documentKey).not.toContain("project-a")
    expect(deriveDocumentNativeKeyV2({ ...scope })).toBe(documentKey)

    const digest = "a".repeat(64) as DigestV2
    expect(deriveObjectNativeKeyV2("frame", digest)).toMatch(/^[0-9a-f]{64}$/)
    expect(deriveObjectNativeKeyV2("frame", digest)).not.toBe(deriveObjectNativeKeyV2("checkpoint", digest))
  })

  test("uses canonical non-zero u64 local segment keys", () => {
    expect(String(deriveJournalSegmentNativeKeyV2("1"))).toBe("s2-0000000000000001")
    expect(String(deriveJournalSegmentNativeKeyV2("18446744073709551615"))).toBe("s2-ffffffffffffffff")
    expect(parseJournalSegmentNativeKeyV2("s2-000000000000000a")).toBe("10")
    expect(() => deriveJournalSegmentNativeKeyV2("0")).toThrow(InvalidCollaborationNativeKeyInputError)
    expect(() => deriveJournalSegmentNativeKeyV2("01")).toThrow(InvalidCollaborationNativeKeyInputError)
  })

  test("keeps ProjectIndex and Canvas physical shards distinct", () => {
    const canvas = {
      ...scope,
      docKind: "canvas",
      docId: `cv_${"b".repeat(64)}`,
    } as DocumentScopeV2
    expect(deriveDocumentNativeKeyV2(canvas)).not.toBe(deriveDocumentNativeKeyV2(scope))
    expect(() => deriveDocumentNativeKeyV2({ ...canvas, docId: "canvas-main" } as never)).toThrow(
      InvalidCollaborationNativeKeyInputError,
    )
  })
})
