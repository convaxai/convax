import { describe, expect, test } from "bun:test"
import type { CanvasDocument } from "@convax/canvas"
import { summarizeWorkspaceCanvasActivity } from "./workspace-activity-model"

describe("workspace activity projection", () => {
  test("returns an empty bounded projection without a document", () => {
    expect(summarizeWorkspaceCanvasActivity(null)).toEqual({ active: 0, attention: 0, total: 0 })
  })

  test("counts active and attention-worthy generation runs without owning them", () => {
    const document = {
      edges: [],
      id: "canvas-1",
      metadata: { title: "Activity" },
      nodes: [
        {
          data: {
            kind: "image",
            label: "Pending",
            metadata: {
              convaxGenerationRun: {
                operationId: "operation-1",
                prompt: "Create",
                schema: "convax.node-generation-run/2",
                status: "running",
                toolId: "tool-1",
              },
            },
            status: "pending",
          },
          id: "node-1",
          position: { x: 0, y: 0 },
          type: "file",
        },
        {
          data: {
            kind: "image",
            label: "Failed",
            metadata: {
              convaxGenerationRun: {
                operationId: "operation-2",
                prompt: "Create",
                retrySafety: "unknown",
                schema: "convax.node-generation-run/2",
                status: "failed",
                toolId: "tool-1",
              },
            },
            status: "error",
          },
          id: "node-2",
          position: { x: 0, y: 0 },
          type: "file",
        },
      ],
      revision: 1,
    } as CanvasDocument

    expect(summarizeWorkspaceCanvasActivity(document)).toEqual({ active: 1, attention: 1, total: 2 })
  })
})
