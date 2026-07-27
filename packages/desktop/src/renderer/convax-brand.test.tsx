import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ConvaxBrand } from "./convax-brand"

describe("ConvaxBrand", () => {
  test("renders the traced 31-spoke radial C on the black brand tile", () => {
    const markup = renderToStaticMarkup(<ConvaxBrand />)

    expect(markup).toContain('data-convax-brand="true"')
    expect(markup).toContain('aria-label="Convax"')
    expect(markup).toContain('data-logo-part="radial-c"')
    expect(markup).toContain('data-spoke-count="31"')
    expect(markup).toContain('transform="translate(24 27.64) scale(.26)"')
    expect(markup.match(/<path/g)).toHaveLength(31)
    expect(markup).toContain("<rect")
    expect(markup).toContain('fill="#080808"')
    expect(markup).not.toContain('data-logo-part="player"')
    expect(markup).not.toContain('data-logo-part="canvas-x"')
    expect(markup).not.toContain(">convax</span>")
  })

  test("can expose the compact wordmark with a distinct X", () => {
    const markup = renderToStaticMarkup(<ConvaxBrand showWordmark />)

    expect(markup).toContain("conva")
    expect(markup).toContain("text-brand")
    expect(markup).toContain(">x</span>")
  })

  test("supports a tile-free monochrome treatment for constrained surfaces", () => {
    const markup = renderToStaticMarkup(<ConvaxBrand tone="monochrome" />)

    expect(markup).not.toContain("<rect")
    expect(markup).toContain('fill="currentColor"')
    expect(markup.match(/<path/g)).toHaveLength(31)
  })
})
