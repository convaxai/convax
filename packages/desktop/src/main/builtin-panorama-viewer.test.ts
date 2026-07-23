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
  "panorama-viewer",
)
const temporaryRoots: string[] = []

async function read(relativePath: string) {
  return fs.readFile(path.join(sourceRoot, ...relativePath.split("/")), "utf8")
}

async function relativeFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = []
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relativePath = prefix ? prefix + "/" + entry.name : entry.name
    if (entry.isDirectory()) files.push(...await relativeFiles(root, relativePath))
    else files.push(relativePath)
  }
  return files.sort()
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("built-in Panorama Viewer", () => {
  test("ships one complete offline static Plugin package", async () => {
    expect(await relativeFiles(sourceRoot)).toEqual([
      "assets/app.js",
      "assets/panorama-image.js",
      "assets/panorama-renderer.js",
      "assets/styles.css",
      "index.html",
      "manifest.json",
    ])

    const entry = await read("index.html")
    const application = await read("assets/app.js")
    const imageModule = await read("assets/panorama-image.js")
    const rendererModule = await read("assets/panorama-renderer.js")
    const runtime = [application, imageModule, rendererModule].join("\n")
    const styles = await read("assets/styles.css")
    expect(entry).toContain("<title>全景图预览</title>")
    expect(entry).toContain('src="./assets/app.js"')
    expect(entry).toContain('href="./assets/styles.css"')
    expect(entry.match(/<script\b/gu)).toHaveLength(1)
    expect(entry).not.toContain("<style")
    expect(entry).not.toMatch(/(?:src|href)=["'](?:https?:|\/\/|\/)/u)
    expect(styles).not.toContain("@import")
    expect(styles).not.toContain("url(")

    expect(application).toContain("convax.plugin-host/1")
    expect(application).toContain("panorama-viewer")
    expect(application).toContain("event.source !== window.parent")
    expect(application).toContain("canvas.connectedImages.list")
    expect(application).toContain("canvas.connectedImage.read")
    expect(application).toContain("canvas.node.updateState")
    expect(application).toContain("canvas.image.create")
    expect(application).toContain("host.context.get")
    expect(application).toContain('from "./panorama-image.js"')
    expect(application).toContain('from "./panorama-renderer.js"')
    expect(rendererModule).toContain("getContext(\"webgl2\"")
    expect(imageModule).toContain("createImageBitmap")
    expect(imageModule).toContain("MAX_IMAGE_FILE_BYTES = 16 * 1024 * 1024")
    expect(imageModule).toContain("MAX_IMAGE_PIXELS = 40 * 1024 * 1024")
    expect(rendererModule).toContain("LINEAR_MIPMAP_LINEAR")
    expect(application).toContain("webglcontextrestored")
    expect(application.match(/userInitiated: deferred\.userInitiated/gu)).toHaveLength(2)
    expect(application).toContain("if (accepted) setSourceStatus")
    expect(application).toContain("STATE_SAVE_MAX_ATTEMPTS")
    expect(application).toContain("requestFullscreen")
    expect(rendererModule).toContain("UNPACK_FLIP_Y_WEBGL, false")
    expect(rendererModule).toContain("gl.readPixels")
    expect(entry).toContain('id="captureButton"')
    expect(runtime).not.toContain("window.parent.postMessage")
    expect(runtime).not.toContain("localStorage")
    expect(runtime).not.toContain("sessionStorage")
    expect(runtime).not.toContain("indexedDB")
    expect(runtime).not.toContain("XMLHttpRequest")
    expect(runtime).not.toContain("URL.createObjectURL")
    expect(runtime).not.toMatch(/https?:\/\//u)

    const stateFunction = application.slice(
      application.indexOf("function snapshotState"),
      application.indexOf("function hydrateState"),
    )
    expect(stateFunction).toContain("selectedSourceNodeId")
    expect(stateFunction).not.toContain("dataUrl")
    expect(stateFunction).not.toContain("objectUrl")
  })

  test("declares only the narrow Canvas-image, state, and fullscreen capabilities", async () => {
    const manifest = JSON.parse(await read("manifest.json"))
    expect(manifest).toMatchObject({
      capabilities: [
        "canvas.connectedImages.read",
        "canvas.image.write",
        "canvas.node.write",
        "ui.fullscreen",
      ],
      contributes: {
        canvas: {
          renderer: { create: true, height: 640, width: 980 },
          toolbar: [
            { command: "panorama.capture-viewport", id: "capture-viewport", title: "截取画面" },
            { command: "panorama.reset", id: "reset", title: "重置视角" },
            { command: "panorama.toggle-auto-rotate", id: "auto-rotate", title: "自动旋转" },
            { command: "panorama.refresh-connections", id: "refresh", title: "刷新图片" },
          ],
        },
      },
      entry: "index.html",
      id: "panorama-viewer",
      name: "全景图预览",
      schema: "convax.plugin/1",
      version: "0.2.0",
    })
    expect(manifest).not.toHaveProperty("tags")
    expect(manifest).not.toHaveProperty("network")
  })

  test("is cataloged once and installs through the normal Plugin manager", async () => {
    const matches = desktopBuiltinPluginCatalog.filter((item) => item.manifest.id === "panorama-viewer")
    expect(matches).toHaveLength(1)
    const catalogItem = matches[0]!
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-builtin-panorama-"))
    temporaryRoots.push(root)
    const manager = new WebPluginManager(path.join(root, "plugins"))

    const installed = await manager.installBundle(catalogItem.bundle)

    expect(installed).toEqual(catalogItem.manifest)
    expect(installed.name).toBe("全景图预览")
    expect(await fs.readFile(await manager.resolveAsset(installed.id, installed.entry!), "utf8"))
      .toContain("./assets/app.js")
    expect((await fs.stat(await manager.resolveAsset(installed.id, "assets/app.js"))).size).toBeGreaterThan(10_000)
    expect((await fs.stat(await manager.resolveAsset(installed.id, "assets/panorama-image.js"))).size).toBeGreaterThan(2_000)
    expect((await fs.stat(await manager.resolveAsset(installed.id, "assets/panorama-renderer.js"))).size).toBeGreaterThan(2_000)
    expect((await fs.stat(await manager.resolveAsset(installed.id, "assets/styles.css"))).size).toBeGreaterThan(5_000)
  })
})
