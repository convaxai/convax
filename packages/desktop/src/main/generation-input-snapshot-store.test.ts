import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { GenerationInputSnapshotStore } from "./generation-input-snapshot-store"

const roots: string[] = []

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-inputs-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("Generation immutable input snapshots", () => {
  test("publishes canonical request and immutable file bytes then verifies replay", async () => {
    const outer = await temporaryRoot()
    const source = path.join(outer, "source.png")
    await fs.writeFile(source, Buffer.from("stable-input"))
    const store = new GenerationInputSnapshotStore(path.join(outer, "snapshots"))
    const snapshot = await store.create({
      files: [{ logicalName: "reference-1.png", sourcePath: source }],
      request: { operationId: "operation-one", prompt: "Draw a fox" },
    })

    const replay = await store.open(snapshot.id)
    expect(replay.request).toEqual({ operationId: "operation-one", prompt: "Draw a fox" })
    expect(replay.files).toHaveLength(1)
    expect(await fs.readFile(replay.files[0]!.path, "utf8")).toBe("stable-input")

    await fs.writeFile(source, Buffer.from("changed-source"))
    expect(await fs.readFile((await store.open(snapshot.id)).files[0]!.path, "utf8")).toBe("stable-input")
  })

  test("detects tampering and rejects unsafe names, symlink sources, and oversized input", async () => {
    const outer = await temporaryRoot()
    const source = path.join(outer, "source.bin")
    await fs.writeFile(source, Buffer.from("input"))
    const store = new GenerationInputSnapshotStore(path.join(outer, "snapshots"), { maxOperationBytes: 8 })

    await expect(
      store.create({ files: [{ logicalName: "../escape", sourcePath: source }], request: {} }),
    ).rejects.toThrow("logical name")
    const link = path.join(outer, "source-link")
    await fs.symlink(source, link)
    await expect(
      store.create({ files: [{ logicalName: "reference.bin", sourcePath: link }], request: {} }),
    ).rejects.toThrow("symbolic")
    await fs.writeFile(source, Buffer.alloc(9))
    await expect(
      store.create({ files: [{ logicalName: "reference.bin", sourcePath: source }], request: {} }),
    ).rejects.toThrow("size")

    await fs.writeFile(source, Buffer.from("input"))
    const snapshot = await store.create({
      files: [{ logicalName: "reference.bin", sourcePath: source }],
      request: { prompt: "safe" },
    })
    const opened = await store.open(snapshot.id)
    await fs.chmod(opened.files[0]!.path, 0o600)
    await fs.writeFile(opened.files[0]!.path, Buffer.from("other"))
    await expect(store.open(snapshot.id)).rejects.toThrow("digest")
  })

  test("bounds total retained snapshot bytes and releases capacity after acknowledgement cleanup", async () => {
    const outer = await temporaryRoot()
    const source = path.join(outer, "source.bin")
    await fs.writeFile(source, Buffer.alloc(400))
    const root = path.join(outer, "snapshots")
    const store = new GenerationInputSnapshotStore(root, {
      maxOperationBytes: 1_024,
      maxTotalBytes: 1_100,
    })
    const first = await store.create({
      files: [{ logicalName: "first.bin", sourcePath: source }],
      request: { operationId: "operation-one" },
    })
    await expect(
      store.create({
        files: [{ logicalName: "second.bin", sourcePath: source }],
        request: { operationId: "operation-two" },
      }),
    ).rejects.toThrow("total store size")
    await store.remove(first.id)
    await expect(
      store.create({
        files: [{ logicalName: "second.bin", sourcePath: source }],
        request: { operationId: "operation-two" },
      }),
    ).resolves.toMatchObject({ request: { operationId: "operation-two" } })
  })
})
