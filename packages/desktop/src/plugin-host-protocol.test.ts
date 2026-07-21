import { describe, expect, test } from "bun:test"
import {
  desktopPluginHostProtocol,
  desktopPluginHostProtocolForManifestSchema,
  desktopPluginHostProtocolV2,
  desktopPluginHostProtocolV3,
  desktopPluginHostProtocolV4,
  isDesktopPluginHostRequest,
  pluginCapabilityProtocolV1,
  pluginHostFailure,
  pluginHostSuccess,
} from "./plugin-host-protocol"

describe("desktop plugin host protocol", () => {
  test("accepts only versioned, known host methods", () => {
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.node.get",
        protocol: desktopPluginHostProtocol,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.connectedImages.list",
        protocol: desktopPluginHostProtocol,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.connectedImage.read",
        params: { nodeId: "image-1" },
        protocol: desktopPluginHostProtocol,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.document.writeJson",
        protocol: desktopPluginHostProtocol,
        type: "request",
      }),
    ).toBe(false)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "generation.canvas.execute",
        protocol: desktopPluginHostProtocol,
        type: "request",
      }),
    ).toBe(false)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "generation.canvas.execute",
        protocol: desktopPluginHostProtocolV2,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "generation.tools.list",
        protocol: desktopPluginHostProtocolV2,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.node.get",
        protocol: desktopPluginHostProtocolV2,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "generation.canvas.execute",
        protocol: desktopPluginHostProtocolV3,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "generation.canvas.execute",
        protocol: desktopPluginHostProtocolV4,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.transaction.execute",
        protocol: desktopPluginHostProtocolV4,
        type: "request",
      }),
    ).toBe(false)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.transaction.execute",
        protocol: pluginCapabilityProtocolV1,
        type: "request",
      }),
    ).toBe(true)
    expect(
      isDesktopPluginHostRequest({
        id: "request-1",
        method: "canvas.node.get",
        protocol: "convax.plugin-host/0",
        type: "request",
      }),
    ).toBe(false)
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

  test("selects a protocol from the installed manifest schema", () => {
    expect(desktopPluginHostProtocolForManifestSchema("convax.plugin/1")).toBe(desktopPluginHostProtocol)
    expect(desktopPluginHostProtocolForManifestSchema("convax.plugin/2")).toBe(desktopPluginHostProtocolV2)
    expect(desktopPluginHostProtocolForManifestSchema("convax.plugin/3")).toBe(desktopPluginHostProtocolV3)
    expect(desktopPluginHostProtocolForManifestSchema("convax.plugin/4")).toBe(desktopPluginHostProtocolV4)
    expect(desktopPluginHostProtocolForManifestSchema("convax.plugin/5")).toBe(pluginCapabilityProtocolV1)
    expect(pluginHostSuccess("request-v2", {}, desktopPluginHostProtocolV2)).toMatchObject({
      protocol: desktopPluginHostProtocolV2,
    })
    expect(pluginHostFailure("request-v2", "denied", desktopPluginHostProtocolV2)).toMatchObject({
      protocol: desktopPluginHostProtocolV2,
    })
  })
})
