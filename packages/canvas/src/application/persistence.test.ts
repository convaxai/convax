import { describe, expect, test } from "bun:test"
import { createCanvasDocument } from "../document"
import {
  InvalidCanvasDocumentError,
  parseStoredCanvasDocument,
  serializeCanvasDocument,
  UnsupportedCanvasDocumentVersionError,
} from "./persistence"

describe("canvas document persistence", () => {
  test("round trips a valid document owned by the expected canvas", () => {
    const pluginState = {
      directorProject: { objects: [{ id: "cube" }] },
      schemaVersion: 1,
    }
    const document = createCanvasDocument({
      id: "canvas_owned",
      nodes: [
        {
          data: {
            kind: "plugin.storyai-3d-director-desk",
            label: "3D Director Desk",
            metadata: { convaxPluginState: pluginState },
          },
          id: "director-node",
          position: { x: 10, y: 20 },
          type: "file",
        },
      ],
      title: "Owned",
    })
    const restored = parseStoredCanvasDocument(serializeCanvasDocument(document), document.id)
    expect(restored).toEqual(document)
    expect(restored.nodes[0]?.data.metadata).not.toBe(document.nodes[0]?.data.metadata)
  })

  test("rejects malformed JSON and a document from another canvas", () => {
    expect(() => parseStoredCanvasDocument("not json", "canvas_expected")).toThrow(InvalidCanvasDocumentError)
    expect(() =>
      parseStoredCanvasDocument(
        serializeCanvasDocument(createCanvasDocument({ id: "canvas_other" })),
        "canvas_expected",
      ),
    ).toThrow(InvalidCanvasDocumentError)
  })

  test("serializes the breaking Canvas v2 envelope", () => {
    const document = createCanvasDocument({ id: "canvas_v2", title: "V2" })
    expect(JSON.parse(serializeCanvasDocument(document))).toEqual({
      document,
      schemaVersion: "convax.canvas/2",
    })
  })

  test("rejects the former unversioned document without rewriting its bytes", () => {
    const document = createCanvasDocument({ id: "canvas_legacy" })
    const legacy = JSON.stringify(document)
    expect(() => parseStoredCanvasDocument(legacy, "canvas_legacy")).toThrow(
      UnsupportedCanvasDocumentVersionError,
    )
    expect(legacy).toBe(JSON.stringify(document))
  })

  test("distinguishes unsupported versions from malformed v2 documents", () => {
    expect(() =>
      parseStoredCanvasDocument(
        JSON.stringify({
          document: createCanvasDocument({ id: "canvas" }),
          schemaVersion: "convax.canvas/1",
        }),
        "canvas",
      ),
    ).toThrow(UnsupportedCanvasDocumentVersionError)
    expect(() =>
      parseStoredCanvasDocument(
        JSON.stringify({ document: { id: "canvas" }, schemaVersion: "convax.canvas/2" }),
        "canvas",
      ),
    ).toThrow(InvalidCanvasDocumentError)
  })

  test("preserves an object schema version without coercing it", () => {
    const schemaVersion = { toString: null, valueOf: null }
    let thrown: unknown
    try {
      parseStoredCanvasDocument(
        JSON.stringify({ document: createCanvasDocument({ id: "canvas" }), schemaVersion }),
        "canvas",
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(UnsupportedCanvasDocumentVersionError)
    if (!(thrown instanceof UnsupportedCanvasDocumentVersionError)) {
      throw new Error("Expected an unsupported Canvas document version")
    }
    expect(thrown.schemaVersion).toEqual(schemaVersion)
  })
})
