import { describe, expect, test } from "bun:test"
import { createCanvasDocument } from "../document"
import { InvalidCanvasDocumentError, parseStoredCanvasDocument, serializeCanvasDocument } from "./persistence"

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
})
