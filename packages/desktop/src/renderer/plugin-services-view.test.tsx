import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"

import { pluginServiceStatusSchema } from "../plugin-service-contracts"
import { PluginServiceSignOutConfirmation, PluginServicesSurface } from "./plugin-services-view"
import type { PluginServiceCatalogEntry } from "./service-catalog-controller"
import { filterServiceModels } from "./service-model-filter"

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
  target: { pluginId: "account-tools", serviceId: "account-tools" },
  version: "1.0.0",
}

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    HTMLInputElement: testWindow.HTMLInputElement,
    InputEvent: testWindow.InputEvent,
    KeyboardEvent: testWindow.KeyboardEvent,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

describe("Plugin Services host UI", () => {
  test("distinguishes an unauthorized empty model catalog from a connected empty catalog", () => {
    const unauthorized = renderToStaticMarkup(
      <PluginServicesSurface
        locale="zh-CN"
        onAction={noop}
        onRefresh={noop}
        snapshot={{
          loading: false,
          services: [
            {
              ...baseService,
              actions: ["authorize"],
              authentication: "required",
              models: [],
              state: "disconnected",
            },
          ],
        }}
      />,
    )
    const connectedWithoutModels = renderToStaticMarkup(
      <PluginServicesSurface
        locale="zh-CN"
        onAction={noop}
        onRefresh={noop}
        snapshot={{ loading: false, services: [{ ...baseService, models: [] }] }}
      />,
    )

    expect(unauthorized).toContain("暂未授权，授权后加载模型。")
    expect(unauthorized).not.toContain("小云雀图片")
    expect(connectedWithoutModels).toContain("暂无可用模型。")
  })

  test("opens a concrete Service target directly", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        initialServiceId="plugin:account-tools"
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
              description: "Built in",
              kind: "builtin",
              loading: false,
              models: [],
              name: "OpenCode",
              serviceId: "builtin:opencode",
              state: "connected",
            },
            baseService,
          ],
        }}
      />,
    )

    expect(markup).toContain('data-service-detail="plugin:account-tools"')
    expect(markup).toContain('data-service-directory-item="plugin:account-tools"')
    expect(markup).toContain('aria-current="page"')
  })

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

    expect(markup).toContain(">Free</span>")
    expect(markup).toContain("monthly")
    expect(markup).toContain("Upgrade to Pro")
    expect(markup).toContain('data-service-action="checkout" data-service-action-priority="primary"')
    expect(markup).toContain('data-service-action="sign_out" data-service-action-priority="danger-secondary"')
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
    expect(markup.match(/Not supported or unavailable/g)?.length).toBe(6)
    expect(markup).toContain("does not provide in-app authorization")
    expect(markup).toContain("Sign out")
    expect(markup).not.toContain("Reconfigure")
  })

  test("labels failed credential verification as expired authorization and asks for reauthorization", () => {
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
              authentication: "required",
              state: "attention",
              status: {
                account: { availability: "unavailable" },
                billing: { availability: "unavailable" },
                credential: { configured: true, verification: "failed" },
                credits: { availability: "unavailable" },
                plan: { availability: "unavailable" },
                schema: pluginServiceStatusSchema,
                state: "attention",
                usage: { availability: "unavailable" },
              },
            },
          ],
        }}
      />,
    )

    expect(markup).toContain("鉴权已失效")
    expect(markup).toContain("重新鉴权")
    expect(markup).toContain('data-service-action="reauthorize"')
    expect(markup).not.toContain("验证失败")
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
              usageHistory: {
                availability: "available",
                records: [{ amount: 7 }, { amount: 3 }],
                schema: "convax.plugin-service-usage/1",
                unit: "积分",
              },
              version: "2.0.0",
            },
          ],
        }}
      />,
    )

    expect(markup).toContain("创作账号")
    expect(markup).toContain("额度余额")
    expect(markup).toContain('<span class="tabular-nums">80.5</span> <span dir="auto">积分</span>')
    expect(markup).toContain('<span class="tabular-nums">19</span> <span dir="auto">积分</span>')
    expect(markup).toContain('<span dir="auto">本月</span>')
    expect(markup.match(/data-service-usage-record=/g)).toHaveLength(2)
    expect(markup).toContain("−7 积分")
    expect(markup).toContain("−3 积分")
    expect(markup).toContain("重新配置")
    expect(markup).toContain('data-service-action="reauthorize" data-service-action-priority="primary"')
    expect(markup).toContain('data-service-action="sign_out" data-service-action-priority="danger-secondary"')
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

  test("keeps sign out secondary and requires confirmation before dispatch", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const actions: string[] = []
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <PluginServicesSurface
            locale="en"
            onAction={(_target, action) => actions.push(action)}
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
      })

      const trigger = document.querySelector<HTMLButtonElement>('[data-service-action="sign_out"]')
      expect(trigger?.getAttribute("data-service-action-priority")).toBe("danger-secondary")
      await act(async () => trigger?.click())
      expect(actions).toEqual([])

      const dialog = document.querySelector('[role="alertdialog"]')
      expect(dialog).not.toBeNull()
      const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent?.trim() === "Sign out",
      )
      await act(async () => confirm?.click())
      expect(actions).toEqual(["sign_out"])
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("keeps an explicitly declared cancel action available while browser authorization is pending", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="en"
        onAction={noop}
        onRefresh={noop}
        snapshot={{
          actions: [{ action: "authorize", target: baseService.target }],
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
    expect(markup).toContain("convax-services-workspace")
    expect(markup).toContain('data-services-layout="adaptive-master-detail"')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tabpanel"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('aria-label="Available services"')
    expect(markup).toContain('data-service-directory-item="builtin:opencode"')
    expect(markup).toContain('data-service-detail="builtin:opencode"')
    expect(markup).not.toContain("convax-service-card")
    expect(markup).not.toContain("xl:grid-cols-2")
    expect(markup).not.toContain("min-h-[36rem]")
    expect(markup).not.toContain("shadow-[var(--ui-shadow-low)]")
    expect(markup).not.toContain("Configure")
    expect(markup).not.toContain("Sign out")
  })

  test("renders every model as a fixed five-column capability matrix with only its declared type active", async () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="zh-CN"
        onAction={noop}
        onRefresh={noop}
        snapshot={{ loading: false, services: [baseService] }}
      />,
    )
    const testWindow = new Window({ url: "https://convax.test/" })
    try {
      testWindow.document.body.innerHTML = markup
      const filterLabels = [...testWindow.document.querySelectorAll(".convax-service-model-filter")].map((item) =>
        item.textContent?.trim(),
      )
      expect(filterLabels).toEqual(["全部", "Agent", "文本", "生图", "视频", "音频"])

      const imageRow = testWindow.document.querySelector('[data-service-model="seedream"]')
      const videoRow = testWindow.document.querySelector('[data-service-model="seedance"]')
      expect(imageRow?.querySelectorAll("[data-service-model-capability]")).toHaveLength(5)
      expect(videoRow?.querySelectorAll("[data-service-model-capability]")).toHaveLength(5)
      expect(imageRow?.querySelector('[data-service-model-capability="image"]')?.getAttribute("data-active")).toBe(
        "true",
      )
      expect(imageRow?.querySelector('[data-service-model-capability="video"]')?.getAttribute("data-active")).toBe(
        "false",
      )
      expect(videoRow?.querySelector('[data-service-model-capability="video"]')?.getAttribute("data-active")).toBe(
        "true",
      )
      expect(imageRow?.textContent).toContain("Agent文本生图视频音频")
    } finally {
      await testWindow.happyDOM.close()
    }
  })

  test("filters a model catalog by model, provider, or capability", () => {
    const models = [
      { capability: "llm" as const, id: "zen", name: "North Mini Code", providerName: "OpenCode Zen" },
      { capability: "image" as const, id: "image", name: "Canvas Image" },
    ]

    expect(filterServiceModels(models, "zen")).toEqual([models[0]])
    expect(filterServiceModels(models, "IMAGE")).toEqual([models[1]])
    expect(filterServiceModels(models, "north")).toEqual([models[0]])
    expect(filterServiceModels(models, "  ")).toBe(models)
    expect(filterServiceModels(models, "", "image")).toEqual([models[1]])
  })

  test("bounds a large model catalog and directs people to search", () => {
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
              description: "Built in",
              kind: "builtin",
              loading: false,
              models: Array.from({ length: 60 }, (_, index) => ({
                capability: "llm" as const,
                id: `model-${index}`,
                name: `Model ${index}`,
              })),
              name: "OpenCode",
              serviceId: "builtin:opencode",
              state: "connected",
            },
          ],
        }}
      />,
    )

    expect(markup.match(/data-service-model=/g)).toHaveLength(50)
    expect(markup).toContain("Showing the first 50 of 60 models")
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain(">60 models</span>")
  })

  test("shows a quiet service-level empty state without mounting an empty workspace", () => {
    const markup = renderToStaticMarkup(
      <PluginServicesSurface
        locale="en"
        onAction={noop}
        onRefresh={noop}
        snapshot={{ loading: false, services: [] }}
      />,
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain("No installed Plugin contributes a service.")
    expect(markup).not.toContain("convax-services-workspace")
  })

  test("reports filtered model counts, renders matching results, and exposes an empty result state", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
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
                  description: "Built in",
                  kind: "builtin",
                  loading: false,
                  models: Array.from({ length: 60 }, (_, index) => ({
                    capability: index === 59 ? ("image" as const) : ("llm" as const),
                    id: `model-${index}`,
                    name: `Model ${index}`,
                    providerName: index === 59 ? "Special Provider" : "Standard Provider",
                  })),
                  name: "OpenCode",
                  serviceId: "builtin:opencode",
                  state: "connected",
                },
              ],
            }}
          />,
        )
      })

      const search = document.querySelector<HTMLInputElement>('input[type="search"]')
      const setSearchValue = (value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(search, value)
        search?.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }))
        search?.dispatchEvent(new Event("change", { bubbles: true }))
      }
      expect(search?.getAttribute("aria-controls")).toBeTruthy()
      await act(async () => {
        setSearchValue("Special Provider")
      })

      expect(document.body.textContent).toContain("1 results")
      expect(document.querySelectorAll("[data-service-model]")).toHaveLength(1)
      expect(document.body.textContent).toContain("Model 59")

      await act(async () => {
        setSearchValue("No such model")
      })
      expect(document.body.textContent).toContain("0 results")
      expect(document.body.textContent).toContain("No models match this search.")
      expect(document.querySelectorAll("[data-service-model]")).toHaveLength(0)

      await act(async () => {
        setSearchValue("")
        Array.from(document.querySelectorAll<HTMLButtonElement>(".convax-service-model-filter"))
          .find((button) => button.textContent === "Image")
          ?.click()
      })
      expect(document.body.textContent).toContain("1 results")
      expect(document.querySelectorAll("[data-service-model]")).toHaveLength(1)
      expect(document.body.textContent).toContain("Model 59")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("uses one service directory and switches the focused detail instead of rendering a card wall", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
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
                  description: "Built in",
                  kind: "builtin",
                  loading: false,
                  models: [],
                  name: "OpenCode",
                  serviceId: "builtin:opencode",
                  state: "connected",
                },
                {
                  ...baseService,
                  status: {
                    account: { availability: "available", displayName: "Secondary Account" },
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
      })

      expect(document.querySelector("[data-service-detail]")?.getAttribute("data-service-detail")).toBe(
        "builtin:opencode",
      )
      expect(document.querySelectorAll("[data-service-detail]")).toHaveLength(1)
      expect(document.body.textContent).not.toContain("Secondary Account")

      const accountService = document.querySelector<HTMLButtonElement>(
        '[data-service-directory-item="plugin:account-tools"]',
      )
      const openCodeService = document.querySelector<HTMLButtonElement>(
        '[data-service-directory-item="builtin:opencode"]',
      )
      await act(async () => {
        openCodeService?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }))
      })

      expect(document.querySelector("[data-service-detail]")?.getAttribute("data-service-detail")).toBe(
        "plugin:account-tools",
      )
      expect(document.querySelectorAll("[data-service-detail]")).toHaveLength(1)
      expect(document.body.textContent).toContain("Secondary Account")
      expect(document.activeElement).toBe(accountService)
      expect(accountService?.getAttribute("aria-current")).toBe("page")
      expect(openCodeService?.getAttribute("tabindex")).toBe("-1")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("falls back to the first live service when the selected service disappears", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const builtin = {
      authentication: "not-applicable" as const,
      billing: { kind: "free" as const },
      capabilities: ["llm" as const],
      description: "Built in",
      kind: "builtin" as const,
      loading: false,
      models: [],
      name: "OpenCode",
      serviceId: "builtin:opencode",
      state: "connected" as const,
    }
    const plugin = {
      ...baseService,
      status: {
        account: { availability: "available" as const, displayName: "Secondary Account" },
        billing: { availability: "unavailable" as const },
        credential: { configured: true, verification: "verified" as const },
        credits: { availability: "unavailable" as const },
        plan: { availability: "unavailable" as const },
        schema: pluginServiceStatusSchema,
        state: "connected" as const,
        usage: { availability: "unavailable" as const },
      },
    }
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      const renderServices = (services: readonly (typeof builtin | typeof plugin)[]) => (
        <PluginServicesSurface locale="en" onAction={noop} onRefresh={noop} snapshot={{ loading: false, services }} />
      )
      await act(async () => root?.render(renderServices([builtin, plugin])))
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-service-directory-item="plugin:account-tools"]')?.click()
      })
      expect(document.querySelector("[data-service-detail]")?.getAttribute("data-service-detail")).toBe(
        "plugin:account-tools",
      )

      await act(async () => root?.render(renderServices([builtin])))
      expect(document.querySelector("[data-service-detail]")?.getAttribute("data-service-detail")).toBe(
        "builtin:opencode",
      )
      expect(
        document.querySelector('[data-service-directory-item="builtin:opencode"]')?.getAttribute("aria-current"),
      ).toBe("page")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("defines responsive master-detail breakpoints without a fixed workspace height", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()

    expect(styles).toContain("container: service-surface / inline-size")
    expect(styles).toContain("@container service-surface (min-width: 44rem)")
    expect(styles).toContain("@container service-detail (min-width: 29rem)")
    expect(styles).toContain("flex: 0 0 min(15rem, 82cqw)")
    expect(styles).not.toContain(".convax-services-workspace {\n  min-height:")
    expect(styles).not.toContain(".convax-services-workspace {\n  box-shadow:")
  })
})
