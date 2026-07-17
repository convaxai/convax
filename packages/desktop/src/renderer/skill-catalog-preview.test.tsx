import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { DesktopSkillDetails } from "../skill-management-contracts"
import { buildSkillFileTree, shouldAnimateSkillShowcase, SkillDetailDialog } from "./skill-catalog-preview"

const details: DesktopSkillDetails = {
  description: "Create portable Agent Skills.",
  files: [
    { content: "# Skill Creator\n\nPortable instructions.", kind: "text", path: "SKILL.md", size: 39 },
    { content: "interface:\n  display_name: Skill Creator", kind: "text", path: "agents/openai.yaml", size: 45 },
    { kind: "binary", path: "assets/example.png", size: 2_048 },
    { content: "Review the output.", kind: "text", path: "references/review.md", size: 18 },
  ],
  id: "skill-creator",
  name: "Skill Creator",
  version: "0.2.0",
}

describe("Skill catalog preview", () => {
  test("auto-plays only while visible and motion is allowed", () => {
    expect(shouldAnimateSkillShowcase(true, false)).toBe(true)
    expect(shouldAnimateSkillShowcase(false, false)).toBe(false)
    expect(shouldAnimateSkillShowcase(true, true)).toBe(false)
    expect(shouldAnimateSkillShowcase(false, true)).toBe(false)
  })

  test("builds directories without losing the root SKILL.md entry", () => {
    const tree = buildSkillFileTree(details.files)

    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
      "directory:agents",
      "directory:assets",
      "directory:references",
      "file:SKILL.md",
    ])
    expect(tree[0]?.children[0]?.path).toBe("agents/openai.yaml")
  })

  test("shows the portable bundle tree and a safe plain-text preview", () => {
    const markup = renderToStaticMarkup(
      <SkillDetailDialog
        busy={false}
        details={details}
        error={null}
        installed={false}
        loading={false}
        locale="en"
        onClose={() => undefined}
        onInstall={() => undefined}
        onRetry={() => undefined}
        onUninstall={() => undefined}
        skill={{ description: details.description, id: details.id, installed: false, name: details.name }}
      />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain("z-[120]")
    expect(markup).toContain("Agent Skill")
    expect(markup).toContain("agents")
    expect(markup).toContain("# Skill Creator")
    expect(markup).not.toContain("dangerouslySetInnerHTML")
    expect(markup).toContain("Install Skill")
  })

  test("shows global installed details as read-only without a fake version or mutation action", () => {
    const localDetails: DesktopSkillDetails = {
      description: details.description,
      files: details.files,
      id: details.id,
      name: details.name,
    }
    const markup = renderToStaticMarkup(
      <SkillDetailDialog
        busy={false}
        details={localDetails}
        error={null}
        installed
        loading={false}
        locale="en"
        onClose={() => undefined}
        onInstall={() => undefined}
        onRetry={() => undefined}
        onUninstall={() => undefined}
        readOnly
        skill={{ description: localDetails.description, id: localDetails.id, installed: true, name: localDetails.name }}
      />,
    )

    expect(markup).toContain("Global · read only")
    expect(markup).not.toContain("Install Skill")
    expect(markup).not.toContain("Uninstall")
    expect(markup).not.toContain(">v<")
    expect(markup).not.toContain("vundefined")
  })
})
