import { describe, expect, test } from "bun:test"

import { assertSelfContainedHookModule } from "./plugin-hook-module-validator"

function source(value: string) {
  return Buffer.from(value, "utf8")
}

describe("Plugin Hook module validator", () => {
  test("accepts one self-contained ESM Hook with static runtime imports", () => {
    expect(() =>
      assertSelfContainedHookModule(
        source(`
          import { createHash } from "node:crypto"
          export const Plugin = async () => ({ digest: createHash("sha256").update("hook").digest("hex") })
        `),
        "Plugin Hook",
      ),
    ).not.toThrow()
  })

  test("rejects missing exports, CommonJS loaders, dynamic imports, and package dependencies", () => {
    for (const invalid of [
      `const Plugin = () => ({})`,
      `export const Plugin = () => require("dependency")`,
      `export const Plugin = () => import("./mutable.js")`,
      `import dependency from "dependency"; export const Plugin = dependency`,
      `import { createRequire } from "node:module"; export const Plugin = createRequire(import.meta.url)`,
    ]) {
      expect(() => assertSelfContainedHookModule(source(invalid), "Plugin Hook")).toThrow()
    }
  })

  test("rejects invalid UTF-8 and non-ESM JavaScript without leaking source bytes", () => {
    expect(() => assertSelfContainedHookModule(Uint8Array.of(0xff), "Plugin Hook")).toThrow("valid UTF-8 JavaScript")
    expect(() => assertSelfContainedHookModule(source("export const ="), "Plugin Hook")).toThrow(
      "valid JavaScript ESM module",
    )
  })
})
