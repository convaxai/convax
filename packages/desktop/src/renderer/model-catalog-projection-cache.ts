import type { AgentModelCatalog, AgentModelCatalogModel, AgentModelCatalogProvider } from "@convax/agent-runtime"

import type { GenerationInputRole, GenerationOutputModality, GenerationToolSummary } from "../generation-contracts"

export interface ModelCatalogProjectionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const agentModelCatalogStorageKey = "convax.desktop.agent-model-display.v1"
export const generationModelCatalogStorageKey = "convax.desktop.generation-model-display.v1"

const agentModelCatalogSchema = "convax.agent-model-display-cache/1"
const generationModelCatalogSchema = "convax.generation-model-display-cache/1"
const maximumCacheBytes = 1024 * 1024
const maximumProviders = 256
const maximumModelsPerProvider = 2_048
const maximumGenerationTools = 4_096
const utf8Encoder = new TextEncoder()
const generationInputs = new Set<unknown>([
  "audio",
  "first_frame",
  "last_frame",
  "reference_image",
  "reference_video",
  "text",
])
const generationOutputs = new Set<unknown>(["audio", "image", "text", "video"])

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

function isOpaqueId(value: unknown, maximumLength = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function isSafeDisplayString(value: unknown, maximumLength: number): value is string {
  return (
    isOpaqueId(value, maximumLength) &&
    !/[a-z][a-z0-9+.-]*:\/\//iu.test(value) &&
    !/(?:^|\s)(?:file:|mailto:|data:|\.{1,2}[\\/]|\/{2}|[A-Za-z]:[\\/]|\\\\)/iu.test(value) &&
    !/\b(?:bearer|cookie|token|access[ _-]?key|secret[ _-]?key)\b\s*[:=]?\s*\S{8,}/iu.test(value)
  )
}

function isSafeDisplayText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximumLength &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
    !/[a-z][a-z0-9+.-]*:\/\//iu.test(value) &&
    !/(?:^|\s)(?:file:|mailto:|data:|\.{1,2}[\\/]|\/{2}|[A-Za-z]:[\\/]|\\\\)/iu.test(value) &&
    !/\b(?:bearer|cookie|token|access[ _-]?key|secret[ _-]?key)\b\s*[:=]?\s*\S{8,}/iu.test(value)
  )
}

function parseAgentModel(value: unknown): AgentModelCatalogModel | null {
  if (!hasExactKeys(value, ["default", "modelId", "modelName"])) return null
  if (typeof value.default !== "boolean" || !isOpaqueId(value.modelId) || !isSafeDisplayString(value.modelName, 256)) {
    return null
  }
  return { default: value.default, modelId: value.modelId, modelName: value.modelName }
}

function parseAgentProvider(value: unknown): AgentModelCatalogProvider | null {
  if (!hasExactKeys(value, ["connected", "models", "providerId", "providerName"], ["defaultModelId"])) {
    return null
  }
  if (
    typeof value.connected !== "boolean" ||
    !isOpaqueId(value.providerId) ||
    !isSafeDisplayString(value.providerName, 256) ||
    (value.defaultModelId !== undefined && !isOpaqueId(value.defaultModelId)) ||
    !Array.isArray(value.models) ||
    value.models.length > maximumModelsPerProvider
  ) {
    return null
  }
  const models = value.models.map(parseAgentModel)
  if (models.some((model) => model === null)) return null
  const parsedModels = models as AgentModelCatalogModel[]
  if (new Set(parsedModels.map(({ modelId }) => modelId)).size !== parsedModels.length) return null
  if (value.defaultModelId !== undefined && !parsedModels.some(({ modelId }) => modelId === value.defaultModelId)) {
    return null
  }
  return {
    connected: value.connected,
    ...(value.defaultModelId === undefined ? {} : { defaultModelId: value.defaultModelId }),
    models: parsedModels,
    providerId: value.providerId,
    providerName: value.providerName,
  }
}

function parseAgentCatalog(value: unknown): AgentModelCatalog | null {
  if (
    !hasExactKeys(value, ["providers"]) ||
    !Array.isArray(value.providers) ||
    value.providers.length > maximumProviders
  ) {
    return null
  }
  const providers = value.providers.map(parseAgentProvider)
  if (providers.some((provider) => provider === null)) return null
  const parsedProviders = providers as AgentModelCatalogProvider[]
  if (new Set(parsedProviders.map(({ providerId }) => providerId)).size !== parsedProviders.length) return null
  return { providers: parsedProviders }
}

function isGenerationInput(value: unknown): value is GenerationInputRole {
  return generationInputs.has(value)
}

function isGenerationOutput(value: unknown): value is GenerationOutputModality {
  return generationOutputs.has(value)
}

function parseGenerationTool(value: unknown): GenerationToolSummary | null {
  if (
    !hasExactKeys(
      value,
      ["acceptedInputs", "description", "id", "kind", "output", "pluginId", "pluginName", "title", "toolId"],
      ["agentId", "delivery", "inputBinding", "modelName", "recovery"],
    )
  ) {
    return null
  }
  if (
    !Array.isArray(value.acceptedInputs) ||
    value.acceptedInputs.length > generationInputs.size ||
    !value.acceptedInputs.every(isGenerationInput) ||
    new Set(value.acceptedInputs).size !== value.acceptedInputs.length ||
    !isSafeDisplayText(value.description, 4_096) ||
    !isOpaqueId(value.id) ||
    (value.kind !== "model" && value.kind !== "operation") ||
    !isGenerationOutput(value.output) ||
    !isOpaqueId(value.pluginId, 128) ||
    !isSafeDisplayString(value.pluginName, 256) ||
    !isSafeDisplayString(value.title, 256) ||
    !isOpaqueId(value.toolId) ||
    (value.agentId !== undefined && !isOpaqueId(value.agentId)) ||
    (value.delivery !== undefined && value.delivery !== "canvas" && value.delivery !== "return") ||
    (value.inputBinding !== undefined && value.inputBinding !== "direct-incoming") ||
    (value.modelName !== undefined && !isSafeDisplayString(value.modelName, 256)) ||
    (value.recovery !== undefined && value.recovery !== "long-running-operation")
  ) {
    return null
  }
  return {
    acceptedInputs: [...value.acceptedInputs],
    description: value.description,
    id: value.id,
    kind: value.kind,
    output: value.output,
    pluginId: value.pluginId,
    pluginName: value.pluginName,
    title: value.title,
    toolId: value.toolId,
    ...(value.agentId === undefined ? {} : { agentId: value.agentId }),
    ...(value.delivery === undefined ? {} : { delivery: value.delivery }),
    ...(value.inputBinding === undefined ? {} : { inputBinding: value.inputBinding }),
    ...(value.modelName === undefined ? {} : { modelName: value.modelName }),
    ...(value.recovery === undefined ? {} : { recovery: value.recovery }),
  }
}

function parseGenerationCatalog(value: unknown): readonly GenerationToolSummary[] | null {
  if (!Array.isArray(value) || value.length > maximumGenerationTools) return null
  const tools = value.map(parseGenerationTool)
  if (tools.some((tool) => tool === null)) return null
  const parsedTools = tools as GenerationToolSummary[]
  if (new Set(parsedTools.map(({ id }) => id)).size !== parsedTools.length) return null
  return parsedTools
}

function projectAgentCatalog(catalog: AgentModelCatalog): AgentModelCatalog | null {
  const providers: AgentModelCatalogProvider[] = []
  const providerIds = new Set<string>()
  for (const provider of catalog.providers) {
    if (!provider.connected || providerIds.has(provider.providerId) || providers.length >= maximumProviders) continue
    const models: AgentModelCatalogModel[] = []
    const modelIds = new Set<string>()
    for (const model of provider.models) {
      const parsed = parseAgentModel(model)
      if (!parsed || modelIds.has(parsed.modelId) || models.length >= maximumModelsPerProvider) continue
      modelIds.add(parsed.modelId)
      models.push(parsed)
    }
    const parsed = parseAgentProvider({
      connected: true,
      models,
      providerId: provider.providerId,
      providerName: provider.providerName,
      ...(provider.defaultModelId && modelIds.has(provider.defaultModelId)
        ? { defaultModelId: provider.defaultModelId }
        : {}),
    })
    if (!parsed) continue
    providerIds.add(parsed.providerId)
    providers.push(parsed)
  }
  return parseAgentCatalog({ providers })
}

function projectGenerationCatalog(tools: readonly GenerationToolSummary[]) {
  const projection: GenerationToolSummary[] = []
  const toolIds = new Set<string>()
  for (const tool of tools) {
    if (projection.length >= maximumGenerationTools || toolIds.has(tool.id)) continue
    const parsed = parseGenerationTool({
      ...tool,
      description: isSafeDisplayText(tool.description, 4_096) ? tool.description : "",
    })
    if (!parsed) continue
    toolIds.add(parsed.id)
    projection.push(parsed)
  }
  return parseGenerationCatalog(projection)
}

function readProjection<T>(
  storage: ModelCatalogProjectionStorage | undefined,
  key: string,
  schema: string,
  parse: (value: unknown) => T | null,
): T | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw || raw.length > maximumCacheBytes || utf8Encoder.encode(raw).byteLength > maximumCacheBytes) return null
    const value: unknown = JSON.parse(raw)
    if (!hasExactKeys(value, ["projection", "schema"]) || value.schema !== schema) return null
    return parse(value.projection)
  } catch {
    return null
  }
}

function writeProjection<T>(
  storage: ModelCatalogProjectionStorage | undefined,
  key: string,
  schema: string,
  projection: T,
  project: (value: T) => T | null,
) {
  if (!storage) return false
  const parsed = project(projection)
  if (!parsed) return false
  try {
    const raw = JSON.stringify({ projection: parsed, schema })
    if (raw.length > maximumCacheBytes || utf8Encoder.encode(raw).byteLength > maximumCacheBytes) return false
    storage.setItem(key, raw)
    return true
  } catch {
    return false
  }
}

export function readAgentModelCatalogProjection(storage: ModelCatalogProjectionStorage | undefined) {
  return readProjection(storage, agentModelCatalogStorageKey, agentModelCatalogSchema, parseAgentCatalog)
}

export function writeAgentModelCatalogProjection(
  storage: ModelCatalogProjectionStorage | undefined,
  catalog: AgentModelCatalog,
) {
  return writeProjection(storage, agentModelCatalogStorageKey, agentModelCatalogSchema, catalog, projectAgentCatalog)
}

export function readGenerationModelCatalogProjection(storage: ModelCatalogProjectionStorage | undefined) {
  return readProjection(storage, generationModelCatalogStorageKey, generationModelCatalogSchema, parseGenerationCatalog)
}

export function writeGenerationModelCatalogProjection(
  storage: ModelCatalogProjectionStorage | undefined,
  tools: readonly GenerationToolSummary[],
) {
  return writeProjection(
    storage,
    generationModelCatalogStorageKey,
    generationModelCatalogSchema,
    tools,
    projectGenerationCatalog,
  )
}
