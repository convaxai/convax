import { describe, expect, test } from "bun:test"

import {
  comparePortablePluginVersions,
  parsePortablePluginId,
  parsePortablePluginRelativePath,
  parsePortablePluginVersion,
} from "./primitives"

describe("portable Plugin identity and path primitives", () => {
  test("validates SemVer precedence without accepting loose versions", () => {
    expect(parsePortablePluginVersion("1.2.3-beta.1+build.7")).toBe(
      "1.2.3-beta.1+build.7",
    )
    expect(comparePortablePluginVersions("1.2.3-beta.1", "1.2.3")).toBeLessThan(0)
    expect(() => parsePortablePluginVersion("v1.2.3")).toThrow("valid SemVer")
  })

  test("rejects non-portable identities, traversal, and Windows-reserved paths", () => {
    expect(parsePortablePluginId("timeline-tools")).toBe("timeline-tools")
    expect(parsePortablePluginRelativePath("web/index.html")).toBe("web/index.html")
    expect(() => parsePortablePluginId("TimelineTools")).toThrow("kebab-case")
    expect(() => parsePortablePluginRelativePath("../index.html")).toThrow(
      "portable relative path",
    )
    expect(() => parsePortablePluginRelativePath("web/CON.html")).toThrow(
      "invalid Windows filename",
    )
  })
})
