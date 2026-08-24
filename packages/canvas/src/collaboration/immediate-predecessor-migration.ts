import {
  canonicalStateDigest,
  documentScopeDigest,
  encodeRestrictedJcs,
  parseCanvasId,
  parseDigest,
  type Digest,
  type DocumentScope,
  type ReplicaId,
} from "@convax/collaboration"
import { IMMEDIATE_PREDECESSOR_PROTOCOL } from "@convax/collaboration/migration"
import * as Y from "yjs"

import type { CanvasIdentity } from "./types"
import { canvasDigest } from "./validation"
import {
  CANVAS_ROOT_KEYS,
  createCanvasMigrationImportYDoc,
  createCanvasYDoc,
  extractCanvasCanonicalState,
  getCanvasRoot,
  validateCanvasYDoc,
} from "./ydoc"

export interface RebuildImmediatePredecessorCanvasInput {
  readonly predecessorDocument: Y.Doc
  readonly predecessorScope: DocumentScope
  readonly currentScope: DocumentScope
  readonly currentOwnerSchemaDigest: Digest
  readonly currentProtocolDigest: Digest
  readonly currentProjectIndexRouteDependencyDigest: Digest
  readonly checkpointAuthorReplicaId: ReplicaId
}

/**
 * Canvas-owned compatibility gate for the one immediate predecessor. It first
 * proves the old identity and canonical bytes, then copies only live schema
 * values into a freshly-authored current document. No predecessor Yjs structs
 * or decoder remain in the returned genesis candidate.
 */
export function rebuildImmediatePredecessorCanvasDocument(
  input: RebuildImmediatePredecessorCanvasInput,
): Readonly<{ predecessorCanonicalStateDigest: Digest; currentDocument: Y.Doc }> {
  const predecessorIdentity = readImmediatePredecessorIdentity(
    input.predecessorDocument,
    input.predecessorScope,
  )
  const currentDocument = createCanvasMigrationImportYDoc(
    input.currentScope,
    parseDigest(input.currentOwnerSchemaDigest),
    parseDigest(input.currentProtocolDigest),
    parseDigest(input.currentProjectIndexRouteDependencyDigest),
    input.checkpointAuthorReplicaId,
  )
  try {
    copyLiveCanvasState(input.predecessorDocument, currentDocument)
    const currentSnapshot = validateCanvasYDoc(currentDocument, input.currentScope)
    const predecessorCanonicalBytes = encodeRestrictedJcs({
      ...extractCanvasCanonicalState(currentDocument, input.currentScope),
      identity: predecessorIdentity,
    })
    // The copied current snapshot must account for every durable collection;
    // this also rejects predecessor data that the current owner cannot express.
    if (
      currentSnapshot.nodes.size !== collectionSize(input.predecessorDocument, "nodes") ||
      currentSnapshot.edges.size !== collectionSize(input.predecessorDocument, "edges") ||
      currentSnapshot.semanticHistory.size !== collectionSize(input.predecessorDocument, "semanticHistory") ||
      currentSnapshot.operations.size !== collectionSize(input.predecessorDocument, "operations")
    ) throw new TypeError("Immediate-predecessor Canvas copy omitted durable state")
    return Object.freeze({
      predecessorCanonicalStateDigest: canonicalStateDigest(
        IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest,
        predecessorCanonicalBytes,
      ),
      currentDocument,
    })
  } catch (error) {
    currentDocument.destroy()
    throw error
  }
}

/** Migration-only owner projection used while replaying verified predecessor frames. */
export function immediatePredecessorCanvasCanonicalStateDigest(input: {
  readonly predecessorDocument: Y.Doc
  readonly predecessorScope: DocumentScope
  readonly currentOwnerSchemaDigest: Digest
  readonly currentProtocolDigest: Digest
  readonly checkpointAuthorReplicaId: ReplicaId
}): Digest {
  const predecessorIdentity = readImmediatePredecessorIdentity(
    input.predecessorDocument,
    input.predecessorScope,
  )
  const document = createCanvasYDoc(
    input.predecessorScope,
    parseDigest(input.currentOwnerSchemaDigest),
    parseDigest(input.currentProtocolDigest),
    predecessorIdentity.projectIndexRouteDependencyFrameDigest,
    input.checkpointAuthorReplicaId,
  )
  try {
    copyLiveCanvasState(input.predecessorDocument, document)
    validateCanvasYDoc(document, input.predecessorScope)
    return predecessorCanvasCanonicalDigest(document, input.predecessorScope, predecessorIdentity)
  } finally {
    document.destroy()
  }
}

function predecessorCanvasCanonicalDigest(
  currentDocument: Y.Doc,
  scope: DocumentScope,
  predecessorIdentity: ImmediatePredecessorCanvasIdentity,
): Digest {
  return canonicalStateDigest(
    IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest,
    encodeRestrictedJcs({
      ...extractCanvasCanonicalState(currentDocument, scope),
      identity: predecessorIdentity,
    }),
  )
}

type ImmediatePredecessorCanvasIdentity = Omit<CanvasIdentity, "projectIndexRouteDependency"> & Readonly<{
  projectIndexRouteDependencyFrameDigest: Digest
}>

function readImmediatePredecessorIdentity(
  document: Y.Doc,
  scope: DocumentScope,
): ImmediatePredecessorCanvasIdentity {
  const root = getCanvasRoot(document)
  const identityMap = root.get("identity")
  if (!(identityMap instanceof Y.Map)) throw new TypeError("Immediate-predecessor Canvas identity is missing")
  const identity = Object.freeze(Object.fromEntries(identityMap.entries())) as unknown as ImmediatePredecessorCanvasIdentity
  if (
    identity.format !== "convax.canvas" ||
    parseCanvasId(identity.canvasId) !== scope.docId ||
    parseDigest(identity.scopeId) !== documentScopeDigest(scope) ||
    parseDigest(identity.ownerSchemaDigest) !== IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest ||
    parseDigest(identity.protocolDigest) !== IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest ||
    parseDigest(identity.canonicalizerDigest) !== IMMEDIATE_PREDECESSOR_PROTOCOL.canvasCanonicalizerDigest ||
    parseDigest(identity.genesisDigest) !== canvasDigest(
      "convax.canvas-genesis-core",
      immediatePredecessorCanvasGenesisCore(identity),
    )
  ) throw new TypeError("Canvas identity is not the sealed immediate predecessor")
  return identity
}

function immediatePredecessorCanvasGenesisCore(identity: ImmediatePredecessorCanvasIdentity) {
  return Object.freeze({
    format: "convax.canvas-genesis-core" as const,
    scopeId: identity.scopeId,
    canvasId: identity.canvasId,
    ownerSchemaDigest: identity.ownerSchemaDigest,
    protocolDigest: identity.protocolDigest,
    canonicalizerDigest: identity.canonicalizerDigest,
    projectIndexRouteDependencyFrameDigest: identity.projectIndexRouteDependencyFrameDigest,
  })
}

function copyLiveCanvasState(source: Y.Doc, target: Y.Doc): void {
  const sourceRoot = getCanvasRoot(source)
  const targetRoot = getCanvasRoot(target)
  target.transact(() => {
    for (const key of CANVAS_ROOT_KEYS) {
      if (key === "identity") continue
      targetRoot.set(key, cloneYValue(sourceRoot.get(key), `convax.canvas.${key}`))
    }
  }, "canvas-immediate-predecessor-migration")
}

function collectionSize(document: Y.Doc, key: string): number {
  const value = getCanvasRoot(document).get(key)
  if (!(value instanceof Y.Map)) throw new TypeError(`Immediate-predecessor Canvas ${key} is not a map`)
  return value.size
}

function cloneYValue(value: unknown, label: string): unknown {
  if (value instanceof Y.Map) {
    const result = new Y.Map<unknown>()
    for (const [key, child] of value.entries()) result.set(key, cloneYValue(child, `${label}.${key}`))
    return result
  }
  if (value instanceof Y.Array) {
    const result = new Y.Array<unknown>()
    result.insert(0, value.toArray().map((child, index) => cloneYValue(child, `${label}[${index}]`)))
    return result
  }
  if (value instanceof Y.Text) return new Y.Text(value.toString())
  if (value instanceof Uint8Array) return Uint8Array.from(value)
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((child, index) => cloneYValue(child, `${label}[${index}]`))
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneYValue(child, `${label}.${key}`)]))
  }
  throw new TypeError(`Immediate-predecessor Canvas contains unsupported Yjs value at ${label}`)
}
