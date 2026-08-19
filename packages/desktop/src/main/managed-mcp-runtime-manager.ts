import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { copyStableFile } from "./stable-file-copy"
import { type ManagedMcpAgentToolRegistry } from "./managed-mcp-agent-tools"
import {
  type ManagedMcpHostGrant,
  type ManagedMcpProductActionDeclaration,
  type ManagedMcpProductActionRegistry,
} from "./managed-mcp-product-actions"
import { StdioMcpClient } from "./stdio-mcp-client"

export interface ManagedMcpExecutableBinding {
  path: string
  sha256: string
  size: number
}

export interface ManagedMcpRuntimePublication {
  agentToolAllowlist?: readonly string[]
  authorizationContractDigest: string
  enabled: boolean
  executable: ManagedMcpExecutableBinding
  launch: ManagedMcpLaunchTemplate
  productActions?: readonly ManagedMcpProductActionDeclaration[]
  grants?: readonly ManagedMcpHostGrant[]
  principalRevision: number
  serverKey: string
}

export interface ManagedMcpBunRuntime {
  command: string
  env: Readonly<Record<string, string>>
}

export interface ManagedMcpRuntimeManagerOptions {
  agentTools: ManagedMcpAgentToolRegistry
  bunRuntime?: ManagedMcpBunRuntime
  productActions?: ManagedMcpProductActionRegistry
  platform?: NodeJS.Platform
  root: string
}

export interface ManagedMcpLaunchTemplate {
  readonly args: readonly string[]
  readonly command: string
}

interface CurrentRuntime {
  client: StdioMcpClient
  privateDirectory: string
}

const maxCompanionBytes = 128 * 1024 * 1024
const commandPattern = /^[A-Za-z0-9._-]{1,128}$/u
const serverKeyPattern = /^[A-Za-z0-9_-]{1,96}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu
const bunCompanionHeader = "#!/usr/bin/env convax-bun\n"
const launchTemplates = new WeakSet<object>()

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function abortError(reason?: unknown) {
  const error =
    reason instanceof Error
      ? reason
      : new Error(
          typeof reason === "string" || typeof reason === "number" || typeof reason === "boolean"
            ? String(reason)
            : "Operation was canceled",
        )
  error.name = "AbortError"
  return error
}

/**
 * Converts the already strictly parsed and Registry-verified extension launch
 * declaration into the only launch object accepted by the process owner.
 * Setup inputs never contribute argv.
 */
export function createManagedMcpLaunchTemplateFromVerifiedExtension(value: {
  args?: readonly string[]
  command: string
}): ManagedMcpLaunchTemplate {
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...(value.args === undefined ? [] : ["args"]), "command"].sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("Managed MCP verified extension launch contains unsupported fields")
  }
  if (!commandPattern.test(value.command) || windowsReservedName.test(value.command)) {
    throw new Error("Managed MCP extension must declare a safe bare command")
  }
  const args = value.args ?? []
  if (
    !Array.isArray(args) ||
    args.length > 64 ||
    args.some(
      (argument) =>
        typeof argument !== "string" || argument.length > 4_096 || argument.includes("\0") || /[\r\n]/u.test(argument),
    )
  ) {
    throw new Error("Managed MCP extension constant arguments are invalid")
  }
  const launch = Object.freeze({ args: Object.freeze([...args]), command: value.command })
  launchTemplates.add(launch)
  return launch
}

function assertPublication(value: ManagedMcpRuntimePublication) {
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [
    ...(value.agentToolAllowlist === undefined ? [] : ["agentToolAllowlist"]),
    ...(value.grants === undefined ? [] : ["grants"]),
    ...(value.productActions === undefined ? [] : ["productActions"]),
    "authorizationContractDigest",
    "enabled",
    "executable",
    "launch",
    "principalRevision",
    "serverKey",
  ].sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("Managed MCP publication must not contain environment or unsupported launch fields")
  }
  if (!value.launch || !launchTemplates.has(value.launch)) {
    throw new Error("Managed MCP launch must come from a verified extension template")
  }
  if (
    !serverKeyPattern.test(value.serverKey) ||
    !digestPattern.test(value.authorizationContractDigest) ||
    !Number.isSafeInteger(value.principalRevision) ||
    value.principalRevision < 1
  ) {
    throw new Error("Managed MCP publication is invalid")
  }
  if (
    !value.executable ||
    typeof value.executable.path !== "string" ||
    !path.isAbsolute(value.executable.path) ||
    typeof value.executable.sha256 !== "string" ||
    !digestPattern.test(value.executable.sha256) ||
    !Number.isSafeInteger(value.executable.size) ||
    value.executable.size < 1 ||
    value.executable.size > maxCompanionBytes
  ) {
    throw new Error("Managed MCP executable binding is invalid")
  }
  if (
    (value.grants !== undefined &&
      (!Array.isArray(value.grants) ||
        value.grants.length > 3 ||
        new Set(value.grants).size !== value.grants.length ||
        value.grants.some((grant) => !["canvas.read", "canvas.write", "project.files.read"].includes(grant)))) ||
    (value.productActions !== undefined &&
      (!Array.isArray(value.productActions) ||
        value.productActions.length > 3 ||
        value.productActions.some(
          (entry) =>
            !entry ||
            !["canvas.export", "canvas.import", "project.files.read"].includes(entry.action) ||
            typeof entry.tool !== "string",
        )))
  ) {
    throw new Error("Managed MCP product action publication is invalid")
  }
}

function commandMatchesExecutable(command: string, executable: string, platform: NodeJS.Platform) {
  const name = path.basename(executable)
  return platform === "win32" ? name.toLowerCase() === command.toLowerCase() : name === command
}

/**
 * Owns the managed-stdio executable snapshot, process, MCP client, and teardown.
 * The Agent sees only the existing authenticated loopback provider projection.
 */
export class ManagedMcpRuntimeManager {
  readonly #agentTools: ManagedMcpAgentToolRegistry
  readonly #bunRuntime?: ManagedMcpBunRuntime
  readonly #platform: NodeJS.Platform
  readonly #productActions?: ManagedMcpProductActionRegistry
  readonly #root: string
  readonly #runtimes = new Map<string, CurrentRuntime>()
  readonly #mutations = new Map<string, Promise<void>>()
  #closed = false

  constructor(options: ManagedMcpRuntimeManagerOptions) {
    this.#agentTools = options.agentTools
    this.#bunRuntime = options.bunRuntime
    this.#platform = options.platform ?? process.platform
    this.#productActions = options.productActions
    this.#root = path.resolve(options.root)
    if (
      this.#bunRuntime &&
      (!path.isAbsolute(this.#bunRuntime.command) ||
        this.#bunRuntime.command.includes("\0") ||
        Object.keys(this.#bunRuntime.env).length !== 0)
    ) {
      throw new Error("Managed MCP app-owned Bun runtime is invalid")
    }
  }

  async publish(publication: ManagedMcpRuntimePublication, signal?: AbortSignal) {
    if (this.#closed) throw new Error("Managed MCP runtime manager is closed")
    assertPublication(publication)
    return this.#mutate(publication.serverKey, async () => {
      if (signal?.aborted) throw abortError(signal.reason)
      if (!publication.enabled) {
        await this.#disable(publication.serverKey)
        return
      }
      await this.#publish(publication, signal)
    })
  }

  async #publish(publication: ManagedMcpRuntimePublication, signal?: AbortSignal) {
    if (this.#platform === "win32") {
      throw new Error("Managed MCP is unavailable because process-tree ownership is not verified on Windows")
    }
    const realPath = await fs.realpath(publication.executable.path)
    if (!commandMatchesExecutable(publication.launch.command, realPath, this.#platform)) {
      throw new Error("Managed MCP executable basename does not match the declared command")
    }
    const metadata = await fs.lstat(publication.executable.path)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error("Managed MCP executable must be one regular single-link file")
    }
    const privateDirectory = path.join(this.#root, publication.serverKey, randomUUID())
    const launchDirectory = path.join(privateDirectory, "launch")
    const workDirectory = path.join(privateDirectory, "work")
    await fs.mkdir(launchDirectory, { mode: 0o700, recursive: true })
    await fs.mkdir(workDirectory, { mode: 0o700 })
    const snapshot = await copyStableFile({
      description: "Managed MCP executable",
      expectedRealPath: realPath,
      expectedSize: publication.executable.size,
      maximumBytes: maxCompanionBytes,
      prepareTarget: () => path.join(launchDirectory, publication.launch.command),
      signal,
      sourcePath: publication.executable.path,
    }).catch(async (error) => {
      await fs.rm(privateDirectory, { force: true, recursive: true })
      throw error
    })
    let candidateClient: StdioMcpClient | undefined
    let committed = false
    try {
      const bytes = await fs.readFile(snapshot)
      if (bytes.byteLength !== publication.executable.size || sha256(bytes) !== publication.executable.sha256) {
        throw new Error("Managed MCP executable changed while its launch snapshot was created")
      }
      const sourceAfterCopy = await fs.lstat(publication.executable.path)
      if (!sourceAfterCopy.isFile() || sourceAfterCopy.isSymbolicLink() || sourceAfterCopy.nlink !== 1) {
        throw new Error("Managed MCP executable changed while its launch snapshot was created")
      }
      await fs.chmod(snapshot, 0o700)
      const isBunCompanion =
        bytes.subarray(0, Buffer.byteLength(bunCompanionHeader)).toString("utf8") === bunCompanionHeader
      if (isBunCompanion && !this.#bunRuntime) throw new Error("Managed MCP app-owned Bun runtime is unavailable")
      const client = new StdioMcpClient({
        args: isBunCompanion ? [snapshot, ...publication.launch.args] : [...publication.launch.args],
        command: isBunCompanion ? this.#bunRuntime!.command : snapshot,
        cwd: workDirectory,
        // Native V1 receives no user environment. Interpreted companions receive
        // only the fixed app-owned runtime selector.
        env: isBunCompanion ? { ...this.#bunRuntime!.env } : {},
      })
      candidateClient = client
      const tools = await client.listTools(signal)
      const previous = this.#runtimes.get(publication.serverKey)
      this.#runtimes.set(publication.serverKey, { client, privateDirectory })
      this.#agentTools.publish({
        ...(publication.agentToolAllowlist ? { agentToolAllowlist: [...publication.agentToolAllowlist] } : {}),
        authorizationContractDigest: publication.authorizationContractDigest,
        client,
        enabled: publication.enabled,
        principalRevision: publication.principalRevision,
        serverKey: publication.serverKey,
      })
      this.#productActions?.publish({
        authorizationContractDigest: publication.authorizationContractDigest,
        client,
        enabled: publication.enabled,
        grants: publication.grants ?? [],
        principalRevision: publication.principalRevision,
        productActions: publication.productActions ?? [],
        serverKey: publication.serverKey,
        tools,
      })
      committed = true
      if (previous) await this.#dispose(previous)
    } catch (error) {
      if (!committed) {
        const candidate = this.#runtimes.get(publication.serverKey)
        if (candidate?.privateDirectory === privateDirectory) this.#runtimes.delete(publication.serverKey)
        await candidateClient?.closeAndWait(true)
        await fs.rm(privateDirectory, { force: true, recursive: true })
      }
      throw error
    }
  }

  async disable(serverKey: string) {
    return this.#mutate(serverKey, () => this.#disable(serverKey))
  }

  async #disable(serverKey: string) {
    const current = this.#runtimes.get(serverKey)
    if (!current) return
    this.#runtimes.delete(serverKey)
    this.#agentTools.disable(serverKey)
    this.#productActions?.disable(serverKey)
    await this.#dispose(current)
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    await Promise.allSettled(this.#mutations.values())
    const current = [...this.#runtimes.values()]
    this.#runtimes.clear()
    this.#agentTools.close()
    await Promise.all(current.map((runtime) => this.#dispose(runtime, true)))
  }

  async #dispose(runtime: CurrentRuntime, force = false) {
    await runtime.client.closeAndWait(force)
    await fs.rm(runtime.privateDirectory, { force: true, recursive: true })
  }

  #mutate<T>(serverKey: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.#mutations.get(serverKey) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(mutation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.#mutations.set(serverKey, tail)
    void tail.finally(() => {
      if (this.#mutations.get(serverKey) === tail) this.#mutations.delete(serverKey)
    })
    return result
  }
}
