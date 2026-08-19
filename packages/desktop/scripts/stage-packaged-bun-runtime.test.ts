import { describe, expect, test } from "bun:test"
import { assertPackagableBunExecutable, packagedBunExecutableName } from "./stage-packaged-bun-runtime"

describe("Desktop packaged Bun runtime", () => {
  test("uses the executable name expected by the target platform", () => {
    expect(packagedBunExecutableName("darwin")).toBe("bun")
    expect(packagedBunExecutableName("linux")).toBe("bun")
    expect(packagedBunExecutableName("win32")).toBe("bun.exe")
  })

  test("accepts Bun executables and rejects an unrelated backend binary", () => {
    expect(() => assertPackagableBunExecutable({ executable: "/usr/local/bin/bun", platform: "darwin" })).not.toThrow()
    expect(() =>
      assertPackagableBunExecutable({ executable: "/usr/local/bin/bun-debug", platform: "darwin" }),
    ).not.toThrow()
    expect(() => assertPackagableBunExecutable({ executable: "/app/opencode", platform: "darwin" })).toThrow(
      "must run under Bun",
    )
  })
})
