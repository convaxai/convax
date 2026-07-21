import { createHash } from "node:crypto"
import { constants as fsConstants, createReadStream, mkdtempSync, rmSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  GenerationOutputModality,
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolSummary,
} from "../generation-contracts"
import { pluginServiceMcpTools, type PluginServiceSummary } from "../plugin-service-contracts"
import {
  webPluginManifestFileName,
  webPluginManifestSchemaV2,
  webPluginManifestSchemaV3,
  webPluginManifestSchemaV4,
  webPluginManifestSchemaV5,
  type InstalledWebPluginSummary,
  type WebPluginGenerationToolContribution,
  type WebPluginServiceAction,
} from "../plugin-contracts"
import {
  StdioMcpClient,
  type McpToolCallResult,
  type McpToolDefinition,
  type StdioMcpClientOptions,
} from "./stdio-mcp-client"
import {
  toolPluginAuthorizationIdentity,
  toolPluginManifestSha256,
  type ToolPluginExecutableBinding,
  type ToolPluginExecutableBindingKind,
} from "./tool-plugin-authorizations"
import type { PluginServiceBrowserAuthorizationCompletion } from "./plugin-service-browser-authorization"
import {
  createToolPluginCanvasMcpBridge,
  type ToolPluginCanvasCapabilityHost,
  type ToolPluginCanvasMcpBridge,
} from "./tool-plugin-canvas-capabilities"
import { normalizeGenerationToolInputSchema, validateGenerationToolInput } from "./generation-tool-input-schema"

export interface GenerationPluginSource {
  list(): Promise<readonly InstalledWebPluginSummary[]>
  resolveAsset(pluginId: string, relativePath: string): Promise<string>
}

export interface GenerationPluginMcpClient {
  callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onRequestStart?: () => void,
    requestTimeoutMs?: number | false,
  ): Promise<McpToolCallResult>
  close(force?: boolean): void
  listTools(signal?: AbortSignal): Promise<readonly McpToolDefinition[]>
}

export interface PluginServiceMcpCallResult extends McpToolCallResult {
  /**
   * Main-only identity of the exact manifest and verified executable bytes
   * serving this call. It binds recoverable browser authorization state and is
   * never serialized to preload or a renderer.
   */
  authorizationIdentity?: string
  /**
   * Main-only, one-shot continuation bound to the exact sidecar bytes and
   * manifest that returned the browser request. It is never serialized.
   */
  completeAuthorization?: (
    input: PluginServiceBrowserAuthorizationCompletion,
    signal?: AbortSignal,
  ) => Promise<McpToolCallResult>
}

export type GenerationPluginMcpClientFactory = (options: StdioMcpClientOptions) => GenerationPluginMcpClient

export type GenerationPluginExecutableBinding = ToolPluginExecutableBinding

export interface GenerationPluginExecutableSnapshot {
  dispose(): void
  path: string
}

export type GenerationPluginExecutableResolver = (
  command: string,
  environment: Readonly<Record<string, string>>,
) => Promise<GenerationPluginExecutableBinding>

export type GenerationPluginManagedExecutableResolver = (
  pluginId: string,
  pluginVersion: string,
  command: string,
) => Promise<GenerationPluginExecutableBinding | null>

export type GenerationPluginExecutableMaterializer = (
  binding: GenerationPluginExecutableBinding,
) => Promise<GenerationPluginExecutableSnapshot>

export interface GenerationPluginRuntimeOptions {
  /** Optional principal-bound reverse Canvas API for an already-running v5 Tool sidecar. */
  canvasCapabilities?: ToolPluginCanvasCapabilityHost
  createClient?: GenerationPluginMcpClientFactory
  /** Source environment. Only the explicit host allowlist is inherited. */
  environment?: Readonly<Record<string, string | undefined>>
  plugins: GenerationPluginSource
  /** Resolves and fingerprints the host-owned executable before receipt verification. */
  resolveExecutable?: GenerationPluginExecutableResolver
  /** Copies the install-authorized entrypoint to a unique host-owned launch snapshot. */
  materializeExecutable?: GenerationPluginExecutableMaterializer
  /** Resolves a Registry-managed, host-owned companion before the explicit PATH fallback. */
  resolveManagedExecutable?: GenerationPluginManagedExecutableResolver
  /** Test seam; Windows execution fails closed until the host owns a Job Object. */
  platform?: NodeJS.Platform
  /** Verifies installation-time consent for this exact declaration and executable. */
  verifyAuthorization(input: {
    binding: GenerationPluginExecutableBinding
    bindingKind: ToolPluginExecutableBindingKind
    plugin: InstalledWebPluginSummary
  }): Promise<void>
}

interface DiscoveredPlugin {
  fingerprint: string
  manifest: InstalledWebPluginSummary
}

interface CachedPluginRuntime {
  authorizationIdentity: string
  availableTools?: ReadonlyMap<string, McpToolDefinition>
  canvasCapabilities?: ToolPluginCanvasMcpBridge
  client: GenerationPluginMcpClient
  executableSnapshot: GenerationPluginExecutableSnapshot
  fingerprint: string
  pluginId: string
}

interface PreparedPluginTool {
  contractFingerprint: string
  definitionFingerprint: string
  description: GenerationToolDescription
  hostToolId: string
  pluginFingerprint: string
  pluginId: string
  runtime: CachedPluginRuntime
  toolId: string
}

interface StartingPluginRuntime {
  canceled: boolean
  fingerprint: string
  promise?: Promise<CachedPluginRuntime>
}

const generationToolEnvironmentKeys = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
] as const

const generationToolIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const bareCommandPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const maximumExecutableBytes = 512 * 1024 * 1024

function abortError(reason?: unknown) {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string" || typeof reason === "number" || typeof reason === "boolean"
        ? String(reason)
        : "Operation was canceled"
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function closeQuietly(client: GenerationPluginMcpClient, force = false) {
  try {
    client.close(force)
  } catch {
    // Disposal is best effort; one broken child must not keep the others alive.
  }
}

function requireGenerationToolId(value: string) {
  if (!generationToolIdPattern.test(value)) throw new Error(`Invalid generation tool id: ${value}`)
  return value
}

function requireBareCommand(value: string) {
  if (!bareCommandPattern.test(value)) {
    throw new Error("Generation Plugin runtime command must be a bare executable name")
  }
  return value
}

function executableBindingFingerprint(binding: GenerationPluginExecutableBinding) {
  return JSON.stringify([binding.path, binding.size, binding.sha256])
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

/**
 * Launch from a unique private temporary copy so a later atomic replacement of the
 * install-authorized entrypoint cannot change which bytes are executed. The snapshot
 * must stay outside the immutable managed-companion installation it was copied from.
 */
export async function materializeGenerationPluginExecutable(
  binding: GenerationPluginExecutableBinding,
): Promise<GenerationPluginExecutableSnapshot> {
  if (process.platform === "win32") {
    throw new Error("Generation Tool Plugin execution on Windows requires a host Job Object and is not enabled")
  }
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const snapshotDirectory = await fs.mkdtemp(path.join(temporaryRoot, "convax-generation-snapshot-"))
  const extension = path.extname(binding.path)
  const snapshotPath = path.join(snapshotDirectory, `entrypoint${extension}`)
  try {
    await fs.chmod(snapshotDirectory, 0o700)
    await fs.copyFile(binding.path, snapshotPath, fsConstants.COPYFILE_EXCL)
    await fs.chmod(snapshotPath, 0o500)
    const before = await fs.stat(snapshotPath)
    if (!before.isFile() || before.size !== binding.size || (await fs.realpath(snapshotPath)) !== snapshotPath) {
      throw new Error("Generation Plugin executable snapshot is invalid")
    }
    const sha256 = await sha256File(snapshotPath)
    const after = await fs.stat(snapshotPath)
    if (sha256 !== binding.sha256 || !sameFileIdentity(before, after)) {
      throw new Error("Generation Plugin executable changed while its launch snapshot was created")
    }
    return {
      dispose() {
        try {
          rmSync(snapshotDirectory, { force: true, recursive: true })
        } catch {
          // The exact host-created private snapshot directory is best-effort cleanup on shutdown.
        }
      },
      path: snapshotPath,
    }
  } catch (error) {
    rmSync(snapshotDirectory, { force: true, recursive: true })
    throw error
  }
}

function executableCandidates(command: string, environment: Readonly<Record<string, string>>) {
  const pathValue = environment.PATH
  if (!pathValue) return []
  const extensions =
    process.platform === "win32" && !path.extname(command)
      ? (environment.PATHEXT ?? ".COM;.EXE").split(";").filter((extension) => /^\.(?:COM|EXE)$/i.test(extension))
      : [""]
  return pathValue.split(path.delimiter).flatMap((entry) => {
    const unquoted = entry.startsWith('"') && entry.endsWith('"') ? entry.slice(1, -1) : entry
    if (!path.isAbsolute(unquoted)) return []
    return extensions.map((extension) => path.join(unquoted, `${command}${extension}`))
  })
}

/** Resolve a bare command only through absolute PATH entries and bind consent to its exact bytes. */
export async function resolveGenerationPluginExecutable(
  command: string,
  environment: Readonly<Record<string, string>>,
): Promise<GenerationPluginExecutableBinding> {
  requireBareCommand(command)
  if (process.platform === "win32") {
    const extension = path.extname(command).toLowerCase()
    if (extension && extension !== ".exe" && extension !== ".com") {
      throw new Error("Generation Plugin Windows commands must resolve to a native .exe or .com executable")
    }
  }
  for (const candidate of executableCandidates(command, environment)) {
    try {
      const realPath = await fs.realpath(candidate)
      const before = await fs.stat(realPath)
      if (!before.isFile() || before.size < 1 || before.size > maximumExecutableBytes) continue
      await fs.access(realPath, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK)
      const sha256 = await sha256File(realPath)
      const after = await fs.stat(realPath)
      if (!sameFileIdentity(before, after)) {
        throw new Error(`Generation Plugin executable changed while it was being inspected: ${command}`)
      }
      return { path: realPath, sha256, size: after.size }
    } catch (error) {
      if (error instanceof Error && error.message.includes("changed while it was being inspected")) throw error
      // Continue searching PATH. Permission errors and non-files are not valid bindings.
    }
  }
  throw new Error(`Generation Plugin executable was not found in the host PATH: ${command}`)
}

function isExecutablePlugin(plugin: InstalledWebPluginSummary): plugin is InstalledWebPluginSummary & {
  runtime: NonNullable<InstalledWebPluginSummary["runtime"]>
  schema:
    | typeof webPluginManifestSchemaV2
    | typeof webPluginManifestSchemaV3
    | typeof webPluginManifestSchemaV4
    | typeof webPluginManifestSchemaV5
} {
  return (
    (plugin.schema === webPluginManifestSchemaV2 ||
      plugin.schema === webPluginManifestSchemaV3 ||
      plugin.schema === webPluginManifestSchemaV4 ||
      plugin.schema === webPluginManifestSchemaV5) &&
    plugin.runtime?.type === "mcp-stdio" &&
    (Boolean(plugin.contributes.generation?.tools.length) || plugin.contributes.service !== undefined)
  )
}

function toolSummary(
  plugin: DiscoveredPlugin["manifest"],
  tool: WebPluginGenerationToolContribution,
): GenerationToolSummary {
  const model =
    plugin.schema === webPluginManifestSchemaV3 ||
    plugin.schema === webPluginManifestSchemaV4 ||
    plugin.schema === webPluginManifestSchemaV5
      ? plugin.contributes.generation?.models?.find((candidate) => candidate.tool === tool.id)
      : { name: tool.title, tool: tool.id }
  const agent =
    plugin.schema === webPluginManifestSchemaV3 ||
    plugin.schema === webPluginManifestSchemaV4 ||
    plugin.schema === webPluginManifestSchemaV5
      ? plugin.contributes.agent?.tools.find((candidate) => candidate.tool === tool.id)
      : undefined
  return {
    acceptedInputs: [...tool.acceptedInputs],
    ...(agent === undefined ? {} : { agentId: agent.id }),
    description: tool.description,
    id: generationPluginToolHostId(plugin.id, tool.id),
    kind: model ? "model" : "operation",
    ...(model === undefined ? {} : { modelName: model.name }),
    output: tool.output,
    pluginId: plugin.id,
    pluginName: plugin.name,
    title: tool.title,
    toolId: tool.id,
  }
}

function toolContractFingerprint(tool: GenerationToolSummary) {
  return JSON.stringify({
    acceptedInputs: [...tool.acceptedInputs],
    agentId: tool.agentId,
    description: tool.description,
    id: tool.id,
    kind: tool.kind,
    modelName: tool.modelName,
    output: tool.output,
    pluginId: tool.pluginId,
    pluginName: tool.pluginName,
    title: tool.title,
    toolId: tool.toolId,
  })
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function toolDefinitionFingerprint(tool: McpToolDefinition) {
  return createHash("sha256").update(stableJson(tool)).digest("hex")
}

/**
 * Builds the environment for an external Tool Plugin without forwarding ambient
 * API keys, cookies, Electron switches, or unrelated application secrets.
 * CLI-managed authentication remains available through the user's home/config
 * directories on macOS and Linux. Windows execution remains fail-closed until
 * Desktop owns the sidecar process tree through a Job Object.
 */
export function generationPluginEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const sourceByFoldedName = new Map(
    Object.entries(source).map(([key, value]) => [key.toLocaleUpperCase("en-US"), value] as const),
  )
  const environment: Record<string, string> = {}
  for (const key of generationToolEnvironmentKeys) {
    const value = source[key] ?? sourceByFoldedName.get(key.toLocaleUpperCase("en-US"))
    if (typeof value === "string" && !value.includes("\0")) environment[key] = value
  }
  return environment
}

/** Stable and unambiguous because neither validated Plugin nor tool ids may contain `/`. */
export function generationPluginToolHostId(pluginId: string, toolId: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error(`Invalid Plugin id: ${pluginId}`)
  return `${pluginId}/${requireGenerationToolId(toolId)}`
}

/**
 * Discovers executable contributions from installed Plugin manifests and lazily
 * executes their matching MCP tools. Generation and service surfaces share this
 * one verified process lifecycle. It intentionally contains no provider, model,
 * credential, account, or routing registry.
 */
export class GenerationPluginRuntime {
  readonly #cache = new Map<string, CachedPluginRuntime>()
  readonly #canvasCapabilities?: ToolPluginCanvasCapabilityHost
  readonly #createClient: GenerationPluginMcpClientFactory
  readonly #environment: Record<string, string>
  readonly #materializeExecutable: GenerationPluginExecutableMaterializer
  readonly #platform: NodeJS.Platform
  readonly #plugins: GenerationPluginSource
  readonly #resolveManagedExecutable?: GenerationPluginManagedExecutableResolver
  readonly #resolveExecutable: GenerationPluginExecutableResolver
  readonly #starting = new Map<string, StartingPluginRuntime>()
  readonly #verifyAuthorization: GenerationPluginRuntimeOptions["verifyAuthorization"]
  readonly #workingDirectory: string
  #disposed = false

  constructor(options: GenerationPluginRuntimeOptions) {
    this.#plugins = options.plugins
    this.#canvasCapabilities = options.canvasCapabilities
    this.#createClient = options.createClient ?? ((clientOptions) => new StdioMcpClient(clientOptions))
    this.#environment = generationPluginEnvironment(options.environment ?? process.env)
    this.#resolveExecutable = options.resolveExecutable ?? resolveGenerationPluginExecutable
    this.#resolveManagedExecutable = options.resolveManagedExecutable
    this.#materializeExecutable = options.materializeExecutable ?? materializeGenerationPluginExecutable
    this.#platform = options.platform ?? process.platform
    this.#verifyAuthorization = (input) => options.verifyAuthorization(input)
    // Never resolve commands or relative interpreter arguments from a downloaded
    // Plugin package (or the shared temp root). Each app session gets an empty,
    // private cwd owned by this runtime.
    this.#workingDirectory = mkdtempSync(path.join(os.tmpdir(), "convax-generation-runtime-"))
  }

  async listTools(options: { output?: GenerationOutputModality } = {}): Promise<readonly GenerationToolSummary[]> {
    const plugins = await this.#discover()
    return [...plugins.values()]
      .flatMap(({ manifest }) =>
        (manifest.contributes.generation?.tools ?? [])
          .filter((tool) => options.output === undefined || tool.output === options.output)
          .map((tool) => toolSummary(manifest, tool)),
      )
      .sort(
        (left, right) =>
          left.pluginName.localeCompare(right.pluginName) ||
          left.pluginId.localeCompare(right.pluginId) ||
          left.title.localeCompare(right.title) ||
          left.toolId.localeCompare(right.toolId),
      )
  }

  /** Lists installed service contributions without resolving or starting their sidecars. */
  async listServices(): Promise<readonly PluginServiceSummary[]> {
    const plugins = await this.#discover()
    return [...plugins.values()]
      .filter(({ manifest }) => manifest.contributes.service !== undefined)
      .map(({ manifest }) => {
        const models = (manifest.contributes.generation?.tools ?? [])
          .map((tool) => toolSummary(manifest, tool))
          .filter((tool) => tool.kind === "model")
          .map((tool) => ({
            capability: tool.output,
            id: tool.toolId,
            name: tool.modelName!,
          }))
        return {
          actions: [...manifest.contributes.service!.actions],
          capabilities: [...new Set(models.map((model) => model.capability))],
          description: manifest.description,
          models,
          pluginId: manifest.id,
          pluginName: manifest.name,
          version: manifest.version,
        }
      })
      .sort(
        (left, right) => left.pluginName.localeCompare(right.pluginName) || left.pluginId.localeCompare(right.pluginId),
      )
  }

  /** Calls one host-defined service tool with an empty input; arbitrary MCP names never enter here. */
  async callService(
    pluginId: string,
    call: "status" | WebPluginServiceAction,
    signal?: AbortSignal,
  ): Promise<PluginServiceMcpCallResult> {
    if (signal?.aborted) throw abortError(signal.reason)
    const plugins = await this.#discover()
    const selected = this.#selectService(plugins, pluginId)
    if (call !== "status" && !selected.manifest.contributes.service!.actions.includes(call)) {
      throw new Error(`Plugin service action is not declared: ${pluginId}`)
    }
    const runtime = await this.#runtimeFor(selected)
    const toolName =
      call === "status"
        ? pluginServiceMcpTools.status
        : call === "authorize"
          ? pluginServiceMcpTools.authorize
          : call === "reauthorize"
            ? pluginServiceMcpTools.reauthorize
            : call === "authorization.cancel"
              ? pluginServiceMcpTools.cancelAuthorization
              : pluginServiceMcpTools.signOut
    try {
      const availableTools = await this.#availableTools(runtime, signal)
      if (!availableTools.has(toolName)) {
        throw new Error(`Plugin service ${pluginId} did not expose its fixed MCP tool: ${toolName}`)
      }
      if (signal?.aborted) throw abortError(signal.reason)
      const current = (await this.#discover()).get(pluginId)
      if (!current || current.fingerprint !== selected.fingerprint || this.#cache.get(pluginId) !== runtime) {
        throw new Error(`Plugin service changed before its action started: ${pluginId}`)
      }
      const result: PluginServiceMcpCallResult = await runtime.client.callTool(toolName, {}, signal)
      result.authorizationIdentity = runtime.authorizationIdentity
      if (
        (call === "authorize" || call === "reauthorize") &&
        availableTools.has(pluginServiceMcpTools.completeAuthorization)
      ) {
        let completionStarted = false
        result.completeAuthorization = async (input, completionSignal) => {
          if (completionStarted)
            throw new Error(`Plugin service authorization completion was already used: ${pluginId}`)
          completionStarted = true
          if (completionSignal?.aborted) throw abortError(completionSignal.reason)
          const current = (await this.#discover()).get(pluginId)
          if (!current || current.fingerprint !== selected.fingerprint || this.#cache.get(pluginId) !== runtime) {
            throw new Error(`Plugin service changed before browser authorization completed: ${pluginId}`)
          }
          try {
            const completionInput: Record<string, unknown> = {
              authorization_id: input.authorization_id,
              cookie_origin: input.cookie_origin,
              cookies: input.cookies.map(({ name, value }) => ({ name, value })),
              schema: input.schema,
            }
            return await runtime.client.callTool(
              pluginServiceMcpTools.completeAuthorization,
              completionInput,
              completionSignal,
            )
          } catch (error) {
            if (!(error instanceof Error && error.name === "AbortError")) this.#evict(runtime)
            throw error
          }
        }
      }
      return result
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) this.#evict(runtime)
      throw error
    }
  }

  async prepareTool(expected: GenerationToolSummary, signal?: AbortSignal) {
    const ready = await this.#readyTool(expected.id, signal, expected)
    let description: GenerationToolDescription
    try {
      description = normalizeGenerationToolInputSchema(expected.id, ready.definition.inputSchema)
    } catch (error) {
      this.#evict(ready.runtime)
      throw error
    }
    const prepared: PreparedPluginTool = {
      contractFingerprint: toolContractFingerprint(expected),
      definitionFingerprint: toolDefinitionFingerprint(ready.definition),
      description,
      hostToolId: expected.id,
      pluginFingerprint: ready.selected.plugin.fingerprint,
      pluginId: ready.selected.plugin.manifest.id,
      runtime: ready.runtime,
      toolId: ready.selected.tool.id,
    }
    return {
      call: (input: Record<string, unknown>, callSignal?: AbortSignal, onExternalStart?: () => void) =>
        this.#callPrepared(prepared, input, callSignal, onExternalStart),
      validateInput: (input?: GenerationToolInput) => validateGenerationToolInput(description, input),
    }
  }

  /**
   * Lazily starts only the selected installed sidecar and returns a bounded,
   * renderer-safe projection of its current MCP input schema.
   */
  async describeTool(hostToolId: string, signal?: AbortSignal): Promise<GenerationToolDescription> {
    const expected = (await this.listTools()).find((tool) => tool.id === hostToolId)
    if (!expected) throw new Error(`Generation tool is not installed: ${hostToolId}`)
    const ready = await this.#readyTool(hostToolId, signal, expected)
    let description: GenerationToolDescription
    try {
      description = normalizeGenerationToolInputSchema(hostToolId, ready.definition.inputSchema)
    } catch (error) {
      this.#evict(ready.runtime)
      throw error
    }
    const current = this.#selectTool(await this.#discover(), hostToolId)
    if (
      current.plugin.fingerprint !== ready.selected.plugin.fingerprint ||
      toolContractFingerprint(toolSummary(current.plugin.manifest, current.tool)) !==
        toolContractFingerprint(expected) ||
      this.#cache.get(current.plugin.manifest.id) !== ready.runtime ||
      toolDefinitionFingerprint(ready.definition) !==
        toolDefinitionFingerprint(ready.runtime.availableTools?.get(ready.selected.tool.id) ?? ready.definition)
    ) {
      throw new Error(`Generation Plugin changed while its tool was described: ${current.plugin.manifest.id}`)
    }
    return description
  }

  /** Convenience for runtime tests and non-staging callers; production uses prepareTool().call(). */
  async callTool(
    hostToolId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onExternalStart?: () => void,
  ): Promise<McpToolCallResult> {
    const expected = (await this.listTools()).find((tool) => tool.id === hostToolId)
    if (!expected) throw new Error(`Generation tool is not installed: ${hostToolId}`)
    return (await this.prepareTool(expected, signal)).call(input, signal, onExternalStart)
  }

  async #callPrepared(
    prepared: PreparedPluginTool,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onExternalStart?: () => void,
  ): Promise<McpToolCallResult> {
    if (signal?.aborted) throw abortError(signal.reason)
    const plugins = await this.#discover()
    const selected = this.#selectTool(plugins, prepared.hostToolId)
    const currentSummary = toolSummary(selected.plugin.manifest, selected.tool)
    const currentDefinition = prepared.runtime.availableTools?.get(prepared.toolId)
    if (
      selected.plugin.fingerprint !== prepared.pluginFingerprint ||
      selected.plugin.manifest.id !== prepared.pluginId ||
      selected.tool.id !== prepared.toolId ||
      toolContractFingerprint(currentSummary) !== prepared.contractFingerprint ||
      !currentDefinition ||
      toolDefinitionFingerprint(currentDefinition) !== prepared.definitionFingerprint ||
      this.#cache.get(prepared.pluginId) !== prepared.runtime
    ) {
      throw new Error(`Generation Plugin changed while inputs were being staged: ${prepared.pluginId}`)
    }
    try {
      if (signal?.aborted) throw abortError(signal.reason)
      // Generation jobs may legitimately remain queued or running for hours. The
      // sidecar owns the vendor state machine and resolves only on a terminal
      // result; caller cancellation, Plugin disposal, and process exit still stop
      // this request. Service/control-plane calls retain the bounded client timeout.
      return await prepared.runtime.client.callTool(prepared.toolId, input, signal, onExternalStart, false)
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) this.#evict(prepared.runtime)
      throw error
    }
  }

  async #readyTool(hostToolId: string, signal?: AbortSignal, expected?: GenerationToolSummary) {
    if (signal?.aborted) throw abortError(signal.reason)
    const plugins = await this.#discover()
    const selected = this.#selectTool(plugins, hostToolId)
    if (
      expected &&
      toolContractFingerprint(toolSummary(selected.plugin.manifest, selected.tool)) !==
        toolContractFingerprint(expected)
    ) {
      throw new Error(`Generation Plugin declaration changed before preparation: ${selected.plugin.manifest.id}`)
    }
    const runtime = await this.#runtimeFor(selected.plugin)
    try {
      const availableTools = await this.#availableTools(runtime, signal, true)
      const definition = availableTools.get(selected.tool.id)
      if (!definition) {
        throw new Error(
          `Generation Plugin ${selected.plugin.manifest.id} did not expose its declared MCP tool: ${selected.tool.id}`,
        )
      }
      if (signal?.aborted) throw abortError(signal.reason)
      return { definition, runtime, selected }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) this.#evict(runtime)
      throw error
    }
  }

  disposePlugin(pluginId: string) {
    let disposed = false
    const starting = this.#starting.get(pluginId)
    if (starting) {
      starting.canceled = true
      this.#starting.delete(pluginId)
      disposed = true
    }
    const runtime = this.#cache.get(pluginId)
    if (runtime) {
      this.#cache.delete(pluginId)
      this.#closeRuntime(runtime)
      disposed = true
    }
    return disposed
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const starting of this.#starting.values()) starting.canceled = true
    this.#starting.clear()
    for (const runtime of this.#cache.values()) this.#closeRuntime(runtime, true)
    this.#cache.clear()
    rmSync(this.#workingDirectory, { force: true, recursive: true })
  }

  async #discover() {
    if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
    const discovered = new Map<string, DiscoveredPlugin>()
    const installed = await this.#plugins.list()
    if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
    for (const plugin of installed) {
      if (!isExecutablePlugin(plugin)) continue
      requireBareCommand(plugin.runtime.command)
      if (discovered.has(plugin.id)) throw new Error(`Duplicate installed Plugin id: ${plugin.id}`)
      for (const tool of plugin.contributes.generation?.tools ?? []) requireGenerationToolId(tool.id)
      discovered.set(plugin.id, { fingerprint: toolPluginManifestSha256(plugin), manifest: plugin })
    }
    for (const [pluginId, runtime] of this.#cache) {
      if (discovered.get(pluginId)?.fingerprint !== runtime.fingerprint) this.#evict(runtime)
    }
    for (const [pluginId, starting] of this.#starting) {
      if (discovered.get(pluginId)?.fingerprint !== starting.fingerprint) {
        starting.canceled = true
        this.#starting.delete(pluginId)
      }
    }
    return discovered
  }

  #selectTool(plugins: ReadonlyMap<string, DiscoveredPlugin>, hostToolId: string) {
    for (const plugin of plugins.values()) {
      const tool = plugin.manifest.contributes.generation?.tools.find(
        (candidate) => generationPluginToolHostId(plugin.manifest.id, candidate.id) === hostToolId,
      )
      if (tool) return { plugin, tool }
    }
    throw new Error(`Generation tool is not installed: ${hostToolId}`)
  }

  #selectService(plugins: ReadonlyMap<string, DiscoveredPlugin>, pluginId: string) {
    const plugin = plugins.get(pluginId)
    if (!plugin?.manifest.contributes.service) throw new Error(`Plugin service is not installed: ${pluginId}`)
    return plugin
  }

  async #runtimeFor(plugin: DiscoveredPlugin): Promise<CachedPluginRuntime> {
    const cached = this.#cache.get(plugin.manifest.id)
    if (cached?.fingerprint === plugin.fingerprint) return cached

    const pending = this.#starting.get(plugin.manifest.id)
    if (pending?.fingerprint === plugin.fingerprint && pending.promise) return pending.promise
    if (pending) {
      pending.canceled = true
      this.#starting.delete(plugin.manifest.id)
    }

    const starting: StartingPluginRuntime = { canceled: false, fingerprint: plugin.fingerprint }
    const promise = this.#startRuntime(plugin, starting)
    starting.promise = promise
    this.#starting.set(plugin.manifest.id, starting)
    try {
      return await promise
    } finally {
      if (this.#starting.get(plugin.manifest.id) === starting) this.#starting.delete(plugin.manifest.id)
    }
  }

  async #startRuntime(plugin: DiscoveredPlugin, starting: StartingPluginRuntime) {
    if (this.#platform === "win32") {
      throw new Error("Generation Tool Plugin execution on Windows requires a host Job Object and is not enabled")
    }
    const declaredRuntime = plugin.manifest.runtime!
    const resolveExecutable = async () => {
      const managed = await this.#resolveManagedExecutable?.(
        plugin.manifest.id,
        plugin.manifest.version,
        declaredRuntime.command,
      )
      return managed
        ? { binding: managed, kind: "managed" as const }
        : {
            binding: await this.#resolveExecutable(declaredRuntime.command, this.#environment),
            kind: "path" as const,
          }
    }
    const resolved = await resolveExecutable()
    const binding = resolved.binding
    if (this.#disposed || starting.canceled) {
      throw new Error(`Generation Plugin changed while resolving its executable: ${plugin.manifest.id}`)
    }
    const bindingFingerprint = executableBindingFingerprint(binding)
    await this.#verifyAuthorization({ binding, bindingKind: resolved.kind, plugin: plugin.manifest })
    if (this.#disposed || starting.canceled) {
      throw new Error(`Generation Plugin changed while verifying its installation: ${plugin.manifest.id}`)
    }
    const manifestPath = await this.#plugins.resolveAsset(plugin.manifest.id, webPluginManifestFileName)
    if (!path.isAbsolute(manifestPath)) throw new Error("Installed Plugin manifest path must be absolute")
    if (this.#disposed || starting.canceled)
      throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
    const confirmed = await resolveExecutable()
    if (confirmed.kind !== resolved.kind || executableBindingFingerprint(confirmed.binding) !== bindingFingerprint) {
      throw new Error(
        `Generation Plugin executable changed after installation; reinstall Plugin: ${plugin.manifest.id}`,
      )
    }
    const executableSnapshot = await this.#materializeExecutable(confirmed.binding)
    let canvasCapabilities: ToolPluginCanvasMcpBridge | undefined
    try {
      canvasCapabilities = await createToolPluginCanvasMcpBridge(plugin.manifest, this.#canvasCapabilities)
      if (this.#disposed || starting.canceled) {
        canvasCapabilities?.close()
        throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
      }
      const client = this.#createClient({
        ...(declaredRuntime.args ? { args: [...declaredRuntime.args] } : {}),
        command: executableSnapshot.path,
        cwd: this.#workingDirectory,
        env: { ...this.#environment },
        ...(canvasCapabilities ? { serverRequestHandler: canvasCapabilities.handler } : {}),
      })
      if (this.#disposed || starting.canceled) {
        closeQuietly(client)
        canvasCapabilities?.close()
        throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
      }
      const cached: CachedPluginRuntime = {
        authorizationIdentity: toolPluginAuthorizationIdentity(plugin.manifest, confirmed.kind, confirmed.binding),
        ...(canvasCapabilities ? { canvasCapabilities } : {}),
        client,
        executableSnapshot,
        fingerprint: plugin.fingerprint,
        pluginId: plugin.manifest.id,
      }
      const prior = this.#cache.get(plugin.manifest.id)
      if (prior) this.#closeRuntime(prior)
      this.#cache.set(plugin.manifest.id, cached)
      return cached
    } catch (error) {
      canvasCapabilities?.close()
      executableSnapshot.dispose()
      throw error
    }
  }

  async #availableTools(runtime: CachedPluginRuntime, signal?: AbortSignal, refresh = false) {
    if (runtime.availableTools && !refresh) return runtime.availableTools
    const tools = await runtime.client.listTools(signal)
    const names = tools.map((tool) => tool.name)
    if (new Set(names).size !== names.length) throw new Error("Generation Plugin MCP server exposed duplicate tool ids")
    const available = new Map(tools.map((tool) => [tool.name, tool])) as ReadonlyMap<string, McpToolDefinition>
    runtime.availableTools = available
    return runtime.availableTools
  }

  #evict(runtime: CachedPluginRuntime) {
    if (this.#cache.get(runtime.pluginId) === runtime) this.#cache.delete(runtime.pluginId)
    this.#closeRuntime(runtime)
  }

  #closeRuntime(runtime: CachedPluginRuntime, force = false) {
    runtime.canvasCapabilities?.close()
    closeQuietly(runtime.client, force)
    runtime.executableSnapshot.dispose()
  }
}
