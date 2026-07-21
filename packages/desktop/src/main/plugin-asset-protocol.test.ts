import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  createWebPluginAssetHandler,
  isAllowedWebPluginFrameNavigation,
  pluginAssetContentType,
  pluginFrameAncestorSource,
  webPluginFrameBindingForNavigation,
  type WebPluginAssetResolver,
} from "./plugin-asset-protocol"

const temporaryRoots: string[] = []

async function temporaryAsset(name: string, content: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-protocol-"))
  temporaryRoots.push(root)
  const asset = path.join(root, name)
  await fs.mkdir(path.dirname(asset), { recursive: true })
  await fs.writeFile(asset, content)
  return asset
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("Plugin asset protocol", () => {
  test("binds Electron's empty initial subframe URL to its first Plugin navigation", () => {
    expect(
      webPluginFrameBindingForNavigation("", "convax-plugin://director-stage/index.html"),
    ).toBe("director-stage")
    expect(
      webPluginFrameBindingForNavigation("about:blank", "convax-plugin://director-stage/index.html"),
    ).toBe("director-stage")
    expect(
      webPluginFrameBindingForNavigation("", "https://example.invalid/"),
    ).toBeUndefined()
    expect(
      webPluginFrameBindingForNavigation(
        "convax-plugin://director-stage/index.html",
        "convax-plugin://other-plugin/index.html",
      ),
    ).toBe("director-stage")
    expect(
      webPluginFrameBindingForNavigation("", "convax-plugin://other-plugin/index.html", "director-stage"),
    ).toBe("director-stage")
  })

  test("keeps a bound subframe on the exact Plugin origin", () => {
    expect(isAllowedWebPluginFrameNavigation("about:blank", "convax-plugin://director-stage/index.html")).toBeTrue()
    expect(
      isAllowedWebPluginFrameNavigation(
        "convax-plugin://director-stage/index.html",
        "convax-plugin://director-stage/nested/view.html",
      ),
    ).toBeTrue()
    expect(
      isAllowedWebPluginFrameNavigation(
        "convax-plugin://director-stage/index.html",
        "convax-plugin://other-plugin/index.html",
      ),
    ).toBeFalse()
    expect(
      isAllowedWebPluginFrameNavigation("convax-plugin://director-stage/index.html", "https://example.invalid/"),
    ).toBeFalse()
    expect(
      isAllowedWebPluginFrameNavigation("convax-plugin://director-stage/index.html", "data:text/html,escaped"),
    ).toBeFalse()
    expect(
      isAllowedWebPluginFrameNavigation("about:blank", "convax-plugin://other-plugin/index.html", "director-stage"),
    ).toBeFalse()
    expect(
      isAllowedWebPluginFrameNavigation("about:blank", "convax-plugin://director-stage/index.html", "director-stage"),
    ).toBeTrue()
  })

  test("serves only a manager-resolved asset with fixed MIME and defensive headers", async () => {
    const asset = await temporaryAsset("nested/index.html", "<!doctype html><title>Plugin</title>")
    const calls: Array<[string, string]> = []
    const manager: WebPluginAssetResolver = {
      async resolveAsset(pluginId, relativePath) {
        calls.push([pluginId, relativePath])
        return asset
      },
    }
    const handle = createWebPluginAssetHandler(manager, { rendererUrl: "file:///Applications/Convax/index.html" })

    const response = await handle({ url: "convax-plugin://director-stage/nested/index.html" })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("Plugin")
    expect(calls).toEqual([["director-stage", "nested/index.html"]])
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors file:")
  })

  test("rejects ambiguous, malformed, traversal, and Windows-unsafe URLs before lookup", async () => {
    let calls = 0
    const handle = createWebPluginAssetHandler(
      {
        async resolveAsset() {
          calls += 1
          throw new Error("must not resolve")
        },
      },
      { rendererUrl: "http://127.0.0.1:5173/index.html" },
    )

    for (const url of [
      "https://director-stage/index.html",
      "convax-plugin://director-stage/index.html?cache=1",
      "convax-plugin://director-stage/..%2Fsecret.txt",
      "convax-plugin://director-stage/folder%5Csecret.txt",
      "convax-plugin://con/index.html",
      "convax-plugin://director-stage/",
      "convax-plugin://director-stage/%E0%A4%A",
    ]) {
      const response = await handle({ url })
      expect(response.status).toBe(404)
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    }
    expect(calls).toBe(0)
  })

  test("does not follow a replaced final asset symlink", async () => {
    if (process.platform === "win32") return
    const outside = await temporaryAsset("outside.html", "secret")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-protocol-link-"))
    temporaryRoots.push(root)
    const linked = path.join(root, "index.html")
    await fs.symlink(outside, linked)
    const handle = createWebPluginAssetHandler(
      { resolveAsset: async () => linked },
      {
        rendererUrl: "https://desktop.convax.invalid/index.html",
      },
    )

    const response = await handle({ url: "convax-plugin://director-stage/index.html" })

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain("secret")
  })

  test("uses explicit safe content types and exact network frame ancestors", () => {
    expect(pluginAssetContentType("scene.GLTF")).toBe("model/gltf+json")
    expect(pluginAssetContentType("unknown.custom")).toBe("application/octet-stream")
    expect(pluginFrameAncestorSource("https://desktop.convax.invalid:8443/path/index.html")).toBe(
      "https://desktop.convax.invalid:8443",
    )
    expect(pluginFrameAncestorSource("convax-shell://desktop/index.html")).toBe("'none'")
  })
})
