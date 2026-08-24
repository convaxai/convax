import { canvasCanonicalResourceIdentity, type CanvasDocument } from "@convax/canvas"
import {
  assertResourceRef,
  canvasProjectionResourceMetadataKey,
  type CanvasCertifiedProjectionIdentity,
  type CanvasCertifiedProjectionPatch,
  type CanvasEntityRef,
  type CanvasRendererResourceHierarchyClassification,
  type CanvasRendererResourceHierarchyDelta,
  type CanvasRendererResourceHierarchyEntry,
  type CanvasRendererResourceHierarchySnapshot,
  type CanvasResourceRef,
} from "@convax/canvas/collaboration"
import type { ProjectId } from "@convax/collaboration"
import {
  projectIndexResourceReferenceDigest,
  type ProjectIndexCurrentBlobReferencePort,
} from "@convax/project"
import {
  resolveCurrentProjectResource,
  type ProjectResourceReference,
} from "@convax/project/canvas"

import { projectResourceHierarchySegments } from "../project-resource-hierarchy-key"

type CurrentResourceProjection = Pick<ProjectIndexCurrentBlobReferencePort, "queryCurrentResourcesExact">

interface CanonicalResourceCandidate {
  readonly entity: CanvasEntityRef & { readonly kind: "node" }
  readonly name: string
  readonly nodeId: string
  readonly resource: CanvasResourceRef
}

/**
 * Projects one cold/full Canvas view into a complete disposable hierarchy
 * sidecar. ProjectIndex remains the only owner allowed to resolve a pathless
 * Canvas resource proof to its current materialized Project path.
 */
export async function projectCanvasResourceHierarchySnapshot(input: Readonly<{
  readonly currentResources: CurrentResourceProjection
  readonly document: CanvasDocument
  readonly nodeEntities: readonly Readonly<{
    readonly entity: CanvasEntityRef & { readonly kind: "node" }
    readonly nodeId: string
  }>[]
  readonly projectId: ProjectId
  readonly projectionIdentity: CanvasCertifiedProjectionIdentity
}>): Promise<CanvasRendererResourceHierarchySnapshot> {
  try {
    const entities = new Map(input.nodeEntities.map((entry) => [entry.nodeId, entry.entity]))
    const candidates: CanonicalResourceCandidate[] = []
    for (const node of input.document.nodes) {
      if (canvasCanonicalResourceIdentity(node) === undefined) continue
      const entity = entities.get(node.id)
      if (!entity) return unavailableSnapshot(input.projectionIdentity)
      const resource = canonicalResourceFromMetadata(node.data.metadata)
      if (!resource) return unavailableSnapshot(input.projectionIdentity)
      candidates.push(Object.freeze({
        entity,
        name: typeof node.data.name === "string" ? node.data.name : node.data.label,
        nodeId: node.id,
        resource,
      }))
    }
    const entries = await projectCandidates(input.currentResources, input.projectId, candidates)
    if (!entries) return unavailableSnapshot(input.projectionIdentity)
    return Object.freeze({
      format: "convax.canvas-resource-hierarchy-snapshot",
      projectionIdentity: structuredClone(input.projectionIdentity),
      completeness: "complete",
      entries,
    })
  } catch {
    return unavailableSnapshot(input.projectionIdentity)
  }
}

/**
 * Projects only the owner-certified append nodes. An empty delta is the
 * fail-closed representation when an exact ProjectIndex proof cannot be
 * resolved; Canvas will make its disposable index unavailable without
 * rejecting the already-durable patch.
 */
export async function projectCanvasResourceHierarchyDelta(input: Readonly<{
  readonly currentResources: CurrentResourceProjection
  readonly patch: CanvasCertifiedProjectionPatch
  readonly projectId: ProjectId
}>): Promise<CanvasRendererResourceHierarchyDelta> {
  const projectionIdentity = resultIdentity(input.patch)
  try {
    const candidates: CanonicalResourceCandidate[] = []
    for (const node of input.patch.nodes) {
      if (node.data.kind !== "resource") continue
      candidates.push(Object.freeze({
        entity: structuredClone(node.ref),
        name: node.data.title,
        nodeId: node.ref.id,
        resource: structuredClone(node.data.resource),
      }))
    }
    const entries = await projectCandidates(input.currentResources, input.projectId, candidates)
    return Object.freeze({
      format: "convax.canvas-resource-hierarchy-delta",
      projectionIdentity,
      entries: entries ?? Object.freeze([]),
    })
  } catch {
    return Object.freeze({
      format: "convax.canvas-resource-hierarchy-delta",
      projectionIdentity,
      entries: Object.freeze([]),
    })
  }
}

async function projectCandidates(
  currentResources: CurrentResourceProjection,
  projectId: ProjectId,
  candidates: readonly CanonicalResourceCandidate[],
): Promise<readonly CanvasRendererResourceHierarchyEntry[] | null> {
  if (candidates.length === 0) return Object.freeze([])
  if (!currentResources.queryCurrentResourcesExact) return null

  const targetsByKey = new Map<string, Readonly<{ uri: string; ownerProofDigest: CanvasResourceRef["ownerProofDigest"] }>>()
  for (const candidate of candidates) {
    assertResourceRef(candidate.resource)
    const target = Object.freeze({
      uri: candidate.resource.uri,
      ownerProofDigest: candidate.resource.ownerProofDigest,
    })
    targetsByKey.set(resourceProofKey(target.uri, target.ownerProofDigest), target)
  }
  const targets = Object.freeze([...targetsByKey.values()])
  const current = await currentResources.queryCurrentResourcesExact({ projectId, targets })
  const currentByKey = new Map<string, (typeof current)[number]>()
  for (const entry of current) {
    const key = resourceProofKey(
      entry.reference.canonicalUri,
      projectIndexResourceReferenceDigest(entry.reference),
    )
    if (!targetsByKey.has(key) || currentByKey.has(key)) return null
    currentByKey.set(key, entry)
  }

  const entries: CanvasRendererResourceHierarchyEntry[] = []
  const seenEntities = new Set<string>()
  for (const candidate of candidates) {
    const entityKey = `${candidate.entity.kind}\u0000${candidate.entity.id}\u0000${candidate.entity.incarnation}`
    if (seenEntities.has(entityKey)) return null
    seenEntities.add(entityKey)
    const currentResource = currentByKey.get(resourceProofKey(
      candidate.resource.uri,
      candidate.resource.ownerProofDigest,
    ))
    if (!currentResource) return null
    const resolved = resolveCurrentProjectResource({
      currentResources: [currentResource],
      name: candidate.name,
      resource: candidate.resource,
    })
    if (resolved.status !== "ready") return null
    entries.push(Object.freeze({
      entity: structuredClone(candidate.entity),
      nodeId: candidate.nodeId,
      classification: classifyReference(resolved.reference),
    }))
  }
  return Object.freeze(entries)
}

function classifyReference(
  reference: Exclude<ProjectResourceReference, { readonly kind: "project-directory" }>,
): CanvasRendererResourceHierarchyClassification {
  if (reference.kind === "managed-asset") return Object.freeze({ kind: "not-path-backed" })
  return Object.freeze({
    kind: "path",
    key: Object.freeze({
      segments: projectResourceHierarchySegments(reference.path),
      coverage: "leaf",
    }),
  })
}

function canonicalResourceFromMetadata(metadata: unknown): CanvasResourceRef | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const descriptor = Object.getOwnPropertyDescriptor(metadata, canvasProjectionResourceMetadataKey)
  if (!descriptor?.enumerable || !("value" in descriptor)) return null
  try {
    assertResourceRef(descriptor.value)
    return structuredClone(descriptor.value)
  } catch {
    return null
  }
}

function resultIdentity(patch: CanvasCertifiedProjectionPatch): CanvasCertifiedProjectionIdentity {
  return Object.freeze({
    format: "convax.canvas-certified-projection-identity",
    canvasId: patch.canvasId,
    ownerSchemaDigest: patch.ownerSchemaDigest,
    stateCommitmentDigest: patch.resultStateCommitmentDigest,
  })
}

function unavailableSnapshot(
  projectionIdentity: CanvasCertifiedProjectionIdentity,
): CanvasRendererResourceHierarchySnapshot {
  return Object.freeze({
    format: "convax.canvas-resource-hierarchy-snapshot",
    projectionIdentity: structuredClone(projectionIdentity),
    completeness: "unavailable",
    entries: Object.freeze([]),
  })
}

function resourceProofKey(uri: string, ownerProofDigest: string): string {
  return `${uri}\u0000${ownerProofDigest}`
}
