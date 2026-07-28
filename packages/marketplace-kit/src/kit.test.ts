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
      publishIdentities: changed.map(({ kind, id }) => `${kind}\0${id}`),
    })
    expect(build.releasePlan.releases.some(({ tag }) => tag === "plugin-imported-plugin-v1.1.0")).toBe(true)
    expect(build.releasePlan.releases.some(({ tag }) => tag === `registry-v2-${build.registry.revision}`)).toBe(true)
    expect((await stat(join(root, "dist/site/marketplace.json"))).isFile()).toBe(true)
    expect((await stat(join(root, "dist/site/registry-v2.json"))).isFile()).toBe(true)
    expect((await stat(join(root, "dist/site/showcase-v2.json"))).isFile()).toBe(true)
    await rm(imported, { recursive: true })
    await git("add", ".")
    await git("commit", "-m", "remove package without yanking")
    await expect(changedMarketplaceVersions(root, base)).rejects.toThrow("yanked")
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
          showcase: { poster: { path: "showcase/poster.png", mime: "image/png" } },
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
      "skill/canvas-storyboard",
      "skill/ffmpeg-canvas",
    ])
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
