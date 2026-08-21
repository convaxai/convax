import { describe, expect, test } from "bun:test"
import { canvasFileKindLabel, canvasMessage, resolveCanvasUiLocale } from "./copy"

describe("Canvas UI copy", () => {
  test("admits only the host-owned English and Chinese locales", () => {
    expect(resolveCanvasUiLocale("en")).toBe("en")
    expect(resolveCanvasUiLocale("zh-CN")).toBe("zh-CN")
    expect(resolveCanvasUiLocale("zh")).toBe("en")
    expect(resolveCanvasUiLocale(undefined)).toBe("en")
  })

  test("localizes the empty media add control", () => {
    expect(canvasMessage("en", "mediaEmpty.add")).toBe("Add")
    expect(canvasMessage("en", "mediaEmpty.addImage")).toBe("Add image")
    expect(canvasMessage("en", "mediaEmpty.addVideo")).toBe("Add video")
    expect(canvasMessage("zh-CN", "mediaEmpty.add")).toBe("添加")
    expect(canvasMessage("zh-CN", "mediaEmpty.addImage")).toBe("添加图片")
    expect(canvasMessage("zh-CN", "mediaEmpty.addVideo")).toBe("添加视频")
  })

  test("localizes unavailable media fallback copy", () => {
    expect(canvasMessage("en", "mediaEmpty.unavailable", { kind: canvasMessage("en", "media.image") })).toBe(
      "image unavailable",
    )
    expect(canvasMessage("zh-CN", "mediaEmpty.unavailable", { kind: canvasMessage("zh-CN", "media.image") })).toBe(
      "图片不可用",
    )
  })

  test("localizes incompatible local-file relink copy for every file kind cluster", () => {
    expect(canvasFileKindLabel("en", "text")).toBe("text")
    expect(canvasFileKindLabel("zh-CN", "audio")).toBe("音频")
    expect(canvasMessage("en", "resourceRelink.incompatibleFile", { kind: canvasFileKindLabel("en", "video") })).toBe(
      "The selected file does not match this video node",
    )
    expect(
      canvasMessage("zh-CN", "resourceRelink.incompatibleFile", { kind: canvasFileKindLabel("zh-CN", "image") }),
    ).toBe("所选文件与该图片节点类型不匹配")
  })
})
