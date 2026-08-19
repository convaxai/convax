import { describe, expect, test } from "bun:test"

import { createDshPocElectronBuilderConfig } from "./electron-builder.dsh-poc.config"

describe("DSH adoption-gate package", () => {
  test("boots the isolation smoke with DSH and an independent Bun but no OpenCode runtime", () => {
    const config = createDshPocElectronBuilderConfig({})
    expect(config.extraMetadata?.main).toBe("./out/main/dsh-project-process-smoke.cjs")
    expect(config.directories?.output).toBe("dist/dsh-poc")
    expect(config.extraResources).toEqual(
      expect.arrayContaining([
        { from: ".packaging/runtime/bun", to: "bun", filter: ["**/*"] },
        {
          from: ".packaging/runtime/dsh",
          to: "dsh-runtime",
          filter: ["dsh-project-utility.js", "package.json", "runtime.json"],
        },
        {
          from: ".packaging/runtime/dsh/node_modules",
          to: "dsh-runtime/node_modules",
          filter: ["**/*"],
        },
      ]),
    )
    expect((config.extraResources as Array<{ to?: string }>).some((resource) => resource.to === "opencode")).toBe(false)
  })
})
