import { describe, expect, test } from "bun:test"
import {
  AgentComposerCompositionController,
  AgentComposerRequestTracker,
  agentComposerResources,
  agentComposerText,
  closeAgentComposerSuggestion,
  filterAgentSkills,
  findAgentComposerQuery,
  hasAgentComposerContent,
  moveAgentComposerSuggestion,
  normalizeAgentComposerDraft,
  openAgentComposerSuggestion,
  reconcileAgentComposerSuggestionOptions,
  resolveAgentComposerSuggestionOption,
  setAgentComposerSuggestionHover,
  shouldDismissAgentResourcePicker,
  shouldShowAgentComposerPlaceholder,
} from "./agent-composer-state"

describe("Agent composer state", () => {
  test("keeps resources at their sentence position and projects prompt inputs", () => {
    const draft = {
      segments: [
        { text: "Compare ", type: "text" as const },
        { resource: { kind: "file" as const, name: "A", path: "a.md" }, type: "resource" as const },
        { text: " with ", type: "text" as const },
        { resource: { kind: "skill" as const, name: "review" }, type: "resource" as const },
      ],
    }

    expect(agentComposerText(draft)).toBe("Compare  with ")
    expect(agentComposerResources(draft)).toEqual([
      { kind: "file", name: "A", path: "a.md" },
      { kind: "skill", name: "review" },
    ])
    expect(hasAgentComposerContent(draft)).toBeTrue()
  })

  test("normalizes adjacent text and invalid resource segments", () => {
    expect(
      normalizeAgentComposerDraft({
        segments: [
          { text: "one", type: "text" },
          { text: " two", type: "text" },
          { resource: { kind: "skill", name: " " }, type: "resource" },
        ],
      }),
    ).toEqual({ segments: [{ text: "one two", type: "text" }] })
  })

  test("keeps multiple Skills visible and lets submission deduplicate later", () => {
    const draft = normalizeAgentComposerDraft({
      segments: [
        { resource: { kind: "skill", name: "review" }, type: "resource" },
        { resource: { kind: "skill", name: "review" }, type: "resource" },
        { resource: { kind: "skill", name: "docs" }, type: "resource" },
      ],
    })

    expect(draft.segments).toHaveLength(3)
    expect(agentComposerResources(draft)).toHaveLength(3)
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
    const empty = openAgentComposerSuggestion("reference", [], { kind: "caret" })
    expect(reconcileAgentComposerSuggestionOptions(empty, [])).toBe(empty)
    expect(resolveAgentComposerSuggestionOption(empty, [])).toBeUndefined()
    expect(reconcileAgentComposerSuggestionOptions({ ...moved, activeId: "missing" }, rows).activeId).toBe("a")
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
    const assets = tracker.begin("project-a", "project:Assets")
    const canvas = tracker.begin("project-a", "canvas:one")
    const secondRoot = tracker.begin("project-a", "project:")
    const otherProject = tracker.begin("project-b", "project:")

    expect(firstRoot()).toBeFalse()
    expect(secondRoot()).toBeTrue()
    expect(assets()).toBeTrue()
    expect(canvas()).toBeTrue()
    expect(otherProject()).toBeTrue()
    tracker.invalidate()
    expect(secondRoot()).toBeFalse()
    expect(assets()).toBeFalse()
    expect(canvas()).toBeFalse()
    expect(otherProject()).toBeFalse()
  })

  test("suppresses query refreshes throughout IME composition and refreshes once after commit", () => {
    const controller = new AgentComposerCompositionController()
    const scheduled: Array<() => void> = []
    let refreshes = 0
    const refresh = () => {
      refreshes += 1
    }
    const schedule = (callback: () => void) => {
      scheduled.push(callback)
      return () => {
        const index = scheduled.indexOf(callback)
        if (index >= 0) scheduled.splice(index, 1)
      }
    }

    controller.start()
    expect(controller.runWhenIdle(refresh)).toBeFalse()
    expect(controller.runWhenIdle(refresh)).toBeFalse()
    controller.finish(refresh, schedule)
    expect(controller.runWhenIdle(refresh)).toBeFalse()
    expect(refreshes).toBe(0)
    scheduled.shift()?.()
    expect(refreshes).toBe(1)
    expect(controller.runWhenIdle(refresh)).toBeTrue()
    expect(refreshes).toBe(2)
  })

  test("filters Skill names and descriptions case-insensitively", () => {
    const skills = [
      { description: "Review a pull request", name: "code-review" },
      { description: "Create a 飞书 document", name: "lark-doc" },
    ]

    expect(filterAgentSkills(skills, "REVIEW").map((skill) => skill.name)).toEqual(["code-review"])
    expect(filterAgentSkills(skills, "飞书").map((skill) => skill.name)).toEqual(["lark-doc"])
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
    const surface = { contains: (target: { id: string }) => target === composer }
    const portal = { contains: (target: { id: string }) => target === popup }

    expect(shouldDismissAgentResourcePicker(surface, popup, portal)).toBeFalse()
    expect(shouldDismissAgentResourcePicker(surface, composer)).toBeFalse()
    expect(shouldDismissAgentResourcePicker(surface, outside, portal)).toBeTrue()
    expect(shouldDismissAgentResourcePicker(surface, null)).toBeTrue()
  })
})
