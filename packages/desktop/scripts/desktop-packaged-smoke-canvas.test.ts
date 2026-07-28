import { describe, expect, test } from "bun:test"

import { assertEmptyPersistedCanvasV2 } from "./desktop-packaged-smoke-canvas"

describe("packaged smoke persisted Canvas assertion", () => {
  test("reads empty nodes from the v2 document envelope", () => {
    expect(() =>
      assertEmptyPersistedCanvasV2(
        JSON.stringify({
          document: { nodes: [] },
          schemaVersion: "convax.canvas/2",
        }),
      ),
    ).not.toThrow()
  })

  test("rejects an unsupported schema, a top-level nodes shortcut, and non-empty document nodes", () => {
    expect(() =>
      assertEmptyPersistedCanvasV2(
        JSON.stringify({
          document: { nodes: [] },
          schemaVersion: "convax.canvas/1",
        }),
      ),
    ).toThrow("schema")
    expect(() =>
      assertEmptyPersistedCanvasV2(
        JSON.stringify({
          nodes: [],
          schemaVersion: "convax.canvas/2",
        }),
      ),
    ).toThrow("document.nodes")
    expect(() =>
      assertEmptyPersistedCanvasV2(
        JSON.stringify({
          document: { nodes: [{ id: "unexpected" }] },
          schemaVersion: "convax.canvas/2",
        }),
      ),
    ).toThrow("not empty")
  })
})
