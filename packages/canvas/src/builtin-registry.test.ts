import { describe, expect, test } from "bun:test"
import { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } from "./builtin-registry"
import { createCanvasFileNode } from "./file-renderer-registry"

describe("default Canvas file renderer registry", () => {
  test("creates durable empty image and video cards without inventing resource references", () => {
    const registry = createDefaultCanvasFileRendererRegistry()
    for (const kind of ["image", "video"] as const) {
      const definition = registry.get(kind)
      expect(definition?.hidden).not.toBe(true)
      expect(definition?.create).toBeFunction()
      if (!definition) throw new Error(`Missing ${kind} renderer`)

      const node = createCanvasFileNode(definition, { position: { x: 12, y: 24 } })
      expect(node).toMatchObject({
        data: {
          kind,
          label: kind[0]!.toUpperCase() + kind.slice(1),
          metadata: {},
          resourceState: { status: "ready" },
          status: "idle",
        },
        position: { x: 12, y: 24 },
        type: "file",
      })
    }
  })

  test("keeps source-backed and special roles out of insertion menus", () => {
    const fileRenderers = createDefaultCanvasFileRendererRegistry()
    for (const id of ["text", "audio", "file", "folder"]) {
      expect(fileRenderers.get(id)?.create).toBeUndefined()
    }
    for (const id of ["audio", "file"]) {
      expect(fileRenderers.get(id)?.hidden).toBe(true)
    }

    const nodeRegistry = createDefaultCanvasNodeRegistry()
    expect(nodeRegistry.get("file")?.create).toBeUndefined()
    expect(nodeRegistry.get("agent")?.create).toBeFunction()
  })
})
