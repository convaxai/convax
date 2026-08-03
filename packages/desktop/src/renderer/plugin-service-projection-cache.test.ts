import { expect, test } from "bun:test"

import { pluginServiceStatusSchema, pluginServiceUsageSchema } from "../plugin-service-contracts"
import {
  pluginServiceProjectionStorageKey,
  readPluginServiceProjection,
  writePluginServiceProjection,
  type PluginServiceDisplayProjection,
} from "./plugin-service-projection-cache"

function storage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(pluginServiceProjectionStorageKey, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

function projection(): PluginServiceDisplayProjection {
  return {
    services: [
      {
        actions: ["sign_out"],
        capabilities: ["video"],
        description: "A safe service projection",
        models: [{ capability: "video", id: "video.seedance", name: "Seedance" }],
        pluginId: "account-tools",
        pluginName: "Account Tools",
        status: {
          account: { availability: "available", displayName: "Creator" },
          billing: { availability: "unavailable" },
          credential: { configured: true, verification: "verified" },
          credits: { availability: "available", remaining: 12, unit: "credits" },
          plan: { availability: "unavailable" },
          schema: pluginServiceStatusSchema,
          state: "connected",
          usage: { availability: "unavailable" },
        },
        usageHistory: {
          availability: "available",
          records: [{ amount: 3, label: "Video generation", occurredAt: "2026-08-03T08:09:10.000Z" }],
          schema: pluginServiceUsageSchema,
          unit: "credits",
        },
        version: "1.0.0",
      },
    ],
  }
}

test("round-trips the bounded renderer-safe Service projection", () => {
  const target = storage()
  expect(writePluginServiceProjection(target, projection())).toBe(true)
  expect(readPluginServiceProjection(target)).toEqual(projection())
})

test("ignores malformed, oversized, and authority-shaped Service cache entries", () => {
  expect(readPluginServiceProjection(storage("{"))).toBeNull()
  expect(readPluginServiceProjection(storage("x".repeat(512 * 1024 + 1)))).toBeNull()
  expect(
    readPluginServiceProjection(
      storage(
        JSON.stringify({
          projection: {
            services: [{ ...projection().services[0], sourceKey: "renderer-must-not-cache" }],
          },
          schema: "convax.plugin-service-display-cache/1",
        }),
      ),
    ),
  ).toBeNull()
  expect(
    readPluginServiceProjection(
      storage(
        JSON.stringify({
          projection: {
            services: [{ ...projection().services[0], pluginName: "Bearer secret-token-value" }],
          },
          schema: "convax.plugin-service-display-cache/1",
        }),
      ),
    ),
  ).toBeNull()
  expect(
    readPluginServiceProjection(
      storage(
        JSON.stringify({
          projection: {
            services: [{ ...projection().services[0], pluginName: "AK=credential-shaped-value" }],
          },
          schema: "convax.plugin-service-display-cache/1",
        }),
      ),
    ),
  ).toBeNull()
})

test("enforces the cache limit in UTF-8 bytes", () => {
  const services = Array.from({ length: 128 }, (_, index) => ({
    ...projection().services[0],
    actions: [],
    capabilities: [],
    description: "界".repeat(2_000),
    models: [],
    pluginId: `service-${index}`,
    pluginName: `Service ${index}`,
    status: undefined,
    usageHistory: undefined,
  }))

  expect(writePluginServiceProjection(storage(), { services })).toBe(false)
})
