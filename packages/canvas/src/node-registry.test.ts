import { describe, expect, test } from "bun:test"
import { createCanvasNodeRegistry, type CanvasNodeDefinition } from "./node-registry"

const renderOnlyFileDefinition = {
  component: () => null,
  label: "File",
  type: "file",
} satisfies CanvasNodeDefinition

describe("Canvas node registry", () => {
  test("accepts render-only node definitions without adding a source-less creator", () => {
    const registry = createCanvasNodeRegistry([renderOnlyFileDefinition])

    expect(registry.get("file")).toBe(renderOnlyFileDefinition)
    expect(registry.get("file")?.create).toBeUndefined()
  })
})
