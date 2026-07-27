import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { pluginServiceStatusSchema } from "../plugin-service-contracts"
import { PluginServiceSignOutConfirmation, PluginServicesSurface } from "./plugin-services-view"
import type { PluginServiceCatalogEntry } from "./service-catalog-controller"

const noop = () => undefined
const baseService: Omit<PluginServiceCatalogEntry, "status"> = {
  actions: ["sign_out"],
  authentication: "authenticated",
  billing: { kind: "unknown" },
  capabilities: ["image", "video"],
  description: "Account connection",
  kind: "plugin",
  loading: false,
  models: [
    { capability: "image", id: "seedream", name: "Seedream" },
    { capability: "video", id: "seedance", name: "Seedance" },
  ],
  name: "Account Tools",
  pluginId: "account-tools",
  serviceId: "plugin:account-tools",
  state: "connected",
  version: "1.0.0",
}

describe("Plugin Services host UI", () => {
  test("shows the authoritative Plan and Upgrade action advertised by the Plugin", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="en"
        onAction={noop}
        onCheckout={noop}
        onRefresh={noop}
        snapshot={{
          loading: false,
          services: [
            {
              ...baseService,
              actions: ["checkout", "sign_out"],
              billing: { kind: "free" },
              status: {
                account: { availability: "available", displayName: "Convax" },
                billing: {
                  availability: "available",
                  checkout: {
                    availability: "available",
                    plans: [{ billingInterval: "month", key: "pro", name: "Pro" }],
                  },
                },
                credential: { configured: true, verification: "verified" },
                credits: { availability: "available", remaining: 1000, unit: "quota units" },
                plan: { availability: "available", billingInterval: "month", key: "free", name: "Free" },
                schema: pluginServiceStatusSchema,
                state: "connected",
                usage: { availability: "unavailable" },
              },
            },
          ],
        }}
      />,
    )

    expect(markup).toContain("Free · monthly")
    expect(markup).toContain("Upgrade to Pro")
  })

  test("shows unavailable account and metering explicitly without inventing reauthorization", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="en"
        onAction={noop}
        onRefresh={noop}
        snapshot={{
          loading: false,
          services: [
            {
              ...baseService,
              status: {
                account: { availability: "unavailable" },
                billing: { availability: "unavailable" },
                credential: { configured: true, verification: "verified" },
                credits: { availability: "unavailable" },
                plan: { availability: "unavailable" },
                schema: pluginServiceStatusSchema,
                state: "connected",
                usage: { availability: "unavailable" },
              },
            },
          ],
        }}
      />,
    )

    expect(markup).toContain("Account Tools")
    expect(markup.match(/Not supported or unavailable/g)?.length).toBe(5)
    expect(markup).toContain("does not provide in-app authorization")
    expect(markup).toContain("Sign out")
    expect(markup).not.toContain("Reconfigure")
  })

  test("renders only bounded structured account, credit, and usage values", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="zh-CN"
        onAction={noop}
        onRefresh={noop}
        snapshot={{
          loading: false,
          services: [
            {
              ...baseService,
              actions: ["reauthorize", "sign_out"],
              billing: { kind: "credits", remaining: 80.5, unit: "积分" },
              description: "连接状态",
              name: "账号工具",
              status: {
                account: { availability: "available", displayName: "创作账号" },
                billing: { availability: "unavailable" },
                credential: { configured: true, verification: "verified" },
                credits: { availability: "available", remaining: 80.5, unit: "积分" },
                plan: { availability: "unavailable" },
                schema: pluginServiceStatusSchema,
                state: "connected",
                usage: { availability: "available", consumed: 19, period: "本月", unit: "积分" },
              },
              version: "2.0.0",
            },
          ],
        }}
      />,
    )

    expect(markup).toContain("创作账号")
    expect(markup).toContain("剩余 80.5 积分")
    expect(markup).toContain("已消耗 19 积分 · 本月")
    expect(markup).toContain("重新配置")
  })

  test("requires a host-authored confirmation before local credentials are removed", () => {
    const markup = renderToStaticMarkup(
      <PluginServiceSignOutConfirmation busy={false} locale="en" onCancel={noop} onConfirm={noop} />,
    )

    expect(markup).toContain('role="alertdialog"')
    expect(markup).toContain("remove this Plugin&#x27;s local credential")
    expect(markup).toContain(">Cancel</button>")
    expect(markup).toContain(">Sign out</button>")
  })

  test("keeps an explicitly declared cancel action available while browser authorization is pending", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="en"
        onAction={noop}
        onRefresh={noop}
        snapshot={{
          action: { action: "authorize", pluginId: "account-tools" },
          loading: false,
          services: [
            {
              ...baseService,
              actions: ["authorize", "authorization.cancel"],
              authentication: "required",
              description: "Browser authorization",
              state: "disconnected",
              status: {
                account: { availability: "unavailable" },
                billing: { availability: "unavailable" },
                credential: { configured: false, verification: "unknown" },
                credits: { availability: "unavailable" },
                plan: { availability: "unavailable" },
                schema: pluginServiceStatusSchema,
                state: "disconnected",
                usage: { availability: "unavailable" },
              },
            },
          ],
        }}
      />,
    )

    expect(markup).toContain(">Cancel authorization</button>")
    expect(markup).not.toContain('disabled="">Cancel authorization</button>')
  })

  test("shows built-in OpenCode as a free LLM service with its connected models", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="en"
        onAction={noop}
        onRefresh={noop}
        snapshot={{
          loading: false,
          services: [
            {
              authentication: "not-applicable",
              billing: { kind: "free" },
              capabilities: ["llm"],
              description: "OpenCode agent runtime",
              kind: "builtin",
              loading: false,
              models: [
                {
                  capability: "llm",
                  default: true,
                  id: "opencode/free-model",
                  name: "Free Model",
                  providerName: "OpenCode Zen",
                },
              ],
              name: "OpenCode",
              serviceId: "builtin:opencode",
              state: "connected",
            },
          ],
        }}
      />,
    )

    expect(markup).toContain("OpenCode")
    expect(markup).toContain("Free")
    expect(markup).toContain("LLM")
    expect(markup).toContain("Free Model")
    expect(markup).toContain("OpenCode Zen")
    expect(markup).not.toContain("Configure")
    expect(markup).not.toContain("Sign out")
  })
})
