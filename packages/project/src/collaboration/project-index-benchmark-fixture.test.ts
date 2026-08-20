import { describe, expect, test } from "bun:test"
import { ordinarySha256 } from "@convax/collaboration"
import { validateProjectIndexYDoc } from "./project-index"
import { createProjectIndexBenchmarkFixture } from "./project-index-benchmark-fixture"

describe("ProjectIndex benchmark fixture", () => {
  test("resource cardinality changes the validated owner collection and actual full-update bytes", () => {
    const zero = createProjectIndexBenchmarkFixture(0)
    const one = createProjectIndexBenchmarkFixture(1)
    const thirtyOne = createProjectIndexBenchmarkFixture(31)
    const thirtyTwo = createProjectIndexBenchmarkFixture(32)
    try {
      expect(zero.ownerResourceCount).toBe(0)
      expect(one.ownerResourceCount).toBe(1)
      expect(thirtyOne.ownerResourceCount).toBe(31)
      expect(thirtyTwo.ownerResourceCount).toBe(32)
      expect(validateProjectIndexYDoc(one.document).entries.size).toBe(2)
      expect(validateProjectIndexYDoc(thirtyTwo.document).entries.size).toBe(33)
      expect(thirtyTwo.fullUpdate.byteLength).toBeGreaterThan(one.fullUpdate.byteLength)
      expect(ordinarySha256(thirtyTwo.fullUpdate)).not.toBe(ordinarySha256(one.fullUpdate))
    } finally {
      zero.document.destroy()
      one.document.destroy()
      thirtyOne.document.destroy()
      thirtyTwo.document.destroy()
    }
  })

  test("rejects fixture cardinalities outside the bounded benchmark range", () => {
    expect(() => createProjectIndexBenchmarkFixture(-1)).toThrow("safe integer from 0 through 4096")
    expect(() => createProjectIndexBenchmarkFixture(4097)).toThrow("safe integer from 0 through 4096")
  })
})
