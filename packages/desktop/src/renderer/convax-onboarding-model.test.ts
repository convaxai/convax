import { describe, expect, test } from "bun:test"

import type { PluginServiceStatus } from "../plugin-service-contracts"
import {
  completeConvaxOnboarding,
  convaxOnboardingStorageKey,
  defaultConvaxOnboardingProgress,
  nextConvaxOnboardingProgress,
  readConvaxOnboardingProgress,
  resolveConvaxOnboardingRoute,
  resolveConvaxOnboardingService,
  writeConvaxOnboardingProgress,
} from "./convax-onboarding-model"
import type { PluginServiceCatalogEntry, ServiceCatalogSnapshot } from "./service-catalog-controller"

function status(input: Partial<PluginServiceStatus> = {}): PluginServiceStatus {
  return {
    account: { availability: "available", displayName: "Chen" },
    billing: {
      availability: "available",
      checkout: {
        availability: "available",
        plans: [{ billingInterval: "month", key: "pro", name: "Pro" }],
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

function snapshot(services: ServiceCatalogSnapshot["services"], input: Partial<ServiceCatalogSnapshot> = {}) {
  return { loading: false, services, ...input }
}

describe("Convax onboarding persistence", () => {
  test("defaults malformed or unsupported storage without throwing", () => {
    expect(readConvaxOnboardingProgress({ getItem: () => null })).toEqual(defaultConvaxOnboardingProgress())
    expect(readConvaxOnboardingProgress({ getItem: () => "not-json" })).toEqual(defaultConvaxOnboardingProgress())
    expect(
      readConvaxOnboardingProgress({
        getItem: () => JSON.stringify({ completed: true, step: "billing", version: 2 }),
      }),
    ).toEqual(defaultConvaxOnboardingProgress())
    expect(
      readConvaxOnboardingProgress({
        getItem: () => JSON.stringify({ account: "person@example.com", completed: true, step: "ready", version: 1 }),
      }),
    ).toEqual(defaultConvaxOnboardingProgress())
    expect(readConvaxOnboardingProgress({ getItem: () => " ".repeat(257) })).toEqual(defaultConvaxOnboardingProgress())
  })

  test("persists only the bounded step and completion preference", () => {
    let stored = ""
    const storage = {
      getItem: (key: string) => (key === convaxOnboardingStorageKey ? stored : null),
      setItem: (key: string, value: string) => {
        expect(key).toBe(convaxOnboardingStorageKey)
        stored = value
      },
    }
    const ready = nextConvaxOnboardingProgress(defaultConvaxOnboardingProgress(), "ready")
    expect(writeConvaxOnboardingProgress(storage, ready)).toBeTrue()
    expect(readConvaxOnboardingProgress(storage)).toEqual(ready)
    expect(JSON.parse(stored)).toEqual({ completed: false, step: "ready", version: 1 })

    const completed = completeConvaxOnboarding(ready)
    expect(writeConvaxOnboardingProgress(storage, completed)).toBeTrue()
    expect(readConvaxOnboardingProgress(storage)).toEqual(completed)
  })

  test("fails softly when browser storage is unavailable", () => {
    expect(
      writeConvaxOnboardingProgress(
        {
          setItem: () => {
            throw new Error("quota")
          },
        },
        defaultConvaxOnboardingProgress(),
      ),
    ).toBeFalse()
  })
})

describe("Convax onboarding account service", () => {
  test("selects one service by generic authorization and Checkout capabilities", () => {
    const selected = service()
    const unrelated = service({
      actions: ["authorize", "reauthorize"],
      name: "Another provider",
      pluginId: "other",
      serviceId: "plugin:other",
    })
    expect(resolveConvaxOnboardingService(snapshot([unrelated, selected]))).toEqual({
      kind: "available",
      service: selected,
    })
  })

  test("waits for first inventory and fails closed on missing or ambiguous candidates", () => {
    expect(resolveConvaxOnboardingService(snapshot([], { loading: true }))).toEqual({ kind: "loading" })
    expect(resolveConvaxOnboardingService(snapshot([]))).toEqual({
      kind: "unavailable",
      reason: "missing",
    })
    expect(resolveConvaxOnboardingService(snapshot([service(), service({ pluginId: "second" })]))).toEqual({
      kind: "unavailable",
      reason: "ambiguous",
    })
  })
})

describe("Convax onboarding route", () => {
  test("requires a verified connected account before the Plan or Ready steps", () => {
    const progress = nextConvaxOnboardingProgress(defaultConvaxOnboardingProgress(), "ready")
    const disconnected = service({
      state: "disconnected",
      status: status({
        account: { availability: "unavailable" },
        credential: { configured: false, verification: "unverified" },
        state: "disconnected",
      }),
    })
    expect(resolveConvaxOnboardingRoute(progress, { kind: "available", service: disconnected })).toBe("account")
  })

  test("advances connected Free accounts to Plan and paid accounts to Ready", () => {
    const progress = defaultConvaxOnboardingProgress()
    expect(resolveConvaxOnboardingRoute(progress, { kind: "available", service: service() })).toBe("plan")
    expect(
      resolveConvaxOnboardingRoute(progress, {
        kind: "available",
        service: service({
          billing: { kind: "subscription", name: "Pro" },
          status: status({
            plan: { availability: "available", billingInterval: "month", key: "pro", name: "Pro" },
          }),
        }),
      }),
    ).toBe("ready")
  })

  test("keeps Ready resumable and never reopens a completed onboarding", () => {
    const ready = nextConvaxOnboardingProgress(defaultConvaxOnboardingProgress(), "ready")
    const resolution = { kind: "available" as const, service: service() }
    expect(resolveConvaxOnboardingRoute(ready, resolution)).toBe("ready")
    expect(resolveConvaxOnboardingRoute(completeConvaxOnboarding(ready), resolution)).toBe("complete")
  })
})
