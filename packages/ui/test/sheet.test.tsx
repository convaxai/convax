import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../src/components/sheet"

test("uses the dialog accessibility contract with a directional sheet surface", () => {
  const markup = renderToStaticMarkup(
    <Sheet open>
      <SheetContent side="left">
        <SheetTitle>Inspector</SheetTitle>
        <SheetDescription>Selected node details</SheetDescription>
      </SheetContent>
    </Sheet>,
  )

  expect(markup).toContain('role="dialog"')
  expect(markup).toContain('aria-modal="true"')
  expect(markup).toContain('data-slot="sheet-content"')
  expect(markup).toContain('data-sheet-side="left"')
  expect(markup).toContain("items-stretch justify-start")
})
