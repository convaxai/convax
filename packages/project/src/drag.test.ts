import { describe, expect, test } from "bun:test"
import {
  parseProjectCanvasDrag,
  parseProjectEntryDrag,
  serializeProjectCanvasDrag,
  serializeProjectEntryDrag,
} from "./drag"

describe("project drag payloads", () => {
  test("round-trips a canvas reference", () => {
    const payload = { canvas: { id: "canvas_one", name: "Storyboard" }, projectId: "project_one", version: 1 as const }
    expect(parseProjectCanvasDrag(serializeProjectCanvasDrag(payload))).toEqual(payload)
  })

  test("rejects malformed canvas references", () => {
    expect(parseProjectCanvasDrag("not json")).toBeNull()
    expect(parseProjectCanvasDrag(JSON.stringify({ canvas: { id: 42, name: "Nope" }, projectId: "project_one", version: 1 }))).toBeNull()
  })

  test("keeps valid entries and drops malformed ones", () => {
    const value = serializeProjectEntryDrag({
      entries: [{ kind: "directory", name: "src", path: "src" }],
      projectId: "project_one",
      version: 1,
    })
    expect(parseProjectEntryDrag(value)?.entries).toEqual([{ kind: "directory", name: "src", path: "src" }])
  })
})
