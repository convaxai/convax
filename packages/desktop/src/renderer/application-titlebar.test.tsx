import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ApplicationTitlebar } from "./application-titlebar"

describe("ApplicationTitlebar", () => {
  test("exposes Home, workspace context, and Settings at the application chrome level", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitlebar
        canvasName="Synthesis map"
        contextLabel="Workspace"
        commandsLabel="Open commands"
        homeLabel="Back to Projects"
        onBackToProjects={() => undefined}
        onOpenCommands={() => undefined}
        onOpenSettings={() => undefined}
        platform="darwin"
        projectName="Atlas research"
        settingsLabel="Open Settings"
        surface="workspace"
      />,
    )

    expect(markup).toContain('data-application-titlebar="true"')
    expect(markup).toContain("pl-[78px]")
    expect(markup).toContain('aria-label="Back to Projects"')
    expect(markup).toContain('data-convax-brand="true"')
    expect(markup).toContain('aria-label="Open Settings"')
    expect(markup).toContain('aria-label="Open commands"')
    expect(markup).toContain('aria-label="Atlas research, Synthesis map"')
    expect(markup).not.toContain("aria-expanded=")
    expect(markup).not.toContain("Open details")
    expect(markup).not.toContain("border-b")
  })

  test("renders a passive Settings context and marks Settings as current", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitlebar
        contextLabel="Settings"
        commandsLabel="Open commands"
        homeLabel="Back to Projects"
        onBackToProjects={() => undefined}
        onOpenCommands={() => undefined}
        onOpenSettings={() => undefined}
        platform="win32"
        settingsLabel="Open Settings"
        surface="settings"
      />,
    )

    expect(markup).toContain(">Settings</div>")
    expect(markup).toContain('aria-current="page"')
    expect(markup).not.toContain("pl-[78px]")
    expect(markup).not.toContain("Open details")
  })
})
