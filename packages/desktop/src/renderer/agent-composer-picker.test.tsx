import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentComposerPicker, type AgentComposerPickerOption } from "./agent-composer-picker"

const noop = () => undefined

function renderPicker(
  trigger: "reference" | "skill",
  options: AgentComposerPickerOption[],
  overrides: Partial<React.ComponentProps<typeof AgentComposerPicker>> = {},
) {
  return renderToStaticMarkup(
    <AgentComposerPicker
      activeId={options[0]?.id}
      anchor={{ left: 40, top: 120 }}
      onClose={noop}
      onHoverChange={noop}
      onOpenSkill={noop}
      onReferenceTabChange={noop}
      onReferenceRetry={noop}
      onSelect={noop}
      onToggle={noop}
      options={options}
      referenceTab="project"
      trigger={trigger}
      {...overrides}
    />,
  )
}

describe("Agent composer picker", () => {
  test("renders reference tabs and an accessible Convax tree", () => {
    const markup = renderPicker("reference", [
      {
        depth: 0,
        expandable: true,
        expanded: true,
        id: "project:file:README.md",
        kind: "file",
        label: "README.md",
        optionType: "reference",
        resource: { kind: "file", path: "README.md" },
        section: "project",
      },
    ])

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tree"')
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-level="1"')
    expect(markup).toContain('id="agent-composer-option-project:file:README.md"')
    expect(markup).toContain("Project")
    expect(markup).toContain("Canvas")
    expect(markup).toContain("bg-popover")
    expect(markup).toContain("border-border")
    expect(markup).not.toContain("--mpga")
  })

  test("renders Skills as a listbox with dollar identities", () => {
    const markup = renderPicker("skill", [
      {
        description: "Review a change",
        id: "skill:review",
        label: "review",
        optionType: "skill",
        resource: { kind: "skill", name: "review" },
      },
    ])

    expect(markup).toContain('role="listbox"')
    expect(markup).toContain('role="option"')
    expect(markup).toContain("$review")
    expect(markup).toContain("Review a change")
    expect(markup).toContain('aria-label="Open Skill review"')
  })

  test("keeps selectable reference rows visible while one expanded branch loads or fails", () => {
    const options: AgentComposerPickerOption[] = [
      {
        depth: 0,
        expandable: true,
        expanded: true,
        id: "project:directory:Assets",
        kind: "directory",
        label: "Assets",
        optionType: "reference",
        resource: { kind: "directory", path: "Assets" },
        section: "project",
      },
      {
        depth: 0,
        expandable: true,
        expanded: true,
        id: "project:directory:Notes",
        kind: "directory",
        label: "Notes",
        optionType: "reference",
        resource: { kind: "directory", path: "Notes" },
        section: "project",
      },
      {
        depth: 0,
        expandable: false,
        expanded: false,
        id: "project:file:README.md",
        kind: "file",
        label: "README.md",
        optionType: "reference",
        resource: { kind: "file", path: "README.md" },
        section: "project",
      },
    ]
    const markup = renderPicker("reference", options, {
      referenceStatusById: new Map([
        ["project:directory:Assets", { loading: true }],
        ["project:directory:Notes", { error: "Notes unavailable" }],
      ]),
    })

    expect(markup).toContain("Loading Assets")
    expect(markup).toContain("Notes unavailable")
    expect(markup).toContain('aria-label="Retry loading Notes"')
    expect(markup).toContain("README.md")
    expect(markup.match(/role="treeitem"/g)).toHaveLength(3)
  })

  test("renders retryable errors, loading state, and empty state without changing semantics", () => {
    expect(renderPicker("reference", [], { error: "Project files unavailable", onRetry: noop })).toContain(
      "Project files unavailable",
    )
    expect(renderPicker("reference", [], { error: "Project files unavailable", onRetry: noop })).toContain(
      'aria-label="Retry loading suggestions"',
    )
    expect(renderPicker("skill", [], { loading: true })).toContain("Loading Skills")
    expect(renderPicker("reference", [])).toContain("No references found")
  })
})
