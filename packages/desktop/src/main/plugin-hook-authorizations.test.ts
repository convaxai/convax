import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import { PluginHookAuthorizationStore } from "./plugin-hook-authorizations"

const roots = new Set<string>()

afterEach(async () => {
  await Promise.all([...roots].map((root) => fs.rm(root, { force: true, recursive: true })))
  roots.clear()
})

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-hook-authorization-"))
  roots.add(root)
  return root
}

function plugin(version = "1.0.0"): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: {},
    description: "Agent lifecycle hooks",
    hooks: "hooks/index.mjs",
    id: "agent-lifecycle",
    name: "Agent Lifecycle",
    schema: "convax.plugin/2",
    version,
  }
}

async function writePackage(root: string, source: string) {
  await fs.mkdir(path.join(root, "hooks"), { recursive: true })
  await fs.writeFile(path.join(root, "hooks", "index.mjs"), source)
}

function store(root: string, installedRoot: string) {
  return new PluginHookAuthorizationStore(root, {
    resolveInstalledHook: async (installed) => path.join(installedRoot, installed.hooks!),
  })
}

async function publish(
  authorization: PluginHookAuthorizationStore,
  installed: InstalledWebPluginSummary,
  candidateRoot: string,
) {
  const transaction = await authorization.prepareInstall(installed, { root: candidateRoot })
  await transaction.publish()
  return transaction
}

describe("PluginHookAuthorizationStore", () => {
  test("loads only an install-authorized private snapshot", async () => {
    const root = await temporaryRoot()
    const candidate = path.join(root, "candidate")
    const installed = path.join(root, "installed")
    const authorizationRoot = path.join(root, "authorizations")
    const source = "export const lifecycle = async () => ({ event: async () => {} })\n"
    await writePackage(candidate, source)
    await writePackage(installed, source)
    const authorization = store(authorizationRoot, installed)
    const transaction = await publish(authorization, plugin(), candidate)
    await transaction.commit()

    const fileUrl = await authorization.resolve(plugin())
    if (!fileUrl) throw new Error("Expected an authorized Hook module")
    const snapshot = fileURLToPath(fileUrl)
    expect(snapshot.startsWith(await fs.realpath(authorizationRoot))).toBe(true)
    expect(snapshot.startsWith(installed)).toBe(false)
    expect(await fs.readFile(snapshot, "utf8")).toBe(source)

    await fs.writeFile(path.join(installed, "hooks", "index.mjs"), `${source}// tampered\n`)
    await expect(authorization.resolve(plugin())).rejects.toThrow("reinstall Plugin: agent-lifecycle")
    expect(await fs.readFile(snapshot, "utf8")).toBe(source)
  })

  test("keeps the old identity through update commit until the old Agent generation is disposed", async () => {
    const root = await temporaryRoot()
    const authorizationRoot = path.join(root, "authorizations")
    const installed = path.join(root, "installed")
    const v1Candidate = path.join(root, "candidate-v1")
    const v2Candidate = path.join(root, "candidate-v2")
    const v1Source = "export const lifecycle = async () => ({})\n"
    const v2Source = "export const lifecycle = async () => ({ event: async () => {} })\n"
    await Promise.all([
      writePackage(v1Candidate, v1Source),
      writePackage(v2Candidate, v2Source),
      writePackage(installed, v1Source),
    ])
    const authorization = store(authorizationRoot, installed)
    const v1 = plugin("1.0.0")
    const v2 = plugin("2.0.0")
    const initial = await publish(authorization, v1, v1Candidate)
    await initial.commit()
    const v1Snapshot = fileURLToPath((await authorization.resolve(v1))!)

    const rolledBack = await publish(authorization, v2, v2Candidate)
    await fs.writeFile(path.join(installed, "hooks", "index.mjs"), v2Source)
    expect(await authorization.resolve(v2)).not.toBeNull()
    await rolledBack.rollback()
    await fs.writeFile(path.join(installed, "hooks", "index.mjs"), v1Source)
    expect(await authorization.resolve(v1)).toBe(pathToFileURL(v1Snapshot).href)
    await expect(authorization.resolve(v2)).rejects.toThrow("reinstall Plugin")

    const committed = await publish(authorization, v2, v2Candidate)
    await fs.writeFile(path.join(installed, "hooks", "index.mjs"), v2Source)
    await committed.commit()
    expect(await authorization.resolve(v2)).not.toBeNull()
    expect((await fs.lstat(v1Snapshot)).isFile()).toBe(true)
    await authorization.reconcilePlugin(v2.id, v2)
    await expect(fs.lstat(v1Snapshot)).rejects.toThrow()
    await expect(authorization.resolve(v1)).rejects.toThrow("reinstall Plugin")
  })

  test("fails closed when the private snapshot changes", async () => {
    const root = await temporaryRoot()
    const candidate = path.join(root, "candidate")
    const installed = path.join(root, "installed")
    const authorizationRoot = path.join(root, "authorizations")
    await Promise.all([
      writePackage(candidate, "export default async () => ({})\n"),
      writePackage(installed, "export default async () => ({})\n"),
    ])
    const authorization = store(authorizationRoot, installed)
    const transaction = await publish(authorization, plugin(), candidate)
    await transaction.commit()
    const snapshot = fileURLToPath((await authorization.resolve(plugin()))!)
    await fs.chmod(snapshot, 0o600)
    await fs.writeFile(snapshot, "export default async () => ({ event: async () => {} })\n")

    await expect(authorization.resolve(plugin())).rejects.toThrow("reinstall Plugin: agent-lifecycle")
  })

  test("accepts only one bundled ESM file with static runtime built-in imports", async () => {
    const root = await temporaryRoot()
    const candidate = path.join(root, "candidate")
    const authorization = store(path.join(root, "authorizations"), path.join(root, "installed"))

    for (const source of [
      'import helper from "./helper.mjs"\nexport default helper\n',
      'import helper from "helper-package"\nexport default helper\n',
      `export { default } from "${["file:", "", "", "tmp", "helper.mjs"].join("/")}"\n`,
      'export default async () => import("node:fs")\n',
      "export default async (specifier) => import(specifier)\n",
      'export default async () => require("node:fs")\n',
      'const load = require\nexport default async () => load("./helper.cjs")\n',
      'export default async () => (0, require)("./helper.cjs")\n',
      "module.exports = async () => ({})\nexport default async () => ({})\n",
      "exports.AgentObserver = async () => ({})\nexport default async () => ({})\n",
      'import { createRequire } from "node:module"\nexport default async () => createRequire(import.meta.url)\n',
    ]) {
      await writePackage(candidate, source)
      await expect(authorization.prepareInstall(plugin(), { root: candidate })).rejects.toThrow(
        /bundle|dynamic runtime imports/,
      )
    }

    await writePackage(
      candidate,
      'import { constants } from "node:fs"\nexport const AgentObserver = async () => ({ constants })\n',
    )
    const transaction = await authorization.prepareInstall(plugin(), { root: candidate })
    await transaction.rollback()
  })

  test("rejects invalid JavaScript and modules without an OpenCode Plugin export", async () => {
    const root = await temporaryRoot()
    const candidate = path.join(root, "candidate")
    const authorization = store(path.join(root, "authorizations"), path.join(root, "installed"))

    for (const source of ["export default ???\n", "const = 1\n"]) {
      await writePackage(candidate, source)
      await expect(authorization.prepareInstall(plugin(), { root: candidate })).rejects.toThrow(
        "valid JavaScript ESM module",
      )
    }

    for (const source of ["module.exports = async () => ({})\n", "export {}\n"]) {
      await writePackage(candidate, source)
      await expect(authorization.prepareInstall(plugin(), { root: candidate })).rejects.toThrow(
        "must export at least one OpenCode Plugin entry",
      )
    }
  })

  test("reconcile removes orphaned authorization snapshots", async () => {
    const root = await temporaryRoot()
    const candidate = path.join(root, "candidate")
    const installed = path.join(root, "installed")
    const authorizationRoot = path.join(root, "authorizations")
    await Promise.all([
      writePackage(candidate, "export default async () => ({})\n"),
      writePackage(installed, "export default async () => ({})\n"),
    ])
    const authorization = store(authorizationRoot, installed)
    const transaction = await publish(authorization, plugin(), candidate)
    await transaction.commit()
    expect(await fs.readdir(path.join(authorizationRoot, plugin().id))).toHaveLength(2)

    await authorization.reconcile([])

    await expect(fs.lstat(path.join(authorizationRoot, plugin().id))).rejects.toThrow()
  })

  test("rejects a symbolic-link Hook during authorization even when the target is readable", async () => {
    if (process.platform === "win32") return
    const root = await temporaryRoot()
    const candidate = path.join(root, "candidate")
    const installed = path.join(root, "installed")
    await fs.mkdir(path.join(candidate, "hooks"), { recursive: true })
    await fs.writeFile(path.join(candidate, "real.mjs"), "export default async () => ({})\n")
    await fs.symlink("../real.mjs", path.join(candidate, "hooks", "index.mjs"))
    await writePackage(installed, "export default async () => ({})\n")

    await expect(
      store(path.join(root, "authorizations"), installed).prepareInstall(plugin(), { root: candidate }),
    ).rejects.toThrow("symbolic link")
  })

  test("does nothing for a Plugin without Hooks", async () => {
    const root = await temporaryRoot()
    const authorization = store(path.join(root, "authorizations"), path.join(root, "installed"))
    const withoutHooks = { ...plugin(), hooks: undefined }
    const transaction = await authorization.prepareInstall(withoutHooks, { root })
    await transaction.publish()
    await transaction.commit()
    await expect(authorization.resolve(withoutHooks)).resolves.toBeNull()
  })
})
