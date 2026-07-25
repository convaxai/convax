import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  requireWebPluginId,
  webPluginManifestSchemaV2,
  webPluginManifestSchemaV3,
  webPluginManifestSchemaV4,
  webPluginManifestSchemaV5,
  webPluginManifestSchemaV6,
  webPluginManifestSchemaV7,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"

const authorizationSchema = "convax.tool-plugin-authorization/1" as const
const maximumReceiptBytes = 16 * 1024
const sha256Pattern = /^[a-f0-9]{64}$/

export interface ToolPluginExecutableBinding {
  path: string
  /** Host-owned interpreter selected from trusted companion bytes. */
  runtime?: "bun"
  sha256: string
  size: number
}

export type ToolPluginExecutableBindingKind = "managed" | "path"

export interface ResolvedToolPluginExecutable {
  binding: ToolPluginExecutableBinding
  kind: ToolPluginExecutableBindingKind
}

export type ToolPluginExecutableResolver = (
  command: string,
  environment: Readonly<Record<string, string>>,
) => Promise<ToolPluginExecutableBinding>

export type ToolPluginManagedExecutableResolver = (
  pluginId: string,
  pluginVersion: string,
  command: string,
) => Promise<ToolPluginExecutableBinding | null>

export interface ToolPluginAuthorizationTransaction {
  /** Publishes the exact receipt immediately before the Plugin package is published. */
  publish(): Promise<void>
  /** Cleans superseded receipts after the Plugin package publication succeeds. */
  commit(): Promise<void>
  /** Removes only the receipt created by this transaction. */
  rollback(): Promise<void>
}

export interface ToolPluginAuthorizationStoreOptions {
  environment: Readonly<Record<string, string>>
  resolveExecutable: ToolPluginExecutableResolver
  resolveManagedExecutable?: ToolPluginManagedExecutableResolver
}

interface ToolPluginAuthorizationReceipt {
  bindingKind: ToolPluginExecutableBindingKind
  command: string
  executable: ToolPluginExecutableBinding
  key: string
  manifestSha256: string
  pluginId: string
  pluginVersion: string
  schema: typeof authorizationSchema
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

/**
 * Canonical installed declaration identity shared by installation and execution.
 * Host-authored provenance is intentionally excluded: consent binds the portable
 * Plugin declaration and exact executable bytes, not a renderer-visible hint.
 */
export function toolPluginManifestSha256(plugin: InstalledWebPluginSummary) {
  return sha256(
    JSON.stringify({
      capabilities: plugin.capabilities,
      contributes: plugin.contributes,
      description: plugin.description,
      entry: plugin.entry,
      hooks: plugin.hooks,
      id: plugin.id,
      name: plugin.name,
      runtime: plugin.runtime,
      schema: plugin.schema,
      skill: plugin.skill,
      version: plugin.version,
    }),
  )
}

export function isExecutableToolPlugin(plugin: InstalledWebPluginSummary) {
  return (
    (plugin.schema === webPluginManifestSchemaV2 ||
      plugin.schema === webPluginManifestSchemaV3 ||
      plugin.schema === webPluginManifestSchemaV4 ||
      plugin.schema === webPluginManifestSchemaV5 ||
      plugin.schema === webPluginManifestSchemaV6 ||
      plugin.schema === webPluginManifestSchemaV7) &&
    plugin.runtime?.type === "mcp-stdio" &&
    (Boolean(plugin.contributes.generation?.tools.length) || plugin.contributes.service !== undefined)
  )
}

function requireBinding(binding: ToolPluginExecutableBinding) {
  if (
    !binding ||
    !path.isAbsolute(binding.path) ||
    binding.path.includes("\0") ||
    !sha256Pattern.test(binding.sha256) ||
    !Number.isSafeInteger(binding.size) ||
    binding.size < 1 ||
    binding.size > 512 * 1024 * 1024 ||
    (binding.runtime !== undefined && binding.runtime !== "bun")
  ) {
    throw new Error("Tool Plugin executable binding is invalid")
  }
  return {
    path: binding.path,
    ...(binding.runtime === undefined ? {} : { runtime: binding.runtime }),
    sha256: binding.sha256,
    size: binding.size,
  }
}

function authorizationKey(
  manifestSha256: string,
  bindingKind: ToolPluginExecutableBindingKind,
  binding: ToolPluginExecutableBinding,
) {
  const identity = [manifestSha256, bindingKind, binding.path, binding.size, binding.sha256]
  // Preserve every existing native receipt key while binding interpreted
  // companions to their host-selected runtime mode.
  if (binding.runtime !== undefined) identity.push(binding.runtime)
  return sha256(JSON.stringify(identity))
}

/**
 * Immutable identity shared by the install receipt, runtime service call, and
 * crash-recovery checkpoint. Computing it verifies no receipt and starts no
 * sidecar; callers must separately verify the current install authorization.
 */
export function toolPluginAuthorizationIdentity(
  plugin: InstalledWebPluginSummary,
  bindingKind: ToolPluginExecutableBindingKind,
  bindingInput: ToolPluginExecutableBinding,
) {
  return authorizationKey(toolPluginManifestSha256(plugin), bindingKind, requireBinding(bindingInput))
}

function receiptFor(
  plugin: InstalledWebPluginSummary,
  bindingKind: ToolPluginExecutableBindingKind,
  bindingInput: ToolPluginExecutableBinding,
) {
  const binding = requireBinding(bindingInput)
  const manifestSha256 = toolPluginManifestSha256(plugin)
  const key = toolPluginAuthorizationIdentity(plugin, bindingKind, binding)
  return {
    bindingKind,
    command: plugin.runtime!.command,
    executable: binding,
    key,
    manifestSha256,
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    schema: authorizationSchema,
  } satisfies ToolPluginAuthorizationReceipt
}

function requireExactKeys(input: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(input).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function parseReceipt(value: unknown): ToolPluginAuthorizationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool Plugin authorization receipt is invalid")
  }
  const input = value as Record<string, unknown>
  const expectedKeys = [
    "bindingKind",
    "command",
    "executable",
    "key",
    "manifestSha256",
    "pluginId",
    "pluginVersion",
    "schema",
  ]
  const executable = input.executable
  if (
    !requireExactKeys(input, expectedKeys) ||
    input.schema !== authorizationSchema ||
    (input.bindingKind !== "managed" && input.bindingKind !== "path") ||
    typeof input.command !== "string" ||
    typeof input.pluginId !== "string" ||
    typeof input.pluginVersion !== "string" ||
    typeof input.manifestSha256 !== "string" ||
    !sha256Pattern.test(input.manifestSha256) ||
    typeof input.key !== "string" ||
    !sha256Pattern.test(input.key) ||
    !executable ||
    typeof executable !== "object" ||
    Array.isArray(executable) ||
    !(
      requireExactKeys(executable as Record<string, unknown>, ["path", "sha256", "size"]) ||
      requireExactKeys(executable as Record<string, unknown>, ["path", "runtime", "sha256", "size"])
    )
  ) {
    throw new Error("Tool Plugin authorization receipt is invalid")
  }
  const binding = requireBinding(executable as unknown as ToolPluginExecutableBinding)
  const receipt: ToolPluginAuthorizationReceipt = {
    bindingKind: input.bindingKind,
    command: input.command,
    executable: binding,
    key: input.key,
    manifestSha256: input.manifestSha256,
    pluginId: requireWebPluginId(input.pluginId),
    pluginVersion: input.pluginVersion,
    schema: authorizationSchema,
  }
  if (authorizationKey(receipt.manifestSha256, receipt.bindingKind, binding) !== receipt.key) {
    throw new Error("Tool Plugin authorization receipt is invalid")
  }
  return receipt
}

function sameReceipt(left: ToolPluginAuthorizationReceipt, right: ToolPluginAuthorizationReceipt) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

async function assertPrivateDirectory(directory: string, label: string) {
  const metadata = await fs.lstat(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a host-owned directory`)
  }
  const [real, parent] = await Promise.all([fs.realpath(directory), fs.realpath(path.dirname(directory))])
  if (real !== path.join(parent, path.basename(directory))) {
    throw new Error(`${label} must be a host-owned directory`)
  }
  return real
}

async function readReceipt(file: string) {
  const before = await fs.lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumReceiptBytes) {
    throw new Error("Tool Plugin authorization receipt is invalid")
  }
  const [real, parent] = await Promise.all([fs.realpath(file), fs.realpath(path.dirname(file))])
  if (real !== path.join(parent, path.basename(file))) {
    throw new Error("Tool Plugin authorization receipt is invalid")
  }
  const value = await fs.readFile(file, "utf8")
  const after = await fs.lstat(file)
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error("Tool Plugin authorization receipt changed while it was read")
  }
  try {
    return parseReceipt(JSON.parse(value))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Tool Plugin authorization receipt is invalid JSON", { cause: error })
    }
    throw error
  }
}

function reinstallError(pluginId: string) {
  return new Error(`Tool Plugin authorization is missing or changed; reinstall Plugin: ${pluginId}`)
}

/**
 * Persists installation-time consent for executable Tool Plugins. Receipts are
 * immutable and keyed by both declaration and executable bytes, so the old and
 * new identities can safely coexist around the Plugin package switch.
 */
export class ToolPluginAuthorizationStore {
  readonly #environment: Readonly<Record<string, string>>
  readonly #resolveExecutable: ToolPluginExecutableResolver
  readonly #resolveManagedExecutable?: ToolPluginManagedExecutableResolver
  readonly #rootPath: string

  constructor(rootPath: string, options: ToolPluginAuthorizationStoreOptions) {
    if (!path.isAbsolute(rootPath)) throw new Error("Tool Plugin authorization root must be absolute")
    this.#rootPath = path.resolve(rootPath)
    this.#environment = options.environment
    this.#resolveExecutable = options.resolveExecutable
    this.#resolveManagedExecutable = options.resolveManagedExecutable
  }

  async #ensureRoot() {
    await fs.mkdir(this.#rootPath, { mode: 0o700, recursive: true })
    const root = await assertPrivateDirectory(this.#rootPath, "Tool Plugin authorization root")
    await fs.chmod(root, 0o700)
    return root
  }

  async #ensurePluginDirectory(pluginId: string) {
    const root = await this.#ensureRoot()
    const directory = path.join(root, requireWebPluginId(pluginId))
    await fs.mkdir(directory, { mode: 0o700, recursive: true })
    await assertPrivateDirectory(directory, "Tool Plugin authorization directory")
    await fs.chmod(directory, 0o700)
    return directory
  }

  async #binding(plugin: InstalledWebPluginSummary): Promise<ResolvedToolPluginExecutable> {
    try {
      const managed = await this.#resolveManagedExecutable?.(plugin.id, plugin.version, plugin.runtime!.command)
      return managed
        ? { binding: requireBinding(managed), kind: "managed" }
        : {
            binding: requireBinding(await this.#resolveExecutable(plugin.runtime!.command, this.#environment)),
            kind: "path",
          }
    } catch (error) {
      throw new Error(
        `Tool Plugin executable could not be verified during installation; reinstall Plugin: ${plugin.id}`,
        {
          cause: error,
        },
      )
    }
  }

  async #requiredBinding(plugin: InstalledWebPluginSummary, required: ResolvedToolPluginExecutable | undefined) {
    if (!required) return this.#binding(plugin)
    try {
      const live =
        required.kind === "managed"
          ? await this.#resolveManagedExecutable?.(plugin.id, plugin.version, plugin.runtime!.command)
          : await this.#resolveExecutable(plugin.runtime!.command, this.#environment)
      if (!live || JSON.stringify(requireBinding(live)) !== JSON.stringify(requireBinding(required.binding))) {
        throw new Error("required executable binding is unavailable")
      }
      return { binding: requireBinding(live), kind: required.kind }
    } catch (error) {
      throw new Error(
        `Tool Plugin executable could not be verified during installation; reinstall Plugin: ${plugin.id}`,
        {
          cause: error,
        },
      )
    }
  }

  async prepareInstall(
    plugin: InstalledWebPluginSummary,
    required?: ResolvedToolPluginExecutable,
  ): Promise<ToolPluginAuthorizationTransaction> {
    if (!isExecutableToolPlugin(plugin)) {
      return { commit: async () => undefined, publish: async () => undefined, rollback: async () => undefined }
    }
    const resolved = await this.#requiredBinding(plugin, required)
    const receipt = receiptFor(plugin, resolved.kind, resolved.binding)
    const directory = await this.#ensurePluginDirectory(plugin.id)
    const target = path.join(directory, `${receipt.key}.json`)
    const staging = path.join(directory, `.staging-${receipt.key}-${randomUUID()}`)
    const serialized = `${JSON.stringify(receipt, null, 2)}\n`
    await fs.writeFile(staging, serialized, { flag: "wx", mode: 0o600 })
    let created = false
    let published = false
    return {
      async publish() {
        if (published) return
        try {
          await fs.link(staging, target)
          created = true
        } catch (error) {
          if (!isNodeError(error, "EEXIST")) throw error
          const existing = await readReceipt(target)
          if (!sameReceipt(existing, receipt)) {
            throw new Error("Tool Plugin authorization identity collided", { cause: error })
          }
        } finally {
          await fs.rm(staging, { force: true })
        }
        published = true
      },
      async commit() {
        // Publication consent is already durable. Everything below is
        // superseded-receipt cleanup and must never turn a committed Plugin
        // package switch into a rollback attempt.
        await fs.rm(staging, { force: true }).catch(() => undefined)
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
        await Promise.all(
          entries.map(async (entry) => {
            if (entry.name === `${receipt.key}.json`) return
            if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.startsWith(".staging-"))) {
              await fs.rm(path.join(directory, entry.name), { force: true }).catch(() => undefined)
            }
          }),
        )
      },
      async rollback() {
        await fs.rm(staging, { force: true })
        if (created) await fs.rm(target, { force: true })
      },
    }
  }

  async verify(
    plugin: InstalledWebPluginSummary,
    bindingKind: ToolPluginExecutableBindingKind,
    bindingInput: ToolPluginExecutableBinding,
  ) {
    if (!isExecutableToolPlugin(plugin)) throw reinstallError(plugin.id)
    const expected = receiptFor(plugin, bindingKind, bindingInput)
    try {
      const root = await assertPrivateDirectory(this.#rootPath, "Tool Plugin authorization root")
      const directory = path.join(root, requireWebPluginId(plugin.id))
      await assertPrivateDirectory(directory, "Tool Plugin authorization directory")
      const actual = await readReceipt(path.join(directory, `${expected.key}.json`))
      if (!sameReceipt(actual, expected)) throw reinstallError(plugin.id)
    } catch (error) {
      if (error instanceof Error && error.message === reinstallError(plugin.id).message) throw error
      throw reinstallError(plugin.id)
    }
  }

  /**
   * Resolves and verifies the exact currently installed service identity
   * without launching its executable. Missing or changed consent fails closed.
   */
  async authorizedServiceIdentity(plugin: InstalledWebPluginSummary) {
    if (!isExecutableToolPlugin(plugin) || plugin.contributes.service === undefined) return null
    const resolved = await this.#binding(plugin)
    await this.verify(plugin, resolved.kind, resolved.binding)
    return toolPluginAuthorizationIdentity(plugin, resolved.kind, resolved.binding)
  }

  async revoke(pluginId: string) {
    const root = await this.#ensureRoot()
    await fs.rm(path.join(root, requireWebPluginId(pluginId)), { force: true, recursive: true })
  }

  async #reconcilePlugin(root: string, pluginId: string, plugin: InstalledWebPluginSummary | undefined) {
    const directory = path.join(root, pluginId)
    let directoryStat
    try {
      directoryStat = await fs.lstat(directory)
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return
      throw error
    }
    if (!plugin || !isExecutableToolPlugin(plugin) || directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      await fs.rm(directory, { force: true, recursive: true })
      return
    }
    let key: string | undefined
    try {
      const resolved = await this.#binding(plugin)
      key = receiptFor(plugin, resolved.kind, resolved.binding).key
    } catch {
      // A transient resolver/filesystem failure leaves old receipts inert:
      // runtime verification is still impossible, but consent is not
      // permanently destroyed merely because storage was briefly busy.
    }
    for (const receipt of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (key === undefined && receipt.isFile() && receipt.name.endsWith(".json")) continue
      if (!receipt.isFile() || receipt.name !== `${key}.json`) {
        await fs.rm(path.join(directory, receipt.name), { force: true, recursive: true }).catch(() => undefined)
      }
    }
  }

  /** Reconciles one Plugin while its lifecycle lock is held. */
  async reconcilePlugin(pluginIdValue: string, plugin?: InstalledWebPluginSummary) {
    const pluginId = requireWebPluginId(pluginIdValue)
    if (plugin && plugin.id !== pluginId) throw new Error("Tool Plugin authorization identity does not match")
    await this.#reconcilePlugin(await this.#ensureRoot(), pluginId, plugin)
  }

  /** Removes orphaned and superseded receipts without ever creating consent. */
  async reconcile(installed: readonly InstalledWebPluginSummary[]) {
    const root = await this.#ensureRoot()
    const plugins = new Map(installed.map((plugin) => [plugin.id, plugin] as const))
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue
      const plugin = plugins.get(entry.name)
      await this.#reconcilePlugin(root, entry.name, plugin)
    }
  }
}
