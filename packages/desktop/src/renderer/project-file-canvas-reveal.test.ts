import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { revealProjectFileOnCanvas } from "./project-file-canvas-reveal"

const scope = { canvasId: "canvas-1", projectId: "project-1" }

function documentWithProjectFile() {
  return createCanvasDocument({
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
    })
}

describe("Project file Canvas reveal", () => {
  test("loads Main authority and selects a matching mounted node with a smooth centered reveal", async () => {
    const execute = mock(async () => ({
      foundNodeIds: ["notes"],
      missingNodeIds: [],
      snapshot: {
        documentId: scope.canvasId,
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
      documents: { load: mock(async () => ({ nodes: [], projection: documentWithProjectFile() })) },
      editor: () => ({ ...scope, handle: { reloadAuthoritative } }),
      path: "Notes/brief.md",
      scope,
      views: {
        execute,
        list: () => [
          {
            documentId: scope.canvasId,
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
      expectedScopeId: "project-1",
      viewId: "desktop-main",
    })
  })

  test("abandons a reveal when the active Project changes during the authoritative load", async () => {
    let activeScope: typeof scope | null = scope
    const execute = mock(async () => {
      throw new Error("must not execute after the scope changes")
    })
    const reloadAuthoritative = mock(async () => undefined)

    const result = await revealProjectFileOnCanvas({
      currentScope: () => activeScope,
      documents: {
        load: mock(async () => {
          activeScope = { canvasId: "canvas-2", projectId: "project-2" }
          return { nodes: [], projection: documentWithProjectFile() }
        }),
      },
      editor: () => ({ ...scope, handle: { reloadAuthoritative } }),
      path: "Notes/brief.md",
      scope,
      views: {
        execute,
        list: () => [
          {
            documentId: scope.canvasId,
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
    expect(reloadAuthoritative).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
