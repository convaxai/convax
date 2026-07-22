import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  packagedOpenCodeExecutableName,
  packagedOpenCodePackagePrefix,
  verifyInstalledExecutableBytes,
} from "./stage-packaged-runtime"

describe("Desktop packaged OpenCode runtime", () => {
  test("uses the executable name expected by the target PATH", () => {
    expect(packagedOpenCodeExecutableName("darwin")).toBe("opencode")
    expect(packagedOpenCodeExecutableName("linux")).toBe("opencode")
    expect(packagedOpenCodeExecutableName("win32")).toBe("opencode.exe")
  })

  test("selects the platform package namespace used by OpenCode", () => {
    expect(packagedOpenCodePackagePrefix("darwin", "arm64")).toBe("opencode-darwin-arm64")
    expect(packagedOpenCodePackagePrefix("linux", "x64")).toBe("opencode-linux-x64")
    expect(packagedOpenCodePackagePrefix("win32", "arm64")).toBe("opencode-windows-arm64")
  })

  test("verifies installed bytes against the matching platform package without executing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-opencode-runtime-test-"))
    try {
      const installed = join(root, "installed")
      const matching = join(root, "matching")
      const other = join(root, "other")
      await Promise.all([
        writeFile(installed, "same OpenCode bytes"),
        writeFile(matching, "same OpenCode bytes"),
        writeFile(other, "different bytes"),
      ])

      await expect(
        verifyInstalledExecutableBytes({
          candidates: [
            { executable: other, packageName: "opencode-darwin-arm64", version: "1.18.1" },
            { executable: matching, packageName: "opencode-darwin-arm64", version: "1.18.1" },
          ],
          expectedVersion: "1.18.1",
          sourceExecutable: installed,
        }),
      ).resolves.toEqual({
        packageName: "opencode-darwin-arm64",
        sha256: "6ba35dfc2951c81f530fa36d202d9a321782f4edb9a4d21446fbf0657593f00b",
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test("rejects platform packages with the wrong version or bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-opencode-runtime-test-"))
    try {
      const installed = join(root, "installed")
      const candidate = join(root, "candidate")
      await writeFile(installed, "installed bytes")
      await writeFile(candidate, "other bytes")

      await expect(
        verifyInstalledExecutableBytes({
          candidates: [{ executable: candidate, packageName: "opencode-darwin-arm64", version: "1.18.0" }],
          expectedVersion: "1.18.1",
          sourceExecutable: installed,
        }),
      ).rejects.toThrow("does not match")
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
