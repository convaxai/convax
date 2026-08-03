import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { FolderGlyph } from "./components/folder-glyph"

describe("FolderGlyph", () => {
  test("renders one decorative folder material in picker and compact sizes", () => {
    const picker = renderToStaticMarkup(<FolderGlyph color="oklch(0.74 0.115 146)" />)
    const compact = renderToStaticMarkup(<FolderGlyph color="oklch(0.73 0.105 245)" size="compact" />)

    expect(picker).toContain('data-ui-folder-glyph=""')
    expect(picker).toContain('data-ui-folder-glyph-size="picker"')
    expect(picker).toContain("oklch(0.74 0.115 146) 64%")
    expect(compact).toContain('data-ui-folder-glyph-size="compact"')
    expect(compact).toContain("oklch(0.73 0.105 245) 64%")
  })
})
