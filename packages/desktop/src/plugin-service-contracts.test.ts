import { describe, expect, test } from "bun:test"

import {
  parsePluginServiceStatus,
  parsePluginServiceUsageHistory,
  pluginServiceStatusSchema,
  pluginServiceUsageSchema,
} from "./plugin-service-contracts"

function status(overrides: Record<string, unknown> = {}) {
  return {
    account: { availability: "unavailable" },
    billing: { availability: "unavailable" },
    credential: { configured: true, verification: "verified" },
    credits: { availability: "unavailable" },
    plan: { availability: "unavailable" },
    schema: pluginServiceStatusSchema,
    state: "connected",
    usage: { availability: "unavailable" },
    ...overrides,
  }
}

describe("Plugin service display status", () => {
  test("accepts bounded account, credential, credit, and usage data", () => {
    expect(
      parsePluginServiceStatus(
        status({
          account: { availability: "available", displayName: "Creative account" },
          credits: { availability: "available", remaining: 128.5, unit: "credits" },
          usage: { availability: "available", consumed: 19, period: "This month", unit: "credits" },
        }),
      ),
    ).toEqual({
      account: { availability: "available", displayName: "Creative account" },
      billing: { availability: "unavailable" },
      credential: { configured: true, verification: "verified" },
      credits: { availability: "available", remaining: 128.5, unit: "credits" },
      plan: { availability: "unavailable" },
      schema: pluginServiceStatusSchema,
      state: "connected",
      usage: { availability: "available", consumed: 19, period: "This month", unit: "credits" },
    })
  })

  test("accepts a bounded Plan and Checkout catalog and rejects the removed v1 schema", () => {
    expect(
      parsePluginServiceStatus(
        status({
          billing: {
            availability: "available",
            checkout: {
              availability: "available",
              pending: { checkoutId: "checkout_12345678", planKey: "pro", status: "created" },
              plans: [{ billingInterval: "month", key: "pro", name: "Pro" }],
            },
            subscriptionStatus: "FREE",
          },
          plan: { availability: "available", billingInterval: "month", key: "free", name: "Free" },
        }),
      ),
    ).toMatchObject({
      billing: {
        availability: "available",
        checkout: {
          availability: "available",
          plans: [{ billingInterval: "month", key: "pro", name: "Pro" }],
        },
      },
      plan: { availability: "available", key: "free", name: "Free" },
    })
    expect(() => parsePluginServiceStatus({ ...status(), schema: "convax.plugin-service-status/1" })).toThrow(
      "schema is invalid",
    )
  })

  test("represents unsupported account and metering data explicitly", () => {
    expect(
      parsePluginServiceStatus(
        status({
          credential: { configured: false, verification: "unknown" },
          state: "disconnected",
        }),
      ),
    ).toMatchObject({
      account: { availability: "unavailable" },
      credits: { availability: "unavailable" },
      usage: { availability: "unavailable" },
    })
  })

  test("rejects extra credential fields, URLs, paths, and arbitrary status diagnostics", () => {
    expect(() =>
      parsePluginServiceStatus(
        status({
          credential: { accessKey: "must-not-cross-preload", configured: true, verification: "verified" },
        }),
      ),
    ).toThrow("unsupported")
    expect(() =>
      parsePluginServiceStatus(
        status({
          account: { availability: "available", displayName: "https://service.invalid/account" },
        }),
      ),
    ).toThrow("without a URL or native path")
    expect(() =>
      parsePluginServiceStatus(
        status({
          account: { availability: "available", displayName: "C:\\Users\\owner\\credential.json" },
        }),
      ),
    ).toThrow("without a URL or native path")
    expect(() => parsePluginServiceStatus({ ...status(), diagnostic: "raw stderr" })).toThrow("unsupported")
    expect(() =>
      parsePluginServiceStatus(
        status({
          account: { availability: "available", displayName: "Bearer secret-must-not-cross" },
        }),
      ),
    ).toThrow("bounded display text")
  })

  test("rejects impossible connection and unbounded numeric states", () => {
    expect(() =>
      parsePluginServiceStatus(status({ credential: { configured: false, verification: "unknown" } })),
    ).toThrow("Connected")
    expect(() =>
      parsePluginServiceStatus(
        status({ credits: { availability: "available", remaining: Number.POSITIVE_INFINITY, unit: "credits" } }),
      ),
    ).toThrow("value is invalid")
    expect(() =>
      parsePluginServiceStatus(status({ usage: { availability: "available", consumed: -1, unit: "credits" } })),
    ).toThrow("value is invalid")
  })
})

describe("Plugin service usage history", () => {
  test("accepts every bounded usage record and preserves order", () => {
    expect(
      parsePluginServiceUsageHistory({
        availability: "available",
        records: [{ amount: 7, label: "Image generation", occurredAt: "2026-08-03T08:09:10.000Z" }, { amount: 3 }],
        schema: pluginServiceUsageSchema,
        unit: "credits",
      }),
    ).toEqual({
      availability: "available",
      records: [{ amount: 7, label: "Image generation", occurredAt: "2026-08-03T08:09:10.000Z" }, { amount: 3 }],
      schema: pluginServiceUsageSchema,
      unit: "credits",
    })
  })

  test("rejects unbounded, secret-bearing, and noncanonical usage records", () => {
    const history = (records: unknown[]) => ({
      availability: "available",
      records,
      schema: pluginServiceUsageSchema,
      unit: "credits",
    })
    expect(() => parsePluginServiceUsageHistory(history(Array.from({ length: 21 }, () => ({ amount: 1 }))))).toThrow(
      "invalid",
    )
    expect(() => parsePluginServiceUsageHistory(history([{ amount: 1, label: "Bearer private-token-value" }]))).toThrow(
      "bounded display text",
    )
    expect(() => parsePluginServiceUsageHistory(history([{ amount: 1, occurredAt: "2026-08-03" }]))).toThrow(
      "timestamp is invalid",
    )
  })
})
