import type { CanvasDocument } from "@convax/canvas/core"

export const projectFileReferenceKey = "convaxProjectFile"
export const managedProjectAssetDirectory = ".convax/assets"
export const projectCanvasManagedAssetDirectory = managedProjectAssetDirectory

const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i

export interface ProjectFileReference {
  path: string
}

export function getProjectFileReference(metadata: unknown): ProjectFileReference | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[projectFileReferenceKey]
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const reference = value as Record<string, unknown>
  return typeof reference.path === "string" ? { path: reference.path } : null
}

/** True only for portable files below Convax's private managed asset directory. */
export function isManagedProjectAssetPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 4_096 || value !== value.trim()) return false
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.startsWith("//")) {
    return false
  }
  const segments = value.split("/")
  if (segments.length < 3 || segments[0] !== ".convax" || segments[1] !== "assets") return false
  return segments.every((segment, index) => {
    if (!segment || segment === "." || segment === "..") return false
    if (index >= 2 && segment.replace(/[. ]+$/g, "").toLowerCase() === ".convax") return false
    const stem = segment.split(".")[0] ?? ""
    return !/[:*?"<>|\u0000-\u001f\u007f]/.test(segment)
      && !/[. ]$/.test(segment)
      && !windowsReservedName.test(stem)
  })
}

/** Validate the portable Project path admitted into a Canvas resource reference. */
export function requireProjectCanvasResourcePath(value: string) {
  const input = value.replaceAll("\\", "/")
  if (!input || input.includes("\0") || input.startsWith("/") || /^[a-zA-Z]:\//.test(input)) {
    throw new Error(`Invalid portable project path: ${value}`)
  }
  const segments: string[] = []
  for (const segment of input.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (!segments.length) throw new Error(`Project path escapes its root: ${value}`)
      segments.pop()
      continue
    }
    assertPortableSegment(segment)
    segments.push(segment)
  }
  if (!segments.length) throw new Error(`Invalid portable project path: ${value}`)
  if (
    segments[0]?.toLowerCase() === ".convax" &&
    (segments[0] !== ".convax" || segments[1] !== "assets" || segments.length < 3)
  ) {
    throw new Error(`Project private storage cannot be used as a Canvas resource: ${value}`)
  }
  return segments.join("/")
}

export function isProjectCanvasManagedAssetPath(value: unknown): value is string {
  return isManagedProjectAssetPath(value)
}

function assertPortableSegment(value: string) {
  const stem = value.split(".")[0]?.toUpperCase()
  if (
    /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value) ||
    /[. ]$/.test(value) ||
    (stem && /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/.test(stem))
  ) {
    throw new Error(`Invalid portable project path segment: ${value}`)
  }
}

export function dehydrateProjectCanvasDocument(document: CanvasDocument): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = "metadata" in node.data ? node.data.metadata : undefined
      if (!getProjectFileReference(metadata)) return node
      return { ...node, data: { ...node.data, posterUrl: undefined, url: "" } }
    }),
  }
}

export function hydrateProjectCanvasDocument(
  document: CanvasDocument,
  resolveFileUrl: (reference: ProjectFileReference) => string,
): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = "metadata" in node.data ? node.data.metadata : undefined
      const reference = getProjectFileReference(metadata)
      if (!reference) return node
      return { ...node, data: { ...node.data, url: resolveFileUrl(reference) } }
    }),
  }
}
