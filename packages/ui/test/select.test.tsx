import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../src/components/select"

describe("Select", () => {
  test("renders a styled select-only combobox with its controlled value", () => {
    const markup = renderToStaticMarkup(
      <Select value="second">
        <SelectTrigger id="example-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="first">First</SelectItem>
          <SelectItem value="second">Second</SelectItem>
        </SelectContent>
      </Select>,
    )

    expect(markup).toContain('data-slot="select-trigger"')
    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('aria-haspopup="listbox"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('data-state="closed"')
    expect(markup).toContain('data-slot="select-value"')
    expect(markup).toContain(">second</span>")
    expect(markup).not.toContain("<select")
  })

  test("disables the trigger from the root", () => {
    const markup = renderToStaticMarkup(
      <Select disabled value="first">
        <SelectTrigger><SelectValue /></SelectTrigger>
      </Select>,
    )

    expect(markup).toContain('disabled=""')
  })
})
