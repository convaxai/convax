import { describe, expect, mock, test } from "bun:test"

import type { JianyingClient } from "../jianying-contracts"
import { createJianyingAgentToolProvider } from "./jianying-agent-tools"

const scope = { directory: "/project", scopeId: "project-1" }

function setup() {
  const client: JianyingClient = {
    exportCanvasMedia: mock(async () => ({
      createdDraft: false,
      draftName: "Current",
      importedMediaCount: 2,
      importStatus: "dispatched" as const,
    })),
    getDraftStatus: mock(async () => ({ draftName: "Current", draftToken: "token-1", status: "active" as const })),
  }
  return {
    client,
    provider: createJianyingAgentToolProvider(client, {
      isEnabled: () => true,
      resolveActiveCanvas: async () => ({ canvasId: "canvas-1", revision: 4, scopeId: "project-1" }),
    }),
  }
}

describe("JianYing Agent tools", () => {
  test("exposes status and explicit-target export tools", async () => {
    const { client, provider } = setup()
    expect((await provider.listTools(scope)).map((tool) => tool.name)).toEqual([
      "jianying_get_draft_status",
      "jianying_export_canvas_media",
    ])
    await expect(provider.callTool(scope, "jianying_get_draft_status", {})).resolves.toMatchObject({ status: "active" })
    await expect(
      provider.callTool(scope, "jianying_export_canvas_media", {
        expectedRevision: 4,
        nodeIds: ["image-1", "video-1"],
        target: { draftToken: "token-1", kind: "current" },
      }),
    ).resolves.toMatchObject({ importedMediaCount: 2 })
    expect(client.exportCanvasMedia).toHaveBeenCalledWith({
      expectedRevision: 4,
      nodeIds: ["image-1", "video-1"],
      ref: { canvasId: "canvas-1", scopeId: "project-1" },
      target: { draftToken: "token-1", kind: "current" },
    })
  })

  test("does not allow Agent input to widen Project scope or use toolbar auto-targeting", async () => {
    const { client, provider } = setup()
    await expect(
      provider.callTool(scope, "jianying_export_canvas_media", {
        expectedRevision: 4,
        nodeIds: ["image-1"],
        projectId: "other-project",
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow()
    expect(client.exportCanvasMedia).not.toHaveBeenCalled()
  })

  test("does not advertise or execute tools while the Plugin is uninstalled", async () => {
    const { client } = setup()
    const provider = createJianyingAgentToolProvider(client, {
      isEnabled: () => false,
      resolveActiveCanvas: async () => null,
    })

    await expect(provider.listTools(scope)).resolves.toEqual([])
    await expect(provider.callTool(scope, "jianying_get_draft_status", {})).rejects.toThrow("not installed")
    expect(client.getDraftStatus).not.toHaveBeenCalled()
  })

  test("binds export to the live active Canvas and rejects stale or missing view scope", async () => {
    const { client } = setup()
    const stale = createJianyingAgentToolProvider(client, {
      isEnabled: () => true,
      resolveActiveCanvas: async () => ({ canvasId: "canvas-live", revision: 5, scopeId: "project-1" }),
    })
    const input = {
      expectedRevision: 4,
      nodeIds: ["image-1"],
      target: { draftToken: "token-1", kind: "current" },
    }
    await expect(stale.callTool(scope, "jianying_export_canvas_media", input)).rejects.toThrow("active Canvas changed")
    const missing = createJianyingAgentToolProvider(client, {
      isEnabled: () => true,
      resolveActiveCanvas: async () => null,
    })
    await expect(missing.callTool(scope, "jianying_export_canvas_media", input)).rejects.toThrow("live Canvas")
    expect(client.exportCanvasMedia).not.toHaveBeenCalled()
  })
})
