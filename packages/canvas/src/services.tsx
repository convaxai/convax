import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react"
import type { ToolInputField, ToolInputValue } from "@convax/ui"
import type {
  CanvasGenerationTargetGuard,
  CanvasPreparedResourceRuntime,
  CanvasResourceAnchorOrigin,
  CanvasResourceSource,
} from "./application"
import type { CanvasEntityRef } from "./collaboration"
import type { CanvasDocument, CanvasNode, CanvasPoint, CanvasSize } from "./types"

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
  anchorOrigin?: CanvasResourceAnchorOrigin
  files?: readonly File[]
  pending?: { kind: "image" | "video"; label: string }
  /** Structural Group that owns newly created nodes; `anchor` is local to this Group. */
  parentId?: string
  relation?: {
    anchorNodeIds: readonly string[]
    direction?: "from-anchor" | "to-anchor"
    mode: "connect" | "none"
  }
  sources: readonly CanvasResourceSource[]
  signal: AbortSignal
  transfer?: CanvasResourceMutationTransfer
}

/**
 * Host-neutral, renderer-only presentation for an optimistic resource card.
 * It is never command input or authoritative Canvas geometry.
 */
export interface CanvasOptimisticResourcePresentation {
  intrinsicSize: CanvasSize
  mediaKind: "audio" | "image" | "video"
  /** Short-lived renderer-safe URL used only by the presentation overlay. */
  previewUrl?: string
  title: string
}

export interface CanvasResourceMutationService {
  add(input: CanvasResourceMutationRequest): Promise<{
    /** The host already installed the same-frame authoritative projection. */
    authoritativeProjectionDelivered?: boolean
    createdNodeIds: readonly string[]
    /** Prepared presentation state for the exact accepted resource nodes. Transient only. */
    preparedResources?: readonly CanvasAcceptedPreparedResourceRuntime[]
    warnings: readonly string[]
  }>
  /** Results align with the request's files followed by resolved sources. */
  preparePresentation?(
    input: CanvasResourceMutationRequest,
  ):
    | readonly (CanvasOptimisticResourcePresentation | null)[]
    | Promise<readonly (CanvasOptimisticResourcePresentation | null)[]>
  relink?(input: {
    file?: File
    nodeId: string
    signal: AbortSignal
    source?: Extract<CanvasResourceSource, { kind: "host-directory" | "host-file" }>
  }): Promise<{ authoritativeProjectionDelivered?: boolean; warnings: readonly string[] }>
  saveEditableCopy?(input: { nodeId: string; signal: AbortSignal }): Promise<{
    authoritativeProjectionDelivered?: boolean
    warnings: readonly string[]
  }>
}

/** Prepared state bound to the exact accepted Canvas entity and resource. */
export interface CanvasAcceptedPreparedResourceRuntime extends CanvasPreparedResourceRuntime {
  readonly entity: CanvasEntityRef & { readonly kind: "node" }
  readonly resourceIdentity: string
}

export interface CanvasResourceHydrationService {
  markStale(document: CanvasDocument, nodeIds?: readonly string[]): CanvasDocument
  hydrateStale(input: {
    document: CanvasDocument
    nodeIds?: readonly string[]
    signal: AbortSignal
  }): Promise<CanvasDocument>
}

export interface CanvasFolderBrowseEntry {
  /** Host-opaque identifier that is valid only for the owning folder node. */
  id: string
  kind: "file" | "folder"
  label: string
}

export interface CanvasFolderBrowsePathEntry {
  /** Host-opaque directory identifier passed back to `list`. */
  id: string
  label: string
}

export interface CanvasFolderBrowseListing {
  entries: readonly CanvasFolderBrowseEntry[]
  path: readonly CanvasFolderBrowsePathEntry[]
  totalCount: number
  truncated: boolean
}

/**
 * Host-provided, read-only projection of a folder resource. Canvas treats entry
 * ids as opaque and never persists the returned listing into its document.
 */
export interface CanvasFolderBrowseService {
  list(input: {
    context: CanvasServiceContext
    directoryId?: string
    ownerNodeId: string
    signal: AbortSignal
  }): Promise<CanvasFolderBrowseListing>
  /** Invalidates the active transient listing after host filesystem changes. */
  subscribe?: (listener: () => void) => () => void
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

export interface CanvasTextDraftState {
  baseContent: string
  baseRevision: string
  content: string
  dirty: boolean
  error: string | null
}

export interface CanvasTextDraftKey {
  documentId: string
  nodeId: string
  scopeId: string
}

export interface CanvasTextDraftPersistence {
  describeError(error: unknown): string
  save(state: CanvasTextDraftState): Promise<{ contentRevision: string }>
}

export interface CanvasTextDraftStore {
  clear(key: CanvasTextDraftKey): void
  flush(options?: { onError?: (error: unknown) => void; wait?: boolean }): Promise<void>
  get(key: CanvasTextDraftKey): CanvasTextDraftState | undefined
  hasPending(): boolean
  inFlight(key: CanvasTextDraftKey): Promise<CanvasTextDraftState> | null
  save(key: CanvasTextDraftKey): Promise<CanvasTextDraftState>
  stage(key: CanvasTextDraftKey, state: CanvasTextDraftState, persistence: CanvasTextDraftPersistence): void
  subscribe(key: CanvasTextDraftKey, listener: () => void): () => void
}

export function createCanvasTextDraftState(input: { contentRevision?: string; text?: string }): CanvasTextDraftState {
  const content = input.text ?? ""
  return {
    baseContent: content,
    baseRevision: input.contentRevision ?? "",
    content,
    dirty: false,
    error: null,
  }
}

export function updateCanvasTextDraft(state: CanvasTextDraftState, content: string): CanvasTextDraftState {
  return { ...state, content, dirty: content !== state.baseContent, error: null }
}

export function applyCanvasTextDraftBase(
  state: CanvasTextDraftState,
  input: { contentRevision?: string; text?: string },
): CanvasTextDraftState {
  return state.dirty ? state : createCanvasTextDraftState(input)
}

export function rebaseCanvasTextDraft(
  state: CanvasTextDraftState,
  input: { contentRevision?: string; text?: string },
): CanvasTextDraftState {
  const baseContent = input.text ?? ""
  return {
    baseContent,
    baseRevision: input.contentRevision ?? "",
    content: state.content,
    dirty: state.content !== baseContent,
    error: null,
  }
}

export function failCanvasTextDraftSave(state: CanvasTextDraftState, error: string): CanvasTextDraftState {
  return { ...state, dirty: true, error }
}

export function completeCanvasTextDraftSave(
  state: CanvasTextDraftState,
  contentRevision: string,
): CanvasTextDraftState {
  return {
    baseContent: state.content,
    baseRevision: contentRevision,
    content: state.content,
    dirty: false,
    error: null,
  }
}

export function discardCanvasTextDraft(state: CanvasTextDraftState): CanvasTextDraftState {
  return {
    baseContent: state.baseContent,
    baseRevision: state.baseRevision,
    content: state.baseContent,
    dirty: false,
    error: null,
  }
}

export async function saveCanvasTextDraft(
  state: CanvasTextDraftState,
  nodeId: string,
  service: CanvasTextResourceService,
  signal: AbortSignal,
) {
  if (!state.dirty) return state
  if (!state.baseRevision) throw new Error("Canvas text resource revision is required")
  const result = await service.save({ content: state.content, contentRevision: state.baseRevision, nodeId }, signal)
  return completeCanvasTextDraftSave(state, result.contentRevision)
}

export function createCanvasTextDraftStore(): CanvasTextDraftStore {
  type Entry = { persistence: CanvasTextDraftPersistence; state: CanvasTextDraftState }
  const entries = new Map<string, Entry>()
  const saves = new Map<string, Promise<CanvasTextDraftState>>()
  const listeners = new Map<string, Set<() => void>>()
  const encode = (key: CanvasTextDraftKey) => `${key.scopeId}\u0000${key.documentId}\u0000${key.nodeId}`
  const emit = (encoded: string) => listeners.get(encoded)?.forEach((listener) => listener())

  const store: CanvasTextDraftStore = {
    clear(key) {
      const encoded = encode(key)
      if (!entries.delete(encoded)) return
      emit(encoded)
    },
    async flush(options = {}) {
      const pending = [...entries.entries()]
        .filter(([, entry]) => entry.state.dirty)
        .map(([encoded]) => store.save(decodeDraftKey(encoded)))
      if (options.wait) {
        const results = await Promise.allSettled(pending)
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
        if (failure) throw failure.reason
        return
      }
      for (const operation of pending) void operation.catch((error) => options.onError?.(error))
    },
    get(key) {
      return entries.get(encode(key))?.state
    },
    hasPending() {
      return saves.size > 0 || [...entries.values()].some((entry) => entry.state.dirty)
    },
    inFlight(key) {
      return saves.get(encode(key)) ?? null
    },
    save(key) {
      const encoded = encode(key)
      const inFlight = saves.get(encoded)
      if (inFlight) return inFlight
      const entry = entries.get(encoded)
      if (!entry || !entry.state.dirty) return Promise.resolve(entry?.state ?? createCanvasTextDraftState({}))
      const persistUntilCurrent = async (): Promise<CanvasTextDraftState> => {
        const current = entries.get(encoded) ?? entry
        if (!current.state.dirty) return current.state
        const captured = current.state
        let contentRevision: string
        try {
          const result = await current.persistence.save(captured)
          contentRevision = result.contentRevision
        } catch (error) {
          const latest = entries.get(encoded) ?? current
          const next = failCanvasTextDraftSave(latest.state, latest.persistence.describeError(error))
          entries.set(encoded, { persistence: latest.persistence, state: next })
          emit(encoded)
          throw error
        }
        const latest = entries.get(encoded) ?? current
        const next: CanvasTextDraftState = {
          baseContent: captured.content,
          baseRevision: contentRevision,
          content: latest.state.content,
          dirty: latest.state.content !== captured.content,
          error: null,
        }
        entries.set(encoded, { persistence: latest.persistence, state: next })
        emit(encoded)
        if (next.dirty) return persistUntilCurrent()
        if (!listeners.has(encoded)) entries.delete(encoded)
        return next
      }
      const operation = persistUntilCurrent().finally(() => {
        if (saves.get(encoded) === operation) saves.delete(encoded)
      })
      saves.set(encoded, operation)
      return operation
    },
    stage(key, state, persistence) {
      const encoded = encode(key)
      if (!state.dirty && !entries.has(encoded)) return
      entries.set(encoded, { persistence, state })
      emit(encoded)
    },
    subscribe(key, listener) {
      const encoded = encode(key)
      const current = listeners.get(encoded) ?? new Set()
      current.add(listener)
      listeners.set(encoded, current)
      return () => {
        current.delete(listener)
        if (current.size > 0) return
        listeners.delete(encoded)
        if (!saves.has(encoded) && entries.get(encoded)?.state.dirty === false) entries.delete(encoded)
      }
    },
  }
  return store
}

function decodeDraftKey(encoded: string): CanvasTextDraftKey {
  const [scopeId = "", documentId = "", nodeId = ""] = encoded.split("\u0000")
  return { documentId, nodeId, scopeId }
}

export interface CanvasPendingDraft {
  discard(): void
  inFlightSave(): Promise<void> | null
  isDirty(): boolean
  save(): Promise<void>
}

export interface CanvasPendingDraftRegistry {
  hasPending(): boolean
  pendingCount(): number
  savePending(options?: { onError?: (error: unknown) => void; wait?: boolean }): Promise<void>
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
    async savePending(options = {}) {
      const startedBeforeDecision = settleStartedSaves()
      const pending = pendingDrafts()
      const saves = pending.map((draft) => draft.inFlightSave() ?? draft.save())
      const operations = startedBeforeDecision ? [startedBeforeDecision, ...saves] : saves
      if (!options.wait) {
        for (const operation of operations) void operation.catch((error) => options.onError?.(error))
        return
      }
      const results = await Promise.allSettled(operations)
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
      if (failure) throw failure.reason
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
  | { expectedTarget: CanvasGenerationTargetGuard; nodeId: string; type: "replace-node" }

/** Host-neutral authority that Main must revalidate before staging card-scoped inputs. */
export interface CanvasGenerationReferenceConstraint {
  ownerNodeId: string
  type: "direct-incoming"
}

export interface CanvasGenerateRequest {
  anchor: CanvasPoint
  /** Fresh host operation correlation for this logical submission. */
  operationId?: string
  /** Trusted host output cardinality guard; this is never sent to the generation tool. */
  expectedOutputCount?: number
  output?: CanvasGenerationOutput
  /** Structural Group that owns newly created nodes; `anchor` is local to this Group. */
  parentId?: string
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
  toolId: string
  warnings: readonly string[]
}

export interface CanvasGenerateService {
  /** Host-owned token that changes when installed generation declarations change. */
  readonly catalogVersion?: string | number
  cancel?: (operationId: string) => void | Promise<void>
  /** Synchronous stale-while-revalidate read used to avoid flashing an empty catalog on remount. */
  getCachedDescription?: (toolId: string) => CanvasGenerationToolDescription | undefined
  /** Synchronous stale-while-revalidate read used to share one host catalog across Canvas surfaces. */
  getCachedTools?: (query: CanvasGenerationToolQuery) => readonly CanvasGenerationToolSummary[] | undefined
  /** Notifies mounted Canvas surfaces when the host's shared catalog snapshot changes. */
  subscribeCatalog?: (listener: () => void) => () => void
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
  if ("localPreview" in resourceState && resourceState.localPreview === true) return undefined
  if (!("url" in resourceState) || typeof resourceState.url !== "string" || !resourceState.url.trim()) return undefined
  if (node.data.kind === "image") return "reference_image"
  if (node.data.kind === "video") return "reference_video"
  if (node.data.kind === "audio") return "audio"
  return undefined
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
  /** Initial visual output. Media owners use their own kind; text owners default to one offered kind. */
  output: "image" | "video"
  /** Text owners may offer both visual result kinds without becoming a generation input or replacement target. */
  availableOutputs?: readonly ("image" | "video")[]
  /** One-shot raw composer draft hydrated from the Canvas-owned latest run. */
  initialPrompt?: string
  /**
   * Missing or `replace-owner-node` keeps the normal in-place flow. A true
   * unknown external result must use `create-pending-node` so a fresh operation
   * gets a separate host-owned target without mutating the unresolved owner.
   */
  submissionMode?: "create-pending-node" | "replace-owner-node"
  /** Persisted replacement-owner override. Missing means inherit the host's current default. */
  ownerToolId?: string
  /** Replacement-owner-only mutation; clearing the id restores host-default inheritance. */
  onOwnerToolIdChange?: (toolId?: string) => void
}

export interface CanvasAssistantRequest {
  document: CanvasDocument
  /** Present when this owner can be replaced by or related to a generated image/video result. */
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
  folderBrowse: CanvasFolderBrowseService
  hydration: CanvasResourceHydrationService
  mutation: CanvasResourceMutationService
  generate: CanvasGenerateService
  export: CanvasExportService
  notify: CanvasNotificationService
  telemetry: CanvasTelemetryService
  textResources: CanvasTextResourceService
  textDrafts: CanvasTextDraftStore
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
