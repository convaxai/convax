import { describe, expect, test } from "bun:test"
import { reconcileGenerationExpectedRevision } from "./generation-expected-revision"

describe("reconcileGenerationExpectedRevision", () => {
  test("uses a newer authoritative flush for an ordinary stale request", () => {
    expect(reconcileGenerationExpectedRevision(39, 40)).toBe(40)
  })

  test("preserves a newer Main revision already verified by a multi-step caller", () => {
    expect(reconcileGenerationExpectedRevision(47, 46)).toBe(47)
  })
})
