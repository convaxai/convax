export const webPluginManifestFileName = "manifest.json"
export const webPluginManifestSchema = "convax.plugin/1" as const
export const webPluginManifestSchemaV2 = "convax.plugin/2" as const
export const webPluginManifestSchemaV3 = "convax.plugin/3" as const
export const webPluginManifestSchemaV4 = "convax.plugin/4" as const
export const webPluginManifestSchemaV5 = "convax.plugin/5" as const

export type WebPluginManifestSchema =
  | typeof webPluginManifestSchema
  | typeof webPluginManifestSchemaV2
  | typeof webPluginManifestSchemaV3
  | typeof webPluginManifestSchemaV4
  | typeof webPluginManifestSchemaV5

export const webPluginCapabilities = [
  "canvas.connectedImages.read",
  "canvas.node.read",
  "canvas.node.write",
  "canvas.image.write",
  "project.files.read",
  "agent.prompt",
  "generation.execute",
  "ui.fullscreen",
  "projects.read",
  "canvas.catalog.read",
  "canvas.document.read",
  "canvas.document.write",
  "canvas.events.subscribe",
] as const

export type WebPluginCapability = (typeof webPluginCapabilities)[number]

export const webPluginProjectCanvasCapabilities = [
  "projects.read",
  "canvas.catalog.read",
  "canvas.document.read",
  "canvas.document.write",
  "canvas.events.subscribe",
] as const satisfies readonly WebPluginCapability[]

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

export const webPluginServiceActions = ["authorize", "reauthorize", "authorization.cancel", "sign_out"] as const

export type WebPluginServiceAction = (typeof webPluginServiceActions)[number]

export interface WebPluginGenerationModelContribution {
  /** Pure model display name; the owning Plugin already supplies the service name. */
  name: string
  /** Plugin-local generation tool id. */
  tool: string
}

export interface WebPluginGenerationToolContribution {
  acceptedInputs: WebPluginGenerationInputRole[]
  description: string
  id: string
  output: WebPluginGenerationModality
  title: string
}

export interface WebPluginGenerationContribution {
  /** Required by declarative convax.plugin/3 and later schemas; absent from legacy convax.plugin/2 declarations. */
  models?: WebPluginGenerationModelContribution[]
  tools: WebPluginGenerationToolContribution[]
}

export interface WebPluginAgentToolContribution {
  id: string
  /** Plugin-local generation operation tool id. */
  tool: string
}

export interface WebPluginAgentContribution {
  tools: WebPluginAgentToolContribution[]
}

/**
 * A Skill whose installation lifecycle is owned by the declaring Plugin.
 * `path` names the Skill directory; the host validates its root SKILL.md and
 * exact frontmatter name before publishing either capability.
 */
export interface WebPluginSkillContribution {
  name: string
  path: string
}

/**
 * Declares only which fixed host service actions are meaningful. MCP tool names
 * are host-defined (`service.<action>`) and cannot be remapped by a Plugin.
 */
export interface WebPluginServiceContribution {
  actions: WebPluginServiceAction[]
}

export interface WebPluginLlmModelContribution {
  id: string
  name: string
}

/** One OpenAI-compatible provider served by the Plugin's verified companion. */
export interface WebPluginLlmContribution {
  models: WebPluginLlmModelContribution[]
  provider: { id: string; name: string }
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

export const webPluginToolbarIcons = ["play"] as const

export type WebPluginToolbarIcon = (typeof webPluginToolbarIcons)[number]

export interface WebPluginToolbarContribution {
  /** Opaque command id delivered to the sandboxed plugin frame. */
  command: string
  /** Optional host-rendered icon. Iconless actions retain their visible label. */
  icon?: WebPluginToolbarIcon
  id: string
  title: string
}

function parseToolbarIcon(value: unknown): WebPluginToolbarIcon | undefined {
  if (value === undefined) return undefined
  if (value !== "play") throw new Error("Unsupported Canvas toolbar item icon")
  return value
}

export interface WebPluginLocalizedText {
  default: string
  "zh-CN"?: string
}

export type WebPluginCanvasSelectionActionEditor = "time-point" | "time-range" | "crop-region" | "confirmation"

export interface WebPluginCanvasSelectionActionStep {
  /** Plugin-local generation operation tool id. */
  tool: string
}

export interface WebPluginCanvasSelectionActionContribution {
  description: WebPluginLocalizedText
  editor: WebPluginCanvasSelectionActionEditor
  id: string
  steps: WebPluginCanvasSelectionActionStep[]
  target: "video"
  title: WebPluginLocalizedText
}

export interface WebPluginCanvasContribution {
  /** A sandboxed Web surface. Entry and renderer must appear together. */
  renderer?: WebPluginCanvasRendererContribution
  /** Commands delivered only to a declared sandboxed renderer. */
  toolbar?: WebPluginToolbarContribution[]
  /** Host-rendered actions are available to declarative convax.plugin/3 and later schemas. */
  selectionActions?: WebPluginCanvasSelectionActionContribution[]
}

export interface WebPluginManifest {
  capabilities: WebPluginCapability[]
  contributes: {
    /** Present only in declarative convax.plugin/3 and later manifests and bound to declared operation tools. */
    agent?: WebPluginAgentContribution
    canvas?: WebPluginCanvasContribution
    /** Present only in an executable convax.plugin/2 or later manifest with a matching MCP runtime. */
    generation?: WebPluginGenerationContribution
    /** Main-only provider metadata; connection details come from the verified runtime. */
    llm?: WebPluginLlmContribution
    /** Present only in a convax.plugin/2 or later manifest with a matching MCP runtime. */
    service?: WebPluginServiceContribution
    /** Plugin-owned Skills are available to convax.plugin/4 and later. */
    skills?: WebPluginSkillContribution[]
  }
  description: string
  /** Sandboxed HTML entry, relative to the plugin package; absent for a headless Tool Plugin. */
  entry?: string
  id: string
  name: string
  /** v1 remains static-only; executable and declarative capabilities are introduced by later schemas. */
  schema: WebPluginManifestSchema
  /** Legacy independently managed companion Skill; unavailable to convax.plugin/4 and later. */
  skill?: string
  /** Present only in a convax.plugin/2 or later manifest with executable contributions. */
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
    canvas: NonNullable<InstalledWebPluginSummary["contributes"]["canvas"]> & {
      renderer: WebPluginCanvasRendererContribution
    }
  }
  entry: string
}

export function hasWebPluginCanvasSurface(
  plugin: InstalledWebPluginSummary,
): plugin is InstalledWebPluginCanvasSurface {
  return typeof plugin.entry === "string" && plugin.contributes.canvas?.renderer !== undefined
}

export interface WebPluginCatalogItem extends WebPluginManifest {
  companionSkillName?: string
  /** Current-host immutable download bytes from the validated remote Registry. */
  download?: {
    companionBytes: number
    packageBytes: number
    totalBytes: number
  }
  installed: boolean
  /** Validated installed version when the catalog id is already present. */
  installedVersion?: string
  /** Main can open this remote package's exact validated GitHub Release by id. */
  releaseAvailable?: true
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
  openCatalogPluginRelease(input: { id: string }): Promise<boolean>
  uninstallPlugin(input: { id: string }): Promise<boolean>
}

const allowedCapabilities = new Set<string>(webPluginCapabilities)
const allowedGenerationModalities = new Set<string>(webPluginGenerationModalities)
const allowedGenerationInputRoles = new Set<string>(webPluginGenerationInputRoles)
const allowedServiceActions = new Set<string>(webPluginServiceActions)
const allowedSelectionActionEditors = new Set<WebPluginCanvasSelectionActionEditor>([
  "time-point",
  "time-range",
  "crop-region",
  "confirmation",
])
const agentToolIdPattern = /^[a-z][a-z0-9_]{0,63}$/
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
    assertKeys(input, ["command", "icon", "id", "title"], `Canvas toolbar item ${index}`)
    const id = requireString(input.id, `Canvas toolbar item ${index} id`, 80)
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) throw new Error(`Invalid Canvas toolbar item id: ${id}`)
    const icon = parseToolbarIcon(input.icon)
    return {
      command: requireString(input.command, `Canvas toolbar item ${index} command`, 256),
      ...(icon === undefined ? {} : { icon }),
      id,
      title: requireString(input.title, `Canvas toolbar item ${index} title`, 120),
    }
  })
  if (new Set(toolbar.map((item) => item.id)).size !== toolbar.length) {
    throw new Error("Canvas toolbar contains duplicate ids")
  }
  return toolbar
}

function parseLocalizedText(value: unknown, label: string, maxLength: number): WebPluginLocalizedText {
  const input = asRecord(value, label)
  assertKeys(input, ["default", "zh-CN"], label)
  return {
    default: requireString(input.default, `${label} default`, maxLength),
    ...(input["zh-CN"] === undefined ? {} : { "zh-CN": requireString(input["zh-CN"], `${label} zh-CN`, maxLength) }),
  }
}

function parseSelectionActions(value: unknown): WebPluginCanvasSelectionActionContribution[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("Canvas selection actions must be a non-empty array with at most 32 items")
  }
  const actions = value.map((item, index) => {
    const label = `Canvas selection action ${index}`
    const input = asRecord(item, label)
    assertKeys(input, ["description", "editor", "id", "steps", "target", "title"], label)
    const id = requireString(input.id, `${label} id`, 80)
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) {
      throw new Error(`Invalid Canvas selection action id: ${id}`)
    }
    if (input.target !== "video") throw new Error(`${label} target must be video`)
    if (!allowedSelectionActionEditors.has(input.editor as WebPluginCanvasSelectionActionEditor)) {
      throw new Error(`${label} editor is not supported`)
    }
    if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 16) {
      throw new Error(`${label} steps must be a non-empty array with at most 16 items`)
    }
    if (input.editor !== "confirmation" && input.steps.length !== 1) {
      throw new Error(`${label} editor requires exactly one step`)
    }
    const steps = input.steps.map((step, stepIndex) => {
      const stepLabel = `${label} step ${stepIndex}`
      const stepInput = asRecord(step, stepLabel)
      assertKeys(stepInput, ["tool"], stepLabel)
      return { tool: requireGenerationToolId(stepInput.tool, `${stepLabel} tool`) }
    })
    return {
      description: parseLocalizedText(input.description, `${label} description`, 2_000),
      editor: input.editor as WebPluginCanvasSelectionActionEditor,
      id,
      steps,
      target: "video" as const,
      title: parseLocalizedText(input.title, `${label} title`, 120),
    }
  })
  if (new Set(actions.map((action) => action.id)).size !== actions.length) {
    throw new Error("Canvas selection actions contain duplicate ids")
  }
  return actions
}

function isGenerationModality(value: unknown): value is WebPluginGenerationModality {
  return typeof value === "string" && allowedGenerationModalities.has(value)
}

function isGenerationInputRole(value: unknown): value is WebPluginGenerationInputRole {
  return typeof value === "string" && allowedGenerationInputRoles.has(value)
}

function requireGenerationToolId(value: unknown, label: string) {
  const id = requireString(value, label, 80)
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) throw new Error(`${label} is invalid: ${id}`)
  return id
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

function parseGeneration(
  value: unknown,
  schema:
    | typeof webPluginManifestSchemaV2
    | typeof webPluginManifestSchemaV3
    | typeof webPluginManifestSchemaV4
    | typeof webPluginManifestSchemaV5,
): WebPluginGenerationContribution {
  const input = asRecord(value, "Generation contribution")
  const declarativeSchema =
    schema === webPluginManifestSchemaV3 || schema === webPluginManifestSchemaV4 || schema === webPluginManifestSchemaV5
  assertKeys(input, declarativeSchema ? ["models", "tools"] : ["tools"], "Generation contribution")
  if (declarativeSchema && !Object.prototype.hasOwnProperty.call(input, "models")) {
    throw new Error(`${schema} generation models must be declared explicitly`)
  }
  if (!Array.isArray(input.tools) || input.tools.length === 0 || input.tools.length > 64) {
    throw new Error("Generation tools must be a non-empty array with at most 64 items")
  }
  const tools = input.tools.map((value, index) => {
    const tool = asRecord(value, `Generation tool ${index}`)
    assertKeys(tool, ["acceptedInputs", "description", "id", "output", "title"], `Generation tool ${index}`)
    const id = requireGenerationToolId(tool.id, `Generation tool ${index} id`)
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
  if (!declarativeSchema) return { tools }
  if (!Array.isArray(input.models) || input.models.length > tools.length) {
    throw new Error("Generation models must be an array no longer than the generation tools array")
  }
  const models = input.models.map((value, index) => {
    const label = `Generation model ${index}`
    const model = asRecord(value, label)
    assertKeys(model, ["name", "tool"], label)
    return {
      name: requireString(model.name, `${label} name`, 120),
      tool: requireGenerationToolId(model.tool, `${label} tool`),
    }
  })
  if (new Set(models.map((model) => model.tool)).size !== models.length) {
    throw new Error("Generation models contain duplicate tool references")
  }
  return { models, tools }
}

function requirePluginSkillName(value: unknown, label: string) {
  const name = requireString(value, label, 64)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`${label} must use kebab-case`)
  }
  validatePortablePluginSegment(name)
  return name
}

function parsePluginSkills(value: unknown): WebPluginSkillContribution[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("Plugin Skill contributions must be a non-empty array with at most 32 items")
  }
  const skills = value.map((value, index) => {
    const label = `Plugin Skill contribution ${index}`
    const input = asRecord(value, label)
    assertKeys(input, ["name", "path"], label)
    const name = requirePluginSkillName(input.name, `${label} name`)
    const path = requireWebPluginRelativePath(input.path, `${label} path`)
    if (path.split("/").at(-1) !== name) {
      throw new Error(`${label} path must name its Skill directory: ${name}`)
    }
    return { name, path }
  })
  if (new Set(skills.map((skill) => skill.name)).size !== skills.length) {
    throw new Error("Plugin Skill contributions contain duplicate names")
  }
  if (new Set(skills.map((skill) => skill.path.toLocaleLowerCase("en-US"))).size !== skills.length) {
    throw new Error("Plugin Skill contributions contain duplicate paths")
  }
  return skills
}

function parseAgent(value: unknown): WebPluginAgentContribution {
  const input = asRecord(value, "Agent contribution")
  assertKeys(input, ["tools"], "Agent contribution")
  if (!Array.isArray(input.tools) || input.tools.length === 0 || input.tools.length > 32) {
    throw new Error("Agent tools must be a non-empty array with at most 32 items")
  }
  const tools = input.tools.map((value, index) => {
    const label = `Agent tool ${index}`
    const tool = asRecord(value, label)
    assertKeys(tool, ["id", "tool"], label)
    const id = requireString(tool.id, `${label} id`, 64)
    if (!agentToolIdPattern.test(id)) throw new Error(`${label} id must use lower snake_case`)
    return { id, tool: requireGenerationToolId(tool.tool, `${label} generation tool`) }
  })
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) {
    throw new Error("Agent tools contain duplicate ids")
  }
  if (new Set(tools.map((tool) => tool.tool)).size !== tools.length) {
    throw new Error("Agent tools contain duplicate generation tool references")
  }
  return { tools }
}

function parseService(value: unknown): WebPluginServiceContribution {
  const input = asRecord(value, "Service contribution")
  assertKeys(input, ["actions"], "Service contribution")
  if (!Array.isArray(input.actions) || input.actions.length > webPluginServiceActions.length) {
    throw new Error("Service actions must be an array of fixed host actions")
  }
  const actions = input.actions.map((action) => {
    if (typeof action !== "string" || !allowedServiceActions.has(action)) {
      throw new Error("Service actions contain an unsupported or duplicate action")
    }
    return action as WebPluginServiceAction
  })
  if (new Set(actions).size !== actions.length) {
    throw new Error("Service actions contain an unsupported or duplicate action")
  }
  return { actions }
}

function parseLlm(value: unknown): WebPluginLlmContribution {
  const input = asRecord(value, "LLM contribution")
  assertKeys(input, ["models", "provider"], "LLM contribution")
  const provider = asRecord(input.provider, "LLM provider")
  assertKeys(provider, ["id", "name"], "LLM provider")
  const providerId = requireString(provider.id, "LLM provider id", 80)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(providerId)) {
    throw new Error("LLM provider id must use kebab-case")
  }
  if (!Array.isArray(input.models) || input.models.length === 0 || input.models.length > 32) {
    throw new Error("LLM models must be a non-empty array with at most 32 items")
  }
  const models = input.models.map((value, index) => {
    const label = `LLM model ${index}`
    const model = asRecord(value, label)
    assertKeys(model, ["id", "name"], label)
    const id = requireString(model.id, `${label} id`, 128)
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) throw new Error(`${label} id is invalid`)
    return { id, name: requireString(model.name, `${label} name`, 120) }
  })
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new Error("LLM models contain duplicate ids")
  }
  return {
    models,
    provider: { id: providerId, name: requireString(provider.name, "LLM provider name", 120) },
  }
}

function validateDeclarativeToolReferences(input: {
  agent?: WebPluginAgentContribution
  generation?: WebPluginGenerationContribution
  selectionActions?: readonly WebPluginCanvasSelectionActionContribution[]
}) {
  const tools = new Map(input.generation?.tools.map((tool) => [tool.id, tool]) ?? [])
  const modelToolIds = new Set(input.generation?.models?.map((model) => model.tool) ?? [])
  for (const modelToolId of modelToolIds) {
    if (!tools.has(modelToolId)) throw new Error(`Generation model references an unknown tool: ${modelToolId}`)
  }
  for (const agentTool of input.agent?.tools ?? []) {
    if (!tools.has(agentTool.tool))
      throw new Error(`Agent tool references an unknown generation tool: ${agentTool.tool}`)
    if (modelToolIds.has(agentTool.tool)) {
      throw new Error(`Agent tool must reference an operation, not a generation model: ${agentTool.tool}`)
    }
  }
  for (const action of input.selectionActions ?? []) {
    for (const step of action.steps) {
      const tool = tools.get(step.tool)
      if (!tool) throw new Error(`Canvas selection action references an unknown generation tool: ${step.tool}`)
      if (modelToolIds.has(step.tool)) {
        throw new Error(`Canvas selection action must reference an operation, not a generation model: ${step.tool}`)
      }
      if (!tool.acceptedInputs.includes("reference_video")) {
        throw new Error(`Canvas video selection action tool must accept reference_video: ${step.tool}`)
      }
    }
  }
}

export function parseWebPluginManifest(value: unknown): WebPluginManifest {
  const input = asRecord(value, "Plugin manifest")
  const schema = input.schema
  if (
    schema !== webPluginManifestSchema &&
    schema !== webPluginManifestSchemaV2 &&
    schema !== webPluginManifestSchemaV3 &&
    schema !== webPluginManifestSchemaV4 &&
    schema !== webPluginManifestSchemaV5
  ) {
    throw new Error("Plugin manifest schema is not supported")
  }
  const executableSchema =
    schema === webPluginManifestSchemaV2 ||
    schema === webPluginManifestSchemaV3 ||
    schema === webPluginManifestSchemaV4 ||
    schema === webPluginManifestSchemaV5
  const declarativeSchema =
    schema === webPluginManifestSchemaV3 || schema === webPluginManifestSchemaV4 || schema === webPluginManifestSchemaV5
  const ownsSkills = schema === webPluginManifestSchemaV4 || schema === webPluginManifestSchemaV5
  assertKeys(
    input,
    [
      "capabilities",
      "contributes",
      "description",
      "entry",
      "id",
      "name",
      ...(executableSchema ? ["runtime"] : []),
      "schema",
      ...(ownsSkills ? [] : ["skill"]),
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
    throw new Error("generation.execute is available only to executable Plugin manifests")
  }
  const v5Capabilities = new Set<WebPluginCapability>(webPluginProjectCanvasCapabilities)
  if (schema !== webPluginManifestSchemaV5 && capabilities.some((capability) => v5Capabilities.has(capability))) {
    throw new Error("Project-wide Canvas capabilities are available only to convax.plugin/5")
  }
  const hasProjectCanvasCapability = capabilities.some((capability) => v5Capabilities.has(capability))
  const contributes = asRecord(input.contributes, "Plugin contributions")
  assertKeys(
    contributes,
    [
      "canvas",
      ...(executableSchema ? ["generation", "service"] : []),
      ...(schema === webPluginManifestSchemaV5 ? ["llm"] : []),
      ...(declarativeSchema ? ["agent"] : []),
      ...(ownsSkills ? ["skills"] : []),
    ],
    "Plugin contributions",
  )
  const hasRuntime = input.runtime !== undefined
  const hasGenerationContribution = contributes.generation !== undefined
  const hasServiceContribution = contributes.service !== undefined
  const hasLlmContribution = contributes.llm !== undefined
  const hasExecutableContribution = hasGenerationContribution || hasServiceContribution || hasLlmContribution
  const hasCanvasContribution = contributes.canvas !== undefined
  const canvas = hasCanvasContribution ? asRecord(contributes.canvas, "Canvas contributions") : undefined
  if (canvas) {
    assertKeys(
      canvas,
      ["renderer", "toolbar", ...(declarativeSchema ? ["selectionActions"] : [])],
      "Canvas contributions",
    )
  }
  const hasRendererContribution = canvas?.renderer !== undefined
  if (hasEntry !== hasRendererContribution) throw new Error("Plugin entry and Canvas renderer must appear together")
  if (schema === webPluginManifestSchema && !hasRendererContribution) {
    throw new Error("convax.plugin/1 requires a static Canvas surface")
  }
  if (canvas?.toolbar !== undefined && !hasRendererContribution) {
    throw new Error("Canvas toolbar requires a sandboxed Canvas renderer")
  }
  if (capabilities.includes("generation.execute") && !hasRendererContribution) {
    throw new Error("generation.execute requires a sandboxed Canvas surface")
  }
  if (executableSchema && hasRuntime !== hasExecutableContribution) {
    throw new Error(`${schema} runtime and executable contribution must appear together`)
  }
  if (
    executableSchema &&
    !ownsSkills &&
    !hasRuntime &&
    !hasExecutableContribution &&
    !capabilities.includes("generation.execute")
  ) {
    throw new Error(`${schema} must declare an executable contribution or request generation.execute`)
  }
  const toolbar = parseToolbar(canvas?.toolbar)
  const selectionActions = declarativeSchema ? parseSelectionActions(canvas?.selectionActions) : undefined
  if (canvas && !hasRendererContribution && !selectionActions?.length) {
    throw new Error("Canvas contributions must declare a renderer or selection actions")
  }
  const skills = ownsSkills ? parsePluginSkills(contributes.skills) : undefined
  if (
    ownsSkills &&
    !hasRendererContribution &&
    !selectionActions?.length &&
    !hasExecutableContribution &&
    !capabilities.includes("generation.execute") &&
    !hasProjectCanvasCapability
  ) {
    throw new Error(`${schema} must declare a Plugin capability beyond owned Skills`)
  }
  const generation = hasGenerationContribution
    ? parseGeneration(
        contributes.generation,
        schema as
          | typeof webPluginManifestSchemaV2
          | typeof webPluginManifestSchemaV3
          | typeof webPluginManifestSchemaV4
          | typeof webPluginManifestSchemaV5,
      )
    : undefined
  const agent = declarativeSchema && contributes.agent !== undefined ? parseAgent(contributes.agent) : undefined
  const service = hasServiceContribution ? parseService(contributes.service) : undefined
  const llm = hasLlmContribution ? parseLlm(contributes.llm) : undefined
  const runtime = hasRuntime ? parseMcpStdioRuntime(input.runtime) : undefined
  if (declarativeSchema) {
    validateDeclarativeToolReferences({ agent, generation, selectionActions })
  }
  return {
    capabilities: [...capabilities] as WebPluginCapability[],
    contributes: {
      ...(agent === undefined ? {} : { agent }),
      ...(canvas === undefined
        ? {}
        : {
            canvas: {
              ...(hasRendererContribution ? { renderer: parseRenderer(canvas.renderer) } : {}),
              ...(selectionActions === undefined ? {} : { selectionActions }),
              ...(toolbar === undefined ? {} : { toolbar }),
            },
          }),
      ...(generation === undefined ? {} : { generation }),
      ...(llm === undefined ? {} : { llm }),
      ...(service === undefined ? {} : { service }),
      ...(skills === undefined ? {} : { skills }),
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
