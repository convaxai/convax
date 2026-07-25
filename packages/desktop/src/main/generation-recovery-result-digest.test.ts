import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { generationRecoveryResultDigest } from "./generation-recovery-result-digest"

describe("generation recovery result digest", () => {
  test("binds replay identity to normalized content and staged artifact bytes without native paths", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-result-digest-one-"))
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-result-digest-two-"))
    try {
      const firstPath = path.join(firstRoot, "result.bin")
      const secondPath = path.join(secondRoot, "result.bin")
      await Promise.all([
        fs.writeFile(firstPath, "same bytes"),
        fs.writeFile(secondPath, "same bytes"),
      ])
      const resultFor = (filePath: string) => ({
        content: [
          {
            mimeType: "application/octet-stream",
            name: "result.bin",
            type: "resource_link" as const,
            uri: pathToFileURL(filePath).toString(),
          },
        ],
      })
      const first = await generationRecoveryResultDigest(resultFor(firstPath), firstRoot)
      const second = await generationRecoveryResultDigest(resultFor(secondPath), secondRoot)
      expect(first).toBe(second)
      expect(first).toMatch(/^[a-f0-9]{64}$/)

      await fs.writeFile(secondPath, "changed bytes")
      expect(await generationRecoveryResultDigest(resultFor(secondPath), secondRoot)).not.toBe(first)
    } finally {
      await Promise.all([
        fs.rm(firstRoot, { force: true, recursive: true }),
        fs.rm(secondRoot, { force: true, recursive: true }),
      ])
    }
  })

  test("rejects replay artifacts outside the Main-provisioned output directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-result-digest-escape-"))
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside`)
    try {
      await fs.writeFile(outside, "outside")
      await expect(
        generationRecoveryResultDigest(
          {
            content: [
              {
                name: "outside",
                type: "resource_link",
                uri: pathToFileURL(outside).toString(),
              },
            ],
          },
          root,
        ),
      ).rejects.toThrow("escaped")
    } finally {
      await Promise.all([
        fs.rm(root, { force: true, recursive: true }),
        fs.rm(outside, { force: true }),
      ])
    }
  })
})
