import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export const desktopProductName = "Convax"

export interface DesktopDevelopmentIdentity {
  id: string
  label: string
}

const desktopDevelopmentIdentityPattern = /^[a-z0-9][a-z0-9-]{0,31}$/
const desktopDevelopmentIdentityEdgeWhitespacePattern =
  /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$/u

export function desktopDevelopmentIdentity(input: {
  isPackaged: boolean
  requestedId?: string
  requestedLabel?: string
}): DesktopDevelopmentIdentity | undefined {
  if (input.isPackaged) return undefined
  const id = input.requestedId
  const label = input.requestedLabel
  if (!id && !label) return undefined
  if (!id || !desktopDevelopmentIdentityPattern.test(id)) {
    throw new Error("Development environment id must match [a-z0-9][a-z0-9-]{0,31}")
  }
  if (
    !label ||
    [...label].length > 24 ||
    desktopDevelopmentIdentityEdgeWhitespacePattern.test(label) ||
    /[\u0000-\u001f\u007f]/u.test(label)
  ) {
    throw new Error("Development environment label must contain 1..24 normalized characters without controls")
  }
  return Object.freeze({ id, label })
}

export function desktopApplicationName(input: {
  developmentIdentity?: DesktopDevelopmentIdentity
  isPackaged: boolean
  packagedName?: string
}) {
  const packagedName = input.packagedName?.trim()
  const productName = input.isPackaged && packagedName ? packagedName : desktopProductName
  return !input.isPackaged && input.developmentIdentity
    ? `${productName} [${input.developmentIdentity.label}]`
    : productName
}

export function desktopRendererUrl(input: { isPackaged: boolean; requestedUrl?: string }) {
  if (input.isPackaged) return undefined
  return input.requestedUrl?.trim() || undefined
}

export function desktopRendererUrlWithDevelopmentIdentity(input: {
  developmentIdentity?: DesktopDevelopmentIdentity
  url: string
}) {
  if (!input.developmentIdentity) return input.url
  const url = new URL(input.url)
  url.searchParams.set("convax-solo-task-id", input.developmentIdentity.id)
  url.searchParams.set("convax-solo-task-label", input.developmentIdentity.label)
  return url.href
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
  developmentIdentity?: DesktopDevelopmentIdentity
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
  if (input.developmentIdentity) {
    const requested = input.requestedDirectory?.trim()
    if (!requested) throw new Error("Development environment userData directory is required")
    if (!isAbsolute(requested)) throw new Error("Development environment userData directory must be absolute")
    const directory = resolve(requested)
    if (basename(directory) !== "user-data" || basename(dirname(directory)) !== input.developmentIdentity.id) {
      throw new Error("Development environment userData directory must be the task id's user-data child")
    }
    return directory
  }
  return input.requestedDirectory || join(input.appDataDirectory, "@convax", "desktop")
}
