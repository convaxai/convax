export const webPluginManifestFileName = "manifest.json"
export const webPluginManifestSchema = "convax.plugin/1" as const

export const webPluginCapabilities = [
  "canvas.connectedImages.read",
  "canvas.node.read",
  "canvas.node.write",
  "project.files.read",
  "agent.prompt",
  "ui.fullscreen",
] as const

export type WebPluginCapability = (typeof webPluginCapabilities)[number]

export interface WebPluginCanvasRendererContribution {
  create?: boolean
  extensions?: string[]
  height?: number
  mimeTypes?: string[]
  nodeKinds?: string[]
  width?: number
}

export interface WebPluginToolbarContribution {
  /** Opaque command id delivered to the sandboxed plugin frame. */
  command: string
  id: string
  title: string
}

export interface WebPluginManifest {
  capabilities: WebPluginCapability[]
  contributes: {
    canvas: {
      renderer: WebPluginCanvasRendererContribution
      toolbar?: WebPluginToolbarContribution[]
    }
  }
  description: string
  /** Sandboxed HTML entry, relative to the plugin package. */
  entry: string
  id: string
  name: string
  schema: typeof webPluginManifestSchema
  /** Optional SKILL.md path relative to the plugin package. */
  skill?: string
  version: string
}

/** Contains only validated, portable values and is safe to expose to a renderer. */
export interface InstalledWebPluginSummary extends WebPluginManifest {}

export interface WebPluginCatalogItem extends WebPluginManifest {
  installed: boolean
  /** Validated installed version when the catalog id is already present. */
  installedVersion?: string
  /** True only when the trusted catalog contains a newer SemVer. */
  updateAvailable?: boolean
}

export interface WebPluginInventory {
  catalog: WebPluginCatalogItem[]
  installed: InstalledWebPluginSummary[]
}

export interface WebPluginClient {
  importPlugin(): Promise<InstalledWebPluginSummary | null>
  installCatalogPlugin(input: { id: string }): Promise<InstalledWebPluginSummary>
  listPlugins(): Promise<WebPluginInventory>
  onDidChange(listener: () => void): () => void
  uninstallPlugin(input: { id: string }): Promise<boolean>
}

const allowedCapabilities = new Set<string>(webPluginCapabilities)
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function compareNumericIdentifier(left: string, right: string) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

function splitSemver(value: string) {
  if (!semverPattern.test(value)) throw new Error("Plugin version must be valid SemVer")
  const withoutBuild = value.split("+", 1)[0]
  const prereleaseIndex = withoutBuild.indexOf("-")
  const core = (prereleaseIndex === -1 ? withoutBuild : withoutBuild.slice(0, prereleaseIndex)).split(".")
  const prerelease = prereleaseIndex === -1 ? [] : withoutBuild.slice(prereleaseIndex + 1).split(".")
  return { core, prerelease }
}

/** Compares two validated Plugin SemVer values using SemVer precedence. */
export function compareWebPluginVersions(left: string, right: string) {
  const leftVersion = splitSemver(left)
  const rightVersion = splitSemver(right)
  for (let index = 0; index < 3; index += 1) {
    const compared = compareNumericIdentifier(leftVersion.core[index], rightVersion.core[index])
    if (compared) return compared
  }
  if (leftVersion.prerelease.length === 0 || rightVersion.prerelease.length === 0) {
    return leftVersion.prerelease.length === rightVersion.prerelease.length
      ? 0
      : leftVersion.prerelease.length === 0
        ? 1
        : -1
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumericIdentifier(leftIdentifier, rightIdentifier)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unknown) throw new Error(`${label} contains an unsupported field: ${unknown}`)
}

function requireString(value: unknown, label: string, maxLength: number) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

export function requireWebPluginId(value: unknown) {
  const id = requireString(value, "Plugin id", 80)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Plugin id must use kebab-case")
  }
  validatePortablePluginSegment(id)
  return id
}

export function validatePortablePluginSegment(value: string) {
  const stem = value.split(".")[0] ?? ""
  if (
    !value ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value) ||
    /[. ]$/.test(value) ||
    windowsReservedName.test(stem)
  ) {
    throw new Error(`Plugin path contains an invalid Windows filename: ${value}`)
  }
  return value
}

/** Validate a portable POSIX path without repairing or normalizing caller input. */
export function requireWebPluginRelativePath(value: unknown, label = "Plugin path") {
  const input = requireString(value, label, 1_024)
  if (input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/.test(input) || input.startsWith("//")) {
    throw new Error(`${label} must be a portable relative path`)
  }
  const segments = input.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a portable relative path`)
  }
  segments.forEach(validatePortablePluginSegment)
  return input
}

function parseStringArray(value: unknown, label: string, validate: (item: string) => string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 64) throw new Error(`${label} must be an array`)
  const items = value.map((item) => validate(requireString(item, label, 128)))
  if (new Set(items).size !== items.length) throw new Error(`${label} contains duplicate values`)
  return items
}

function parseDimension(value: unknown, label: string) {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 8_192) {
    throw new Error(`${label} must be an integer between 1 and 8192`)
  }
  return value as number
}

function parseRenderer(value: unknown): WebPluginCanvasRendererContribution {
  const input = asRecord(value, "Canvas renderer contribution")
  assertKeys(
    input,
    ["create", "extensions", "height", "mimeTypes", "nodeKinds", "width"],
    "Canvas renderer contribution",
  )
  if (input.create !== undefined && typeof input.create !== "boolean") {
    throw new Error("Canvas renderer create must be a boolean")
  }
  const extensions = parseStringArray(input.extensions, "Canvas renderer extensions", (item) => {
    const normalized = item.toLowerCase()
    if (!/^\.[a-z0-9][a-z0-9._+-]{0,31}$/.test(normalized))
      throw new Error(`Invalid Canvas renderer extension: ${item}`)
    return normalized
  })
  const mimeTypes = parseStringArray(input.mimeTypes, "Canvas renderer MIME types", (item) => {
    const normalized = item.toLowerCase()
    if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
      throw new Error(`Invalid Canvas renderer MIME type: ${item}`)
    }
    return normalized
  })
  const nodeKinds = parseStringArray(input.nodeKinds, "Canvas renderer node kinds", (item) => {
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(item)) throw new Error(`Invalid Canvas renderer node kind: ${item}`)
    return item
  })
  if (input.create !== true && !extensions?.length && !mimeTypes?.length && !nodeKinds?.length) {
    throw new Error("Canvas renderer must be creatable or match an extension, MIME type, or node kind")
  }
  return {
    ...(input.create === undefined ? {} : { create: input.create }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(input.height === undefined ? {} : { height: parseDimension(input.height, "Canvas renderer height") }),
    ...(mimeTypes === undefined ? {} : { mimeTypes }),
    ...(nodeKinds === undefined ? {} : { nodeKinds }),
    ...(input.width === undefined ? {} : { width: parseDimension(input.width, "Canvas renderer width") }),
  }
}

function parseToolbar(value: unknown): WebPluginToolbarContribution[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 32) throw new Error("Canvas toolbar must be an array")
  const toolbar = value.map((item, index) => {
    const input = asRecord(item, `Canvas toolbar item ${index}`)
    assertKeys(input, ["command", "id", "title"], `Canvas toolbar item ${index}`)
    const id = requireString(input.id, `Canvas toolbar item ${index} id`, 80)
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) throw new Error(`Invalid Canvas toolbar item id: ${id}`)
    return {
      command: requireString(input.command, `Canvas toolbar item ${index} command`, 256),
      id,
      title: requireString(input.title, `Canvas toolbar item ${index} title`, 120),
    }
  })
  if (new Set(toolbar.map((item) => item.id)).size !== toolbar.length) {
    throw new Error("Canvas toolbar contains duplicate ids")
  }
  return toolbar
}

export function parseWebPluginManifest(value: unknown): WebPluginManifest {
  const input = asRecord(value, "Plugin manifest")
  assertKeys(
    input,
    ["capabilities", "contributes", "description", "entry", "id", "name", "schema", "skill", "version"],
    "Plugin manifest",
  )
  if (input.schema !== webPluginManifestSchema) throw new Error("Plugin manifest schema is not supported")
  const entry = requireWebPluginRelativePath(input.entry, "Plugin entry")
  if (!entry.toLowerCase().endsWith(".html")) throw new Error("Plugin entry must be an HTML file")
  const version = requireString(input.version, "Plugin version", 128)
  if (!semverPattern.test(version)) throw new Error("Plugin version must be valid SemVer")
  const capabilities = input.capabilities === undefined ? [] : input.capabilities
  if (
    !Array.isArray(capabilities) ||
    capabilities.length > webPluginCapabilities.length ||
    capabilities.some((capability) => typeof capability !== "string" || !allowedCapabilities.has(capability)) ||
    new Set(capabilities).size !== capabilities.length
  ) {
    throw new Error("Plugin capabilities contain an unsupported or duplicate capability")
  }
  const contributes = asRecord(input.contributes, "Plugin contributions")
  assertKeys(contributes, ["canvas"], "Plugin contributions")
  const canvas = asRecord(contributes.canvas, "Canvas contributions")
  assertKeys(canvas, ["renderer", "toolbar"], "Canvas contributions")
  const toolbar = parseToolbar(canvas.toolbar)
  return {
    capabilities: [...capabilities] as WebPluginCapability[],
    contributes: {
      canvas: {
        renderer: parseRenderer(canvas.renderer),
        ...(toolbar === undefined ? {} : { toolbar }),
      },
    },
    description: requireString(input.description, "Plugin description", 2_000),
    entry,
    id: requireWebPluginId(input.id),
    name: requireString(input.name, "Plugin name", 120),
    schema: webPluginManifestSchema,
    ...(input.skill === undefined ? {} : { skill: requireWebPluginRelativePath(input.skill, "Plugin skill") }),
    version,
  }
}

export function toInstalledWebPluginSummary(manifest: WebPluginManifest): InstalledWebPluginSummary {
  return parseWebPluginManifest(manifest)
}
