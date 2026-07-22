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
      onReferenceTabChange={noop}
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
        expandable: false,
        expanded: false,
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
    expect(markup).toContain("Project")
    expect(markup).toContain("Canvas")
    expect(markup).toContain("bg-popover")
    expect(markup).toContain("border-border")
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
  })

  test("renders retryable errors, loading state, and empty state without changing semantics", () => {
    expect(renderPicker("reference", [], { error: "Project files unavailable", onRetry: noop })).toContain(
      "Project files unavailable",
    )
    expect(renderPicker("skill", [], { loading: true })).toContain("Loading Skills")
    expect(renderPicker("reference", [])).toContain("No references found")
  })
})
