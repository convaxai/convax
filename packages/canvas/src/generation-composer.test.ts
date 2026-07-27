import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode } from "./document"
import {
  CanvasGenerationCatalogRequestTracker,
  assignCanvasGenerationImageRole,
  createCanvasGenerationComposerSubmission,
  isCanvasGenerationComposerSubmissionCurrent,
  projectCanvasGenerationComposer,
  reconcileCanvasGenerationImageRoles,
  resolveCanvasGenerationToolId,
} from "./generation-composer"
import type { CanvasGenerationToolSummary } from "./services"

const imageTool: CanvasGenerationToolSummary = {
  acceptedInputs: ["reference_image", "first_frame", "last_frame"],
  description: "Creates an image",
  id: "tool.image",
  output: "image",
  title: "Image",
}

const videoTool: CanvasGenerationToolSummary = {
  acceptedInputs: ["first_frame", "last_frame"],
  description: "Creates a video",
  id: "tool.video",
  output: "video",
  title: "Video",
}

function imageNode(id: string) {
  return createMediaNode({
    id,
    label: id,
    position: { x: 0, y: 0 },
    resource: {
      id: `resource-${id}`,
      kind: "image",
      metadata: {},
      state: { status: "ready", url: `canvas-resource://${id}` },
    },
  })
}

describe("Canvas generation composer", () => {
  test("projects compatible tools and creates a scope-bound submission", () => {
    const document = createCanvasDocument({ id: "canvas-a", nodes: [imageNode("source")] })
    const projection = projectCanvasGenerationComposer({
      document,
      imageRoles: { source: "first_frame" },
      selectedNodeIds: ["source"],
      selectedToolId: "tool.video",
      tools: [imageTool, videoTool],
    })

    expect(projection.references).toEqual([{ nodeId: "source", role: "first_frame" }])
    expect(projection.compatibleTools.map((tool) => tool.id)).toEqual(["tool.image", "tool.video"])
    expect(
      createCanvasGenerationComposerSubmission({
        catalogStatus: "ready",
        document,
        projection,
        prompt: "  Animate this frame  ",
        scopeId: "project-a",
        selectedNodeIds: ["source"],
      }),
    ).toEqual({
      documentId: "canvas-a",
      expectedRevision: document.revision,
      prompt: "Animate this frame",
      references: [{ nodeId: "source", role: "first_frame" }],
      scopeId: "project-a",
      selectedNodeIds: ["source"],
      tool: videoTool,
    })
  })

  test("fails closed while catalog selection is stale or unavailable", () => {
    const document = createCanvasDocument()
    const projection = projectCanvasGenerationComposer({
      document,
      imageRoles: {},
      selectedNodeIds: [],
      selectedToolId: "removed-tool",
      tools: [imageTool],
    })

    expect(projection.selectedTool).toBeUndefined()
    expect(resolveCanvasGenerationToolId("removed-tool", projection.compatibleTools)).toBe("tool.image")
    expect(
      createCanvasGenerationComposerSubmission({
        catalogStatus: "loading",
        document,
        projection,
        prompt: "Create",
        scopeId: "scope",
        selectedNodeIds: [],
      }),
    ).toBeUndefined()
  })

  test("rejects a projection from an older Canvas revision", () => {
    const document = createCanvasDocument({ id: "canvas-a" })
    const projection = projectCanvasGenerationComposer({
      document,
      imageRoles: {},
      selectedNodeIds: [],
      selectedToolId: "tool.image",
      tools: [imageTool],
    })

    expect(
      createCanvasGenerationComposerSubmission({
        catalogStatus: "ready",
        document: { ...document, revision: document.revision + 1 },
        projection,
        prompt: "Create",
        scopeId: "scope",
        selectedNodeIds: [],
      }),
    ).toBeUndefined()
  })

  test("fails closed when a host submits a draft from another Canvas scope or revision", () => {
    const submission = {
      documentId: "canvas-a",
      expectedRevision: 2,
      prompt: "Create",
      references: [],
      scopeId: "project-a",
      selectedNodeIds: [],
      tool: imageTool,
    }

    expect(
      isCanvasGenerationComposerSubmissionCurrent(submission, {
        documentId: "canvas-a",
        revision: 2,
        scopeId: "project-a",
      }),
    ).toBe(true)
    expect(
      isCanvasGenerationComposerSubmissionCurrent(submission, {
        documentId: "canvas-a",
        revision: 3,
        scopeId: "project-a",
      }),
    ).toBe(false)
    expect(
      isCanvasGenerationComposerSubmissionCurrent(submission, {
        documentId: "canvas-a",
        revision: 2,
        scopeId: "project-b",
      }),
    ).toBe(false)
  })

  test("keeps first and last frame roles exclusive and removes stale draft roles", () => {
    const assigned = assignCanvasGenerationImageRole(
      { first: "first_frame", removed: "last_frame" },
      "second",
      "first_frame",
    )
    expect(assigned).toEqual({ removed: "last_frame", second: "first_frame" })
    expect(
      reconcileCanvasGenerationImageRoles(assigned, [
        { nodeId: "second", role: "reference_image" },
      ]),
    ).toEqual({ second: "first_frame" })
  })

  test("invalidates late catalog requests when Canvas scope changes", () => {
    const tracker = new CanvasGenerationCatalogRequestTracker()
    const previous = tracker.begin({ catalogVersion: "1", documentId: "canvas-a", scopeId: "project-a" })
    const current = tracker.begin({ catalogVersion: "1", documentId: "canvas-b", scopeId: "project-b" })

    expect(previous.signal.aborted).toBe(true)
    expect(tracker.isCurrent(previous)).toBe(false)
    expect(tracker.isCurrent(current)).toBe(true)

    tracker.cancel(current)
    expect(current.signal.aborted).toBe(true)
  })

  test("does not let cleanup from an identical stale request abort its replacement", () => {
    const tracker = new CanvasGenerationCatalogRequestTracker()
    const previous = tracker.begin({ catalogVersion: "1", documentId: "canvas-a", scopeId: "project-a" })
    const current = tracker.begin({ catalogVersion: "1", documentId: "canvas-a", scopeId: "project-a" })

    tracker.cancel(previous)
    expect(current.signal.aborted).toBe(false)
    expect(tracker.isCurrent(current)).toBe(true)
  })
})
