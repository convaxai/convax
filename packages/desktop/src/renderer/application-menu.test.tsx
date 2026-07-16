import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ApplicationMenu, ApplicationMenuPanel } from "./application-menu"

describe("ApplicationMenu", () => {
  test("uses a local workspace identity instead of pretending an account exists", () => {
    const markup = renderToStaticMarkup(
      <ApplicationMenuPanel locale="en" onOpenSettings={() => undefined} />,
    )

    expect(markup).toContain("Local workspace")
    expect(markup).toContain("Settings are stored on this device")
    expect(markup).toContain("Skill &amp; Plugin")
    expect(markup).toContain(">CX</span>")
    expect(markup).not.toContain("Log out")
    expect(markup).not.toContain("Account")
  })

  test("renders the same global entry in the collapsed sidebar", () => {
    const markup = renderToStaticMarkup(
      <ApplicationMenu compact locale="zh-CN" onOpenSettings={() => undefined} />,
    )

    expect(markup).toContain("打开应用菜单")
    expect(markup).toContain("本地工作区")
  })
})
