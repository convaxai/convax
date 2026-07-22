import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export const desktopProductName = "Convax"

export function desktopApplicationName(input: { isPackaged: boolean; packagedName?: string }) {
  const packagedName = input.packagedName?.trim()
  return input.isPackaged && packagedName ? packagedName : desktopProductName
}

export function desktopRendererUrl(input: { isPackaged: boolean; requestedUrl?: string }) {
  if (input.isPackaged) return undefined
  return input.requestedUrl?.trim() || undefined
}

export function desktopProjectWorkspaceDirectory(documentsDirectory: string) {
  return join(documentsDirectory, desktopProductName)
}

export function desktopUserDataDirectory(input: {
  appDataDirectory: string
  isPackaged: boolean
  packagedSmoke?: boolean
  packagedSmokeDirectory?: string
  requestedDirectory?: string
  temporaryDirectory?: string
}) {
  if (input.isPackaged) {
    if (!input.packagedSmoke) return undefined
    const requested = input.packagedSmokeDirectory?.trim()
    if (!requested) throw new Error("Packaged smoke userData directory is required")
    if (!input.temporaryDirectory) throw new Error("Packaged smoke temporary directory is required")
    if (!isAbsolute(requested)) throw new Error("Packaged smoke userData directory must be absolute")

    const directory = resolve(requested)
    const temporaryDirectory = resolve(input.temporaryDirectory)
    if (dirname(directory) !== temporaryDirectory || !basename(directory).startsWith("convax-packaged-smoke-")) {
      throw new Error("Packaged smoke userData directory must be a direct Convax smoke child of the OS temp directory")
    }
    return directory
  }
  return input.requestedDirectory || join(input.appDataDirectory, "@convax", "desktop")
}
