import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { desktopBuiltinPluginCatalog } from "./builtin-plugin-catalog"
import { WebPluginManager } from "./plugin-manager"

const sourceRoot = path.resolve(
  import.meta.dir,
  "..",
  "..",
  "resources",
  "plugins",
  "storyai-3d-director-desk",
)
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
    if (entry.isDirectory()) files.push(...await relativeFiles(root, relativePath))
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
      "UPSTREAM.md",
      "UPSTREAM.patch",
      "assets/app.js",
      "assets/styles.css",
      "index.html",
      "manifest.json",
    ])
    expect((await relativeFiles(sourceRoot)).some((file) => file.endsWith(".glb"))).toBe(false)
    expect(await sha256(sourceRoot, "assets/app.js")).toBe("e0c8ffc93f78bff963b107e36aca531116e344597d490a0eb5739cfe8be25106")
    expect(await sha256(sourceRoot, "assets/styles.css")).toBe("414fe444310760c4ef62c18fd7da52f30829c48a2897cdc0d641d39c420b0c35")
    expect(await sha256(sourceRoot, "index.html")).toBe("cca741699d677bb752288d02a61e11228cdcd810787bfb06f6d96e2deab9e646")
    expect(await sha256(sourceRoot, "UPSTREAM.patch")).toBe("9b25fa03c69f346d46a33d82e295a04c22bf8f80146aeda21e08430a103bf287")
    expect(await read(sourceRoot, "LICENSE")).toContain("MIT License")
    expect(await read(sourceRoot, "UPSTREAM.md")).toContain(upstreamCommit)
    expect(await read(sourceRoot, "UPSTREAM.patch")).toContain("event.source !== window.parent")
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
    expect(application).toContain("directorProject")
    expect(application).toContain("storyai-3d-director-desk")
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
    const catalogItem = desktopBuiltinPluginCatalog[0]
    const installed = await manager.installBundle(catalogItem.bundle)

    expect(installed).toEqual(catalogItem.manifest)
    expect(installed.id).toBe("storyai-3d-director-desk")
    expect(installed.capabilities).toEqual(["canvas.node.write"])
    expect(await fs.readFile(await manager.resolveAsset(installed.id, installed.entry), "utf8"))
      .toContain("./assets/app.js")
    expect((await fs.stat(await manager.resolveAsset(installed.id, "assets/app.js"))).size).toBeGreaterThan(100_000)
  })
})
