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
  webPluginManifestSchemaV6,
  webPluginManifestSchemaV7,
  type InstalledWebPluginSummary,
  type WebPluginGenerationToolContribution,
  type WebPluginServiceAction,
} from "../plugin-contracts"
import {
  StdioMcpClient,
  type GenerationToolOperationMetadata,
  type GenerationToolLifecycleObserver,
  type McpToolCallResult,
  type McpToolDefinition,
  type StdioMcpClientOptions,
  normalizeMcpToolCallResult,
} from "./stdio-mcp-client"
import {
  type GenerationRecoveryCapability,
  type GenerationRecoveryMethod,
  type GenerationRecoveryRequest,
  type GenerationRecoverySnapshot,
  generationLroMethods,
  normalizeGenerationRecoverySnapshot,
} from "./generation-recovery-protocol"
import {
  GenerationRecoveryRuntimeStore,
  type GenerationRecoveryRuntimeRecord,
} from "./generation-recovery-runtime-store"
import {
  toolPluginAuthorizationIdentity,
  toolPluginManifestSha256,
  type ToolPluginExecutableBinding,
  type ToolPluginExecutableBindingKind,
} from "./tool-plugin-authorizations"
import type { PluginServiceBrowserAuthorizationCompletion } from "./plugin-service-browser-authorization"
import type { PluginServiceExternalAuthorizationCompletion } from "./plugin-service-external-authorization"
import {
  createToolPluginCanvasMcpBridge,
  type ToolPluginCanvasCapabilityHost,
  type ToolPluginCanvasMcpBridge,
} from "./tool-plugin-canvas-capabilities"
import {
  projectGenerationToolInputSchema,
  validateGenerationToolInput,
  type GenerationModelInputSelector,
} from "./generation-tool-input-schema"
import type { GenerationToolDispatchHooks, InspectedGenerationModel } from "./generation-canvas-service"

class GenerationHostPreDispatchError extends Error {
  override name = "GenerationHostPreDispatchError"

  constructor(readonly original: unknown) {
    super("Host generation pre-dispatch check failed")
  }
}

async function runGenerationHostPreDispatch(callback: (() => void | Promise<void>) | undefined) {
  if (!callback) return
  try {
    await callback()
  } catch (error) {
    throw new GenerationHostPreDispatchError(error)
  }
}

export interface GenerationPluginSource {
  list(): Promise<readonly InstalledWebPluginSummary[]>
  resolveAsset(pluginId: string, relativePath: string): Promise<string>
}

export interface GenerationPluginMcpClient {
  callTool(
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    lifecycleObserver?: GenerationToolLifecycleObserver,
    requestTimeoutMs?: number | false,
    operation?: GenerationToolOperationMetadata,
  ): Promise<McpToolCallResult>
  callGenerationRecovery?(
    method: GenerationRecoveryMethod,
    input: Omit<GenerationRecoveryRequest, "schema">,
    signal?: AbortSignal,
  ): Promise<unknown>
  close(force?: boolean): void
  generationRecoveryCapability?(signal?: AbortSignal): Promise<GenerationRecoveryCapability | undefined>
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
    input: PluginServiceBrowserAuthorizationCompletion | PluginServiceExternalAuthorizationCompletion,
    signal?: AbortSignal,
  ) => Promise<McpToolCallResult>
}

export interface PluginLlmProviderConnection {
  apiKey: string
  baseUrl: string
  models: Array<{ id: string; name: string }>
  name: string
  pluginId: string
  providerId: string
}

export type GenerationPluginMcpClientFactory = (options: StdioMcpClientOptions) => GenerationPluginMcpClient

export type GenerationPluginExecutableBinding = ToolPluginExecutableBinding

export interface GenerationPluginExecutableSnapshot {
  dispose(): void
  path: string
  runtime?: "bun"
}

export interface GenerationPluginBunRuntime {
  command: string
  env?: Readonly<Record<string, string>>
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
  /** Trusted app-owned Bun CLI used only for companions carrying the exact convax-bun header. */
  bunRuntime?: GenerationPluginBunRuntime
  /** Optional principal-bound reverse Canvas API for an already-running v5 Tool sidecar. */
  canvasCapabilities?: ToolPluginCanvasCapabilityHost
  createClient?: GenerationPluginMcpClientFactory
  /** Source environment. Only the explicit host allowlist is inherited. */
  environment?: Readonly<Record<string, string | undefined>>
  plugins: GenerationPluginSource
  /** Main-owned activation gate for source-bound Marketplace runtime capabilities. */
  isPluginEnabled?(pluginId: string): Promise<boolean>
  /** Resolves and fingerprints the host-owned executable before receipt verification. */
  resolveExecutable?: GenerationPluginExecutableResolver
  /** Copies the install-authorized entrypoint to a unique host-owned launch snapshot. */
  materializeExecutable?: GenerationPluginExecutableMaterializer
  /** Resolves a Registry-managed, host-owned companion before the explicit PATH fallback. */
  resolveManagedExecutable?: GenerationPluginManagedExecutableResolver
  /**
   * Main-private root used by recovery-capable sidecars for durable operation
   * journals. A binding-scoped child is injected only into the sidecar process.
   */
  recoveryStateDirectory?: string
  /** Main-private immutable executable snapshots retained for active recovery ledgers. */
  recoveryRuntimeDirectory?: string
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
  bindingKind: ToolPluginExecutableBindingKind
  canvasCapabilities?: ToolPluginCanvasMcpBridge
  client: GenerationPluginMcpClient
  executableSnapshot: GenerationPluginExecutableSnapshot
  fingerprint: string
  plugin: InstalledWebPluginSummary
  pluginId: string
  sourceBinding: GenerationPluginExecutableBinding
}

interface PreparedPluginTool {
  contractFingerprint: string
  definitionFingerprint: string
  description: GenerationToolDescription
  hostToolId: string
  pluginFingerprint: string
  pluginId: string
  runtime: CachedPluginRuntime
  recovery?: PreparedGenerationRecovery
  modelBinding?: GenerationModelBinding
  toolId: string
}

interface GenerationModelBinding {
  fieldId: string
  value: string
}

interface SelectedPluginTool {
  plugin: DiscoveredPlugin
  tool: WebPluginGenerationToolContribution
}

interface ReadyPluginTool {
  definition: McpToolDefinition
  description: GenerationToolDescription
  modelBinding?: GenerationModelBinding
  runtime: CachedPluginRuntime
  selected: SelectedPluginTool
  summary: GenerationToolSummary
  variants?: readonly {
    binding: GenerationModelBinding
    summary: GenerationToolSummary
  }[]
}

interface ResolvedGenerationToolSelection {
  binding?: GenerationModelBinding
  summary: GenerationToolSummary
  variants?: readonly {
    binding: GenerationModelBinding
    summary: GenerationToolSummary
  }[]
}

export interface PreparedGenerationRecovery {
  acknowledge(input: Omit<GenerationRecoveryRequest, "schema">, signal?: AbortSignal): Promise<void>
  bindingDigest: string
  cancel(input: Omit<GenerationRecoveryRequest, "schema">, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
  executionBindingDigest: string
  get(input: Omit<GenerationRecoveryRequest, "schema">, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
  pluginPackageDigest: string
  result(
    input: Omit<GenerationRecoveryRequest, "schema"> & { outputDirectory: string; resultDigest: string },
    signal?: AbortSignal,
  ): Promise<{ result: McpToolCallResult; resultDigest: string }>
  runtimeAuthorizationDigest: string
  wait(input: Omit<GenerationRecoveryRequest, "schema">, signal?: AbortSignal): Promise<GenerationRecoverySnapshot>
}

export interface GenerationRecoveryRuntimeBinding {
  executionBindingDigest: string
  pluginPackageDigest: string
  runtimeAuthorizationDigest: string
  sidecarRecoveryBindingDigest: string
  toolId: string
}

interface StartingPluginRuntime {
  canceled: boolean
  fingerprint: string
  promise?: Promise<CachedPluginRuntime>
}

class PluginRuntimeReportedError extends Error {}

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
// The marker plus a full SHA-256 makes the Plugin-local selection component
// longer than the manifest's 80-character tool-id ceiling, so it cannot collide
// with a declared tool while remaining valid for the existing host-id grammar.
const generationModelSelectionMarker = ".model-selection-"
const generationModelSelectionDigestPattern = /^[a-f0-9]{64}$/
const llmModelIdPattern = /^~?[A-Za-z0-9]+(?:[._/:-][A-Za-z0-9]+)*$/
const bareCommandPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const maximumExecutableBytes = 512 * 1024 * 1024
const maximumRuntimeLlmModels = 2_048

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
  return JSON.stringify([binding.path, binding.size, binding.sha256, binding.runtime])
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

async function ensurePlainPrivateDirectory(directory: string, label: string) {
  try {
    const current = await fs.lstat(directory)
    if (current.isSymbolicLink() || !current.isDirectory()) {
      throw new Error(`${label} must be a real directory`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await fs.mkdir(directory, { mode: 0o700 })
  }
  await fs.chmod(directory, 0o700)
  return fs.realpath(directory)
}

async function ensureGenerationRecoveryStateDirectory(
  rootPath: string,
  pluginId: string,
  pluginFingerprint: string,
  runtimeAuthorizationDigest: string,
) {
  const parent = await ensurePlainPrivateDirectory(path.dirname(rootPath), "Generation recovery state parent")
  const root = await ensurePlainPrivateDirectory(
    path.join(parent, path.basename(rootPath)),
    "Generation recovery state root",
  )
  const bindingKey = createHash("sha256")
    .update(JSON.stringify([pluginId, pluginFingerprint, runtimeAuthorizationDigest]))
    .digest("hex")
  return ensurePlainPrivateDirectory(path.join(root, bindingKey), "Generation recovery binding directory")
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
      ...(binding.runtime === undefined ? {} : { runtime: binding.runtime }),
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
    | typeof webPluginManifestSchemaV6
    | typeof webPluginManifestSchemaV7
} {
  return (
    (plugin.schema === webPluginManifestSchemaV2 ||
      plugin.schema === webPluginManifestSchemaV3 ||
      plugin.schema === webPluginManifestSchemaV4 ||
      plugin.schema === webPluginManifestSchemaV5 ||
      plugin.schema === webPluginManifestSchemaV6 ||
      plugin.schema === webPluginManifestSchemaV7) &&
    plugin.runtime?.type === "mcp-stdio" &&
    (Boolean(plugin.contributes.generation?.tools.length) ||
      plugin.contributes.service !== undefined ||
      plugin.contributes.llm !== undefined)
  )
}

function toolSummary(
  plugin: DiscoveredPlugin["manifest"],
  tool: WebPluginGenerationToolContribution,
): GenerationToolSummary {
  const model =
    plugin.schema === webPluginManifestSchemaV3 ||
    plugin.schema === webPluginManifestSchemaV4 ||
    plugin.schema === webPluginManifestSchemaV5 ||
    plugin.schema === webPluginManifestSchemaV6 ||
    plugin.schema === webPluginManifestSchemaV7
      ? plugin.contributes.generation?.models?.find((candidate) => candidate.tool === tool.id)
      : { name: tool.title, tool: tool.id }
  const agent =
    plugin.schema === webPluginManifestSchemaV3 ||
    plugin.schema === webPluginManifestSchemaV4 ||
    plugin.schema === webPluginManifestSchemaV5 ||
    plugin.schema === webPluginManifestSchemaV6 ||
    plugin.schema === webPluginManifestSchemaV7
      ? plugin.contributes.agent?.tools?.find((candidate) => candidate.tool === tool.id)
      : undefined
  return {
    acceptedInputs: [...tool.acceptedInputs],
    ...(agent === undefined ? {} : { agentId: agent.id }),
    ...(tool.delivery === undefined ? {} : { delivery: tool.delivery }),
    description: tool.description,
    id: generationPluginToolHostId(plugin.id, tool.id),
    ...(tool.inputBinding === undefined ? {} : { inputBinding: tool.inputBinding }),
    kind: model ? "model" : "operation",
    ...(model === undefined ? {} : { modelName: model.name }),
    output: tool.output,
    pluginId: plugin.id,
    pluginName: plugin.name,
    ...(tool.recovery === undefined ? {} : { recovery: tool.recovery.mode }),
    title: tool.title,
    toolId: tool.id,
  }
}

function generationModelSelectionHostId(baseToolId: string, fieldId: string, value: string) {
  const digest = createHash("sha256")
    .update(JSON.stringify([baseToolId, fieldId, value]))
    .digest("hex")
  return `${baseToolId}${generationModelSelectionMarker}${digest}`
}

function baseGenerationToolHostId(selectionId: string) {
  const markerIndex = selectionId.lastIndexOf(generationModelSelectionMarker)
  if (markerIndex < 0) return selectionId
  const digest = selectionId.slice(markerIndex + generationModelSelectionMarker.length)
  return generationModelSelectionDigestPattern.test(digest) ? selectionId.slice(0, markerIndex) : selectionId
}

function generationModelVariants(base: GenerationToolSummary, selector: GenerationModelInputSelector) {
  if (base.kind !== "model") {
    throw new Error(`Generation model selector is not allowed on an operation: ${base.id}`)
  }
  return selector.choices.map((choice) => ({
    binding: { fieldId: selector.fieldId, value: choice.value },
    summary: {
      ...base,
      id: generationModelSelectionHostId(base.id, selector.fieldId, choice.value),
      modelName: choice.label,
    },
  }))
}

function resolveGenerationToolSelection(
  base: GenerationToolSummary,
  requestedId: string,
  selector: GenerationModelInputSelector | undefined,
  allowUnselectedModel = false,
): ResolvedGenerationToolSelection {
  if (!selector) {
    if (requestedId !== base.id) throw new Error(`Generation model selection is no longer installed: ${requestedId}`)
    return { summary: base }
  }
  const variants = generationModelVariants(base, selector)
  if (requestedId === base.id) {
    if (allowUnselectedModel) return { summary: base, variants }
    throw new Error(`Generation model selection is required: ${base.id}`)
  }
  const selected = variants.find(({ summary }) => summary.id === requestedId)
  if (!selected) throw new Error(`Generation model selection is no longer installed: ${requestedId}`)
  return { ...selected, variants }
}

function sameGenerationModelBinding(
  left: GenerationModelBinding | undefined,
  right: GenerationModelBinding | undefined,
) {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.fieldId === right.fieldId && left.value === right.value
}

function toolContractFingerprint(tool: GenerationToolSummary) {
  return JSON.stringify({
    acceptedInputs: [...tool.acceptedInputs],
    agentId: tool.agentId,
    delivery: tool.delivery,
    description: tool.description,
    id: tool.id,
    inputBinding: tool.inputBinding,
    kind: tool.kind,
    modelName: tool.modelName,
    output: tool.output,
    pluginId: tool.pluginId,
    pluginName: tool.pluginName,
    recovery: tool.recovery,
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

export function pluginLlmProviderHostId(pluginId: string, providerId: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error(`Invalid Plugin id: ${pluginId}`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId)) throw new Error(`Invalid LLM provider id: ${providerId}`)
  return `plugin-${pluginId}-${providerId}`
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function llmGatewayDescriptor(value: unknown) {
  if (!isUnknownRecord(value)) {
    throw new Error("Plugin LLM gateway returned an invalid descriptor")
  }
  const input = value
  if (
    Object.keys(input).length !== 3 ||
    input.schema !== "convax.llm-gateway/1" ||
    typeof input.api_key !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(input.api_key) ||
    typeof input.base_url !== "string" ||
    input.base_url.length > 2_048
  ) {
    throw new Error("Plugin LLM gateway returned an invalid descriptor")
  }
  let url: URL
  try {
    url = new URL(input.base_url)
  } catch {
    throw new Error("Plugin LLM gateway returned an invalid descriptor")
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/v1" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Plugin LLM gateway returned an invalid descriptor")
  }
  return { apiKey: input.api_key, baseUrl: url.toString().replace(/\/$/, "") }
}

function llmModelCatalog(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plugin LLM model catalog returned an invalid descriptor")
  }
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).length !== 2 ||
    input.schema !== "convax.llm-model-catalog/1" ||
    !Array.isArray(input.models) ||
    input.models.length === 0 ||
    input.models.length > maximumRuntimeLlmModels
  ) {
    throw new Error("Plugin LLM model catalog returned an invalid descriptor")
  }
  const models = input.models.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Plugin LLM model catalog entry ${index} is invalid`)
    }
    const model = value as Record<string, unknown>
    if (
      Object.keys(model).length !== 2 ||
      typeof model.id !== "string" ||
      model.id.length > 191 ||
      !llmModelIdPattern.test(model.id) ||
      typeof model.name !== "string" ||
      model.name.length === 0 ||
      model.name.length > 160 ||
      model.name.includes("\0")
    ) {
      throw new Error(`Plugin LLM model catalog entry ${index} is invalid`)
    }
    return { id: model.id, name: model.name }
  })
  if (new Set(models.map(({ id }) => id)).size !== models.length) {
    throw new Error("Plugin LLM model catalog contains duplicate ids")
  }
  return models
}

/**
 * Discovers executable contributions from installed Plugin manifests and lazily
 * executes their matching MCP tools. Generation and service surfaces share this
 * one verified process lifecycle. It intentionally contains no provider, model,
 * credential, account, or routing registry.
 */
export class GenerationPluginRuntime {
  readonly #bunRuntime?: GenerationPluginBunRuntime
  readonly #cache = new Map<string, CachedPluginRuntime>()
  readonly #canvasCapabilities?: ToolPluginCanvasCapabilityHost
  readonly #createClient: GenerationPluginMcpClientFactory
  readonly #environment: Record<string, string>
  readonly #materializeExecutable: GenerationPluginExecutableMaterializer
  readonly #platform: NodeJS.Platform
  readonly #plugins: GenerationPluginSource
  readonly #isPluginEnabled: (pluginId: string) => Promise<boolean>
  readonly #resolveManagedExecutable?: GenerationPluginManagedExecutableResolver
  readonly #resolveExecutable: GenerationPluginExecutableResolver
  readonly #recoveryStateDirectory?: string
  readonly #recoveryRuntimeStore?: GenerationRecoveryRuntimeStore
  readonly #recoveryRuntimes = new Map<string, CachedPluginRuntime>()
  readonly #starting = new Map<string, StartingPluginRuntime>()
  readonly #verifyAuthorization: GenerationPluginRuntimeOptions["verifyAuthorization"]
  readonly #workingDirectory: string
  #disposed = false

  constructor(options: GenerationPluginRuntimeOptions) {
    if (
      options.bunRuntime &&
      (!options.bunRuntime.command ||
        options.bunRuntime.command.includes("\0") ||
        (!path.isAbsolute(options.bunRuntime.command) && options.bunRuntime.command !== "bun"))
    ) {
      throw new Error("Generation Plugin Bun runtime command is invalid")
    }
    this.#bunRuntime = options.bunRuntime
    this.#plugins = options.plugins
    this.#isPluginEnabled = options.isPluginEnabled ?? (async () => true)
    this.#canvasCapabilities = options.canvasCapabilities
    this.#createClient = options.createClient ?? ((clientOptions) => new StdioMcpClient(clientOptions))
    this.#environment = generationPluginEnvironment(options.environment ?? process.env)
    this.#resolveExecutable = options.resolveExecutable ?? resolveGenerationPluginExecutable
    this.#resolveManagedExecutable = options.resolveManagedExecutable
    if (options.recoveryStateDirectory && !path.isAbsolute(options.recoveryStateDirectory)) {
      throw new Error("Generation recovery state directory must be absolute")
    }
    this.#recoveryStateDirectory = options.recoveryStateDirectory
    if (options.recoveryRuntimeDirectory && !path.isAbsolute(options.recoveryRuntimeDirectory)) {
      throw new Error("Generation recovery runtime directory must be absolute")
    }
    this.#recoveryRuntimeStore = options.recoveryRuntimeDirectory
      ? new GenerationRecoveryRuntimeStore(options.recoveryRuntimeDirectory)
      : undefined
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

  /**
   * Expands one manifest-declared model only after its owning service has been
   * admitted by Main. Unmarked tools preserve their static manifest summary.
   */
  async expandModelTool(
    expected: GenerationToolSummary,
    signal?: AbortSignal,
  ): Promise<readonly GenerationToolSummary[]> {
    return (await this.inspectModelCatalog([expected], signal)).map(({ summary }) => summary)
  }

  /**
   * Inspects every declared model family for one Plugin from one exact
   * tools/list response. The returned descriptions are safe to cache for
   * display; preparation still reloads and binds the live schema.
   */
  async inspectModelCatalog(
    expectedModels: readonly GenerationToolSummary[],
    signal?: AbortSignal,
  ): Promise<readonly InspectedGenerationModel[]> {
    if (signal?.aborted) throw abortError(signal.reason)
    if (expectedModels.length === 0) return []
    const pluginId = expectedModels[0]!.pluginId
    if (
      expectedModels.some(
        (expected) =>
          expected.kind !== "model" ||
          expected.pluginId !== pluginId ||
          expected.id !== generationPluginToolHostId(expected.pluginId, expected.toolId),
      )
    ) {
      throw new Error(`Generation model catalog request is invalid: ${pluginId}`)
    }
    const plugins = await this.#discover()
    const selectedModels = expectedModels.map((expected) => {
      const selected = this.#selectTool(plugins, expected.id)
      const declared = toolSummary(selected.plugin.manifest, selected.tool)
      if (
        selected.plugin.manifest.id !== pluginId ||
        toolContractFingerprint(declared) !== toolContractFingerprint(expected)
      ) {
        throw new Error(`Generation Plugin declaration changed before catalog inspection: ${pluginId}`)
      }
      return { expected, selected }
    })
    const selectedPlugin = selectedModels[0]!.selected.plugin
    const runtime = await this.#runtimeFor(selectedPlugin)
    let availableTools: ReadonlyMap<string, McpToolDefinition>
    try {
      availableTools = await this.#availableTools(runtime, signal, true)
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) this.#evict(runtime)
      throw error
    }
    let inspected: readonly InspectedGenerationModel[]
    try {
      inspected = selectedModels.flatMap(({ expected, selected }) => {
        const definition = availableTools.get(selected.tool.id)
        if (!definition) {
          throw new Error(`Generation Plugin ${pluginId} did not expose its declared MCP tool: ${selected.tool.id}`)
        }
        const projection = projectGenerationToolInputSchema(expected.id, definition.inputSchema)
        const resolved = resolveGenerationToolSelection(expected, expected.id, projection.modelSelector, true)
        const summaries = resolved.variants?.map(({ summary }) => summary) ?? [expected]
        return summaries.map((summary) => ({
          description: { ...projection.description, toolId: summary.id },
          summary,
        }))
      })
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) this.#evict(runtime)
      throw error
    }
    if (new Set(inspected.map(({ summary }) => summary.id)).size !== inspected.length) {
      throw new Error(`Generation Plugin model catalog contains colliding selections: ${pluginId}`)
    }
    const current = (await this.#discover()).get(pluginId)
    if (
      !current ||
      current.fingerprint !== selectedPlugin.fingerprint ||
      this.#cache.get(pluginId) !== runtime ||
      selectedModels.some(({ expected, selected }) => {
        const currentTool = current.manifest.contributes.generation?.tools.find(({ id }) => id === selected.tool.id)
        const currentDefinition = runtime.availableTools?.get(selected.tool.id)
        return (
          !currentTool ||
          !currentDefinition ||
          toolContractFingerprint(toolSummary(current.manifest, currentTool)) !== toolContractFingerprint(expected) ||
          toolDefinitionFingerprint(currentDefinition) !==
            toolDefinitionFingerprint(availableTools.get(selected.tool.id)!)
        )
      })
    ) {
      throw new Error(`Generation Plugin changed while its model catalog was listed: ${pluginId}`)
    }
    return inspected
  }

  /** Starts only declared LLM sidecars and returns Main-only OpenCode connection material. */
  async connectLlmProviders(signal?: AbortSignal): Promise<readonly PluginLlmProviderConnection[]> {
    if (signal?.aborted) throw abortError(signal.reason)
    const plugins = await this.#discover()
    const connections: PluginLlmProviderConnection[] = []
    for (const selected of plugins.values()) {
      const contribution = selected.manifest.contributes.llm
      if (!contribution) continue
      const runtime = await this.#runtimeFor(selected)
      try {
        const availableTools = await this.#availableTools(runtime, signal)
        if (!availableTools.has("llm.gateway.start")) {
          throw new Error(`Plugin LLM provider ${selected.manifest.id} did not expose llm.gateway.start`)
        }
        let models = contribution.models.map((model) => ({ ...model }))
        if (contribution.modelCatalog === "runtime") {
          if (!availableTools.has("llm.models.list")) {
            throw new Error(`Plugin LLM provider ${selected.manifest.id} did not expose llm.models.list`)
          }
          const catalogResult = await runtime.client.callTool("llm.models.list", {}, signal)
          if (catalogResult.isError) {
            throw new PluginRuntimeReportedError(`Plugin LLM model catalog failed to load: ${selected.manifest.id}`)
          }
          models = llmModelCatalog(catalogResult.structuredContent)
        }
        const current = (await this.#discover()).get(selected.manifest.id)
        if (
          !current ||
          current.fingerprint !== selected.fingerprint ||
          this.#cache.get(selected.manifest.id) !== runtime
        ) {
          throw new Error(`Plugin LLM provider changed before its gateway started: ${selected.manifest.id}`)
        }
        const result = await runtime.client.callTool("llm.gateway.start", {}, signal)
        if (result.isError) {
          throw new PluginRuntimeReportedError(`Plugin LLM gateway failed to start: ${selected.manifest.id}`)
        }
        const descriptor = llmGatewayDescriptor(result.structuredContent)
        connections.push({
          ...descriptor,
          models,
          name: contribution.provider.name,
          pluginId: selected.manifest.id,
          providerId: pluginLlmProviderHostId(selected.manifest.id, contribution.provider.id),
        })
      } catch (error) {
        // A structured MCP tool error proves the shared sidecar transport is
        // still alive. Keep it available to an in-flight service authorization
        // instead of closing the exact client that owns its one-shot completion.
        if (
          !(error instanceof PluginRuntimeReportedError) &&
          !(error instanceof Error && error.name === "AbortError")
        ) {
          this.#evict(runtime)
        }
        throw error
      }
    }
    return connections.sort(
      (left, right) => left.name.localeCompare(right.name) || left.providerId.localeCompare(right.providerId),
    )
  }

  /** Lists installed service contributions without resolving or starting their sidecars. */
  async listServices(): Promise<readonly PluginServiceSummary[]> {
    const plugins = await this.#discover()
    return [...plugins.values()]
      .filter(({ manifest }) => manifest.contributes.service !== undefined)
      .map(({ manifest }) => {
        const generationModels = (manifest.contributes.generation?.tools ?? [])
          .map((tool) => toolSummary(manifest, tool))
          .filter((tool) => tool.kind === "model")
          .map((tool) => ({
            capability: tool.output,
            id: tool.toolId,
            name: tool.modelName!,
          }))
        const llmModels = (manifest.contributes.llm?.models ?? []).map((model) => ({
          capability: "llm" as const,
          id: model.id,
          name: model.name,
        }))
        const models = [...generationModels, ...llmModels]
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

  /** Calls one host-defined service tool with a fixed bounded input; arbitrary MCP names never enter here. */
  async callService(
    pluginId: string,
    call: "status" | WebPluginServiceAction,
    signal?: AbortSignal,
    input?: { readonly planKey: string },
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
              : call === "checkout"
                ? pluginServiceMcpTools.checkout
                : pluginServiceMcpTools.signOut
    try {
      // Service status is a fixed contribution contract, so call it directly.
      // Enumerating every tool first can block on an unrelated dynamic generation
      // catalog and consume the bounded service-availability budget.
      const availableTools = call === "status" ? undefined : await this.#availableTools(runtime, signal)
      if (availableTools && !availableTools.has(toolName)) {
        throw new Error(`Plugin service ${pluginId} did not expose its fixed MCP tool: ${toolName}`)
      }
      if (signal?.aborted) throw abortError(signal.reason)
      const current = (await this.#discover()).get(pluginId)
      if (!current || current.fingerprint !== selected.fingerprint || this.#cache.get(pluginId) !== runtime) {
        throw new Error(`Plugin service changed before its action started: ${pluginId}`)
      }
      if ((call === "checkout") !== (input !== undefined)) {
        throw new Error(`Plugin service ${call} input is invalid: ${pluginId}`)
      }
      const result: PluginServiceMcpCallResult = await runtime.client.callTool(
        toolName,
        input === undefined ? {} : { plan_key: input.planKey },
        signal,
      )
      result.authorizationIdentity = runtime.authorizationIdentity
      if (
        (call === "authorize" || call === "reauthorize") &&
        availableTools?.has(pluginServiceMcpTools.completeAuthorization)
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
            const completionInput: Record<string, unknown> =
              "cookies" in input
                ? {
                    authorization_id: input.authorization_id,
                    cookie_origin: input.cookie_origin,
                    cookies: input.cookies.map(({ name, value }) => ({ name, value })),
                    schema: input.schema,
                  }
                : {
                    authorization_id: input.authorization_id,
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
      // Status is a read-only availability probe and shares the process with
      // generation/recovery. A transient probe failure must not tear down an
      // accepted LRO or an in-flight authorization hosted by that runtime.
      if (call !== "status" && !(error instanceof Error && error.name === "AbortError")) this.#evict(runtime)
      throw error
    }
  }

  async prepareTool(expected: GenerationToolSummary, signal?: AbortSignal) {
    const ready = await this.#readyTool(expected.id, signal, expected)
    return this.#prepareReadyTool(expected, ready, signal)
  }

  async #prepareReadyTool(expected: GenerationToolSummary, ready: ReadyPluginTool, signal?: AbortSignal) {
    const preparedBase: PreparedPluginTool = {
      contractFingerprint: toolContractFingerprint(expected),
      definitionFingerprint: toolDefinitionFingerprint(ready.definition),
      description: ready.description,
      hostToolId: expected.id,
      pluginFingerprint: ready.selected.plugin.fingerprint,
      pluginId: ready.selected.plugin.manifest.id,
      runtime: ready.runtime,
      ...(ready.modelBinding === undefined ? {} : { modelBinding: ready.modelBinding }),
      toolId: ready.selected.tool.id,
    }
    const recovery = await this.#prepareRecovery(expected, ready.runtime, ready.selected.plugin, preparedBase, signal)
    const prepared: PreparedPluginTool = {
      ...preparedBase,
      ...(recovery === undefined ? {} : { recovery }),
    }
    return {
      call: (
        input: Record<string, unknown>,
        callSignal?: AbortSignal,
        lifecycleObserver?: GenerationToolLifecycleObserver,
        operation?: GenerationToolOperationMetadata,
        dispatchHooks?: GenerationToolDispatchHooks,
      ) => this.#callPrepared(prepared, input, callSignal, lifecycleObserver, operation, dispatchHooks),
      ...(recovery === undefined ? {} : { recovery }),
      validateInput: (input?: GenerationToolInput) => {
        const validated = validateGenerationToolInput(ready.description, input)
        return ready.modelBinding === undefined
          ? validated
          : { ...validated, [ready.modelBinding.fieldId]: ready.modelBinding.value }
      },
    }
  }

  /**
   * Opens the immutable runtime that originally accepted an operation. This
   * path deliberately does not consult the currently installed Plugin package.
   */
  async prepareRecoveryTool(binding: GenerationRecoveryRuntimeBinding, signal?: AbortSignal) {
    if (!this.#recoveryRuntimeStore) {
      throw new Error("Pinned generation recovery runtime storage is unavailable")
    }
    const record = await this.#recoveryRuntimeStore.open(binding.executionBindingDigest)
    if (
      record.executionBindingDigest !== binding.executionBindingDigest ||
      record.pluginPackageDigest !== binding.pluginPackageDigest ||
      record.runtimeAuthorizationDigest !== binding.runtimeAuthorizationDigest ||
      record.recoveryBindingDigest !== binding.sidecarRecoveryBindingDigest ||
      record.tool.id !== binding.toolId
    ) {
      throw new Error("Pinned generation recovery runtime binding changed")
    }
    const runtime = await this.#pinnedRecoveryRuntime(record, signal)
    const capability = await runtime.client.generationRecoveryCapability?.(signal)
    if (!capability || capability.mode !== "long-running-operation") {
      throw new Error("Pinned generation recovery capability is unavailable")
    }
    const bindingDigest = createHash("sha256").update(capability.binding).digest("hex")
    if (bindingDigest !== record.recoveryBindingDigest) {
      throw new Error("Pinned generation recovery sidecar binding changed")
    }
    const recovery = this.#createRecoveryControls({
      assertCurrent: async () => {
        if (this.#recoveryRuntimes.get(record.executionBindingDigest) !== runtime) {
          throw new Error("Pinned generation recovery runtime changed")
        }
      },
      bindingDigest,
      executionBindingDigest: record.executionBindingDigest,
      pluginPackageDigest: record.pluginPackageDigest,
      runtime,
      runtimeAuthorizationDigest: record.runtimeAuthorizationDigest,
    })
    return {
      execution: {
        call: async (
          input: Record<string, unknown>,
          callSignal?: AbortSignal,
          lifecycleObserver?: GenerationToolLifecycleObserver,
          operation?: GenerationToolOperationMetadata,
        ) => {
          if (callSignal?.aborted) throw abortError(callSignal.reason)
          if (operation?.recovery !== "required") {
            throw new Error("Pinned generation replay requires exact operation metadata")
          }
          if (this.#recoveryRuntimes.get(record.executionBindingDigest) !== runtime) {
            throw new Error("Pinned generation recovery runtime changed")
          }
          return runtime.client.callTool(record.tool.toolId, input, callSignal, lifecycleObserver, false, operation)
        },
        recovery,
        validateInput: (input?: GenerationToolInput) => ({ ...input }),
      },
      tool: structuredClone(record.tool),
    }
  }

  async releaseRecoveryTool(executionBindingDigest: string) {
    if (!this.#recoveryRuntimeStore) return
    const runtime = this.#recoveryRuntimes.get(executionBindingDigest)
    if (runtime) {
      this.#recoveryRuntimes.delete(executionBindingDigest)
      this.#closeRuntime(runtime, true)
    }
    await this.#recoveryRuntimeStore.remove(executionBindingDigest)
  }

  /**
   * Lazily starts only the selected installed sidecar and returns a bounded,
   * renderer-safe projection of its current MCP input schema.
   */
  async describeTool(hostToolId: string, signal?: AbortSignal): Promise<GenerationToolDescription> {
    const ready = await this.#readyTool(hostToolId, signal)
    const current = this.#selectTool(await this.#discover(), hostToolId)
    const currentDefinition = ready.runtime.availableTools?.get(ready.selected.tool.id) ?? ready.definition
    const currentProjection = projectGenerationToolInputSchema(
      generationPluginToolHostId(current.plugin.manifest.id, current.tool.id),
      currentDefinition.inputSchema,
    )
    const currentSummary = resolveGenerationToolSelection(
      toolSummary(current.plugin.manifest, current.tool),
      hostToolId,
      currentProjection.modelSelector,
    ).summary
    if (
      current.plugin.fingerprint !== ready.selected.plugin.fingerprint ||
      toolContractFingerprint(currentSummary) !== toolContractFingerprint(ready.summary) ||
      this.#cache.get(current.plugin.manifest.id) !== ready.runtime ||
      toolDefinitionFingerprint(ready.definition) !== toolDefinitionFingerprint(currentDefinition)
    ) {
      throw new Error(`Generation Plugin changed while its tool was described: ${current.plugin.manifest.id}`)
    }
    return ready.description
  }

  /** Convenience for runtime tests and non-staging callers; production uses prepareTool().call(). */
  async callTool(
    hostToolId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    lifecycleObserver?: GenerationToolLifecycleObserver,
  ): Promise<McpToolCallResult> {
    const ready = await this.#readyTool(hostToolId, signal)
    return (await this.#prepareReadyTool(ready.summary, ready, signal)).call(input, signal, lifecycleObserver)
  }

  async #callPrepared(
    prepared: PreparedPluginTool,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    lifecycleObserver?: GenerationToolLifecycleObserver,
    operation?: GenerationToolOperationMetadata,
    dispatchHooks?: GenerationToolDispatchHooks,
  ): Promise<McpToolCallResult> {
    if (signal?.aborted) throw abortError(signal.reason)
    await this.#assertPreparedToolCurrent(prepared, "while inputs were being staged", signal, true)
    const guardedLifecycleObserver: GenerationToolLifecycleObserver | undefined =
      lifecycleObserver || dispatchHooks
        ? async (event) => {
            if (event.type === "external-started") {
              await runGenerationHostPreDispatch(dispatchHooks?.validate)
              if (signal?.aborted) throw abortError(signal.reason)
              await this.#assertPreparedToolCurrent(prepared, "before the external call", signal, true)
              await runGenerationHostPreDispatch(dispatchHooks?.guard)
              // Runtime and service checks may perform bounded IPC. Re-run the
              // caller's mutable-input guard after them so no stale Canvas
              // snapshot can cross the final write boundary.
              await runGenerationHostPreDispatch(dispatchHooks?.validate)
              if (signal?.aborted) throw abortError(signal.reason)
              await runGenerationHostPreDispatch(
                lifecycleObserver === undefined ? undefined : () => lifecycleObserver(event),
              )
              return
            }
            await lifecycleObserver?.(event)
          }
        : undefined
    let callInput = input
    if (prepared.modelBinding) {
      const { fieldId, value } = prepared.modelBinding
      if (Object.prototype.hasOwnProperty.call(input, fieldId) && input[fieldId] !== value) {
        throw new Error(`Generation tool input cannot override host-bound model selection: ${fieldId}`)
      }
      if (!Object.prototype.hasOwnProperty.call(input, fieldId)) callInput = { ...input, [fieldId]: value }
    }
    try {
      if (signal?.aborted) throw abortError(signal.reason)
      // Generation jobs may legitimately remain queued or running for hours. The
      // sidecar owns the vendor state machine and resolves only on a terminal
      // result; caller cancellation, Plugin disposal, and process exit still stop
      // this request. Service/control-plane calls retain the bounded client timeout.
      if (prepared.recovery && operation?.recovery !== "required") {
        throw new Error("Recoverable generation requires exact operation metadata")
      }
      if (!prepared.recovery && operation) {
        throw new Error("Generation operation metadata requires a recoverable tool")
      }
      return await prepared.runtime.client.callTool(
        prepared.toolId,
        callInput,
        signal,
        guardedLifecycleObserver,
        false,
        operation,
      )
    } catch (error) {
      if (
        !(error instanceof GenerationHostPreDispatchError) &&
        !(error instanceof Error && error.name === "AbortError")
      ) {
        this.#evict(prepared.runtime)
      }
      throw error instanceof GenerationHostPreDispatchError ? error.original : error
    }
  }

  async #prepareRecovery(
    expected: GenerationToolSummary,
    runtime: CachedPluginRuntime,
    plugin: DiscoveredPlugin,
    prepared: PreparedPluginTool,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationRecovery | undefined> {
    if (expected.recovery === undefined) return undefined
    if (
      expected.recovery !== "long-running-operation" ||
      !runtime.client.generationRecoveryCapability ||
      !runtime.client.callGenerationRecovery
    ) {
      throw new Error(`Generation recovery capability is unavailable: ${expected.id}`)
    }
    const capability = await runtime.client.generationRecoveryCapability(signal)
    if (!capability || capability.mode !== expected.recovery) {
      throw new Error(`Generation recovery manifest and runtime disagree: ${expected.id}`)
    }
    const pluginPackageDigest = plugin.fingerprint
    const bindingDigest = createHash("sha256").update(capability.binding).digest("hex")
    const runtimeAuthorizationDigest = createHash("sha256").update(runtime.authorizationIdentity).digest("hex")
    const toolBindingDigest = createHash("sha256")
      .update(stableJson({ binding: prepared.modelBinding ?? null, toolId: prepared.toolId }))
      .digest("hex")
    const executionBindingParts = [pluginPackageDigest, runtimeAuthorizationDigest, bindingDigest, toolBindingDigest]
    const executionBindingDigest = createHash("sha256").update(JSON.stringify(executionBindingParts)).digest("hex")
    const assertCurrent = () => this.#assertPreparedRecoveryCurrent(prepared)
    const recovery = this.#createRecoveryControls({
      assertCurrent,
      bindingDigest,
      executionBindingDigest,
      pluginPackageDigest,
      runtime,
      runtimeAuthorizationDigest,
    })
    if (this.#recoveryRuntimeStore) {
      await this.#recoveryRuntimeStore.pin({
        bindingKind: runtime.bindingKind,
        executablePath: runtime.executableSnapshot.path,
        ...(runtime.executableSnapshot.runtime === undefined
          ? {}
          : { executableRuntime: runtime.executableSnapshot.runtime }),
        executionBindingDigest,
        plugin: plugin.manifest,
        pluginPackageDigest,
        recoveryBindingDigest: bindingDigest,
        runtimeAuthorizationDigest,
        // Keep the persisted field name compatible with existing schema-1
        // records; new records bind both the base tool and optional model.
        modelBindingDigest: toolBindingDigest,
        sourceBinding: runtime.sourceBinding,
        tool: expected,
      })
    }
    return recovery
  }

  #createRecoveryControls(input: {
    assertCurrent(): Promise<void>
    bindingDigest: string
    executionBindingDigest: string
    pluginPackageDigest: string
    runtime: CachedPluginRuntime
    runtimeAuthorizationDigest: string
  }): PreparedGenerationRecovery {
    const call = async (
      method: GenerationRecoveryMethod,
      request: Omit<GenerationRecoveryRequest, "schema">,
      callSignal?: AbortSignal,
    ) => {
      await input.assertCurrent()
      return input.runtime.client.callGenerationRecovery!(method, request, callSignal)
    }
    return {
      async acknowledge(input, callSignal) {
        const result = await call(generationLroMethods.acknowledge, input, callSignal)
        if (
          !isUnknownRecord(result) ||
          Object.keys(result).length !== 2 ||
          result.schema !== "convax.generation-lro-acknowledgement/1" ||
          result.acknowledged !== true
        ) {
          throw new Error("Generation recovery acknowledgement is invalid")
        }
      },
      bindingDigest: input.bindingDigest,
      async cancel(input, callSignal) {
        return normalizeGenerationRecoverySnapshot(await call(generationLroMethods.cancel, input, callSignal))
      },
      executionBindingDigest: input.executionBindingDigest,
      async get(input, callSignal) {
        return normalizeGenerationRecoverySnapshot(await call(generationLroMethods.get, input, callSignal))
      },
      pluginPackageDigest: input.pluginPackageDigest,
      runtimeAuthorizationDigest: input.runtimeAuthorizationDigest,
      async result(input, callSignal) {
        if (!/^[a-f0-9]{64}$/.test(input.resultDigest)) {
          throw new Error("Generation recovery result digest is invalid")
        }
        const response = await call(generationLroMethods.result, input, callSignal)
        if (
          !isUnknownRecord(response) ||
          Object.keys(response).some((key) => !["result", "resultDigest", "schema"].includes(key)) ||
          response.schema !== "convax.generation-lro-result/1" ||
          response.resultDigest !== input.resultDigest
        ) {
          throw new Error("Generation recovery result is invalid")
        }
        return {
          result: normalizeMcpToolCallResult(response.result),
          resultDigest: input.resultDigest,
        }
      },
      async wait(input, callSignal) {
        return normalizeGenerationRecoverySnapshot(await call(generationLroMethods.wait, input, callSignal))
      },
    }
  }

  async #assertPreparedRecoveryCurrent(prepared: PreparedPluginTool): Promise<void> {
    const plugins = await this.#discover()
    const selected = this.#selectTool(plugins, prepared.hostToolId)
    if (
      selected.plugin.fingerprint !== prepared.pluginFingerprint ||
      selected.plugin.manifest.id !== prepared.pluginId ||
      selected.tool.id !== prepared.toolId ||
      this.#cache.get(prepared.pluginId) !== prepared.runtime
    ) {
      throw new Error(`Generation Plugin changed before recovery control: ${prepared.pluginId}`)
    }
  }

  async #assertPreparedToolCurrent(
    prepared: PreparedPluginTool,
    context: string,
    signal?: AbortSignal,
    refreshDefinition = false,
  ): Promise<void> {
    const plugins = await this.#discover()
    const selected = this.#selectTool(plugins, prepared.hostToolId)
    if (
      selected.plugin.fingerprint !== prepared.pluginFingerprint ||
      selected.plugin.manifest.id !== prepared.pluginId ||
      selected.tool.id !== prepared.toolId ||
      this.#cache.get(prepared.pluginId) !== prepared.runtime
    ) {
      throw new Error(`Generation Plugin changed ${context}: ${prepared.pluginId}`)
    }
    const currentDefinition = (
      refreshDefinition ? await this.#availableTools(prepared.runtime, signal, true) : prepared.runtime.availableTools
    )?.get(prepared.toolId)
    let currentSummary: GenerationToolSummary | undefined
    let currentBinding: GenerationModelBinding | undefined
    if (currentDefinition) {
      try {
        const baseSummary = toolSummary(selected.plugin.manifest, selected.tool)
        const projection = projectGenerationToolInputSchema(baseSummary.id, currentDefinition.inputSchema)
        const resolved = resolveGenerationToolSelection(baseSummary, prepared.hostToolId, projection.modelSelector)
        currentSummary = resolved.summary
        currentBinding = resolved.binding
      } catch {
        // The selected runtime model or its schema changed; report the same
        // bounded host error as any other prepared-tool drift.
      }
    }
    if (
      !currentSummary ||
      toolContractFingerprint(currentSummary) !== prepared.contractFingerprint ||
      !sameGenerationModelBinding(currentBinding, prepared.modelBinding) ||
      !currentDefinition ||
      toolDefinitionFingerprint(currentDefinition) !== prepared.definitionFingerprint ||
      this.#cache.get(prepared.pluginId) !== prepared.runtime
    ) {
      throw new Error(`Generation Plugin changed ${context}: ${prepared.pluginId}`)
    }
  }

  async #pinnedRecoveryRuntime(record: GenerationRecoveryRuntimeRecord, signal?: AbortSignal) {
    if (signal?.aborted) throw abortError(signal.reason)
    const cached = this.#recoveryRuntimes.get(record.executionBindingDigest)
    if (cached) return cached
    if (record.executableRuntime === "bun" && !this.#bunRuntime) {
      throw new Error("Bundled Bun runtime is unavailable")
    }
    const declaredRuntime = record.plugin.runtime!
    const recoveryStateDirectory = this.#recoveryStateDirectory
      ? await ensureGenerationRecoveryStateDirectory(
          this.#recoveryStateDirectory,
          record.plugin.id,
          record.pluginPackageDigest,
          record.runtimeAuthorizationDigest,
        )
      : undefined
    const client = this.#createClient({
      ...(record.executableRuntime === "bun"
        ? { args: [record.executablePath, ...(declaredRuntime.args ?? [])] }
        : declaredRuntime.args
          ? { args: [...declaredRuntime.args] }
          : {}),
      command: record.executableRuntime === "bun" ? this.#bunRuntime!.command : record.executablePath,
      cwd: this.#workingDirectory,
      env: {
        ...this.#environment,
        ...(record.executableRuntime === "bun" ? this.#bunRuntime?.env : {}),
        ...(recoveryStateDirectory ? { CONVAX_GENERATION_LRO_DIRECTORY: recoveryStateDirectory } : {}),
      },
    })
    const runtime: CachedPluginRuntime = {
      authorizationIdentity: record.runtimeAuthorizationDigest,
      bindingKind: record.bindingKind,
      client,
      executableSnapshot: {
        dispose() {},
        path: record.executablePath,
        ...(record.executableRuntime === undefined ? {} : { runtime: record.executableRuntime }),
      },
      fingerprint: record.pluginPackageDigest,
      plugin: structuredClone(record.plugin),
      pluginId: record.plugin.id,
      sourceBinding: structuredClone(record.sourceBinding),
    }
    this.#recoveryRuntimes.set(record.executionBindingDigest, runtime)
    try {
      const availableTools = await this.#availableTools(runtime, signal, true)
      if (!availableTools.has(record.tool.toolId)) {
        throw new Error("Pinned generation recovery runtime no longer exposes its exact tool")
      }
      return runtime
    } catch (error) {
      if (this.#recoveryRuntimes.get(record.executionBindingDigest) === runtime) {
        this.#recoveryRuntimes.delete(record.executionBindingDigest)
      }
      this.#closeRuntime(runtime)
      throw error
    }
  }

  async #readyTool(
    hostToolId: string,
    signal?: AbortSignal,
    expected?: GenerationToolSummary,
    allowUnselectedModel = false,
  ): Promise<ReadyPluginTool> {
    if (signal?.aborted) throw abortError(signal.reason)
    const plugins = await this.#discover()
    const selected = this.#selectTool(plugins, hostToolId)
    const baseSummary = toolSummary(selected.plugin.manifest, selected.tool)
    const runtime = await this.#runtimeFor(selected.plugin)
    const { definition, projection } = await (async () => {
      try {
        const availableTools = await this.#availableTools(runtime, signal, true)
        const definition = availableTools.get(selected.tool.id)
        if (!definition) {
          throw new Error(
            `Generation Plugin ${selected.plugin.manifest.id} did not expose its declared MCP tool: ${selected.tool.id}`,
          )
        }
        if (signal?.aborted) throw abortError(signal.reason)
        const projection = projectGenerationToolInputSchema(baseSummary.id, definition.inputSchema)
        if (projection.modelSelector && baseSummary.kind !== "model") {
          throw new Error(`Generation model selector is not allowed on an operation: ${baseSummary.id}`)
        }
        return {
          definition,
          projection,
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) this.#evict(runtime)
        throw error
      }
    })()
    const resolved = resolveGenerationToolSelection(
      baseSummary,
      hostToolId,
      projection.modelSelector,
      allowUnselectedModel,
    )
    if (expected && toolContractFingerprint(resolved.summary) !== toolContractFingerprint(expected)) {
      throw new Error(`Generation Plugin declaration changed before preparation: ${selected.plugin.manifest.id}`)
    }
    return {
      definition,
      description: { ...projection.description, toolId: resolved.summary.id },
      ...(resolved.binding === undefined ? {} : { modelBinding: resolved.binding }),
      runtime,
      selected,
      summary: resolved.summary,
      ...(resolved.variants === undefined ? {} : { variants: resolved.variants }),
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
    for (const runtime of this.#recoveryRuntimes.values()) this.#closeRuntime(runtime, true)
    this.#recoveryRuntimes.clear()
    rmSync(this.#workingDirectory, { force: true, recursive: true })
  }

  async #discover() {
    if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
    const discovered = new Map<string, DiscoveredPlugin>()
    const installed = await this.#plugins.list()
    if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
    for (const plugin of installed) {
      if (!isExecutablePlugin(plugin)) continue
      if (!(await this.#isPluginEnabled(plugin.id))) continue
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

  #selectTool(plugins: ReadonlyMap<string, DiscoveredPlugin>, hostToolId: string): SelectedPluginTool {
    const baseToolId = baseGenerationToolHostId(hostToolId)
    for (const plugin of plugins.values()) {
      const tool = plugin.manifest.contributes.generation?.tools.find(
        (candidate) => generationPluginToolHostId(plugin.manifest.id, candidate.id) === baseToolId,
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
    const authorizationIdentity = toolPluginAuthorizationIdentity(plugin.manifest, confirmed.kind, confirmed.binding)
    const runtimeAuthorizationDigest = createHash("sha256").update(authorizationIdentity).digest("hex")
    const recoveryStateDirectory = this.#recoveryStateDirectory
      ? await ensureGenerationRecoveryStateDirectory(
          this.#recoveryStateDirectory,
          plugin.manifest.id,
          plugin.fingerprint,
          runtimeAuthorizationDigest,
        )
      : undefined
    let canvasCapabilities: ToolPluginCanvasMcpBridge | undefined
    try {
      canvasCapabilities = await createToolPluginCanvasMcpBridge(plugin.manifest, this.#canvasCapabilities)
      if (this.#disposed || starting.canceled) {
        canvasCapabilities?.close()
        throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
      }
      if (executableSnapshot.runtime === "bun" && !this.#bunRuntime) {
        throw new Error("Bundled Bun runtime is unavailable")
      }
      const client = this.#createClient({
        ...(executableSnapshot.runtime === "bun"
          ? { args: [executableSnapshot.path, ...(declaredRuntime.args ?? [])] }
          : declaredRuntime.args
            ? { args: [...declaredRuntime.args] }
            : {}),
        command: executableSnapshot.runtime === "bun" ? this.#bunRuntime!.command : executableSnapshot.path,
        cwd: this.#workingDirectory,
        env: {
          ...this.#environment,
          ...(executableSnapshot.runtime === "bun" ? this.#bunRuntime?.env : {}),
          ...(recoveryStateDirectory ? { CONVAX_GENERATION_LRO_DIRECTORY: recoveryStateDirectory } : {}),
        },
        ...(canvasCapabilities ? { serverRequestHandler: canvasCapabilities.handler } : {}),
      })
      if (this.#disposed || starting.canceled) {
        closeQuietly(client)
        canvasCapabilities?.close()
        throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
      }
      const cached: CachedPluginRuntime = {
        authorizationIdentity,
        bindingKind: confirmed.kind,
        ...(canvasCapabilities ? { canvasCapabilities } : {}),
        client,
        executableSnapshot,
        fingerprint: plugin.fingerprint,
        plugin: structuredClone(plugin.manifest),
        pluginId: plugin.manifest.id,
        sourceBinding: structuredClone(confirmed.binding),
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
