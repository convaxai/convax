import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { revealProjectFileOnCanvas } from "./project-file-canvas-reveal"

const scope = { canvasId: "canvas-1", projectId: "project-1" }

function documentWithProjectFile(revision = 4) {
  return {
    ...createCanvasDocument({
      id: scope.canvasId,
      nodes: [
        createTextNode({
          id: "notes",
          metadata: {
            [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/brief.md" },
          },
          position: { x: 20, y: 30 },
          resourceState: { status: "ready" },
        }),
      ],
    }),
    revision,
  }
}

describe("Project file Canvas reveal", () => {
  test("loads Main authority and selects a matching mounted node with a smooth centered reveal", async () => {
    const execute = mock(async () => ({
      foundNodeIds: ["notes"],
      missingNodeIds: [],
      snapshot: {
        documentId: scope.canvasId,
        revision: 4,
        scopeId: scope.projectId,
        selectedEdgeIds: [],
        selectedNodeIds: ["notes"],
        viewId: "desktop-main",
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }))
    const reloadAuthoritative = mock(async () => undefined)
    const result = await revealProjectFileOnCanvas({
      currentScope: () => scope,
      documents: { load: mock(async () => ({ document: documentWithProjectFile(), storageVersion: "v4" })) },
      editor: () => ({ ...scope, handle: { reloadAuthoritative } }),
      path: "Notes/brief.md",
      scope,
      views: {
        execute,
        list: () => [
          {
            documentId: scope.canvasId,
            revision: 4,
            scopeId: scope.projectId,
            selectedEdgeIds: [],
            selectedNodeIds: [],
            viewId: "desktop-main",
            viewport: { x: 0, y: 0, zoom: 0.35 },
          },
        ],
      },
    })

    expect(result).toBe("revealed")
    expect(reloadAuthoritative).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      command: {
        animation: "smooth",
        fit: "center",
        nodeIds: ["notes"],
        select: true,
        type: "nodes.reveal",
      },
      expectedDocumentId: "canvas-1",
      expectedRevision: 4,
      expectedScopeId: "project-1",
      viewId: "desktop-main",
    })
  })

  test("refreshes an older mounted projection and abandons a stale Project switch", async () => {
    let activeScope: typeof scope | null = scope
    let viewRevision = 3
    const execute = mock(async () => {
      throw new Error("must not execute after the scope changes")
    })
    const reloadAuthoritative = mock(async () => {
      viewRevision = 4
      activeScope = { canvasId: "canvas-2", projectId: "project-2" }
    })

    const result = await revealProjectFileOnCanvas({
      currentScope: () => activeScope,
      documents: { load: mock(async () => ({ document: documentWithProjectFile(), storageVersion: "v4" })) },
      editor: () => ({ ...scope, handle: { reloadAuthoritative } }),
      path: "Notes/brief.md",
      scope,
      views: {
        execute,
        list: () => [
          {
            documentId: scope.canvasId,
            revision: viewRevision,
            scopeId: scope.projectId,
            selectedEdgeIds: [],
            selectedNodeIds: [],
            viewId: "desktop-main",
            viewport: { x: 0, y: 0, zoom: 0.35 },
          },
        ],
      },
    })

    expect(result).toBe("stale")
    expect(reloadAuthoritative).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })
})
