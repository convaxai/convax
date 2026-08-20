import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  appendAcceptedFrameWalRecord,
  createAcceptedFrameWalFile,
  encodeAcceptedFrameWalRecord,
  readAcceptedFrameWalBytes,
  scanAcceptedFrameWalFile,
} from "./accepted-frame-wal-file"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

describe("accepted-frame WAL native file", () => {
  test("retains complete records and repairs only a truncated tail", async () => {
    const root = await temporaryRoot()
    const target = path.join(root, "accepted-frames.wal")
    await createAcceptedFrameWalFile(target, bytes("header"))
    const record = encodeAcceptedFrameWalRecord({
      headerBytes: bytes("record"),
      exactFrameBytes: Uint8Array.of(1, 2, 3, 4),
      stateVectorBytes: Uint8Array.of(5, 6),
    })
    const initial = await scanAcceptedFrameWalFile(target, { repairTruncatedTail: false })
    await appendAcceptedFrameWalRecord({
      target,
      expectedByteOffset: initial.validByteLength,
      exactRecordBytes: record,
    })
    const complete = await scanAcceptedFrameWalFile(target, { repairTruncatedTail: false })
    expect(complete.entries).toHaveLength(1)
    const handle = await fs.open(target, "a")
    try {
      await handle.write(record.subarray(0, 11))
      await handle.sync()
    } finally {
      await handle.close()
    }
    const readOnly = await scanAcceptedFrameWalFile(target, { repairTruncatedTail: false })
    expect(readOnly.entries).toHaveLength(1)
    expect(readOnly.repairedTruncatedTail).toBe(false)
    expect((await fs.stat(target)).size).toBeGreaterThan(readOnly.validByteLength)
    const repaired = await scanAcceptedFrameWalFile(target, { repairTruncatedTail: true })
    expect(repaired.entries).toHaveLength(1)
    expect(repaired.repairedTruncatedTail).toBe(true)
    expect((await fs.stat(target)).size).toBe(repaired.validByteLength)
  })

  test.skipIf(process.platform === "win32")(
    "fails closed when the WAL path is replaced by a symlink during append",
    async () => {
      const root = await temporaryRoot()
      const target = path.join(root, "accepted-frames.wal")
      const external = path.join(root, "external.bin")
      const externalBytes = bytes("must-remain-exact")
      await fs.writeFile(external, externalBytes)
      await createAcceptedFrameWalFile(target, bytes("header"))
      const initial = await scanAcceptedFrameWalFile(target, { repairTruncatedTail: false })
      const record = encodeAcceptedFrameWalRecord({
        headerBytes: bytes("record"),
        exactFrameBytes: Uint8Array.of(1),
        stateVectorBytes: Uint8Array.of(2),
      })
      await expect(appendAcceptedFrameWalRecord({
        target,
        expectedByteOffset: initial.validByteLength,
        exactRecordBytes: record,
        async beforeSync() {
          await fs.unlink(target)
          await fs.symlink(external, target)
        },
      })).rejects.toThrow("identity changed")
      expect([...(await fs.readFile(external))]).toEqual([...externalBytes])
      await expect(scanAcceptedFrameWalFile(target, { repairTruncatedTail: false })).rejects.toThrow()
      await expect(readAcceptedFrameWalBytes(target, 0, 1)).rejects.toThrow()
      expect([...(await fs.readFile(external))]).toEqual([...externalBytes])
    },
  )
})

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-accepted-wal-"))
  roots.push(root)
  return root
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
