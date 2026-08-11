import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ApplicationTitlebar } from "./application-titlebar"

describe("ApplicationTitlebar", () => {
  test("renders one quiet chrome row above the three workspace columns", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitlebar
        centerAction={<div data-canvas-title>Canvas 1</div>}
        contextLabel="Canvas 1"
        environmentLabel="text-drag"
        homeLabel="Back to Projects"
        leadingActionHostRef={() => undefined}
        onBackToProjects={() => undefined}
        platform="darwin"
        productLabel="Atlas"
        rightAction={<button aria-label="Open agent">Agent</button>}
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
    expect(markup).toContain("relative")
    expect(markup).not.toContain("border-b border-border-subtle")
    expect(markup).toContain("bg-surface-panel")
    expect(markup).not.toContain('aria-label="Back to Projects"')
    expect(markup).not.toContain('data-convax-brand="true"')
    expect(markup).toContain('data-application-product-name=""')
    expect(markup).toContain('title="Atlas"')
    expect(markup).toContain(">Atlas</span>")
    expect(markup).toContain('data-application-titlebar-leading=""')
    expect(markup).toContain('data-application-titlebar-center=""')
    expect(markup).toContain('data-application-titlebar-right=""')
    expect(markup).toContain('data-development-environment-title=""')
    expect(markup).toContain('title="text-drag"')
    expect(markup).toContain('aria-label="Open agent"')
    expect(markup).toContain('data-canvas-title="true"')
    expect(markup).not.toContain('aria-label="Open commands"')
    expect(markup).toContain('data-macos-window-controls="true"')
    expect(markup).toContain('aria-label="Close window"')
    expect(markup).toContain("background-color:#ff5f57")
    expect(markup).toContain("background-color:#febc2e")
    expect(markup).toContain("background-color:#28c840")
    expect(markup).not.toContain("Synthesis map")
    expect(markup).not.toContain("Atlas research")
    expect(markup).not.toContain("aria-expanded=")
    expect(markup).not.toContain("Open details")
    expect(markup).not.toContain("ConvaxBrand")
  })

  test("renders a passive Settings context without a second navigation action", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitlebar
        contextLabel="Settings"
        homeLabel="Back to Projects"
        onBackToProjects={() => undefined}
        platform="win32"
        surface="settings"
      />,
    )

    expect(markup).toContain(">Settings</div>")
    expect(markup).toContain('aria-label="Back to Projects"')
    expect(markup).toContain("lucide-arrow-left")
    expect(markup).not.toContain("pl-[78px]")
    expect(markup).not.toContain("data-macos-window-controls")
    expect(markup).not.toContain("Open details")
  })

  test("omits the redundant product label when the workspace supplies an empty label", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitlebar
        contextLabel="Canvas 1"
        homeLabel="Back to Projects"
        onBackToProjects={() => undefined}
        platform="darwin"
        productLabel=""
        surface="workspace"
      />,
    )

    expect(markup).not.toContain('data-application-product-name=""')
    expect(markup).toContain('data-application-titlebar-leading=""')
  })
})
