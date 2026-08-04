import type {
  ActualWriteEvidenceV2,
  DigestV2,
  DocumentOwnerProtocolDefinitionV2,
  OwnerApplyResultV2,
  OwnerIntentClosureDefinitionV2,
  OwnerHistoryMaterializationDefinitionV2,
  OwnerProcessValueFactoryV2,
  OwnerIntentValidationContextV2,
  SelectedDocumentOwnerArtifactDefinitionV2,
} from "@convax/collaboration"
import { ownerCanonicalizerDescriptorDigestV2, parseDigestV2 } from "@convax/collaboration"
import type * as Y from "yjs"
import type { CanvasNodeGeometryUpdate } from "../commands"
import { parseCanvasDocument } from "../document"
import type { CanvasDocument } from "../types"
import {
  createCanvasExternalFactContextV2,
  discoverCanvasIntentDependenciesV2,
} from "./external-facts"
import {
  constructCanvasHistoryIntentV2,
  discoverCanvasHistoryIntentDependenciesV2,
} from "./command-construction"
import { assertCanvasTypedIntentV2, decodeCanvasTypedIntentV2 } from "./intent-validation"
import { projectCanvasV2 } from "./projection"
import { applyCanvasCandidateIntentV2 } from "./reducer"
import type {
  CanvasIntentApplyResultV2,
  CanvasProjectionV2,
  CanvasSnapshotV2,
  CanvasEntityRefV2,
  CanvasTypedIntentUnionV2,
  Id128V2,
} from "./types"
import { canvasOwnerCanonicalizerDescriptorV2 } from "./validation"
import { encodeCanvasCanonicalStateV2, validateCanvasYDocV2 } from "./ydoc"

interface CanvasOwnerResultValueV2 {
  readonly ownerOpaqueResult: CanvasIntentApplyResultV2
  readonly semanticRootOperationId: Id128V2 | null
  readonly scope: OwnerIntentValidationContextV2["scope"]
}

export const CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2: DigestV2 = parseDigestV2(
  "cb69352106c9fc61d28c6412b22b7efb453cd7b9db5324946c0d978772c54d36",
)

export const selectedCanvasDocumentOwnerArtifactDefinitionV2: SelectedDocumentOwnerArtifactDefinitionV2<"canvas"> =
  Object.freeze({
    owner: "canvas",
    createDefinitions(processValues: OwnerProcessValueFactoryV2<"canvas">) {
      const protocol = createCanvasProtocolDefinitionV2(processValues)
      const closure = createCanvasClosureDefinitionV2()
      return Object.freeze({ protocol, closure })
    },
  })

function createCanvasProtocolDefinitionV2(
  processValues: OwnerProcessValueFactoryV2<"canvas">,
): DocumentOwnerProtocolDefinitionV2<"canvas"> {
  const schemaDigest = CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2
  const canonicalizerDescriptor = canvasOwnerCanonicalizerDescriptorV2(schemaDigest)
  const canonicalizerDigest = ownerCanonicalizerDescriptorDigestV2(canonicalizerDescriptor)
  return Object.freeze({
    owner: "canvas",
    schemaDigest,
    canonicalizerDescriptor,
    canonicalizerDigest,
    decodeIntent(exactJcs: Uint8Array) {
      try {
        return decodeCanvasTypedIntentV2(exactJcs)
      } catch {
        return "rejected"
      }
    },
    validateBase(document: Y.Doc) {
      try {
        return processValues.wrapValidatedState(validateCanvasYDocV2(document))
      } catch {
        return "rejected"
      }
    },
    applyIntent(
      candidate: Y.Doc,
      outerContext: OwnerIntentValidationContextV2,
      intent: unknown,
      facts: import("@convax/collaboration").OwnerExternalFactPortV2<"canvas">,
    ) {
      try {
        assertCanvasTypedIntentV2(intent)
      } catch {
        return "rejected"
      }
      const factContext = createCanvasExternalFactContextV2(outerContext, intent, facts)
      if (factContext === "pending" || factContext === "rejected") return factContext
      const result = applyCanvasCandidateIntentV2(candidate, outerContext, intent, factContext)
      if (result === "pending" || result === "rejected") return result
      return processValues.wrapApplyResult(Object.freeze({
        ownerOpaqueResult: result,
        semanticRootOperationId: result.semanticHistoryRoot?.rootOperationId ?? null,
        scope: outerContext.scope,
      } satisfies CanvasOwnerResultValueV2))
    },
    validatePost(
      _base: import("@convax/collaboration").OwnerValidatedStateV2<"canvas">,
      candidate: Y.Doc,
      result: OwnerApplyResultV2<"canvas">,
    ) {
      try {
        const snapshot = validateCanvasYDocV2(candidate)
        if (canvasOwnerResultValue(result) === null) return "rejected"
        return processValues.wrapValidatedState(snapshot)
      } catch {
        return "rejected"
      }
    },
    canonicalStateBytes(document: Y.Doc) {
      try {
        return encodeCanvasCanonicalStateV2(document)
      } catch {
        return "rejected"
      }
    },
    deriveActualWriteEvidence(result: OwnerApplyResultV2<"canvas">) {
      const value = canvasOwnerResultValue(result)
      if (value === null) throw new TypeError("Canvas owner result is invalid")
      const evidence = value.ownerOpaqueResult.actualWriteEvidence
      return {
        format: "convax.actual-write-evidence/2",
        scope: value.scope,
        owner: "canvas",
        ownerSchemaDigest: schemaDigest,
        intentDigest: value.ownerOpaqueResult.receipt.intentDigest,
        changedPaths: evidence.changedPaths,
        writes: evidence.writes,
      } satisfies ActualWriteEvidenceV2
    },
  })
}

function createCanvasClosureDefinitionV2(): OwnerIntentClosureDefinitionV2<"canvas"> {
  return Object.freeze({
    inspectIntent(intent: unknown) {
      try {
        assertCanvasTypedIntentV2(intent)
        if (intent.kind === "canvas.undo.semantic-inverse/2")
          return Object.freeze({ kind: "history", direction: "undo", rootOperationId: intent.guard.rootOperationId })
        if (intent.kind === "canvas.redo.semantic-forward/2")
          return Object.freeze({ kind: "history", direction: "redo", rootOperationId: intent.guard.rootOperationId })
        return Object.freeze({ kind: "ordinary" })
      } catch {
        return "rejected"
      }
    },
    discoverDependencies(input: Parameters<OwnerIntentClosureDefinitionV2<"canvas">["discoverDependencies"]>[0]) {
      try {
        assertCanvasTypedIntentV2(input.intent)
        return discoverCanvasIntentDependenciesV2(input.context, input.intent)
      } catch {
        return "rejected"
      }
    },
    history: Object.freeze({
      discoverDependencies(input: Parameters<OwnerHistoryMaterializationDefinitionV2<"canvas">["discoverDependencies"]>[0]) {
        const base = canvasSnapshotFromValidatedOwnerStateV2(input.base)
        if (base === null) return "rejected"
        return discoverCanvasHistoryIntentDependenciesV2({
          snapshot: base,
          context: input.context,
          direction: input.direction,
          rootOperationId: input.rootOperationId,
        })
      },
      materialize(input: Parameters<OwnerHistoryMaterializationDefinitionV2<"canvas">["materialize"]>[0]) {
        const base = canvasSnapshotFromValidatedOwnerStateV2(input.base)
        if (base === null) return "rejected"
        const constructed = constructCanvasHistoryIntentV2({
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

export function canvasSnapshotFromValidatedOwnerStateV2(
  base: import("@convax/collaboration").OwnerValidatedStateV2<"canvas">,
): CanvasSnapshotV2 | null {
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
  return value as CanvasSnapshotV2
}

function canvasOwnerResultValue(result: OwnerApplyResultV2<"canvas">): CanvasOwnerResultValueV2 | null {
  const value = result.value
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ownerOpaqueResult?: unknown }).ownerOpaqueResult === "object" &&
    (value as { ownerOpaqueResult: { format?: unknown } }).ownerOpaqueResult.format === "convax.canvas-intent-result/2"
  ) ? value as CanvasOwnerResultValueV2 : null
}

export interface CanvasRendererProjectionStoreV2 {
  getProjection(): CanvasDocument
  resolveNodeEntity(nodeId: string): (CanvasEntityRefV2 & { readonly kind: "node" }) | undefined
  subscribe(listener: () => void): () => void
}

export type CanvasRendererCommandV2 = Readonly<{
  format: "convax.canvas-renderer-command/2"
  kind: "canvas.nodes.set-geometry/2"
  body: Readonly<{
    updates: readonly Readonly<{
      node: CanvasEntityRefV2 & { readonly kind: "node" }
      position: Readonly<{ x: number; y: number }>
      size?: Readonly<{ width: number; height: number }> | null
    }>[]
  }>
}>

/** Disposable renderer projection and typed-command proxy; never a Y.Doc owner. */
export interface CanvasRendererCollaborationClientV2 extends CanvasRendererProjectionStoreV2 {
  readonly authority: "project-collaboration-application"
  readonly undoModel: "project-yjs-semantic-history"
  canRedo(): boolean
  canUndo(): boolean
  flush(signal?: AbortSignal): Promise<void>
  redo(signal?: AbortSignal): Promise<void>
  submit(command: CanvasRendererCommandV2, signal?: AbortSignal): Promise<void>
  undo(signal?: AbortSignal): Promise<void>
}

export function createReadonlyCanvasProjectionBootstrapV2(
  initialProjection: CanvasDocument,
): CanvasRendererProjectionStoreV2 {
  const parsed = parseCanvasDocument(initialProjection, initialProjection.id)
  if (!parsed) throw new Error("Readonly Canvas bootstrap projection is invalid")
  const projection = structuredClone(parsed)
  return Object.freeze({
    getProjection: () => projection,
    resolveNodeEntity: () => undefined,
    subscribe: () => () => undefined,
  })
}

export function canvasGeometryCommandV2(
  updates: readonly CanvasNodeGeometryUpdate[],
  resolveNodeEntity: (nodeId: string) => CanvasEntityRefV2 | undefined,
): CanvasRendererCommandV2 {
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
    format: "convax.canvas-renderer-command/2",
    kind: "canvas.nodes.set-geometry/2",
    body: Object.freeze({ updates: Object.freeze(bodyUpdates) }),
  })
}

/** Converts one completed React Flow gesture into one bounded host command. */
export async function submitCanvasGeometryGestureV2(
  session: CanvasRendererCollaborationClientV2,
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
  await session.submit(canvasGeometryCommandV2(updates, session.resolveNodeEntity.bind(session)), signal)
  return true
}

export type CanvasIntentCallerV2 = "ui" | "agent" | "plugin"

export interface CanvasDurableIntentCommitV2 {
  readonly operationId: Id128V2
  readonly projection: CanvasProjectionV2
  readonly semanticRootOperationId: Id128V2 | null
}

export interface CanvasIntentCommitPortV2 {
  commit(intent: CanvasCallerIntentV2, signal?: AbortSignal): Promise<CanvasDurableIntentCommitV2>
}

export type CanvasCallerIntentV2 = Exclude<
  CanvasTypedIntentUnionV2,
  { readonly kind: "canvas.undo.semantic-inverse/2" | "canvas.redo.semantic-forward/2" }
>

/** One service for UI, Agent and Plugin. Caller kind is audit metadata only. */
export class CanvasIntentApplicationServiceV2 {
  constructor(private readonly commits: CanvasIntentCommitPortV2) {}

  async apply(
    _caller: CanvasIntentCallerV2,
    intent: CanvasCallerIntentV2,
    signal?: AbortSignal,
  ): Promise<CanvasDurableIntentCommitV2> {
    assertNotAborted(signal)
    assertCanvasTypedIntentV2(intent)
    const committed = await this.commits.commit(intent, signal)
    assertNotAbortedAfterDurability(signal)
    return committed
  }
}

export interface CanvasTransientViewportV2 {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** React Flow owns no history or document state; this cache is disposable. */
export class CanvasReactFlowTransientStateV2 {
  private readonly measured = new Map<string, { width: number; height: number }>()
  private readonly selected = new Set<string>()
  private drag: { readonly entityKey: string; readonly startX: number; readonly startY: number } | null = null
  private connectionPreview: Readonly<{ sourceKey: string; targetPoint: { x: number; y: number } }> | null = null
  private viewport: CanvasTransientViewportV2 = { x: 0, y: 0, zoom: 1 }

  reconcile(projection: CanvasProjectionV2): void {
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
  setConnectionPreview(value: CanvasReactFlowTransientStateV2["connectionPreview"]): void {
    this.connectionPreview = value
  }
  setViewport(value: CanvasTransientViewportV2): void {
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

export function projectReadonlyCanvasV2(document: Y.Doc): CanvasProjectionV2 {
  return projectCanvasV2(validateCanvasYDocV2(document))
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
}

function assertNotAbortedAfterDurability(_signal?: AbortSignal): void {
  // Cancellation after durable head suppresses view work only; domain success is
  // returned and never inverted.
}
