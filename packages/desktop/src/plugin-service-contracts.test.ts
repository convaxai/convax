import { describe, expect, test } from "bun:test"

import { parsePluginServiceStatus, pluginServiceStatusSchema } from "./plugin-service-contracts"

function status(overrides: Record<string, unknown> = {}) {
  return {
    account: { availability: "unavailable" },
    credential: { configured: true, verification: "verified" },
    credits: { availability: "unavailable" },
    schema: pluginServiceStatusSchema,
    state: "connected",
    usage: { availability: "unavailable" },
    ...overrides,
  }
}

describe("Plugin service display status", () => {
  test("accepts bounded account, credential, credit, and usage data", () => {
    expect(
      parsePluginServiceStatus(status({
        account: { availability: "available", displayName: "Creative account" },
        credits: { availability: "available", remaining: 128.5, unit: "credits" },
        usage: { availability: "available", consumed: 19, period: "This month", unit: "credits" },
      })),
    ).toEqual({
      account: { availability: "available", displayName: "Creative account" },
      credential: { configured: true, verification: "verified" },
      credits: { availability: "available", remaining: 128.5, unit: "credits" },
      schema: pluginServiceStatusSchema,
      state: "connected",
      usage: { availability: "available", consumed: 19, period: "This month", unit: "credits" },
    })
  })

  test("represents unsupported account and metering data explicitly", () => {
    expect(
      parsePluginServiceStatus(status({
        credential: { configured: false, verification: "unknown" },
        state: "disconnected",
      })),
    ).toMatchObject({
      account: { availability: "unavailable" },
      credits: { availability: "unavailable" },
      usage: { availability: "unavailable" },
    })
  })

  test("rejects extra credential fields, URLs, paths, and arbitrary status diagnostics", () => {
    expect(() =>
      parsePluginServiceStatus(status({
        credential: { accessKey: "must-not-cross-preload", configured: true, verification: "verified" },
      })),
    ).toThrow("unsupported")
    expect(() =>
      parsePluginServiceStatus(status({
        account: { availability: "available", displayName: "https://service.invalid/account" },
      })),
    ).toThrow("without a URL or native path")
    expect(() =>
      parsePluginServiceStatus(status({
        account: { availability: "available", displayName: "C:\\Users\\owner\\credential.json" },
      })),
    ).toThrow("without a URL or native path")
    expect(() => parsePluginServiceStatus({ ...status(), diagnostic: "raw stderr" })).toThrow("unsupported")
    expect(() =>
      parsePluginServiceStatus(status({
        account: { availability: "available", displayName: "Bearer secret-must-not-cross" },
      })),
    ).toThrow("bounded display text")
  })

  test("rejects impossible connection and unbounded numeric states", () => {
    expect(() =>
      parsePluginServiceStatus(status({ credential: { configured: false, verification: "unknown" } })),
    ).toThrow("Connected")
    expect(() =>
      parsePluginServiceStatus(status({ credits: { availability: "available", remaining: Number.POSITIVE_INFINITY, unit: "credits" } })),
    ).toThrow("value is invalid")
    expect(() =>
      parsePluginServiceStatus(status({ usage: { availability: "available", consumed: -1, unit: "credits" } })),
    ).toThrow("value is invalid")
  })
})
