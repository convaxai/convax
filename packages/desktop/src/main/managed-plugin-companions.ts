import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { type InstalledWebPluginSummary, requireWebPluginId, validatePortablePluginSegment } from "../plugin-contracts"
import type { GenerationPluginExecutableBinding } from "./generation-plugin-runtime"

const nativeReceiptSchema = "convax.plugin-companion/1" as const
const interpretedReceiptSchema = "convax.plugin-companion/2" as const
const receiptFileName = ".convax-companion.json"
const bunCompanionHeader = "#!/usr/bin/env convax-bun\n"
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const bareCommandPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const digestPattern = /^[a-f0-9]{64}$/

interface ManagedCompanionReceipt {
  arch: NodeJS.Architecture
  command: string
  pluginId: string
  pluginVersion: string
  schema: typeof interpretedReceiptSchema | typeof nativeReceiptSchema
  runtime?: "bun"
  sha256: string
  size: number
  platform: NodeJS.Platform
  version: string
}

export interface ManagedPluginCompanionInstall {
  arch: NodeJS.Architecture
  bytes: Uint8Array
  command: string
  platform: NodeJS.Platform
  pluginId: string
  pluginVersion: string
  sha256: string
  size: number
  version: string
}

export interface ManagedPluginCompanionStoreOptions {
  arch?: NodeJS.Architecture
  platform?: NodeJS.Platform
}

export interface ManagedPluginCompanionInstallTransaction {
  binding: GenerationPluginExecutableBinding
  commit(): Promise<void>
  rollback(): Promise<void>
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

async function pathExists(filePath: string) {
  try {
    await fs.lstat(filePath)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false
    throw error
  }
}

function requireVersion(value: string, label: string) {
  if (!semverPattern.test(value)) throw new Error(`${label} must be valid SemVer`)
  validatePortablePluginSegment(value)
  return value
}

function requireCommand(value: string) {
  if (!bareCommandPattern.test(value)) throw new Error("Managed companion command must be a bare executable name")
  validatePortablePluginSegment(value)
  return value
}

function requireDigest(value: string) {
  if (!digestPattern.test(value)) throw new Error("Managed companion SHA-256 must be 64 lowercase hex characters")
  return value
}

function requirePositiveSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 128 * 1024 * 1024) {
    throw new Error("Managed companion size must be an integer between 1 and 134217728")
  }
  return value
}

function executableFileName(command: string, platform: NodeJS.Platform) {
  return platform === "win32" && !command.toLocaleLowerCase("en-US").endsWith(".exe") ? `${command}.exe` : command
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.once("error", reject)
    stream.once("end", resolve)
  })
  return hash.digest("hex")
}

function sameFileIdentity(left: Awaited<ReturnType<typeof fs.stat>>, right: Awaited<ReturnType<typeof fs.stat>>) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function assertInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) {
    return
  }
  throw new Error("Managed companion path escapes its host-owned root")
}

async function assertPlainDirectory(directory: string, label: string) {
  const stat = await fs.lstat(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory and cannot be a symbolic link`)
  }
  const resolved = await fs.realpath(directory)
  const expected = path.join(await fs.realpath(path.dirname(directory)), path.basename(directory))
  if (resolved !== expected) throw new Error(`${label} must not resolve through a symbolic link`)
  return resolved
}

async function ensureDirectory(directory: string, label: string) {
  try {
    await fs.mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (!(isNodeError(error) && error.code === "EEXIST")) throw error
  }
  const result = await assertPlainDirectory(directory, label)
  await fs.chmod(result, 0o700)
  return result
}

function parseReceipt(value: unknown): ManagedCompanionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Managed companion receipt must be an object")
  }
  const input = value as Record<string, unknown>
  const schema = input.schema
  const expected = [
    "arch",
    "command",
    "platform",
    "pluginId",
    "pluginVersion",
    ...(schema === interpretedReceiptSchema ? ["runtime"] : []),
    "schema",
    "sha256",
    "size",
    "version",
  ]
  const unknown = Object.keys(input).find((key) => !expected.includes(key))
  const missing = expected.find((key) => !Object.hasOwn(input, key))
  if (unknown || missing) throw new Error("Managed companion receipt has an invalid shape")
  if (schema !== nativeReceiptSchema && schema !== interpretedReceiptSchema) {
    throw new Error("Managed companion receipt schema is not supported")
  }
  if (schema === interpretedReceiptSchema && input.runtime !== "bun") {
    throw new Error("Managed companion receipt runtime is invalid")
  }
  if (typeof input.pluginId !== "string" || typeof input.command !== "string") {
    throw new Error("Managed companion receipt identity is invalid")
  }
  if (typeof input.pluginVersion !== "string" || typeof input.version !== "string") {
    throw new Error("Managed companion receipt version is invalid")
  }
  if (typeof input.sha256 !== "string" || typeof input.size !== "number") {
    throw new Error("Managed companion receipt artifact is invalid")
  }
  if (typeof input.platform !== "string" || typeof input.arch !== "string") {
    throw new Error("Managed companion receipt target is invalid")
  }
  return {
    arch: input.arch as NodeJS.Architecture,
    command: requireCommand(input.command),
    platform: input.platform as NodeJS.Platform,
    pluginId: requireWebPluginId(input.pluginId),
    pluginVersion: requireVersion(input.pluginVersion, "Managed companion Plugin version"),
    ...(schema === interpretedReceiptSchema ? { runtime: "bun" as const } : {}),
    schema,
    sha256: requireDigest(input.sha256),
    size: requirePositiveSize(input.size),
    version: requireVersion(input.version, "Managed companion version"),
  }
}

/**
 * Owns downloaded Tool Plugin executables below Electron userData. Static Plugin
 * packages remain code-free; each executable is immutable, versioned, private,
 * and independently fingerprinted again at launch.
 */
export class ManagedPluginCompanionStore {
  readonly #arch: NodeJS.Architecture
  readonly #platform: NodeJS.Platform
  readonly #rootPath: string

  constructor(rootPath: string, options: ManagedPluginCompanionStoreOptions = {}) {
    if (!path.isAbsolute(rootPath)) throw new Error("Managed companion root must be absolute")
    this.#rootPath = path.resolve(rootPath)
    this.#arch = options.arch ?? process.arch
    this.#platform = options.platform ?? process.platform
  }

  async #root(create: boolean) {
    if (!(await pathExists(this.#rootPath))) {
      if (!create) return null
      await fs.mkdir(this.#rootPath, { mode: 0o700, recursive: true })
    }
    return assertPlainDirectory(this.#rootPath, "Managed companion root")
  }

  async #directoryChain(root: string, segments: readonly string[]) {
    let current = root
    for (const segment of segments) {
      validatePortablePluginSegment(segment)
      current = path.join(current, segment)
      assertInside(current, root)
      await ensureDirectory(current, "Managed companion directory")
    }
    return current
  }

  async install(input: ManagedPluginCompanionInstall): Promise<ManagedPluginCompanionInstallTransaction> {
    const pluginId = requireWebPluginId(input.pluginId)
    const pluginVersion = requireVersion(input.pluginVersion, "Managed companion Plugin version")
    const command = requireCommand(input.command)
    const version = requireVersion(input.version, "Managed companion version")
    const size = requirePositiveSize(input.size)
    const digest = requireDigest(input.sha256)
    if (input.platform !== this.#platform || input.arch !== this.#arch) {
      throw new Error(`Managed companion target does not match this host: ${input.platform}/${input.arch}`)
    }
    if (
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength !== size ||
      sha256Bytes(input.bytes) !== digest
    ) {
      throw new Error("Managed companion bytes do not match their declared size and SHA-256")
    }
    const root = (await this.#root(true))!
    const commandRoot = await this.#directoryChain(root, [pluginId, pluginVersion, command])
    const target = path.join(commandRoot, version)
    const runtime =
      new TextDecoder().decode(input.bytes.subarray(0, bunCompanionHeader.length)) === bunCompanionHeader
        ? ("bun" as const)
        : undefined
    const receipt: ManagedCompanionReceipt = {
      arch: this.#arch,
      command,
      platform: this.#platform,
      pluginId,
      pluginVersion,
      ...(runtime === undefined ? {} : { runtime }),
      schema: runtime === undefined ? nativeReceiptSchema : interpretedReceiptSchema,
      sha256: digest,
      size,
      version,
    }
    const removeOtherVersions = async () => {
      for (const entry of await fs.readdir(commandRoot, { withFileTypes: true })) {
        if (entry.name !== version) await this.#removeEntry(root, path.join(commandRoot, entry.name))
      }
    }
    if (await pathExists(target)) {
      const binding = await this.#resolveDirectory(target, receipt)
      let active = true
      return {
        binding,
        commit: async () => {
          if (!active) return
          active = false
          await removeOtherVersions().catch(() => undefined)
        },
        rollback: async () => {
          active = false
        },
      }
    }
    const staging = path.join(root, `.staging-${randomUUID()}`)
    let published = false
    let transactionState: "active" | "committed" | "rolled-back" = "active"
    const removePublished = async () => {
      if (published && (await pathExists(target))) {
        await this.#removeEntry(root, target)
      }
    }
    try {
      await fs.mkdir(staging, { mode: 0o700 })
      const executable = path.join(staging, executableFileName(command, this.#platform))
      const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0)
      const handle = await fs.open(executable, flags, 0o500)
      try {
        await handle.writeFile(input.bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.chmod(executable, this.#platform === "win32" ? 0o600 : 0o500)
      await fs.writeFile(path.join(staging, receiptFileName), `${JSON.stringify(receipt, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      })
      await this.#resolveDirectory(staging, receipt)

      await fs.rename(staging, target)
      published = true
      let binding: GenerationPluginExecutableBinding
      try {
        binding = await this.#resolveDirectory(target, receipt)
      } catch (error) {
        try {
          await removePublished()
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Managed companion publication rollback failed", {
            cause: error,
          })
        }
        throw error
      }
      return {
        binding,
        commit: async () => {
          if (transactionState !== "active") return
          transactionState = "committed"
          await removeOtherVersions().catch(() => undefined)
        },
        rollback: async () => {
          if (transactionState !== "active") return
          await removePublished()
          transactionState = "rolled-back"
        },
      }
    } finally {
      await fs.rm(staging, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  async #resolveDirectory(directory: string, expected: ManagedCompanionReceipt) {
    const realDirectory = await assertPlainDirectory(directory, "Managed companion installation")
    const entries = await fs.readdir(realDirectory, { withFileTypes: true })
    if (
      entries.length !== 2 ||
      !entries.some((entry) => entry.name === receiptFileName && entry.isFile() && !entry.isSymbolicLink()) ||
      !entries.some(
        (entry) =>
          entry.name === executableFileName(expected.command, this.#platform) &&
          entry.isFile() &&
          !entry.isSymbolicLink(),
      )
    ) {
      throw new Error("Managed companion installation contains unexpected files")
    }
    const receiptPath = path.join(realDirectory, receiptFileName)
    const receiptStat = await fs.lstat(receiptPath)
    if (receiptStat.isSymbolicLink() || !receiptStat.isFile() || receiptStat.size > 8 * 1024) {
      throw new Error("Managed companion receipt must be a bounded regular file")
    }
    const receipt = parseReceipt(JSON.parse(await fs.readFile(receiptPath, "utf8")))
    if (JSON.stringify(receipt) !== JSON.stringify(expected)) {
      throw new Error("Managed companion receipt does not match its installed identity")
    }
    const executable = path.join(realDirectory, executableFileName(receipt.command, this.#platform))
    const executableRealPath = await fs.realpath(executable)
    if (executableRealPath !== executable) throw new Error("Managed companion executable cannot be a symbolic link")
    const before = await fs.stat(executableRealPath)
    if (!before.isFile() || before.size !== receipt.size) {
      throw new Error("Managed companion executable size does not match its receipt")
    }
    await fs.access(executableRealPath, this.#platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK)
    const digest = await sha256File(executableRealPath)
    const after = await fs.stat(executableRealPath)
    if (digest !== receipt.sha256 || !sameFileIdentity(before, after)) {
      throw new Error("Managed companion executable changed while it was being inspected")
    }
    return {
      path: executableRealPath,
      ...(receipt.runtime === undefined ? {} : { runtime: receipt.runtime }),
      sha256: digest,
      size: after.size,
    }
  }

  async resolve(
    pluginIdValue: string,
    pluginVersionValue: string,
    commandValue: string,
  ): Promise<GenerationPluginExecutableBinding | null> {
    const pluginId = requireWebPluginId(pluginIdValue)
    const pluginVersion = requireVersion(pluginVersionValue, "Managed companion Plugin version")
    const command = requireCommand(commandValue)
    const root = await this.#root(false)
    if (!root) return null
    const commandRoot = path.join(root, pluginId, pluginVersion, command)
    assertInside(commandRoot, root)
    if (!(await pathExists(commandRoot))) return null
    await assertPlainDirectory(path.join(root, pluginId), "Managed companion Plugin directory")
    await assertPlainDirectory(path.join(root, pluginId, pluginVersion), "Managed companion version directory")
    await assertPlainDirectory(commandRoot, "Managed companion command directory")
    const versions = (await fs.readdir(commandRoot, { withFileTypes: true })).filter(
      (entry) => !entry.name.startsWith("."),
    )
    if (versions.length === 0) return null
    if (versions.length !== 1 || !versions[0]!.isDirectory() || versions[0]!.isSymbolicLink()) {
      throw new Error("Managed companion command must resolve to exactly one real version directory")
    }
    const version = requireVersion(versions[0]!.name, "Managed companion version")
    const directory = path.join(commandRoot, version)
    const receiptPath = path.join(directory, receiptFileName)
    const receiptStat = await fs.lstat(receiptPath)
    if (receiptStat.isSymbolicLink() || !receiptStat.isFile() || receiptStat.size > 8 * 1024) {
      throw new Error("Managed companion receipt must be a bounded regular file")
    }
    const receipt = parseReceipt(JSON.parse(await fs.readFile(receiptPath, "utf8")))
    if (
      receipt.pluginId !== pluginId ||
      receipt.pluginVersion !== pluginVersion ||
      receipt.command !== command ||
      receipt.version !== version ||
      receipt.platform !== this.#platform ||
      receipt.arch !== this.#arch
    ) {
      throw new Error("Managed companion receipt does not match this Plugin and host target")
    }
    return this.#resolveDirectory(directory, receipt)
  }

  async #removeEntry(root: string, target: string) {
    assertInside(target, root)
    if (!(await pathExists(target))) return false
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      await fs.unlink(target)
      return true
    }
    const tombstone = path.join(root, `.removed-${randomUUID()}`)
    await fs.rename(target, tombstone)
    await fs.rm(tombstone, { force: true, recursive: true })
    return true
  }

  async removePlugin(pluginIdValue: string) {
    const pluginId = requireWebPluginId(pluginIdValue)
    const root = await this.#root(false)
    return root ? this.#removeEntry(root, path.join(root, pluginId)) : false
  }

  async removePluginVersion(pluginIdValue: string, pluginVersionValue: string) {
    const pluginId = requireWebPluginId(pluginIdValue)
    const pluginVersion = requireVersion(pluginVersionValue, "Managed companion Plugin version")
    const root = await this.#root(false)
    return root ? this.#removeEntry(root, path.join(root, pluginId, pluginVersion)) : false
  }

  async #reconcilePlugin(root: string, pluginId: string, current: InstalledWebPluginSummary | undefined) {
    const pluginPath = path.join(root, pluginId)
    if (!(await pathExists(pluginPath))) return
    const pluginStat = await fs.lstat(pluginPath)
    if (!current?.runtime?.command || pluginStat.isSymbolicLink() || !pluginStat.isDirectory()) {
      await this.#removeEntry(root, pluginPath)
      return
    }
    for (const versionEntry of await fs.readdir(pluginPath, { withFileTypes: true })) {
      const versionPath = path.join(pluginPath, versionEntry.name)
      if (versionEntry.name !== current.version || versionEntry.isSymbolicLink() || !versionEntry.isDirectory()) {
        await this.#removeEntry(root, versionPath)
        continue
      }
      for (const commandEntry of await fs.readdir(versionPath, { withFileTypes: true })) {
        if (
          commandEntry.name !== current.runtime.command ||
          commandEntry.isSymbolicLink() ||
          !commandEntry.isDirectory()
        ) {
          await this.#removeEntry(root, path.join(versionPath, commandEntry.name))
        }
      }
    }
  }

  /** Reconciles one Plugin while its lifecycle lock is held. */
  async reconcilePlugin(pluginIdValue: string, current?: InstalledWebPluginSummary) {
    const pluginId = requireWebPluginId(pluginIdValue)
    if (current && current.id !== pluginId) throw new Error("Managed companion Plugin identity does not match")
    const root = await this.#root(false)
    if (root) await this.#reconcilePlugin(root, pluginId, current)
  }

  async reconcile(installed: readonly InstalledWebPluginSummary[]) {
    const root = await this.#root(false)
    if (!root) return
    const expected = new Map(installed.map((plugin) => [plugin.id, plugin] as const))
    for (const pluginEntry of await fs.readdir(root, { withFileTypes: true })) {
      const pluginPath = path.join(root, pluginEntry.name)
      if (pluginEntry.name.startsWith(".")) {
        await this.#removeEntry(root, pluginPath)
        continue
      }
      const current = expected.get(pluginEntry.name)
      if (!current || pluginEntry.isSymbolicLink() || !pluginEntry.isDirectory()) {
        await this.#removeEntry(root, pluginPath)
        continue
      }
      await this.#reconcilePlugin(root, pluginEntry.name, current)
    }
  }
}
