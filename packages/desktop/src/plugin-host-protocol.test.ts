import { describe, expect, test } from "bun:test"
import { pluginApiCatalog, pluginApiMethodContracts } from "@convax/plugin-api"
import {
  isPluginHostCancel,
  isPluginHostCapabilityInvokeRequest,
  isPluginHostDisconnect,
  pluginHostProtocolV8,
} from "@convax/plugin-sdk/client"
import { PluginHostApiError, PluginHostApiResourceUnavailableError } from "./plugin-host-errors"
import {
  desktopPluginHostProtocolV8,
  isDesktopPluginCapabilityAvailabilityRequest,
  isDesktopPluginCapabilityInvokeRequest,
  isDesktopPluginHostDisconnect,
  isDesktopPluginHostRequest,
  isPluginCapabilityRequest,
  pluginCapabilityApiFailure,
  pluginCapabilityProtocolFailure,
  pluginCapabilityProtocolV3,
  pluginCapabilitySuccess,
  pluginHostFailure,
  pluginHostSuccess,
} from "./plugin-host-protocol"

describe("desktop Plugin protocols", () => {
  test("keeps the iframe ABI and principal transport distinct", () => {
    expect(desktopPluginHostProtocolV8).toBe("convax.plugin-host/8")
    expect(desktopPluginHostProtocolV8).toBe(pluginHostProtocolV8)
    expect(pluginCapabilityProtocolV3).toBe("convax.plugin-capability/3")
    expect(desktopPluginHostProtocolV8).not.toBe(pluginCapabilityProtocolV3)
  })

  test("derives both method allowlists from the Catalog and validates Web params from its contract map", () => {
    for (const definition of pluginApiCatalog.apis) {
      const envelope = {
        id: `request-${definition.id}`,
        method: definition.id,
        type: "request",
      }
      const validWithoutParams = isDesktopPluginHostRequest({
        ...envelope,
        protocol: desktopPluginHostProtocolV8,
      })
      const paramsContract = pluginApiMethodContracts[definition.id].params
      expect(validWithoutParams).toBe(
        paramsContract.type === "none" || (paramsContract.type === "object" && paramsContract.required.length === 0),
      )
      expect(
        isPluginCapabilityRequest({
          ...envelope,
          protocol: pluginCapabilityProtocolV3,
        }),
      ).toBeTrue()
    }
  })

  test("fails closed for unknown methods and every retired protocol", () => {
    const retiredProtocols = [
      ...Array.from({ length: 7 }, (_, index) => `convax.plugin-host/${index + 1}`),
      "convax.plugin-capability/1",
      "convax.plugin-capability/2",
    ]
    for (const protocol of retiredProtocols) {
      const request = {
        id: "request-retired",
        method: "host.context.get",
        protocol,
        type: "request",
      }
      expect(isDesktopPluginHostRequest(request)).toBeFalse()
      expect(isPluginCapabilityRequest(request)).toBeFalse()
    }
    expect(
      isDesktopPluginHostRequest({
        id: "request-unknown",
        method: "canvas.document.writeJson",
        protocol: desktopPluginHostProtocolV8,
        type: "request",
      }),
    ).toBeFalse()
    expect(
      isDesktopPluginHostRequest({
        id: "forbidden-internal-transport",
        method: "host.context.get",
        protocol: pluginCapabilityProtocolV3,
        type: "request",
      }),
    ).toBeFalse()
    expect(
      isPluginCapabilityRequest({
        id: "request-unknown",
        method: "canvas.document.writeJson",
        protocol: pluginCapabilityProtocolV3,
        type: "request",
      }),
    ).toBeFalse()
  })

  test("creates fixed, non-negotiable response envelopes", () => {
    expect(pluginHostSuccess("host-success", { ok: true })).toEqual({
      id: "host-success",
      ok: true,
      protocol: desktopPluginHostProtocolV8,
      result: { ok: true },
      type: "response",
    })
    expect(pluginHostFailure("host-failure", new Error("denied"))).toEqual({
      error: {
        code: "internal-error",
        kind: "protocol",
        message: "Plugin Host request failed",
        recoverable: false,
      },
      id: "host-failure",
      ok: false,
      protocol: desktopPluginHostProtocolV8,
      type: "response",
    })
    expect(pluginCapabilitySuccess("capability-success", {})).toMatchObject({
      protocol: pluginCapabilityProtocolV3,
    })
    expect(pluginCapabilityProtocolFailure("capability-failure", new Error("denied"))).toMatchObject({
      protocol: pluginCapabilityProtocolV3,
    })
  })

  test("admits only the closed sender-scoped disconnect control envelope", () => {
    const disconnect = {
      protocol: desktopPluginHostProtocolV8,
      type: "disconnect",
    }
    expect(isPluginHostDisconnect(disconnect)).toBeTrue()
    expect(isDesktopPluginHostDisconnect(disconnect)).toBeTrue()
    expect(isDesktopPluginHostDisconnect({ ...disconnect, frameId: "forbidden" })).toBeFalse()
    expect(isDesktopPluginHostDisconnect({ ...disconnect, pluginId: "forbidden" })).toBeFalse()
    expect(isDesktopPluginHostDisconnect({ ...disconnect, protocol: pluginCapabilityProtocolV3 })).toBeFalse()
  })

  test("projects admitted Host API failures without leaking diagnostics", () => {
    expect(
      pluginCapabilityApiFailure(
        "permission",
        "projects.list",
        new PluginHostApiError("permission-denied", "secret grant and Plugin identity"),
      ),
    ).toMatchObject({
      error: {
        code: "permission-denied",
        kind: "api",
        message: "Plugin Host API permission was denied",
        recoverable: false,
      },
    })
    expect(
      pluginCapabilityApiFailure(
        "stale",
        "canvas.catalog.list",
        new PluginHostApiError("stale-context", "secret ActiveSet digest"),
      ),
    ).toMatchObject({
      error: {
        code: "stale-context",
        kind: "api",
        message: "Plugin Host API context is stale",
        recoverable: true,
      },
    })
    expect(
      pluginCapabilityApiFailure(
        "resource",
        "canvas.inputs.open",
        new PluginHostApiResourceUnavailableError("secret Project path"),
      ),
    ).toMatchObject({
      error: {
        code: "resource-unavailable",
        kind: "api",
        message: "Plugin Host API resource is unavailable",
        recoverable: true,
      },
    })
    expect(pluginHostFailure("unknown", new Error("private stack and token"))).toMatchObject({
      error: {
        code: "internal-error",
        kind: "protocol",
        message: "Plugin Host request failed",
        recoverable: false,
      },
    })
  })

  test("keeps Plugin-to-Plugin broker envelopes outside the Host API method union", () => {
    const invocation = {
      capabilityId: "video.render",
      id: "invoke-1",
      input: { prompt: "hello" },
      protocol: desktopPluginHostProtocolV8,
      type: "capability-invoke",
    }
    expect(isDesktopPluginCapabilityInvokeRequest(invocation)).toBeTrue()
    expect(isPluginHostCapabilityInvokeRequest(invocation)).toBeTrue()
    expect(
      isDesktopPluginCapabilityAvailabilityRequest({
        capabilityId: "video.render",
        id: "availability-1",
        protocol: desktopPluginHostProtocolV8,
        type: "capability-availability",
      }),
    ).toBeTrue()
    expect(
      isDesktopPluginHostRequest({
        id: "forbidden-method",
        method: "plugin.capability.invoke",
        protocol: desktopPluginHostProtocolV8,
        type: "request",
      }),
    ).toBeFalse()
    const cancel = {
      id: "invoke-1",
      protocol: desktopPluginHostProtocolV8,
      type: "cancel",
    }
    expect(isPluginHostCancel(cancel)).toBeTrue()
    expect(isDesktopPluginCapabilityInvokeRequest({ ...invocation, providerPluginId: "forbidden" })).toBeFalse()
  })
})
