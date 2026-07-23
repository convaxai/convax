import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { desktopBuiltinPluginCatalog } from "./builtin-plugin-catalog"
import { WebPluginManager } from "./plugin-manager"

const sourceRoot = path.resolve(import.meta.dir, "..", "..", "resources", "plugins", "storyai-3d-director-desk")
const upstreamCommit = "8c8bd361790be4d37158a7430365e65546e358fe"
const temporaryRoots: string[] = []

async function read(root: string, relativePath: string) {
  return fs.readFile(path.join(root, ...relativePath.split("/")), "utf8")
}

async function sha256(root: string, relativePath: string) {
  return createHash("sha256")
    .update(await fs.readFile(path.join(root, ...relativePath.split("/"))))
    .digest("hex")
}

async function relativeFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = []
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await relativeFiles(root, relativePath)))
    else files.push(relativePath)
  }
  return files.sort()
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("built-in StoryAI 3D Director Desk", () => {
  test("pins the licensed open-source build and excludes the non-open model", async () => {
    expect(await relativeFiles(sourceRoot)).toEqual([
      "LICENSE",
      "SKILL.md",
      "UPSTREAM.frame.patch",
      "UPSTREAM.md",
      "UPSTREAM.patch",
      "UPSTREAM.state.patch",
      "UPSTREAM.view.patch",
      "assets/app.js",
      "assets/styles.css",
      "index.html",
      "manifest.json",
    ])
    expect((await relativeFiles(sourceRoot)).some((file) => file.endsWith(".glb"))).toBe(false)
    expect(await sha256(sourceRoot, "assets/app.js")).toBe(
      "a98fa137c6917ec77a1f957826cefcb70fccb749d8a46868cd4c2457d701eec4",
    )
    expect(await sha256(sourceRoot, "assets/styles.css")).toBe(
      "6cce301d037ab3483cda7a5d1587fcd6258e59e7baee4ed6d8b17fc080ac8620",
    )
    expect(await sha256(sourceRoot, "index.html")).toBe(
      "cca741699d677bb752288d02a61e11228cdcd810787bfb06f6d96e2deab9e646",
    )
    expect(await sha256(sourceRoot, "UPSTREAM.patch")).toBe(
      "9b25fa03c69f346d46a33d82e295a04c22bf8f80146aeda21e08430a103bf287",
    )
    expect(await sha256(sourceRoot, "UPSTREAM.state.patch")).toBe(
      "04732e1e1d711ffddd0ccafc044c8fa4114a3e4808c9cb75cdab3eb621619124",
    )
    expect(await sha256(sourceRoot, "UPSTREAM.view.patch")).toBe(
      "326188b1fd0d45f7cd9b59645a7bdbc5c0f60c0efd0d0b33623b762c055aa49e",
    )
    expect(await sha256(sourceRoot, "UPSTREAM.frame.patch")).toBe(
      "bda62e3d18a7d0718a9dd37dc30c8736990cae8ce6b2b621c7d552392d05735e",
    )
    expect(await read(sourceRoot, "LICENSE")).toContain("MIT License")
    expect(await read(sourceRoot, "UPSTREAM.md")).toContain(upstreamCommit)
    const upstreamPatch = await Promise.all([
      read(sourceRoot, "UPSTREAM.patch"),
      read(sourceRoot, "UPSTREAM.state.patch"),
      read(sourceRoot, "UPSTREAM.view.patch"),
      read(sourceRoot, "UPSTREAM.frame.patch"),
    ]).then((patches) => patches.join("\n"))
    expect(upstreamPatch).toContain("event.source !== window.parent")
    expect(upstreamPatch).toContain("blockedStateSerialized")
    expect(upstreamPatch).toContain("LEGACY_HOST_STATE_SCHEMA_VERSION")
    expect(upstreamPatch).toContain("presentation")
    expect(upstreamPatch).toContain("onTransformEnd")
    expect(upstreamPatch).toContain("posts the final director view immediately")
    expect(upstreamPatch).toContain("initDirectorDeskHostBridge();")
    expect(upstreamPatch).toContain("原数据已保留且不会被覆盖")
    expect(upstreamPatch).toContain("canvas.image.create")
    expect(upstreamPatch).toContain('PLAY_COMMAND = "scene.play"')
  })

  test("uses only the existing sandboxed Plugin host protocol", async () => {
    const entry = await read(sourceRoot, "index.html")
    const application = await read(sourceRoot, "assets/app.js")
    const styles = await read(sourceRoot, "assets/styles.css")

    expect(entry).toContain('src="./assets/app.js"')
    expect(entry).toContain('href="./assets/styles.css"')
    expect(entry).not.toContain("<style")
    expect(entry).not.toMatch(/(?:src|href)=["'](?:https?:|\/\/|\/)/u)
    expect(styles).not.toContain("url(")
    expect(application).toContain("convax.plugin-host/1")
    expect(application).toContain("host.context.get")
    expect(application).toContain("canvas.node.updateState")
    expect(application).toContain("canvas.image.create")
    expect(application).toContain("directorProject")
    expect(application).toContain("presentation")
    expect(application).toContain("directorView")
    expect(application).toContain("storyai-3d-director-desk")
    expect(application).toContain("Convax Plugin host request timed out")
    expect(application).toContain("pagehide")
    expect(application).toContain("visibilitychange")
    expect(application).toContain("不兼容的状态版本")
    expect(application).toContain("本地导入的媒体和机位截图仅在当前会话可用")
    expect(styles).toContain(".convax-state-notice")
    expect(application).toContain("pluginId")
    expect(application).toContain("window.parent")
    expect(application).not.toContain("localStorage")
    expect(application).not.toContain("sessionStorage")
    expect(application).not.toContain("indexedDB")
    expect(application).not.toContain("/__hub-sdk__.js")
    expect(application).not.toContain("window.hub")
    expect(application).not.toContain("ue-mannequin-retopology")
    expect(application).not.toContain("cdn.hailuo")
    expect(application).not.toContain("sketchfab")
    expect(application).not.toContain("window.parent.postMessage")
    expect(application).not.toContain("导入本地模型")
    expect(application).not.toContain("下载图片")
  })

  test("installs through the same manager used by imported Plugins", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-builtin-director-"))
    temporaryRoots.push(root)
    const manager = new WebPluginManager(path.join(root, "plugins"))
    const catalogItem = desktopBuiltinPluginCatalog.find((item) => item.manifest.id === "storyai-3d-director-desk")
    expect(catalogItem).toBeDefined()
    if (!catalogItem) throw new Error("Built-in 3D Director Desk was not found")
    const installed = await manager.installOrUpdateBuiltinBundle(catalogItem.bundle)

    expect(installed).toEqual({ ...catalogItem.manifest, trustedBuiltin: true })
    expect(installed.id).toBe("storyai-3d-director-desk")
    expect(installed.version).toBe("0.0.1-convax.3")
    expect(installed.capabilities).toEqual(["canvas.node.write", "canvas.image.write"])
    expect(installed.contributes.canvas?.toolbar).toEqual([
      { command: "scene.play", icon: "play", id: "play", title: "关联当前帧" },
    ])
    expect(await fs.readFile(await manager.resolveAsset(installed.id, installed.entry!), "utf8")).toContain(
      "./assets/app.js",
    )
    expect((await fs.stat(await manager.resolveAsset(installed.id, "assets/app.js"))).size).toBeGreaterThan(100_000)
    expect(await manager.resolveAsset(installed.id, "UPSTREAM.state.patch")).toContain("UPSTREAM.state.patch")
    expect(await manager.resolveAsset(installed.id, "UPSTREAM.view.patch")).toContain("UPSTREAM.view.patch")
    expect(await manager.resolveAsset(installed.id, "UPSTREAM.frame.patch")).toContain("UPSTREAM.frame.patch")
  })
})
