import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

import {
  completedBunTestFailureCount,
  normalizeDesktopTestPath,
  parseDesktopTestShard,
  selectDesktopTestShard,
} from "./desktop-test-shard"

describe("Desktop test sharding", () => {
  test("normalizes Windows test paths before isolated-file classification", () => {
    expect(normalizeDesktopTestPath("src\\main\\isolated.test.ts")).toBe("src/main/isolated.test.ts")
    expect(normalizeDesktopTestPath("src/main/ordinary.test.ts")).toBe("src/main/ordinary.test.ts")
  })

  test("recognizes only a complete Bun test summary and preserves its failure count", () => {
    expect(completedBunTestFailureCount(" 10 pass\n 0 fail\nRan 10 tests across 2 files. [1.00s]\n")).toBe(0)
    expect(completedBunTestFailureCount("\u001B[31m 1 fail\u001B[0m\nRan 3 tests across 1 file. [1.00s]\n")).toBe(1)
    expect(completedBunTestFailureCount(" 10 pass\n 0 fail\n")).toBeUndefined()
  })

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

  test("runs non-Desktop Windows tests once and partitions Desktop without omissions", async () => {
    const repositoryRoot = path.join(import.meta.dir, "..", "..", "..")
    const [workflow, turbo, desktopSuite] = await Promise.all([
      readFile(path.join(repositoryRoot, ".github", "workflows", "package-boundaries.yml"), "utf8"),
      readFile(path.join(repositoryRoot, "turbo.json"), "utf8"),
      readFile(path.join(import.meta.dir, "desktop-test-suite.ts"), "utf8"),
    ])
    const normalizedWorkflow = workflow.replace(/\r\n/gu, "\n")
    const testJob = normalizedWorkflow.split("\n  desktop-package:")[0]?.split("\n  test:")[1]
    const desktopTestTask = turbo.split('"@convax/desktop#test":')[1]?.split("\n    }")[0]

    expect(testJob).toContain("platform: linux\n            test_scope: workspace\n            desktop_shard: 1/1")
    expect(testJob).toContain("platform: windows non-desktop\n            test_scope: non-desktop")
    for (let index = 1; index <= 4; index += 1) {
      expect(testJob).toContain(
        `platform: windows shard ${index}/4\n            test_scope: desktop\n            desktop_shard: ${index}/4`,
      )
    }
    expect(testJob).toContain("run: bun turbo test --filter='!@convax/desktop'")
    expect(testJob).toContain("run: bun --cwd packages/desktop test")
    expect(testJob).toContain("CONVAX_DESKTOP_TEST_SHARD: ${{ matrix.desktop_shard }}")
    expect(desktopTestTask).toContain('"env": ["CONVAX_DESKTOP_TEST_SHARD"]')
    expect(desktopSuite).toContain('"src/main/stdio-mcp-client.test.ts"')
  })
})
