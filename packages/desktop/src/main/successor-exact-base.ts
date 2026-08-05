import {
  causalFrontierDigestV2,
  decodeCausalEditFrameV3,
  frameObjectRefFromDecodedFrameV3,
  inspectAcceptedFrameObjectV3,
  materializeAcceptedFrameV3,
  parseDigestV2,
  parseDocumentScopeV2,
  replicaActorHeadSetDigestV2,
  type CausalClosurePortV2,
  type DecodedCausalEditFrameV3,
  type DigestV2,
  type DocumentOwnerRuntimeV2,
  type DocumentScopeV2,
  type ExactBaseResolverPortV3,
  type VerifiedProtocolAuthorityV3,
  type YjsDocumentFactoryV2,
} from "@convax/collaboration"
import type {
  NodeAcceptedFrameObjectV2,
  NodeAcceptedReplicaHeadV2,
  NodeReplicaHeadMaterializerV2,
} from "@convax/project/node"

export interface AcceptedClosureStoreV2 {
  loadInstalledBase(scope: DocumentScopeV2): Promise<NodeAcceptedReplicaHeadV2>
  listAcceptedFrames(scope: DocumentScopeV2): Promise<readonly NodeAcceptedFrameObjectV2[]>
  readAcceptedFrame(scope: DocumentScopeV2, frameDigest: DigestV2): Promise<Uint8Array | null>
}

export interface AcceptedCausalClosureIndexV3 extends CausalClosurePortV2 {
  warm(store: AcceptedClosureStoreV2): Promise<NodeAcceptedReplicaHeadV2>
  hydrate(store: AcceptedClosureStoreV2, frameDigest: DigestV2): Promise<boolean>
  materializationOrder(frontier: DecodedCausalEditFrameV3["context"]["baseFrontier"]): readonly DecodedCausalEditFrameV3[] | "pending"
}

/**
 * Main-owned in-memory causal index over Project-owned exact durable bytes. It is
 * disposable reconstruction state, never a second accepted document or store.
 */
export function createAcceptedCausalClosureIndexV3(input: {
  readonly authority: VerifiedProtocolAuthorityV3
  readonly scope: DocumentScopeV2
}): AcceptedCausalClosureIndexV3 {
  const scope = parseDocumentScopeV2(input.scope)
  const roots = new Set<DigestV2>()
  const frames = new Map<DigestV2, DecodedCausalEditFrameV3>()
  const parents = new Map<DigestV2, readonly DigestV2[]>()
  let warmed = false

  const index: AcceptedCausalClosureIndexV3 = {
    contains(descendantInput, ancestorInput) {
      const descendant = parseDigestV2(descendantInput)
      const ancestor = parseDigestV2(ancestorInput)
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
      for (const head of base.frontier.heads) roots.add(parseDigestV2(head.frameDigest))
      warmed = true
      for (const object of await store.listAcceptedFrames(scope)) ingest(object)
      return cloneHead(base)
    },
    async hydrate(store, digestInput) {
      requireWarmed()
      return hydrateDigest(store, parseDigestV2(digestInput), new Set())
    },
    materializationOrder(frontier) {
      requireWarmed()
      const ordered: DecodedCausalEditFrameV3[] = []
      const emitted = new Set<DigestV2>()
      for (const head of frontier.heads) {
        if (!append(parseDigestV2(head.frameDigest), emitted, ordered, new Set())) return "pending"
      }
      return Object.freeze(ordered)
    },
  }
  return Object.freeze(index)

  function ingest(object: NodeAcceptedFrameObjectV2): DecodedCausalEditFrameV3 {
    const frame = inspectAcceptedFrameObjectV3(input.authority, object.ref, object.exactFrameBytes)
    assertSameScope(frame.header.core.scope, scope)
    const digest = parseDigestV2(frame.frameDigest)
    const existing = frames.get(digest)
    if (existing) {
      if (!sameBytes(existing.bytes, frame.bytes)) throw new Error("Accepted frame digest aliases different exact bytes")
      return existing
    }
    const directParents = Object.freeze(frame.context.baseFrontier.heads.map((head) => parseDigestV2(head.frameDigest)))
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
    digest: DigestV2,
    visiting: Set<DigestV2>,
  ): Promise<boolean> {
    if (roots.has(digest) || frames.has(digest)) return true
    if (visiting.has(digest)) throw new Error("Accepted causal closure contains a cycle")
    visiting.add(digest)
    try {
      const exact = await store.readAcceptedFrame(scope, digest)
      if (exact === null) return false
      const frame = decodeCausalEditFrameV3(input.authority, exact)
      if (frame.frameDigest !== digest) throw new Error("Accepted frame lookup returned another digest")
      assertSameScope(frame.header.core.scope, scope)
      for (const parent of frame.context.baseFrontier.heads) {
        if (!await hydrateDigest(store, parseDigestV2(parent.frameDigest), visiting)) return false
      }
      ingest({ ref: frameObjectRefFromDecodedFrameV3(frame), exactFrameBytes: exact })
      return true
    } finally {
      visiting.delete(digest)
    }
  }

  function append(
    digest: DigestV2,
    emitted: Set<DigestV2>,
    ordered: DecodedCausalEditFrameV3[],
    visiting: Set<DigestV2>,
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

  function containsFrom(descendant: DigestV2, ancestor: DigestV2, visiting: Set<DigestV2>): boolean | "pending" {
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

export function createProductionNodeReplicaHeadMaterializerV3(input: {
  readonly authority: VerifiedProtocolAuthorityV3
  readonly owner: DocumentOwnerRuntimeV2
  readonly causalClosure: CausalClosurePortV2
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrameV3) => readonly DigestV2[]
}): NodeReplicaHeadMaterializerV2 {
  const materializer: NodeReplicaHeadMaterializerV2 = {
    async inspectFrame(ref, exactBytes) {
      const frame = inspectAcceptedFrameObjectV3(input.authority, ref, exactBytes)
      const requiredBlobDigests = [...input.requiredBlobDigests(frame)].map(parseDigestV2).sort()
      for (let index = 1; index < requiredBlobDigests.length; index += 1) {
        if (requiredBlobDigests[index - 1] === requiredBlobDigests[index]) throw new Error("Required blob digest set contains a duplicate")
      }
      return Object.freeze({ ref, requiredBlobDigests: Object.freeze(requiredBlobDigests) })
    },
    async applyAcceptedFrame({ previous, ref, exactBytes }) {
      return materializeAcceptedFrameV3({
        authority: input.authority,
        owner: input.owner,
        previous,
        ref,
        exactFrameBytes: exactBytes,
        causalClosure: input.causalClosure,
        createDocument: input.createDocument,
      })
    },
    actorHeadsDigest: replicaActorHeadSetDigestV2,
  }
  return Object.freeze(materializer)
}

export function createDurableExactBaseResolverV3(input: {
  readonly authority: VerifiedProtocolAuthorityV3
  readonly scope: DocumentScopeV2
  readonly owner: DocumentOwnerRuntimeV2
  readonly store: AcceptedClosureStoreV2
  readonly index: AcceptedCausalClosureIndexV3
  readonly installedBase: NodeAcceptedReplicaHeadV2
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
}): ExactBaseResolverPortV3 {
  const scope = parseDocumentScopeV2(input.scope)
  assertSameScope(input.installedBase.scope, scope)
  const resolver: ExactBaseResolverPortV3 = {
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
          const ref = frameObjectRefFromDecodedFrameV3(accepted)
          current = materializeAcceptedFrameV3({
            authority: input.authority,
            owner: input.owner,
            previous: current,
            ref,
            exactFrameBytes: accepted.bytes,
            causalClosure: input.index,
            createDocument: input.createDocument,
          })
        }
        if (current.frontierDigest !== causalFrontierDigestV2(frame.context.baseFrontier)) return "rejected"
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

function assertSameScope(leftValue: DocumentScopeV2, rightValue: DocumentScopeV2): void {
  const left = parseDocumentScopeV2(leftValue)
  const right = parseDocumentScopeV2(rightValue)
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
