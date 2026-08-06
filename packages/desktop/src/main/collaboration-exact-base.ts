import {
  causalFrontierDigest,
  decodeCausalEditFrame,
  frameObjectRefFromDecodedFrame,
  inspectAcceptedFrameObject,
  materializeAcceptedFrame,
  parseDigest,
  parseDocumentScope,
  replicaActorHeadSetDigest,
  type CausalClosurePort,
  type DecodedCausalEditFrame,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type ExactBaseResolverPort,
  type CurrentProtocolAuthority,
  type YjsDocumentFactory,
} from "@convax/collaboration"
import type {
  NodeAcceptedFrameObjectV2,
  NodeAcceptedReplicaHeadV2,
  NodeReplicaHeadMaterializerV2,
} from "@convax/project/node"

export interface AcceptedClosureStoreV2 {
  loadInstalledBase(scope: DocumentScope): Promise<NodeAcceptedReplicaHeadV2>
  listAcceptedFrames(scope: DocumentScope): Promise<readonly NodeAcceptedFrameObjectV2[]>
  readAcceptedFrame(scope: DocumentScope, frameDigest: Digest): Promise<Uint8Array | null>
}

export interface AcceptedCausalClosureIndexV2 extends CausalClosurePort {
  warm(store: AcceptedClosureStoreV2): Promise<NodeAcceptedReplicaHeadV2>
  hydrate(store: AcceptedClosureStoreV2, frameDigest: Digest): Promise<boolean>
  materializationOrder(frontier: DecodedCausalEditFrame["context"]["baseFrontier"]): readonly DecodedCausalEditFrame[] | "pending"
}

/**
 * Main-owned in-memory causal index over Project-owned exact durable bytes. It is
 * disposable reconstruction state, never a second accepted document or store.
 */
export function createAcceptedCausalClosureIndexV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly scope: DocumentScope
}): AcceptedCausalClosureIndexV2 {
  const scope = parseDocumentScope(input.scope)
  const roots = new Set<Digest>()
  const frames = new Map<Digest, DecodedCausalEditFrame>()
  const parents = new Map<Digest, readonly Digest[]>()
  let warmed = false

  const index: AcceptedCausalClosureIndexV2 = {
    contains(descendantInput, ancestorInput) {
      const descendant = parseDigest(descendantInput)
      const ancestor = parseDigest(ancestorInput)
      if (descendant === ancestor) return true
      if (!warmed || (!roots.has(descendant) && !frames.has(descendant))) return "pending"
      // A fully indexed accepted closure cannot contain a frame digest absent from
      // that closure. Below-floor/pruned queries are rejected by the control/floor
      // gate before this process-local index is consulted.
      if (!roots.has(ancestor) && !frames.has(ancestor)) return false
      if (roots.has(descendant)) return false
      if (!parents.has(descendant)) return "pending"
      return containsFrom(descendant, ancestor, new Set())
    },
    async warm(store) {
      if (warmed) throw new Error("Accepted causal closure index was already warmed")
      const base = await store.loadInstalledBase(scope)
      assertSameScope(base.scope, scope)
      for (const head of base.frontier.heads) roots.add(parseDigest(head.frameDigest))
      warmed = true
      for (const object of await store.listAcceptedFrames(scope)) ingest(object)
      return cloneHead(base)
    },
    async hydrate(store, digestInput) {
      requireWarmed()
      return hydrateDigest(store, parseDigest(digestInput), new Set())
    },
    materializationOrder(frontier) {
      requireWarmed()
      const ordered: DecodedCausalEditFrame[] = []
      const emitted = new Set<Digest>()
      for (const head of frontier.heads) {
        if (!append(parseDigest(head.frameDigest), emitted, ordered, new Set())) return "pending"
      }
      return Object.freeze(ordered)
    },
  }
  return Object.freeze(index)

  function ingest(object: NodeAcceptedFrameObjectV2): DecodedCausalEditFrame {
    const frame = inspectAcceptedFrameObject(input.authority, object.ref, object.exactFrameBytes)
    assertSameScope(frame.header.core.scope, scope)
    const digest = parseDigest(frame.frameDigest)
    const existing = frames.get(digest)
    if (existing) {
      if (!sameBytes(existing.bytes, frame.bytes)) throw new Error("Accepted frame digest aliases different exact bytes")
      return existing
    }
    const directParents = Object.freeze(frame.context.baseFrontier.heads.map((head) => parseDigest(head.frameDigest)))
    for (const parent of directParents) {
      if (!roots.has(parent) && !frames.has(parent)) {
        throw new Error("Accepted frame closure has a predecessor outside the installed base and durable suffix")
      }
    }
    frames.set(digest, frame)
    parents.set(digest, directParents)
    return frame
  }

  async function hydrateDigest(
    store: AcceptedClosureStoreV2,
    digest: Digest,
    visiting: Set<Digest>,
  ): Promise<boolean> {
    if (roots.has(digest) || frames.has(digest)) return true
    if (visiting.has(digest)) throw new Error("Accepted causal closure contains a cycle")
    visiting.add(digest)
    try {
      const exact = await store.readAcceptedFrame(scope, digest)
      if (exact === null) return false
      const frame = decodeCausalEditFrame(input.authority, exact)
      if (frame.frameDigest !== digest) throw new Error("Accepted frame lookup returned another digest")
      assertSameScope(frame.header.core.scope, scope)
      for (const parent of frame.context.baseFrontier.heads) {
        if (!await hydrateDigest(store, parseDigest(parent.frameDigest), visiting)) return false
      }
      ingest({ ref: frameObjectRefFromDecodedFrame(frame), exactFrameBytes: exact })
      return true
    } finally {
      visiting.delete(digest)
    }
  }

  function append(
    digest: Digest,
    emitted: Set<Digest>,
    ordered: DecodedCausalEditFrame[],
    visiting: Set<Digest>,
  ): boolean {
    if (roots.has(digest) || emitted.has(digest)) return true
    const frame = frames.get(digest)
    const directParents = parents.get(digest)
    if (!frame || !directParents) return false
    if (visiting.has(digest)) throw new Error("Accepted causal closure contains a cycle")
    visiting.add(digest)
    for (const parent of directParents) if (!append(parent, emitted, ordered, visiting)) return false
    visiting.delete(digest)
    emitted.add(digest)
    ordered.push(frame)
    return true
  }

  function containsFrom(descendant: Digest, ancestor: Digest, visiting: Set<Digest>): boolean | "pending" {
    if (visiting.has(descendant)) throw new Error("Accepted causal closure contains a cycle")
    const directParents = parents.get(descendant)
    if (!directParents) return roots.has(descendant) ? false : "pending"
    visiting.add(descendant)
    let sawPending = false
    for (const parent of directParents) {
      if (parent === ancestor) return true
      const result = containsFrom(parent, ancestor, visiting)
      if (result === true) return true
      if (result === "pending") sawPending = true
    }
    visiting.delete(descendant)
    return sawPending ? "pending" : false
  }

  function requireWarmed(): void {
    if (!warmed) throw new Error("Accepted causal closure index is not warmed")
  }
}

export function createProductionNodeReplicaHeadMaterializerV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly owner: DocumentOwnerRuntime
  readonly causalClosure: CausalClosurePort
  readonly createDocument: YjsDocumentFactory["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrame) => readonly Digest[]
}): NodeReplicaHeadMaterializerV2 {
  const materializer: NodeReplicaHeadMaterializerV2 = {
    async inspectFrame(ref, exactBytes) {
      const frame = inspectAcceptedFrameObject(input.authority, ref, exactBytes)
      const requiredBlobDigests = [...input.requiredBlobDigests(frame)].map(parseDigest).sort()
      for (let index = 1; index < requiredBlobDigests.length; index += 1) {
        if (requiredBlobDigests[index - 1] === requiredBlobDigests[index]) throw new Error("Required blob digest set contains a duplicate")
      }
      return Object.freeze({ ref, requiredBlobDigests: Object.freeze(requiredBlobDigests) })
    },
    async applyAcceptedFrame({ previous, ref, exactBytes }) {
      return materializeAcceptedFrame({
        authority: input.authority,
        owner: input.owner,
        previous,
        ref,
        exactFrameBytes: exactBytes,
        causalClosure: input.causalClosure,
        createDocument: input.createDocument,
      })
    },
    actorHeadsDigest: replicaActorHeadSetDigest,
  }
  return Object.freeze(materializer)
}

export function createDurableExactBaseResolverV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly scope: DocumentScope
  readonly owner: DocumentOwnerRuntime
  readonly store: AcceptedClosureStoreV2
  readonly index: AcceptedCausalClosureIndexV2
  readonly installedBase: NodeAcceptedReplicaHeadV2
  readonly createDocument: YjsDocumentFactory["createDocument"]
}): ExactBaseResolverPort {
  const scope = parseDocumentScope(input.scope)
  assertSameScope(input.installedBase.scope, scope)
  const resolver: ExactBaseResolverPort = {
    async reconstructExactBase(frame) {
      try {
        assertSameScope(frame.header.core.scope, scope)
        for (const head of frame.context.baseFrontier.heads) {
          if (!await input.index.hydrate(input.store, head.frameDigest)) return "pending"
        }
        const order = input.index.materializationOrder(frame.context.baseFrontier)
        if (order === "pending") return "pending"
        let current = cloneHead(input.installedBase)
        for (const accepted of order) {
          const ref = frameObjectRefFromDecodedFrame(accepted)
          current = materializeAcceptedFrame({
            authority: input.authority,
            owner: input.owner,
            previous: current,
            ref,
            exactFrameBytes: accepted.bytes,
            causalClosure: input.index,
            createDocument: input.createDocument,
          })
        }
        if (current.frontierDigest !== causalFrontierDigest(frame.context.baseFrontier)) return "rejected"
        return Object.freeze({
          fullUpdate: Uint8Array.from(current.fullUpdate),
          stateVector: Uint8Array.from(current.stateVector) as typeof current.stateVector,
          frontier: current.frontier,
          actorHeads: current.actorHeads,
          canonicalStateDigest: current.canonicalStateDigest,
        })
      } catch {
        return "rejected"
      }
    },
  }
  return Object.freeze(resolver)
}

function cloneHead(value: NodeAcceptedReplicaHeadV2): NodeAcceptedReplicaHeadV2 {
  return Object.freeze({
    ...value,
    fullUpdate: Uint8Array.from(value.fullUpdate),
    stateVector: Uint8Array.from(value.stateVector) as typeof value.stateVector,
  })
}

function assertSameScope(leftValue: DocumentScope, rightValue: DocumentScope): void {
  const left = parseDocumentScope(leftValue)
  const right = parseDocumentScope(rightValue)
  if (
    left.projectId !== right.projectId || left.projectEpoch !== right.projectEpoch ||
    left.docKind !== right.docKind || left.docId !== right.docId || left.shardEpoch !== right.shardEpoch
  ) throw new Error("Accepted causal closure crossed document scope")
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false
  return true
}
