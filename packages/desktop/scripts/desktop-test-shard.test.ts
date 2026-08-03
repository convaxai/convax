import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { parseDesktopTestShard, selectDesktopTestShard } from "./desktop-test-shard"

describe("Desktop test sharding", () => {
  test("runs the complete suite when no shard is configured", () => {
    const shard = parseDesktopTestShard(undefined)

    expect(shard).toEqual({ index: 1, total: 1 })
    expect(selectDesktopTestShard(["a", "b", "c"], shard)).toEqual(["a", "b", "c"])
  })

  test("partitions a stable file list without omissions or overlap", () => {
    const files = ["a", "b", "c", "d", "e"]
    const first = selectDesktopTestShard(files, parseDesktopTestShard("1/2"))
    const second = selectDesktopTestShard(files, parseDesktopTestShard("2/2"))

    expect(first).toEqual(["a", "c", "e"])
    expect(second).toEqual(["b", "d"])
    expect([...first, ...second].sort()).toEqual(files)
  })

  test("rejects malformed, empty, reversed, and excessive shard ranges", () => {
    for (const value of ["0/2", "1/0", "3/2", "1 / 2", "1/17", "all"]) {
      expect(() => parseDesktopTestShard(value)).toThrow("CONVAX_DESKTOP_TEST_SHARD must be INDEX/TOTAL")
    }
  })

  test("keeps the Windows quality matrix bound to both Desktop shards", async () => {
    const repositoryRoot = path.join(import.meta.dir, "..", "..", "..")
    const [workflow, turbo] = await Promise.all([
      readFile(path.join(repositoryRoot, ".github", "workflows", "package-boundaries.yml"), "utf8"),
      readFile(path.join(repositoryRoot, "turbo.json"), "utf8"),
    ])
    const normalizedWorkflow = workflow.replace(/\r\n/gu, "\n")
    const testJob = normalizedWorkflow.split("\n  desktop-package:")[0]?.split("\n  test:")[1]
    const desktopTestTask = turbo.split('"@convax/desktop#test":')[1]?.split("\n    }")[0]

    expect(testJob).toContain("desktop_shard: 1/1")
    expect(testJob).toContain("platform: windows shard 1/2\n            desktop_shard: 1/2")
    expect(testJob).toContain("platform: windows shard 2/2\n            desktop_shard: 2/2")
    expect(testJob).toContain("CONVAX_DESKTOP_TEST_SHARD: ${{ matrix.desktop_shard }}")
    expect(desktopTestTask).toContain('"env": ["CONVAX_DESKTOP_TEST_SHARD"]')
  })
})
