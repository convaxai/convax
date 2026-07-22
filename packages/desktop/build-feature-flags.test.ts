import { describe, expect, test } from "bun:test"
import { resolveDesktopBuildFeatureFlags } from "./build-feature-flags"

describe("resolveDesktopBuildFeatureFlags", () => {
  test("enables every setting by default", () => {
    expect(resolveDesktopBuildFeatureFlags({})).toEqual({
      services: true,
      skillsAndPlugins: true,
    })
  })

  test("allows each setting to be disabled independently at build time", () => {
    expect(
      resolveDesktopBuildFeatureFlags({
        CONVAX_FEATURE_SERVICES: "false",
        CONVAX_FEATURE_SKILLS_AND_PLUGINS: "0",
      }),
    ).toEqual({
      services: false,
      skillsAndPlugins: false,
    })

    expect(
      resolveDesktopBuildFeatureFlags({
        CONVAX_FEATURE_SERVICES: "1",
        CONVAX_FEATURE_SKILLS_AND_PLUGINS: "TRUE",
      }),
    ).toEqual({
      services: true,
      skillsAndPlugins: true,
    })
  })

  test("fails the build for an invalid setting", () => {
    expect(() =>
      resolveDesktopBuildFeatureFlags({
        CONVAX_FEATURE_SERVICES: "disabled",
      }),
    ).toThrow("CONVAX_FEATURE_SERVICES must be one of true, false, 1, or 0")
  })
})
