import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import { WebPluginManager, type WebPluginBundle } from "./plugin-manager"
import { ToolPluginAuthorizationStore, type ToolPluginExecutableBinding } from "./tool-plugin-authorizations"

const roots = new Set<string>()

afterEach(async () => {
  await Promise.all([...roots].map((root) => fs.rm(root, { force: true, recursive: true })))
  roots.clear()
})

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-tool-authorization-test-"))
  roots.add(root)
  return root
}

function plugin(version = "1.0.0", command = "image-tool"): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: {
      generation: {
        tools: [
          {
            acceptedInputs: ["text"],
            description: "Generate image",
            id: "image.generate",
            output: "image",
            title: "Generate",
          },
        ],
      },
    },
    description: "Image tools",
    id: "image-tools",
    name: "Image Tools",
    runtime: { command, type: "mcp-stdio" },
    schema: "convax.plugin/2",
    version,
  }
}

function staticPlugin(): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Static",
    entry: "index.html",
    id: "static-tools",
    name: "Static Tools",
    schema: "convax.plugin/1",
    version: "1.0.0",
  }
}

function binding(digest = "a", executablePath = "/tools/image-tool"): ToolPluginExecutableBinding {
  return { path: executablePath, sha256: digest.repeat(64), size: 4_096 }
}

function store(
  root: string,
  options: {
    managed?: ToolPluginExecutableBinding | null
    path?: ToolPluginExecutableBinding
  } = {},
) {
  return new ToolPluginAuthorizationStore(root, {
    environment: { PATH: "/tools" },
    resolveExecutable: async () => options.path ?? binding("a", "/tools/image-tool"),
    resolveManagedExecutable: async () => options.managed ?? null,
  })
}

async function installAuthorization(
  authorization: ToolPluginAuthorizationStore,
  installedPlugin: InstalledWebPluginSummary,
) {
  const transaction = await authorization.prepareInstall(installedPlugin)
  await transaction.publish()
  await transaction.commit()
}

async function receiptEntries(root: string, pluginId = "image-tools") {
  return fs.readdir(path.join(root, pluginId)).catch(() => [])
}

function bundle(installedPlugin: InstalledWebPluginSummary): WebPluginBundle {
  return { files: { "manifest.json": JSON.stringify(installedPlugin) } }
}

describe("ToolPluginAuthorizationStore", () => {
  test("persists install consent across restart without a runtime prompt", async () => {
    const root = await temporaryRoot()
    const executable = binding("a", "/tools/image-tool")
    const authorization = store(path.join(root, "authorizations"), { path: executable })
    const installedPlugin = plugin()

    const transaction = await authorization.prepareInstall(installedPlugin)
    await expect(authorization.verify(installedPlugin, "path", executable)).rejects.toThrow("reinstall Plugin")
    await transaction.publish()
    await transaction.commit()
    await expect(authorization.verify(installedPlugin, "path", executable)).resolves.toBeUndefined()

    const restarted = store(path.join(root, "authorizations"), { path: executable })
    await expect(restarted.verify(installedPlugin, "path", executable)).resolves.toBeUndefined()
  })

  test("binds consent to exact executable bytes without leaking paths", async () => {
    const root = await temporaryRoot()
    const executable = binding("a")
    const authorization = store(path.join(root, "authorizations"), { path: executable })
    const installedPlugin = plugin()
    await installAuthorization(authorization, installedPlugin)

    await expect(authorization.verify(installedPlugin, "path", executable)).resolves.toBeUndefined()
    const changed = await authorization.verify(installedPlugin, "path", binding("b")).catch((error) => error)
    expect(changed).toBeInstanceOf(Error)
    expect((changed as Error).message).toContain("reinstall Plugin: image-tools")
    expect((changed as Error).message).not.toContain("/tools")
  })

  test("binds managed consent to exact bytes and the managed binding source", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const executable = binding("a", "/managed/image-tool")
    const authorization = store(authorizationRoot, { managed: executable })
    const installedPlugin = plugin()
    await installAuthorization(authorization, installedPlugin)

    await expect(authorization.verify(installedPlugin, "managed", executable)).resolves.toBeUndefined()
    await expect(authorization.verify(installedPlugin, "managed", binding("b", "/managed/image-tool"))).rejects.toThrow(
      "reinstall Plugin",
    )
    await expect(authorization.verify(installedPlugin, "path", executable)).rejects.toThrow("reinstall Plugin")

    const restarted = store(authorizationRoot, { managed: executable })
    await expect(restarted.verify(installedPlugin, "managed", executable)).resolves.toBeUndefined()
  })

  test("keeps the old receipt usable until an update commits and restores it on rollback", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const v1Binding = binding("a")
    const v2Binding = binding("b")
    const v1Store = store(authorizationRoot, { path: v1Binding })
    const v1 = plugin("1.0.0")
    const v2 = plugin("2.0.0")
    await installAuthorization(v1Store, v1)

    const rollbackStore = store(authorizationRoot, { path: v2Binding })
    const rolledBack = await rollbackStore.prepareInstall(v2)
    await rolledBack.publish()
    await expect(v1Store.verify(v1, "path", v1Binding)).resolves.toBeUndefined()
    await expect(rollbackStore.verify(v2, "path", v2Binding)).resolves.toBeUndefined()
    await rolledBack.rollback()
    await expect(v1Store.verify(v1, "path", v1Binding)).resolves.toBeUndefined()
    await expect(rollbackStore.verify(v2, "path", v2Binding)).rejects.toThrow("reinstall Plugin")

    const committed = await rollbackStore.prepareInstall(v2)
    await committed.publish()
    await committed.commit()
    await expect(rollbackStore.verify(v2, "path", v2Binding)).resolves.toBeUndefined()
    await expect(v1Store.verify(v1, "path", v1Binding)).rejects.toThrow("reinstall Plugin")
    expect((await receiptEntries(authorizationRoot)).filter((entry) => entry.endsWith(".json"))).toHaveLength(1)
  })

  test("fails installation when PATH cannot be verified and never leaves a receipt", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const authorization = new ToolPluginAuthorizationStore(authorizationRoot, {
      environment: { PATH: "/missing" },
      resolveExecutable: async () => {
        throw new Error("not found at /secret/path")
      },
    })

    const error = await authorization.prepareInstall(plugin()).catch((failure) => failure)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("could not be verified during installation")
    expect((error as Error).message).not.toContain("/secret/path")
    expect(await receiptEntries(authorizationRoot)).toEqual([])
  })

  test("never falls back to a same-named PATH command when a managed install is required", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const sameBytes = binding("a", "/tools/image-tool")
    const authorization = store(authorizationRoot, { managed: null, path: sameBytes })

    await expect(authorization.prepareInstall(plugin(), { binding: sameBytes, kind: "managed" })).rejects.toThrow(
      "could not be verified during installation",
    )
    expect(await receiptEntries(authorizationRoot)).toEqual([])
  })

  test("fails closed on a tampered receipt and removes authorization on uninstall", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const executable = binding("a", "/tools/image-tool")
    const authorization = store(authorizationRoot, { path: executable })
    const installedPlugin = plugin()
    await installAuthorization(authorization, installedPlugin)
    const [receipt] = await receiptEntries(authorizationRoot)
    await fs.writeFile(path.join(authorizationRoot, installedPlugin.id, receipt!), "{}\n")
    await expect(authorization.verify(installedPlugin, "path", executable)).rejects.toThrow("reinstall Plugin")

    await authorization.revoke(installedPlugin.id)
    await expect(authorization.verify(installedPlugin, "path", executable)).rejects.toThrow("reinstall Plugin")
    expect(await receiptEntries(authorizationRoot)).toEqual([])
  })

  test("reconcile never converts a PATH installation to an unexpected managed executable", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const executable = binding("a", "/tools/image-tool")
    const pathStore = store(authorizationRoot, { path: executable })
    const installedPlugin = plugin()
    await installAuthorization(pathStore, installedPlugin)

    const managed = binding("a", "/managed/image-tool")
    const managedStore = store(authorizationRoot, { managed })
    await managedStore.reconcile([installedPlugin])
    await expect(managedStore.verify(installedPlugin, "managed", managed)).rejects.toThrow("reinstall Plugin")
    await expect(pathStore.verify(installedPlugin, "path", executable)).rejects.toThrow("reinstall Plugin")
  })

  test("transient binding resolution failure leaves prior consent inert and recoverable", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const executable = binding("a", "/tools/image-tool")
    const installedPlugin = plugin()
    const healthy = store(authorizationRoot, { path: executable })
    await installAuthorization(healthy, installedPlugin)
    const priorEntries = await receiptEntries(authorizationRoot)

    const unavailable = new ToolPluginAuthorizationStore(authorizationRoot, {
      environment: { PATH: "/tools" },
      resolveExecutable: async () => {
        throw new Error("temporary filesystem failure")
      },
    })
    await unavailable.reconcile([installedPlugin])

    expect(await receiptEntries(authorizationRoot)).toEqual(priorEntries)
    await expect(healthy.verify(installedPlugin, "path", executable)).resolves.toBeUndefined()
  })

  test("static Plugins require no executable authorization receipt", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const authorization = store(authorizationRoot)
    const transaction = await authorization.prepareInstall(staticPlugin())
    await transaction.publish()
    await transaction.commit()
    expect(await fs.readdir(authorizationRoot).catch(() => [])).toEqual([])
  })
})

describe("Plugin publication authorization transaction", () => {
  test("manual install preflights PATH and publishes its receipt with the package", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const manager = new WebPluginManager(path.join(root, "plugins"))
    const executable = binding("a", "/tools/image-tool")
    const authorization = store(authorizationRoot, { path: executable })
    const installedPlugin = plugin()

    await manager.installBundle(bundle(installedPlugin), {
      beforePublish: (candidate) => authorization.prepareInstall(candidate),
    })
    expect(await manager.list()).toEqual([installedPlugin])
    await expect(authorization.verify(installedPlugin, "path", executable)).resolves.toBeUndefined()
  })

  test("already-installed and downgrade failures do not prepare or leave authorization state", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const manager = new WebPluginManager(path.join(root, "plugins"))
    const authorization = store(authorizationRoot, { path: binding("a", "/tools/image-tool") })
    await manager.installBundle(bundle(plugin("2.0.0")))
    let preparations = 0
    const beforePublish = async (candidate: InstalledWebPluginSummary) => {
      preparations += 1
      return authorization.prepareInstall(candidate)
    }

    await expect(manager.installBundle(bundle(plugin("3.0.0")), { beforePublish })).rejects.toThrow("already installed")
    await expect(
      manager.installBundle(bundle(plugin("1.0.0")), { beforePublish, replaceExisting: true }),
    ).rejects.toThrow("newer version")
    expect(preparations).toBe(0)
    expect(await receiptEntries(authorizationRoot)).toEqual([])
  })

  test("rolls back both package and receipt when authorization commit fails", async () => {
    const root = await temporaryRoot()
    const manager = new WebPluginManager(path.join(root, "plugins"))
    let published = 0
    let rolledBack = 0
    await expect(
      manager.installBundle(bundle(plugin()), {
        beforePublish: async () => ({
          async commit() {
            throw new Error("receipt commit failed")
          },
          async publish() {
            published += 1
          },
          async rollback() {
            rolledBack += 1
          },
        }),
      }),
    ).rejects.toThrow("publication rollback failed")
    expect(published).toBe(1)
    expect(rolledBack).toBe(1)
    expect(await manager.list()).toEqual([])
  })
})
