import type { ProjectController, ProjectControllerSnapshot, ProjectRecord } from "@convax/project"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"

import type { PluginServiceStatus, PluginServiceTarget } from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { convaxOnboardingStorageKey, type ConvaxOnboardingStorage } from "./convax-onboarding-model"
import { ConvaxOnboarding, type ConvaxOnboardingProps } from "./convax-onboarding"
import type { PluginServiceCatalogEntry, ServiceCatalogSnapshot } from "./service-catalog-controller"

function status(input: Partial<PluginServiceStatus> = {}): PluginServiceStatus {
  return {
    account: { availability: "available", displayName: "Chen" },
    billing: {
      availability: "available",
      checkout: {
        availability: "available",
        plans: [{ billingInterval: "month", key: "pro-plus", name: "Pro Plus" }],
      },
    },
    credential: { configured: true, verification: "verified" },
    credits: { availability: "available", remaining: 20, unit: "credits" },
    plan: { availability: "available", key: "free", name: "Free" },
    schema: "convax.plugin-service-status/2",
    state: "connected",
    usage: { availability: "available", consumed: 0, unit: "credits" },
    ...input,
  }
}

function service(input: Partial<PluginServiceCatalogEntry> = {}): PluginServiceCatalogEntry {
  return {
    actions: ["authorize", "reauthorize", "authorization.cancel", "checkout", "sign_out"],
    authentication: "authenticated",
    billing: { kind: "free" },
    capabilities: ["llm", "image"],
    description: "Product account",
    kind: "plugin",
    loading: false,
    models: [],
    name: "Convax",
    pluginId: "product-account",
    serviceId: "plugin:product-account",
    state: "connected",
    status: status(),
    target: { pluginId: "product-account", serviceId: "account" },
    version: "1.0.0",
    ...input,
  }
}

function disconnectedService() {
  return service({
    authentication: "required",
    billing: { kind: "unknown" },
    state: "disconnected",
    status: status({
      account: { availability: "unavailable" },
      billing: { availability: "unavailable" },
      credential: { configured: false, verification: "unverified" },
      credits: { availability: "unavailable" },
      plan: { availability: "unavailable" },
      state: "disconnected",
      usage: { availability: "unavailable" },
    }),
  })
}

function serviceSnapshot(
  entry: PluginServiceCatalogEntry,
  input: Partial<ServiceCatalogSnapshot> = {},
): ServiceCatalogSnapshot {
  return { loading: false, services: [entry], ...input }
}

function memoryStorage(initial?: unknown) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(convaxOnboardingStorageKey, JSON.stringify(initial))
  return {
    get parsed() {
      return JSON.parse(values.get(convaxOnboardingStorageKey) ?? "null") as unknown
    },
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies ConvaxOnboardingStorage,
  }
}

function project(id: string, input: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    createdAt: 1,
    id,
    lastOpenedAt: 1,
    name: id,
    rootPath: `/projects/${id}`,
    ...input,
  }
}

function projectController(overrides: Partial<ProjectController> = {}) {
  let current: ProjectControllerSnapshot = {
    activeProjectId: null,
    changingActiveProject: false,
    error: null,
    initialized: true,
    pendingRecoveryProjectId: null,
    projects: [],
  }
  const controller = {
    clearError: mock(() => {
      current = { ...current, error: null }
    }),
    createProject: mock(async () => false),
    getSnapshot: () => current,
    openProject: mock(async () => false),
    subscribe: () => () => undefined,
    ...overrides,
  } as unknown as ProjectController
  return {
    controller,
    setSnapshot(next: Partial<ProjectControllerSnapshot>) {
      current = { ...current, ...next }
    },
  }
}

function props(input: Partial<ConvaxOnboardingProps> = {}): ConvaxOnboardingProps {
  const storage = memoryStorage().storage
  return {
    onEnterProject: async () => true,
    onRefreshServices: async () => undefined,
    onServiceAction: async () => undefined,
    onServiceCheckout: async () => undefined,
    projectController: projectController().controller,
    serviceSnapshot: serviceSnapshot(disconnectedService()),
    storage,
    ...input,
  }
}

async function withDom(run: (root: Root) => Promise<void>) {
  const window = new Window()
  const globals = {
    Element: window.Element,
    Event: window.Event,
    HTMLInputElement: window.HTMLInputElement,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    InputEvent: window.InputEvent,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    document: window.document,
    window,
  }
  const originalGlobalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await run(root)
  } finally {
    await act(async () => root.unmount())
    await window.happyDOM.close()
    for (const [name, descriptor] of originalGlobalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

afterEach(() => {
  mock.restore()
})

describe("ConvaxOnboarding", () => {
  test("leads with the system-browser account path and local Project boundary", () => {
    const markup = renderToStaticMarkup(<ConvaxOnboarding {...props({ locale: "zh-CN" })} />)

    expect(markup).toContain('data-convax-onboarding-step="1"')
    expect(markup).toContain("登录或注册 Convax 账号")
    expect(markup).toContain(">登录</button>")
    expect(markup).toContain("系统浏览器")
    expect(markup).toContain("登录不会自动上传、同步或共享本地 Project")
    expect(markup).not.toContain("Plugin")
    expect(markup).not.toContain("MCP")
  })

  test("defers without completing onboarding and resumes from the bottom-left task", async () => {
    await withDom(async (root) => {
      const progress = memoryStorage()
      await act(async () => {
        root.render(
          <ConvaxOnboarding
            {...props({
              locale: "zh-CN",
              serviceSnapshot: serviceSnapshot(disconnectedService()),
              storage: progress.storage,
            })}
          />,
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>(".convax-onboarding__defer")?.click()
      })

      expect(document.querySelector('[data-convax-onboarding-deferred="true"]')).not.toBeNull()
      expect(document.querySelector('[data-convax-onboarding-task="true"]')?.textContent).toContain("下一步：登录")
      expect(progress.parsed).toEqual({ completed: false, deferred: true, step: "account", version: 2 })

      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-convax-onboarding-task="true"]')?.click()
      })
      expect(document.querySelector('[data-convax-onboarding="true"]')).not.toBeNull()
      expect(document.querySelector('[data-convax-onboarding-task="true"]')).toBeNull()
    })
  })

  test("shows the live resumable step and progress in the deferred task", async () => {
    await withDom(async (root) => {
      const progress = memoryStorage()
      await act(async () => {
        root.render(
          <ConvaxOnboarding
            {...props({
              locale: "zh-CN",
              serviceSnapshot: serviceSnapshot(service()),
              storage: progress.storage,
            })}
          />,
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>(".convax-onboarding__defer")?.click()
      })

      expect(document.querySelector('[data-convax-onboarding-task="true"]')?.textContent).toContain("下一步：选择套餐")
      expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1")
      expect(progress.parsed).toEqual({ completed: false, deferred: true, step: "plan", version: 2 })
    })
  })

  test("shows a recoverable missing account-service state", () => {
    const markup = renderToStaticMarkup(
      <ConvaxOnboarding
        {...props({
          locale: "zh-CN",
          serviceSnapshot: { loading: false, services: [] },
        })}
      />,
    )

    expect(markup).toContain("账号服务暂不可用")
    expect(markup).toContain("刷新")
  })

  test("invokes the provisioned Service authorization without naming a concrete Plugin", async () => {
    await withDom(async (root) => {
      const onServiceAction = mock(async (_target: PluginServiceTarget, _action: WebPluginServiceAction) => undefined)
      await act(async () => {
        root.render(<ConvaxOnboarding {...props({ onServiceAction })} />)
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>(".convax-onboarding__account-card button")?.click()
      })

      expect(onServiceAction).toHaveBeenCalledWith({ pluginId: "product-account", serviceId: "account" }, "authorize")
    })
  })

  test("shows a cancellable browser-pending state and an explicit status refresh", async () => {
    const onServiceAction = mock(async (_target: PluginServiceTarget, _action: WebPluginServiceAction) => undefined)
    const markup = renderToStaticMarkup(
      <ConvaxOnboarding
        {...props({
          locale: "zh-CN",
          onServiceAction,
          serviceSnapshot: serviceSnapshot(disconnectedService(), {
            actions: [
              {
                action: "authorize",
                target: { pluginId: "product-account", serviceId: "account" },
              },
            ],
          }),
        })}
      />,
    )
    expect(markup).toContain('data-convax-onboarding-browser-pending="true"')
    expect(markup).toContain("取消登录")
    expect(markup).toContain("检查登录状态")
  })

  test("renders live plan, credit, interval, and Checkout offer data", () => {
    const markup = renderToStaticMarkup(
      <ConvaxOnboarding {...props({ locale: "zh-CN", serviceSnapshot: serviceSnapshot(service()) })} />,
    )

    expect(markup).toContain('data-convax-onboarding-step="2"')
    expect(markup).toContain("Chen")
    expect(markup).toContain("20 credits")
    expect(markup).toContain("Pro Plus · 月付")
    expect(markup).toContain("订阅 Pro Plus")
    expect(markup).toContain("实时价格与准确权益将在安全的浏览器 Checkout 中显示")
    expect(markup).toContain("继续使用 Free plan")
  })

  test("submits only the advertised Plan key to Checkout", async () => {
    await withDom(async (root) => {
      const onServiceCheckout = mock(async (_target: PluginServiceTarget, _planKey: string) => undefined)
      await act(async () => {
        root.render(<ConvaxOnboarding {...props({ onServiceCheckout, serviceSnapshot: serviceSnapshot(service()) })} />)
      })
      await act(async () => {
        ;[...document.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.includes("Subscribe to Pro Plus"))
          ?.click()
      })

      expect(onServiceCheckout).toHaveBeenCalledWith({ pluginId: "product-account", serviceId: "account" }, "pro-plus")
    })
  })

  test("continues from Free to the ready Project entry without another tutorial", async () => {
    await withDom(async (root) => {
      const progress = memoryStorage()
      await act(async () => {
        root.render(
          <ConvaxOnboarding
            {...props({
              locale: "zh-CN",
              serviceSnapshot: serviceSnapshot(service()),
              storage: progress.storage,
            })}
          />,
        )
      })
      await act(async () => {
        ;[...document.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.includes("继续使用 Free plan"))
          ?.click()
      })

      expect(document.querySelector('[data-project-home-ready-summary="true"]')?.textContent).toContain("Chen")
      expect(document.querySelector('[data-project-home-ready-summary="true"]')?.textContent).toContain("Free")
      expect(document.querySelector('[data-project-action="create"]')?.textContent).toContain("创建第一个项目")
      expect(document.querySelector('[data-project-action="open"]')?.textContent).toContain("打开已有项目")
      expect(progress.parsed).toEqual({ completed: false, deferred: false, step: "ready", version: 2 })
    })
  })

  test("keeps a pending Checkout non-blocking", () => {
    const pending = service({
      status: status({
        billing: {
          availability: "available",
          checkout: {
            availability: "available",
            pending: { checkoutId: "checkout-12345678", planKey: "pro-plus", status: "processing" },
            plans: [{ billingInterval: "month", key: "pro-plus", name: "Pro Plus" }],
          },
        },
      }),
    })
    const markup = renderToStaticMarkup(
      <ConvaxOnboarding {...props({ locale: "zh-CN", serviceSnapshot: serviceSnapshot(pending) })} />,
    )
    expect(markup).toContain("正在确认订阅状态")
    expect(markup).toContain("Checkout 状态：processing")
    expect(markup).toContain("继续使用 Free plan")
    expect(markup).toContain("刷新")
  })

  test("marks onboarding complete only after a Project is entered", async () => {
    await withDom(async (root) => {
      const progress = memoryStorage({ completed: false, deferred: false, step: "ready", version: 2 })
      const harness = projectController()
      const openProject = mock(async () => {
        harness.setSnapshot({ activeProjectId: "opened", projects: [project("opened")] })
        return true
      })
      Object.assign(harness.controller, { openProject })
      const onEnterProject = mock(async () => true)
      await act(async () => {
        root.render(
          <ConvaxOnboarding
            {...props({
              onEnterProject,
              projectController: harness.controller,
              serviceSnapshot: serviceSnapshot(service()),
              storage: progress.storage,
            })}
          />,
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-project-action="open"]')?.click()
      })

      expect(onEnterProject).toHaveBeenCalledWith("opened")
      expect(progress.parsed).toEqual({ completed: true, deferred: false, step: "ready", version: 2 })
    })
  })

  test("finishes resumed onboarding against an already active Project", async () => {
    await withDom(async (root) => {
      const progress = memoryStorage({ completed: false, deferred: true, step: "ready", version: 2 })
      const harness = projectController()
      harness.setSnapshot({ activeProjectId: "current", projects: [project("current")] })
      const onEnterProject = mock(async () => true)
      await act(async () => {
        root.render(
          <ConvaxOnboarding
            {...props({
              forceOpen: true,
              locale: "zh-CN",
              onEnterProject,
              projectController: harness.controller,
              serviceSnapshot: serviceSnapshot(service()),
              storage: progress.storage,
            })}
          />,
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-convax-onboarding-ready="true"] button')?.click()
      })

      expect(onEnterProject).toHaveBeenCalledWith("current")
      expect(progress.parsed).toEqual({ completed: true, deferred: false, step: "ready", version: 2 })
    })
  })

  test("does not repeat the full onboarding after completion", () => {
    const progress = memoryStorage({ completed: true, deferred: false, step: "ready", version: 2 })
    const markup = renderToStaticMarkup(
      <ConvaxOnboarding
        {...props({ serviceSnapshot: serviceSnapshot(disconnectedService()), storage: progress.storage })}
      />,
    )
    expect(markup).toContain('data-project-home="true"')
    expect(markup).toContain("Start with a blank canvas")
    expect(markup).not.toContain('data-convax-onboarding="true"')
  })
})
