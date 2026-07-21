import { describe, expect, test } from "bun:test"
import { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } from "./builtin-registry"

describe("default Canvas file renderer registry", () => {
  test("hides media and generic file creation until a resource source exists", () => {
    const definitions = createDefaultCanvasFileRendererRegistry().list()
    for (const id of ["image", "video", "audio", "file"]) {
      expect(definitions.find((definition) => definition.id === id)?.hidden).toBe(true)
    }
    expect(definitions.find((definition) => definition.id === "text")?.hidden).not.toBe(true)
  })

  test("keeps built-in resource renderers and the file node definition render-only", () => {
    const fileRenderers = createDefaultCanvasFileRendererRegistry()
    for (const id of ["text", "image", "video", "audio", "file"]) {
      expect(fileRenderers.get(id)?.create).toBeUndefined()
    }

    const nodeRegistry = createDefaultCanvasNodeRegistry()
    expect(nodeRegistry.get("file")?.create).toBeUndefined()
    expect(nodeRegistry.get("agent")?.create).toBeFunction()
  })
})
