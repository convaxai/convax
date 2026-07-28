import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { canonicalJson } from "@convax/marketplace"
import { validateLockedPluginManifest } from "./stage-marketplace-product-lock"

test("Desktop packaging verifies the one root Marketplace product lock before consuming staged bytes", async () => {
  const manifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }
  expect(manifest.scripts?.["marketplace:verify"]).toBe(
    "bun ../../scripts/marketplace-product-lock.ts ../../marketplaces.lock.json",
  )
  expect(manifest.scripts?.["package:prepare"]?.startsWith("bun run marketplace:verify && ")).toBe(true)
  expect(manifest.scripts?.["package:prepare"]).toContain("stage-marketplace-product-lock.ts")
  expect(manifest.scripts?.["package:prepare"]).toContain("materialize-marketplace-product-lock.ts")
  expect(manifest.scripts?.["package:prepare"]).not.toContain("stage-default-capabilities.ts")
})

test("stages every selected package as one deterministic artifact group", async () => {
  const source = await readFile(join(import.meta.dir, "stage-marketplace-product-lock.ts"), "utf8")
  expect(source).toContain("`packages/${entry.id}/${entry.artifact.name}`")
  expect(source).toContain("`packages/${entry.id}/skills/${skill.name}`")
  expect(source).toContain(
    "`packages/${entry.id}/companions/${companion.platform}-${companion.arch}/${companion.name}`",
  )
  expect(source).toContain("staged.map(({ lock, path }) =>")
})

test("compares the raw validated Plugin manifest without parser-added optional empty arrays", () => {
  const manifest = {
    contributes: {
      generation: {
        tools: [
          {
            acceptedInputs: ["reference_video"],
            description: "Extract one frame.",
            id: "frame.extract",
            output: "image",
            title: "Extract frame",
          },
        ],
      },
    },
    description: "Runs reviewed local FFmpeg transforms.",
    id: "ffmpeg-tools",
    name: "FFmpeg Tools",
    runtime: { command: "convax-ffmpeg-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/2",
    version: "0.3.1",
  }

  const parsed = validateLockedPluginManifest(manifest, structuredClone(manifest), {
    id: "ffmpeg-tools",
    version: "0.3.1",
  })

  expect(parsed.capabilities).toEqual([])
  expect(canonicalJson(parsed)).not.toBe(canonicalJson(manifest))
  expect(() =>
    validateLockedPluginManifest(
      manifest,
      { ...manifest, description: "Changed Registry projection" },
      {
        id: "ffmpeg-tools",
        version: "0.3.1",
      },
    ),
  ).toThrow("does not canonically match")
})
