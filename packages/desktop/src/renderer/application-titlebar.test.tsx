import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ApplicationTitlebar } from "./application-titlebar"

describe("ApplicationTitlebar", () => {
  test("overlays one transparent chrome row across the whole workspace", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitlebar
        contextLabel="Workspace"
        commandsLabel="Open commands"
        homeLabel="Back to Projects"
        onBackToProjects={() => undefined}
        onOpenCommands={() => undefined}
        platform="darwin"
        surface="workspace"
        windowControls={{
          closeLabel: "Close window",
          fullScreenLabel: "Toggle full screen",
          groupLabel: "Window controls",
          minimizeLabel: "Minimize window",
          onClose: () => undefined,
          onMinimize: () => undefined,
          onToggleFullScreen: () => undefined,
        }}
      />,
    )

    expect(markup).toContain('data-application-titlebar="true"')
    expect(markup).toContain("pl-[78px]")
    expect(markup).toContain("absolute inset-x-0 top-0")
    expect(markup).toContain("bg-transparent")
    expect(markup).toContain('aria-label="Back to Projects"')
    expect(markup).toContain('data-convax-brand="true"')
    expect(markup).toContain('aria-label="Open commands"')
    expect(markup).toContain('data-macos-window-controls="true"')
    expect(markup).toContain('aria-label="Close window"')
    expect(markup).toContain("background-color:#ff5f57")
    expect(markup).toContain("background-color:#febc2e")
    expect(markup).toContain("background-color:#28c840")
    expect(markup).not.toContain("Synthesis map")
    expect(markup).not.toContain("Atlas research")
    expect(markup).not.toContain("aria-expanded=")
    expect(markup).not.toContain("Open details")
    expect(markup).not.toContain(" border-b ")
  })

  test("renders a passive Settings context without a second navigation action", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitlebar
        contextLabel="Settings"
        commandsLabel="Open commands"
        homeLabel="Back to Projects"
        onBackToProjects={() => undefined}
        onOpenCommands={() => undefined}
        platform="win32"
        surface="settings"
      />,
    )

    expect(markup).toContain(">Settings</div>")
    expect(markup).not.toContain('aria-current="page"')
    expect(markup).not.toContain("pl-[78px]")
    expect(markup).not.toContain("data-macos-window-controls")
    expect(markup).not.toContain("Open details")
  })
})
