import { describe, expect, test } from "bun:test"
import type { OwnerStateCommitmentMutation, OwnerStateCommitmentSource } from "@convax/collaboration"
import type { CanvasSnapshot } from "./types"
import {
  CANVAS_STATE_COMMITMENT_DESCRIPTOR,
  canvasStateCommitmentMutations,
  canvasStateCommitmentSource,
  canvasStateCommitmentWorkCounts,
} from "./state-commitment"

describe("Canvas owner state commitment mapping", () => {
  for (const entryCount of [256, 1_024, 4_096]) {
    test(`maps one sealed append without visiting historical entries at N=${entryCount}`, () => {
      const base = syntheticSnapshot(entryCount)
      const beforeCold = canvasStateCommitmentWorkCounts()
      const baseSource = canvasStateCommitmentSource(base, CANVAS_STATE_COMMITMENT_DESCRIPTOR)
      const afterCold = canvasStateCommitmentWorkCounts()
      expect(afterCold.coldSourceEntries - beforeCold.coldSourceEntries).toBe(entryCount)

      const appendedKey = `node-${String(entryCount).padStart(5, "0")}`
      const post = syntheticSnapshot(entryCount + 1)
      const beforeIncremental = canvasStateCommitmentWorkCounts()
      const mutations = canvasStateCommitmentMutations(post, new Map([["nodes", [appendedKey]]]))
      const afterIncremental = canvasStateCommitmentWorkCounts()

      expect(mutations).toHaveLength(1)
      expect(afterIncremental.incrementalChangedKeys - beforeIncremental.incrementalChangedKeys).toBe(1)
      expect(
        afterIncremental.incrementalHistoricalEntries - beforeIncremental.incrementalHistoricalEntries,
      ).toBe(0)
      expect(applySourceMutations(baseSource, mutations)).toEqual(
        normalizeSource(canvasStateCommitmentSource(post, CANVAS_STATE_COMMITMENT_DESCRIPTOR)),
      )
    })
  }
})

function syntheticSnapshot(entryCount: number): CanvasSnapshot {
  const nodes = new Map<string, unknown>()
  for (let index = 0; index < entryCount; index += 1) {
    const key = `node-${String(index).padStart(5, "0")}`
    nodes.set(key, Object.freeze({ key, payload: Object.freeze({ index }) }))
  }
  const empty = () => new Map<string, unknown>()
  return {
    identity: Object.freeze({ canvasId: "synthetic" }),
    meta: Object.freeze({ title: [], description: [], tags: [] }),
    nodes,
    edges: empty(),
    containments: empty(),
    generationBegins: empty(),
    generationTerminals: empty(),
    generationDismissals: empty(),
    generationRecoveryFailures: empty(),
    semanticHistory: empty(),
    operations: empty(),
  } as unknown as CanvasSnapshot
}

function normalizeSource(source: OwnerStateCommitmentSource) {
  return {
    scalars: new Map(source.scalars.map(({ name, value }) => [name, value])),
    collections: new Map(
      source.collections.map(({ name, entries }) => [name, new Map(entries.map(({ key, value }) => [key, value]))]),
    ),
  }
}

function applySourceMutations(
  source: OwnerStateCommitmentSource,
  mutations: readonly OwnerStateCommitmentMutation[],
) {
  const result = normalizeSource(source)
  for (const mutation of mutations) {
    if (mutation.kind === "set-scalar") {
      result.scalars.set(mutation.name, mutation.value)
      continue
    }
    const collection = result.collections.get(mutation.collection)
    if (!collection) throw new Error(`Unknown commitment collection ${mutation.collection}`)
    if (mutation.kind === "delete") collection.delete(mutation.key)
    else collection.set(mutation.key, mutation.value)
  }
  return result
}
