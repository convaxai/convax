import { describe, expect, test } from "bun:test"
import {
  parseProjectEntryDrag,
  serializeProjectEntryDrag,
} from "./drag"

describe("project drag payloads", () => {
  test("keeps valid entries and drops malformed ones", () => {
    const value = serializeProjectEntryDrag({
      entries: [{ kind: "directory", name: "src", path: "src" }],
      projectId: "project_one",
      version: 1,
    })
    expect(parseProjectEntryDrag(value)?.entries).toEqual([{ kind: "directory", name: "src", path: "src" }])
  })
})
