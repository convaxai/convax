import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { parseWebPluginManifest } from "../plugin-contracts"
import { WebPluginManager } from "./plugin-manager"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-v2-"))
  temporaryRoots.push(root)
  return root
}

function generationManifest() {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: {
      generation: {
        tools: [
          {
            acceptedInputs: ["text", "reference_image", "first_frame"],
            description: "Generate an image without exposing a vendor to the host",
            id: "generate-image",
            output: "image",
            title: "Generate image",
          },
        ],
      },
    },
    description: "Example external generation Tool Plugin",
    id: "generation-tool",
    name: "Generation Tool",
    runtime: { args: ["serve", "--stdio"], command: "example-generation-tool", type: "mcp-stdio" },
    schema: "convax.plugin/2",
    version: "1.0.0",
  })
}

describe("WebPluginManager convax.plugin/2 compatibility", () => {
  test("installs and lists a generation Tool Plugin without treating its external command as a package asset", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "installed"))
    const manifest = generationManifest()

    await expect(
      manager.installBundle({
        files: {
          "manifest.json": JSON.stringify(manifest),
        },
      }),
    ).resolves.toEqual(manifest)
    await expect(manager.list()).resolves.toEqual([manifest])
  })

  test("keeps v1 supported and excludes a v2 installation whose manifest was tampered", async () => {
    const root = await temporaryRoot()
    const installationRoot = path.join(root, "installed")
    const manager = new WebPluginManager(installationRoot)
    const v1 = parseWebPluginManifest({
      capabilities: [],
      contributes: { canvas: { renderer: { create: true } } },
      description: "Legacy static surface",
      entry: "index.html",
      id: "static-surface",
      name: "Static Surface",
      schema: "convax.plugin/1",
      version: "1.0.0",
    })
    const v2 = generationManifest()
    await manager.installBundle({
      files: { "index.html": "<!doctype html>", "manifest.json": JSON.stringify(v1) },
    })
    await manager.installBundle({
      files: { "manifest.json": JSON.stringify(v2) },
    })

    await fs.writeFile(
      path.join(installationRoot, v2.id, "manifest.json"),
      JSON.stringify({ ...v2, runtime: { command: "../escaped-tool", type: "mcp-stdio" } }),
    )

    await expect(manager.list()).resolves.toEqual([v1])
  })
})
