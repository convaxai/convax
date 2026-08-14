import type { Menu, MenuItemConstructorOptions } from "electron"

interface MenuApi {
  buildFromTemplate(template: MenuItemConstructorOptions[]): Menu
  setApplicationMenu(menu: Menu | null): void
}

export function desktopApplicationMenuTemplate(input: {
  isMac: boolean
  onCheckForUpdates(): void
  productName: string
}): MenuItemConstructorOptions[] {
  const updateItem: MenuItemConstructorOptions = {
    click: input.onCheckForUpdates,
    label: "Check for Updates…",
  }
  return [
    ...(input.isMac
      ? [
          {
            label: input.productName,
            submenu: [
              { role: "about" },
              { type: "separator" },
              updateItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: input.isMac ? [] : [updateItem],
    },
  ]
}

export function installDesktopApplicationMenu(
  menu: MenuApi,
  input: { isMac: boolean; onCheckForUpdates(): void; productName: string },
) {
  menu.setApplicationMenu(menu.buildFromTemplate(desktopApplicationMenuTemplate(input)))
}
