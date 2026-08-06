import type {
  ActualWriteEvidence,
  Digest,
  DocumentOwnerProtocolDefinition,
  OwnerApplyResult,
  OwnerIntentClosureDefinition,
  OwnerHistoryMaterializationDefinition,
  OwnerProcessValueFactory,
  OwnerIntentValidationContext,
  SelectedDocumentOwnerArtifactDefinition,
} from "@convax/collaboration"
import { currentProtocolDescriptor, ownerCanonicalizerDescriptorDigest, parseDigest } from "@convax/collaboration"
import type * as Y from "yjs"
import type { CanvasNodeGeometryUpdate } from "../commands"
import { parseCanvasDocument } from "../document"
import type { CanvasDocument } from "../types"
import {
  createCanvasExternalFactContext,
  discoverCanvasIntentDependencies,
} from "./external-facts"
import {
  constructCanvasHistoryIntent,
  discoverCanvasHistoryIntentDependencies,
} from "./command-construction"
import { assertCanvasTypedIntent, decodeCanvasTypedIntent } from "./intent-validation"
import { projectCanvas } from "./projection"
import { applyCanvasCandidateIntent } from "./reducer"
import type {
  CanvasIntentApplyResult,
  CanvasProjection,
  CanvasSnapshot,
  CanvasEntityRef,
  CanvasTypedIntentUnion,
  Id128,
} from "./types"
import type { CanvasApplicationCommand } from "../application/commands"
import type { CanvasApplicationCommandResult } from "../application/service"
import type { CanvasOptimisticOverlaySnapshot } from "../optimistic-overlay"
import { canvasOwnerCanonicalizerDescriptor } from "./validation"
import { encodeCanvasCanonicalState, validateCanvasYDoc } from "./ydoc"

interface CanvasOwnerResultValue {
  readonly ownerOpaqueResult: CanvasIntentApplyResult
  readonly semanticRootOperationId: Id128 | null
  readonly scope: OwnerIntentValidationContext["scope"]
}

const CANVAS_PROTOCOL_SCHEMA_ARTIFACT_NAME = "canvas-schema"
const CANVAS_PROTOCOL_SCHEMA_ARTIFACT_FORMAT = "convax.canvas-protocol-schema"

/**
 * The Canvas owner schema digest is the current protocol descriptor's
 * domain-separated Canvas artifact. Canvas never anchors a second literal; a
 * missing or renamed artifact fails closed before any decode or commit.
 */
export const CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST: Digest = canvasProtocolSchemaArtifactDigest()

function canvasProtocolSchemaArtifactDigest(): Digest {
  const artifact = currentProtocolDescriptor().artifacts.find(
    (candidate) => candidate.name === CANVAS_PROTOCOL_SCHEMA_ARTIFACT_NAME,
  )
  if (artifact === undefined || artifact.format !== CANVAS_PROTOCOL_SCHEMA_ARTIFACT_FORMAT) {
    throw new TypeError("The current protocol descriptor does not name the Canvas owner schema artifact")
  }
  return parseDigest(artifact.digest)
}

export const selectedCanvasDocumentOwnerArtifactDefinition: SelectedDocumentOwnerArtifactDefinition<"canvas"> =
  Object.freeze({
    owner: "canvas",
    createDefinitions(processValues: OwnerProcessValueFactory<"canvas">) {
      const protocol = createCanvasProtocolDefinition(processValues)
      const closure = createCanvasClosureDefinition()
      return Object.freeze({ protocol, closure })
    },
  })

function createCanvasProtocolDefinition(
  processValues: OwnerProcessValueFactory<"canvas">,
): DocumentOwnerProtocolDefinition<"canvas"> {
  const schemaDigest = CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST
  const canonicalizerDescriptor = canvasOwnerCanonicalizerDescriptor(schemaDigest)
  const canonicalizerDigest = ownerCanonicalizerDescriptorDigest(canonicalizerDescriptor)
  return Object.freeze({
    owner: "canvas",
    schemaDigest,
    canonicalizerDescriptor,
    canonicalizerDigest,
    decodeIntent(exactJcs: Uint8Array) {
      try {
        return decodeCanvasTypedIntent(exactJcs)
      } catch {
        return "rejected"
      }
    },
    validateBase(document: Y.Doc) {
      try {
        return processValues.wrapValidatedState(validateCanvasYDoc(document))
      } catch {
        return "rejected"
      }
    },
    applyIntent(
      candidate: Y.Doc,
      outerContext: OwnerIntentValidationContext,
      intent: unknown,
      facts: import("@convax/collaboration").OwnerExternalFactPort<"canvas">,
    ) {
      try {
        assertCanvasTypedIntent(intent)
      } catch {
        return "rejected"
      }
      const factContext = createCanvasExternalFactContext(outerContext, intent, facts)
      if (factContext === "pending" || factContext === "rejected") return factContext
      const result = applyCanvasCandidateIntent(candidate, outerContext, intent, factContext)
      if (result === "pending" || result === "rejected") return result
      return processValues.wrapApplyResult(Object.freeze({
        ownerOpaqueResult: result,
        semanticRootOperationId: result.semanticHistoryRoot?.rootOperationId ?? null,
        scope: outerContext.scope,
      } satisfies CanvasOwnerResultValue))
    },
    validatePost(
      _base: import("@convax/collaboration").OwnerValidatedState<"canvas">,
      candidate: Y.Doc,
      result: OwnerApplyResult<"canvas">,
    ) {
      try {
        const snapshot = validateCanvasYDoc(candidate)
        if (canvasOwnerResultValue(result) === null) return "rejected"
        return processValues.wrapValidatedState(snapshot)
      } catch {
        return "rejected"
      }
    },
    canonicalStateBytes(document: Y.Doc) {
      try {
        return encodeCanvasCanonicalState(document)
      } catch {
        return "rejected"
      }
    },
    deriveActualWriteEvidence(result: OwnerApplyResult<"canvas">) {
      const value = canvasOwnerResultValue(result)
      if (value === null) throw new TypeError("Canvas owner result is invalid")
      const evidence = value.ownerOpaqueResult.actualWriteEvidence
      return {
        format: "convax.actual-write-evidence",
        scope: value.scope,
        owner: "canvas",
        ownerSchemaDigest: schemaDigest,
        intentDigest: value.ownerOpaqueResult.receipt.intentDigest,
        changedPaths: evidence.changedPaths,
        writes: evidence.writes,
      } satisfies ActualWriteEvidence
    },
  })
}

function createCanvasClosureDefinition(): OwnerIntentClosureDefinition<"canvas"> {
  return Object.freeze({
    inspectIntent(intent: unknown) {
      try {
        assertCanvasTypedIntent(intent)
        if (intent.kind === "canvas.undo.semantic-inverse")
          return Object.freeze({ kind: "history", direction: "undo", rootOperationId: intent.guard.rootOperationId })
        if (intent.kind === "canvas.redo.semantic-forward")
          return Object.freeze({ kind: "history", direction: "redo", rootOperationId: intent.guard.rootOperationId })
        return Object.freeze({ kind: "ordinary" })
      } catch {
        return "rejected"
      }
    },
    discoverDependencies(input: Parameters<OwnerIntentClosureDefinition<"canvas">["discoverDependencies"]>[0]) {
      try {
        assertCanvasTypedIntent(input.intent)
        return discoverCanvasIntentDependencies(input.context, input.intent)
      } catch {
        return "rejected"
      }
    },
    history: Object.freeze({
      discoverDependencies(input: Parameters<OwnerHistoryMaterializationDefinition<"canvas">["discoverDependencies"]>[0]) {
        const base = canvasSnapshotFromValidatedOwnerState(input.base)
        if (base === null) return "rejected"
        return discoverCanvasHistoryIntentDependencies({
          snapshot: base,
          context: input.context,
          direction: input.direction,
          rootOperationId: input.rootOperationId,
        })
      },
      materialize(input: Parameters<OwnerHistoryMaterializationDefinition<"canvas">["materialize"]>[0]) {
        const base = canvasSnapshotFromValidatedOwnerState(input.base)
        if (base === null) return "rejected"
        const constructed = constructCanvasHistoryIntent({
          snapshot: base,
          context: input.context,
          direction: input.direction,
          rootOperationId: input.rootOperationId,
          externalFacts: input.externalFacts,
        })
        return typeof constructed === "string" ? constructed : constructed.intent
      },
    }),
  })
}

export function canvasSnapshotFromValidatedOwnerState(
  base: import("@convax/collaboration").OwnerValidatedState<"canvas">,
): CanvasSnapshot | null {
  const value = base.value
  if (
    typeof value !== "object" ||
    value === null ||
    !(value as { nodes?: unknown }).nodes ||
    !((value as { nodes: unknown }).nodes instanceof Map) ||
    !((value as { edges?: unknown }).edges instanceof Map) ||
    !((value as { semanticHistory?: unknown }).semanticHistory instanceof Map) ||
    !((value as { operations?: unknown }).operations instanceof Map)
  ) return null
  return value as CanvasSnapshot
}

function canvasOwnerResultValue(result: OwnerApplyResult<"canvas">): CanvasOwnerResultValue | null {
  const value = result.value
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ownerOpaqueResult?: unknown }).ownerOpaqueResult === "object" &&
    (value as { ownerOpaqueResult: { format?: unknown } }).ownerOpaqueResult.format === "convax.canvas-intent-result"
  ) ? value as CanvasOwnerResultValue : null
}

export interface CanvasRendererProjectionStore {
  getProjection(): CanvasDocument
  resolveNodeEntity(nodeId: string): (CanvasEntityRef & { readonly kind: "node" }) | undefined
  subscribe(listener: () => void): () => void
}

export type CanvasRendererCommand = Readonly<{
  format: "convax.canvas-renderer-command"
  kind: "canvas.nodes.set-geometry"
  body: Readonly<{
    updates: readonly Readonly<{
      node: CanvasEntityRef & { readonly kind: "node" }
      position: Readonly<{ x: number; y: number }>
      size?: Readonly<{ width: number; height: number }> | null
    }>[]
  }>
}>

/** Disposable renderer projection and typed-command proxy; never a Y.Doc owner. */
export interface CanvasRendererCollaborationClient extends CanvasRendererProjectionStore {
  readonly authority: "project-collaboration-application"
  readonly undoModel: "project-yjs-semantic-history"
  readonly visualOverlay?: Readonly<{
    getSnapshot(): CanvasOptimisticOverlaySnapshot
    subscribe(listener: () => void): () => void
  }>
  canRedo(): boolean
  canUndo(): boolean
  drain(signal?: AbortSignal): Promise<void>
  executeApplication(command: CanvasApplicationCommand, signal?: AbortSignal): Promise<CanvasApplicationCommandResult>
  flush(signal?: AbortSignal): Promise<void>
  redo(signal?: AbortSignal): Promise<CanvasRendererHistoryTransitionResult | null>
  refresh(signal?: AbortSignal): Promise<void>
  submit(command: CanvasRendererCommand, signal?: AbortSignal): Promise<void>
  undo(signal?: AbortSignal): Promise<CanvasRendererHistoryTransitionResult | null>
}

export interface CanvasRendererHistoryTransitionResult {
  readonly direction: "undo" | "redo"
  readonly rootOperationId: Id128
}

export function createReadonlyCanvasProjectionBootstrap(
  initialProjection: CanvasDocument,
): CanvasRendererProjectionStore {
  const parsed = parseCanvasDocument(initialProjection, initialProjection.id)
  if (!parsed) throw new Error("Readonly Canvas bootstrap projection is invalid")
  const projection = structuredClone(parsed)
  return Object.freeze({
    getProjection: () => projection,
    resolveNodeEntity: () => undefined,
    subscribe: () => () => undefined,
  })
}

export function canvasGeometryCommand(
  updates: readonly CanvasNodeGeometryUpdate[],
  resolveNodeEntity: (nodeId: string) => CanvasEntityRef | undefined,
): CanvasRendererCommand {
  const bodyUpdates = updates.map((update) => {
    const node = resolveNodeEntity(update.nodeId)
    if (!node || node.kind !== "node") throw new Error(`Canvas geometry command cannot resolve live node ${update.nodeId}`)
    return Object.freeze({
      node: Object.freeze({ kind: "node" as const, id: node.id, incarnation: node.incarnation }),
      position: Object.freeze({ ...update.position }),
      ...(update.size === undefined ? {} : { size: Object.freeze({ ...update.size }) }),
    })
  })
  if (bodyUpdates.length === 0 || bodyUpdates.length > 256)
    throw new Error("Canvas geometry command must contain 1..256 updates")
  return Object.freeze({
    format: "convax.canvas-renderer-command",
    kind: "canvas.nodes.set-geometry",
    body: Object.freeze({ updates: Object.freeze(bodyUpdates) }),
  })
}

/** Converts one completed React Flow gesture into one bounded host command. */
export async function submitCanvasGeometryGesture(
  session: CanvasRendererCollaborationClient,
  start: CanvasDocument,
  preview: CanvasDocument,
  signal?: AbortSignal,
): Promise<boolean> {
  if (start.id !== preview.id) throw new Error("Canvas geometry gesture crossed document scope")
  const startById = new Map(start.nodes.map((node) => [node.id, node]))
  const updates = preview.nodes.flatMap((node) => {
    const previous = startById.get(node.id)
    if (!previous || (previous.position.x === node.position.x && previous.position.y === node.position.y)) return []
    return [{ nodeId: node.id, position: { ...node.position } }]
  })
  if (updates.length === 0) return false
  await session.submit(canvasGeometryCommand(updates, session.resolveNodeEntity.bind(session)), signal)
  return true
}

export type CanvasIntentCaller = "ui" | "agent" | "plugin"

export interface CanvasDurableIntentCommit {
  readonly operationId: Id128
  readonly projection: CanvasProjection
  readonly semanticRootOperationId: Id128 | null
}

export interface CanvasIntentCommitPort {
  commit(intent: CanvasCallerIntent, signal?: AbortSignal): Promise<CanvasDurableIntentCommit>
}

export type CanvasCallerIntent = Exclude<
  CanvasTypedIntentUnion,
  { readonly kind: "canvas.undo.semantic-inverse" | "canvas.redo.semantic-forward" }
>

/** One service for UI, Agent and Plugin. Caller kind is audit metadata only. */
export class CanvasIntentApplicationService {
  constructor(private readonly commits: CanvasIntentCommitPort) {}

  async apply(
    _caller: CanvasIntentCaller,
    intent: CanvasCallerIntent,
    signal?: AbortSignal,
  ): Promise<CanvasDurableIntentCommit> {
    assertNotAborted(signal)
    assertCanvasTypedIntent(intent)
    const committed = await this.commits.commit(intent, signal)
    assertNotAbortedAfterDurability(signal)
    return committed
  }
}

export interface CanvasTransientViewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** React Flow owns no history or document state; this cache is disposable. */
export class CanvasReactFlowTransientState {
  private readonly measured = new Map<string, { width: number; height: number }>()
  private readonly selected = new Set<string>()
  private drag: { readonly entityKey: string; readonly startX: number; readonly startY: number } | null = null
  private connectionPreview: Readonly<{ sourceKey: string; targetPoint: { x: number; y: number } }> | null = null
  private viewport: CanvasTransientViewport = { x: 0, y: 0, zoom: 1 }

  reconcile(projection: CanvasProjection): void {
    const live = new Set(projection.nodes.map((node) => `${node.ref.kind}/${node.ref.id}/${node.ref.incarnation}`))
    for (const key of this.measured.keys()) if (!live.has(key)) this.measured.delete(key)
    for (const key of this.selected) if (!live.has(key)) this.selected.delete(key)
    if (this.drag !== null && !live.has(this.drag.entityKey)) this.drag = null
    if (this.connectionPreview !== null && !live.has(this.connectionPreview.sourceKey)) {
      this.connectionPreview = null
    }
  }

  /** Clears one mounted view scope without producing document or history state. */
  resetScope(): void {
    this.measured.clear()
    this.selected.clear()
    this.drag = null
    this.connectionPreview = null
    this.viewport = { x: 0, y: 0, zoom: 1 }
  }

  setMeasured(entityKey: string, size: { width: number; height: number }): void {
    this.measured.set(entityKey, { ...size })
  }
  setSelected(entityKeys: readonly string[]): void {
    this.selected.clear()
    for (const key of entityKeys) this.selected.add(key)
  }
  beginDrag(entityKey: string, startX: number, startY: number): void {
    this.drag = { entityKey, startX, startY }
  }
  cancelGesture(): void {
    this.drag = null
    this.connectionPreview = null
  }
  setConnectionPreview(value: CanvasReactFlowTransientState["connectionPreview"]): void {
    this.connectionPreview = value
  }
  setViewport(value: CanvasTransientViewport): void {
    this.viewport = { ...value }
  }
  snapshot() {
    return Object.freeze({
      measured: new Map(this.measured),
      selected: new Set(this.selected),
      drag: this.drag,
      connectionPreview: this.connectionPreview,
      viewport: this.viewport,
    })
  }
}

export function projectReadonlyCanvas(document: Y.Doc): CanvasProjection {
  return projectCanvas(validateCanvasYDoc(document))
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
}

function assertNotAbortedAfterDurability(_signal?: AbortSignal): void {
  // Cancellation after durable head suppresses view work only; domain success is
  // returned and never inverted.
}
