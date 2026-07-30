import { describe, expect, test } from "bun:test"
import { link, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  parseBuiltinBundleArchive,
  parseMarketplaceDescriptor,
  parseShowcaseV2,
  projectBuiltinMemberDelivery,
  readBuiltinBundleMember,
  sha256Hex,
} from "@convax/marketplace"
import {
  addMarketplaceDirectory,
  addTarget,
  buildBuiltinBundle,
  buildMarketplace,
  checkMarketplace,
  changedMarketplaceVersions,
  createDeterministicZip,
  createMarketplaceStarter,
  createMarketplaceTemplate,
  composeProductLockInput,
  parseMarketplaceSelectionContext,
} from "./index"
import { runMarketplaceCli } from "./cli"

describe("@convax/marketplace-kit", () => {
  test("creates, checks and deterministically builds a v2-only third-party marketplace", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-market-kit-"))
    await createMarketplaceStarter(root, {
      id: "acme-market",
      name: "Acme Market",
      owner: "acme",
      repository: "extensions",
      starter: "skill",
    })
    await checkMarketplace(root)
    const first = await buildMarketplace({ root, outDir: join(root, "out-a"), official: false })
    const second = await buildMarketplace({ root, outDir: join(root, "out-b"), official: false })
    const refreshed = await buildMarketplace({
      root,
      outDir: join(root, "out-refresh"),
      official: false,
      previousRegistryPath: join(root, "out-a/registry-v2.json"),
    })
    expect(first.registrySha256).toBe(second.registrySha256)
    expect(refreshed.registry.sequence).toBe(2)
    expect(refreshed.registry.revision).toBe(first.registry.revision)
    expect(first.registry.schema).toBe("convax.registry/2")
    expect(first.registry.revision).toMatch(/^[0-9a-f]{64}$/)
    expect(first.registryV1).toBeUndefined()
    const descriptor = parseMarketplaceDescriptor(JSON.parse(await readFile(join(root, "marketplace.json"), "utf8")))
    expect(parseShowcaseV2(first.showcase, first.registry, descriptor)).toEqual(first.showcase)
    const sourceDescriptorBytes = await readFile(join(root, "marketplace.json"))
    const flatDescriptorBytes = await readFile(join(root, "out-a/marketplace.json"))
    const siteDescriptorBytes = await readFile(join(root, "out-a/site/marketplace.json"))
    const descriptorReleaseAsset = first.releasePlan.releases
      .flatMap(({ assets }) => assets)
      .find(({ name }) => name === "marketplace.json")
    if (!descriptorReleaseAsset) throw new Error("metadata Release must contain marketplace.json")
    const releaseDescriptorBytes = await readFile(join(root, "out-a", descriptorReleaseAsset.path))
    expect(flatDescriptorBytes).toEqual(sourceDescriptorBytes)
    expect(siteDescriptorBytes).toEqual(sourceDescriptorBytes)
    expect(releaseDescriptorBytes).toEqual(sourceDescriptorBytes)
    for (const name of ["marketplace.json", "registry-v2.json", "showcase-v2.json"]) {
      expect((await stat(join(root, "out-a/site", name))).isFile()).toBe(true)
    }
    for (const release of first.releasePlan.releases) {
      for (const asset of release.assets) {
        expect(asset.path).toStartWith(`releases/${release.tag}/`)
        expect(new URL(asset.url).pathname).toEndWith(`/${release.tag}/${asset.name}`)
        expect((await stat(join(root, "out-a", asset.path))).size).toBe(asset.size)
      }
    }
    const releaseWorkflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8")
    expect(releaseWorkflow).toContain("Reverify immutable release and Pages bytes")
    expect(releaseWorkflow).toContain("page_path")
    expect(releaseWorkflow).toContain(".registry.v1.url")
    expect(releaseWorkflow).toContain(".registry.v2.url")
    expect(releaseWorkflow).toContain(".showcase.v2.url")
    expect(releaseWorkflow).toContain("--previous-descriptor previous-marketplace.json")
    expect(releaseWorkflow).toContain("--previous-showcase previous-showcase.json")
    expect(releaseWorkflow).toContain("200/200/200")
    expect(releaseWorkflow).toContain("404/404/404")
    expect(releaseWorkflow).not.toContain("--changed changed-packages.json --initial")
    expect(releaseWorkflow).not.toContain("dist/site/$name")
    expect(releaseWorkflow).toContain("actions/deploy-pages@")
    expect(releaseWorkflow).toContain("cancel-in-progress: false")
    expect(releaseWorkflow).toContain("map(.tag) | unique | length")
    expect(releaseWorkflow).not.toContain("pull_request_target")
    const descriptorHardlink = join(root, "marketplace-hardlink.json")
    await link(join(root, "marketplace.json"), descriptorHardlink)
    await expect(checkMarketplace(root)).rejects.toThrow("single-link")
    await rm(descriptorHardlink)
  })

  test("imports one package and emits only the default-branch version change plus a complete Pages site", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-market-version-e2e-"))
    await createMarketplaceStarter(root, {
      id: "acme-market",
      name: "Acme Market",
      owner: "acme",
      repository: "extensions",
      starter: "skill",
    })
    const source = await mkdtemp(join(tmpdir(), "convax-plugin-import-"))
    await Bun.write(
      join(source, "manifest.json"),
      `${JSON.stringify(
        {
          schema: "convax.plugin/4",
          id: "imported-plugin",
          name: "Imported Plugin",
          description: "Imported Plugin description",
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
    )
    const imported = await addMarketplaceDirectory(root, source)
    const git = async (...args: string[]): Promise<string> => {
      const process = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ])
      if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
      return stdout.trim()
    }
    await git("init", "-b", "main")
    await git("config", "user.email", "marketplace-test@example.com")
    await git("config", "user.name", "Marketplace Test")
    await git("add", ".")
    await git("commit", "-m", "initial marketplace")
    const base = await git("rev-parse", "HEAD")
    const deployedDir = await mkdtemp(join(tmpdir(), "convax-market-version-deployed-"))
    await buildMarketplace({ root, outDir: deployedDir, official: false })
    expect(
      (await changedMarketplaceVersions(root, "0".repeat(40))).map(({ kind, id, version }) => ({
        kind,
        id,
        version,
      })),
    ).toEqual([
      { kind: "plugin", id: "imported-plugin", version: "1.0.0" },
      { kind: "skill", id: "example-skill", version: "0.1.0" },
    ])
    const manifest = JSON.parse(await readFile(join(imported, "manifest.json"), "utf8"))
    manifest.description = "Changed bytes at the same immutable version"
    await Bun.write(join(imported, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    await git("add", ".")
    await git("commit", "-m", "change immutable bytes without version")
    await expect(changedMarketplaceVersions(root, base)).rejects.toThrow("without a version change")
    manifest.version = "1.1.0"
    await Bun.write(join(imported, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    await git("add", ".")
    await git("commit", "-m", "bump imported plugin version")
    const changed = await changedMarketplaceVersions(root, base)
    expect(changed.map(({ kind, id, version }) => ({ kind, id, version }))).toEqual([
      { kind: "plugin", id: "imported-plugin", version: "1.1.0" },
    ])
    const build = await buildMarketplace({
      root,
      outDir: join(root, "dist"),
      previousDescriptorPath: join(deployedDir, "marketplace.json"),
      previousRegistryPath: join(deployedDir, "registry-v2.json"),
      previousShowcasePath: join(deployedDir, "showcase-v2.json"),
      publishSelections: changed,
      fetchArtifact: async ({ url }) => {
        throw new Error(`unexpected inherited artifact fetch ${url}`)
      },
    })
    expect(build.releasePlan.releases.some(({ tag }) => tag === "plugin-imported-plugin-v1.1.0")).toBe(true)
    expect(build.releasePlan.releases.some(({ tag }) => tag === `registry-v2-${build.registry.revision}`)).toBe(true)
    const changedPath = join(root, "changed-cli.json")
    await Bun.write(changedPath, `${JSON.stringify(changed)}\n`)
    const cliOut = join(root, "dist-cli")
    await runMarketplaceCli([
      "build-index",
      root,
      "--out",
      cliOut,
      "--changed",
      changedPath,
      "--previous-descriptor",
      join(deployedDir, "marketplace.json"),
      "--previous",
      join(deployedDir, "registry-v2.json"),
      "--previous-showcase",
      join(deployedDir, "showcase-v2.json"),
    ])
    expect(JSON.parse(await readFile(join(cliOut, "registry-v2.json"), "utf8"))).toEqual(build.registry)
    expect((await stat(join(root, "dist/site/marketplace.json"))).isFile()).toBe(true)
    expect((await stat(join(root, "dist/site/registry-v2.json"))).isFile()).toBe(true)
    expect((await stat(join(root, "dist/site/showcase-v2.json"))).isFile()).toBe(true)
    await rm(imported, { recursive: true })
    await git("add", ".")
    await git("commit", "-m", "remove package without yanking")
    await expect(changedMarketplaceVersions(root, base)).rejects.toThrow("yanked")
  })

  test("separates installed and built workspace outputs from immutable package closure", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-market-version-closure-"))
    const pluginRoot = join(root, "packages/plugins/example-plugin")
    const contentRoot = join(pluginRoot, "package")
    const companionRoot = join(root, "packages/tools/example-companion")
    const companionTarget = join(companionRoot, "dist/darwin-arm64/example-companion")
    await mkdir(contentRoot, { recursive: true })
    await mkdir(join(companionRoot, "src"), { recursive: true })
    await Bun.write(join(root, ".gitignore"), "node_modules/\ndist/\n")
    await Bun.write(
      join(pluginRoot, "convax-package.json"),
      `${JSON.stringify({
        schema: "convax.package/1",
        kind: "plugin",
        id: "example-plugin",
        name: "Example Plugin",
        description: "Example Plugin",
        version: "1.0.0",
        showcase: {
          poster: { path: "assets/poster.bin", mime: "image/png" },
        },
        companions: [{
          command: "example-companion",
          version: "1.0.0",
          source: "packages/tools/example-companion",
          targets: [{
            platform: "darwin",
            arch: "arm64",
            path: "dist/darwin-arm64/example-companion",
          }],
        }],
      }, null, 2)}\n`,
    )
    await Bun.write(
      join(contentRoot, "manifest.json"),
      `${JSON.stringify({
        schema: "convax.plugin/2",
        id: "example-plugin",
        name: "Example Plugin",
        description: "Example Plugin",
        version: "1.0.0",
      }, null, 2)}\n`,
    )
    await Bun.write(join(companionRoot, "src/index.ts"), "export const value = 1\n")
    const git = async (...args: string[]): Promise<string> => {
      const process = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ])
      if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
      return stdout.trim()
    }
    await git("init", "-b", "main")
    await git("config", "user.email", "marketplace-test@example.com")
    await git("config", "user.name", "Marketplace Test")
    await git("add", ".")
    await git("commit", "-m", "initial package")
    const base = await git("rev-parse", "HEAD")

    await mkdir(join(pluginRoot, "node_modules/example"), { recursive: true })
    await Bun.write(join(pluginRoot, "node_modules/example/index.js"), "ignored\n")
    await mkdir(join(companionRoot, "node_modules/example"), { recursive: true })
    await Bun.write(join(companionRoot, "node_modules/example/index.js"), "ignored\n")
    await mkdir(join(companionTarget, ".."), { recursive: true })
    await Bun.write(companionTarget, "built output\n")
    await mkdir(join(pluginRoot, "showcase/dist"), { recursive: true })
    await Bun.write(join(pluginRoot, "showcase/dist/unreferenced.bin"), "ignored and unreferenced\n")
    expect(await changedMarketplaceVersions(root, base)).toEqual([])

    await Bun.write(
      join(root, ".git/info/exclude"),
      "packages/plugins/example-plugin/assets/poster.bin\n",
    )
    await mkdir(join(pluginRoot, "assets"), { recursive: true })
    await Bun.write(join(pluginRoot, "assets/poster.bin"), "ignored referenced Showcase bytes\n")
    await expect(changedMarketplaceVersions(root, base)).rejects.toThrow("without a version change")
    await rm(join(pluginRoot, "assets/poster.bin"))

    await mkdir(join(contentRoot, "dist"), { recursive: true })
    await Bun.write(join(contentRoot, "dist/injected.js"), "packable ignored bytes\n")
    await expect(changedMarketplaceVersions(root, base)).rejects.toThrow("without a version change")
    await rm(join(contentRoot, "dist"), { recursive: true })

    await Bun.write(join(companionRoot, "src/index.ts"), "export const value = 2\n")
    await git("add", "packages/tools/example-companion/src/index.ts")
    await git("commit", "-m", "change companion source without version")
    await expect(changedMarketplaceVersions(root, base)).rejects.toThrow("without a version change")

    const authoringPath = join(pluginRoot, "convax-package.json")
    const authoring = JSON.parse(await readFile(authoringPath, "utf8"))
    authoring.version = "1.1.0"
    await Bun.write(authoringPath, `${JSON.stringify(authoring, null, 2)}\n`)
    const manifestPath = join(contentRoot, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.version = "1.1.0"
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await git("add", "packages/plugins/example-plugin")
    await git("commit", "-m", "advance plugin version")
    expect(await changedMarketplaceVersions(root, base)).toEqual([{
      kind: "plugin",
      id: "example-plugin",
      version: "1.1.0",
      previousVersion: "1.0.0",
      releaseTag: "plugin-example-plugin-v1.1.0",
    }])
  })

  test("selectively replaces one package while preserving the deployed Registry and Showcase", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-market-selective-"))
    await createMarketplaceStarter(root, {
      id: "acme-market",
      name: "Acme Market",
      owner: "acme",
      repository: "extensions",
      starter: "skill",
    })
    await rm(join(root, "packages/skills/example-skill"), { recursive: true })

    const writeSkill = async (id: string, version: string, description: string, poster: Uint8Array) => {
      const packageRoot = join(root, "packages/skills", id)
      await mkdir(join(packageRoot, "package"), { recursive: true })
      await mkdir(join(packageRoot, "showcase"), { recursive: true })
      await Bun.write(
        join(packageRoot, "convax-package.json"),
        `${JSON.stringify(
          {
            schema: "convax.package/1",
            kind: "skill",
            id,
            name: id,
            description,
            version,
            showcase: { poster: { path: "showcase/poster.png", mime: "image/png" } },
          },
          null,
          2,
        )}\n`,
      )
      await Bun.write(
        join(packageRoot, "package/SKILL.md"),
        `---\nname: ${id}\nversion: ${version}\ndescription: ${description}\n---\n`,
      )
      await Bun.write(join(packageRoot, "showcase/poster.png"), poster)
    }
    const writePlugin = async (id: string, version: string, description: string) => {
      const packageRoot = join(root, "packages/plugins", id)
      await mkdir(join(packageRoot, "package"), { recursive: true })
      await Bun.write(
        join(packageRoot, "convax-package.json"),
        `${JSON.stringify(
          {
            schema: "convax.package/1",
            kind: "plugin",
            id,
            name: id,
            description,
            version,
          },
          null,
          2,
        )}\n`,
      )
      await Bun.write(
        join(packageRoot, "package/manifest.json"),
        `${JSON.stringify(
          {
            schema: "convax.plugin/6",
            id,
            name: id,
            description,
            version,
          },
          null,
          2,
        )}\n`,
      )
    }

    await writeSkill("steady-skill", "1.0.0", "deployed steady metadata", new Uint8Array([1, 2, 3]))
    await writePlugin("nexus-service", "0.3.8", "deployed Nexus")
    const deployedDir = join(root, "deployed")
    const deployed = await buildMarketplace({ root, outDir: deployedDir, official: false })

    await writeSkill("steady-skill", "1.0.0", "unselected source mutation", new Uint8Array([9, 9, 9]))
    await writePlugin("nexus-service", "0.3.12", "selected Nexus")
    await writePlugin("source-only", "1.0.0", "must not enter production")
    const deployedAssets = new Map(
      await Promise.all(
        deployed.releasePlan.releases
          .flatMap(({ assets }) => assets)
          .map(async (asset) => [asset.url, new Uint8Array(await readFile(join(deployedDir, asset.path)))] as const),
      ),
    )
    const fetchArtifact = async ({ url }: { url: string }) => {
      const bytes = deployedAssets.get(url)
      if (!bytes) throw new Error(`unexpected artifact fetch ${url}`)
      return bytes
    }
    const output = await buildMarketplace({
      root,
      outDir: join(root, "selective"),
      official: false,
      previousDescriptorPath: join(deployedDir, "marketplace.json"),
      previousRegistryPath: join(deployedDir, "registry-v2.json"),
      previousShowcasePath: join(deployedDir, "showcase-v2.json"),
      publishSelections: [
        {
          kind: "plugin",
          id: "nexus-service",
          version: "0.3.12",
          previousVersion: "0.3.8",
          releaseTag: "plugin-nexus-service-v0.3.12",
        },
      ],
      fetchArtifact,
    })

    expect(output.registry.packages.map(({ kind, id, version }) => `${kind}/${id}@${version}`)).toEqual([
      "plugin/nexus-service@0.3.12",
      "skill/steady-skill@1.0.0",
    ])
    expect(output.registry.packages.find(({ id }) => id === "steady-skill")?.presentation.description).toBe(
      "deployed steady metadata",
    )
    expect(output.showcase.packages).toHaveLength(1)
    expect(output.showcase.packages[0]?.presentation.poster.sha256).toBe(
      deployed.showcase.packages[0]?.presentation.poster.sha256,
    )
    expect(new URL(output.showcase.packages[0]!.presentation.poster.url).pathname).toContain(
      `/registry-v2-${output.registry.revision}/`,
    )
    expect(output.releasePlan.releases.map(({ tag }) => tag).sort()).toEqual(
      ["plugin-nexus-service-v0.3.12", `registry-v2-${output.registry.revision}`].sort(),
    )
    const descriptor = parseMarketplaceDescriptor(JSON.parse(await readFile(join(root, "marketplace.json"), "utf8")))
    const context = JSON.parse(await readFile(join(root, "selective/selection-context.json"), "utf8"))
    expect(parseMarketplaceSelectionContext(context, descriptor)).toEqual(output.selectionContext!)
    expect(() =>
      parseMarketplaceSelectionContext(
        {
          ...context,
          descriptor: { ...context.descriptor, name: "Changed descriptor" },
        },
        descriptor,
      ),
    ).toThrow("cannot change")
    await writePlugin("nexus-service", "0.3.7", "regressed Nexus")
    await expect(
      buildMarketplace({
        root,
        outDir: join(root, "regressed"),
        official: false,
        previousDescriptorPath: join(deployedDir, "marketplace.json"),
        previousRegistryPath: join(deployedDir, "registry-v2.json"),
        previousShowcasePath: join(deployedDir, "showcase-v2.json"),
        publishSelections: [
          {
            kind: "plugin",
            id: "nexus-service",
            version: "0.3.7",
            previousVersion: "0.3.6",
            releaseTag: "plugin-nexus-service-v0.3.7",
          },
        ],
        fetchArtifact,
      }),
    ).rejects.toThrow("advance beyond 0.3.8")
  })

  test("dogfoods Official parent metadata, source-controlled sequence, v1 projection, bundle and composed lock input", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-market-official-"))
    await createMarketplaceStarter(root, {
      id: "convax-official",
      name: "Convax Official",
      owner: "microvoid",
      repository: "convax-plugins",
      starter: "skill",
    })
    const starter = join(root, "packages/skills/example-skill")
    await rm(starter, { recursive: true })
    const officialDescriptor = JSON.parse(await readFile(join(root, "marketplace.json"), "utf8"))
    officialDescriptor.registry.v2.url = "https://microvoid.github.io/convax-plugins/registry/v2/index.json"
    officialDescriptor.registry.v1 = {
      url: "https://microvoid.github.io/convax-plugins/registry/v1/index.json",
    }
    officialDescriptor.showcase.v2.url = "https://microvoid.github.io/convax-plugins/showcase/v2/index.json"
    await Bun.write(join(root, "marketplace.json"), `${JSON.stringify(officialDescriptor, null, 2)}\n`)
    const skillRoot = join(root, "packages/skills/canvas-storyboard")
    await mkdir(join(skillRoot, "package"), { recursive: true })
    await mkdir(join(skillRoot, "showcase"), { recursive: true })
    await Bun.write(
      join(skillRoot, "convax-package.json"),
      `${JSON.stringify(
        {
          schema: "convax.package/1",
          kind: "skill",
          id: "canvas-storyboard",
          name: "Storyboard",
          description: "Storyboard workflow",
          version: "0.1.0",
          compatibility: { skillSchema: "opencode.skill/1" },
          showcase: {
            poster: {
              path: "showcase/poster.png",
              mime: "image/png",
              alt: "Storyboard preview",
              width: 1280,
              height: 720,
            },
          },
          yanked: false,
        },
        null,
        2,
      )}\n`,
    )
    await Bun.write(
      join(skillRoot, "package/SKILL.md"),
      "---\nname: canvas-storyboard\ndescription: Storyboard workflow\n---\n\n# Storyboard\n",
    )
    await Bun.write(join(skillRoot, "showcase/poster.png"), new Uint8Array([137, 80, 78, 71, 1]))
    await Bun.write(join(root, "registry/config.json"), '{\n  "sequence": 44,\n  "yanked": []\n}\n')
    await Bun.write(
      join(root, "catalogs/builtin.json"),
      '{\n  "schema": "convax.builtin-config/1",\n  "members": [{"kind":"skill","id":"canvas-storyboard"}]\n}\n',
    )
    const ffmpegPluginRoot = join(root, "packages/plugins/ffmpeg-tools")
    await mkdir(join(ffmpegPluginRoot, "package"), { recursive: true })
    await Bun.write(
      join(ffmpegPluginRoot, "convax-package.json"),
      `${JSON.stringify(
        {
          schema: "convax.package/1",
          kind: "plugin",
          id: "ffmpeg-tools",
          name: "FFmpeg Tools",
          description: "FFmpeg tools",
          version: "0.1.0",
          companions: [
            {
              command: "ffmpeg-tools",
              version: "0.1.0",
              source: "companions/ffmpeg-tools/0.1.0",
              targets: [{ platform: "darwin", arch: "arm64", path: "darwin-arm64/ffmpeg-tools" }],
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
    await Bun.write(
      join(ffmpegPluginRoot, "package/manifest.json"),
      `${JSON.stringify(
        {
          schema: "convax.plugin/7",
          id: "ffmpeg-tools",
          name: "FFmpeg Tools",
          description: "FFmpeg tools",
          version: "0.1.0",
          contributes: { skills: [{ name: "ffmpeg-canvas", path: "skills/ffmpeg-canvas" }] },
        },
        null,
        2,
      )}\n`,
    )
    const ffmpegSkillRoot = join(root, "packages/skills/ffmpeg-canvas")
    await mkdir(join(ffmpegSkillRoot, "package"), { recursive: true })
    await Bun.write(
      join(ffmpegSkillRoot, "convax-package.json"),
      `${JSON.stringify(
        {
          schema: "convax.package/1",
          kind: "skill",
          id: "ffmpeg-canvas",
          name: "FFmpeg Canvas",
          description: "FFmpeg Canvas workflow",
          version: "0.1.0",
          ownerPluginId: "ffmpeg-tools",
        },
        null,
        2,
      )}\n`,
    )
    await Bun.write(
      join(ffmpegSkillRoot, "package/SKILL.md"),
      "---\nname: ffmpeg-canvas\nversion: 0.1.0\ndescription: FFmpeg Canvas workflow\n---\n",
    )
    const companion = join(root, "companions/ffmpeg-tools/0.1.0/darwin-arm64/ffmpeg-tools")
    await mkdir(join(root, "companions/ffmpeg-tools/0.1.0/darwin-arm64"), { recursive: true })
    await Bun.write(companion, "#!/bin/sh\nexit 0\n")
    await Bun.write(
      join(root, "catalogs/preinstalled.json"),
      `${JSON.stringify(
        {
          schema: "convax.preinstalled-config/1",
          packages: [
            {
              marketplaceId: "convax-official",
              kind: "plugin",
              id: "ffmpeg-tools",
              targets: ["darwin-arm64"],
              setup: "explicit",
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
    const nexusRoot = join(root, "packages/plugins/nexus-service")
    await mkdir(join(nexusRoot, "package"), { recursive: true })
    const writeNexus = async (version: string, description: string) => {
      await Bun.write(
        join(nexusRoot, "convax-package.json"),
        `${JSON.stringify(
          {
            schema: "convax.package/1",
            kind: "plugin",
            id: "nexus-service",
            name: "Nexus Service",
            description,
            version,
          },
          null,
          2,
        )}\n`,
      )
      await Bun.write(
        join(nexusRoot, "package/manifest.json"),
        `${JSON.stringify(
          {
            schema: "convax.plugin/6",
            id: "nexus-service",
            name: "Nexus Service",
            description,
            version,
          },
          null,
          2,
        )}\n`,
      )
    }
    await writeNexus("0.3.8", "deployed Nexus")
    const catalogDir = join(root, "dist/catalog")
    const first = await buildMarketplace({
      root,
      outDir: catalogDir,
      official: true,
      initialOfficial: true,
      v1Revision: "a".repeat(40),
    })
    expect(first.registry.sequence).toBe(45)
    expect(first.registry.revision).toMatch(/^[0-9a-f]{64}$/)
    expect(first.registryV1?.revision).toBe("a".repeat(40))
    expect((await stat(join(catalogDir, "site/registry/v2/index.json"))).isFile()).toBe(true)
    expect((await stat(join(catalogDir, "site/registry/v1/index.json"))).isFile()).toBe(true)
    expect((await stat(join(catalogDir, "site/showcase/v2/index.json"))).isFile()).toBe(true)
    expect(first.registryV1?.packages.map(({ kind, id }) => `${kind}/${id}`).sort()).toEqual([
      "plugin/ffmpeg-tools",
      "plugin/nexus-service",
      "skill/canvas-storyboard",
      "skill/ffmpeg-canvas",
    ])
    await writeNexus("0.3.12", "selected Nexus")
    const storyboardMetadata = JSON.parse(await readFile(join(skillRoot, "convax-package.json"), "utf8"))
    storyboardMetadata.description = "unselected source mutation"
    await Bun.write(join(skillRoot, "convax-package.json"), `${JSON.stringify(storyboardMetadata, null, 2)}\n`)
    await Bun.write(join(skillRoot, "showcase/poster.png"), new Uint8Array([9, 9, 9]))
    const deployedAssets = new Map(
      await Promise.all(
        first.releasePlan.releases
          .flatMap(({ assets }) => assets)
          .map(async (asset) => [asset.url, new Uint8Array(await readFile(join(catalogDir, asset.path)))] as const),
      ),
    )
    const fetchArtifact = async ({ url }: { url: string }) => {
      const bytes = deployedAssets.get(url)
      if (!bytes) throw new Error(`unexpected production artifact ${url}`)
      return bytes
    }
    const bootstrapDir = join(root, "dist/selective-bootstrap-v1")
    const bootstrapped = await buildMarketplace({
      root,
      outDir: bootstrapDir,
      official: true,
      previousDescriptorPath: join(catalogDir, "marketplace.json"),
      bootstrapPreviousV1Path: join(catalogDir, "registry-v1.json"),
      previousShowcaseV1Path: join(catalogDir, "showcase-v1.json"),
      publishSelections: [
        {
          kind: "plugin",
          id: "nexus-service",
          version: "0.3.12",
          previousVersion: "0.3.11",
          releaseTag: "plugin-nexus-service-v0.3.12",
        },
      ],
      fetchArtifact,
      v1Revision: "b".repeat(40),
    })
    expect(bootstrapped.registry.sequence).toBe(46)
    expect(bootstrapped.registry.packages.find(({ id }) => id === "nexus-service")?.version).toBe("0.3.12")
    expect(bootstrapped.registry.packages.find(({ id }) => id === "canvas-storyboard")?.presentation.description).toBe(
      "Storyboard workflow",
    )
    expect(bootstrapped.showcase.packages[0]?.presentation.poster.sha256).toBe(
      first.showcaseV1!.packages[0]!.poster.sha256,
    )
    expect(new URL(bootstrapped.showcase.packages[0]!.presentation.poster.url).pathname).toContain(
      `/registry-v2-${bootstrapped.registry.revision}/`,
    )
    expect(bootstrapped.showcaseV1?.packages).toEqual(first.showcaseV1?.packages)
    expect(bootstrapped.releasePlan.releases.map(({ tag }) => tag).sort()).toEqual(
      ["plugin-nexus-service-v0.3.12", `registry-v2-${bootstrapped.registry.revision}`].sort(),
    )
    expect(bootstrapped.productLockInput).toMatchObject({
      packages: [{ id: "ffmpeg-tools", artifact: { path: expect.stringContaining("inherited/") } }],
    })
    const selectiveDir = join(root, "dist/selective")
    const selective = await buildMarketplace({
      root,
      outDir: selectiveDir,
      official: true,
      previousDescriptorPath: join(catalogDir, "marketplace.json"),
      previousRegistryPath: join(catalogDir, "registry-v2.json"),
      previousShowcasePath: join(catalogDir, "showcase-v2.json"),
      previousRegistryV1Path: join(catalogDir, "registry-v1.json"),
      previousShowcaseV1Path: join(catalogDir, "showcase-v1.json"),
      publishSelections: [
        {
          kind: "plugin",
          id: "nexus-service",
          version: "0.3.12",
          previousVersion: "0.3.8",
          releaseTag: "plugin-nexus-service-v0.3.12",
        },
      ],
      fetchArtifact,
      v1Revision: "b".repeat(40),
    })
    expect(selective.registry.sequence).toBe(46)
    expect(selective.registry.packages.find(({ id }) => id === "nexus-service")?.version).toBe("0.3.12")
    expect(selective.registry.packages.find(({ id }) => id === "canvas-storyboard")?.presentation.description).toBe(
      "Storyboard workflow",
    )
    expect(selective.showcase.packages[0]?.presentation.poster.sha256).toBe(
      first.showcase.packages[0]?.presentation.poster.sha256,
    )
    expect(selective.showcaseV1?.sequence).toBe(selective.registryV1?.sequence)
    expect(selective.showcaseV1?.revision).toBe("b".repeat(40))
    expect(selective.showcaseV1?.packages).toEqual(first.showcaseV1?.packages)
    expect((await stat(join(selectiveDir, "site/showcase/v1/index.json"))).isFile()).toBe(true)
    expect(selective.releasePlan.releases.map(({ tag }) => tag).sort()).toEqual(
      ["plugin-nexus-service-v0.3.12", `registry-v2-${selective.registry.revision}`].sort(),
    )
    expect(selective.productLockInput).toMatchObject({
      packages: [{ id: "ffmpeg-tools", artifact: { path: expect.stringContaining("inherited/") } }],
    })
    await expect(
      buildMarketplace({
        root,
        outDir: join(root, "dist/selective-tampered"),
        official: true,
        previousDescriptorPath: join(catalogDir, "marketplace.json"),
        previousRegistryPath: join(catalogDir, "registry-v2.json"),
        previousShowcasePath: join(catalogDir, "showcase-v2.json"),
        previousRegistryV1Path: join(catalogDir, "registry-v1.json"),
        previousShowcaseV1Path: join(catalogDir, "showcase-v1.json"),
        publishSelections: [
          {
            kind: "plugin",
            id: "nexus-service",
            version: "0.3.12",
            previousVersion: "0.3.8",
            releaseTag: "plugin-nexus-service-v0.3.12",
          },
        ],
        fetchArtifact: async (artifact) => {
          const bytes = await fetchArtifact(artifact)
          const tampered = bytes.slice()
          tampered[0] ^= 1
          return tampered
        },
        v1Revision: "b".repeat(40),
      }),
    ).rejects.toThrow("do not match")
    const fromV2 = await buildMarketplace({
      root,
      outDir: join(root, "dist/from-v2"),
      official: true,
      previousRegistryPath: join(catalogDir, "registry-v2.json"),
      v1Revision: "b".repeat(40),
    })
    expect(fromV2.registry.sequence).toBe(46)
    const fromV1 = await buildMarketplace({
      root,
      outDir: join(root, "dist/from-v1"),
      official: true,
      bootstrapPreviousV1Path: join(catalogDir, "registry-v1.json"),
      v1Revision: "b".repeat(40),
    })
    expect(fromV1.registry.sequence).toBe(46)
    await Bun.write(
      join(root, "bad-v1.json"),
      '{"schema":"convax.registry/1","sequence":44,"revision":"bad","packages":[]}',
    )
    await expect(
      buildMarketplace({
        root,
        outDir: join(root, "dist/bad-v1"),
        official: true,
        bootstrapPreviousV1Path: join(root, "bad-v1.json"),
        v1Revision: "b".repeat(40),
      }),
    ).rejects.toThrow("revision")
    await expect(
      buildMarketplace({
        root,
        outDir: join(root, "bad"),
        official: true,
        sequence: 1,
        initialOfficial: true,
        v1Revision: "b".repeat(40),
      }),
    ).rejects.toThrow("floor/previous")
    await expect(
      buildMarketplace({
        root,
        outDir: join(root, "missing-v1-revision"),
        official: true,
        initialOfficial: true,
      }),
    ).rejects.toThrow("v1-revision")
    const builtinDir = join(root, "dist/builtin")
    const bundle = await buildBuiltinBundle({ root, outDir: builtinDir })
    expect(bundle.members[0]?.presentation.poster.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.archive.path).toContain("/releases/")
    const archiveBytes = new Uint8Array(await readFile(bundle.archive.path))
    const parsedBuiltin = parseBuiltinBundleArchive(archiveBytes)
    expect(parsedBuiltin.members.map(({ kind, id }) => `${kind}/${id}`)).toEqual(["skill/canvas-storyboard"])
    const builtinDelivery = projectBuiltinMemberDelivery(parsedBuiltin, {
      kind: "skill",
      id: "canvas-storyboard",
    })
    expect(builtinDelivery.kind).toBe("builtin-artifact")
    expect(builtinDelivery.bundleReleaseId).toBe(parsedBuiltin.release.id)
    expect(typeof builtinDelivery.path).toBe("string")
    expect(builtinDelivery.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(parsedBuiltin.members[0]?.artifact).toEqual({
      path: builtinDelivery.path,
      sha256: builtinDelivery.sha256,
      size: builtinDelivery.size,
    })
    const memberBytes = readBuiltinBundleMember(archiveBytes, builtinDelivery)
    expect(memberBytes.byteLength).toBe(builtinDelivery.size)
    memberBytes[0] ^= 1
    expect(sha256Hex(readBuiltinBundleMember(archiveBytes, builtinDelivery))).toBe(builtinDelivery.sha256)
    const nonCanonicalManifest = new TextEncoder().encode(
      `${JSON.stringify(
        {
          schema: bundle.schema,
          release: bundle.release,
          members: bundle.members,
        },
        null,
        2,
      )}\n`,
    )
    const nonCanonicalArchive = createDeterministicZip([
      { bytes: nonCanonicalManifest, mode: 0o644, path: "bundle.json" },
      ...(await Promise.all(
        bundle.members
          .flatMap((member) => [
            member.artifact,
            member.presentation.poster,
            ...(member.presentation.animation ? [member.presentation.animation] : []),
          ])
          .map(async (asset) => ({
            bytes: new Uint8Array(await readFile(join(builtinDir, asset.path))),
            mode: 0o644 as const,
            path: asset.path,
          })),
      )),
    ])
    expect(() => parseBuiltinBundleArchive(nonCanonicalArchive)).toThrow("canonical JSON")
    const tamperedArchive = archiveBytes.slice()
    tamperedArchive[0] ^= 1
    expect(() => parseBuiltinBundleArchive(tamperedArchive)).toThrow("local")
    const tamperedAttributes = archiveBytes.slice()
    const tamperedView = new DataView(
      tamperedAttributes.buffer,
      tamperedAttributes.byteOffset,
      tamperedAttributes.byteLength,
    )
    const centralOffset = tamperedView.getUint32(tamperedAttributes.byteLength - 22 + 16, true)
    tamperedView.setUint32(centralOffset + 38, 0o120777 << 16, true)
    expect(() => parseBuiltinBundleArchive(tamperedAttributes)).toThrow("stored entries")
    const tamperedHeader = archiveBytes.slice()
    const headerView = new DataView(tamperedHeader.buffer, tamperedHeader.byteOffset, tamperedHeader.byteLength)
    const headerCentralOffset = headerView.getUint32(tamperedHeader.byteLength - 22 + 16, true)
    headerView.setUint16(headerCentralOffset + 14, 0, true)
    expect(() => parseBuiltinBundleArchive(tamperedHeader)).toThrow("stored entries")
    expect(() => parseBuiltinBundleArchive(archiveBytes, { maxTotalEntryBytes: 1 })).toThrow("aggregate")
    expect(() =>
      createDeterministicZip([
        { bytes: new Uint8Array([1]), mode: 0o644, path: "duplicate" },
        { bytes: new Uint8Array([2]), mode: 0o644, path: "duplicate" },
      ]),
    ).toThrow("unique")
    expect(() =>
      createDeterministicZip([
        { bytes: new Uint8Array([1]), mode: 0o644, path: "Assets/Poster.png" },
        { bytes: new Uint8Array([2]), mode: 0o644, path: "assets/poster.png" },
      ]),
    ).toThrow("case-insensitive")
    expect(() =>
      createDeterministicZip([{ bytes: new Uint8Array([1]), mode: 0o600, path: "unsupported-mode" }]),
    ).toThrow("mode")
    await expect(
      buildBuiltinBundle({
        root,
        outDir: join(root, "dist/builtin-wrong-release"),
        releaseId: "f".repeat(64),
      }),
    ).rejects.toThrow("content digest")
    expect(first.showcase.packages.map(({ kind, id }) => `${kind}/${id}`)).toEqual(["skill/canvas-storyboard"])
    const showcaseRelease = first.releasePlan.releases.find(
      (release) => release.tag === `registry-v2-${first.registry.revision}`,
    )
    expect(showcaseRelease?.assets.some(({ name }) => name.endsWith("-poster.png"))).toBe(true)
    const lock = await composeProductLockInput({
      catalogDir,
      builtinDir,
      outFile: join(root, "dist/product-lock-input.json"),
    })
    expect(lock).toMatchObject({
      schema: "convax.product-lock-input/1",
      builtinReservations: [{ kind: "skill", id: "canvas-storyboard" }],
      packages: [
        {
          marketplaceId: "convax-official",
          kind: "plugin",
          id: "ffmpeg-tools",
          setup: "explicit",
          ownedSkills: [{ path: expect.any(String), url: expect.any(String) }],
          companions: [{ platform: "darwin", arch: "arm64" }],
        },
      ],
    })
    const cliLockPath = join(root, "dist/product-lock-input-cli.json")
    await runMarketplaceCli(["lock-input", "--catalog", catalogDir, "--builtin", builtinDir, "--out", cliLockPath])
    expect(JSON.parse(await readFile(cliLockPath, "utf8"))).toEqual(lock)
    const hardlink = join(skillRoot, "showcase/poster-hardlink.png")
    await link(join(skillRoot, "showcase/poster.png"), hardlink)
    const metadata = JSON.parse(await readFile(join(skillRoot, "convax-package.json"), "utf8"))
    metadata.showcase.poster.path = "showcase/poster-hardlink.png"
    await Bun.write(join(skillRoot, "convax-package.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    await expect(buildBuiltinBundle({ root, outDir: join(root, "dist/hardlink") })).rejects.toThrow("single-link")
  })

  test("strict add detects exactly one root marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-market-add-"))
    await createMarketplaceStarter(root, {
      id: "acme-market",
      name: "Acme Market",
      owner: "acme",
      repository: "extensions",
      starter: "skill",
    })
    const plugin = await mkdtemp(join(tmpdir(), "convax-plugin-"))
    await Bun.write(
      join(plugin, "manifest.json"),
      JSON.stringify({ schema: "convax.plugin/1", id: "p", version: "1.0.0", name: "P" }),
    )
    await Bun.write(join(plugin, "SKILL.md"), "---\nname: mixed\ndescription: mixed\n---\n")
    await expect(addMarketplaceDirectory(root, plugin)).rejects.toThrow("exactly one")
  })

  test("new creates three supported templates and add-target never executes its binary", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-market-new-"))
    await createMarketplaceStarter(root, {
      id: "acme-market",
      name: "Acme Market",
      owner: "acme",
      repository: "extensions",
      starter: "mcp-server",
    })
    const mcp = join(root, "packages/mcp-servers/example-mcp")
    const marker = join(root, "must-not-exist")
    const binary = join(root, "companion")
    const server = JSON.parse(await readFile(join(mcp, "server.json"), "utf8"))
    delete server.remotes
    await Bun.write(join(mcp, "server.json"), `${JSON.stringify(server, null, 2)}\n`)
    await Bun.write(
      join(mcp, "convax-mcp.json"),
      `${JSON.stringify(
        {
          schema: "convax.mcp-server-extension/1",
          runtime: {
            kind: "managed-stdio",
            command: "companion",
            argv: [],
            compatibility: { targets: ["darwin-arm64"] },
          },
        },
        null,
        2,
      )}\n`,
    )
    await Bun.write(binary, `#!/bin/sh\ntouch '${marker}'\n`)
    const wrongBasename = join(root, "wrong-command")
    await Bun.write(wrongBasename, "not the declared command")
    await expect(addTarget(root, mcp, { target: "darwin-arm64", file: wrongBasename })).rejects.toThrow("basename")
    await expect(addTarget(root, mcp, { target: "linux-arm64", file: binary })).rejects.toThrow("not declared")
    const hardlink = join(root, "companion-hardlink")
    await link(binary, hardlink)
    await expect(addTarget(root, mcp, { target: "darwin-arm64", file: binary })).rejects.toThrow("single-link")
    await rm(hardlink)
    const addedTarget = await addTarget(root, mcp, { target: "darwin-arm64", file: binary })
    expect(await stat(marker).catch(() => undefined)).toBeUndefined()
    expect(addedTarget).not.toContain(server.name)
    expect(await readFile(addedTarget)).toEqual(await readFile(binary))
    expect(await readFile(join(mcp, "server.json"), "utf8")).toContain("example-mcp")
    await createMarketplaceTemplate(root, "plugin", "second-plugin")
    await createMarketplaceTemplate(root, "skill", "second-skill")
    const unsupportedMcp = await createMarketplaceTemplate(root, "mcp-server", "unsupported-mcp")
    const unsupportedServer = JSON.parse(await readFile(join(unsupportedMcp, "server.json"), "utf8"))
    unsupportedServer.remotes = [
      {
        type: "streamable-http",
        url: "https://example.com/{tenant}",
        variables: { tenant: { description: "Tenant" } },
      },
    ]
    await Bun.write(join(unsupportedMcp, "server.json"), `${JSON.stringify(unsupportedServer, null, 2)}\n`)
    expect(await stat(join(root, "packages/plugins/second-plugin/manifest.json"))).toBeTruthy()
    expect(await stat(join(root, "packages/skills/second-skill/SKILL.md"))).toBeTruthy()
    const build = await buildMarketplace({ root, outDir: join(root, "dist") })
    expect(build.registry.packages.some(({ id }) => id === unsupportedServer.name)).toBe(false)
    expect(build.artifacts.some(({ id }) => id === unsupportedServer.name)).toBe(false)
    const mcpRelease = build.releasePlan.releases.find((release) => release.tag.startsWith("mcp-server-"))
    expect(mcpRelease?.tag).toMatch(/^mcp-server-[0-9a-f]{16}-v[0-9a-f]{64}$/)
    expect(mcpRelease?.tag).not.toContain(server.version)
    expect(mcpRelease?.assets.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("server.json"),
        expect.stringContaining("convax-mcp.json"),
        expect.stringContaining("companion"),
      ]),
    )
    expect(build.artifacts.some(({ path }) => path.endsWith("mcp-server.zip"))).toBe(false)
  })
})
