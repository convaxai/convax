import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas"
import {
  canvasProjectionResourceMetadataKey,
  type CanvasCertifiedProjectionPatch,
} from "@convax/canvas/collaboration"
import {
  encodeBase64url,
  ordinarySha256,
  parseActorId,
  parseDigest,
  parseId128,
  parseProjectId,
} from "@convax/collaboration"
import {
  parseProjectIndexResourceReference,
  projectIndexResourceReferenceDigest,
} from "@convax/project"

import {
  projectCanvasResourceHierarchyDelta,
  projectCanvasResourceHierarchySnapshot,
} from "./canvas-resource-hierarchy-projection"

const projectId = parseProjectId("project_0123456789abcdef0123456789abcdef")
const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
const nodeSuffix = encodeBase64url(new Uint8Array(32).fill(2))
const entity = Object.freeze({
  kind: "node" as const,
  id: `n_${nodeSuffix}`,
  incarnation: `ni_${nodeSuffix}`,
})
const identity = Object.freeze({
  format: "convax.canvas-certified-projection-identity" as const,
  canvasId: `cv_${"1".repeat(64)}` as never,
  ownerSchemaDigest: parseDigest("1".repeat(64)),
  stateCommitmentDigest: parseDigest("2".repeat(64)),
})

describe("Canvas resource hierarchy projection", () => {
  test("binds a canonical Canvas resource to the exact current ProjectIndex materialized path", async () => {
    const fixture = resourceFixture("hello")
    const queryCurrentResourcesExact = mock(async () => [{
      materializedPath: "Notes/Cafe\u0301.md",
      reference: fixture.reference,
      storageClass: "project-file" as const,
    }])

    const result = await projectCanvasResourceHierarchySnapshot({
      currentResources: { queryCurrentResourcesExact },
      document: createCanvasDocument({
        id: identity.canvasId,
        nodes: [createTextNode({
          id: entity.id,
          label: "Café",
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        })],
      }),
      nodeEntities: [{ nodeId: entity.id, entity }],
      projectId,
      projectionIdentity: identity,
    })

    expect(queryCurrentResourcesExact).toHaveBeenCalledWith({
      projectId,
      targets: [{ uri: fixture.resource.uri, ownerProofDigest: fixture.resource.ownerProofDigest }],
    })
    expect(result).toEqual({
      format: "convax.canvas-resource-hierarchy-snapshot",
      projectionIdentity: identity,
      completeness: "complete",
      entries: [{
        entity,
        nodeId: entity.id,
        classification: {
          kind: "path",
          key: { segments: ["notes", "café.md"], coverage: "leaf" },
        },
      }],
    })
  })

  test("fails a cold completeness proof closed when an exact owner proof is absent", async () => {
    const fixture = resourceFixture("hello")
    const result = await projectCanvasResourceHierarchySnapshot({
      currentResources: { queryCurrentResourcesExact: mock(async () => []) },
      document: createCanvasDocument({
        id: identity.canvasId,
        nodes: [createTextNode({
          id: entity.id,
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        })],
      }),
      nodeEntities: [{ nodeId: entity.id, entity }],
      projectId,
      projectionIdentity: identity,
    })

    expect(result).toEqual({
      format: "convax.canvas-resource-hierarchy-snapshot",
      projectionIdentity: identity,
      completeness: "unavailable",
      entries: [],
    })
  })

  test("classifies a current managed resource without inventing a Project path", async () => {
    const fixture = resourceFixture("managed")
    const result = await projectCanvasResourceHierarchySnapshot({
      currentResources: {
        queryCurrentResourcesExact: mock(async () => [{
          materializedPath: null,
          reference: fixture.reference,
          storageClass: "managed-blob" as const,
        }]),
      },
      document: createCanvasDocument({
        id: identity.canvasId,
        nodes: [createTextNode({
          id: entity.id,
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        })],
      }),
      nodeEntities: [{ nodeId: entity.id, entity }],
      projectId,
      projectionIdentity: identity,
    })

    expect(result).toMatchObject({
      completeness: "complete",
      entries: [{
        entity,
        nodeId: entity.id,
        classification: { kind: "not-path-backed" },
      }],
    })
    expect(JSON.stringify(result)).not.toContain("segments")
  })

  test("projects a certified append from only its k patch nodes and leaves a failed delta fail-closed", async () => {
    const fixture = resourceFixture("hello")
    const patch = resourcePatch(fixture.resource)
    const exact = mock(async () => [{
      materializedPath: "Notes/Created.md",
      reference: fixture.reference,
      storageClass: "project-file" as const,
    }])

    const projected = await projectCanvasResourceHierarchyDelta({
      currentResources: { queryCurrentResourcesExact: exact },
      patch,
      projectId,
    })
    expect(exact).toHaveBeenCalledTimes(1)
    expect(projected.entries).toEqual([{
      entity,
      nodeId: entity.id,
      classification: {
        kind: "path",
        key: { segments: ["notes", "created.md"], coverage: "leaf" },
      },
    }])

    await expect(projectCanvasResourceHierarchyDelta({
      currentResources: { queryCurrentResourcesExact: mock(async () => []) },
      patch,
      projectId,
    })).resolves.toEqual({
      format: "convax.canvas-resource-hierarchy-delta",
      projectionIdentity: projected.projectionIdentity,
      entries: [],
    })
  })
})

function resourceFixture(content: string) {
  const digest = ordinarySha256(new TextEncoder().encode(content))
  const fileId = `pf_${"a".repeat(64)}`
  const reference = parseProjectIndexResourceReference({
    format: "convax.project-resource-reference",
    projectId,
    projectEpoch,
    entryFileId: fileId,
    familyPrimaryFileId: fileId,
    versionId: `pv_${"b".repeat(64)}`,
    canonicalUri: `convax-project://${projectId}/epochs/${projectEpoch}/entries/${fileId}?blob=sha256%3A${digest}`,
    blob: {
      format: "convax.blob-ref",
      algorithm: "sha256",
      digest,
      byteLength: String(new TextEncoder().encode(content).byteLength),
      mime: "text/markdown",
    },
    versionRecordDigest: ordinarySha256(new TextEncoder().encode(`version:${digest}`)),
  })
  return {
    reference,
    resource: Object.freeze({
      format: "convax.canvas-resource-ref" as const,
      uri: reference.canonicalUri,
      mediaClass: "text" as const,
      mime: reference.blob.mime,
      byteLength: reference.blob.byteLength,
      contentDigest: reference.blob.digest,
      ownerProofDigest: projectIndexResourceReferenceDigest(reference),
    }),
  }
}

function resourcePatch(resource: ReturnType<typeof resourceFixture>["resource"]): CanvasCertifiedProjectionPatch {
  const operationId = parseId128(encodeBase64url(new Uint8Array(16).fill(4)))
  return {
    format: "convax.canvas-certified-projection-patch",
    kind: "resource-append",
    canvasId: identity.canvasId,
    ownerSchemaDigest: identity.ownerSchemaDigest,
    baseStateCommitmentDigest: identity.stateCommitmentDigest,
    resultStateCommitmentDigest: parseDigest("3".repeat(64)),
    receipt: {
      format: "convax.canvas-operation-receipt",
      actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(3))),
      operationId,
      intentKind: "canvas.resources.add",
      intentDigest: parseDigest("4".repeat(64)),
      baseFrontierDigest: parseDigest("5".repeat(64)),
      resultEntities: [entity],
      semanticRoot: true,
      historyMaterialDigest: parseDigest("6".repeat(64)),
    },
    nodes: [{
      ref: entity,
      role: "file",
      position: { x: 0, y: 0 },
      size: { width: 320, height: 180 },
      data: {
        format: "convax.canvas-node-data",
        kind: "resource",
        title: "Created",
        resource,
      },
      plugin: null,
      parent: null,
      generationLifecycle: "none",
    }],
    edges: [],
  }
}
