import { describe, expect, test } from "bun:test"
import {
  createCanvasFileNode,
  createCanvasFileRendererRegistry,
  type CanvasFileRendererDefinition,
} from "./file-renderer-registry"

const Renderer = () => null
const Toolbar = () => null

function renderer(
  id: string,
  priority: number,
  matches: CanvasFileRendererDefinition["matches"] = (data) => data.kind === id,
): CanvasFileRendererDefinition {
  return { component: Renderer, id, label: id, matches, priority }
}

describe("canvas file renderer plugins", () => {
  test("resolves deterministically by priority and restores fallback after disposal", () => {
    const fallback = renderer("fallback", -100, () => true)
    const registry = createCanvasFileRendererRegistry([fallback])
    const dispose = registry.register({
      ...renderer("markdown", 10, (data) => data.kind === "text"),
      toolbar: Toolbar,
    })

    expect(registry.resolve({ kind: "text", label: "Brief" })?.id).toBe("markdown")
    expect(registry.get("markdown")?.toolbar).toBe(Toolbar)
    expect(registry.list().map((definition) => definition.id)).toEqual(["markdown", "fallback"])
    dispose()
    expect(registry.resolve({ kind: "text", label: "Brief" })?.id).toBe("fallback")
  })

  test("isolates matcher failures and rejects duplicate renderer or plugin ids", () => {
    const registry = createCanvasFileRendererRegistry([
      renderer("broken", 20, () => { throw new Error("plugin failure") }),
      renderer("safe", 0, () => true),
    ])
    expect(registry.resolve({ kind: "custom", label: "Custom" })?.id).toBe("safe")
    expect(() => registry.register(renderer("safe", 30))).toThrow("already registered")

    const plugin = { id: "documents", renderers: [renderer("pdf", 5)] }
    const dispose = registry.registerPlugin(plugin)
    expect(() => registry.registerPlugin(plugin)).toThrow("plugin is already registered")
    dispose()
    expect(registry.get("pdf")).toBeUndefined()
  })

  test("rolls back an entire plugin when one contribution conflicts", () => {
    const registry = createCanvasFileRendererRegistry([renderer("existing", 0)])
    expect(() => registry.registerPlugin({
      id: "conflicting",
      renderers: [renderer("new", 1), renderer("existing", 2)],
    })).toThrow("already registered")
    expect(registry.get("new")).toBeUndefined()
  })

  test("reserves structural ids and normalizes plugin-created content to a file node", () => {
    const registry = createCanvasFileRendererRegistry()
    expect(() => registry.register(renderer("agent", 0))).toThrow("reserved")
    expect(() => registry.register(renderer("group", 0))).toThrow("reserved")

    const definition: CanvasFileRendererDefinition = {
      ...renderer("diagram", 0),
      create: (input) => ({
        id: "diagram-node",
        type: "agent",
        position: input.position,
        data: { kind: "plugin-private-kind", label: "Diagram" },
      }),
    }
    expect(createCanvasFileNode(definition, { position: { x: 1, y: 2 } })).toMatchObject({
      type: "file",
      data: { kind: "diagram" },
    })
  })
})
