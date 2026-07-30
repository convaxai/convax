import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { parseWebPluginManifest } from "../plugin-contracts"
import { ManagedPluginCompanionStore, type ManagedPluginCompanionInstall } from "./managed-plugin-companions"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function setup(options: { createParent?: boolean; platform?: NodeJS.Platform } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "convax-managed-companion-"))
  roots.push(parent)
  const root = path.join(parent, "plugin-companions")
  if (options.createParent) await fs.mkdir(root, { mode: 0o700 })
  return {
    root,
    store: new ManagedPluginCompanionStore(root, {
      arch: "arm64",
      platform: options.platform ?? "darwin",
    }),
  }
}

function installInput(
  text: string,
  overrides: Partial<ManagedPluginCompanionInstall> = {},
): ManagedPluginCompanionInstall {
  const bytes = new TextEncoder().encode(text)
  return {
    arch: "arm64",
    bytes,
    command: "example-tool",
    platform: "darwin",
    pluginId: "example-plugin",
    pluginVersion: "1.0.0",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
    version: "2.0.0",
    ...overrides,
  }
}

function installedPlugin(id = "example-plugin", version = "1.0.0", command = "example-tool") {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: {
      generation: {
        models: [],
        tools: [
          {
            acceptedInputs: ["text"],
            description: "Generate an image",
            id: "generate-image",
            output: "image",
            title: "Generate image",
          },
        ],
      },
    },
    description: "Example",
    hostApi: { major: 2, optional: [], required: [] },
    id,
    name: id,
    runtime: { command, type: "mcp-stdio" },
    schema: "convax.plugin/8",
    version,
  })
}

describe("ManagedPluginCompanionStore", () => {
  test("publishes private executable bytes and resolves their live fingerprint", async () => {
    const { root, store } = await setup()
    const transaction = await store.install(installInput("first companion"))
    await transaction.commit()

    const resolved = await store.resolve("example-plugin", "1.0.0", "example-tool")
    expect(resolved).toEqual(transaction.binding)
    expect(await fs.readFile(resolved!.path, "utf8")).toBe("first companion")
    if (process.platform !== "win32") {
      expect((await fs.stat(root)).mode & 0o777).toBe(0o700)
      expect((await fs.stat(resolved!.path)).mode & 0o777).toBe(0o500)
    }
  })

  test("recognizes the exact convax-bun header without changing native companion handling", async () => {
    const { root, store } = await setup()
    const script = "#!/usr/bin/env convax-bun\nconsole.log('ready')\n"
    const transaction = await store.install(installInput(script))
    await transaction.commit()

    expect(transaction.binding).toMatchObject({ runtime: "bun" })
    await expect(store.resolve("example-plugin", "1.0.0", "example-tool")).resolves.toEqual(transaction.binding)
    const receipt = JSON.parse(
      await fs.readFile(path.join(path.dirname(transaction.binding.path), ".convax-companion.json"), "utf8"),
    )
    expect(receipt).toMatchObject({ runtime: "bun", schema: "convax.plugin-companion/2" })
    expect(await fs.readFile(transaction.binding.path, "utf8")).toBe(script)

    const native = await store.install(
      installInput("#!/usr/bin/env bun\nconsole.log('not host selected')\n", {
        pluginVersion: "2.0.0",
        version: "2.0.1",
      }),
    )
    await native.commit()
    expect(native.binding).not.toHaveProperty("runtime")
    const nativeReceipt = JSON.parse(
      await fs.readFile(path.join(path.dirname(native.binding.path), ".convax-companion.json"), "utf8"),
    )
    expect(nativeReceipt).toMatchObject({ schema: "convax.plugin-companion/1" })
    expect(nativeReceipt).not.toHaveProperty("runtime")
    expect((await fs.stat(root)).isDirectory()).toBe(true)
  })

  test("publishes a native executable filename for a Windows target", async () => {
    const { store } = await setup({ platform: "win32" })
    const transaction = await store.install(installInput("windows companion", { platform: "win32" }))
    await transaction.commit()

    const resolved = await store.resolve("example-plugin", "1.0.0", "example-tool")
    expect(path.basename(resolved!.path)).toBe("example-tool.exe")
  })

  test("keeps an identical immutable target when a later Plugin transaction rolls back", async () => {
    const { store } = await setup()
    const first = await store.install(installInput("prior bytes"))
    await first.commit()
    const prior = await store.resolve("example-plugin", "1.0.0", "example-tool")

    const identical = await store.install(installInput("prior bytes"))
    await identical.rollback()

    expect(await store.resolve("example-plugin", "1.0.0", "example-tool")).toEqual(prior)
    expect(await fs.readFile(prior!.path, "utf8")).toBe("prior bytes")
  })

  test("keeps the active Plugin version when a staged update rolls back", async () => {
    const { store } = await setup()
    const first = await store.install(installInput("prior bytes"))
    await first.commit()
    const prior = await store.resolve("example-plugin", "1.0.0", "example-tool")

    const update = await store.install(installInput("updated bytes", { pluginVersion: "2.0.0", version: "3.0.0" }))
    await update.rollback()

    expect(await store.resolve("example-plugin", "1.0.0", "example-tool")).toEqual(prior)
    expect(await store.resolve("example-plugin", "2.0.0", "example-tool")).toBeNull()
  })

  test("rejects different bytes at an immutable Plugin and companion version", async () => {
    const { store } = await setup()
    const first = await store.install(installInput("prior bytes"))
    await first.commit()
    const prior = await store.resolve("example-plugin", "1.0.0", "example-tool")

    await expect(store.install(installInput("replacement bytes"))).rejects.toThrow(/does not match|changed while/)
    expect(await store.resolve("example-plugin", "1.0.0", "example-tool")).toEqual(prior)
  })

  test("rejects bad target, size, and digest before replacing a working installation", async () => {
    const { store } = await setup()
    const first = await store.install(installInput("prior bytes"))
    await first.commit()
    const prior = await store.resolve("example-plugin", "1.0.0", "example-tool")

    await expect(store.install(installInput("bad target", { arch: "x64" }))).rejects.toThrow("does not match")
    await expect(store.install(installInput("bad size", { size: 999 }))).rejects.toThrow("do not match")
    await expect(store.install(installInput("bad digest", { sha256: "0".repeat(64) }))).rejects.toThrow("do not match")
    expect(await store.resolve("example-plugin", "1.0.0", "example-tool")).toEqual(prior)
  })

  test("fails closed on root, version, executable, and receipt symlinks", async () => {
    const rootCase = await setup()
    const outside = path.join(path.dirname(rootCase.root), "outside")
    await fs.mkdir(outside)
    await fs.symlink(outside, rootCase.root)
    await expect(rootCase.store.install(installInput("bytes"))).rejects.toThrow("symbolic link")

    for (const targetName of ["example-tool", ".convax-companion.json"] as const) {
      const { root, store } = await setup()
      const transaction = await store.install(installInput("real bytes"))
      await transaction.commit()
      const binding = await store.resolve("example-plugin", "1.0.0", "example-tool")
      const target = path.join(path.dirname(binding!.path), targetName)
      const linkSource = path.join(path.dirname(root), `link-source-${targetName.replaceAll(".", "-")}`)
      await fs.writeFile(linkSource, "outside")
      await fs.rm(target)
      await fs.symlink(linkSource, target)
      await expect(store.resolve("example-plugin", "1.0.0", "example-tool")).rejects.toThrow(
        /symbolic link|unexpected files|receipt/,
      )
    }
  })

  test("detects executable tampering by size or digest", async () => {
    for (const bytes of ["same length bytes", "different"]) {
      const { store } = await setup()
      const transaction = await store.install(installInput("original content"))
      await transaction.commit()
      const binding = await store.resolve("example-plugin", "1.0.0", "example-tool")
      await fs.chmod(binding!.path, 0o700)
      await fs.writeFile(binding!.path, bytes)
      await fs.chmod(binding!.path, 0o500)
      await expect(store.resolve("example-plugin", "1.0.0", "example-tool")).rejects.toThrow(
        /size does not match|changed while/,
      )
    }
  })

  test("reconciles updates and uninstall while a missing root stays absent", async () => {
    const absent = await setup()
    await absent.store.reconcile([])
    await expect(fs.lstat(absent.root)).rejects.toMatchObject({ code: "ENOENT" })

    const { root, store } = await setup()
    const current = await store.install(installInput("current"))
    await current.commit()
    const staleVersion = await store.install(installInput("stale", { pluginVersion: "0.9.0", version: "1.0.0" }))
    await staleVersion.commit()
    const stalePlugin = await store.install(installInput("other", { pluginId: "other-plugin" }))
    await stalePlugin.commit()

    await store.reconcile([installedPlugin()])
    expect(await store.resolve("example-plugin", "1.0.0", "example-tool")).not.toBeNull()
    expect(await store.resolve("example-plugin", "0.9.0", "example-tool")).toBeNull()
    expect(await store.resolve("other-plugin", "1.0.0", "example-tool")).toBeNull()

    await store.reconcile([])
    expect((await fs.readdir(root)).filter((name) => !name.startsWith("."))).toEqual([])
  })

  test("reconciles only the locked Plugin without touching another Plugin lifecycle", async () => {
    const { store } = await setup()
    const first = await store.install(installInput("first"))
    await first.commit()
    const other = await store.install(installInput("other", { pluginId: "other-plugin" }))
    await other.commit()

    await store.reconcilePlugin("example-plugin")

    expect(await store.resolve("example-plugin", "1.0.0", "example-tool")).toBeNull()
    expect(await store.resolve("other-plugin", "1.0.0", "example-tool")).not.toBeNull()
  })
})
