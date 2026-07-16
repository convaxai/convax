import { join } from "node:path"

export const desktopProductName = "Convax"

export function desktopUserDataDirectory(input: {
  appDataDirectory: string
  isPackaged: boolean
  requestedDirectory?: string
}) {
  if (input.isPackaged) return undefined
  return input.requestedDirectory || join(input.appDataDirectory, "@convax", "desktop")
}
