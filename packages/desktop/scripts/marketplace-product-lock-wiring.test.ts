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
  expect(manifest.scripts?.dev).toMatch(
    /^bun run build:workspace-dependencies && bun run collaboration:prepare && bun run marketplace:prepare && /,
  )
  expect(manifest.scripts?.["marketplace:prepare"]?.startsWith("bun run marketplace:verify && ")).toBe(true)
  expect(manifest.scripts?.["marketplace:prepare"]).toContain("stage-marketplace-product-lock.ts")
  expect(manifest.scripts?.["marketplace:prepare"]).toContain("materialize-marketplace-product-lock.ts")
  expect(manifest.scripts?.["package:prepare"]?.startsWith("bun run marketplace:prepare && ")).toBe(true)
  expect(manifest.scripts?.["package:prepare"]).not.toContain("stage-default-capabilities.ts")
})

test("stages every selected package as one deterministic artifact group", async () => {
  const source = await readFile(join(import.meta.dir, "stage-marketplace-product-lock.ts"), "utf8")
  expect(source).toContain("descriptor.registry.v1 !== undefined")
  expect(source).not.toContain("convax-plugins/registry/v1/index.json")
  expect(source).toContain("`packages/${entry.id}/${entry.artifact.name}`")
  expect(source).toContain("`packages/${entry.id}/skills/${skill.name}`")
  expect(source).toContain(
    "`packages/${entry.id}/companions/${companion.platform}-${companion.arch}/${companion.name}`",
  )
  expect(source).toContain("staged.map(({ lock, path }) =>")
})

test("compares the canonical validated Plugin projection with parser-added defaults", () => {
  const manifest = {
    contributes: {
      generation: {
        models: [],
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
    hostApi: { major: 3, optional: [], required: [] },
    id: "ffmpeg-tools",
    name: "FFmpeg Tools",
    runtime: { command: "convax-ffmpeg-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/8",
    version: "0.3.1",
  }

  const canonicalManifest = {
    ...structuredClone(manifest),
    capabilities: [],
  }
  const parsed = validateLockedPluginManifest(manifest, canonicalManifest, {
    id: "ffmpeg-tools",
    version: "0.3.1",
  })

  expect(parsed.capabilities).toEqual([])
  expect(canonicalJson(parsed)).not.toBe(canonicalJson(manifest))
  expect(canonicalJson(parsed)).toBe(canonicalJson(canonicalManifest))
  expect(() =>
    validateLockedPluginManifest(
      manifest,
      { ...canonicalManifest, description: "Changed Registry projection" },
      {
        id: "ffmpeg-tools",
        version: "0.3.1",
      },
    ),
  ).toThrow("projection does not canonically match")
})
