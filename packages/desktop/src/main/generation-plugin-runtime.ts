import { createHash, randomBytes, randomUUID } from "node:crypto"
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  GenerationOutputModality,
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolSummary,
} from "../generation-contracts"
import { pluginServiceMcpTools, type PluginServiceSummary, type PluginServiceTarget } from "../plugin-service-contracts"
import {
  webPluginManifestSchemaV8,
  webPluginManifestSchemaV9,
  type ActiveInstalledWebPluginSummary,
  type InstalledWebPluginSummary,
  type WebPluginGenerationContribution,
  type WebPluginGenerationToolContribution,
  type WebPluginLlmContribution,
  type WebPluginServiceAction,
  type WebPluginServiceContribution,
} from "../plugin-contracts"
import {
  StdioMcpClient,
  type GenerationToolOperationMetadata,
  type GenerationToolLifecycleObserver,
  type McpToolCallResult,
  type McpToolDefinition,
  type PluginCapabilityToolOperationMetadata,
  type StdioMcpClientOptions,
  normalizeMcpToolCallResult,
} from "./stdio-mcp-client"
import type { PluginCapabilityExecutorPort, PluginCapabilityPluginIdentity } from "./plugin-capability-broker"
import type {
  PluginCapabilityRuntimeInspection,
  PluginCapabilityRuntimeInspectionPort,
} from "./plugin-capability-runtime-readiness"
import {
  createPluginCapabilityNestedMcpHandler,
  type PluginCapabilityNestedOperation,
} from "./plugin-capability-sidecar-bridge"
import type { PluginHostInvocationLease, PluginHostInvocationLeaseClaims } from "../plugin-host-api-main-contracts"
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
  generationRecoveryExecutionBindingDigest,
  generationRecoveryOwnerKey,
  generationRecoveryOwnerPrefix,
  type GenerationRecoveryExecutableBinding,
  type GenerationRecoveryRuntimeRecord,
} from "./generation-recovery-runtime-store"
import { pluginSnapshotCanonicalDigest } from "./plugin-installation-snapshots"
import type { PluginServiceBrowserAuthorizationCompletion } from "./plugin-service-browser-authorization"
import type { PluginServiceExternalAuthorizationCompletion } from "./plugin-service-external-authorization"
import {
  createToolPluginCanvasMcpBridge,
  toolPluginCanvasMcpMethodNames,
  type ToolPluginHostApiCapabilityHost,
  type ToolPluginCanvasMcpBridge,
} from "./tool-plugin-canvas-capabilities"
import {
  projectGenerationToolInputSchema,
  validateGenerationToolInput,
  type GenerationModelInputSelector,
} from "./generation-tool-input-schema"
import type { GenerationToolDispatchHooks, InspectedGenerationModel } from "./generation-canvas-service"
import { syncDirectoryEntry } from "./filesystem-durability"

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
  acquireActivePlugin(pluginId: string): Promise<GenerationPluginActiveHandle>
  acquirePluginSnapshot(identity: {
    activeRevision: number
    activeSetDigest: string
    pluginId: string
    pluginVersion: string
    snapshotDigest: string
  }): Promise<GenerationPluginActiveHandle>
  acquirePinnedPlugin(
    ownerKey: string,
    identity: GenerationPluginActiveHandle["identity"],
  ): Promise<GenerationPluginActiveHandle>
  assertCurrentActivePlugin(identity: GenerationPluginActiveHandle["identity"]): Promise<void>
  list(): Promise<readonly (ActiveInstalledWebPluginSummary | InstalledWebPluginSummary)[]>
  listOwnerPins(): Promise<
    readonly {
      identity: GenerationPluginActiveHandle["identity"]
      ownerKey: string
    }[]
  >
  pinActivePluginForOwner(ownerKey: string, identity: GenerationPluginActiveHandle["identity"]): Promise<unknown>
  resolveCapabilityIdentity(pluginId: string): Promise<GenerationPluginActiveIdentity | null>
  unpinPluginOwner(ownerKey: string, identity: GenerationPluginActiveHandle["identity"]): Promise<boolean>
}

export interface GenerationPluginActiveIdentity {
  activeRevision: number
  activeSetDigest: string
  digest: string
  plugin: InstalledWebPluginSummary
  snapshotDigest: string
}

export interface GenerationPluginActiveHandle {
  descriptor: {
    authorizations: {
      capabilityContractDigest: string
      companionExecutionDigest?: string
    }
    companion?: {
      entryPath: string
      mode: "convax-bun" | "native"
      sha256: string
      size: number
      target: string
    }
  }
  identity: {
    activeRevision: number
    activeSetDigest: string
    pluginId: string
    snapshotDigest: string
    version: string
  }
  /** Current ActiveSet installation incarnation; legacy v1 handles omit it. */
  installationActivationId?: string
  plugin: InstalledWebPluginSummary
  release(): void
  resolveCompanion(): Promise<string | null>
}

export interface GenerationPluginMcpClient {
  callPluginCapabilityTool?(
    name: string,
    input: Record<string, unknown>,
    operation: PluginCapabilityToolOperationMetadata,
    signal?: AbortSignal,
  ): Promise<McpToolCallResult>
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
  /** Resolves only after the owned process exits or its force-stop barrier completes. */
  closeAndWait?(force?: boolean): Promise<void>
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
  /** Main-only InstalledSnapshot identity for service authorization checkpoints. */
  snapshotDigest?: string
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
  serviceId: string
  protocol: "openai" | "openrouter"
  providerId: string
  /** Null only for a v9 top-level provider that has no Service status gate. */
  serviceTarget: PluginServiceTarget | null
}

export type GenerationPluginMcpClientFactory = (options: StdioMcpClientOptions) => GenerationPluginMcpClient
export type GenerationPluginProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface GenerationPluginExecutableBinding extends GenerationRecoveryExecutableBinding {
  path: string
}

export interface GenerationPluginExecutableSnapshot {
  dispose(): void
  path: string
  runtime?: "bun"
}

export interface GenerationPluginBunRuntime {
  command: string
  env?: Readonly<Record<string, string>>
}

export interface GenerationPluginRuntimeOptions {
  /** Trusted app-owned Bun CLI used only for companions carrying the exact convax-bun header. */
  bunRuntime?: GenerationPluginBunRuntime
  /** Optional principal-bound reverse Host API for an already-running v8 Tool sidecar. */
  canvasCapabilities?: ToolPluginHostApiCapabilityHost
  createClient?: GenerationPluginMcpClientFactory
  /** Source environment. Only the explicit host allowlist is inherited. */
  environment?: Readonly<Record<string, string | undefined>>
  /** Main-owned transport for protocol-declared loopback Provider discovery. */
  fetch?: GenerationPluginProviderFetch
  plugins: GenerationPluginSource
  /** Main-owned activation gate for source-bound Marketplace runtime capabilities. */
  isPluginEnabled?: (this: void, pluginId: string) => Promise<boolean>
  /** Exact Main-owned runtime gate; `recovering` is distinct from user disable. */
  pluginRuntimeState?: (this: void, pluginId: string) => Promise<"enabled" | "disabled" | "recovering">
  /**
   * Main-private persistent root for v9 Service profile-scoped
   * HOME/config/cache/data. The ActiveSet carries the installation incarnation;
   * exact install/profile bindings receive distinct children beneath this root.
   */
  profileStateDirectory?: string
  /**
   * Main-private root used by recovery-capable sidecars for durable operation
   * journals. A binding-scoped child is injected only into the sidecar process.
   */
  recoveryStateDirectory?: string
  /** Main-private recovery records; executable bytes remain in owner-pinned Plugin snapshots. */
  recoveryRuntimeDirectory?: string
  /** Test seam; Windows execution fails closed until the host owns a Job Object. */
  platform?: NodeJS.Platform
}

interface DiscoveredPlugin {
  /** Exact active-set/snapshot identity; unlike packageDigest, any activation change invalidates live calls. */
  fingerprint: string
  identity: PluginCapabilityPluginIdentity
  manifest: InstalledWebPluginSummary
  packageDigest: string
  /** Profile-local executable contributions projected from v8 or v9. */
  generation?: WebPluginGenerationContribution
  llm?: WebPluginLlmContribution
  service?: WebPluginServiceContribution
  serviceDescription: string
  serviceId: string
  serviceName: string
  /** v8 and v9 top-level contributions keep the historical Plugin runtime key. */
  runtimeKey: string
  runtimeArgs: readonly string[]
  topLevel: boolean
}

interface CachedPluginRuntime {
  activeHandle?: GenerationPluginActiveHandle
  authorizationIdentity: string
  availableTools?: ReadonlyMap<string, McpToolDefinition>
  canvasCapabilities?: ToolPluginCanvasMcpBridge
  client: GenerationPluginMcpClient
  capabilityGeneration: string
  capabilityOperations: Map<string, PluginCapabilityNestedOperation>
  capabilityReferences: number
  capabilityRetired: boolean
  closed: boolean
  executableSnapshot: GenerationPluginExecutableSnapshot
  fingerprint: string
  plugin: InstalledWebPluginSummary
  pluginId: string
  profileStateBinding: string
  runtimeKey: string
  serviceId: string
  sourceBinding: GenerationRecoveryExecutableBinding
  toolsRequestRevision: number
}

interface PrivatePluginProfileDirectories {
  cache: string
  config: string
  cwd: string
  data: string
  home: string
  persistent: boolean
  root: string
}

interface PluginProfileLaunchOptions extends Pick<StdioMcpClientOptions, "cwd" | "env"> {
  cleanup(): void
}

interface RetainedPluginProfileState {
  bindingIds: ReadonlySet<string>
}

interface PreparedPluginTool {
  contractFingerprint: string
  definitionFingerprint: string
  description: GenerationToolDescription
  hostToolId: string
  pluginFingerprint: string
  pluginId: string
  runtime: CachedPluginRuntime
  runtimeKey: string
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
  pluginId: string
  promise?: Promise<CachedPluginRuntime>
}

interface StartingExactPluginRuntime {
  cancel(): void
  fingerprint: string | null
  key: string
  persistent: boolean
  pluginId: string
  runtimeKey: string
  promise: Promise<CachedPluginRuntime>
  settled: boolean
  waiters: number
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
const profileStateBindingPattern = /^[a-f0-9]{64}$/
const llmModelIdPattern = /^~?[A-Za-z0-9]+(?:[._/:-][A-Za-z0-9]+)*$/
const bareCommandPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const maximumRuntimeLlmModels = 2_048
const maximumProviderModelCatalogBytes = 4 * 1_024 * 1_024

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function sameRetainedPluginProfileState(left: RetainedPluginProfileState, right: RetainedPluginProfileState) {
  return sameStringSet(left.bindingIds, right.bindingIds)
}

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

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal.reason)
}

function waitForSignal<Value>(promise: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal.reason))
  return new Promise<Value>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError(signal.reason))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void promise.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

function waitForActiveHandle(
  pending: Promise<GenerationPluginActiveHandle>,
  signal?: AbortSignal,
): Promise<GenerationPluginActiveHandle> {
  if (!signal) return pending
  if (signal.aborted) {
    void pending.then(
      (handle) => handle.release(),
      () => undefined,
    )
    return Promise.reject(abortError(signal.reason))
  }
  return new Promise<GenerationPluginActiveHandle>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      void pending.then(
        (handle) => handle.release(),
        () => undefined,
      )
      reject(abortError(signal.reason))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void pending.then(
      (handle) => {
        if (settled) {
          handle.release()
          return
        }
        settled = true
        cleanup()
        resolve(handle)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

function closeQuietly(client: GenerationPluginMcpClient, force = false) {
  try {
    client.close(force)
  } catch {
    // Disposal is best effort; one broken child must not keep the others alive.
  }
}

async function closeAndWaitQuietly(client: GenerationPluginMcpClient, force = false) {
  if (!client.closeAndWait) {
    closeQuietly(client, force)
    return
  }
  try {
    await client.closeAndWait(force)
  } catch {
    closeQuietly(client, true)
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

async function ensurePlainPrivateDirectory(directory: string, label: string) {
  let current: Awaited<ReturnType<typeof fs.lstat>>
  try {
    current = await fs.lstat(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    try {
      await fs.mkdir(directory, { mode: 0o700 })
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError
    }
    current = await fs.lstat(directory)
  }
  if (current.isSymbolicLink() || !current.isDirectory()) {
    throw new Error(`${label} must be a real directory`)
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

function isExecutablePlugin(plugin: InstalledWebPluginSummary): plugin is InstalledWebPluginSummary & {
  runtime: NonNullable<InstalledWebPluginSummary["runtime"]>
} {
  const contributions = plugin.contributes
  return (
    (plugin.schema === webPluginManifestSchemaV8 || plugin.schema === webPluginManifestSchemaV9) &&
    plugin.hostApi !== undefined &&
    plugin.runtime?.type === "mcp-stdio" &&
    (Boolean(contributions.generation?.tools.length) ||
      ("service" in contributions && contributions.service !== undefined) ||
      ("services" in contributions && Boolean(contributions.services?.length)) ||
      contributions.llm !== undefined ||
      Boolean(contributions.capabilities?.exports.length))
  )
}

function runtimeProfileKey(pluginId: string, serviceId?: string) {
  return serviceId === undefined ? pluginId : JSON.stringify([pluginId, serviceId])
}

function executableProfiles(
  manifest: InstalledWebPluginSummary & { runtime: NonNullable<InstalledWebPluginSummary["runtime"]> },
) {
  const baseArgs = [...(manifest.runtime.args ?? [])]
  const profiles: Array<
    Pick<
      DiscoveredPlugin,
      | "generation"
      | "llm"
      | "runtimeArgs"
      | "runtimeKey"
      | "service"
      | "serviceDescription"
      | "serviceId"
      | "serviceName"
      | "topLevel"
    >
  > = []
  const contributions = manifest.contributes
  const hasTopLevelRuntime =
    Boolean(contributions.generation?.tools.length) ||
    contributions.llm !== undefined ||
    Boolean(contributions.capabilities?.exports.length) ||
    ("service" in contributions && contributions.service !== undefined)
  if (hasTopLevelRuntime) {
    profiles.push({
      ...(contributions.generation === undefined ? {} : { generation: contributions.generation }),
      ...(contributions.llm === undefined ? {} : { llm: contributions.llm }),
      ...("service" in contributions && contributions.service !== undefined ? { service: contributions.service } : {}),
      runtimeArgs: baseArgs,
      runtimeKey: runtimeProfileKey(manifest.id),
      serviceDescription: manifest.description,
      serviceId: manifest.id,
      serviceName: manifest.name,
      topLevel: true,
    })
  }
  if ("services" in contributions) {
    for (const service of contributions.services ?? []) {
      profiles.push({
        ...(service.generation === undefined ? {} : { generation: service.generation }),
        ...(service.llm === undefined ? {} : { llm: service.llm }),
        service: { actions: service.actions },
        serviceDescription: service.description,
        serviceId: service.id,
        serviceName: service.name,
        runtimeArgs: [...baseArgs, ...(service.runtime.args ?? [])],
        runtimeKey: runtimeProfileKey(manifest.id, service.id),
        topLevel: false,
      })
    }
  }
  return profiles
}

function runtimeAuthorizationIdentity(
  rawIdentity: string,
  profile: Pick<DiscoveredPlugin, "runtimeArgs" | "runtimeKey" | "topLevel">,
  activationId?: string,
) {
  if (profile.topLevel) return rawIdentity
  if (!activationId || !profileStateBindingPattern.test(activationId)) {
    throw new Error("Generation Plugin Service profile activation is unavailable")
  }
  return createHash("sha256")
    .update(JSON.stringify([rawIdentity, profile.runtimeKey, profile.runtimeArgs, activationId]))
    .digest("hex")
}

function profileRuntimeAuthorizationDigest(
  rawIdentity: string,
  profile: Pick<DiscoveredPlugin, "runtimeArgs" | "runtimeKey" | "topLevel">,
  activationId?: string,
) {
  return createHash("sha256")
    .update(runtimeAuthorizationIdentity(rawIdentity, profile, activationId))
    .digest("hex")
}

function executableProfileForRecovery(plugin: InstalledWebPluginSummary, tool: GenerationToolSummary) {
  if (!isExecutablePlugin(plugin)) throw new Error("Pinned generation recovery Plugin has no executable runtime")
  const profile = executableProfiles(plugin).find(
    (candidate) =>
      candidate.serviceId === tool.serviceId &&
      candidate.generation?.tools.some(
        ({ id }) =>
          id === tool.toolId &&
          generationPluginToolHostId(plugin.id, id, candidate.topLevel ? undefined : candidate.serviceId) ===
            baseGenerationToolHostId(tool.id),
      ),
  )
  if (!profile) throw new Error("Pinned generation recovery Service profile is unavailable")
  return { ...profile, manifest: plugin }
}

function profileServiceTarget(profile: DiscoveredPlugin): PluginServiceTarget | null {
  return profile.manifest.schema === webPluginManifestSchemaV9 && profile.topLevel
    ? null
    : { pluginId: profile.manifest.id, serviceId: profile.serviceId }
}

function inventoryPluginManifest(
  plugin: ActiveInstalledWebPluginSummary | InstalledWebPluginSummary,
): InstalledWebPluginSummary {
  if (!("activeRevision" in plugin)) return plugin
  const {
    activeRevision: _activeRevision,
    activeSetDigest: _activeSetDigest,
    snapshotDigest: _snapshotDigest,
    ...manifest
  } = plugin
  return manifest as InstalledWebPluginSummary
}

function activePluginFingerprint(identity: GenerationPluginActiveIdentity) {
  if (
    !Number.isSafeInteger(identity.activeRevision) ||
    identity.activeRevision < 0 ||
    !/^[a-f0-9]{64}$/.test(identity.activeSetDigest) ||
    !/^[a-f0-9]{64}$/.test(identity.snapshotDigest) ||
    !/^[a-f0-9]{64}$/.test(identity.digest) ||
    (identity.plugin.schema !== webPluginManifestSchemaV8 && identity.plugin.schema !== webPluginManifestSchemaV9) ||
    !identity.plugin.hostApi
  ) {
    throw new Error(`Generation Plugin is not bound to a supported active immutable snapshot: ${identity.plugin.id}`)
  }
  return createHash("sha256")
    .update(
      JSON.stringify([identity.activeRevision, identity.activeSetDigest, identity.snapshotDigest, identity.digest]),
    )
    .digest("hex")
}

function activeHandleMatches(
  handle: GenerationPluginActiveHandle,
  identity: GenerationPluginActiveIdentity,
  packageDigest: string,
) {
  return (
    handle.identity.activeRevision === identity.activeRevision &&
    handle.identity.activeSetDigest === identity.activeSetDigest &&
    handle.identity.snapshotDigest === identity.snapshotDigest &&
    handle.identity.pluginId === identity.plugin.id &&
    handle.identity.version === identity.plugin.version &&
    pluginSnapshotCanonicalDigest(handle.plugin) === packageDigest
  )
}

function sameRuntimeIdentity(
  left: GenerationPluginActiveHandle["identity"],
  right: GenerationPluginActiveHandle["identity"],
) {
  return (
    left.activeRevision === right.activeRevision &&
    left.activeSetDigest === right.activeSetDigest &&
    left.pluginId === right.pluginId &&
    left.snapshotDigest === right.snapshotDigest &&
    left.version === right.version
  )
}

function pluginCapabilityRuntimeKey(identity: PluginCapabilityPluginIdentity) {
  return JSON.stringify([
    identity.activeRevision,
    identity.activeSetDigest,
    identity.pluginId,
    identity.pluginVersion,
    identity.snapshotDigest,
  ])
}

function activeHandleRuntimeKey(identity: GenerationPluginActiveHandle["identity"]) {
  return pluginCapabilityRuntimeKey({
    activeRevision: identity.activeRevision,
    activeSetDigest: identity.activeSetDigest,
    pluginId: identity.pluginId,
    pluginVersion: identity.version,
    snapshotDigest: identity.snapshotDigest,
  })
}

function toolSummary(plugin: DiscoveredPlugin, tool: WebPluginGenerationToolContribution): GenerationToolSummary {
  const model = plugin.generation?.models?.find((candidate) => candidate.tool === tool.id)
  const agent = plugin.topLevel
    ? plugin.manifest.contributes.agent?.tools?.find((candidate) => candidate.tool === tool.id)
    : undefined
  return {
    acceptedInputs: [...tool.acceptedInputs],
    ...(agent === undefined ? {} : { agentId: agent.id }),
    ...(tool.delivery === undefined ? {} : { delivery: tool.delivery }),
    description: tool.description,
    id: generationPluginToolHostId(plugin.manifest.id, tool.id, plugin.topLevel ? undefined : plugin.serviceId),
    ...(tool.inputBinding === undefined ? {} : { inputBinding: tool.inputBinding }),
    kind: model ? "model" : "operation",
    ...(model === undefined ? {} : { modelName: model.name }),
    output: tool.output,
    pluginId: plugin.manifest.id,
    pluginName: plugin.serviceName,
    serviceId: plugin.serviceId,
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
    serviceId: tool.serviceId,
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

/** v8 keeps `Plugin/tool`; v9 Service tools use `Plugin/Service/tool`. */
export function generationPluginToolHostId(pluginId: string, toolId: string, serviceId?: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error(`Invalid Plugin id: ${pluginId}`)
  if (serviceId !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serviceId)) {
    throw new Error(`Invalid Service id: ${serviceId}`)
  }
  return `${pluginId}/${serviceId === undefined ? "" : `${serviceId}/`}${requireGenerationToolId(toolId)}`
}

export function pluginLlmProviderHostId(pluginId: string, providerId: string, serviceId?: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error(`Invalid Plugin id: ${pluginId}`)
  if (serviceId !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serviceId)) {
    throw new Error(`Invalid Service id: ${serviceId}`)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId)) throw new Error(`Invalid LLM provider id: ${providerId}`)
  if (serviceId === undefined) return `plugin-${pluginId}-${providerId}`
  // Valid portable ids never contain adjacent hyphens, so the v9 separators
  // are unambiguous and cannot collide with an existing v8 provider id.
  return `plugin-${pluginId}--service-${serviceId}--provider-${providerId}`
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

function openRouterLlmModelCatalog(value: unknown) {
  if (!isUnknownRecord(value) || !Array.isArray(value.data) || value.data.length > maximumRuntimeLlmModels) {
    throw new Error("OpenRouter model catalog returned an invalid descriptor")
  }
  const models = value.data.flatMap((value, index) => {
    if (!isUnknownRecord(value) || !isUnknownRecord(value.architecture)) {
      throw new Error(`OpenRouter model catalog entry ${index} is invalid`)
    }
    const outputModalities = value.architecture.output_modalities
    if (
      !Array.isArray(outputModalities) ||
      outputModalities.length === 0 ||
      outputModalities.length > 16 ||
      outputModalities.some((modality) => typeof modality !== "string" || modality.length > 32)
    ) {
      throw new Error(`OpenRouter model catalog entry ${index} is invalid`)
    }
    if (!outputModalities.includes("text")) return []
    if (
      typeof value.id !== "string" ||
      value.id.length > 191 ||
      !llmModelIdPattern.test(value.id) ||
      typeof value.name !== "string" ||
      value.name.length === 0 ||
      value.name.length > 160 ||
      value.name.includes("\0")
    ) {
      throw new Error(`OpenRouter model catalog entry ${index} is invalid`)
    }
    return [{ id: value.id, name: value.name }]
  })
  if (models.length === 0) throw new Error("OpenRouter model catalog contains no text-output models")
  if (new Set(models.map(({ id }) => id)).size !== models.length) {
    throw new Error("OpenRouter model catalog contains duplicate ids")
  }
  return models
}

function openAiLlmModelCatalog(value: unknown, fallback: ReadonlyMap<string, string>) {
  if (
    !isUnknownRecord(value) ||
    !Array.isArray(value.data) ||
    value.data.length === 0 ||
    value.data.length > maximumRuntimeLlmModels
  ) {
    throw new Error("OpenAI model catalog returned an invalid descriptor")
  }
  const models = value.data.map((value, index) => {
    if (
      !isUnknownRecord(value) ||
      typeof value.id !== "string" ||
      value.id.length > 191 ||
      !llmModelIdPattern.test(value.id)
    ) {
      throw new Error(`OpenAI model catalog entry ${index} is invalid`)
    }
    const name = typeof value.name === "string" ? value.name : (fallback.get(value.id) ?? value.id)
    if (name.length === 0 || name.length > 160 || name.includes("\0")) {
      throw new Error(`OpenAI model catalog entry ${index} is invalid`)
    }
    return { id: value.id, name }
  })
  if (new Set(models.map(({ id }) => id)).size !== models.length) {
    throw new Error("OpenAI model catalog contains duplicate ids")
  }
  return models
}

/**
 * Discovers executable contributions from installed Plugin manifests and lazily
 * executes their matching MCP tools. Generation and service surfaces share this
 * one verified process lifecycle. It intentionally contains no provider, model,
 * credential, account, or routing registry.
 */
export class GenerationPluginRuntime implements PluginCapabilityRuntimeInspectionPort, PluginCapabilityExecutorPort {
  readonly #bunRuntime?: GenerationPluginBunRuntime
  readonly #cache = new Map<string, CachedPluginRuntime>()
  readonly #canvasCapabilities?: ToolPluginHostApiCapabilityHost
  readonly #createClient: GenerationPluginMcpClientFactory
  readonly #environment: Record<string, string>
  readonly #fetch: GenerationPluginProviderFetch
  readonly #platform: NodeJS.Platform
  readonly #plugins: GenerationPluginSource
  readonly #isPluginEnabled: (pluginId: string) => Promise<boolean>
  readonly #pluginRuntimeState: (pluginId: string) => Promise<"enabled" | "disabled" | "recovering">
  readonly #privateProfileDirectories = new Map<string, PrivatePluginProfileDirectories>()
  #profileStateMutationTail = Promise.resolve()
  #profileStateReconcileTail = Promise.resolve()
  readonly #profileStateDirectory?: string
  readonly #recoveryStateDirectory?: string
  readonly #recoveryMutations = new Map<string, Promise<void>>()
  readonly #recoveryRuntimeStore?: GenerationRecoveryRuntimeStore
  readonly #recoveryRuntimes = new Map<string, CachedPluginRuntime>()
  readonly #runtimesBySnapshot = new Map<string, CachedPluginRuntime>()
  readonly #runtimesByCapabilityGeneration = new Map<string, CachedPluginRuntime>()
  readonly #closingRuntimes = new Set<Promise<void>>()
  readonly #starting = new Map<string, StartingPluginRuntime>()
  readonly #startingByIdentity = new Map<string, StartingExactPluginRuntime>()
  readonly #workingDirectory: string
  #disposePromise?: Promise<void>
  #disposed = false
  #initialized = false
  #initializing?: Promise<void>

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
    this.#pluginRuntimeState =
      options.pluginRuntimeState ??
      (async (pluginId) => ((await this.#isPluginEnabled(pluginId)) ? "enabled" : "disabled"))
    this.#canvasCapabilities = options.canvasCapabilities
    this.#createClient = options.createClient ?? ((clientOptions) => new StdioMcpClient(clientOptions))
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#environment = generationPluginEnvironment(options.environment ?? process.env)
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
    if (options.profileStateDirectory && !path.isAbsolute(options.profileStateDirectory)) {
      throw new Error("Generation Plugin profile state directory must be absolute")
    }
    this.#profileStateDirectory = options.profileStateDirectory
      ? path.join(options.profileStateDirectory, "bindings")
      : undefined
    this.#platform = options.platform ?? process.platform
    // Never resolve commands or relative interpreter arguments from a downloaded
    // Plugin package (or the shared temp root). Each app session gets an empty,
    // private cwd owned by this runtime.
    this.#workingDirectory = mkdtempSync(path.join(os.tmpdir(), "convax-generation-runtime-"))
  }

  async #profileLaunchOptions(
    topLevel: boolean,
    profileKey: string,
    environment: Record<string, string>,
  ): Promise<PluginProfileLaunchOptions> {
    if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
    if (topLevel) return { cleanup() {}, cwd: this.#workingDirectory, env: environment }
    const directories = await this.#withProfileStateMutation(async () => {
      const existing = this.#privateProfileDirectories.get(profileKey)
      if (existing) return existing
      const persistent = this.#profileStateDirectory !== undefined
      let root: string
      if (persistent) {
        await ensurePlainPrivateDirectory(
          path.dirname(this.#profileStateDirectory!),
          "Generation Plugin profile private root",
        )
        const stateRoot = await ensurePlainPrivateDirectory(
          this.#profileStateDirectory!,
          "Generation Plugin profile state root",
        )
        root = await ensurePlainPrivateDirectory(
          path.join(stateRoot, profileKey),
          "Generation Plugin profile binding directory",
        )
      } else {
        root = mkdtempSync(path.join(os.tmpdir(), "convax-generation-profile-"))
      }
      try {
        const created = {
          cache: persistent
            ? await ensurePlainPrivateDirectory(path.join(root, "cache"), "Generation Plugin profile cache")
            : path.join(root, "cache"),
          config: persistent
            ? await ensurePlainPrivateDirectory(path.join(root, "config"), "Generation Plugin profile config")
            : path.join(root, "config"),
          cwd: persistent
            ? await ensurePlainPrivateDirectory(path.join(root, "cwd"), "Generation Plugin profile cwd")
            : path.join(root, "cwd"),
          data: persistent
            ? await ensurePlainPrivateDirectory(path.join(root, "data"), "Generation Plugin profile data")
            : path.join(root, "data"),
          home: persistent
            ? await ensurePlainPrivateDirectory(path.join(root, "home"), "Generation Plugin profile home")
            : path.join(root, "home"),
          persistent,
          root,
        }
        if (!persistent) {
          for (const directory of [created.cache, created.config, created.cwd, created.data, created.home]) {
            mkdirSync(directory, { mode: 0o700 })
          }
        }
        this.#privateProfileDirectories.set(profileKey, created)
        return created
      } catch (error) {
        if (!persistent) rmSync(root, { force: true, recursive: true })
        throw error
      }
    })
    const isolatedEnvironment = { ...environment }
    const processTemp = mkdtempSync(path.join(os.tmpdir(), "convax-generation-profile-temp-"))
    for (const key of [
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
    ]) {
      delete isolatedEnvironment[key]
    }
    if (this.#platform === "win32") {
      isolatedEnvironment.USERPROFILE = directories.home
      isolatedEnvironment.APPDATA = directories.config
      isolatedEnvironment.LOCALAPPDATA = directories.data
    } else {
      isolatedEnvironment.HOME = directories.home
      isolatedEnvironment.XDG_CONFIG_HOME = directories.config
      isolatedEnvironment.XDG_CACHE_HOME = directories.cache
      isolatedEnvironment.XDG_DATA_HOME = directories.data
    }
    isolatedEnvironment.TMPDIR = processTemp
    isolatedEnvironment.TMP = processTemp
    isolatedEnvironment.TEMP = processTemp
    return {
      cleanup() {
        rmSync(processTemp, { force: true, recursive: true })
      },
      cwd: directories.cwd,
      env: isolatedEnvironment,
    }
  }

  async #withProfileStateMutation<T>(operation: () => Promise<T>) {
    const result = this.#profileStateMutationTail.then(operation)
    this.#profileStateMutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  #removeRuntimeDirectories() {
    rmSync(this.#workingDirectory, { force: true, recursive: true })
    for (const { persistent, root } of this.#privateProfileDirectories.values()) {
      if (!persistent) rmSync(root, { force: true, recursive: true })
    }
    this.#privateProfileDirectories.clear()
  }

  /**
   * Reconciles durable recovery records with owner-scoped snapshot pins before
   * any GC or recovery resume can observe them. Missing or mismatched pins fail
   * closed; a pin left behind after record-first deletion is safely removed.
   */
  async initialize() {
    if (this.#initialized) return
    if (this.#initializing) return this.#initializing
    const operation = this.#reconcileRecoveryPins()
    this.#initializing = operation
    try {
      await operation
      this.#initialized = true
    } finally {
      if (this.#initializing === operation) this.#initializing = undefined
    }
  }

  /**
   * Removes only profile bindings no longer owned by the current ActiveSet, a
   * durable recovery record, or a still-live runtime lease. Unknown native
   * entries fail the whole pass closed before any deletion.
   */
  async reconcileProfileState() {
    const operation = this.#profileStateReconcileTail.then(() => this.#reconcileProfileState())
    this.#profileStateReconcileTail = operation.catch(() => undefined)
    return operation
  }

  async #reconcileProfileState() {
    if (!this.#profileStateDirectory || this.#disposed) return
    await this.initialize()
    while (!this.#disposed) {
      await this.#waitForProfileRuntimeTransitions()
      if (this.#disposed) return
      const completed = await this.#withProfileStateMutation(async () => {
        if (this.#hasProfileRuntimeTransitions()) return false
        const retained = await this.#retainedProfileStateBindings()
        if (this.#hasProfileRuntimeTransitions()) return false

        let root: string
        try {
          await ensurePlainPrivateDirectory(
            path.dirname(this.#profileStateDirectory!),
            "Generation Plugin profile private root",
          )
          root = await ensurePlainPrivateDirectory(this.#profileStateDirectory!, "Generation Plugin profile state root")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
          throw error
        }
        const entries = await fs.readdir(root, { withFileTypes: true })
        if (
          entries.some(
            (entry) => entry.isSymbolicLink() || !entry.isDirectory() || !profileStateBindingPattern.test(entry.name),
          )
        ) {
          throw new Error("Generation Plugin profile state root contains an invalid entry")
        }
        const stale = entries.filter((entry) => !retained.bindingIds.has(entry.name))
        for (const entry of stale) {
          const target = path.join(root, entry.name)
          const [stat, real] = await Promise.all([fs.lstat(target), fs.realpath(target)])
          if (stat.isSymbolicLink() || !stat.isDirectory() || real !== target) {
            throw new Error("Generation Plugin profile state binding must be a contained real directory")
          }
        }
        // Re-read every durable/live owner after the asynchronous native checks.
        // No profile may launch while this mutation is held; the final check and
        // synchronous deletion therefore form one race-free commit.
        const confirmed = await this.#retainedProfileStateBindings()
        if (this.#hasProfileRuntimeTransitions() || !sameRetainedPluginProfileState(retained, confirmed)) return false
        for (const entry of stale) {
          const target = path.join(root, entry.name)
          const stat = lstatSync(target)
          if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(target) !== target) {
            throw new Error("Generation Plugin profile state binding must be a contained real directory")
          }
          rmSync(target, { force: true, recursive: true })
          this.#privateProfileDirectories.delete(entry.name)
        }
        if (stale.length > 0) await syncDirectoryEntry(root)
        return true
      })
      if (completed) return
    }
  }

  #hasProfileRuntimeTransitions() {
    return this.#starting.size > 0 || this.#startingByIdentity.size > 0 || this.#closingRuntimes.size > 0
  }

  async #waitForProfileRuntimeTransitions() {
    while (this.#hasProfileRuntimeTransitions()) {
      const pending = [
        ...[...this.#starting.values()].flatMap(({ promise }) => (promise ? [promise] : [])),
        ...[...this.#startingByIdentity.values()].map(({ promise }) => promise),
        ...this.#closingRuntimes,
      ]
      if (pending.length === 0) break
      await Promise.allSettled(pending)
      if (this.#disposed) return
    }
  }

  async #retainedProfileStateBindings() {
    const bindingIds = new Set<string>()
    const installed = await this.#plugins.list()
    const installedIds = new Set<string>()
    for (const inventoryPlugin of installed) {
      const plugin = inventoryPluginManifest(inventoryPlugin)
      if (plugin.schema !== webPluginManifestSchemaV9 || !isExecutablePlugin(plugin)) continue
      if (installedIds.has(plugin.id)) throw new Error(`Duplicate installed Plugin id: ${plugin.id}`)
      installedIds.add(plugin.id)
      const profiles = executableProfiles(plugin).filter((profile) => !profile.topLevel)
      if (profiles.length === 0) continue
      const handle = await this.#plugins.acquireActivePlugin(plugin.id)
      try {
        if (
          handle.plugin.id !== plugin.id ||
          handle.plugin.version !== plugin.version ||
          pluginSnapshotCanonicalDigest(handle.plugin) !== pluginSnapshotCanonicalDigest(plugin)
        ) {
          throw new Error(`Generation Plugin active identity changed during profile state reconciliation: ${plugin.id}`)
        }
        const rawIdentity = handle.descriptor.authorizations.companionExecutionDigest
        if (!rawIdentity) continue
        if (!profileStateBindingPattern.test(rawIdentity)) {
          throw new Error(`Generation Plugin companion authorization is invalid: ${plugin.id}`)
        }
        const activationId = handle.installationActivationId
        if (!activationId || !profileStateBindingPattern.test(activationId)) {
          throw new Error(`Generation Plugin ActiveSet activation is unavailable: ${plugin.id}`)
        }
        for (const profile of profiles) {
          bindingIds.add(profileRuntimeAuthorizationDigest(rawIdentity, profile, activationId))
        }
      } finally {
        handle.release()
      }
    }
    for (const record of (await this.#recoveryRuntimeStore?.list()) ?? []) {
      bindingIds.add(record.runtimeAuthorizationDigest)
    }
    for (const runtime of new Set([
      ...this.#cache.values(),
      ...this.#runtimesByCapabilityGeneration.values(),
      ...this.#recoveryRuntimes.values(),
    ])) {
      if (runtime.plugin.schema === webPluginManifestSchemaV9 && runtime.serviceId !== runtime.pluginId) {
        bindingIds.add(runtime.profileStateBinding)
      }
    }
    return { bindingIds }
  }

  async listTools(options: { output?: GenerationOutputModality } = {}): Promise<readonly GenerationToolSummary[]> {
    const plugins = await this.#discover()
    return [...plugins.values()]
      .flatMap((profile) =>
        (profile.generation?.tools ?? [])
          .filter((tool) => options.output === undefined || tool.output === options.output)
          .map((tool) => toolSummary(profile, tool)),
      )
      .sort(
        (left, right) =>
          left.pluginName.localeCompare(right.pluginName) ||
          left.pluginId.localeCompare(right.pluginId) ||
          left.title.localeCompare(right.title) ||
          left.toolId.localeCompare(right.toolId),
      )
  }

  /** Resolves the exact live Service status gate for one installed tool profile. */
  async serviceStatusTarget(tool: GenerationToolSummary): Promise<PluginServiceTarget | null> {
    const selected = this.#selectTool(await this.#discover(), tool.id)
    if (
      selected.plugin.manifest.id !== tool.pluginId ||
      selected.plugin.serviceId !== tool.serviceId ||
      selected.tool.id !== tool.toolId
    ) {
      throw new Error(`Generation tool Service scope changed: ${tool.id}`)
    }
    return profileServiceTarget(selected.plugin)
  }

  /**
   * Expands one installed manifest-declared model from the current sidecar
   * schema. Service status is checked at preparation and dispatch, not discovery.
   * Unmarked tools preserve their static manifest summary.
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
          (expected.id !== generationPluginToolHostId(expected.pluginId, expected.toolId) &&
            expected.id !== generationPluginToolHostId(expected.pluginId, expected.toolId, expected.serviceId)),
      )
    ) {
      throw new Error(`Generation model catalog request is invalid: ${pluginId}`)
    }
    const plugins = await this.#discover()
    const selectedModels = expectedModels.map((expected) => {
      const selected = this.#selectTool(plugins, expected.id)
      const declared = toolSummary(selected.plugin, selected.tool)
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
    // Catalog inspection is a read-only display probe. A dynamic catalog can
    // be unavailable until the same shared sidecar completes authorization;
    // retiring it here would close that in-flight browser authorization.
    const availableTools = await this.#availableTools(runtime, signal, true)
    // Keep projection failures isolated to this catalog refresh. Preparation
    // revalidates the exact tool schema before any generation call.
    const inspected: readonly InspectedGenerationModel[] = selectedModels.flatMap(({ expected, selected }) => {
      const definition = availableTools.get(selected.tool.id)
      if (!definition) {
        if (selected.plugin.service !== undefined) return []
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
    if (new Set(inspected.map(({ summary }) => summary.id)).size !== inspected.length) {
      throw new Error(`Generation Plugin model catalog contains colliding selections: ${pluginId}`)
    }
    const current = (await this.#discover()).get(selectedPlugin.runtimeKey)
    if (
      !current ||
      current.fingerprint !== selectedPlugin.fingerprint ||
      this.#cache.get(selectedPlugin.runtimeKey) !== runtime ||
      selectedModels.some(({ expected, selected }) => {
        const currentTool = current.generation?.tools.find(({ id }) => id === selected.tool.id)
        const currentDefinition = runtime.availableTools?.get(selected.tool.id)
        const observedDefinition = availableTools.get(selected.tool.id)
        if (!currentTool) return true
        if (!currentDefinition || !observedDefinition) {
          return currentDefinition !== observedDefinition || current.service === undefined
        }
        return (
          toolContractFingerprint(toolSummary(current, currentTool)) !== toolContractFingerprint(expected) ||
          toolDefinitionFingerprint(currentDefinition) !== toolDefinitionFingerprint(observedDefinition)
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
    const failures: unknown[] = []
    const llmProfiles = [...plugins.values()].filter((profile) => profile.llm !== undefined)
    for (const selected of llmProfiles) {
      const contribution = selected.llm
      if (!contribution) continue
      let runtime: CachedPluginRuntime | undefined
      try {
        runtime = await this.#runtimeFor(selected)
        const availableTools = await this.#availableTools(runtime, signal)
        if (!availableTools.has("llm.gateway.start")) {
          throw new Error(`Plugin LLM provider ${selected.manifest.id} did not expose llm.gateway.start`)
        }
        const current = (await this.#discover()).get(selected.runtimeKey)
        if (
          !current ||
          current.fingerprint !== selected.fingerprint ||
          this.#cache.get(selected.runtimeKey) !== runtime
        ) {
          throw new Error(`Plugin LLM provider changed before its gateway started: ${selected.manifest.id}`)
        }
        const result = await runtime.client.callTool("llm.gateway.start", {}, signal)
        if (result.isError) {
          throw new PluginRuntimeReportedError(`Plugin LLM gateway failed to start: ${selected.manifest.id}`)
        }
        const descriptor = llmGatewayDescriptor(result.structuredContent)
        const url = new URL(`${descriptor.baseUrl}/models`)
        if (contribution.provider.protocol === "openrouter") {
          url.searchParams.set("output_modalities", "text")
        }
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000)
        const response = await this.#fetch(url, {
          headers: { authorization: `Bearer ${descriptor.apiKey}` },
          signal: requestSignal,
        })
        if (!response.ok) {
          const protocolName = contribution.provider.protocol === "openrouter" ? "OpenRouter" : "OpenAI"
          throw new PluginRuntimeReportedError(`${protocolName} model catalog failed with HTTP ${response.status}`)
        }
        const declared = Number(response.headers.get("content-length") ?? 0)
        if (Number.isFinite(declared) && declared > maximumProviderModelCatalogBytes) {
          throw new Error("Provider model catalog response is too large")
        }
        const serialized = await response.text()
        if (new TextEncoder().encode(serialized).byteLength > maximumProviderModelCatalogBytes) {
          throw new Error("Provider model catalog response is too large")
        }
        let catalog: unknown
        try {
          catalog = JSON.parse(serialized) as unknown
        } catch {
          throw new Error("Provider model catalog response is invalid")
        }
        const models =
          contribution.provider.protocol === "openrouter"
            ? openRouterLlmModelCatalog(catalog)
            : openAiLlmModelCatalog(catalog, new Map(contribution.models.map((model) => [model.id, model.name])))
        const latest = (await this.#discover()).get(selected.runtimeKey)
        if (
          !latest ||
          latest.fingerprint !== selected.fingerprint ||
          this.#cache.get(selected.runtimeKey) !== runtime
        ) {
          throw new Error(`Plugin LLM provider changed while its model catalog was listed: ${selected.manifest.id}`)
        }
        connections.push({
          ...descriptor,
          models,
          name: contribution.provider.name,
          pluginId: selected.manifest.id,
          protocol: contribution.provider.protocol,
          providerId: pluginLlmProviderHostId(
            selected.manifest.id,
            contribution.provider.id,
            selected.topLevel ? undefined : selected.serviceId,
          ),
          serviceId: selected.serviceId,
          serviceTarget: profileServiceTarget(selected),
        })
      } catch (error) {
        // A structured MCP tool error proves the shared sidecar transport is
        // still alive. Keep it available to an in-flight service authorization
        // instead of closing the exact client that owns its one-shot completion.
        if (
          runtime &&
          !(error instanceof PluginRuntimeReportedError) &&
          !(error instanceof Error && error.name === "AbortError")
        ) {
          this.#evict(runtime)
        }
        if (this.#disposed) throw error
        if (signal?.aborted) throw abortError(signal.reason)
        if (selected.manifest.schema === webPluginManifestSchemaV8) throw error
        failures.push(error)
      }
    }
    if (signal?.aborted) throw abortError(signal.reason)
    const latestProfiles = await this.#discover()
    if (llmProfiles.some((profile) => latestProfiles.get(profile.runtimeKey)?.fingerprint !== profile.fingerprint)) {
      throw new Error("Installed Plugin LLM providers changed while their catalogs were listed")
    }
    if (connections.length === 0 && failures.length > 0) throw failures[0]
    return connections.sort(
      (left, right) => left.name.localeCompare(right.name) || left.providerId.localeCompare(right.providerId),
    )
  }

  /** Lists installed service contributions without resolving or starting their sidecars. */
  async listServices(): Promise<readonly PluginServiceSummary[]> {
    const plugins = await this.#discover()
    return [...plugins.values()]
      .filter((profile) => profile.service !== undefined)
      .map((profile) => {
        const generationModels = (profile.generation?.tools ?? [])
          .map((tool) => toolSummary(profile, tool))
          .filter((tool) => tool.kind === "model")
          .map((tool) => ({
            capability: tool.output,
            id: tool.toolId,
            name: tool.modelName!,
          }))
        const llmModels = (profile.llm?.models ?? []).map((model) => ({
          capability: "llm" as const,
          id: model.id,
          name: model.name,
        }))
        const models = [...generationModels, ...llmModels]
        return {
          actions: [...profile.service!.actions],
          capabilities: [...new Set(models.map((model) => model.capability))],
          description: profile.serviceDescription,
          llmProviderIds: profile.llm
            ? [
                pluginLlmProviderHostId(
                  profile.manifest.id,
                  profile.llm.provider.id,
                  profile.topLevel ? undefined : profile.serviceId,
                ),
              ]
            : [],
          models,
          pluginId: profile.manifest.id,
          pluginName: profile.serviceName,
          serviceId: profile.serviceId,
          version: profile.manifest.version,
        }
      })
      .sort(
        (left, right) =>
          left.pluginName.localeCompare(right.pluginName) ||
          left.pluginId.localeCompare(right.pluginId) ||
          left.serviceId.localeCompare(right.serviceId),
      )
  }

  /** Calls one host-defined service tool with a fixed bounded input; arbitrary MCP names never enter here. */
  async callService(
    pluginId: string,
    call: "status" | "usage" | WebPluginServiceAction,
    signal?: AbortSignal,
    input?: { readonly planKey: string },
  ): Promise<PluginServiceMcpCallResult>
  async callService(
    target: { readonly pluginId: string; readonly serviceId: string },
    call: "status" | "usage" | WebPluginServiceAction,
    signal?: AbortSignal,
    input?: { readonly planKey: string },
  ): Promise<PluginServiceMcpCallResult>
  async callService(
    targetInput: string | { readonly pluginId: string; readonly serviceId: string },
    call: "status" | "usage" | WebPluginServiceAction,
    signal?: AbortSignal,
    input?: { readonly planKey: string },
  ): Promise<PluginServiceMcpCallResult> {
    if (signal?.aborted) throw abortError(signal.reason)
    const target = typeof targetInput === "string" ? { pluginId: targetInput, serviceId: targetInput } : targetInput
    const plugins = await this.#discover()
    const selected = this.#selectService(plugins, target)
    const serviceLabel = `${target.pluginId}/${target.serviceId}`
    if (call !== "status" && call !== "usage" && !selected.service!.actions.includes(call)) {
      throw new Error(`Plugin service action is not declared: ${serviceLabel}`)
    }
    const runtime = await this.#runtimeFor(selected)
    const toolName =
      call === "status"
        ? pluginServiceMcpTools.status
        : call === "usage"
          ? pluginServiceMcpTools.usage
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
      const availableTools =
        call === "status" || call === "usage" ? undefined : await this.#availableTools(runtime, signal)
      if (availableTools && !availableTools.has(toolName)) {
        throw new Error(`Plugin service ${serviceLabel} did not expose its fixed MCP tool: ${toolName}`)
      }
      if (signal?.aborted) throw abortError(signal.reason)
      const current = (await this.#discover()).get(selected.runtimeKey)
      if (
        !current ||
        current.fingerprint !== selected.fingerprint ||
        this.#cache.get(selected.runtimeKey) !== runtime
      ) {
        throw new Error(`Plugin service changed before its action started: ${serviceLabel}`)
      }
      if ((call === "checkout") !== (input !== undefined)) {
        throw new Error(`Plugin service ${call} input is invalid: ${serviceLabel}`)
      }
      const result: PluginServiceMcpCallResult = await runtime.client.callTool(
        toolName,
        input === undefined ? {} : { plan_key: input.planKey },
        signal,
      )
      result.authorizationIdentity = runtime.authorizationIdentity
      result.snapshotDigest = runtime.activeHandle?.identity.snapshotDigest
      if (
        (call === "authorize" || call === "reauthorize") &&
        availableTools?.has(pluginServiceMcpTools.completeAuthorization)
      ) {
        let completionStarted = false
        result.completeAuthorization = async (input, completionSignal) => {
          if (completionStarted)
            throw new Error(`Plugin service authorization completion was already used: ${serviceLabel}`)
          completionStarted = true
          if (completionSignal?.aborted) throw abortError(completionSignal.reason)
          const current = (await this.#discover()).get(selected.runtimeKey)
          if (
            !current ||
            current.fingerprint !== selected.fingerprint ||
            this.#cache.get(selected.runtimeKey) !== runtime
          ) {
            throw new Error(`Plugin service changed before browser authorization completed: ${serviceLabel}`)
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
      if (call !== "status" && call !== "usage" && !(error instanceof Error && error.name === "AbortError"))
        this.#evict(runtime)
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
      runtimeKey: ready.selected.plugin.runtimeKey,
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
    await this.initialize()
    return this.#withRecoveryMutation(binding.executionBindingDigest, () =>
      this.#prepareRecoveryToolLocked(binding, signal),
    )
  }

  async #prepareRecoveryToolLocked(binding: GenerationRecoveryRuntimeBinding, signal?: AbortSignal) {
    if (signal?.aborted) throw abortError(signal.reason)
    const record = await this.#recoveryRuntimeStore!.open(binding.executionBindingDigest)
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
    await this.initialize()
    await this.#withRecoveryMutation(executionBindingDigest, async () => {
      const runtime = this.#recoveryRuntimes.get(executionBindingDigest)
      if (runtime) {
        this.#recoveryRuntimes.delete(executionBindingDigest)
        this.#closeRuntime(runtime, true)
      }
      let record: GenerationRecoveryRuntimeRecord
      try {
        record = await this.#recoveryRuntimeStore!.open(executionBindingDigest)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
      }
      // Record-first deletion is the crash-safe order: a crash after this point
      // leaves an orphan owner pin that startup reconciliation can remove.
      await this.#recoveryRuntimeStore!.remove(executionBindingDigest)
      if (
        !(await this.#plugins.unpinPluginOwner(
          generationRecoveryOwnerKey(executionBindingDigest),
          record.pluginIdentity,
        ))
      ) {
        throw new Error("Generation recovery snapshot owner disappeared before release")
      }
    })
    await this.reconcileProfileState()
  }

  /**
   * Lazily starts only the selected installed sidecar and returns a bounded,
   * renderer-safe projection of its current MCP input schema.
   */
  async describeTool(hostToolId: string, signal?: AbortSignal): Promise<GenerationToolDescription> {
    const ready = await this.#readyTool(hostToolId, signal)
    const current = this.#selectTool(await this.#discover(), hostToolId)
    const currentDefinition = ready.runtime.availableTools?.get(ready.selected.tool.id) ?? ready.definition
    const currentBaseSummary = toolSummary(current.plugin, current.tool)
    const currentProjection = projectGenerationToolInputSchema(currentBaseSummary.id, currentDefinition.inputSchema)
    const currentSummary = resolveGenerationToolSelection(
      currentBaseSummary,
      hostToolId,
      currentProjection.modelSelector,
    ).summary
    if (
      current.plugin.fingerprint !== ready.selected.plugin.fingerprint ||
      toolContractFingerprint(currentSummary) !== toolContractFingerprint(ready.summary) ||
      this.#cache.get(current.plugin.runtimeKey) !== ready.runtime ||
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
    const pluginPackageDigest = plugin.packageDigest
    const bindingDigest = createHash("sha256").update(capability.binding).digest("hex")
    const runtimeAuthorizationDigest = runtime.profileStateBinding
    const toolBindingDigest = createHash("sha256")
      .update(stableJson({ binding: prepared.modelBinding ?? null, toolId: prepared.toolId }))
      .digest("hex")
    const activeHandle = runtime.activeHandle
    if (!activeHandle) {
      throw new Error(`Generation recovery requires an active snapshot lease: ${expected.id}`)
    }
    const executionBindingDigest = generationRecoveryExecutionBindingDigest({
      pluginIdentity: activeHandle.identity,
      pluginPackageDigest,
      recoveryBindingDigest: bindingDigest,
      runtimeAuthorizationDigest,
      sourceBinding: runtime.sourceBinding,
      toolBindingDigest,
    })
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
      await this.initialize()
      await this.#withRecoveryMutation(executionBindingDigest, async () => {
        const ownerKey = generationRecoveryOwnerKey(executionBindingDigest)
        const existingPin = (await this.#plugins.listOwnerPins()).find((pin) => pin.ownerKey === ownerKey)
        let createdPin = false
        if (existingPin) {
          if (!sameRuntimeIdentity(existingPin.identity, activeHandle.identity)) {
            throw new Error(`Generation recovery snapshot owner is bound to another identity: ${expected.id}`)
          }
        } else {
          await this.#plugins.pinActivePluginForOwner(ownerKey, activeHandle.identity)
          createdPin = true
        }
        try {
          await this.#recoveryRuntimeStore!.pin({
            executionBindingDigest,
            plugin: plugin.manifest,
            pluginIdentity: activeHandle.identity,
            pluginPackageDigest,
            recoveryBindingDigest: bindingDigest,
            runtimeAuthorizationDigest,
            sourceBinding: runtime.sourceBinding,
            tool: expected,
            toolBindingDigest,
          })
        } catch (error) {
          if (createdPin) {
            try {
              await this.#plugins.unpinPluginOwner(ownerKey, activeHandle.identity)
            } catch (rollbackError) {
              throw new AggregateError(
                [error, rollbackError],
                "Generation recovery publication and snapshot-pin rollback failed",
                { cause: error },
              )
            }
          }
          throw error
        }
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
      this.#cache.get(prepared.runtimeKey) !== prepared.runtime
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
      this.#cache.get(prepared.runtimeKey) !== prepared.runtime
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
        const baseSummary = toolSummary(selected.plugin, selected.tool)
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
      this.#cache.get(prepared.runtimeKey) !== prepared.runtime
    ) {
      throw new Error(`Generation Plugin changed ${context}: ${prepared.pluginId}`)
    }
  }

  async #pinnedRecoveryRuntime(record: GenerationRecoveryRuntimeRecord, signal?: AbortSignal) {
    if (signal?.aborted) throw abortError(signal.reason)
    const cached = this.#recoveryRuntimes.get(record.executionBindingDigest)
    if (cached) return cached
    const ownerKey = generationRecoveryOwnerKey(record.executionBindingDigest)
    const activeHandle = await this.#plugins.acquirePinnedPlugin(ownerKey, record.pluginIdentity)
    let cleanupProfileLaunch = () => {}
    try {
      if (
        pluginSnapshotCanonicalDigest(activeHandle.plugin) !== record.pluginPackageDigest ||
        activeHandle.plugin.id !== record.plugin.id ||
        activeHandle.plugin.version !== record.plugin.version ||
        activeHandle.descriptor.companion?.sha256 !== record.sourceBinding.sha256 ||
        activeHandle.descriptor.companion?.size !== record.sourceBinding.size ||
        (activeHandle.descriptor.companion?.mode === "convax-bun" ? "bun" : undefined) !== record.sourceBinding.runtime
      ) {
        throw new Error("Pinned generation recovery snapshot binding changed")
      }
      const profile = executableProfileForRecovery(record.plugin, record.tool)
      const rawAuthorizationIdentity = activeHandle.descriptor.authorizations.companionExecutionDigest
      if (
        !rawAuthorizationIdentity ||
        !profileStateBindingPattern.test(rawAuthorizationIdentity) ||
        (profile.topLevel &&
          profileRuntimeAuthorizationDigest(rawAuthorizationIdentity, profile) !== record.runtimeAuthorizationDigest)
      ) {
        throw new Error("Pinned generation recovery authorization changed")
      }
      // The owner-pinned snapshot proves the immutable companion authorization.
      // The record's execution digest separately binds the old activation-scoped
      // profile directory, so recovery never consults a new install's activation.
      const authorizationIdentity = rawAuthorizationIdentity
      const executablePath = await activeHandle.resolveCompanion()
      if (!executablePath || !path.isAbsolute(executablePath)) {
        throw new Error("Pinned generation recovery companion is unavailable")
      }
      if (record.sourceBinding.runtime === "bun" && !this.#bunRuntime) {
        throw new Error("Bundled Bun runtime is unavailable")
      }
      const recoveryStateDirectory = this.#recoveryStateDirectory
        ? await ensureGenerationRecoveryStateDirectory(
            this.#recoveryStateDirectory,
            record.plugin.id,
            record.pluginPackageDigest,
            record.runtimeAuthorizationDigest,
          )
        : undefined
      const { cleanup, ...launchOptions } = await this.#profileLaunchOptions(
        profile.topLevel,
        record.runtimeAuthorizationDigest,
        {
          ...this.#environment,
          ...(record.sourceBinding.runtime === "bun" ? this.#bunRuntime?.env : {}),
          ...(recoveryStateDirectory ? { CONVAX_GENERATION_LRO_DIRECTORY: recoveryStateDirectory } : {}),
        },
      )
      cleanupProfileLaunch = cleanup
      const client = this.#createClient({
        ...(record.sourceBinding.runtime === "bun"
          ? { args: [executablePath, ...profile.runtimeArgs] }
          : profile.runtimeArgs.length
            ? { args: [...profile.runtimeArgs] }
            : {}),
        command: record.sourceBinding.runtime === "bun" ? this.#bunRuntime!.command : executablePath,
        ...launchOptions,
      })
      const runtime: CachedPluginRuntime = {
        activeHandle,
        authorizationIdentity,
        capabilityGeneration: randomUUID(),
        capabilityOperations: new Map(),
        capabilityReferences: 0,
        capabilityRetired: false,
        closed: false,
        client,
        executableSnapshot: {
          dispose: cleanupProfileLaunch,
          path: executablePath,
          ...(record.sourceBinding.runtime === undefined ? {} : { runtime: record.sourceBinding.runtime }),
        },
        fingerprint: record.pluginPackageDigest,
        plugin: structuredClone(record.plugin),
        pluginId: record.plugin.id,
        profileStateBinding: record.runtimeAuthorizationDigest,
        runtimeKey: profile.runtimeKey,
        serviceId: profile.serviceId,
        sourceBinding: structuredClone(record.sourceBinding),
        toolsRequestRevision: 0,
      }
      this.#recoveryRuntimes.set(record.executionBindingDigest, runtime)
      const availableTools = await this.#availableTools(runtime, signal, true)
      if (!availableTools.has(record.tool.toolId)) {
        throw new Error("Pinned generation recovery runtime no longer exposes its exact tool")
      }
      return runtime
    } catch (error) {
      const runtime = this.#recoveryRuntimes.get(record.executionBindingDigest)
      if (runtime?.activeHandle === activeHandle) {
        this.#recoveryRuntimes.delete(record.executionBindingDigest)
        this.#closeRuntime(runtime)
      } else {
        cleanupProfileLaunch()
        activeHandle.release()
      }
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
    const baseSummary = toolSummary(selected.plugin, selected.tool)
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

  disposePlugin(pluginId: string, options: { force?: boolean } = {}) {
    let disposed = false
    for (const [runtimeKey, starting] of this.#starting) {
      if (starting.pluginId !== pluginId) continue
      starting.canceled = true
      this.#starting.delete(runtimeKey)
      disposed = true
    }
    for (const starting of this.#startingByIdentity.values()) {
      if (starting.pluginId !== pluginId) continue
      starting.cancel()
      disposed = true
    }
    for (const [runtimeKey, runtime] of this.#cache) {
      if (runtime.pluginId !== pluginId) continue
      this.#cache.delete(runtimeKey)
      if (options.force) this.#closeRuntime(runtime, true)
      else this.#retireRuntime(runtime)
      disposed = true
    }
    return disposed
  }

  async disposePluginAndWait(pluginId: string) {
    const priorClosures = new Set(this.#closingRuntimes)
    const disposed = this.disposePlugin(pluginId, { force: true })
    const closures = [...this.#closingRuntimes].filter((closing) => !priorClosures.has(closing))
    if (closures.length > 0) await Promise.allSettled(closures)
    return disposed
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const starting of this.#starting.values()) starting.canceled = true
    this.#starting.clear()
    const startingPromises = [...new Set([...this.#startingByIdentity.values()].map(({ promise }) => promise))]
    for (const starting of this.#startingByIdentity.values()) starting.cancel()
    this.#startingByIdentity.clear()
    for (const runtime of new Set([...this.#cache.values(), ...this.#runtimesBySnapshot.values()])) {
      this.#closeRuntime(runtime, true)
    }
    this.#cache.clear()
    this.#runtimesBySnapshot.clear()
    this.#runtimesByCapabilityGeneration.clear()
    for (const runtime of this.#recoveryRuntimes.values()) this.#closeRuntime(runtime, true)
    this.#recoveryRuntimes.clear()
    const closing = [...this.#closingRuntimes]
    if (closing.length === 0 && startingPromises.length === 0) {
      this.#removeRuntimeDirectories()
      this.#disposePromise = Promise.resolve()
    } else {
      this.#disposePromise = Promise.allSettled([...startingPromises, ...closing]).then(async () => {
        await Promise.allSettled(this.#closingRuntimes)
        this.#removeRuntimeDirectories()
      })
    }
  }

  async disposeAndWait() {
    this.dispose()
    await this.#disposePromise
  }

  async inspect(
    provider: PluginCapabilityPluginIdentity,
    signal?: AbortSignal,
  ): Promise<PluginCapabilityRuntimeInspection> {
    if (this.#disposed) return { state: "recovering" }
    throwIfAborted(signal)
    try {
      const handle = await waitForActiveHandle(
        this.#plugins.acquirePluginSnapshot({
          activeRevision: provider.activeRevision,
          activeSetDigest: provider.activeSetDigest,
          pluginId: provider.pluginId,
          pluginVersion: provider.pluginVersion,
          snapshotDigest: provider.snapshotDigest,
        }),
        signal,
      )
      let handleOwned = true
      const current = await waitForSignal(this.#plugins.resolveCapabilityIdentity(provider.pluginId), signal)
      const isCurrent =
        current !== null &&
        current.activeRevision === provider.activeRevision &&
        current.activeSetDigest === provider.activeSetDigest &&
        current.snapshotDigest === provider.snapshotDigest &&
        current.plugin.version === provider.pluginVersion
      if (isCurrent) {
        const state = await waitForSignal(this.#pluginRuntimeState(provider.pluginId), signal)
        if (state !== "enabled") {
          handle.release()
          return { state }
        }
      }
      let runtime: CachedPluginRuntime
      try {
        handleOwned = false
        runtime = await this.#capabilityRuntimeFor(
          provider,
          handle,
          isCurrent && current ? activePluginFingerprint(current) : null,
          signal,
        )
      } finally {
        if (handleOwned) handle.release()
      }
      runtime.capabilityReferences += 1
      let released = false
      try {
        if (isCurrent) {
          const confirmed = await waitForSignal(this.#plugins.resolveCapabilityIdentity(provider.pluginId), signal)
          if (
            !confirmed ||
            confirmed.activeRevision !== provider.activeRevision ||
            confirmed.activeSetDigest !== provider.activeSetDigest ||
            confirmed.snapshotDigest !== provider.snapshotDigest ||
            confirmed.plugin.version !== provider.pluginVersion
          ) {
            this.#evict(runtime)
          }
        }
        const tools = [...(await this.#availableTools(runtime, signal, true)).values()]
        return {
          generation: runtime.capabilityGeneration,
          provider,
          get released() {
            return released
          },
          release: () => {
            if (released) return
            released = true
            this.#releaseCapabilityRuntime(runtime)
          },
          state: "ready",
          tools,
        }
      } catch (error) {
        released = true
        this.#releaseCapabilityRuntime(runtime, true)
        throw error
      }
    } catch (error) {
      if (signal?.aborted) throw abortError(signal.reason)
      return error instanceof Error && error.message.includes("setup is required")
        ? { state: "setup-required" }
        : { state: "recovering" }
    }
  }

  async execute(input: Parameters<PluginCapabilityExecutorPort["execute"]>[0]): Promise<unknown> {
    if (input.signal?.aborted) throw abortError(input.signal.reason)
    const runtime = this.#runtimesByCapabilityGeneration.get(input.runtime.generation)
    if (
      !runtime ||
      input.runtime.released ||
      !runtime.activeHandle ||
      !sameRuntimeIdentity(runtime.activeHandle.identity, {
        activeRevision: input.provider.activeRevision,
        activeSetDigest: input.provider.activeSetDigest,
        pluginId: input.provider.pluginId,
        snapshotDigest: input.provider.snapshotDigest,
        version: input.provider.pluginVersion,
      })
    ) {
      throw new Error("Plugin capability process generation is unavailable")
    }
    if (!runtime.client.callPluginCapabilityTool) {
      throw new Error("Plugin capability process does not implement the exact MCP operation executor")
    }
    if (
      input.authority.operationId !== input.operationId ||
      input.authority.providerPluginId !== input.provider.pluginId
    ) {
      throw new Error("Plugin capability invocation authority does not match its provider operation")
    }
    if ([...runtime.capabilityOperations.values()].some(({ operationId }) => operationId === input.operationId)) {
      throw new Error("Plugin capability operation is already active in this sidecar")
    }
    if (!isUnknownRecord(input.input)) {
      throw new Error("Plugin capability input must be a closed object")
    }
    await input.authority.assertActive()
    const authorityToken = randomBytes(32).toString("base64url")
    const invocationAbort = new AbortController()
    const invocationSignal = input.authority.signal
      ? AbortSignal.any([input.authority.signal, invocationAbort.signal])
      : invocationAbort.signal
    const activeHandle = runtime.activeHandle
    const principal = Object.freeze({
      activeRevision: input.provider.activeRevision,
      activeSetDigest: input.provider.activeSetDigest,
      manifestDigest: activeHandle.descriptor.authorizations.capabilityContractDigest,
      pluginId: input.provider.pluginId,
      pluginVersion: input.provider.pluginVersion,
      runtime: "tool" as const,
      snapshotDigest: input.provider.snapshotDigest,
    })
    const claims: PluginHostInvocationLeaseClaims = Object.freeze({
      consumerPluginId: input.authority.consumerPluginId,
      operationId: input.authority.operationId,
      providerPluginId: input.authority.providerPluginId,
    })
    const invocationLease: PluginHostInvocationLease = Object.freeze({
      assertActive: async (candidate: PluginHostInvocationLeaseClaims) => {
        if (
          candidate.operationId !== claims.operationId ||
          candidate.consumerPluginId !== claims.consumerPluginId ||
          candidate.providerPluginId !== claims.providerPluginId ||
          invocationSignal.aborted ||
          input.runtime.released ||
          !runtime.activeHandle ||
          !sameRuntimeIdentity(runtime.activeHandle.identity, {
            activeRevision: input.provider.activeRevision,
            activeSetDigest: input.provider.activeSetDigest,
            pluginId: input.provider.pluginId,
            snapshotDigest: input.provider.snapshotDigest,
            version: input.provider.pluginVersion,
          })
        ) {
          throw new Error("Plugin capability invocation authority is no longer active")
        }
        await input.authority.assertActive()
      },
      claims,
      principal,
      resolved: Object.freeze({
        activeRevision: principal.activeRevision,
        activeSetDigest: principal.activeSetDigest,
        capabilities: Object.freeze([...runtime.plugin.capabilities]),
        hostApi: runtime.plugin.hostApi,
        manifestDigest: principal.manifestDigest,
        pluginId: principal.pluginId,
        pluginName: runtime.plugin.name,
        pluginVersion: principal.pluginVersion,
        snapshotDigest: principal.snapshotDigest,
      }),
      signal: invocationSignal,
    })
    let host: ToolPluginCanvasMcpBridge | undefined
    try {
      host = await createToolPluginCanvasMcpBridge(runtime.plugin, this.#canvasCapabilities, invocationLease)
      runtime.capabilityOperations.set(authorityToken, {
        ...(host ? { host: host.handler } : {}),
        invoke: input.invoke,
        operationId: input.operationId,
      })
      const result = await runtime.client.callPluginCapabilityTool(
        input.capability.operation,
        input.input,
        { authorityToken, operationId: input.operationId },
        input.signal,
      )
      if (result.isError) throw new Error("Plugin capability provider returned an MCP error")
      if (!result.structuredContent) throw new Error("Plugin capability provider omitted structuredContent")
      return result.structuredContent
    } finally {
      invocationAbort.abort(new Error("Plugin capability invocation ended"))
      runtime.capabilityOperations.delete(authorityToken)
      host?.close()
    }
  }

  async #capabilityRuntimeFor(
    provider: PluginCapabilityPluginIdentity,
    handle: GenerationPluginActiveHandle,
    currentFingerprint: string | null,
    signal?: AbortSignal,
  ) {
    const key = pluginCapabilityRuntimeKey(provider)
    const shared = this.#runtimesBySnapshot.get(key)
    if (shared?.activeHandle && this.#runtimeMatchesProvider(shared, provider)) {
      handle.release()
      return shared
    }
    const pending = this.#startingByIdentity.get(key)
    if (pending) {
      handle.release()
      return this.#waitForExactRuntime(pending, signal)
    }
    const controller = new AbortController()
    const promise = this.#startHistoricalCapabilityRuntime(provider, handle, currentFingerprint, controller.signal)
    const starting: StartingExactPluginRuntime = {
      cancel: () => controller.abort(new Error("Plugin capability runtime start was canceled")),
      fingerprint: currentFingerprint,
      key,
      persistent: false,
      pluginId: provider.pluginId,
      runtimeKey: runtimeProfileKey(provider.pluginId),
      promise,
      settled: false,
      waiters: 0,
    }
    this.#startingByIdentity.set(key, starting)
    void promise.then(
      () => this.#finishExactRuntimeStart(starting),
      () => this.#finishExactRuntimeStart(starting),
    )
    return this.#waitForExactRuntime(starting, signal)
  }

  async #waitForExactRuntime(starting: StartingExactPluginRuntime, signal?: AbortSignal) {
    starting.waiters += 1
    try {
      return await waitForSignal(starting.promise, signal)
    } finally {
      starting.waiters = Math.max(0, starting.waiters - 1)
      if (starting.waiters === 0 && !starting.persistent && !starting.settled) starting.cancel()
    }
  }

  #finishExactRuntimeStart(starting: StartingExactPluginRuntime) {
    starting.settled = true
    if (this.#startingByIdentity.get(starting.key) === starting) {
      this.#startingByIdentity.delete(starting.key)
    }
  }

  #runtimeMatchesProvider(runtime: CachedPluginRuntime, provider: PluginCapabilityPluginIdentity) {
    const identity = runtime.activeHandle?.identity
    return Boolean(
      identity &&
        identity.activeRevision === provider.activeRevision &&
        identity.activeSetDigest === provider.activeSetDigest &&
        identity.pluginId === provider.pluginId &&
        identity.version === provider.pluginVersion &&
        identity.snapshotDigest === provider.snapshotDigest,
    )
  }

  async #startHistoricalCapabilityRuntime(
    provider: PluginCapabilityPluginIdentity,
    activeHandle: GenerationPluginActiveHandle,
    currentFingerprint: string | null,
    signal?: AbortSignal,
  ) {
    const runtimeKey = pluginCapabilityRuntimeKey(provider)
    const existing = this.#runtimesBySnapshot.get(runtimeKey)
    if (existing && this.#runtimeMatchesProvider(existing, provider)) {
      activeHandle.release()
      return existing
    }
    let client: GenerationPluginMcpClient | undefined
    try {
      throwIfAborted(signal)
      if (
        activeHandle.identity.activeRevision !== provider.activeRevision ||
        activeHandle.identity.activeSetDigest !== provider.activeSetDigest ||
        activeHandle.identity.pluginId !== provider.pluginId ||
        activeHandle.identity.version !== provider.pluginVersion ||
        activeHandle.identity.snapshotDigest !== provider.snapshotDigest
      ) {
        throw new Error("Historical Plugin capability handle identity changed")
      }
      const plugin = activeHandle.plugin
      const declaredRuntime = plugin.runtime
      const companion = activeHandle.descriptor.companion
      const authorizationIdentity = activeHandle.descriptor.authorizations.companionExecutionDigest
      if (!declaredRuntime || declaredRuntime.type !== "mcp-stdio" || !companion) {
        throw new Error("Plugin capability provider has no verified runtime")
      }
      if (!authorizationIdentity || !/^[a-f0-9]{64}$/.test(authorizationIdentity)) {
        throw new Error(`Generation Plugin companion setup is required: ${plugin.id}`)
      }
      const companionPath = await activeHandle.resolveCompanion()
      throwIfAborted(signal)
      if (!companionPath || !path.isAbsolute(companionPath)) {
        throw new Error("Plugin capability provider companion is unavailable")
      }
      if (companion.mode === "convax-bun" && !this.#bunRuntime) {
        throw new Error("Bundled Bun runtime is unavailable")
      }
      const capabilityOperations = new Map<string, PluginCapabilityNestedOperation>()
      client = this.#createClient({
        ...(companion.mode === "convax-bun"
          ? { args: [companionPath, ...(declaredRuntime.args ?? [])] }
          : declaredRuntime.args
            ? { args: [...declaredRuntime.args] }
            : {}),
        command: companion.mode === "convax-bun" ? this.#bunRuntime!.command : companionPath,
        cwd: this.#workingDirectory,
        env: {
          ...this.#environment,
          ...(companion.mode === "convax-bun" ? this.#bunRuntime?.env : {}),
        },
        serverRequestHandler: createPluginCapabilityNestedMcpHandler(
          capabilityOperations,
          toolPluginCanvasMcpMethodNames(plugin),
        ),
      })
      throwIfAborted(signal)
      if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
      const runtime: CachedPluginRuntime = {
        activeHandle,
        authorizationIdentity,
        capabilityGeneration: randomUUID(),
        capabilityOperations,
        capabilityReferences: 0,
        capabilityRetired: currentFingerprint === null,
        closed: false,
        client,
        executableSnapshot: {
          dispose() {},
          path: companionPath,
          ...(companion.mode === "convax-bun" ? { runtime: "bun" as const } : {}),
        },
        fingerprint:
          currentFingerprint ??
          createHash("sha256")
            .update(
              JSON.stringify([
                provider.activeRevision,
                provider.activeSetDigest,
                provider.snapshotDigest,
                activeHandle.descriptor.authorizations.capabilityContractDigest,
              ]),
            )
            .digest("hex"),
        plugin: structuredClone(plugin),
        pluginId: plugin.id,
        profileStateBinding: createHash("sha256").update(authorizationIdentity).digest("hex"),
        runtimeKey: runtimeProfileKey(plugin.id),
        serviceId: plugin.id,
        sourceBinding: {
          ...(companion.mode === "convax-bun" ? { runtime: "bun" as const } : {}),
          sha256: companion.sha256,
          size: companion.size,
        },
        toolsRequestRevision: 0,
      }
      if (currentFingerprint !== null) {
        const prior = this.#cache.get(provider.pluginId)
        if (prior && prior !== runtime) this.#closeRuntime(prior)
        this.#cache.set(provider.pluginId, runtime)
      }
      this.#runtimesBySnapshot.set(runtimeKey, runtime)
      this.#runtimesByCapabilityGeneration.set(runtime.capabilityGeneration, runtime)
      return runtime
    } catch (error) {
      if (client) await closeAndWaitQuietly(client, true)
      activeHandle.release()
      throw error
    }
  }

  #releaseCapabilityRuntime(runtime: CachedPluginRuntime, failed = false) {
    runtime.capabilityReferences = Math.max(0, runtime.capabilityReferences - 1)
    if (failed) runtime.capabilityRetired = true
    if (runtime.capabilityRetired && runtime.capabilityReferences === 0) {
      this.#closeRuntime(runtime, failed)
      void this.reconcileProfileState().catch(() => undefined)
    }
  }

  async #discover() {
    if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
    const discovered = new Map<string, DiscoveredPlugin>()
    const installedPluginIds = new Set<string>()
    const installed = await this.#plugins.list()
    if (this.#disposed) throw new Error("Generation Plugin runtime is disposed")
    for (const inventoryPlugin of installed) {
      const plugin = inventoryPluginManifest(inventoryPlugin)
      if (!isExecutablePlugin(plugin)) continue
      if (installedPluginIds.has(plugin.id)) throw new Error(`Duplicate installed Plugin id: ${plugin.id}`)
      installedPluginIds.add(plugin.id)
      if ((await this.#pluginRuntimeState(plugin.id)) !== "enabled") continue
      const identity = await this.#plugins.resolveCapabilityIdentity(plugin.id)
      if (
        !identity ||
        identity.plugin.id !== plugin.id ||
        identity.plugin.version !== plugin.version ||
        pluginSnapshotCanonicalDigest(identity.plugin) !== pluginSnapshotCanonicalDigest(plugin)
      ) {
        throw new Error(`Generation Plugin active identity changed during discovery: ${plugin.id}`)
      }
      requireBareCommand(plugin.runtime.command)
      const common = {
        fingerprint: activePluginFingerprint(identity),
        identity: {
          activeRevision: identity.activeRevision,
          activeSetDigest: identity.activeSetDigest,
          pluginId: identity.plugin.id,
          pluginVersion: identity.plugin.version,
          snapshotDigest: identity.snapshotDigest,
        },
        manifest: plugin,
        packageDigest: pluginSnapshotCanonicalDigest(plugin),
      }
      const profiles = executableProfiles(plugin)
      if (!profiles.length) throw new Error(`Executable Plugin has no runtime profile: ${plugin.id}`)
      for (const profile of profiles) {
        if (discovered.has(profile.runtimeKey)) {
          throw new Error(`Duplicate installed Plugin runtime profile: ${plugin.id}/${profile.serviceId}`)
        }
        for (const tool of profile.generation?.tools ?? []) requireGenerationToolId(tool.id)
        discovered.set(profile.runtimeKey, { ...common, ...profile })
      }
    }
    for (const [runtimeKey, runtime] of this.#cache) {
      if (discovered.get(runtimeKey)?.fingerprint !== runtime.fingerprint) this.#evict(runtime)
    }
    for (const [runtimeKey, starting] of this.#starting) {
      if (discovered.get(runtimeKey)?.fingerprint !== starting.fingerprint) {
        starting.canceled = true
        this.#starting.delete(runtimeKey)
      }
    }
    for (const starting of this.#startingByIdentity.values()) {
      if (starting.fingerprint !== null && discovered.get(starting.runtimeKey)?.fingerprint !== starting.fingerprint) {
        starting.cancel()
      }
    }
    return discovered
  }

  #selectTool(plugins: ReadonlyMap<string, DiscoveredPlugin>, hostToolId: string): SelectedPluginTool {
    const baseToolId = baseGenerationToolHostId(hostToolId)
    for (const plugin of plugins.values()) {
      const tool = plugin.generation?.tools.find(
        (candidate) =>
          generationPluginToolHostId(
            plugin.manifest.id,
            candidate.id,
            plugin.topLevel ? undefined : plugin.serviceId,
          ) === baseToolId,
      )
      if (tool) return { plugin, tool }
    }
    throw new Error(`Generation tool is not installed: ${hostToolId}`)
  }

  #selectService(
    plugins: ReadonlyMap<string, DiscoveredPlugin>,
    target: { readonly pluginId: string; readonly serviceId: string },
  ) {
    const plugin = [...plugins.values()].find(
      (candidate) =>
        candidate.manifest.id === target.pluginId && candidate.serviceId === target.serviceId && candidate.service,
    )
    if (!plugin) throw new Error(`Plugin service is not installed: ${target.pluginId}/${target.serviceId}`)
    return plugin
  }

  async #runtimeFor(plugin: DiscoveredPlugin): Promise<CachedPluginRuntime> {
    const cached = this.#cache.get(plugin.runtimeKey)
    if (cached?.fingerprint === plugin.fingerprint) return cached
    const exactRuntimeKey = plugin.topLevel
      ? pluginCapabilityRuntimeKey(plugin.identity)
      : `${pluginCapabilityRuntimeKey(plugin.identity)}\0${plugin.runtimeKey}`
    const exactPending = this.#startingByIdentity.get(exactRuntimeKey)
    if (exactPending) {
      exactPending.persistent = true
      return exactPending.promise
    }

    const pending = this.#starting.get(plugin.runtimeKey)
    if (pending) {
      pending.canceled = true
      this.#starting.delete(plugin.runtimeKey)
    }

    const starting: StartingPluginRuntime = {
      canceled: false,
      fingerprint: plugin.fingerprint,
      pluginId: plugin.manifest.id,
    }
    const promise = this.#startRuntime(plugin, starting)
    starting.promise = promise
    this.#starting.set(plugin.runtimeKey, starting)
    const exactStarting: StartingExactPluginRuntime = {
      cancel: () => {
        starting.canceled = true
      },
      fingerprint: plugin.fingerprint,
      key: exactRuntimeKey,
      persistent: true,
      pluginId: plugin.manifest.id,
      runtimeKey: plugin.runtimeKey,
      promise,
      settled: false,
      waiters: 0,
    }
    this.#startingByIdentity.set(exactRuntimeKey, exactStarting)
    void promise.then(
      () => this.#finishExactRuntimeStart(exactStarting),
      () => this.#finishExactRuntimeStart(exactStarting),
    )
    try {
      return await promise
    } finally {
      if (this.#starting.get(plugin.runtimeKey) === starting) this.#starting.delete(plugin.runtimeKey)
    }
  }

  async #startRuntime(plugin: DiscoveredPlugin, starting: StartingPluginRuntime) {
    if (this.#platform === "win32") {
      throw new Error("Generation Tool Plugin execution on Windows requires a host Job Object and is not enabled")
    }
    const activeHandle = await this.#plugins.acquireActivePlugin(plugin.manifest.id)
    try {
      if (!activeHandleMatches(activeHandle, await this.#requireActiveIdentity(plugin), plugin.packageDigest)) {
        throw new Error(`Generation Plugin changed before its runtime lease was acquired: ${plugin.manifest.id}`)
      }
      const companion = activeHandle.descriptor.companion
      const rawAuthorizationIdentity = activeHandle.descriptor.authorizations.companionExecutionDigest
      if (!companion) {
        throw new Error(`Generation Plugin has no immutable active companion: ${plugin.manifest.id}`)
      }
      if (!rawAuthorizationIdentity || !/^[a-f0-9]{64}$/.test(rawAuthorizationIdentity)) {
        throw new Error(`Generation Plugin companion setup is required: ${plugin.manifest.id}`)
      }
      const activationId = plugin.topLevel ? undefined : activeHandle.installationActivationId
      if (!plugin.topLevel && (!activationId || !profileStateBindingPattern.test(activationId))) {
        throw new Error(`Generation Plugin ActiveSet activation is unavailable: ${plugin.manifest.id}`)
      }
      const authorizationIdentity = runtimeAuthorizationIdentity(rawAuthorizationIdentity, plugin, activationId)
      const companionPath = await activeHandle.resolveCompanion()
      if (!companionPath || !path.isAbsolute(companionPath)) {
        throw new Error(`Generation Plugin active companion is unavailable: ${plugin.manifest.id}`)
      }
      const sourceBinding: GenerationRecoveryExecutableBinding = {
        ...(companion.mode === "convax-bun" ? { runtime: "bun" as const } : {}),
        sha256: companion.sha256,
        size: companion.size,
      }
      let cleanupProfileLaunch = () => {}
      const executableSnapshot: GenerationPluginExecutableSnapshot = {
        dispose() {
          cleanupProfileLaunch()
        },
        path: companionPath,
        ...(companion.mode === "convax-bun" ? { runtime: "bun" as const } : {}),
      }
      await this.#assertActiveIdentity(plugin)
      if (this.#disposed || starting.canceled)
        throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
      const runtimeAuthorizationDigest = profileRuntimeAuthorizationDigest(
        rawAuthorizationIdentity,
        plugin,
        activationId,
      )
      const recoveryStateDirectory = this.#recoveryStateDirectory
        ? await ensureGenerationRecoveryStateDirectory(
            this.#recoveryStateDirectory,
            plugin.manifest.id,
            plugin.packageDigest,
            runtimeAuthorizationDigest,
          )
        : undefined
      let canvasCapabilities: ToolPluginCanvasMcpBridge | undefined
      try {
        canvasCapabilities = await createToolPluginCanvasMcpBridge(plugin.manifest, this.#canvasCapabilities)
        const capabilityOperations = new Map<string, PluginCapabilityNestedOperation>()
        const serverRequestHandler = createPluginCapabilityNestedMcpHandler(
          capabilityOperations,
          toolPluginCanvasMcpMethodNames(plugin.manifest),
          canvasCapabilities?.handler,
        )
        if (this.#disposed || starting.canceled) {
          canvasCapabilities?.close()
          throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
        }
        if (executableSnapshot.runtime === "bun" && !this.#bunRuntime) {
          throw new Error("Bundled Bun runtime is unavailable")
        }
        await this.#assertActiveIdentity(plugin)
        const confirmedCompanionPath = await activeHandle.resolveCompanion()
        if (confirmedCompanionPath !== companionPath) {
          throw new Error(`Generation Plugin companion changed immediately before process start: ${plugin.manifest.id}`)
        }
        if (this.#disposed || starting.canceled) {
          throw new Error(`Generation Plugin changed immediately before process start: ${plugin.manifest.id}`)
        }
        const { cleanup, ...launchOptions } = await this.#profileLaunchOptions(
          plugin.topLevel,
          runtimeAuthorizationDigest,
          {
            ...this.#environment,
            ...(executableSnapshot.runtime === "bun" ? this.#bunRuntime?.env : {}),
            ...(recoveryStateDirectory ? { CONVAX_GENERATION_LRO_DIRECTORY: recoveryStateDirectory } : {}),
          },
        )
        cleanupProfileLaunch = cleanup
        const client = this.#createClient({
          ...(executableSnapshot.runtime === "bun"
            ? { args: [executableSnapshot.path, ...plugin.runtimeArgs] }
            : plugin.runtimeArgs.length
              ? { args: [...plugin.runtimeArgs] }
              : {}),
          command: executableSnapshot.runtime === "bun" ? this.#bunRuntime!.command : executableSnapshot.path,
          ...launchOptions,
          ...(serverRequestHandler ? { serverRequestHandler } : {}),
        })
        if (this.#disposed || starting.canceled) {
          await closeAndWaitQuietly(client, true)
          canvasCapabilities?.close()
          throw new Error(`Generation Plugin changed while starting: ${plugin.manifest.id}`)
        }
        const cached: CachedPluginRuntime = {
          activeHandle,
          authorizationIdentity,
          capabilityGeneration: randomUUID(),
          capabilityOperations,
          capabilityReferences: 0,
          capabilityRetired: false,
          closed: false,
          ...(canvasCapabilities ? { canvasCapabilities } : {}),
          client,
          executableSnapshot,
          fingerprint: plugin.fingerprint,
          plugin: structuredClone(plugin.manifest),
          pluginId: plugin.manifest.id,
          profileStateBinding: runtimeAuthorizationDigest,
          runtimeKey: plugin.runtimeKey,
          serviceId: plugin.serviceId,
          sourceBinding,
          toolsRequestRevision: 0,
        }
        const prior = this.#cache.get(plugin.runtimeKey)
        if (prior) this.#closeRuntime(prior)
        this.#cache.set(plugin.runtimeKey, cached)
        if (plugin.topLevel) this.#runtimesBySnapshot.set(activeHandleRuntimeKey(activeHandle.identity), cached)
        this.#runtimesByCapabilityGeneration.set(cached.capabilityGeneration, cached)
        return cached
      } catch (error) {
        canvasCapabilities?.close()
        executableSnapshot.dispose()
        throw error
      }
    } catch (error) {
      activeHandle.release()
      throw error
    }
  }

  async #requireActiveIdentity(plugin: DiscoveredPlugin) {
    const identity = await this.#plugins.resolveCapabilityIdentity(plugin.manifest.id)
    if (
      !identity ||
      identity.plugin.id !== plugin.manifest.id ||
      identity.plugin.version !== plugin.manifest.version ||
      pluginSnapshotCanonicalDigest(identity.plugin) !== plugin.packageDigest ||
      activePluginFingerprint(identity) !== plugin.fingerprint
    ) {
      throw new Error(`Generation Plugin active identity changed: ${plugin.manifest.id}`)
    }
    return identity
  }

  async #assertActiveIdentity(plugin: DiscoveredPlugin) {
    await this.#requireActiveIdentity(plugin)
  }

  async #availableTools(runtime: CachedPluginRuntime, signal?: AbortSignal, refresh = false) {
    if (runtime.availableTools && !refresh) return runtime.availableTools
    const requestRevision = ++runtime.toolsRequestRevision
    const tools = await runtime.client.listTools(signal)
    const names = tools.map((tool) => tool.name)
    if (new Set(names).size !== names.length) throw new Error("Generation Plugin MCP server exposed duplicate tool ids")
    const available = new Map(tools.map((tool) => [tool.name, tool])) as ReadonlyMap<string, McpToolDefinition>
    if (runtime.toolsRequestRevision === requestRevision) runtime.availableTools = available
    return available
  }

  async #reconcileRecoveryPins() {
    if (!this.#recoveryRuntimeStore) return
    const [records, pins] = await Promise.all([this.#recoveryRuntimeStore.list(), this.#plugins.listOwnerPins()])
    const expected = new Map(
      records.map((record) => [generationRecoveryOwnerKey(record.executionBindingDigest), record.pluginIdentity]),
    )
    const generationPins = pins.filter(({ ownerKey }) => ownerKey.startsWith(generationRecoveryOwnerPrefix))
    for (const [ownerKey, identity] of expected) {
      const pin = generationPins.find((candidate) => candidate.ownerKey === ownerKey)
      if (!pin || !sameRuntimeIdentity(pin.identity, identity)) {
        throw new Error(`Generation recovery record has a missing or stale snapshot owner: ${ownerKey}`)
      }
    }
    for (const pin of generationPins) {
      if (expected.has(pin.ownerKey)) continue
      await this.#plugins.unpinPluginOwner(pin.ownerKey, pin.identity)
    }
  }

  async #withRecoveryMutation<Result>(executionBindingDigest: string, operation: () => Promise<Result>) {
    const previous = this.#recoveryMutations.get(executionBindingDigest) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = previous.then(() => gate)
    this.#recoveryMutations.set(executionBindingDigest, current)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#recoveryMutations.get(executionBindingDigest) === current) {
        this.#recoveryMutations.delete(executionBindingDigest)
      }
    }
  }

  #evict(runtime: CachedPluginRuntime) {
    if (this.#cache.get(runtime.runtimeKey) === runtime) this.#cache.delete(runtime.runtimeKey)
    this.#retireRuntime(runtime)
  }

  #retireRuntime(runtime: CachedPluginRuntime) {
    runtime.capabilityRetired = true
    if (runtime.capabilityReferences === 0) this.#closeRuntime(runtime)
  }

  #closeRuntime(runtime: CachedPluginRuntime, force = false) {
    if (runtime.closed) return
    if (!force && runtime.capabilityReferences > 0) {
      runtime.capabilityRetired = true
      return
    }
    runtime.closed = true
    runtime.capabilityRetired = true
    if (this.#cache.get(runtime.runtimeKey) === runtime) this.#cache.delete(runtime.runtimeKey)
    if (
      runtime.activeHandle &&
      this.#runtimesBySnapshot.get(activeHandleRuntimeKey(runtime.activeHandle.identity)) === runtime
    ) {
      this.#runtimesBySnapshot.delete(activeHandleRuntimeKey(runtime.activeHandle.identity))
    }
    this.#runtimesByCapabilityGeneration.delete(runtime.capabilityGeneration)
    runtime.capabilityOperations.clear()
    runtime.canvasCapabilities?.close()
    let finalized = false
    const finalize = () => {
      if (finalized) return
      finalized = true
      runtime.executableSnapshot.dispose()
      runtime.activeHandle?.release()
    }
    if (!runtime.client.closeAndWait) {
      closeQuietly(runtime.client, force)
      finalize()
      return
    }
    const closing = (async () => {
      try {
        await runtime.client.closeAndWait!(force)
      } catch {
        closeQuietly(runtime.client, true)
      } finally {
        finalize()
      }
    })()
    this.#closingRuntimes.add(closing)
    void closing.then(
      () => this.#closingRuntimes.delete(closing),
      () => this.#closingRuntimes.delete(closing),
    )
  }
}
