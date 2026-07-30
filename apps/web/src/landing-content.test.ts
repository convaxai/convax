import { describe, expect, test } from "bun:test"
import { navItems, plugins, useCases, valuePillars, workflowChapters } from "./landing-content"

describe("landing page content", () => {
  test("navigation targets unique page sections", () => {
    const targets = navItems.map((item) => item.href)

    expect(new Set(targets).size).toBe(targets.length)
    expect(targets.every((target) => target.startsWith("#"))).toBe(true)
  })

  test("core product story stays complete", () => {
    expect(valuePillars).toHaveLength(3)
    expect(workflowChapters.map((chapter) => chapter.visual)).toEqual(["project", "canvas", "agent", "plugins"])
    expect(plugins.length).toBeGreaterThanOrEqual(4)
    expect(useCases.length).toBeGreaterThanOrEqual(4)
  })
})
