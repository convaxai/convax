import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button, buttonVariants } from "../src/components/button"

describe("Button", () => {
  test("keeps the compatibility defaults while exposing shared interaction behavior", () => {
    const markup = renderToStaticMarkup(<Button>Continue</Button>)

    expect(markup).toContain('type="button"')
    expect(markup).toContain('data-slot="button"')
    expect(markup).toContain("bg-primary")
    expect(markup).toContain('data-ui-interactive=""')
  })

  test("supports compact toolbar and aria-pressed states without changing dimensions", () => {
    const markup = renderToStaticMarkup(
      <Button aria-pressed size="icon-xs" variant="toolbar">
        Open
      </Button>,
    )

    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain("size-7")
    expect(markup).toContain("aria-pressed:bg-interactive-selected")
    expect(buttonVariants({ size: "compact", variant: "toolbar" })).toContain("h-7")
  })
})
