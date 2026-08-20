import { describe, expect, test } from "bun:test"
import {
  CanvasPersistentRuntimeMap,
  canvasPersistentRuntimeMapWorkCounts,
} from "./persistent-runtime-map"

describe("Canvas persistent runtime overlay", () => {
  test("installs prepared runtime at 1/1k/10k without copying historical entries", () => {
    for (const entryCount of [1, 1_000, 10_000]) {
      let states = CanvasPersistentRuntimeMap.empty<{ ready: boolean }>()
      for (let index = 0; index < entryCount; index += 1) {
        states = states.set(`node-${index}`, { ready: true })
      }
      const before = canvasPersistentRuntimeMapWorkCounts()
      const prepared = { ready: true }
      const next = states.set(`prepared-${entryCount}`, prepared)
      const after = canvasPersistentRuntimeMapWorkCounts()
      expect(after.historicalEntryVisits - before.historicalEntryVisits).toBe(0)
      expect(after.pathCopies - before.pathCopies).toBeLessThanOrEqual(64)
      expect(next.size).toBe(entryCount + 1)
      expect(next.get(`prepared-${entryCount}`)).toBe(prepared)
      expect(states.get(`prepared-${entryCount}`)).toBeUndefined()

      const replaced = next.set(`node-${entryCount - 1}`, prepared)
      const replacedAfter = canvasPersistentRuntimeMapWorkCounts()
      expect(replacedAfter.historicalEntryVisits - after.historicalEntryVisits).toBe(0)
      expect(replacedAfter.pathCopies - after.pathCopies).toBeLessThanOrEqual(64)
      expect(replaced.get(`node-${entryCount - 1}`)).toBe(prepared)
    }
  })
})
