import { describe, expect, test } from "bun:test"

import { checkoutStatusLabel, metricValue, serviceDescription, serviceStateLabel } from "./service-display-format"
import type { PluginServiceCatalogEntry } from "./service-catalog-controller"

describe("service display formatting", () => {
  test("localizes host-owned service and checkout states", () => {
    expect(serviceStateLabel("zh-CN", "connected")).toBe("已连接")
    expect(serviceStateLabel("en", "attention")).toBe("Needs attention")
    expect(checkoutStatusLabel("zh-CN", "processing")).toBe("正在处理")
    expect(checkoutStatusLabel("en", "converted")).toBe("complete")
  })

  test("uses locale-aware metric grouping", () => {
    expect(metricValue(12_345.625, "en")).toBe("12,345.625")
    expect(metricValue(12_345.625, "zh-CN")).toBe("12,345.625")
  })

  test("does not translate or rewrite Plugin-authored descriptive text", () => {
    const service = {
      actions: [],
      authentication: "unknown",
      billing: { kind: "unknown" },
      capabilities: [],
      description: "ACTIVE · quota units · 2026-07-27T02:30:00Z",
      kind: "plugin",
      loading: false,
      models: [],
      name: "Fixture",
      pluginId: "fixture",
      serviceId: "plugin:fixture",
      state: "unknown",
      target: { pluginId: "fixture", serviceId: "fixture" },
      version: "1.0.0",
    } satisfies PluginServiceCatalogEntry

    expect(serviceDescription("zh-CN", service)).toBe(service.description)
  })
})
