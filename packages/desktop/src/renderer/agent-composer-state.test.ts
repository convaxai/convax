import { describe, expect, test } from "bun:test"
import {
  AgentComposerRequestTracker,
  agentComposerSkills,
  agentComposerText,
  closeAgentComposerSuggestion,
  filterAgentSkills,
  filterAgentResourcePickerOptions,
  findAgentComposerQuery,
  findAgentSkillSlashQuery,
  hasAgentComposerContent,
  moveAgentComposerSuggestion,
  normalizeAgentComposerDraft,
  openAgentComposerSuggestion,
  reconcileAgentComposerSuggestionOptions,
  selectableAgentResourcePickerOptions,
  setAgentComposerSuggestionHover,
  shouldDismissAgentResourcePicker,
  shouldShowAgentComposerPlaceholder,
} from "./agent-composer-state"

describe("Agent composer state", () => {
  test("keeps Skill mentions semantic and out of the visible prompt text", () => {
    const draft = {
      segments: [
        { text: "Review this with ", type: "text" as const },
        { name: "code-review", type: "skill" as const },
        { text: " please", type: "text" as const },
        { name: "code-review", type: "skill" as const },
      ],
    }

    expect(agentComposerText(draft)).toBe("Review this with  please")
    expect(agentComposerSkills(draft)).toEqual([{ kind: "skill", name: "code-review" }])
    expect(hasAgentComposerContent(draft)).toBeTrue()
  })

  test("normalizes adjacent text and invalid Skill segments", () => {
    expect(
      normalizeAgentComposerDraft({
        segments: [
          { text: "one", type: "text" },
          { text: " two", type: "text" },
          { name: " ", type: "skill" },
        ],
      }),
    ).toEqual({ segments: [{ text: "one two", type: "text" }] })
  })

  test("recognizes slash queries only at a command boundary", () => {
    expect(findAgentSkillSlashQuery("/la", 3)).toEqual({ end: 3, query: "la", start: 0 })
    expect(findAgentSkillSlashQuery("请用 /飞书", 6)).toEqual({ end: 6, query: "飞书", start: 3 })
    expect(findAgentSkillSlashQuery("line one\n/review", 16)).toEqual({ end: 16, query: "review", start: 9 })
    expect(findAgentSkillSlashQuery("https://example.com/a", 21)).toBeUndefined()
    expect(findAgentSkillSlashQuery("value/total", 11)).toBeUndefined()
  })

  test("recognizes only @ and $ suggestion queries at a command boundary", () => {
    expect(findAgentComposerQuery("@rea", 4)).toEqual({ end: 4, query: "rea", start: 0, trigger: "reference" })
    expect(findAgentComposerQuery("请用 $飞书", 6)).toEqual({ end: 6, query: "飞书", start: 3, trigger: "skill" })
    expect(findAgentComposerQuery("email@example.com", 17)).toBeUndefined()
    expect(findAgentComposerQuery("/review", 7)).toBeUndefined()
  })

  test("reconciles suggestion rows by stable id and wraps keyboard movement", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }]
    const opened = openAgentComposerSuggestion("reference", rows, { kind: "caret" })
    const moved = moveAgentComposerSuggestion(opened, 1, rows)

    expect(moved.activeId).toBe("b")
    expect(moveAgentComposerSuggestion({ ...moved, activeId: "c" }, 1, rows).activeId).toBe("a")
    expect(reconcileAgentComposerSuggestionOptions(moved, [{ id: "b" }]).activeId).toBe("b")
    expect(closeAgentComposerSuggestion()).toEqual({ open: false })
  })

  test("keeps pointer hover separate from keyboard selection and opens tokens in edit mode", () => {
    const opened = openAgentComposerSuggestion("skill", [{ id: "review" }], {
      kind: "token",
      tokenId: "token-1",
    })
    const hovered = setAgentComposerSuggestionHover(opened, "docs")

    expect(opened.mode).toBe("edit")
    expect(hovered).toMatchObject({ activeId: "review", hoveredId: "docs" })
  })

  test("rejects stale inventory requests independently by key and scope", () => {
    const tracker = new AgentComposerRequestTracker()
    const firstRoot = tracker.begin("project-a", "project:")
    const canvas = tracker.begin("project-a", "canvas:one")
    const secondRoot = tracker.begin("project-a", "project:")

    expect(firstRoot()).toBeFalse()
    expect(secondRoot()).toBeTrue()
    expect(canvas()).toBeTrue()
    tracker.invalidate()
    expect(secondRoot()).toBeFalse()
    expect(canvas()).toBeFalse()
  })

  test("filters Skill names and descriptions case-insensitively", () => {
    const skills = [
      { description: "Review a pull request", name: "code-review" },
      { description: "Create a 飞书 document", name: "lark-doc" },
    ]

    expect(filterAgentSkills(skills, "REVIEW").map((skill) => skill.name)).toEqual(["code-review"])
    expect(filterAgentSkills(skills, "飞书").map((skill) => skill.name)).toEqual(["lark-doc"])
  })

  test("uses one query across Skills, project entries, and canvases", () => {
    const options = [
      {
        description: "Review a pull request",
        id: "skill:review",
        label: "code-review",
        resource: { kind: "skill", name: "code-review" } as const,
        section: "skills" as const,
      },
      {
        description: "src/components/picker.tsx",
        id: "file:picker",
        label: "picker.tsx",
        resource: { kind: "file", path: "src/components/picker.tsx" } as const,
        section: "project" as const,
      },
      {
        id: "canvas:launch",
        label: "Launch plan",
        resource: { kind: "resource", uri: "convax://canvas/launch" } as const,
        section: "canvases" as const,
      },
    ]

    expect(filterAgentResourcePickerOptions(options, "pick").map((option) => option.id)).toEqual(["file:picker"])
    expect(filterAgentResourcePickerOptions(options, "launch").map((option) => option.id)).toEqual(["canvas:launch"])
    expect(filterAgentResourcePickerOptions(options, "review").map((option) => option.id)).toEqual(["skill:review"])
  })

  test("keeps keyboard selection aligned with rows hidden by loading sections", () => {
    const options = [
      {
        id: "skill:review",
        label: "review",
        resource: { kind: "skill", name: "review" } as const,
        section: "skills" as const,
      },
      {
        id: "file:readme",
        label: "README.md",
        resource: { kind: "file", path: "README.md" } as const,
        section: "project" as const,
      },
      {
        id: "canvas:main",
        label: "Main",
        resource: { kind: "resource", uri: "convax://canvas/main" } as const,
        section: "canvases" as const,
      },
    ]

    expect(
      selectableAgentResourcePickerOptions(options, { project: true, skills: false }).map((option) => option.id),
    ).toEqual(["skill:review", "canvas:main"])
  })

  test("hides an empty placeholder only while the composer is focused", () => {
    const empty = { segments: [] }
    expect(shouldShowAgentComposerPlaceholder(empty, false)).toBeTrue()
    expect(shouldShowAgentComposerPlaceholder(empty, true)).toBeFalse()
    expect(shouldShowAgentComposerPlaceholder({ segments: [{ text: "Hello", type: "text" }] }, false)).toBeFalse()
  })

  test("dismisses the picker only when focus or pointer leaves its shared surface", () => {
    const popup = { id: "popup" }
    const composer = { id: "composer" }
    const outside = { id: "outside" }
    const surface = { contains: (target: { id: string }) => target === popup || target === composer }

    expect(shouldDismissAgentResourcePicker(surface, popup)).toBeFalse()
    expect(shouldDismissAgentResourcePicker(surface, composer)).toBeFalse()
    expect(shouldDismissAgentResourcePicker(surface, outside)).toBeTrue()
    expect(shouldDismissAgentResourcePicker(surface, null)).toBeTrue()
  })
})
