import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  parse as parseJavaScriptModule,
  type ExportAllDeclaration,
  type ExportNamedDeclaration,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type Program,
} from "acorn"

import { requireWebPluginId, type InstalledWebPluginSummary } from "../plugin-contracts"
import type { WebPluginPublicationCandidate, WebPluginPublicationTransaction } from "./plugin-manager"

const authorizationSchema = "convax.plugin-hook-authorization/1" as const
const maximumHookBytes = 16 * 1024 * 1024
const maximumReceiptBytes = 16 * 1024
const sha256Pattern = /^[a-f0-9]{64}$/

interface PluginHookBinding {
  sha256: string
  size: number
}

interface PluginHookAuthorizationReceipt {
  binding: PluginHookBinding
  hookPath: string
  key: string
  manifestSha256: string
  pluginId: string
  pluginVersion: string
  schema: typeof authorizationSchema
  snapshotFile: string
}

export interface PluginHookAuthorizationStoreOptions {
  resolveInstalledHook(plugin: InstalledWebPluginSummary): Promise<string>
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function pluginManifestSha256(plugin: InstalledWebPluginSummary) {
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

function requireBinding(binding: PluginHookBinding) {
  if (
    !binding ||
    !sha256Pattern.test(binding.sha256) ||
    !Number.isSafeInteger(binding.size) ||
    binding.size < 1 ||
    binding.size > maximumHookBytes
  ) {
    throw new Error("Plugin Hook module binding is invalid")
  }
  return { sha256: binding.sha256, size: binding.size }
}

function authorizationKey(manifestSha256: string, hookPath: string, binding: PluginHookBinding) {
  return sha256(JSON.stringify([manifestSha256, hookPath, binding.size, binding.sha256]))
}

function receiptFor(plugin: InstalledWebPluginSummary, bindingInput: PluginHookBinding) {
  if (!plugin.hooks) throw new Error("Plugin does not declare hooks")
  const binding = requireBinding(bindingInput)
  const manifestSha256 = pluginManifestSha256(plugin)
  const key = authorizationKey(manifestSha256, plugin.hooks, binding)
  const extension = path.extname(plugin.hooks).toLocaleLowerCase("en-US")
  return {
    binding,
    hookPath: plugin.hooks,
    key,
    manifestSha256,
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    schema: authorizationSchema,
    snapshotFile: `${key}${extension}`,
  } satisfies PluginHookAuthorizationReceipt
}

function exactKeys(input: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(input).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function parseReceipt(value: unknown): PluginHookAuthorizationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plugin Hook authorization receipt is invalid")
  }
  const input = value as Record<string, unknown>
  const binding = input.binding
  if (
    !exactKeys(input, [
      "binding",
      "hookPath",
      "key",
      "manifestSha256",
      "pluginId",
      "pluginVersion",
      "schema",
      "snapshotFile",
    ]) ||
    input.schema !== authorizationSchema ||
    typeof input.hookPath !== "string" ||
    typeof input.key !== "string" ||
    !sha256Pattern.test(input.key) ||
    typeof input.manifestSha256 !== "string" ||
    !sha256Pattern.test(input.manifestSha256) ||
    typeof input.pluginId !== "string" ||
    typeof input.pluginVersion !== "string" ||
    typeof input.snapshotFile !== "string" ||
    !/^[a-f0-9]{64}\.(?:js|mjs)$/.test(input.snapshotFile) ||
    !binding ||
    typeof binding !== "object" ||
    Array.isArray(binding) ||
    !exactKeys(binding as Record<string, unknown>, ["sha256", "size"])
  ) {
    throw new Error("Plugin Hook authorization receipt is invalid")
  }
  const parsedBinding = requireBinding(binding as unknown as PluginHookBinding)
  const receipt: PluginHookAuthorizationReceipt = {
    binding: parsedBinding,
    hookPath: input.hookPath,
    key: input.key,
    manifestSha256: input.manifestSha256,
    pluginId: requireWebPluginId(input.pluginId),
    pluginVersion: input.pluginVersion,
    schema: authorizationSchema,
    snapshotFile: input.snapshotFile,
  }
  if (
    authorizationKey(receipt.manifestSha256, receipt.hookPath, receipt.binding) !== receipt.key ||
    !receipt.snapshotFile.startsWith(`${receipt.key}.`)
  ) {
    throw new Error("Plugin Hook authorization receipt is invalid")
  }
  return receipt
}

function sameReceipt(left: PluginHookAuthorizationReceipt, right: PluginHookAuthorizationReceipt) {
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

async function readBoundedFile(file: string, label: string) {
  const before = await fs.lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumHookBytes) {
    throw new Error(`${label} must be a bounded regular file`)
  }
  const [real, parent] = await Promise.all([fs.realpath(file), fs.realpath(path.dirname(file))])
  if (real !== path.join(parent, path.basename(file))) {
    throw new Error(`${label} must not resolve through a symbolic link`)
  }
  const handle = await fs.open(real, "r")
  try {
    const opened = await handle.stat()
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error(`${label} changed while it was opened`)
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`${label} changed while it was read`)
    }
    return {
      binding: { sha256: sha256(bytes), size: bytes.byteLength },
      bytes,
    }
  } finally {
    await handle.close()
  }
}

function hasOpenCodePluginExport(program: Program) {
  return program.body.some(
    (statement) =>
      statement.type === "ExportDefaultDeclaration" ||
      (statement.type === "ExportNamedDeclaration" &&
        (statement.declaration != null || statement.specifiers.length > 0)),
  )
}

function inspectHookModuleDependencies(program: Program) {
  const staticImports: string[] = []
  let dynamicImport = false
  let commonJsReference = false
  const pending: Node[] = [program]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === "Identifier" && ["exports", "module", "require"].includes((node as Identifier).name)) {
      commonJsReference = true
    } else if (node.type === "ImportExpression") {
      dynamicImport = true
    } else if (node.type === "ImportDeclaration") {
      staticImports.push(String((node as ImportDeclaration).source.value))
    } else if (node.type === "ExportNamedDeclaration") {
      const source = (node as ExportNamedDeclaration).source
      if (source) staticImports.push(String(source.value))
    } else if (node.type === "ExportAllDeclaration") {
      staticImports.push(String((node as ExportAllDeclaration).source.value))
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object" && typeof child.type === "string") {
            pending.push(child as Node)
          }
        }
      } else if (value && typeof value === "object" && "type" in value && typeof value.type === "string") {
        pending.push(value as Node)
      }
    }
  }
  return { commonJsReference, dynamicImport, staticImports }
}

function assertSelfContainedHookModule(bytes: Uint8Array, label: string) {
  let source: string
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error(`${label} must be valid UTF-8 JavaScript`, { cause: error })
  }
  let program: Program
  try {
    program = parseJavaScriptModule(source, {
      allowHashBang: false,
      ecmaVersion: "latest",
      sourceType: "module",
    })
  } catch (error) {
    throw new Error(`${label} must be a valid JavaScript ESM module`, { cause: error })
  }
  if (!hasOpenCodePluginExport(program)) {
    throw new Error(`${label} must export at least one OpenCode Plugin entry`)
  }
  const dependencies = inspectHookModuleDependencies(program)
  if (dependencies.commonJsReference) {
    throw new Error(`${label} must bundle CommonJS dependencies into the declared Hook file`)
  }
  if (dependencies.dynamicImport) {
    throw new Error(`${label} must not use dynamic runtime imports; bundle the Hook into one file`)
  }
  for (const specifier of dependencies.staticImports) {
    if (specifier === "node:module" || specifier === "bun:module") {
      throw new Error(`${label} must bundle CommonJS dependencies instead of creating a runtime module loader`)
    }
    if (!specifier.startsWith("node:") && !specifier.startsWith("bun:")) {
      throw new Error(`${label} must bundle every non-runtime dependency into the declared Hook file`)
    }
  }
}

async function resolveCandidateHook(candidateRoot: string, hookPath: string) {
  const root = await assertPrivateDirectory(path.resolve(candidateRoot), "Plugin publication candidate")
  let current = root
  for (const segment of hookPath.split("/")) {
    current = path.join(current, segment)
    const metadata = await fs.lstat(current)
    if (metadata.isSymbolicLink()) {
      throw new Error(`Plugin Hook module cannot contain a symbolic link: ${hookPath}`)
    }
  }
  const relative = path.relative(root, current)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Plugin Hook module must stay inside its package")
  }
  return current
}

async function readReceipt(file: string) {
  const before = await fs.lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumReceiptBytes) {
    throw new Error("Plugin Hook authorization receipt is invalid")
  }
  const [real, parent] = await Promise.all([fs.realpath(file), fs.realpath(path.dirname(file))])
  if (real !== path.join(parent, path.basename(file))) {
    throw new Error("Plugin Hook authorization receipt is invalid")
  }
  const value = await fs.readFile(real, "utf8")
  const after = await fs.lstat(real)
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error("Plugin Hook authorization receipt changed while it was read")
  }
  try {
    return parseReceipt(JSON.parse(value))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Plugin Hook authorization receipt is invalid JSON", { cause: error })
    }
    throw error
  }
}

function reinstallError(pluginId: string) {
  return new Error(`Plugin Hook authorization is missing or changed; reinstall Plugin: ${pluginId}`)
}

function noOpTransaction(): WebPluginPublicationTransaction {
  return {
    async commit() {},
    async publish() {},
    async rollback() {},
  }
}

/**
 * Installation-time execution consent for one self-contained OpenCode Plugin
 * module. OpenCode loads only the private byte-for-byte snapshot, never the
 * mutable installed Plugin package.
 */
export class PluginHookAuthorizationStore {
  readonly #resolveInstalledHook: PluginHookAuthorizationStoreOptions["resolveInstalledHook"]
  readonly #rootPath: string

  constructor(rootPath: string, options: PluginHookAuthorizationStoreOptions) {
    if (!path.isAbsolute(rootPath)) throw new Error("Plugin Hook authorization root must be absolute")
    this.#rootPath = path.resolve(rootPath)
    this.#resolveInstalledHook = options.resolveInstalledHook
  }

  async #ensureRoot() {
    await fs.mkdir(this.#rootPath, { mode: 0o700, recursive: true })
    const root = await assertPrivateDirectory(this.#rootPath, "Plugin Hook authorization root")
    await fs.chmod(root, 0o700)
    return root
  }

  async #ensurePluginDirectory(pluginId: string) {
    const root = await this.#ensureRoot()
    const directory = path.join(root, requireWebPluginId(pluginId))
    await fs.mkdir(directory, { mode: 0o700, recursive: true })
    await assertPrivateDirectory(directory, "Plugin Hook authorization directory")
    await fs.chmod(directory, 0o700)
    return directory
  }

  async prepareInstall(
    plugin: InstalledWebPluginSummary,
    candidate: WebPluginPublicationCandidate,
  ): Promise<WebPluginPublicationTransaction> {
    if (!plugin.hooks) return noOpTransaction()
    const hookFile = await resolveCandidateHook(candidate.root, plugin.hooks)
    const source = await readBoundedFile(hookFile, "Plugin Hook module")
    await assertSelfContainedHookModule(source.bytes, "Plugin Hook module")
    const receipt = receiptFor(plugin, source.binding)
    const directory = await this.#ensurePluginDirectory(plugin.id)
    const receiptTarget = path.join(directory, `${receipt.key}.json`)
    const snapshotTarget = path.join(directory, receipt.snapshotFile)
    const nonce = randomUUID()
    const receiptStaging = path.join(directory, `.staging-${receipt.key}-${nonce}.json`)
    const snapshotStaging = path.join(
      directory,
      `.staging-${receipt.key}-${nonce}${path.extname(receipt.snapshotFile)}`,
    )
    await fs.writeFile(snapshotStaging, source.bytes, { flag: "wx", mode: 0o400 })
    try {
      await fs.writeFile(receiptStaging, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 })
    } catch (error) {
      await fs.rm(snapshotStaging, { force: true })
      throw error
    }
    let createdReceipt = false
    let createdSnapshot = false
    let published = false
    return {
      async publish() {
        if (published) return
        try {
          try {
            await fs.link(snapshotStaging, snapshotTarget)
            createdSnapshot = true
          } catch (error) {
            if (!isNodeError(error, "EEXIST")) throw error
            const existing = await readBoundedFile(snapshotTarget, "Plugin Hook snapshot")
            if (JSON.stringify(existing.binding) !== JSON.stringify(receipt.binding)) {
              throw new Error("Plugin Hook snapshot identity collided", { cause: error })
            }
          }
          try {
            await fs.link(receiptStaging, receiptTarget)
            createdReceipt = true
          } catch (error) {
            if (!isNodeError(error, "EEXIST")) throw error
            if (!sameReceipt(await readReceipt(receiptTarget), receipt)) {
              throw new Error("Plugin Hook authorization identity collided", { cause: error })
            }
          }
          published = true
        } catch (error) {
          if (createdReceipt) await fs.rm(receiptTarget, { force: true }).catch(() => undefined)
          if (createdSnapshot) await fs.rm(snapshotTarget, { force: true }).catch(() => undefined)
          throw error
        } finally {
          await Promise.all([fs.rm(receiptStaging, { force: true }), fs.rm(snapshotStaging, { force: true })])
        }
      },
      async commit() {
        await Promise.all([
          fs.rm(receiptStaging, { force: true }).catch(() => undefined),
          fs.rm(snapshotStaging, { force: true }).catch(() => undefined),
        ])
        // A running OpenCode generation may still hold the previous file URL
        // and import it lazily for a new directory instance. Per-Plugin
        // reconciliation removes superseded identities only after Desktop has
        // disposed that generation.
      },
      async rollback() {
        await Promise.all([fs.rm(receiptStaging, { force: true }), fs.rm(snapshotStaging, { force: true })])
        if (createdReceipt) await fs.rm(receiptTarget, { force: true })
        if (createdSnapshot) await fs.rm(snapshotTarget, { force: true })
      },
      async deferToRecovery() {
        // New and old immutable identities may safely coexist. Startup first
        // selects the canonical Plugin package, then reconcile keeps its pair.
      },
    }
  }

  async resolve(plugin: InstalledWebPluginSummary) {
    if (!plugin.hooks) return null
    try {
      const liveFile = await this.#resolveInstalledHook(plugin)
      const live = await readBoundedFile(liveFile, "Installed Plugin Hook module")
      const expected = receiptFor(plugin, live.binding)
      const root = await assertPrivateDirectory(this.#rootPath, "Plugin Hook authorization root")
      const directory = path.join(root, requireWebPluginId(plugin.id))
      await assertPrivateDirectory(directory, "Plugin Hook authorization directory")
      const actual = await readReceipt(path.join(directory, `${expected.key}.json`))
      if (!sameReceipt(actual, expected)) throw reinstallError(plugin.id)
      const snapshot = path.join(directory, expected.snapshotFile)
      const verified = await readBoundedFile(snapshot, "Plugin Hook snapshot")
      if (JSON.stringify(verified.binding) !== JSON.stringify(expected.binding)) {
        throw reinstallError(plugin.id)
      }
      return pathToFileURL(snapshot).href
    } catch (error) {
      if (error instanceof Error && error.message === reinstallError(plugin.id).message) throw error
      throw reinstallError(plugin.id)
    }
  }

  async #reconcilePlugin(root: string, pluginId: string, plugin: InstalledWebPluginSummary | undefined) {
    const directory = path.join(root, pluginId)
    let metadata
    try {
      metadata = await fs.lstat(directory)
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return
      throw error
    }
    if (!plugin?.hooks || metadata.isSymbolicLink() || !metadata.isDirectory()) {
      await fs.rm(directory, { force: true, recursive: true })
      return
    }
    let expected: PluginHookAuthorizationReceipt | undefined
    try {
      const liveFile = await this.#resolveInstalledHook(plugin)
      expected = receiptFor(plugin, (await readBoundedFile(liveFile, "Installed Plugin Hook module")).binding)
    } catch {
      // Keep old immutable consent inert across transient filesystem failures.
      return
    }
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === `${expected.key}.json` || entry.name === expected.snapshotFile) continue
      await fs.rm(path.join(directory, entry.name), { force: true, recursive: true }).catch(() => undefined)
    }
  }

  async reconcilePlugin(pluginIdValue: string, plugin?: InstalledWebPluginSummary) {
    const pluginId = requireWebPluginId(pluginIdValue)
    if (plugin && plugin.id !== pluginId) throw new Error("Plugin Hook authorization identity does not match")
    await this.#reconcilePlugin(await this.#ensureRoot(), pluginId, plugin)
  }

  async reconcile(installed: readonly InstalledWebPluginSummary[]) {
    const root = await this.#ensureRoot()
    const plugins = new Map(installed.map((plugin) => [plugin.id, plugin] as const))
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue
      await this.#reconcilePlugin(root, entry.name, plugins.get(entry.name))
    }
  }
}
