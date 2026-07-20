export const webPluginManifestFileName = "manifest.json"
export const webPluginManifestSchema = "convax.plugin/1" as const
export const webPluginManifestSchemaV2 = "convax.plugin/2" as const

export type WebPluginManifestSchema = typeof webPluginManifestSchema | typeof webPluginManifestSchemaV2

export const webPluginCapabilities = [
  "canvas.connectedImages.read",
  "canvas.node.read",
  "canvas.node.write",
  "project.files.read",
  "agent.prompt",
  "generation.execute",
  "ui.fullscreen",
] as const

export type WebPluginCapability = (typeof webPluginCapabilities)[number]

export const webPluginGenerationModalities = ["text", "image", "video", "audio"] as const
export const webPluginGenerationInputRoles = [
  "reference_image",
  "reference_video",
  "first_frame",
  "last_frame",
  "audio",
  "text",
] as const

export type WebPluginGenerationModality = (typeof webPluginGenerationModalities)[number]
export type WebPluginGenerationInputRole = (typeof webPluginGenerationInputRoles)[number]

export interface WebPluginGenerationToolContribution {
  acceptedInputs: WebPluginGenerationInputRole[]
  description: string
  id: string
  output: WebPluginGenerationModality
  title: string
}

export interface WebPluginGenerationContribution {
  tools: WebPluginGenerationToolContribution[]
}

export interface WebPluginMcpStdioRuntime {
  args?: string[]
  /** A portable executable name resolved by the trusted host; never a path. */
  command: string
  type: "mcp-stdio"
}

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
    canvas?: {
      renderer: WebPluginCanvasRendererContribution
      toolbar?: WebPluginToolbarContribution[]
    }
    /** Present only in a convax.plugin/2 manifest with a matching MCP runtime. */
    generation?: WebPluginGenerationContribution
  }
  description: string
  /** Sandboxed HTML entry, relative to the plugin package; absent for a headless Tool Plugin. */
  entry?: string
  id: string
  name: string
  /** v1 remains static-only; v2 can call generation tools and/or declare one external runtime. */
  schema: WebPluginManifestSchema
  /** Optional SKILL.md path relative to the plugin package. */
  skill?: string
  /** Present only in a convax.plugin/2 manifest with executable contributions. */
  runtime?: WebPluginMcpStdioRuntime
  version: string
}

/** Contains only validated, portable values and is safe to expose to a renderer. */
export interface InstalledWebPluginSummary extends WebPluginManifest {
  /** Host-authored provenance marker; imported packages can never set this field. */
  trustedBuiltin?: true
}

export type InstalledWebPluginCanvasSurface = InstalledWebPluginSummary & {
  contributes: InstalledWebPluginSummary["contributes"] & {
    canvas: NonNullable<InstalledWebPluginSummary["contributes"]["canvas"]>
  }
  entry: string
}

export function hasWebPluginCanvasSurface(
  plugin: InstalledWebPluginSummary,
): plugin is InstalledWebPluginCanvasSurface {
  return typeof plugin.entry === "string" && plugin.contributes.canvas !== undefined
}

export interface WebPluginCatalogItem extends WebPluginManifest {
  companionSkillName?: string
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
const allowedGenerationModalities = new Set<string>(webPluginGenerationModalities)
const allowedGenerationInputRoles = new Set<string>(webPluginGenerationInputRoles)
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

function isGenerationModality(value: unknown): value is WebPluginGenerationModality {
  return typeof value === "string" && allowedGenerationModalities.has(value)
}

function isGenerationInputRole(value: unknown): value is WebPluginGenerationInputRole {
  return typeof value === "string" && allowedGenerationInputRoles.has(value)
}

function parseGenerationInputRoles(value: unknown, label: string): WebPluginGenerationInputRole[] {
  if (!Array.isArray(value) || value.length > webPluginGenerationInputRoles.length) {
    throw new Error(`${label} contain an unsupported or duplicate role`)
  }
  const roles: WebPluginGenerationInputRole[] = []
  for (const role of value) {
    if (!isGenerationInputRole(role)) {
      throw new Error(`${label} contain an unsupported or duplicate role`)
    }
    roles.push(role)
  }
  if (new Set(roles).size !== roles.length) {
    throw new Error(`${label} contain an unsupported or duplicate role`)
  }
  return roles
}

function parseMcpStdioRuntime(value: unknown): WebPluginMcpStdioRuntime {
  const input = asRecord(value, "Plugin runtime")
  assertKeys(input, ["args", "command", "type"], "Plugin runtime")
  if (input.type !== "mcp-stdio") throw new Error("Plugin runtime type must be mcp-stdio")
  const command = requireString(input.command, "Plugin runtime command", 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command)) {
    throw new Error("Plugin runtime command must be a bare executable name")
  }
  validatePortablePluginSegment(command)
  let args: string[] | undefined
  if (input.args !== undefined) {
    if (!Array.isArray(input.args) || input.args.length > 64) {
      throw new Error("Plugin runtime args must be an array with at most 64 items")
    }
    args = input.args.map((value, index) => {
      const argument = requireString(value, `Plugin runtime arg ${index}`, 1_024)
      if (
        /[\s"'`;|&`$(){}[\]<>]/.test(argument) ||
        argument.includes("\\") ||
        /(^|=)(?:\/|[A-Za-z]:)/.test(argument) ||
        /(^|[=/])\.{1,2}(?:\/|$)/.test(argument)
      ) {
        throw new Error(
          `Plugin runtime arg ${index} must be a static CLI token without code, native paths, or traversal`,
        )
      }
      return argument
    })
  }
  return {
    ...(args === undefined ? {} : { args }),
    command,
    type: "mcp-stdio",
  }
}

function parseGeneration(value: unknown): WebPluginGenerationContribution {
  const input = asRecord(value, "Generation contribution")
  assertKeys(input, ["tools"], "Generation contribution")
  if (!Array.isArray(input.tools) || input.tools.length === 0 || input.tools.length > 64) {
    throw new Error("Generation tools must be a non-empty array with at most 64 items")
  }
  const tools = input.tools.map((value, index) => {
    const tool = asRecord(value, `Generation tool ${index}`)
    assertKeys(tool, ["acceptedInputs", "description", "id", "output", "title"], `Generation tool ${index}`)
    const id = requireString(tool.id, `Generation tool ${index} id`, 80)
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) throw new Error(`Invalid generation tool id: ${id}`)
    if (!isGenerationModality(tool.output)) {
      throw new Error(`Generation tool ${index} output is not supported`)
    }
    const acceptedInputs = parseGenerationInputRoles(tool.acceptedInputs, `Generation tool ${index} acceptedInputs`)
    return {
      acceptedInputs,
      description: requireString(tool.description, `Generation tool ${index} description`, 2_000),
      id,
      output: tool.output,
      title: requireString(tool.title, `Generation tool ${index} title`, 120),
    }
  })
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) {
    throw new Error("Generation tools contain duplicate ids")
  }
  return { tools }
}

export function parseWebPluginManifest(value: unknown): WebPluginManifest {
  const input = asRecord(value, "Plugin manifest")
  const schema = input.schema
  if (schema !== webPluginManifestSchema && schema !== webPluginManifestSchemaV2) {
    throw new Error("Plugin manifest schema is not supported")
  }
  assertKeys(
    input,
    [
      "capabilities",
      "contributes",
      "description",
      "entry",
      "id",
      "name",
      ...(schema === webPluginManifestSchemaV2 ? ["runtime"] : []),
      "schema",
      "skill",
      "version",
    ],
    "Plugin manifest",
  )
  const hasEntry = input.entry !== undefined
  const entry = hasEntry ? requireWebPluginRelativePath(input.entry, "Plugin entry") : undefined
  if (entry !== undefined && !entry.toLowerCase().endsWith(".html"))
    throw new Error("Plugin entry must be an HTML file")
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
  if (schema === webPluginManifestSchema && capabilities.includes("generation.execute")) {
    throw new Error("generation.execute is available only to convax.plugin/2 manifests")
  }
  const contributes = asRecord(input.contributes, "Plugin contributions")
  assertKeys(
    contributes,
    ["canvas", ...(schema === webPluginManifestSchemaV2 ? ["generation"] : [])],
    "Plugin contributions",
  )
  const hasRuntime = input.runtime !== undefined
  const hasGenerationContribution = contributes.generation !== undefined
  const hasExecutableContribution = hasGenerationContribution
  const hasCanvasContribution = contributes.canvas !== undefined
  if (hasEntry !== hasCanvasContribution) {
    throw new Error("Plugin entry and Canvas contribution must appear together")
  }
  if (schema === webPluginManifestSchema && !hasCanvasContribution) {
    throw new Error("convax.plugin/1 requires a static Canvas surface")
  }
  if (capabilities.includes("generation.execute") && !hasCanvasContribution) {
    throw new Error("generation.execute requires a sandboxed Canvas surface")
  }
  if (schema === webPluginManifestSchemaV2 && hasRuntime !== hasExecutableContribution) {
    throw new Error("convax.plugin/2 runtime and executable contribution must appear together")
  }
  if (
    schema === webPluginManifestSchemaV2 &&
    !hasRuntime &&
    !hasExecutableContribution &&
    !capabilities.includes("generation.execute")
  ) {
    throw new Error("convax.plugin/2 must declare an executable contribution or request generation.execute")
  }
  const canvas = hasCanvasContribution ? asRecord(contributes.canvas, "Canvas contributions") : undefined
  if (canvas) assertKeys(canvas, ["renderer", "toolbar"], "Canvas contributions")
  const toolbar = parseToolbar(canvas?.toolbar)
  const generation = hasGenerationContribution ? parseGeneration(contributes.generation) : undefined
  const runtime = hasRuntime ? parseMcpStdioRuntime(input.runtime) : undefined
  return {
    capabilities: [...capabilities] as WebPluginCapability[],
    contributes: {
      ...(canvas === undefined
        ? {}
        : {
            canvas: {
              renderer: parseRenderer(canvas.renderer),
              ...(toolbar === undefined ? {} : { toolbar }),
            },
          }),
      ...(generation === undefined ? {} : { generation }),
    },
    description: requireString(input.description, "Plugin description", 2_000),
    ...(entry === undefined ? {} : { entry }),
    id: requireWebPluginId(input.id),
    name: requireString(input.name, "Plugin name", 120),
    schema,
    ...(input.skill === undefined ? {} : { skill: requireWebPluginRelativePath(input.skill, "Plugin skill") }),
    ...(runtime === undefined ? {} : { runtime }),
    version,
  }
}

export function toInstalledWebPluginSummary(manifest: WebPluginManifest): InstalledWebPluginSummary {
  return parseWebPluginManifest(manifest)
}
