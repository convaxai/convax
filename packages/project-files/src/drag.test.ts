import { describe, expect, test } from "bun:test"
import { parseProjectEntryDrag, serializeProjectEntryDrag } from "./drag"

describe("project file drag payloads", () => {
  test("keeps valid entries and drops malformed ones", () => {
    const value = serializeProjectEntryDrag({
      entries: [{ kind: "directory", name: "src", path: "src" }],
      projectId: "project_one",
      version: 1,
    })
    expect(parseProjectEntryDrag(value)?.entries).toEqual([{ kind: "directory", name: "src", path: "src" }])
  })

  test("preserves a bounded renderer-only presentation hint", () => {
    const presentation = {
      intrinsicHeight: 900,
      intrinsicWidth: 1_600,
      mediaKind: "image" as const,
      thumbnailDataUrl: "data:image/png;base64,cHJldmlldw==",
    }
    const value = serializeProjectEntryDrag({
      entries: [{ kind: "file", name: "cover.png", path: "Media/cover.png", presentation }],
      projectId: "project_one",
      version: 1,
    })

    expect(parseProjectEntryDrag(value)?.entries).toEqual([
      { kind: "file", name: "cover.png", path: "Media/cover.png", presentation },
    ])
  })

  test("drops malformed or oversized presentation hints without promoting them to authority", () => {
    const base = { kind: "file" as const, name: "cover.png", path: "Media/cover.png" }
    const malformed = JSON.stringify({
      entries: [
        {
          ...base,
          presentation: {
            intrinsicHeight: 900,
            intrinsicWidth: 0,
            mediaKind: "image",
            thumbnailDataUrl: "file:///cover.png",
          },
        },
      ],
      projectId: "project_one",
      version: 1,
    })

    expect(parseProjectEntryDrag(malformed)?.entries).toEqual([base])
  })

  test("rejects an aggregate payload before parsing or serializing an unbounded thumbnail set", () => {
    const thumbnailDataUrl = `data:image/png;base64,${"A".repeat(180 * 1024)}`
    const payload = {
      entries: [0, 1, 2].map((index) => ({
        kind: "file" as const,
        name: `cover-${index}.png`,
        path: `Media/cover-${index}.png`,
        presentation: {
          intrinsicHeight: 900,
          intrinsicWidth: 1_600,
          mediaKind: "image" as const,
          thumbnailDataUrl,
        },
      })),
      projectId: "project_one",
      version: 1 as const,
    }

    expect(parseProjectEntryDrag(JSON.stringify(payload))).toBeNull()
    expect(() => serializeProjectEntryDrag(payload)).toThrow("bounded contract")
  })

  test("rejects payloads without valid entries", () => {
    expect(parseProjectEntryDrag("not-json")).toBeNull()
    expect(parseProjectEntryDrag(JSON.stringify({ entries: [], projectId: "project_one", version: 1 }))).toBeNull()
  })
})
