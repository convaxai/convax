import { describe, expect, test } from "bun:test"
import { createCanvasDocument } from "../document"
import {
  InvalidCanvasDocumentError,
  parseStoredCanvasDocument,
  serializeCanvasDocument,
} from "./persistence"

describe("canvas document persistence", () => {
  test("round trips a valid document owned by the expected canvas", () => {
    const document = createCanvasDocument({ id: "canvas_owned", title: "Owned" })
    expect(parseStoredCanvasDocument(serializeCanvasDocument(document), document.id)).toEqual(document)
  })

  test("rejects malformed JSON and a document from another canvas", () => {
    expect(() => parseStoredCanvasDocument("not json", "canvas_expected")).toThrow(InvalidCanvasDocumentError)
    expect(() => parseStoredCanvasDocument(
      serializeCanvasDocument(createCanvasDocument({ id: "canvas_other" })),
      "canvas_expected",
    )).toThrow(InvalidCanvasDocumentError)
  })
})
