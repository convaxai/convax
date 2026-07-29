import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CanvasTitle } from "./canvas-title"

describe("CanvasTitle", () => {
  test("renders the current Canvas as bounded, passive canvas chrome", () => {
    const name = "A very long Canvas title that should stay inside the workspace chrome"
    const markup = renderToStaticMarkup(<CanvasTitle name={name} />)

    expect(markup).toContain('data-canvas-title="true"')
    expect(markup).toContain(`aria-label="Current Canvas: ${name}"`)
    expect(markup).toContain(`title="${name}"`)
    expect(markup).toContain("pointer-events-none")
    expect(markup).toContain("truncate")
    expect(markup).not.toContain("<button")
  })
})
