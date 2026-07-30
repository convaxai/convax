import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { webPluginAssetUrl, type WebPluginAssetRuntimeIdentity } from "../plugin-asset-contract"
import {
  createWebPluginAssetHandler,
  isAllowedWebPluginFrameNavigation,
  pluginAssetContentType,
  pluginFrameAncestorSource,
  webPluginFrameBindingForNavigation,
  type WebPluginAssetResolver,
} from "./plugin-asset-protocol"

const temporaryRoots: string[] = []
const runtimeA: {
  activeRevision: number
  activeSetDigest: string
  id: string
  snapshotDigest: string
  version: string
} = {
  activeRevision: 7,
  activeSetDigest: "a".repeat(64),
  id: "director-stage",
  snapshotDigest: "b".repeat(64),
  version: "1.2.3",
}
const runtimeB = {
  ...runtimeA,
  activeRevision: 8,
  activeSetDigest: "c".repeat(64),
  snapshotDigest: "d".repeat(64),
}

function assetUrl(relativePath: string, runtime = runtimeA) {
  return webPluginAssetUrl(runtime, relativePath)
}

async function temporaryAsset(name: string, content: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-protocol-"))
  temporaryRoots.push(root)
  const asset = path.join(root, name)
  await fs.mkdir(path.dirname(asset), { recursive: true })
  await fs.writeFile(asset, content)
  return asset
}

function assetResolver(
  resolveAsset: (relativePath: string, identity: WebPluginAssetRuntimeIdentity) => Promise<string>,
  plugin: {
    capabilities: string[]
    hostApi?: { major: 1; optional: string[]; required: string[] }
    id: string
    schema: string
  } = {
    capabilities: [],
    id: "director-stage",
    schema: "convax.plugin/8",
  },
) {
  return {
    async acquirePluginSnapshot(identity: WebPluginAssetRuntimeIdentity) {
      return {
        identity: {
          ...identity,
          version: identity.pluginVersion,
        },
        plugin,
        release() {},
        resolveAsset: (relativePath: string) => resolveAsset(relativePath, identity),
      }
    },
  } satisfies WebPluginAssetResolver
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("Plugin asset protocol", () => {
  test("binds Electron's empty initial subframe URL to its first Plugin navigation", () => {
    const bindingA = webPluginFrameBindingForNavigation("", assetUrl("index.html"))
    expect(bindingA).toBeDefined()
    expect(webPluginFrameBindingForNavigation("about:blank", assetUrl("index.html"))).toBe(bindingA)
    expect(webPluginFrameBindingForNavigation("", "https://example.invalid/")).toBeUndefined()
    expect(
      webPluginFrameBindingForNavigation(
        assetUrl("index.html"),
        webPluginAssetUrl({ ...runtimeA, id: "other-plugin" }, "index.html"),
      ),
    ).toBe(bindingA)
    expect(webPluginFrameBindingForNavigation("", assetUrl("index.html", runtimeB), bindingA)).toBe(bindingA)
  })

  test("keeps a bound subframe on the exact Plugin snapshot generation", () => {
    const entryA = assetUrl("index.html")
    const nestedA = assetUrl("nested/view.html")
    const entryB = assetUrl("index.html", runtimeB)
    const bindingA = webPluginFrameBindingForNavigation("", entryA)
    expect(isAllowedWebPluginFrameNavigation("about:blank", entryA)).toBeTrue()
    expect(isAllowedWebPluginFrameNavigation(entryA, nestedA)).toBeTrue()
    expect(isAllowedWebPluginFrameNavigation(entryA, entryB)).toBeFalse()
    expect(
      isAllowedWebPluginFrameNavigation(entryA, webPluginAssetUrl({ ...runtimeA, id: "other-plugin" }, "index.html")),
    ).toBeFalse()
    expect(isAllowedWebPluginFrameNavigation(entryA, "https://example.invalid/")).toBeFalse()
    expect(isAllowedWebPluginFrameNavigation(entryA, "data:text/html,escaped")).toBeFalse()
    expect(isAllowedWebPluginFrameNavigation("about:blank", entryB, bindingA)).toBeFalse()
    expect(isAllowedWebPluginFrameNavigation("about:blank", entryA, bindingA)).toBeTrue()
  })

  test("serves only a manager-resolved asset with fixed MIME and defensive headers", async () => {
    const asset = await temporaryAsset("nested/index.html", "<!doctype html><title>Plugin</title>")
    const calls: Array<[WebPluginAssetRuntimeIdentity, string]> = []
    const manager = assetResolver(async (relativePath, identity) => {
      calls.push([identity, relativePath])
      return asset
    })
    const handle = createWebPluginAssetHandler(manager, { rendererUrl: "file:///Applications/Convax/index.html" })

    const response = await handle({ url: assetUrl("nested/index.html") })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("Plugin")
    expect(calls).toEqual([
      [
        {
          activeRevision: runtimeA.activeRevision,
          activeSetDigest: runtimeA.activeSetDigest,
          pluginId: runtimeA.id,
          pluginVersion: runtimeA.version,
          snapshotDigest: runtimeA.snapshotDigest,
        },
        "nested/index.html",
      ],
    ])
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors file:")
    expect(response.headers.get("content-security-policy")).not.toContain("convax-connected-media:")
  })

  test("opens the connected-media CSP source only for an exact declared and granted v8 surface", async () => {
    const asset = await temporaryAsset("index.html", "<!doctype html>")
    let authorized = true
    let declared = true
    let schema = "convax.plugin/8"
    const handle = createWebPluginAssetHandler(
      {
        async acquirePluginSnapshot(identity) {
          return {
            identity: {
              ...identity,
              version: identity.pluginVersion,
            },
            plugin: {
              capabilities: authorized ? ["canvas.connectedMedia.stream"] : [],
              hostApi: {
                major: 1,
                optional: declared ? ["canvas.inputs.open"] : [],
                required: ["host.context.get"],
              },
              id: "director-stage",
              schema,
            },
            release() {},
            resolveAsset: async () => asset,
          }
        },
      },
      { rendererUrl: "file:///Applications/Convax/index.html" },
    )
    const allowed = await handle({ url: assetUrl("index.html") })
    expect(allowed.headers.get("content-security-policy")).toContain(
      "media-src 'self' data: blob: convax-connected-media:",
    )
    expect(allowed.headers.get("content-security-policy")).toContain("img-src 'self' data: blob:;")
    authorized = false
    const denied = await handle({ url: assetUrl("index.html") })
    expect(denied.headers.get("content-security-policy")).not.toContain("convax-connected-media:")
    authorized = true
    declared = false
    const undeclared = await handle({ url: assetUrl("index.html") })
    expect(undeclared.headers.get("content-security-policy")).not.toContain("convax-connected-media:")
    declared = true
    schema = "convax.plugin/7"
    const legacy = await handle({ url: assetUrl("index.html") })
    expect(legacy.headers.get("content-security-policy")).not.toContain("convax-connected-media:")
  })

  test("projects the connected-image grant into img-src without widening media-src", async () => {
    const asset = await temporaryAsset("index.html", "<!doctype html>")
    let authorized = true
    let declared = true
    const handle = createWebPluginAssetHandler(
      {
        async acquirePluginSnapshot(identity) {
          return {
            identity: {
              ...identity,
              version: identity.pluginVersion,
            },
            plugin: {
              capabilities: authorized ? ["canvas.connectedImages.read"] : [],
              hostApi: {
                major: 1,
                optional: declared ? ["canvas.inputs.image.open"] : [],
                required: ["host.context.get"],
              },
              id: "director-stage",
              schema: "convax.plugin/8",
            },
            release() {},
            resolveAsset: async () => asset,
          }
        },
      },
      { rendererUrl: "file:///Applications/Convax/index.html" },
    )

    const allowed = await handle({ url: assetUrl("index.html") })
    expect(allowed.headers.get("content-security-policy")).toContain(
      "img-src 'self' data: blob: convax-connected-media:",
    )
    expect(allowed.headers.get("content-security-policy")).toContain("media-src 'self' data: blob:;")

    authorized = false
    const denied = await handle({ url: assetUrl("index.html") })
    expect(denied.headers.get("content-security-policy")).not.toContain("convax-connected-media:")

    authorized = true
    declared = false
    const undeclared = await handle({ url: assetUrl("index.html") })
    expect(undeclared.headers.get("content-security-policy")).not.toContain("convax-connected-media:")
  })

  test("projects custom Pet assets only onto an exact declared and granted v8 Pet surface", async () => {
    const asset = await temporaryAsset("pet/index.html", "<!doctype html>")
    let authorized = true
    let contributed = true
    let schema = "convax.plugin/8"
    const handle = createWebPluginAssetHandler(
      {
        async acquirePluginSnapshot(identity) {
          return {
            identity: {
              ...identity,
              version: identity.pluginVersion,
            },
            plugin: {
              capabilities: authorized
                ? ["pet.activity.read", "pet.activity.open", "pet.preferences.write", "pet.custom.manage"]
                : ["pet.activity.read", "pet.activity.open", "pet.preferences.write"],
              contributes: contributed
                ? {
                    pet: {
                      library: "pet-library.json",
                      overlay: "pet/index.html",
                      protocol: "convax.pet-host/1" as const,
                      settings: "settings/index.html",
                    },
                  }
                : {},
              hostApi: { major: 1, optional: [], required: [] },
              id: "director-stage",
              schema,
            },
            release() {},
            resolveAsset: async () => asset,
          }
        },
      },
      { rendererUrl: "file:///Applications/Convax/index.html" },
    )

    for (const relativePath of ["pet/index.html", "settings/index.html"]) {
      const allowed = await handle({ url: assetUrl(relativePath) })
      const policy = allowed.headers.get("content-security-policy")
      expect(policy).toContain("img-src 'self' data: blob: convax-pet-asset:")
      expect(policy).toContain("media-src 'self' data: blob:;")
      expect(policy).toContain("connect-src 'none'")
      expect(policy).not.toContain("convax-connected-media:")
    }

    const unrelatedDocument = await handle({ url: assetUrl("other/index.html") })
    expect(unrelatedDocument.headers.get("content-security-policy")).not.toContain("convax-pet-asset:")

    authorized = false
    const denied = await handle({ url: assetUrl("pet/index.html") })
    expect(denied.headers.get("content-security-policy")).not.toContain("convax-pet-asset:")

    authorized = true
    contributed = false
    const undeclared = await handle({ url: assetUrl("pet/index.html") })
    expect(undeclared.headers.get("content-security-policy")).not.toContain("convax-pet-asset:")

    contributed = true
    schema = "convax.plugin/7"
    const legacy = await handle({ url: assetUrl("pet/index.html") })
    expect(legacy.headers.get("content-security-policy")).not.toContain("convax-pet-asset:")
  })

  test("rejects ambiguous, malformed, traversal, and Windows-unsafe URLs before lookup", async () => {
    let calls = 0
    const handle = createWebPluginAssetHandler(
      {
        async acquirePluginSnapshot() {
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
      assetResolver(async () => linked),
      {
        rendererUrl: "https://desktop.convax.invalid/index.html",
      },
    )

    const response = await handle({ url: assetUrl("index.html") })

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain("secret")
  })

  test("never falls a stale same-version A URL forward to snapshot B", async () => {
    const assetA = await temporaryAsset("a/index.js", "snapshot-a")
    const assetB = await temporaryAsset("b/index.js", "snapshot-b")
    let retainA = true
    const handle = createWebPluginAssetHandler(
      assetResolver(async (_relativePath, identity) => {
        if (identity.snapshotDigest === runtimeA.snapshotDigest && retainA) return assetA
        if (identity.snapshotDigest === runtimeB.snapshotDigest) return assetB
        throw new Error("snapshot was collected")
      }),
      { rendererUrl: "file:///Applications/Convax/index.html" },
    )

    const entryA = assetUrl("index.js")
    const entryB = assetUrl("index.js", runtimeB)
    expect(new URL(entryA).hostname).not.toBe(new URL(entryB).hostname)
    expect(new URL("chunk.js", entryA).href).toBe(assetUrl("chunk.js"))
    expect(await (await handle({ url: entryA })).text()).toBe("snapshot-a")
    expect(await (await handle({ url: entryB })).text()).toBe("snapshot-b")
    expect(await (await handle({ url: entryA })).text()).toBe("snapshot-a")

    retainA = false
    const collected = await handle({ url: entryA })
    expect(collected.status).toBe(404)
    expect(await collected.text()).not.toContain("snapshot-b")
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
