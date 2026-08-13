import { expect, test } from "bun:test"
import { desktopApplicationMenuTemplate } from "./desktop-update-menu"

test("places manual update checks in the native macOS app menu and Windows Help menu", () => {
  const onCheckForUpdates = () => undefined
  const mac = desktopApplicationMenuTemplate({ isMac: true, onCheckForUpdates, productName: "Convax" })
  const windows = desktopApplicationMenuTemplate({ isMac: false, onCheckForUpdates, productName: "Convax" })
  expect(mac[0]).toMatchObject({ label: "Convax" })
  expect(JSON.stringify(mac)).toContain("Check for Updates")
  expect(windows.at(-1)).toMatchObject({ label: "Help" })
  expect(JSON.stringify(windows)).toContain("Check for Updates")
})
