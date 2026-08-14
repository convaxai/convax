import { describe, expect, test } from "bun:test"
import { link, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  canonicalJson,
  canonicalProductPolicyDigest,
  parseMarketplaceProductLock,
  type MarketplaceProductPolicy,
} from "./marketplace-product-lock"
import { resolveMarketplaceProductLock, type MarketplaceProductLockInput } from "./marketplace-product-lock-resolve"
import { createDeterministicZip } from "../packages/marketplace-kit/src"

const policy: MarketplaceProductPolicy = {
  builtin: { marketplaceId: "convax-builtin", repository: "convaxai/convax-plugins" },
  official: {
    descriptorUrl: "https://convaxai.github.io/convax-plugins/marketplace.json",
    marketplaceId: "convax-official",
    repository: "convaxai/convax-plugins",
  },
  packages: [
    {
      id: "ffmpeg-tools",
      kind: "plugin",
      marketplaceId: "convax-official",
      purposes: ["default-install"],
      targets: ["darwin-arm64"],
    },
    {
      id: "canvas-storyboard-workflow",
      kind: "skill",
      marketplaceId: "convax-official",
      purposes: ["default-install"],
      targets: [],
    },
    {
      id: "legacy-tools",
      kind: "plugin",
      marketplaceId: "convax-official",
      purposes: ["default-install", "retired-recovery"],
      retired: {
        artifact: { sha256: "c".repeat(64), size: 2_048 },
        hostApiMajor: 2,
        snapshotDigest: "d".repeat(64),
        sourceKey: "e".repeat(64),
        version: "1.0.0",
      },
      targets: [],
      version: "2.0.0",
    },
  ],
  revision: 3,
}

const unreachedOfficial: MarketplaceProductLockInput["official"] = {
  descriptor: {
    path: "marketplace.json",
    url: "https://github.com/convaxai/convax-plugins/releases/download/unreached/marketplace.json",
  },
  registry: {
    path: "registry.json",
    url: "https://github.com/convaxai/convax-plugins/releases/download/unreached/registry.json",
  },
  revision: "a".repeat(64),
  showcase: {
    path: "showcase.json",
    url: "https://github.com/convaxai/convax-plugins/releases/download/unreached/showcase.json",
  },
}

function sha256(bytes: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
}

function builtinFixture() {
  const artifact = Buffer.from("storyboard-skill")
  const poster = Buffer.from("storyboard-poster")
  const members = [
    {
      artifact: {
        path: "members/skill-canvas-storyboard.zip",
        sha256: sha256(artifact),
        size: artifact.byteLength,
      },
      id: "canvas-storyboard",
      kind: "skill" as const,
      presentation: {
        poster: {
          mime: "image/png",
          path: "presentation/canvas-storyboard.png",
          sha256: sha256(poster),
          size: poster.byteLength,
        },
      },
      version: "0.1.0",
    },
  ]
  const manifest = {
    members,
    release: { id: sha256(Buffer.from(canonicalJson(members))) },
    schema: "convax.builtin-bundle/1",
  } as const
  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`)
  return {
    archive: createDeterministicZip([
      { bytes: manifestBytes, mode: 0o644, path: "bundle.json" },
      { bytes: artifact, mode: 0o644, path: "members/skill-canvas-storyboard.zip" },
      { bytes: poster, mode: 0o644, path: "presentation/canvas-storyboard.png" },
    ]),
    manifest,
    manifestBytes,
  }
}

describe("Marketplace product lock resolution", () => {
  test("computes every byte identity from deterministic release outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-product-lock-"))
    const builtin = builtinFixture()
    const release = (name: string, tag: string) =>
      `https://github.com/convaxai/convax-plugins/releases/download/${tag}/${name}`
    const pluginBytes = Buffer.from("plugin")
    const recoveryBytes = Buffer.from("recovery-plugin")
    const ownedSkillBytes = Buffer.from("owned-skill")
    const standaloneSkillBytes = createDeterministicZip([
      {
        bytes: Buffer.from(
          "---\nname: canvas-storyboard-workflow\ndescription: Create a storyboard from a Canvas.\n---\n\n# Storyboard workflow\n",
        ),
        mode: 0o644,
        path: "SKILL.md",
      },
    ])
    const companionBytes = Buffer.from("companion")
    const descriptor = {
      compatibility: { convax: ">=0.1.0" },
      delivery: { kind: "github-pages-releases" },
      id: "convax-official",
      name: "Convax Official",
      publisher: { name: "Convax" },
      registry: {
        v2: { url: "https://convaxai.github.io/convax-plugins/registry/v2/index.json" },
      },
      repository: { name: "convax-plugins", owner: "convaxai" },
      schema: "convax.marketplace/1",
      showcase: { v2: { url: "https://convaxai.github.io/convax-plugins/showcase/v2/index.json" } },
    }
    const registryPackages = [
      {
        companions: [
          {
            command: "convax-ffmpeg-mcp",
            targets: [
              {
                arch: "arm64",
                artifact: {
                  sha256: sha256(companionBytes),
                  size: companionBytes.byteLength,
                  url: release("ffmpeg-darwin-arm64", "plugin-ffmpeg-tools-v1.0.0"),
                },
                platform: "darwin",
              },
            ],
            version: "1.0.0",
          },
        ],
        compatibility: { convax: ">=0.1.0" },
        delivery: {
          kind: "artifact",
          sha256: sha256(pluginBytes),
          size: pluginBytes.byteLength,
          url: release("ffmpeg.zip", "plugin-ffmpeg-tools-v1.0.0"),
        },
        id: "ffmpeg-tools",
        kind: "plugin",
        manifest: {
          contributes: { skills: [{ name: "ffmpeg-canvas", path: "skills/ffmpeg-canvas" }] },
          hostApi: { major: 3, optional: [], required: [] },
          id: "ffmpeg-tools",
          schema: "convax.plugin/8",
          version: "1.0.0",
        },
        presentation: { description: "FFmpeg tools", name: "FFmpeg Tools" },
        version: "1.0.0",
      },
      {
        compatibility: { convax: ">=0.1.0" },
        delivery: {
          kind: "artifact",
          sha256: sha256(standaloneSkillBytes),
          size: standaloneSkillBytes.byteLength,
          url: release("canvas-storyboard-workflow.zip", "skill-canvas-storyboard-workflow-v0.2.0"),
        },
        id: "canvas-storyboard-workflow",
        kind: "skill",
        presentation: { description: "Canvas Storyboard workflow", name: "Canvas Storyboard Workflow" },
        version: "0.2.0",
      },
      {
        compatibility: { convax: ">=0.1.0" },
        delivery: {
          kind: "artifact",
          sha256: sha256(recoveryBytes),
          size: recoveryBytes.byteLength,
          url: release("legacy-tools.zip", "plugin-legacy-tools-v2.0.0"),
        },
        id: "legacy-tools",
        kind: "plugin",
        manifest: {
          contributes: {},
          hostApi: { major: 3, optional: [], required: [] },
          id: "legacy-tools",
          schema: "convax.plugin/8",
          version: "2.0.0",
        },
        presentation: { description: "Legacy recovery", name: "Legacy Tools" },
        version: "2.0.0",
      },
      {
        compatibility: { convax: ">=0.1.0" },
        delivery: {
          kind: "artifact",
          sha256: sha256(ownedSkillBytes),
          size: ownedSkillBytes.byteLength,
          url: release("ffmpeg-skill.zip", "skill-ffmpeg-canvas-v1.0.0"),
        },
        id: "ffmpeg-canvas",
        kind: "skill",
        ownerPluginId: "ffmpeg-tools",
        presentation: { description: "FFmpeg Canvas", name: "FFmpeg Canvas" },
        version: "1.0.0",
      },
    ]
    const officialRevision = sha256(Buffer.from(canonicalJson(registryPackages)))
    const metadataTag = `registry-v2-${officialRevision}`
    const registry = {
      marketplaceId: "convax-official",
      packages: registryPackages,
      revision: officialRevision,
      schema: "convax.registry/2",
      sequence: 45,
    }
    const showcase = {
      marketplaceId: "convax-official",
      packages: [],
      revision: officialRevision,
      schema: "convax.showcase/2",
    }
    for (const [name, bytes] of [
      ["builtin.zip", builtin.archive],
      ["bundle.json", builtin.manifestBytes],
      ["marketplace.json", `${JSON.stringify(descriptor)}\n`],
      ["registry.json", `${JSON.stringify(registry)}\n`],
      ["showcase.json", `${JSON.stringify(showcase)}\n`],
      ["ffmpeg.zip", pluginBytes],
      ["legacy-tools.zip", recoveryBytes],
      ["ffmpeg-skill.zip", ownedSkillBytes],
      ["canvas-storyboard-workflow.zip", standaloneSkillBytes],
      ["ffmpeg-darwin-arm64", companionBytes],
      ["other.zip", "not-preinstalled"],
    ] as const) {
      await writeFile(join(root, name), bytes)
    }
    const input: MarketplaceProductLockInput = {
      builtinBundle: {
        path: "builtin.zip",
        url: release("builtin.zip", `builtin-${builtin.manifest.release.id}`),
      },
      builtinManifestPath: "bundle.json",
      builtinReservations: [{ id: "canvas-storyboard", kind: "skill" }],
      official: {
        descriptor: { path: "marketplace.json", url: release("marketplace.json", metadataTag) },
        registry: { path: "registry.json", url: release("registry.json", metadataTag) },
        revision: officialRevision,
        showcase: { path: "showcase.json", url: release("showcase.json", metadataTag) },
      },
      packages: [
        {
          artifact: { path: "ffmpeg.zip", url: release("ffmpeg.zip", "plugin-ffmpeg-tools-v1.0.0") },
          companions: [
            {
              arch: "arm64",
              path: "ffmpeg-darwin-arm64",
              platform: "darwin",
              url: release("ffmpeg-darwin-arm64", "plugin-ffmpeg-tools-v1.0.0"),
            },
          ],
          id: "ffmpeg-tools",
          kind: "plugin",
          marketplaceId: "convax-official",
          ownedSkills: [{ path: "ffmpeg-skill.zip", url: release("ffmpeg-skill.zip", "skill-ffmpeg-canvas-v1.0.0") }],
          setup: "explicit",
          version: "1.0.0",
        },
        {
          artifact: {
            path: "canvas-storyboard-workflow.zip",
            url: release("canvas-storyboard-workflow.zip", "skill-canvas-storyboard-workflow-v0.2.0"),
          },
          companions: [],
          id: "canvas-storyboard-workflow",
          kind: "skill",
          marketplaceId: "convax-official",
          ownedSkills: [],
          setup: "none",
          version: "0.2.0",
        },
        {
          artifact: {
            path: "legacy-tools.zip",
            url: release("legacy-tools.zip", "plugin-legacy-tools-v2.0.0"),
          },
          companions: [],
          id: "legacy-tools",
          kind: "plugin",
          marketplaceId: "convax-official",
          ownedSkills: [],
          setup: "explicit",
          version: "2.0.0",
        },
        {
          artifact: { path: "other.zip", url: release("other.zip", "plugin-other-v1.0.0") },
          companions: [],
          id: "other",
          kind: "plugin",
          marketplaceId: "convax-official",
          ownedSkills: [],
          setup: "none",
          version: "1.0.0",
        },
      ],
      schema: "convax.product-lock-input/1",
    }
    const lock = await resolveMarketplaceProductLock(policy, root, input)
    expect(lock.resolved.policyDigest).toBe(canonicalProductPolicyDigest(policy))
    expect(lock.resolved.builtinBundle.size).toBe(builtin.archive.byteLength)
    expect(lock.resolved.builtinReservations).toEqual([{ id: "canvas-storyboard", kind: "skill" }])
    const ffmpeg = lock.resolved.packages.find((entry) => entry.id === "ffmpeg-tools")
    expect(ffmpeg?.kind).toBe("plugin")
    if (ffmpeg?.kind !== "plugin") throw new Error("expected locked FFmpeg Plugin")
    expect(ffmpeg.companions[0]).toMatchObject({ arch: "arm64", platform: "darwin", size: 9 })
    expect(ffmpeg.purposes).toEqual(["default-install"])
    const standaloneSkill = lock.resolved.packages.find((entry) => entry.id === "canvas-storyboard-workflow")
    expect(standaloneSkill).toEqual(
      expect.objectContaining({
        artifact: expect.objectContaining({
          sha256: sha256(standaloneSkillBytes),
          size: standaloneSkillBytes.byteLength,
        }),
        kind: "skill",
        purposes: ["default-install"],
        targets: [],
        version: "0.2.0",
      }),
    )
    expect(standaloneSkill).not.toHaveProperty("companions")
    expect(standaloneSkill).not.toHaveProperty("ownedSkills")
    const legacy = lock.resolved.packages.find((entry) => entry.id === "legacy-tools")
    const legacyPolicy = policy.packages[2]
    if (legacyPolicy.kind !== "plugin" || !("retired" in legacyPolicy)) {
      throw new Error("expected retired legacy policy")
    }
    expect(legacy).toEqual(
      expect.objectContaining({
        artifact: expect.objectContaining({ sha256: sha256(recoveryBytes), size: recoveryBytes.byteLength }),
        id: "legacy-tools",
        purposes: ["default-install", "retired-recovery"],
        retired: legacyPolicy.retired,
        version: "2.0.0",
      }),
    )
    expect(lock.resolved.packages.map(({ id }) => id)).toEqual([
      "ffmpeg-tools",
      "canvas-storyboard-workflow",
      "legacy-tools",
    ])
    expect(() => parseMarketplaceProductLock(lock)).not.toThrow()

    await expect(
      resolveMarketplaceProductLock(policy, root, {
        ...input,
        builtinBundle: {
          ...input.builtinBundle,
          url: input.builtinBundle.url.replace("github.com/", "github.com:8443/"),
        },
      }),
    ).rejects.toThrow("immutable Official Release URL")
    await expect(
      resolveMarketplaceProductLock(policy, root, {
        ...input,
        official: {
          ...input.official,
          descriptor: {
            ...input.official.descriptor,
            url: release("marketplace.json", "registry-v2-wrong"),
          },
        },
      }),
    ).rejects.toThrow("metadata Release tag")
    const nonCanonicalDescriptor = {
      ...descriptor,
      registry: {
        ...descriptor.registry,
        v2: { url: "https://convaxai.github.io/convax-plugins/somewhere/registry.json" },
      },
    }
    await writeFile(join(root, "marketplace.json"), `${JSON.stringify(nonCanonicalDescriptor)}\n`)
    await expect(resolveMarketplaceProductLock(policy, root, input)).rejects.toThrow(
      "canonical Official metadata paths",
    )
    await writeFile(join(root, "marketplace.json"), `${JSON.stringify(descriptor)}\n`)

    const expectRegistryRejection = async (packages: typeof registryPackages, message: string) => {
      const revision = sha256(Buffer.from(canonicalJson(packages)))
      await writeFile(join(root, "registry.json"), `${JSON.stringify({ ...registry, packages, revision })}\n`)
      await writeFile(join(root, "showcase.json"), `${JSON.stringify({ ...showcase, revision })}\n`)
      await expect(
        resolveMarketplaceProductLock(policy, root, {
          ...input,
          official: {
            descriptor: {
              ...input.official.descriptor,
              url: release("marketplace.json", `registry-v2-${revision}`),
            },
            registry: {
              ...input.official.registry,
              url: release("registry.json", `registry-v2-${revision}`),
            },
            revision,
            showcase: {
              ...input.official.showcase,
              url: release("showcase.json", `registry-v2-${revision}`),
            },
          },
        }),
      ).rejects.toThrow(message)
    }
    await expectRegistryRejection(
      registryPackages.map((entry) => (entry.id === "ffmpeg-tools" ? { ...entry, yanked: true } : entry)),
      "yanked",
    )
    await expectRegistryRejection(
      registryPackages.map((entry) => (entry.id === "canvas-storyboard-workflow" ? { ...entry, yanked: true } : entry)),
      "yanked",
    )
    await expectRegistryRejection(
      registryPackages.map((entry) =>
        entry.id === "canvas-storyboard-workflow" ? { ...entry, ownerPluginId: "unselected-plugin" } : entry,
      ),
      "standalone Official Skill",
    )
    await writeFile(join(root, "registry.json"), `${JSON.stringify(registry)}\n`)
    await writeFile(join(root, "showcase.json"), `${JSON.stringify(showcase)}\n`)

    const selectedStandaloneSkill = input.packages.find((entry) => entry.id === "canvas-storyboard-workflow")!
    await expect(
      resolveMarketplaceProductLock(policy, root, {
        ...input,
        packages: input.packages.map((entry) =>
          entry.id === "canvas-storyboard-workflow"
            ? {
                ...selectedStandaloneSkill,
                artifact: {
                  ...selectedStandaloneSkill.artifact,
                  url: release("canvas-storyboard-workflow.zip", "skill-wrong-v0.2.0"),
                },
              }
            : entry,
        ),
      }),
    ).rejects.toThrow("does not match the locked Official Registry")

    await expect(
      resolveMarketplaceProductLock(policy, root, {
        ...input,
        packages: input.packages.map((entry) =>
          entry.id === "canvas-storyboard-workflow"
            ? { ...selectedStandaloneSkill, companions: [input.packages[0].companions[0]] }
            : entry,
        ),
      }),
    ).rejects.toThrow("standalone Skill closure is invalid")

    await expect(
      resolveMarketplaceProductLock(policy, root, {
        ...input,
        builtinBundle: {
          ...input.builtinBundle,
          url: release("builtin.zip", "builtin-wrong"),
        },
      }),
    ).rejects.toThrow("Release tag does not match")
    await expect(
      resolveMarketplaceProductLock(policy, root, {
        ...input,
        unexpected: true,
      } as never),
    ).rejects.toThrow("unsupported or missing fields")

    await writeFile(join(root, "canvas-storyboard-workflow.zip"), "tampered")
    await expect(resolveMarketplaceProductLock(policy, root, input)).rejects.toThrow(
      "does not match the locked Official Registry",
    )
    await writeFile(join(root, "canvas-storyboard-workflow.zip"), standaloneSkillBytes)
    await writeFile(join(root, "ffmpeg.zip"), "tampered")
    await expect(resolveMarketplaceProductLock(policy, root, input)).rejects.toThrow(
      "does not match the locked Official Registry",
    )
  })

  test("rejects traversal before reading release outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-product-lock-"))
    await expect(
      resolveMarketplaceProductLock(policy, root, {
        builtinBundle: {
          path: "../outside.zip",
          url: "https://github.com/convaxai/convax-plugins/releases/download/v1/outside.zip",
        },
        builtinManifestPath: "bundle.json",
        builtinReservations: [{ id: "canvas-storyboard", kind: "skill" }],
        official: unreachedOfficial,
        packages: [],
        schema: "convax.product-lock-input/1",
      }),
    ).rejects.toThrow("relative")
  })

  test("rejects a detached Builtin manifest that does not match the locked archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-product-lock-"))
    const builtin = builtinFixture()
    await writeFile(join(root, "builtin.zip"), builtin.archive)
    const detachedMembers = builtin.manifest.members.map((member) => ({
      ...member,
      presentation: {
        poster: {
          ...member.presentation.poster,
          sha256: "e".repeat(64),
        },
      },
    }))
    await writeFile(
      join(root, "bundle.json"),
      `${canonicalJson({
        ...builtin.manifest,
        members: detachedMembers,
        release: { id: sha256(Buffer.from(canonicalJson(detachedMembers))) },
      })}\n`,
    )
    await expect(
      resolveMarketplaceProductLock(policy, root, {
        builtinBundle: {
          path: "builtin.zip",
          url: `https://github.com/convaxai/convax-plugins/releases/download/builtin-${builtin.manifest.release.id}/builtin.zip`,
        },
        builtinManifestPath: "bundle.json",
        builtinReservations: [{ id: "canvas-storyboard", kind: "skill" }],
        official: unreachedOfficial,
        packages: [],
        schema: "convax.product-lock-input/1",
      }),
    ).rejects.toThrow("does not match its locked outer archive")
  })

  test("derives and verifies Builtin reservations from the locked archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-product-lock-"))
    const builtin = builtinFixture()
    await writeFile(join(root, "builtin.zip"), builtin.archive)
    await writeFile(join(root, "bundle.json"), builtin.manifestBytes)
    await expect(
      resolveMarketplaceProductLock(policy, root, {
        builtinBundle: {
          path: "builtin.zip",
          url: `https://github.com/convaxai/convax-plugins/releases/download/builtin-${builtin.manifest.release.id}/builtin.zip`,
        },
        builtinManifestPath: "bundle.json",
        builtinReservations: [{ id: "different-skill", kind: "skill" }],
        official: unreachedOfficial,
        packages: [],
        schema: "convax.product-lock-input/1",
      }),
    ).rejects.toThrow("reservation input does not match")
  })

  test("rejects multiply-linked release output before hashing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-product-lock-"))
    const artifact = join(root, "builtin.zip")
    await writeFile(artifact, "builtin")
    await link(artifact, join(root, "second-name.zip"))
    await expect(
      resolveMarketplaceProductLock(policy, root, {
        builtinBundle: {
          path: "builtin.zip",
          url: "https://github.com/convaxai/convax-plugins/releases/download/v1/builtin.zip",
        },
        builtinManifestPath: "bundle.json",
        builtinReservations: [{ id: "canvas-storyboard", kind: "skill" }],
        official: unreachedOfficial,
        packages: [],
        schema: "convax.product-lock-input/1",
      }),
    ).rejects.toThrow("single-link")
  })
})
