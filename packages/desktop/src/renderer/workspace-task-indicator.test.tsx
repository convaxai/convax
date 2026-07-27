import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { WorkspaceTaskIndicator } from "./workspace-task-indicator"

describe("WorkspaceTaskIndicator", () => {
  test("stays absent with no projected activity", () => {
    expect(
      renderToStaticMarkup(
        <WorkspaceTaskIndicator
          label="Open tasks"
          onOpen={() => undefined}
          summary={{ active: 0, attention: 0, total: 0 }}
        />,
      ),
    ).toBe("")
  })

  test("renders one bounded count and preserves semantic warning color", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceTaskIndicator
        label="Open 2 tasks"
        onOpen={() => undefined}
        summary={{ active: 1, attention: 1, total: 2 }}
      />,
    )

    expect(markup).toContain('data-workspace-task-indicator="true"')
    expect(markup).toContain("text-status-warning")
    expect(markup).toContain(">2</span>")
  })
})
