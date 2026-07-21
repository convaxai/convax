import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react"
import type { ToolInputField, ToolInputValue } from "@convax/ui"
import type { CanvasResourceSource } from "./application"
import type { CanvasDocument, CanvasNode, CanvasPoint } from "./types"

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
}

export interface CanvasResourceHydrationService {
  markStale(document: CanvasDocument): CanvasDocument
  hydrateStale(input: { document: CanvasDocument; signal: AbortSignal }): Promise<CanvasDocument>
}

export class CanvasTextResourceConflictError extends Error {
  constructor(
    readonly expectedRevision: string,
    readonly actualRevision: string | null,
  ) {
    super("Canvas text resource changed outside Convax")
    this.name = "CanvasTextResourceConflictError"
  }
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
export type CanvasGenerationResultMode = { type: "add" } | { nodeId: string; type: "replace-node" }

export interface CanvasGenerateRequest {
  anchor: CanvasPoint
  expectedRevision: number
  /** Trusted host output cardinality guard; this is never sent to the generation tool. */
  expectedOutputCount?: number
  output?: CanvasGenerationOutput
  prompt: string
  /**
   * Existing Canvas nodes that should be connected to generated results but
   * must not be staged or exposed as generation-tool inputs.
   */
  relationAnchorNodeIds?: readonly string[]
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
  describeTool: (toolId: string, signal?: AbortSignal) => Promise<CanvasGenerationToolDescription>
  generate: (request: CanvasGenerateRequest) => Promise<CanvasGenerateResult>
  listTools: (query: CanvasGenerationToolQuery, signal?: AbortSignal) => Promise<readonly CanvasGenerationToolSummary[]>
}

/**
 * Converts selected public Canvas file nodes with materialized content into semantic generation inputs.
 * Empty cards remain prompt-only output targets; their kind alone is not an input source.
 * First/last-frame roles remain explicit choices for callers and are not guessed from selection order.
 */
export function inferCanvasGenerationReferences(
  nodes: readonly CanvasNode[],
  selectedNodeIds: readonly string[],
): readonly CanvasGenerationReference[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return [...new Set(selectedNodeIds)].flatMap((nodeId) => {
    const node = nodeById.get(nodeId)
    if (!node) return []
    const role = inferCanvasGenerationInputRole(node)
    return role ? [{ nodeId, role }] : []
  })
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

function inferCanvasGenerationInputRole(node: CanvasNode): CanvasGenerationInputRole | undefined {
  if (node.data.kind === "text") {
    return "text" in node.data && typeof node.data.text === "string" && node.data.text.trim() ? "text" : undefined
  }
  if (node.data.kind !== "image" && node.data.kind !== "video" && node.data.kind !== "audio") return undefined
  if (!("url" in node.data) || typeof node.data.url !== "string" || !node.data.url.trim()) return undefined
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

/** Transient presentation state for a direct generation launched from a file card. */
export type CanvasAssistantGenerationActivity =
  | { cancel: () => void; prompt: string; status: "pending" }
  | { status: "complete" }
  | { message: string; prompt: string; status: "error" }

export type CanvasFileGenerationActivity =
  | { status: "idle" }
  | Exclude<CanvasAssistantGenerationActivity, { status: "complete" }>

/** Owns a direct generation for exactly as long as its target file node remains mounted. */
export class CanvasFileGenerationActivityOwner {
  #activity: CanvasFileGenerationActivity = { status: "idle" }
  #cancel: (() => void) | undefined

  get activity() {
    return this.#activity
  }

  apply(activity: CanvasAssistantGenerationActivity): {
    activity: CanvasFileGenerationActivity
    dismissComposer: boolean
  } {
    if (activity.status === "pending") {
      this.#cancel?.()
      this.#cancel = activity.cancel
      this.#activity = activity
      return { activity: this.#activity, dismissComposer: true }
    }
    this.#cancel = undefined
    this.#activity = activity.status === "complete" ? { status: "idle" } : activity
    return { activity: this.#activity, dismissComposer: false }
  }

  dispose() {
    this.#cancel?.()
    this.#cancel = undefined
    this.#activity = { status: "idle" }
  }
}

export interface CanvasAssistantGenerationCapability {
  /** Direct card generation is intentionally limited to visual media replacement. */
  output: "image" | "video"
  /** One-shot in-memory draft restored after an explicit card-generation recovery action. */
  initialPrompt?: string
  /** Persisted owner-node override. Missing means inherit the host's current default. */
  ownerToolId?: string
  /** File-card-only activity notification; this never mutates or persists the Canvas document. */
  onActivityChange?: (activity: CanvasAssistantGenerationActivity) => void
  /** Acknowledges that the one-shot recovery draft was copied into the mounted composer. */
  onInitialPromptConsumed?: () => void
  /** File-card-only mutation; clearing the id restores host-default inheritance. */
  onOwnerToolIdChange?: (toolId?: string) => void
}

export interface CanvasAssistantRequest {
  document: CanvasDocument
  /** Present only when this owner supports direct image/video generation. */
  generation?: CanvasAssistantGenerationCapability
  /** Host-selected context nodes. A file-card owner is carried separately and is not an implicit mention. */
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
