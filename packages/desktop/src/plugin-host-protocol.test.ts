import { describe, expect, test } from "bun:test"
import {
  desktopPluginHostProtocol,
  isDesktopPluginHostRequest,
  pluginHostFailure,
  pluginHostSuccess,
} from "./plugin-host-protocol"

describe("desktop plugin host protocol", () => {
  test("accepts only versioned, known host methods", () => {
    expect(isDesktopPluginHostRequest({
      id: "request-1",
      method: "canvas.node.get",
      protocol: desktopPluginHostProtocol,
      type: "request",
    })).toBe(true)
    expect(isDesktopPluginHostRequest({
      id: "request-1",
      method: "canvas.document.writeJson",
      protocol: desktopPluginHostProtocol,
      type: "request",
    })).toBe(false)
    expect(isDesktopPluginHostRequest({
      id: "request-1",
      method: "canvas.node.get",
      protocol: "convax.plugin-host/0",
      type: "request",
    })).toBe(false)
  })

  test("creates serializable success and failure envelopes", () => {
    expect(pluginHostSuccess("request-1", { ok: true })).toEqual({
      id: "request-1",
      ok: true,
      protocol: desktopPluginHostProtocol,
      result: { ok: true },
      type: "response",
    })
    expect(pluginHostFailure("request-2", new Error("denied"))).toEqual({
      error: "denied",
      id: "request-2",
      ok: false,
      protocol: desktopPluginHostProtocol,
      type: "response",
    })
  })
})
