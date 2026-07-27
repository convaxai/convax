import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SettingsRow } from "../src/components/settings-row"
import { Switch } from "../src/components/switch"

test("pairs setting copy with a compact action without product assumptions", () => {
  const markup = renderToStaticMarkup(
    <SettingsRow
      action={<Switch aria-label="Reduce motion" checked={false} id="reduce-motion" />}
      description="Minimize interface animation."
      htmlFor="reduce-motion"
      label="Reduce motion"
    />,
  )

  expect(markup).toContain('data-slot="settings-row"')
  expect(markup).toContain('for="reduce-motion"')
  expect(markup).toContain("Minimize interface animation.")
  expect(markup).toContain('role="switch"')
})
