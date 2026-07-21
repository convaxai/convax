import type { CanvasDocument } from "@convax/canvas/core"

export const projectResourceReferenceKey = "convaxProjectResource"
export const projectResourceBindingsKey = "convaxProjectResourceBindings"
export const managedProjectAssetBlobDirectory = ".convax/assets/blobs"

export type ProjectResourceReference =
  | { kind: "project-file"; path: string }
  | { kind: "managed-asset"; sha256: string; name: string; mediaType?: string }
  | { kind: "project-directory"; path: string }

const projectResourceKinds = new Set(["project-file", "managed-asset", "project-directory"])
const resourceNodeKinds = new Set(["text", "image", "video", "audio", "file", "folder"])
const legacyResourceKeys = ["text", "richText", "url", "posterUrl", "path"] as const
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
const mediaTypePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const sha256Pattern = /^[a-f0-9]{64}$/

export function managedAssetPath(sha256: string) {
  requireSha256(sha256)
  return `${managedProjectAssetBlobDirectory}/${sha256}`
}

export function requireProjectResourceReference(value: unknown): ProjectResourceReference {
  if (!isRecord(value) || typeof value.kind !== "string" || !projectResourceKinds.has(value.kind)) {
    throw new Error("Project resource reference is invalid")
  }
  if (value.kind === "project-file" || value.kind === "project-directory") {
    requireExactKeys(value, ["kind", "path"], ["kind", "path"])
    return { kind: value.kind, path: requirePortableProjectPath(value.path) }
  }

  requireExactKeys(value, ["kind", "sha256", "name", "mediaType"], ["kind", "sha256", "name"])
  const reference: ProjectResourceReference = {
    kind: "managed-asset",
    name: requireManagedAssetName(value.name),
    sha256: requireSha256(value.sha256),
  }
  if (value.mediaType !== undefined) reference.mediaType = requireMediaType(value.mediaType)
  return reference
}

export function getProjectResourceReference(metadata: unknown): ProjectResourceReference | null {
  if (!isRecord(metadata)) return null
  try {
    return requireProjectResourceReference(metadata[projectResourceReferenceKey])
  } catch {
    return null
  }
}

export function dehydrateProjectCanvasDocument(document: CanvasDocument): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = node.data.metadata
      if (
        isRecord(metadata)
        && Object.hasOwn(metadata, projectResourceBindingsKey)
      ) {
        assertSafeHostOwnedResourceSlot(metadata[projectResourceBindingsKey])
      }

      if (!resourceNodeKinds.has(node.data.kind)) return node
      if (!isRecord(metadata)) {
        throw new Error(`Canvas resource node ${node.id} requires Project resource reference metadata`)
      }
      if (Object.hasOwn(metadata, "convaxProjectFile")) {
        throw new Error(`Canvas resource node ${node.id} contains legacy convaxProjectFile metadata`)
      }
      for (const key of legacyResourceKeys) {
        if (Object.hasOwn(node.data, key)) {
          throw new Error(`Canvas resource node ${node.id} contains legacy ${key} data`)
        }
      }

      const reference = getProjectResourceReference(metadata)
      if (!reference) throw new Error(`Canvas resource node ${node.id} requires a valid Project resource reference`)
      if (node.data.kind === "folder" && reference.kind !== "project-directory") {
        throw new Error(`Canvas folder node ${node.id} requires a project-directory reference`)
      }
      if (node.data.kind !== "folder" && reference.kind === "project-directory") {
        throw new Error(`Canvas content node ${node.id} cannot use a project-directory reference`)
      }

      const { resourceState: _resourceState, ...persistedData } = node.data
      return {
        ...node,
        data: {
          ...persistedData,
          metadata: { ...metadata, [projectResourceReferenceKey]: reference },
        },
      }
    }),
  }
}

function requirePortableProjectPath(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Invalid portable Project path")
  }
  if (!value
    || value.length > 4_096
    || value !== value.trim()
    || value.includes("\\")
    || value.startsWith("/")
    || value.startsWith("//")
    || /^[A-Za-z]:/.test(value)
    || !hasOnlyUnicodeScalars(value)) {
    throw new Error(`Invalid portable Project path: ${value}`)
  }
  const segments = value.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid portable Project path: ${value}`)
  }
  if (segments[0]!.toLowerCase() === ".convax") {
    throw new Error(`Project private storage cannot be used as a resource: ${value}`)
  }
  for (const segment of segments) requirePortableNameSegment(segment, "Project path")
  return segments.join("/")
}

function requireManagedAssetName(value: unknown) {
  if (typeof value !== "string"
    || value !== value.trim()
    || unicodeScalarLength(value) > 255) {
    throw new Error("Managed asset name is invalid")
  }
  requirePortableNameSegment(value, "Managed asset name")
  return value
}

function requirePortableNameSegment(value: string, label: string) {
  const stem = value.split(".", 1)[0] ?? ""
  if (!value
    || value === "."
    || value === ".."
    || !hasOnlyUnicodeScalars(value)
    || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value)
    || /[. ]$/.test(value)
    || windowsReservedName.test(stem)) {
    throw new Error(`${label} is invalid: ${value}`)
  }
  return value
}

function requireSha256(value: unknown) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new Error("Managed asset digest is invalid")
  }
  return value
}

function requireMediaType(value: unknown) {
  if (typeof value !== "string" || value.length > 255) throw new Error("Managed asset media type is invalid")
  const normalized = value.trim().toLowerCase()
  if (!mediaTypePattern.test(normalized)) throw new Error("Managed asset media type is invalid")
  return normalized
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
) {
  const allowedKeys = new Set(allowed)
  const extra = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (extra) throw new Error(`Project resource reference contains unsupported field: ${extra}`)
  const missing = required.find((key) => !Object.hasOwn(value, key))
  if (missing) throw new Error(`Project resource reference is missing field: ${missing}`)
}

function assertSafeHostOwnedResourceSlot(value: unknown, seen = new WeakSet<object>(), depth = 0): void {
  if (depth > 100) throw new Error("Canvas host-owned resource slot is too deeply nested")
  if (typeof value === "string") {
    if (value.startsWith("/")
      || value.startsWith("\\")
      || /^[A-Za-z]:[\\/]/.test(value)
      || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
      throw new Error("Canvas host-owned resource slot contains a native path or runtime URL")
    }
    return
  }
  if (!value || typeof value !== "object") return
  if (seen.has(value)) throw new Error("Canvas host-owned resource slot contains a cycle")
  seen.add(value)
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeHostOwnedResourceSlot(entry, seen, depth + 1)
  } else {
    for (const entry of Object.values(value)) assertSafeHostOwnedResourceSlot(entry, seen, depth + 1)
  }
  seen.delete(value)
}

function unicodeScalarLength(value: string) {
  if (!hasOnlyUnicodeScalars(value)) return Number.POSITIVE_INFINITY
  return [...value].length
}

function hasOnlyUnicodeScalars(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
