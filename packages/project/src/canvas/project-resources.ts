import type { CanvasDocument, CanvasResourceStatus } from "@convax/canvas/core"

export const projectResourceReferenceKey = "convaxProjectResource"
export const projectResourceBindingsKey = "convaxProjectResourceBindings"
export const managedProjectAssetBlobDirectory = ".convax/assets/blobs"

export type ProjectResourceReference =
  | { kind: "project-file"; path: string }
  | { kind: "managed-asset"; sha256: string; name: string; mediaType?: string }
  | { kind: "project-directory"; path: string }

export type ProjectResourceBindings = Record<string, Exclude<ProjectResourceReference, { kind: "project-directory" }>>

export interface ProjectResourceSnapshot {
  canSaveEditableCopy?: boolean
  contentRevision?: string
  editableText?: boolean
  error?: string
  mediaType?: string
  name?: string
  posterUrl?: string
  status: CanvasResourceStatus
  text?: string
  url?: string
}

const projectResourceKinds = new Set(["project-file", "managed-asset", "project-directory"])
const resourceNodeKinds = new Set(["text", "image", "video", "audio", "file", "folder"])
const pendingResourceNodeKinds = new Set(["text", "image", "video", "audio"])
const legacyResourceKeys = ["format", "text", "richText", "url", "posterUrl", "path"] as const
const baseDurableResourceDataKeys = ["kind", "label", "description", "status", "error", "metadata", "name"] as const
const durableMediaDataKeys = new Set([
  ...baseDurableResourceDataKeys,
  "mimeType",
  "fit",
  "width",
  "height",
  "durationMs",
])
const durableResourceDataKeys = {
  audio: durableMediaDataKeys,
  file: durableMediaDataKeys,
  folder: new Set(baseDurableResourceDataKeys),
  image: durableMediaDataKeys,
  text: new Set([...baseDurableResourceDataKeys, "mimeType"]),
  video: durableMediaDataKeys,
} as const
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
const mediaTypePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const sha256Pattern = /^[a-f0-9]{64}$/
const projectResourceBindingSlotPattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/
const dangerousBindingSlotNames = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "prototype",
  "toLocaleString",
  "toString",
  "valueOf",
])

export function managedAssetPath(sha256: string) {
  requireSha256(sha256)
  return `${managedProjectAssetBlobDirectory}/${sha256}`
}

export function requireProjectResourceReference(value: unknown): ProjectResourceReference {
  if (!isPlainJsonRecord(value)) {
    throw new Error("Project resource reference is invalid")
  }
  const kind = requireEnumerableDataProperty(value, "kind")
  if (typeof kind !== "string" || !projectResourceKinds.has(kind)) {
    throw new Error("Project resource reference is invalid")
  }
  if (kind === "project-file" || kind === "project-directory") {
    const fields = requireExactDataProperties(value, ["kind", "path"], ["kind", "path"])
    return { kind, path: requirePortableProjectPath(fields.path) }
  }

  const fields = requireExactDataProperties(value, ["kind", "sha256", "name", "mediaType"], ["kind", "sha256", "name"])
  const reference: ProjectResourceReference = {
    kind: "managed-asset",
    name: requireManagedAssetName(fields.name),
    sha256: requireSha256(fields.sha256),
  }
  if (fields.mediaType !== undefined) reference.mediaType = requireMediaType(fields.mediaType)
  return reference
}

export function requireProjectResourceBindings(value: unknown): ProjectResourceBindings {
  if (!isPlainJsonRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error("Project resource bindings must be a plain JSON record")
  }

  const bindings = Object.create(null) as ProjectResourceBindings
  for (const slot of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, slot)
    if (
      !projectResourceBindingSlotPattern.test(slot) ||
      dangerousBindingSlotNames.has(slot) ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error("Project resource binding slot is invalid")
    }

    let reference: ProjectResourceReference
    try {
      reference = requireProjectResourceReference(descriptor.value)
    } catch {
      throw new Error(`Project resource binding ${slot} is invalid`)
    }
    if (reference.kind === "project-directory") {
      throw new Error(`Project resource binding ${slot} cannot reference a directory`)
    }
    bindings[slot] = reference
  }
  return bindings
}

export function getProjectResourceReference(metadata: unknown): ProjectResourceReference | null {
  if (!isRecord(metadata)) return null
  try {
    return requireProjectResourceReference(metadata[projectResourceReferenceKey])
  } catch {
    return null
  }
}

export function collectProjectManagedAssetReferences(
  document: CanvasDocument,
): Array<Extract<ProjectResourceReference, { kind: "managed-asset" }>> {
  const references = new Map<string, Extract<ProjectResourceReference, { kind: "managed-asset" }>>()
  const collect = (reference: ProjectResourceReference) => {
    if (reference.kind === "managed-asset" && !references.has(reference.sha256)) {
      references.set(reference.sha256, reference)
    }
  }

  for (const node of document.nodes) {
    const metadata = node.data.metadata
    if (!isRecord(metadata)) continue

    if (Object.hasOwn(metadata, projectResourceReferenceKey)) {
      collect(requireTypedMetadataValue(metadata, projectResourceReferenceKey, requireProjectResourceReference))
    }
    if (Object.hasOwn(metadata, projectResourceBindingsKey)) {
      const bindings = requireTypedMetadataValue(metadata, projectResourceBindingsKey, requireProjectResourceBindings)
      for (const reference of Object.values(bindings)) collect(reference)
    }
  }

  return [...references.values()]
}

export function dehydrateProjectCanvasDocument(document: CanvasDocument): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = node.data.metadata
      if (isRecord(metadata) && Object.hasOwn(metadata, "convaxProjectFile")) {
        throw new Error(`Canvas node ${node.id} contains legacy convaxProjectFile metadata`)
      }

      let persistedMetadata = metadata
      if (isRecord(metadata) && Object.hasOwn(metadata, projectResourceBindingsKey)) {
        persistedMetadata = {
          ...metadata,
          [projectResourceBindingsKey]: requireProjectResourceBindings(metadata[projectResourceBindingsKey]),
        }
      }

      const hasRuntimeState = Object.hasOwn(node.data, "resourceState")
      const { resourceState: _resourceState, ...persistedData } = node.data

      if (!resourceNodeKinds.has(node.data.kind)) {
        if (persistedMetadata === metadata && !hasRuntimeState) return node
        const data = persistedMetadata === metadata ? persistedData : { ...persistedData, metadata: persistedMetadata }
        return { ...node, data }
      }
      if (!isRecord(metadata)) {
        throw new Error(`Canvas resource node ${node.id} requires Project resource reference metadata`)
      }
      const resourceMetadata = isRecord(persistedMetadata) ? persistedMetadata : metadata
      for (const key of legacyResourceKeys) {
        if (Object.hasOwn(node.data, key)) {
          throw new Error(`Canvas resource node ${node.id} contains legacy ${key} data`)
        }
      }
      const allowedDataKeys = durableResourceDataKeys[
        node.data.kind as keyof typeof durableResourceDataKeys
      ] as ReadonlySet<string>
      for (const key of Object.keys(node.data)) {
        if (key !== "resourceState" && !allowedDataKeys.has(key)) {
          throw new Error(`Canvas resource node ${node.id} contains unsupported durable ${key} data`)
        }
      }

      if (isUnbackedPendingResourceNode(node, resourceMetadata)) {
        return {
          ...node,
          data: {
            ...persistedData,
            metadata: {},
          },
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

      return {
        ...node,
        data: {
          ...persistedData,
          metadata: { ...resourceMetadata, [projectResourceReferenceKey]: reference },
        },
      }
    }),
  }
}

export async function hydrateProjectCanvasDocument(
  document: CanvasDocument,
  resolve: (reference: ProjectResourceReference) => Promise<ProjectResourceSnapshot>,
): Promise<CanvasDocument> {
  return hydrateProjectCanvasResources(
    document,
    resolve,
    () => true,
    () => true,
  )
}

export function markProjectCanvasResourcesStale(document: CanvasDocument): CanvasDocument {
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (!resourceNodeKinds.has(node.data.kind)) return node
    const reference = getProjectResourceReference(node.data.metadata)
    const resourceState = node.data.resourceState
    if (
      !reference ||
      reference.kind === "managed-asset" ||
      (resourceState !== null &&
        typeof resourceState === "object" &&
        "status" in resourceState &&
        resourceState.status === "stale")
    )
      return node
    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        resourceState: {
          ...(resourceState !== null && typeof resourceState === "object" ? resourceState : {}),
          status: "stale" as const,
        },
      },
    }
  })
  return changed ? { ...document, nodes } : document
}

export async function hydrateStaleProjectCanvasResources(
  document: CanvasDocument,
  resolve: (reference: ProjectResourceReference) => Promise<ProjectResourceSnapshot>,
): Promise<CanvasDocument> {
  return hydrateProjectCanvasResources(
    document,
    resolve,
    (_node, reference) => {
      return reference.kind !== "managed-asset"
    },
    (node) => isStaleResourceNode(node),
  )
}

function isStaleResourceNode(node: CanvasDocument["nodes"][number]) {
  const resourceState = node.data.resourceState
  return (
    resourceState !== null &&
    typeof resourceState === "object" &&
    "status" in resourceState &&
    resourceState.status === "stale"
  )
}

async function hydrateProjectCanvasResources(
  document: CanvasDocument,
  resolve: (reference: ProjectResourceReference) => Promise<ProjectResourceSnapshot>,
  shouldHydrate: (node: CanvasDocument["nodes"][number], reference: ProjectResourceReference) => boolean,
  shouldInspect: (node: CanvasDocument["nodes"][number]) => boolean,
): Promise<CanvasDocument> {
  const nodes = await Promise.all(
    document.nodes.map(async (node) => {
      if (!resourceNodeKinds.has(node.data.kind) || !shouldInspect(node)) return node
      if (isUnbackedPendingResourceNode(node, node.data.metadata)) return node
      const reference = getProjectResourceReference(node.data.metadata)
      if (!reference) {
        return {
          ...node,
          data: {
            ...node.data,
            resourceState: boundedHydrationFailure("Project resource reference is invalid"),
          },
        }
      }
      if (!shouldHydrate(node, reference)) return node
      try {
        return {
          ...node,
          data: {
            ...node.data,
            resourceState: requireProjectResourceSnapshot(await resolve(reference)),
          },
        }
      } catch {
        return {
          ...node,
          data: {
            ...node.data,
            resourceState: boundedHydrationFailure("Project resource could not be hydrated"),
          },
        }
      }
    }),
  )
  return { ...document, nodes }
}

function isUnbackedPendingResourceNode(node: CanvasDocument["nodes"][number], metadata: unknown) {
  return (
    pendingResourceNodeKinds.has(node.data.kind) &&
    (node.data.status === "pending" || node.data.status === "error") &&
    isRecord(metadata) &&
    Object.keys(metadata).length === 0
  )
}

function requireProjectResourceSnapshot(value: ProjectResourceSnapshot): ProjectResourceSnapshot {
  if (!isRecord(value) || !resourceStatuses.has(value.status as CanvasResourceStatus)) {
    throw new Error("Project resource snapshot is invalid")
  }
  const snapshot: ProjectResourceSnapshot = { status: value.status as CanvasResourceStatus }
  copyBoundedString(value, snapshot, "contentRevision", 128)
  copyBoundedString(value, snapshot, "error", 512)
  copyBoundedString(value, snapshot, "mediaType", 255)
  copyBoundedString(value, snapshot, "name", 255)
  copyBoundedString(value, snapshot, "posterUrl", 8_192)
  copyBoundedString(value, snapshot, "text", 16 * 1024 * 1024)
  copyBoundedString(value, snapshot, "url", 8_192)
  for (const key of ["canSaveEditableCopy", "editableText"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") throw new Error("Project resource snapshot is invalid")
      snapshot[key] = value[key]
    }
  }
  return snapshot
}

const resourceStatuses = new Set<CanvasResourceStatus>([
  "stale",
  "ready",
  "missing",
  "corrupt",
  "unsupported",
  "conflict",
])

function copyBoundedString<Key extends keyof ProjectResourceSnapshot>(
  source: ProjectResourceSnapshot,
  target: ProjectResourceSnapshot,
  key: Key,
  maximumLength: number,
) {
  const value = source[key]
  if (value === undefined) return
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error("Project resource snapshot is invalid")
  }
  Object.assign(target, { [key]: value })
}

function boundedHydrationFailure(error: string): ProjectResourceSnapshot {
  return { error, status: "corrupt" }
}

function requirePortableProjectPath(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Invalid portable Project path")
  }
  if (
    !value ||
    value.length > 4_096 ||
    value !== value.trim() ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.startsWith("//") ||
    /^[A-Za-z]:/.test(value) ||
    !hasOnlyUnicodeScalars(value)
  ) {
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

function requireTypedMetadataValue<T>(
  metadata: Record<string, unknown>,
  key: string,
  requireValue: (value: unknown) => T,
) {
  const descriptor = Object.getOwnPropertyDescriptor(metadata, key)
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    throw new Error(`Project resource metadata ${key} must be an enumerable data property`)
  }
  return requireValue(descriptor.value)
}

function requireManagedAssetName(value: unknown) {
  if (typeof value !== "string" || value !== value.trim() || unicodeScalarLength(value) > 255) {
    throw new Error("Managed asset name is invalid")
  }
  requirePortableNameSegment(value, "Managed asset name")
  return value
}

function requirePortableNameSegment(value: string, label: string) {
  const stem = value.split(".", 1)[0] ?? ""
  if (
    !value ||
    value === "." ||
    value === ".." ||
    !hasOnlyUnicodeScalars(value) ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value) ||
    /[. ]$/.test(value) ||
    windowsReservedName.test(stem)
  ) {
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

function requireEnumerableDataProperty(value: Record<string, unknown>, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    throw new Error("Project resource reference fields must be enumerable data properties")
  }
  return descriptor.value
}

function requireExactDataProperties(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error("Project resource reference contains unsupported symbol fields")
  }
  const allowedKeys = new Set(allowed)
  const fields = Object.create(null) as Record<string, unknown>
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Project resource reference contains unsupported field: ${key}`)
    }
    fields[key] = requireEnumerableDataProperty(value, key)
  }
  const missing = required.find((key) => !Object.hasOwn(fields, key))
  if (missing) throw new Error(`Project resource reference is missing field: ${missing}`)
  return fields
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

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
