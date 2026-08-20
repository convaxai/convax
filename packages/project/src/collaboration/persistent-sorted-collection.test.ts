import { describe, expect, test } from "bun:test"
import {
  createProjectPersistentSortedCollection,
  insertProjectPersistentSortedCollection,
  projectPersistentSortedCollectionCounts,
  projectPersistentSortedCollectionEntries,
} from "./persistent-sorted-collection"

describe("ProjectIndex persistent canonical collection", () => {
  test("keeps consecutive head, middle and tail insertion structural work logarithmic", () => {
    for (const entryCount of [256, 1024, 4096] as const) {
      let collection = createProjectPersistentSortedCollection(
        Array.from({ length: entryCount }, (_, index) => [middleKey(index * 2), index] as const),
      )
      const operationCount = 96
      for (let operation = 0; operation < operationCount; operation += 1) {
        const key = operation % 3 === 0
          ? `a:${String(operationCount - operation).padStart(6, "0")}`
          : operation % 3 === 1
            ? middleKey(operation * 2 + 1)
            : `z:${String(operation).padStart(6, "0")}`
        const before = projectPersistentSortedCollectionCounts()
        collection = insertProjectPersistentSortedCollection(collection, [[key, operation]])
        const after = projectPersistentSortedCollectionCounts()
        const logarithmicHeight = Math.ceil(Math.log2(beforeSize(entryCount, operation) + 2))

        expect(after.fullBuilds - before.fullBuilds).toBe(0)
        expect(after.fullBuildEntryVisits - before.fullBuildEntryVisits).toBe(0)
        expect(after.historicalEntryVisits - before.historicalEntryVisits).toBe(0)
        expect(after.historicalEntryCopies - before.historicalEntryCopies).toBe(0)
        expect(after.flattenEntryVisits - before.flattenEntryVisits).toBe(0)
        expect(after.evidenceEntryVisits - before.evidenceEntryVisits).toBe(0)
        expect(after.incrementalInsertions - before.incrementalInsertions).toBe(1)
        expect(after.insertionComparisons - before.insertionComparisons).toBeLessThanOrEqual(2 * logarithmicHeight + 2)
        expect(after.persistentNodeCopies - before.persistentNodeCopies).toBeLessThanOrEqual(5 * logarithmicHeight + 16)
      }

      const orderedKeys = [...projectPersistentSortedCollectionEntries(collection, "unmeasured")]
        .map(([key]) => key)
      expect(orderedKeys).toEqual([...orderedKeys].sort())
      expect(new Set(orderedKeys).size).toBe(entryCount + operationCount)
    }
  })
})

function middleKey(value: number): string {
  return `m:${String(value).padStart(8, "0")}`
}

function beforeSize(entryCount: number, operation: number): number {
  return entryCount + operation
}
