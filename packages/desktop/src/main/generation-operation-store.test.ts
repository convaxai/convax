import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  GenerationOperationStore,
  generationOperationRequestDigest,
  type GenerationOperationLedger,
} from "./generation-operation-store"

const roots: string[] = []

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-operation-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function ledger(overrides: Partial<GenerationOperationLedger> = {}): GenerationOperationLedger {
  return {
    canvasId: "canvas-one",
    createdAt: 1_000,
    executionBindingDigest: "a".repeat(64),
    inputSnapshotId: "b".repeat(64),
    nodeId: "node-one",
    operationId: "operation-one",
    phase: "prepared",
    pluginPackageDigest: "c".repeat(64),
    projectId: "project-one",
    requestDigest: "d".repeat(64),
    runtimeAuthorizationDigest: "e".repeat(64),
    schema: "convax.generation-operation-ledger/1",
    sidecarRecoveryBindingDigest: "f".repeat(64),
    targetGuardDigest: "1".repeat(64),
    toolId: "creative-tools/image.generate",
    updatedAt: 1_000,
    ...overrides,
  }
}

describe("Generation operation private store", () => {
  test("publishes atomically under a hashed scoped key and round-trips exact state", async () => {
    const root = await temporaryRoot()
    let now = 1_000
    const store = new GenerationOperationStore(root, { now: () => now })
    const stored = await store.create(ledger())
    expect(stored.updatedAt).toBe(1_000)
    expect(await store.read(stored)).toEqual(stored)

    const entries = await fs.readdir(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatch(/^[a-f0-9]{64}\.json$/)
    expect(entries[0]).not.toContain("operation-one")

    now = 2_000
    const accepted = await store.transition(stored, {
      phase: "accepted",
      taskId: "task_123",
    })
    expect(accepted).toMatchObject({ phase: "accepted", taskId: "task_123", updatedAt: 2_000 })
    expect(await store.list()).toEqual([accepted])
  })

  test("rejects request mismatches, illegal phase regressions, and changed task receipts", async () => {
    const store = new GenerationOperationStore(await temporaryRoot())
    const stored = await store.create(ledger())
    await expect(store.create(ledger({ requestDigest: "2".repeat(64) }))).rejects.toThrow("request digest")
    const accepted = await store.transition(stored, { phase: "accepted", taskId: "task_123" })
    await expect(store.transition(accepted, { phase: "prepared" })).rejects.toThrow("transition")
    await expect(store.transition(accepted, { phase: "accepted", taskId: "task_456" })).rejects.toThrow(
      "different task id",
    )
    const failed = await store.transition(accepted, { phase: "failed" })
    const acknowledged = await store.transition(failed, { phase: "acknowledged" })
    expect(acknowledged.phase).toBe("acknowledged")
    await expect(store.transition(acknowledged, { phase: "failed" })).rejects.toThrow("transition")
  })

  test("fails closed on symlink roots, corrupt bytes, unknown fields, credentials, and native paths", async () => {
    const outer = await temporaryRoot()
    const target = path.join(outer, "target")
    const link = path.join(outer, "link")
    await fs.mkdir(target)
    await fs.symlink(target, link)
    await expect(new GenerationOperationStore(link).create(ledger())).rejects.toThrow("symlink")

    const root = path.join(outer, "store")
    const store = new GenerationOperationStore(root)
    const stored = await store.create(ledger())
    const [name] = await fs.readdir(root)
    await fs.writeFile(path.join(root, name!), JSON.stringify({ ...stored, token: "secret" }))
    await expect(store.read(stored)).rejects.toThrow("invalid")

    await expect(store.create(ledger({ toolId: "/Users/example/private/model" }))).rejects.toThrow("unsafe")
    await expect(store.create(ledger({ operationId: "authorization-token" }))).rejects.toThrow("unsafe")
  })

  test("canonical request digests are key-order independent and distinguish any semantic change", () => {
    const left = generationOperationRequestDigest({ a: 1, nested: { z: true, b: "two" } })
    const reordered = generationOperationRequestDigest({ nested: { b: "two", z: true }, a: 1 })
    const changed = generationOperationRequestDigest({ nested: { b: "three", z: true }, a: 1 })
    expect(left).toBe(reordered)
    expect(left).not.toBe(changed)
  })

  test("bounds the total private ledger count before accepting another operation", async () => {
    const store = new GenerationOperationStore(await temporaryRoot(), { maxRecords: 1 })
    await store.create(ledger())
    await expect(
      store.create(ledger({ nodeId: "node-two", operationId: "operation-two" })),
    ).rejects.toThrow("record limit")
  })
})
