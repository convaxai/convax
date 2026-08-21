import { describe, expect, test } from "bun:test"
import {
  authxOrigin,
  convaxAuthxProjectId,
  navItems,
  plans,
  plugins,
  projectUserPortalUrl,
  useCases,
  valuePillars,
  workflowChapters,
} from "./landing-content"

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

  test("published plans match the current monthly offering", () => {
    expect(plans.map(({ aiBudgetUsd, key, priceCny }) => ({ aiBudgetUsd, key, priceCny }))).toEqual([
      { key: "free", priceCny: null, aiBudgetUsd: "$1.00" },
      { key: "pro", priceCny: "0.01", aiBudgetUsd: "$20.00" },
      { key: "ultra", priceCny: "672", aiBudgetUsd: "$100.00" },
      { key: "max", priceCny: "1,345", aiBudgetUsd: "$200.00" },
    ])
    expect(plans.every((plan) => plan.details.includes("Monthly budget reset"))).toBe(true)
  })

  test("plan calls to action enter the AuthX-owned ProjectUser Portal", () => {
    expect(plans.map(({ href, key }) => ({ href, key }))).toEqual([
      { key: "free", href: `${authxOrigin}/account/projects/${convaxAuthxProjectId}` },
      { key: "pro", href: projectUserPortalUrl("pro") },
      { key: "ultra", href: projectUserPortalUrl("ultra") },
      { key: "max", href: projectUserPortalUrl("max") },
    ])
    expect(plans.slice(1).every(({ href }) => new URL(href).pathname.endsWith("/plan"))).toBe(true)
  })
})
