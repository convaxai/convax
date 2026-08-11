import {
  parsePluginApiDeclaration,
  parseRuntimePluginApiDeclaration,
  type PluginApiDeclaration,
} from "@convax/plugin-api"

import { parsePortablePluginCanvasContribution, type PortablePluginCanvasContribution } from "./canvas"
import { parsePortablePluginI18n, type PortablePluginI18n } from "./localization"
import { parsePluginCapabilityDeclaration, type PluginCapabilityDeclaration } from "./capabilities"
import {
  parsePortablePluginAgentContribution,
  parsePortablePluginGenerationContribution,
  validatePortableToolReferences,
  type PortablePluginAgentContribution,
  type PortablePluginGenerationContribution,
} from "./generation"
import {
  assertPortableKeys,
  deepFreezePortable,
  parsePortablePluginId,
  parsePortablePluginRelativePath,
  parsePortablePluginVersion,
  portableArray,
  portableRecord,
  portableText,
} from "./primitives"
import {
  parsePortablePluginLlmContribution,
  parsePortablePluginPetContribution,
  parsePortablePluginRuntime,
  parsePortablePluginServiceContribution,
  type PortablePluginLlmContribution,
  type PortablePluginMcpStdioRuntime,
  type PortablePluginPetContribution,
  type PortablePluginServiceContribution,
} from "./runtime-contributions"
import {
  parsePortablePluginSkills,
  validatePortableSkillToolReferences,
  type PortablePluginSkillContribution,
} from "./skills"

export const portablePluginManifestV8Schema = "convax.plugin/8" as const
export const portablePluginManifestFileName = "manifest.json" as const

export const portablePluginCapabilities = [
  "canvas.connectedImages.read",
  "canvas.connectedInputs.read",
  "canvas.connectedMedia.stream",
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
  "pet.activity.read",
  "pet.activity.open",
  "pet.preferences.write",
  "pet.custom.manage",
] as const

export type PortablePluginCapability = (typeof portablePluginCapabilities)[number]

export const portablePluginProjectCanvasCapabilities = [
  "projects.read",
  "canvas.catalog.read",
  "canvas.document.read",
  "canvas.document.write",
  "canvas.events.subscribe",
] as const satisfies readonly PortablePluginCapability[]

export const portablePluginPetCapabilities = [
  "pet.activity.read",
  "pet.activity.open",
  "pet.preferences.write",
  "pet.custom.manage",
] as const satisfies readonly PortablePluginCapability[]

const requiredPortablePluginPetCapabilities = [
  "pet.activity.read",
  "pet.activity.open",
  "pet.preferences.write",
] as const satisfies readonly PortablePluginCapability[]

export interface PortablePluginContributions {
  readonly agent?: PortablePluginAgentContribution
  readonly capabilities?: PluginCapabilityDeclaration
  readonly canvas?: PortablePluginCanvasContribution
  readonly generation?: PortablePluginGenerationContribution
  readonly llm?: PortablePluginLlmContribution
  readonly pet?: PortablePluginPetContribution
  readonly service?: PortablePluginServiceContribution
  readonly skills?: readonly PortablePluginSkillContribution[]
}

export interface PortablePluginManifestV8 {
  readonly capabilities: readonly PortablePluginCapability[]
  readonly contributes: PortablePluginContributions
  readonly description: string
  readonly entry?: string
  readonly hooks?: string
  readonly hostApi: PluginApiDeclaration<string>
  readonly id: string
  readonly i18n?: PortablePluginI18n
  readonly name: string
  readonly runtime?: PortablePluginMcpStdioRuntime
  readonly schema: typeof portablePluginManifestV8Schema
  readonly version: string
}

export interface ParsePortablePluginManifestV8Options {
  /**
   * Authoring rejects syntactically valid future Host API ids as likely typos.
   * Runtime preserves them so an older Host can report structured availability.
   */
  readonly hostApiMode?: "authoring" | "runtime"
}

const allowedCapabilities = new Set<string>(portablePluginCapabilities)
const allowedPetCapabilities: ReadonlySet<string> = new Set(portablePluginPetCapabilities)

function parseCapabilities(value: unknown): readonly PortablePluginCapability[] {
  const capabilities = portableArray(value ?? [], "Plugin capabilities", portablePluginCapabilities.length).map(
    (capability) => {
      if (typeof capability !== "string" || !allowedCapabilities.has(capability)) {
        throw new TypeError("Plugin capabilities contain an unsupported or duplicate capability")
      }
      return capability as PortablePluginCapability
    },
  )
  if (new Set(capabilities).size !== capabilities.length) {
    throw new TypeError("Plugin capabilities contain an unsupported or duplicate capability")
  }
  return capabilities
}

function parseEntryAndHooks(input: Record<string, unknown>) {
  const entry = input.entry === undefined ? undefined : parsePortablePluginRelativePath(input.entry, "Plugin entry")
  if (entry !== undefined && !entry.toLowerCase().endsWith(".html")) {
    throw new TypeError("Plugin entry must be an HTML file")
  }
  const hooks = input.hooks === undefined ? undefined : parsePortablePluginRelativePath(input.hooks, "Plugin hooks")
  if (hooks !== undefined && !/\.(?:js|mjs)$/u.test(hooks)) {
    throw new TypeError("Plugin hooks must be a JavaScript ESM module")
  }
  return { entry, hooks }
}

function validateCanvasEnvelope(input: {
  capabilities: readonly PortablePluginCapability[]
  canvas?: PortablePluginCanvasContribution
  entry?: string
  hostApi: PluginApiDeclaration<string>
}) {
  const { capabilities, canvas, entry, hostApi } = input
  if ((entry !== undefined) !== (canvas?.renderer !== undefined)) {
    throw new TypeError("Plugin entry and Canvas renderer must appear together")
  }
  if (entry !== undefined && !hostApi.required.includes("host.context.get")) {
    throw new TypeError("convax.plugin/8 Web Plugins must require host.context.get")
  }
  if (
    (canvas?.commands !== undefined || canvas?.menus !== undefined || canvas?.toolbar !== undefined) &&
    canvas.renderer === undefined
  ) {
    throw new TypeError("Canvas UI commands require a sandboxed Canvas renderer")
  }
  if (capabilities.includes("generation.execute") && canvas?.renderer === undefined) {
    throw new TypeError("generation.execute requires a sandboxed Canvas surface")
  }
  if (
    canvas &&
    canvas.renderer === undefined &&
    !canvas.selectionActions?.length &&
    !canvas.commands?.length &&
    !canvas.menus?.length &&
    !canvas.toolbar?.length
  ) {
    throw new TypeError("Canvas contributions must declare a renderer, selection actions, or UI commands")
  }
  if (
    canvas?.selectionActions?.some(
      (action) => "action" in action && action.action.type === "materialize-own-plugin-node",
    ) &&
    canvas.renderer === undefined
  ) {
    throw new TypeError("materialize-own-plugin-node requires the contributing Plugin renderer")
  }
}

function validatePetEnvelope(
  capabilities: readonly PortablePluginCapability[],
  pet: PortablePluginPetContribution | undefined,
  runtime: PortablePluginMcpStdioRuntime | undefined,
) {
  if (pet === undefined) return
  if (
    capabilities.length < requiredPortablePluginPetCapabilities.length ||
    capabilities.length > portablePluginPetCapabilities.length ||
    requiredPortablePluginPetCapabilities.some((capability) => !capabilities.includes(capability)) ||
    capabilities.some((capability) => !allowedPetCapabilities.has(capability))
  ) {
    throw new TypeError(
      "Pet capabilities must include pet.activity.read, pet.activity.open, and pet.preferences.write; pet.custom.manage is optional",
    )
  }
  if (runtime !== undefined) throw new TypeError("Pet feature cannot declare an executable runtime")
}

/**
 * Canonical authoring and runtime parser for the complete convax.plugin/8
 * portable ABI. Host state, installed identity, grants and filesystem checks
 * are deliberately outside this pure boundary.
 */
export function parsePortablePluginManifestV8(
  value: unknown,
  options: ParsePortablePluginManifestV8Options = {},
): PortablePluginManifestV8 {
  const input = portableRecord(value, "Plugin manifest")
  assertPortableKeys(
    input,
    [
      "capabilities",
      "contributes",
      "description",
      "entry",
      "hooks",
      "hostApi",
      "id",
      "i18n",
      "name",
      "runtime",
      "schema",
      "version",
    ],
    "Plugin manifest",
  )
  if (input.schema !== portablePluginManifestV8Schema) {
    throw new TypeError("Plugin manifest must use convax.plugin/8")
  }
  if (!Object.prototype.hasOwnProperty.call(input, "hostApi")) {
    throw new TypeError("convax.plugin/8 must declare hostApi explicitly")
  }
  const hostApi =
    options.hostApiMode === "authoring"
      ? parsePluginApiDeclaration(input.hostApi)
      : parseRuntimePluginApiDeclaration(input.hostApi)
  const i18n = input.i18n === undefined ? undefined : parsePortablePluginI18n(input.i18n)
  if (i18n !== undefined && !hostApi.required.includes("host.locale.get")) {
    throw new TypeError("Plugins that declare i18n must require host.locale.get")
  }
  const capabilities = parseCapabilities(input.capabilities)
  const rawContributions = portableRecord(input.contributes, "Plugin contributions")
  assertPortableKeys(
    rawContributions,
    ["agent", "canvas", "capabilities", "generation", "llm", "pet", "service", "skills"],
    "Plugin contributions",
  )
  const { entry, hooks } = parseEntryAndHooks(input)
  const canvas =
    rawContributions.canvas === undefined ? undefined : parsePortablePluginCanvasContribution(rawContributions.canvas)
  validateCanvasEnvelope({ capabilities, canvas, entry, hostApi })

  const agent =
    rawContributions.agent === undefined ? undefined : parsePortablePluginAgentContribution(rawContributions.agent)
  const interPluginCapabilities =
    rawContributions.capabilities === undefined
      ? undefined
      : parsePluginCapabilityDeclaration(rawContributions.capabilities)
  const generation =
    rawContributions.generation === undefined
      ? undefined
      : parsePortablePluginGenerationContribution(rawContributions.generation)
  const llm =
    rawContributions.llm === undefined
      ? undefined
      : parsePortablePluginLlmContribution(rawContributions.llm)
  const pet = rawContributions.pet === undefined ? undefined : parsePortablePluginPetContribution(rawContributions.pet)
  const service =
    rawContributions.service === undefined
      ? undefined
      : parsePortablePluginServiceContribution(rawContributions.service)
  const skills = parsePortablePluginSkills(rawContributions.skills, hostApi)
  const runtime = input.runtime === undefined ? undefined : parsePortablePluginRuntime(input.runtime)
  const hasExecutableContribution =
    generation !== undefined ||
    service !== undefined ||
    llm !== undefined ||
    Boolean(interPluginCapabilities?.exports.length)

  if ((runtime !== undefined) !== hasExecutableContribution) {
    if (interPluginCapabilities?.exports.length && runtime === undefined) {
      throw new TypeError("Plugin capability exports require a verified mcp-stdio runtime")
    }
    throw new TypeError("convax.plugin/8 runtime and executable contribution must appear together")
  }
  if (interPluginCapabilities?.exports.length && runtime === undefined) {
    throw new TypeError("Plugin capability exports require a verified mcp-stdio runtime")
  }
  validatePetEnvelope(capabilities, pet, runtime)
  validatePortableToolReferences({
    agent,
    generation,
    selectionActions: canvas?.selectionActions,
  })
  validatePortableSkillToolReferences(skills, agent)

  const projectCanvasCapabilities = new Set<PortablePluginCapability>(portablePluginProjectCanvasCapabilities)
  const hasProjectCanvasCapability = capabilities.some((capability) => projectCanvasCapabilities.has(capability))
  if (
    canvas?.renderer === undefined &&
    !canvas?.selectionActions?.length &&
    !hasExecutableContribution &&
    hooks === undefined &&
    !capabilities.includes("generation.execute") &&
    !hasProjectCanvasCapability &&
    pet === undefined &&
    (interPluginCapabilities?.exports.length ?? 0) === 0 &&
    agent?.mcp === undefined
  ) {
    throw new TypeError("convax.plugin/8 must declare a Plugin capability beyond owned Skills")
  }

  return deepFreezePortable({
    capabilities,
    contributes: {
      ...(agent === undefined ? {} : { agent }),
      ...(interPluginCapabilities === undefined ? {} : { capabilities: interPluginCapabilities }),
      ...(canvas === undefined ? {} : { canvas }),
      ...(generation === undefined ? {} : { generation }),
      ...(llm === undefined ? {} : { llm }),
      ...(pet === undefined ? {} : { pet }),
      ...(service === undefined ? {} : { service }),
      ...(skills === undefined ? {} : { skills }),
    },
    description: portableText(input.description, "Plugin description", 2_000),
    ...(entry === undefined ? {} : { entry }),
    ...(hooks === undefined ? {} : { hooks }),
    hostApi,
    id: parsePortablePluginId(input.id),
    ...(i18n === undefined ? {} : { i18n }),
    name: portableText(input.name, "Plugin name", 120),
    ...(runtime === undefined ? {} : { runtime }),
    schema: portablePluginManifestV8Schema,
    version: parsePortablePluginVersion(input.version),
  })
}

/**
 * Stable authoring entrypoint for Plugin repositories and Marketplace tooling.
 * Unknown Host API ids fail here as likely authoring mistakes.
 */
export type ParsedPortablePluginManifestV8<Manifest extends PortablePluginManifestV8> = Omit<
  PortablePluginManifestV8,
  "contributes" | "hostApi"
> & {
  readonly contributes: Omit<PortablePluginContributions, "capabilities"> & {
    readonly capabilities?: Manifest["contributes"] extends {
      readonly capabilities: infer Capabilities extends PluginCapabilityDeclaration
    }
      ? Capabilities
      : never
  }
  readonly hostApi: Manifest["hostApi"]
}

export function parsePluginManifestV8<const Manifest extends PortablePluginManifestV8>(
  value: Manifest,
): ParsedPortablePluginManifestV8<Manifest>
export function parsePluginManifestV8(value: unknown): PortablePluginManifestV8
export function parsePluginManifestV8(value: unknown): PortablePluginManifestV8 {
  return parsePortablePluginManifestV8(value, { hostApiMode: "authoring" })
}

// Historical source-level exports retained while ownership lives in primitives.
export {
  comparePortablePluginVersions,
  parsePortablePluginId,
  parsePortablePluginRelativePath,
  validatePortablePluginSegment,
} from "./primitives"
