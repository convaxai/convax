import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { canonicalJson } from "@convax/marketplace"
import {
  deduplicateStagedMarketplaceArtifacts,
  validateLockedPluginManifest,
  validateLockedSkillArchive,
} from "./stage-marketplace-product-lock"

test("Desktop packaging verifies the one root Marketplace product lock before consuming staged bytes", async () => {
  const manifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }
  expect(manifest.scripts?.["marketplace:verify"]).toBe(
    "bun ../../scripts/marketplace-product-lock.ts ../../marketplaces.lock.json",
  )
  expect(manifest.scripts?.dev).toMatch(
    /^bun run build:workspace-dependencies && bun run collaboration:prepare && bun run marketplace:prepare:dev && /,
  )
  expect(manifest.scripts?.["marketplace:prepare:dev"]).toContain("prepare-development-marketplace-product.ts")
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
  expect(source).not.toContain("recovery-artifacts")
  expect(source).toContain('entry.kind === "skill"')
  expect(source).toContain("`packages/${entry.kind}/${entry.id}/${entry.artifact.name}`")
  expect(source).toContain("`packages/plugin/${entry.id}/skills/${skill.name}`")
  expect(source).toContain(
    "`packages/plugin/${entry.id}/companions/${companion.platform}-${companion.arch}/${companion.name}`",
  )
  expect(source).toContain("packagedArtifacts.map(({ lock, path }) =>")
  expect(source).toContain("assertCanonicalOfficialMarketplaceDescriptor(descriptor, lock.policy.official)")
})

test("deduplicates byte-identical locked artifacts onto one deterministic packaged path", () => {
  const bytes = new Uint8Array([1, 2, 3])
  const shared = { sha256: "a".repeat(64), size: bytes.byteLength }
  const artifact = (name: string, path: string) => ({
    bytes,
    lock: {
      ...shared,
      name,
      url: `https://github.com/convaxai/convax-plugins/releases/download/plugin-fixture-v1.0.0/${name}`,
    },
    path,
  })

  expect(
    deduplicateStagedMarketplaceArtifacts([
      artifact("shared-second", "packages/plugin/zeta/companions/darwin-arm64/shared-second"),
      artifact("shared-first", "packages/plugin/alpha/companions/darwin-arm64/shared-first"),
    ]).map(({ path }) => path),
  ).toEqual(["packages/plugin/alpha/companions/darwin-arm64/shared-first"])
  expect(
    deduplicateStagedMarketplaceArtifacts([
      artifact("shared-first", "packages/plugin/alpha/companions/darwin-arm64/shared-first"),
      artifact("shared-second", "packages/plugin/zeta/companions/darwin-arm64/shared-second"),
    ]).map(({ path }) => path),
  ).toEqual(["packages/plugin/alpha/companions/darwin-arm64/shared-first"])
})

test("validates a standalone Skill archive without requiring Plugin closure fields", () => {
  const valid = {
    "SKILL.md": new TextEncoder().encode(
      "---\nname: canvas-storyboard-workflow\ndescription: Create a storyboard from a Canvas.\n---\n\n# Storyboard workflow\n",
    ),
  }
  expect(validateLockedSkillArchive(valid, { id: "canvas-storyboard-workflow" })).toEqual({
    description: "Create a storyboard from a Canvas.",
    name: "canvas-storyboard-workflow",
  })
  expect(() => validateLockedSkillArchive(valid, { id: "different-skill" })).toThrow("identity changed")
  expect(() =>
    validateLockedSkillArchive({ "skill.md": valid["SKILL.md"] }, { id: "canvas-storyboard-workflow" }),
  ).toThrow("exactly one root SKILL.md")
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
