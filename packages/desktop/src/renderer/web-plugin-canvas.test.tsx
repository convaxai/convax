import { describe, expect, mock, test } from "bun:test"

import type { ActiveInstalledWebPluginCanvasSurface } from "../plugin-contracts"
import {
  createWebPluginCanvasContribution,
  scheduleWebPluginFrameConnect,
  webPluginEntryUrl,
  webPluginFrameKey,
  webPluginIframeAllow,
  webPluginIframeInteractionProps,
  webPluginIframeSandbox,
} from "./web-plugin-node-renderer"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"

const plugin = {
  activeRevision: 2,
  activeSetDigest: "a".repeat(64),
  capabilities: [],
  contributes: {
    canvas: {
      renderer: { create: true, height: 420, width: 640 },
    },
  },
  entry: "dist/index.html",
  description: "Fixture",
  hostApi: { major: 2, optional: [], required: [] },
  id: "fixture",
  name: "Fixture",
  snapshotDigest: "b".repeat(64),
  schema: "convax.plugin/8",
  version: "1.0.0",
} as unknown as ActiveInstalledWebPluginCanvasSurface

describe("Web Plugin Canvas transport shell", () => {
  test("keeps the iframe sandbox opaque and denies browser privileges by default", () => {
    expect(webPluginIframeSandbox).toBe("allow-scripts")
    expect(webPluginIframeAllow(plugin)).toContain("camera 'none'")
    expect(webPluginIframeAllow(plugin)).toContain("fullscreen 'none'")
  })

  test("keys and loads one exact ActiveSet snapshot", () => {
    expect(webPluginFrameKey(plugin)).toContain(plugin.activeSetDigest)
    expect(webPluginFrameKey(plugin)).toContain(plugin.snapshotDigest)
    expect(webPluginEntryUrl(plugin)).toStartWith("convax-plugin://")
    expect(webPluginEntryUrl(plugin)).toEndWith("/fixture/1.0.0/dist/index.html")
  })

  test("keeps an iframe inert until its selected host pointer gesture settles", () => {
    expect(
      webPluginIframeInteractionProps({
        dragging: false,
        pointerReleasePending: true,
        selected: true,
      }).style.pointerEvents,
    ).toBe("none")
    expect(
      webPluginIframeInteractionProps({
        dragging: false,
        pointerReleasePending: false,
        selected: true,
      }).style.pointerEvents,
    ).toBe("auto")
  })

  test("schedules one post-load port connection and supports cancellation", () => {
    const callbacks = new Map<number, () => void>()
    let nextId = 1
    const connected = mock(() => undefined)
    const cancel = scheduleWebPluginFrameConnect(connected, {
      cancelFrame: (id) => callbacks.delete(id),
      clearDelay: (id) => callbacks.delete(id),
      requestFrame(callback) {
        const id = nextId++
        callbacks.set(id, callback)
        return id
      },
      setDelay(callback) {
        const id = nextId++
        callbacks.set(id, callback)
        return id
      },
    })
    cancel()
    for (const callback of callbacks.values()) callback()
    expect(connected).not.toHaveBeenCalled()
  })

  test("contribution accepts only a Project routing hint, not a renderer Host implementation", () => {
    const contribution = createWebPluginCanvasContribution(plugin, {
      frameRegistry: new DesktopPluginFrameRegistry(),
      getActiveProjectId: () => "project-1",
      locale: "en",
    })
    expect(contribution.id).toBe("desktop.fixture")
    expect(contribution.renderers).toHaveLength(1)
  })
})
