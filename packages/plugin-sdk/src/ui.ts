import { parsePortablePluginLocalizedText, type PortablePluginLocalizedText } from "./localization"

/**
 * Host-rendered icon names. Plugins never contribute React components, SVG,
 * HTML, URLs, or platform-native icon names.
 */
export const portablePluginUiIconTokens = [
  "download",
  "edit",
  "open",
  "play",
  "refresh",
  "settings",
  "sparkles",
  "upload",
] as const

export type PortablePluginUiIconToken = (typeof portablePluginUiIconTokens)[number]

export type PortablePluginUiLocalizedText = PortablePluginLocalizedText

/**
 * A command can only deliver one bounded opaque message to its owning
 * sandboxed renderer. It cannot name a Host function or another Plugin.
 */
export interface PortablePluginUiRendererMessageTarget {
  readonly message: string
  readonly type: "renderer-message"
}

export interface PortablePluginUiCommand {
  readonly icon?: PortablePluginUiIconToken
  readonly id: string
  readonly target: PortablePluginUiRendererMessageTarget
  readonly title: PortablePluginUiLocalizedText
}

export interface PortablePluginUiToolbarItem {
  /** Plugin-local command id. All presentation comes from the command. */
  readonly command: string
  /** Stable placement identity, distinct from the command id. */
  readonly id: string
  readonly order?: number
}

export interface PortablePluginUiMenuItem {
  /** Plugin-local command id. All presentation comes from the command. */
  readonly command: string
  /** Optional stable visual grouping token interpreted only by the Host. */
  readonly group?: string
  /** Stable placement identity, distinct from the command id. */
  readonly id: string
  readonly order?: number
  /** Plugin UI menus are restricted to the owning Canvas node overflow. */
  readonly placement: "overflow"
}

export interface PortablePluginCanvasUiContribution {
  readonly commands: readonly PortablePluginUiCommand[]
  readonly menus: readonly PortablePluginUiMenuItem[]
  readonly toolbar: readonly PortablePluginUiToolbarItem[]
}

const commandIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const placementIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const groupIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const maximumCommands = 128
const maximumPlacementsPerSurface = 128
const maximumOrderMagnitude = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`)
  return value
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
) {
  const expected = new Set([...required, ...optional])
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new TypeError(`${label} contains unsupported or missing fields`)
  }
}

function text(value: unknown, label: string, maximum: number) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded, trimmed string`)
  }
  return value
}

function stableId(value: unknown, label: string, pattern: RegExp, maximum: number) {
  const id = text(value, label, maximum)
  if (!pattern.test(id)) throw new TypeError(`${label} must be a stable Plugin-local id`)
  return id
}

function order(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < -maximumOrderMagnitude || Number(value) > maximumOrderMagnitude) {
    throw new TypeError(`${label} must be a bounded safe integer`)
  }
  return Number(value)
}

function isPortablePluginUiIconToken(value: unknown): value is PortablePluginUiIconToken {
  return portablePluginUiIconTokens.some((token) => token === value)
}

function command(value: unknown, index: number): PortablePluginUiCommand {
  const label = `Plugin UI commands[${index}]`
  const input = record(value, label)
  exactKeys(input, ["id", "title", "target"], ["icon"], label)
  const target = record(input.target, `${label}.target`)
  if (target.type !== "renderer-message") {
    throw new TypeError(`${label}.target.type must be renderer-message`)
  }
  exactKeys(target, ["type", "message"], [], `${label}.target`)
  const icon = input.icon
  if (icon !== undefined && !isPortablePluginUiIconToken(icon)) {
    throw new TypeError(`${label}.icon must be a supported Host icon token`)
  }
  return Object.freeze({
    id: stableId(input.id, `${label}.id`, commandIdPattern, 128),
    title: parsePortablePluginLocalizedText(input.title, `${label}.title`, 120),
    target: Object.freeze({
      type: "renderer-message",
      message: text(target.message, `${label}.target.message`, 128),
    }),
    ...(icon === undefined ? {} : { icon }),
  })
}

function placementBase(value: unknown, label: string, required: readonly string[], optional: readonly string[]) {
  const input = record(value, label)
  exactKeys(input, required, optional, label)
  return {
    input,
    id: stableId(input.id, `${label}.id`, placementIdPattern, 128),
    command: stableId(input.command, `${label}.command`, commandIdPattern, 128),
    ...(input.order === undefined ? {} : { order: order(input.order, `${label}.order`) }),
  }
}

function toolbarItem(value: unknown, index: number): PortablePluginUiToolbarItem {
  const { input: _input, ...placement } = placementBase(
    value,
    `Plugin UI toolbar[${index}]`,
    ["id", "command"],
    ["order"],
  )
  return Object.freeze(placement)
}

function menuItem(value: unknown, index: number): PortablePluginUiMenuItem {
  const label = `Plugin UI menus[${index}]`
  const base = placementBase(value, label, ["id", "command", "placement"], ["group", "order"])
  if (base.input.placement !== "overflow") {
    throw new TypeError(`${label}.placement must be overflow`)
  }
  const group =
    base.input.group === undefined ? undefined : stableId(base.input.group, `${label}.group`, groupIdPattern, 64)
  const { input: _input, ...placement } = base
  return Object.freeze({
    ...placement,
    placement: "overflow",
    ...(group === undefined ? {} : { group }),
  })
}

function boundedArray(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`)
  }
  return value
}

function assertUnique(items: readonly { readonly id: string }[], label: string) {
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id)) throw new TypeError(`${label} contains a duplicate id: ${item.id}`)
    ids.add(item.id)
  }
}

function assertUniqueCommandReferences(items: readonly { readonly command: string }[], label: string) {
  const commandIds = new Set<string>()
  for (const item of items) {
    if (commandIds.has(item.command)) {
      throw new TypeError(`${label} contains a duplicate command reference: ${item.command}`)
    }
    commandIds.add(item.command)
  }
}

/**
 * Parses only the portable command and owning-node placement section of a
 * Canvas contribution. The canonical manifest parser supplies these three
 * fields; renderer and domain action contributions remain separate contracts.
 */
export function parsePortablePluginCanvasUiContribution(value: unknown): PortablePluginCanvasUiContribution {
  const input = record(value, "Plugin Canvas UI contribution")
  exactKeys(input, [], ["commands", "menus", "toolbar"], "Plugin Canvas UI contribution")
  const commands = Object.freeze(
    boundedArray(input.commands === undefined ? [] : input.commands, "Plugin UI commands", maximumCommands).map(
      command,
    ),
  )
  const menus = Object.freeze(
    boundedArray(input.menus === undefined ? [] : input.menus, "Plugin UI menus", maximumPlacementsPerSurface).map(
      menuItem,
    ),
  )
  const toolbar = Object.freeze(
    boundedArray(
      input.toolbar === undefined ? [] : input.toolbar,
      "Plugin UI toolbar",
      maximumPlacementsPerSurface,
    ).map(toolbarItem),
  )

  assertUnique(commands, "Plugin UI commands")
  assertUnique(menus, "Plugin UI menus")
  assertUnique(toolbar, "Plugin UI toolbar")
  const placementIds = new Set(menus.map((item) => item.id))
  const duplicatePlacementId = toolbar.find((item) => placementIds.has(item.id))
  if (duplicatePlacementId) {
    throw new TypeError(`Plugin UI placements contain a duplicate id: ${duplicatePlacementId.id}`)
  }
  assertUniqueCommandReferences(menus, "Plugin UI menus")
  assertUniqueCommandReferences(toolbar, "Plugin UI toolbar")

  const commandIds = new Set(commands.map((item) => item.id))
  const unknownReference = [...menus, ...toolbar].find((item) => !commandIds.has(item.command))
  if (unknownReference) {
    throw new TypeError(`Plugin UI placement references an unknown command: ${unknownReference.command}`)
  }
  const referencedCommandIds = new Set([...menus, ...toolbar].map((item) => item.command))
  const unplacedCommand = commands.find((item) => !referencedCommandIds.has(item.id))
  if (unplacedCommand) {
    throw new TypeError(`Plugin UI command has no owning-node placement: ${unplacedCommand.id}`)
  }

  return Object.freeze({ commands, menus, toolbar })
}
