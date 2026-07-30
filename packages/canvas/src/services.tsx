import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react"
import type { ToolInputField, ToolInputValue } from "@convax/ui"
import type { CanvasResourceSource } from "./application"
import type { CanvasDocument, CanvasNode, CanvasPoint } from "./types"

export { CanvasTextResourceConflictError } from "./application/errors"

export interface CanvasServiceContext {
  documentId: string
  selectedNodeIds: readonly string[]
  source: string
}

export interface CanvasResourceMutationTransfer {
  data: Readonly<Record<string, string>>
  types: readonly string[]
}

export interface CanvasResourceMutationRequest {
  anchor: CanvasPoint
  expectedRevision: number
  files?: readonly File[]
  relation?: {
    anchorNodeIds: readonly string[]
    direction?: "from-anchor" | "to-anchor"
    mode: "connect" | "none"
  }
  sources: readonly CanvasResourceSource[]
  signal: AbortSignal
  transfer?: CanvasResourceMutationTransfer
}

export interface CanvasResourceMutationService {
  add(input: CanvasResourceMutationRequest): Promise<{
    createdNodeIds: readonly string[]
    revision: number
    warnings: readonly string[]
  }>
  relink?(input: {
    expectedRevision: number
    file?: File
    nodeId: string
    signal: AbortSignal
    source?: Extract<CanvasResourceSource, { kind: "host-directory" | "host-file" }>
  }): Promise<{ revision: number; warnings: readonly string[] }>
  saveEditableCopy?(input: {
    expectedRevision: number
    nodeId: string
    signal: AbortSignal
  }): Promise<{ revision: number; warnings: readonly string[] }>
}

export interface CanvasResourceHydrationService {
  markStale(document: CanvasDocument): CanvasDocument
  hydrateStale(input: { document: CanvasDocument; signal: AbortSignal }): Promise<CanvasDocument>
}

export interface CanvasTextResourceService {
  save(
    input: {
      content: string
      contentRevision: string
      nodeId: string
    },
    signal: AbortSignal,
  ): Promise<{ contentRevision: string }>
}

export interface CanvasPendingDraft {
  discard(): void
  inFlightSave(): Promise<void> | null
  isDirty(): boolean
  save(): Promise<void>
}

export type CanvasPendingDraftDecision = "save" | "discard" | "cancel"

export interface CanvasPendingDraftDecisionService {
  decide(input: { count: number }): Promise<CanvasPendingDraftDecision> | CanvasPendingDraftDecision
}

export interface CanvasPendingDraftRegistry {
  hasPending(): boolean
  pendingCount(): number
  prepareToLeave(decide: () => Promise<CanvasPendingDraftDecision> | CanvasPendingDraftDecision): Promise<boolean>
  register(draft: CanvasPendingDraft): () => void
}

export function createCanvasPendingDraftRegistry(): CanvasPendingDraftRegistry {
  const drafts = new Set<CanvasPendingDraft>()
  const pendingDrafts = () => [...drafts].filter((draft) => draft.isDirty())
  const settleStartedSaves = () => {
    const started = [...drafts]
      .map((draft) => draft.inFlightSave())
      .filter((save): save is Promise<void> => Boolean(save))
    if (started.length === 0) return null
    return Promise.allSettled(started).then((results) => {
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
      if (failure) throw failure.reason
    })
  }
  return {
    hasPending: () => pendingDrafts().length > 0,
    pendingCount: () => pendingDrafts().length,
    async prepareToLeave(decide) {
      const startedBeforeDecision = settleStartedSaves()
      if (startedBeforeDecision) await startedBeforeDecision
      let pending = pendingDrafts()
      if (pending.length === 0) return true
      const decision = await decide()
      if (decision === "cancel") return false
      const startedDuringDecision = settleStartedSaves()
      if (startedDuringDecision) await startedDuringDecision
      pending = pendingDrafts()
      if (pending.length === 0) return true
      if (decision === "discard") {
        for (const draft of pending) draft.discard()
        return true
      }
      const results = await Promise.allSettled(pending.map((draft) => draft.save()))
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
      if (failure) throw failure.reason
      return true
    },
    register(draft) {
      drafts.add(draft)
      return () => drafts.delete(draft)
    },
  }
}

export type CanvasGenerationOutput = "text" | "image" | "video" | "audio"

export type CanvasGenerationInputRole =
  | "text"
  | "reference_image"
  | "reference_video"
  | "first_frame"
  | "last_frame"
  | "audio"

/** Host-provided description of an installed generation tool. Canvas never knows its vendor or model. */
export interface CanvasGenerationToolSummary {
  id: string
  title: string
  description: string
  output: CanvasGenerationOutput
  acceptedInputs: readonly CanvasGenerationInputRole[]
  /** Optional host-neutral display metadata for preserving service/model identity. */
  modelName?: string
  serviceId?: string
  serviceName?: string
}

export interface CanvasGenerationToolQuery {
  output?: CanvasGenerationOutput
}

export type CanvasGenerationToolInputField = ToolInputField
export type CanvasGenerationToolInputValue = ToolInputValue
export type CanvasGenerationToolInput = Readonly<Record<string, CanvasGenerationToolInputValue>>

export interface CanvasGenerationToolDescription {
  fields: readonly CanvasGenerationToolInputField[]
  toolId: string
}

export interface CanvasGenerationReference {
  nodeId: string
  role: CanvasGenerationInputRole
}

/** Host-neutral Canvas mutation selected by the caller. Omission keeps add semantics. */
export type CanvasGenerationResultMode =
  | { type: "add" }
  | { type: "create-pending-node" }
  | { nodeId: string; type: "replace-node" }

/** Host-neutral authority that Main must revalidate before staging card-scoped inputs. */
export interface CanvasGenerationReferenceConstraint {
  ownerNodeId: string
  type: "direct-incoming"
}

export interface CanvasGenerateRequest {
  anchor: CanvasPoint
  expectedRevision: number
  /** Fresh host operation correlation for this logical submission. */
  operationId?: string
  /** Trusted host output cardinality guard; this is never sent to the generation tool. */
  expectedOutputCount?: number
  output?: CanvasGenerationOutput
  prompt: string
  /**
   * Existing Canvas text nodes whose authoritative text the host appends to
   * `prompt`. These nodes are context, not model reference inputs.
   */
  promptContextNodeIds?: readonly string[]
  /**
   * Existing Canvas nodes that should be connected to generated results but
   * must not be staged or exposed as generation-tool inputs.
   */
  relationAnchorNodeIds?: readonly string[]
  /** Optional live-edge authority for card-scoped prompt context and references. */
  referenceConstraint?: CanvasGenerationReferenceConstraint
  references: readonly CanvasGenerationReference[]
  resultMode?: CanvasGenerationResultMode
  toolInput?: CanvasGenerationToolInput
  toolId?: string
  context: CanvasServiceContext
  signal: AbortSignal
}

export interface CanvasGenerateResult {
  createdNodeIds: readonly string[]
  revision: number
  toolId: string
  warnings: readonly string[]
}

export interface CanvasGenerateService {
  /** Host-owned token that changes when installed generation declarations change. */
  readonly catalogVersion?: string | number
  cancel?: (operationId: string) => void | Promise<void>
  describeTool: (toolId: string, signal?: AbortSignal) => Promise<CanvasGenerationToolDescription>
  generate: (request: CanvasGenerateRequest) => Promise<CanvasGenerateResult>
  listTools: (query: CanvasGenerationToolQuery, signal?: AbortSignal) => Promise<readonly CanvasGenerationToolSummary[]>
}

export interface CanvasGenerationInputs {
  promptContextNodeIds: readonly string[]
  references: readonly CanvasGenerationReference[]
}

/**
 * Partitions selected public Canvas file nodes into text prompt context and
 * model reference inputs. Empty cards remain output targets only; their kind
 * alone is not an input source. First/last-frame roles remain explicit choices
 * for callers and are not guessed from selection order.
 */
export function inferCanvasGenerationInputs(
  nodes: readonly CanvasNode[],
  selectedNodeIds: readonly string[],
): CanvasGenerationInputs {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const promptContextNodeIds: string[] = []
  const references: CanvasGenerationReference[] = []
  for (const nodeId of new Set(selectedNodeIds)) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    if (node.data.kind === "text") {
      const resourceState = node.data.resourceState
      const text =
        typeof resourceState === "object" && resourceState !== null && "text" in resourceState
          ? resourceState.text
          : undefined
      if (typeof text === "string" && text.trim()) {
        promptContextNodeIds.push(nodeId)
      }
      continue
    }
    const role = inferCanvasGenerationInputRole(node)
    if (role) references.push({ nodeId, role })
  }
  return { promptContextNodeIds, references }
}

/** Returns only model reference inputs; text nodes are prompt context. */
export function inferCanvasGenerationReferences(
  nodes: readonly CanvasNode[],
  selectedNodeIds: readonly string[],
): readonly CanvasGenerationReference[] {
  return inferCanvasGenerationInputs(nodes, selectedNodeIds).references
}

export function getCompatibleCanvasGenerationTools(
  tools: readonly CanvasGenerationToolSummary[],
  references: readonly CanvasGenerationReference[],
): readonly CanvasGenerationToolSummary[] {
  if (getCanvasGenerationReferenceError(references)) return []
  return tools.filter((tool) => references.every((reference) => tool.acceptedInputs.includes(reference.role)))
}

export function getCanvasGenerationReferenceError(
  references: readonly CanvasGenerationReference[],
): string | undefined {
  if (references.length > 32) return "Choose at most 32 generation references."
  for (const role of ["first_frame", "last_frame"] as const) {
    if (references.filter((reference) => reference.role === role).length > 1) {
      return role === "first_frame" ? "Choose at most one first frame." : "Choose at most one last frame."
    }
  }
  return undefined
}

export function getCanvasGenerationInputError(inputs: CanvasGenerationInputs): string | undefined {
  if (inputs.promptContextNodeIds.length + inputs.references.length > 32) {
    return "Choose at most 32 generation inputs."
  }
  return getCanvasGenerationReferenceError(inputs.references)
}

function inferCanvasGenerationInputRole(node: CanvasNode): CanvasGenerationInputRole | undefined {
  if (node.data.kind !== "image" && node.data.kind !== "video" && node.data.kind !== "audio") return undefined
  const resourceState = node.data.resourceState
  if (!resourceState || typeof resourceState !== "object") return undefined
  if (!("url" in resourceState) || typeof resourceState.url !== "string" || !resourceState.url.trim()) return undefined
  if (node.data.kind === "image") return "reference_image"
  if (node.data.kind === "video") return "reference_video"
  if (node.data.kind === "audio") return "audio"
  return undefined
}

export interface CanvasPersistenceService {
  load: (documentId: string, signal: AbortSignal) => Promise<CanvasDocument | null>
  /** Commits the renderer's optimistic delta and returns Main's authoritative projection. */
  save: (document: CanvasDocument, signal: AbortSignal) => Promise<CanvasDocument>
}

export interface CanvasExportRequest {
  document: CanvasDocument
  format: string
  selectedNodeIds: readonly string[]
}

export interface CanvasExportService {
  export: (request: CanvasExportRequest, signal: AbortSignal) => Promise<Blob | void>
}

export interface CanvasNotification {
  kind: "success" | "info" | "warning" | "error"
  title: string
  description?: string
}

export interface CanvasNotificationService {
  show: (notification: CanvasNotification) => void
}

export interface CanvasTelemetryEvent {
  name: string
  properties?: Record<string, unknown>
}

export interface CanvasTelemetryService {
  track: (event: CanvasTelemetryEvent) => void
}

export interface CanvasAssistantGenerationCapability {
  /** Card-scoped generation is intentionally limited to visual media output. */
  output: "image" | "video"
  /** One-shot raw composer draft hydrated from the Canvas-owned latest run. */
  initialPrompt?: string
  /**
   * Missing or `replace-owner-node` keeps the normal in-place flow. A true
   * unknown external result must use `create-pending-node` so a fresh operation
   * gets a separate host-owned target without mutating the unresolved owner.
   */
  submissionMode?: "create-pending-node" | "replace-owner-node"
  /** Persisted owner-node override. Missing means inherit the host's current default. */
  ownerToolId?: string
  /** File-card-only mutation; clearing the id restores host-default inheritance. */
  onOwnerToolIdChange?: (toolId?: string) => void
}

export interface CanvasAssistantRequest {
  document: CanvasDocument
  /** Present only when this owner supports direct image/video generation. */
  generation?: CanvasAssistantGenerationCapability
  /**
   * Direct incoming file nodes selected as initial, removable @ references.
   * The owner is carried separately and is never inferred as its own input.
   */
  mentionedNodeIds: readonly string[]
  mode: "agent" | "file"
  ownerNodeId: string
}

/** Host-rendered conversation surface. Canvas never imports an Agent implementation. */
export interface CanvasAssistantService {
  render: (request: CanvasAssistantRequest) => ReactNode
}

export interface CanvasServiceMap {
  assistant: CanvasAssistantService
  hydration: CanvasResourceHydrationService
  mutation: CanvasResourceMutationService
  generate: CanvasGenerateService
  persistence: CanvasPersistenceService
  export: CanvasExportService
  notify: CanvasNotificationService
  telemetry: CanvasTelemetryService
  textResources: CanvasTextResourceService
  draftDecision: CanvasPendingDraftDecisionService
}

export interface CanvasServices {
  get: <K extends keyof CanvasServiceMap>(key: K) => CanvasServiceMap[K] | undefined
  has: (key: keyof CanvasServiceMap) => boolean
  register: <K extends keyof CanvasServiceMap>(key: K, service: CanvasServiceMap[K]) => () => void
  require: <K extends keyof CanvasServiceMap>(key: K) => CanvasServiceMap[K]
  subscribe: (listener: () => void) => () => void
  getVersion: () => number
}

export function createCanvasServices(initial?: Partial<CanvasServiceMap>): CanvasServices {
  const baseEntries = new Map<keyof CanvasServiceMap, unknown>(
    Object.entries(initial ?? {}) as [keyof CanvasServiceMap, unknown][],
  )
  const entries = new Map(baseEntries)
  const registrations = new Map<keyof CanvasServiceMap, Array<{ service: unknown; token: object }>>()
  const listeners = new Set<() => void>()
  let version = 0
  const emit = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }

  return {
    get(key) {
      return entries.get(key) as CanvasServiceMap[typeof key] | undefined
    },
    has(key) {
      return entries.has(key)
    },
    register(key, service) {
      const token = {}
      const stack = registrations.get(key) ?? []
      stack.push({ service, token })
      registrations.set(key, stack)
      entries.set(key, service)
      emit()
      return () => {
        const current = registrations.get(key)
        const index = current?.findIndex((registration) => registration.token === token) ?? -1
        if (!current || index < 0) return
        current.splice(index, 1)
        if (current.length === 0) registrations.delete(key)
        const active = current.at(-1)?.service ?? baseEntries.get(key)
        if (active === undefined) entries.delete(key)
        else entries.set(key, active)
        emit()
      }
    },
    require(key) {
      const service = entries.get(key) as CanvasServiceMap[typeof key] | undefined
      if (service) return service
      throw new Error(`Canvas service is not registered: ${String(key)}`)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getVersion() {
      return version
    },
  }
}

const CanvasServicesContext = createContext<CanvasServices | null>(null)

export function CanvasServicesProvider(props: { children: ReactNode; services: CanvasServices }) {
  return <CanvasServicesContext value={props.services}>{props.children}</CanvasServicesContext>
}

export function useCanvasServices() {
  const services = useContext(CanvasServicesContext)
  if (services) return services
  throw new Error("CanvasServicesProvider is missing")
}

export function useCanvasService<K extends keyof CanvasServiceMap>(key: K) {
  const services = useCanvasServices()
  useSyncExternalStore(services.subscribe, services.getVersion, services.getVersion)
  return services.get(key)
}
