import { describe, expect, test } from "bun:test"
import { parseProjectCanvasDrag, serializeProjectCanvasDrag } from "./drag"

describe("project canvas drag payload", () => {
  test("round-trips catalog references and rejects malformed data", () => {
    const payload = { canvas: { id: "canvas-main", name: "Main" }, projectId: "project-one", version: 1 as const }
    expect(parseProjectCanvasDrag(serializeProjectCanvasDrag(payload))).toEqual(payload)
    expect(parseProjectCanvasDrag("not-json")).toBeNull()
    expect(parseProjectCanvasDrag(JSON.stringify({ ...payload, canvas: { id: 1, name: "Main" } }))).toBeNull()
  })
})
