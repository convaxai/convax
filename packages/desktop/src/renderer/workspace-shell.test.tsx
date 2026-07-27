import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { WorkspaceShell } from "./workspace-shell"

describe("WorkspaceShell", () => {
  test("keeps the workspace interactive when no blocking surface is active", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked={false}>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain('data-workspace-shell="true"')
    expect(markup).toContain(">Canvas</div>")
    expect(markup).not.toContain("aria-hidden")
    expect(markup).not.toContain("inert")
  })

  test("hides and disables the workspace while a blocking surface is active", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked resizing>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain(" inert=")
    expect(markup).toContain("cursor-col-resize")
    expect(markup).toContain("select-none")
  })

  test("keeps the status bar outside the scrollable workspace row", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked={false} statusBar={<footer data-test-status="true">Ready</footer>}>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain("flex-col")
    expect(markup).toContain("min-h-0 flex-1")
    expect(markup).toContain('data-test-status="true"')
    expect(markup.indexOf("Canvas")).toBeLessThan(markup.indexOf("Ready"))
  })
})
