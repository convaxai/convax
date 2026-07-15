import { describe, expect, test } from "bun:test"
import { getCanvasTextFileFormat } from "./file-import"

describe("canvas text file imports", () => {
  test("recognizes Markdown by extension or MIME type", () => {
    expect(getCanvasTextFileFormat({ name: "brief.md", type: "application/octet-stream" })).toBe("markdown")
    expect(getCanvasTextFileFormat({ name: "brief.bin", type: "text/markdown; charset=utf-8" })).toBe("markdown")
    expect(getCanvasTextFileFormat({ name: "brief.MARKDOWN" })).toBe("markdown")
  })

  test("recognizes common plain text documents", () => {
    expect(getCanvasTextFileFormat({ name: "notes.txt" })).toBe("plain")
    expect(getCanvasTextFileFormat({ name: "notes.rtf", mimeType: "application/rtf" })).toBe("plain")
    expect(getCanvasTextFileFormat({ name: "table.csv", type: "text/csv" })).toBe("plain")
  })

  test("does not decode binary Office documents as text", () => {
    expect(getCanvasTextFileFormat({ name: "brief.doc", type: "application/msword" })).toBeNull()
    expect(getCanvasTextFileFormat({ name: "brief.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBeNull()
    expect(getCanvasTextFileFormat({ name: "cover.png", type: "image/png" })).toBeNull()
  })
})
