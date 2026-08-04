import { describe, expect, test } from "bun:test"

import { parseRuntimePluginApiDeclaration } from "@convax/plugin-api"
import { parsePortablePluginSkills, validatePortableSkillToolReferences } from "./skills"

describe("portable Plugin-owned Skills", () => {
  const hostApi = parseRuntimePluginApiDeclaration({
    major: 3,
    optional: [],
    required: ["skill.context.read"],
  })

  test("keeps Skill Host APIs within the top-level declaration", () => {
    const skills = parsePortablePluginSkills(
      [
        {
          name: "timeline-director",
          path: "skills/timeline-director",
          uses: { requiredHostApis: ["skill.context.read"] },
        },
      ],
      hostApi,
    )
    expect(skills?.[0]?.name).toBe("timeline-director")
  })

  test("rejects path/name drift and dangling Plugin tool aliases", () => {
    expect(() =>
      parsePortablePluginSkills(
        [{ name: "timeline-director", path: "skills/other" }],
        hostApi,
      ),
    ).toThrow("must name its Skill directory")
    expect(() =>
      validatePortableSkillToolReferences(
        [
          {
            name: "timeline-director",
            path: "skills/timeline-director",
            uses: { pluginTools: ["missing_tool"] },
          },
        ],
        undefined,
      ),
    ).toThrow("unknown Agent tool")
  })
})
