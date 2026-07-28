import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ApplicationMenu, ApplicationMenuPanel, resolveApplicationMenuPosition } from "./application-menu"
import type { ServiceCatalogSnapshot } from "./service-catalog-controller"

const services: ServiceCatalogSnapshot = {
  loading: false,
  services: [
    {
      authentication: "not-applicable",
      billing: { kind: "free" },
      capabilities: ["llm"],
      description: "OpenCode agent runtime",
      kind: "builtin",
      loading: false,
      models: [],
      name: "OpenCode",
      serviceId: "builtin:opencode",
      state: "connected",
    },
    {
      actions: ["authorize"],
      authentication: "required",
      billing: { kind: "unknown" },
      capabilities: ["image", "video"],
      description: "Creative generation",
      kind: "plugin",
      loading: false,
      models: [],
      name: "小云雀生成",
      pluginId: "xiaoyunque-generation",
      serviceId: "plugin:xiaoyunque-generation",
      state: "disconnected",
      version: "1.0.0",
    },
  ],
}

describe("ApplicationMenu", () => {
  test("uses a local workspace identity instead of pretending an account exists", () => {
    const markup = renderToStaticMarkup(<ApplicationMenuPanel locale="en" onOpenSettings={() => undefined} />)

    expect(markup).toContain("Local workspace")
    expect(markup).toContain("Settings are stored on this device")
    expect(markup).toContain("Skill &amp; Plugin")
    expect(markup).toContain("Services")
    expect(markup).toContain(">CX</span>")
    expect(markup).toContain('data-ui-menu-surface=""')
    expect(markup).not.toContain("Log out")
    expect(markup).not.toContain("Account")
  })

  test("renders the same global entry in the collapsed sidebar", () => {
    const markup = renderToStaticMarkup(<ApplicationMenu compact locale="zh-CN" onOpenSettings={() => undefined} />)

    expect(markup).toContain("打开应用菜单")
    expect(markup).toContain("本地工作区")
  })

  test("places the compact workspace menu below top chrome and above bottom chrome", () => {
    expect(
      resolveApplicationMenuPosition(
        { bottom: 60, left: 320, right: 368, top: 12 },
        { height: 800, width: 1200 },
        true,
      ),
    ).toEqual({ left: 376, top: 68 })
    expect(
      resolveApplicationMenuPosition(
        { bottom: 788, left: 12, right: 60, top: 740 },
        { height: 800, width: 1200 },
        true,
      ),
    ).toEqual({ bottom: 12, left: 68 })
  })

  test("hides disabled build-time entries and their service summaries", () => {
    const markup = renderToStaticMarkup(
      <ApplicationMenuPanel
        featureFlags={{ services: false, skillsAndPlugins: false }}
        locale="en"
        onOpenSettings={() => undefined}
        services={services}
      />,
    )

    expect(markup).toContain("Settings")
    expect(markup).not.toContain("Services")
    expect(markup).not.toContain("Skill &amp; Plugin")
    expect(markup).not.toContain("OpenCode")
    expect(markup).not.toContain("data-application-services")
  })

  test("shows installed services with billing, auth, and capability summaries", () => {
    const markup = renderToStaticMarkup(
      <ApplicationMenuPanel locale="zh-CN" onOpenSettings={() => undefined} services={services} />,
    )

    expect(markup).toContain("OpenCode")
    expect(markup).toContain("免费")
    expect(markup).toContain("LLM")
    expect(markup).toContain("小云雀生成")
    expect(markup).toContain("生图 · 生视频")
    expect(markup).toContain("需要授权")
    expect(markup).not.toContain("Creator")
  })

  test("shows a reported credit balance instead of auth after a Plugin is connected", () => {
    const snapshot: ServiceCatalogSnapshot = {
      loading: false,
      services: [
        {
          ...services.services[1]!,
          authentication: "authenticated",
          billing: { kind: "credits", remaining: 80.5, unit: "积分" },
          state: "connected",
        },
      ],
    }
    const markup = renderToStaticMarkup(
      <ApplicationMenuPanel locale="zh-CN" onOpenSettings={() => undefined} services={snapshot} />,
    )

    expect(markup).toContain("80.5 积分")
    expect(markup).not.toContain(">Auth<")
  })

  test("supports subscription billing without interpreting it as credits", () => {
    const snapshot: ServiceCatalogSnapshot = {
      loading: false,
      services: [
        {
          authentication: "authenticated",
          billing: { kind: "subscription", name: "Pro" },
          capabilities: ["llm"],
          description: "Future subscription service",
          kind: "builtin",
          loading: false,
          models: [],
          name: "Future LLM",
          serviceId: "builtin:future-llm",
          state: "connected",
        },
      ],
    }
    const markup = renderToStaticMarkup(
      <ApplicationMenuPanel locale="en" onOpenSettings={() => undefined} services={snapshot} />,
    )

    expect(markup).toContain("Future LLM")
    expect(markup).toContain(">Pro<")
    expect(markup).not.toContain("remaining")
  })
})
