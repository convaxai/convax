import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import {
  applyCanvasFilePickerAccept,
  canvasFilePickerAccept,
  classifyCanvasFileKind,
  getCanvasTextFileFormat,
  isCanvasFileCompatibleWithKind,
} from "./file-import"

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

describe("canvas local file kind clusters", () => {
  test("classifies each local file into exactly one node kind cluster", () => {
    expect(classifyCanvasFileKind({ name: "hero.png", type: "image/png" })).toBe("image")
    expect(classifyCanvasFileKind({ name: "clip.mp4", type: "video/mp4" })).toBe("video")
    expect(classifyCanvasFileKind({ name: "take.wav", type: "audio/wav" })).toBe("audio")
    expect(classifyCanvasFileKind({ name: "notes.md" })).toBe("text")
    expect(classifyCanvasFileKind({ name: "archive.zip", type: "application/zip" })).toBe("file")
  })

  test("falls back to media extensions when MIME type is missing", () => {
    expect(classifyCanvasFileKind({ name: "hero.png" })).toBe("image")
    expect(classifyCanvasFileKind({ name: "clip.MP4" })).toBe("video")
    expect(classifyCanvasFileKind({ name: "take.mp3" })).toBe("audio")
  })

  test("keeps picker accept filters aligned with those same clusters", () => {
    expect(canvasFilePickerAccept("image")).toContain(".png")
    expect(canvasFilePickerAccept("image")).toContain(".jpg")
    expect(canvasFilePickerAccept("image")).not.toContain("*")
    expect(canvasFilePickerAccept("video")).toContain(".mp4")
    expect(canvasFilePickerAccept("video")).not.toContain("*")
    expect(canvasFilePickerAccept("audio")).toContain(".mp3")
    expect(canvasFilePickerAccept("audio")).not.toContain("*")
    expect(canvasFilePickerAccept("text")).toContain(".md")
    expect(canvasFilePickerAccept("text")).toContain(".txt")
    expect(canvasFilePickerAccept("text")).not.toContain("*")
    expect(canvasFilePickerAccept("file")).toBeUndefined()
    expect(canvasFilePickerAccept("folder")).toBeUndefined()

    const picker = { accept: "" }
    applyCanvasFilePickerAccept(picker, "video")
    expect(picker.accept).toContain(".mp4")
    applyCanvasFilePickerAccept(picker, "file")
    expect(picker.accept).toBe("")
  })

  test("HTML accept does not stop Chromium from delivering other suffixes after Add", () => {
    const window = new Window()
    const input = window.document.createElement("input")
    input.type = "file"
    applyCanvasFilePickerAccept(input, "image")
    expect(input.getAttribute("accept")).toContain(".png")
    expect(input.getAttribute("accept")).not.toContain("*")

    // macOS Chromium always offers "All files". Selecting clip.mp4 still
    // produces a File, exactly as Electron does after Add on an image card.
    const video = new File(["clip"], "clip.mp4", { type: "video/mp4" })
    const pdf = new File(["doc"], "notes.pdf", { type: "application/pdf" })
    const unlabeledVideo = new File(["clip"], "clip.mp4")
    expect(isCanvasFileCompatibleWithKind(video, "image")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(pdf, "image")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(unlabeledVideo, "image")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(new File(["png"], "hero.png", { type: "image/png" }), "image")).toBe(true)
  })

  test("rejects cross-cluster local files for every relinkable kind", () => {
    const image = { name: "hero.png", type: "image/png" }
    const video = { name: "clip.mp4", type: "video/mp4" }
    const audio = { name: "take.wav", type: "audio/wav" }
    const text = { name: "notes.md" }
    const archive = { name: "archive.zip", type: "application/zip" }

    expect(isCanvasFileCompatibleWithKind(image, "image")).toBe(true)
    expect(isCanvasFileCompatibleWithKind(video, "image")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(audio, "image")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(text, "image")).toBe(false)

    expect(isCanvasFileCompatibleWithKind(video, "video")).toBe(true)
    expect(isCanvasFileCompatibleWithKind(image, "video")).toBe(false)

    expect(isCanvasFileCompatibleWithKind(audio, "audio")).toBe(true)
    expect(isCanvasFileCompatibleWithKind(video, "audio")).toBe(false)

    expect(isCanvasFileCompatibleWithKind(text, "text")).toBe(true)
    expect(isCanvasFileCompatibleWithKind(image, "text")).toBe(false)

    expect(isCanvasFileCompatibleWithKind(archive, "file")).toBe(true)
    expect(isCanvasFileCompatibleWithKind(image, "file")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(video, "file")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(text, "file")).toBe(false)
    expect(isCanvasFileCompatibleWithKind(archive, "folder")).toBe(false)
  })
})
