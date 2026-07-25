import { describe, expect, test } from "bun:test"

describe("Canvas file-card assistant sizing", () => {
  test("leaves visual chrome to one wider host-rendered composer surface", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const assistantRule = styles.match(/\.convax-canvas \.convax-node-assistant \{[^}]+\}/s)?.[0] ?? ""

    expect(assistantRule).toContain("width: min(720px")
    expect(assistantRule).toContain("height: auto")
    expect(assistantRule).toContain("border: 0")
    expect(assistantRule).toContain("background: transparent")
    expect(assistantRule).toContain("box-shadow: none")
    expect(assistantRule).not.toContain("height: min(380px")
  })

  test("uses aligned borderless chrome for bounded image and video cards", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const mediaSurfaceRule =
      styles.match(/\.convax-canvas \.convax-node__surface--media \{[^}]+\}/s)?.[0] ?? ""

    expect(mediaSurfaceRule).toContain("border-width: 0")
    expect(mediaSurfaceRule).toContain("border-radius: 24px")
    expect(mediaSurfaceRule).toContain("background: transparent")
  })

  test("gives the expanded text editor a centered document surface", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const expandedEditorRule =
      styles.match(
        /\.convax-canvas \.convax-text-editor--expanded \.convax-text-editor__prosemirror \{[^}]+\}/s,
      )?.[0] ?? ""
    const toolbarInnerRule =
      styles.match(/\.convax-canvas \.convax-text-editor-dialog__toolbar-inner \{[^}]+\}/s)?.[0] ?? ""

    expect(expandedEditorRule).toContain("width: min(920px, 100%)")
    expect(expandedEditorRule).toContain("min-height: 100%")
    expect(expandedEditorRule).toContain("padding: 48px clamp(28px, 6vw, 80px) 120px")
    expect(expandedEditorRule).toContain("font-size: 16px")
    expect(toolbarInnerRule).toContain("width: min(920px, 100%)")
    expect(toolbarInnerRule).toContain("margin: 0 auto")
  })
})
