import {
  assertPortableKeys,
  parsePortablePluginRelativePath,
  portableArray,
  portableRecord,
  portableText,
  validatePortablePluginSegment,
} from "./primitives"

export const portablePluginServiceActions = [
  "authorize",
  "reauthorize",
  "authorization.cancel",
  "checkout",
  "sign_out",
] as const

export type PortablePluginServiceAction = (typeof portablePluginServiceActions)[number]

export interface PortablePluginServiceContribution {
  readonly actions: readonly PortablePluginServiceAction[]
}

export interface PortablePluginLlmModelContribution {
  readonly id: string
  readonly name: string
}

export interface PortablePluginLlmContribution {
  readonly models: readonly PortablePluginLlmModelContribution[]
  readonly provider: {
    readonly id: string
    readonly name: string
    readonly protocol: "openai" | "openrouter"
  }
}

export interface PortablePluginPetContribution {
  readonly library: string
  readonly overlay: string
  readonly protocol: "convax.pet-host/1"
  readonly settings: string
}

export interface PortablePluginMcpStdioRuntime {
  readonly args?: readonly string[]
  readonly command: string
  readonly type: "mcp-stdio"
}

const allowedServiceActions = new Set<string>(portablePluginServiceActions)

export function parsePortablePluginServiceContribution(
  value: unknown,
): PortablePluginServiceContribution {
  const input = portableRecord(value, "Service contribution")
  assertPortableKeys(input, ["actions"], "Service contribution")
  const actions = portableArray(
    input.actions,
    "Service actions",
    portablePluginServiceActions.length,
  ).map((action) => {
    if (typeof action !== "string" || !allowedServiceActions.has(action)) {
      throw new TypeError("Service actions contain an unsupported or duplicate action")
    }
    return action as PortablePluginServiceAction
  })
  if (new Set(actions).size !== actions.length) {
    throw new TypeError("Service actions contain an unsupported or duplicate action")
  }
  return { actions }
}

export function parsePortablePluginLlmContribution(
  value: unknown,
): PortablePluginLlmContribution {
  const input = portableRecord(value, "LLM contribution")
  assertPortableKeys(input, ["models", "provider"], "LLM contribution")
  const provider = portableRecord(input.provider, "LLM provider")
  assertPortableKeys(provider, ["id", "name", "protocol"], "LLM provider")
  const providerId = portableText(provider.id, "LLM provider id", 80)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(providerId)) {
    throw new TypeError("LLM provider id must use kebab-case")
  }
  if (provider.protocol !== "openai" && provider.protocol !== "openrouter") {
    throw new TypeError("LLM provider protocol must be openai or openrouter")
  }
  const models = portableArray(input.models, "LLM models", 32, true).map(
    (value, index) => {
      const label = `LLM model ${index}`
      const model = portableRecord(value, label)
      assertPortableKeys(model, ["id", "name"], label)
      const id = portableText(model.id, `${label} id`, 128)
      if (!/^~?[a-z0-9]+(?:[._/:-][a-z0-9]+)*$/u.test(id)) {
        throw new TypeError(`${label} id is invalid`)
      }
      return { id, name: portableText(model.name, `${label} name`, 120) }
    },
  )
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new TypeError("LLM models contain duplicate ids")
  }
  return {
    models,
    provider: {
      id: providerId,
      name: portableText(provider.name, "LLM provider name", 120),
      protocol: provider.protocol,
    },
  }
}

export function parsePortablePluginPetContribution(
  value: unknown,
): PortablePluginPetContribution {
  const input = portableRecord(value, "Pet contribution")
  assertPortableKeys(input, ["library", "overlay", "protocol", "settings"], "Pet contribution")
  const library = parsePortablePluginRelativePath(input.library, "Pet library")
  const overlay = parsePortablePluginRelativePath(input.overlay, "Pet overlay")
  const settings = parsePortablePluginRelativePath(input.settings, "Pet settings")
  if (!library.toLowerCase().endsWith(".json")) {
    throw new TypeError("Pet library must be a JSON file")
  }
  if (!overlay.toLowerCase().endsWith(".html")) {
    throw new TypeError("Pet overlay must be an HTML file")
  }
  if (!settings.toLowerCase().endsWith(".html")) {
    throw new TypeError("Pet settings must be an HTML file")
  }
  if (input.protocol !== "convax.pet-host/1") {
    throw new TypeError("Pet protocol must equal convax.pet-host/1")
  }
  return { library, overlay, protocol: "convax.pet-host/1", settings }
}

export function parsePortablePluginRuntime(value: unknown): PortablePluginMcpStdioRuntime {
  const input = portableRecord(value, "Plugin runtime")
  assertPortableKeys(input, ["args", "command", "type"], "Plugin runtime")
  if (input.type !== "mcp-stdio") {
    throw new TypeError("Plugin runtime type must be mcp-stdio")
  }
  const command = portableText(input.command, "Plugin runtime command", 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(command)) {
    throw new TypeError("Plugin runtime command must be a bare executable name")
  }
  validatePortablePluginSegment(command)
  let args: string[] | undefined
  if (input.args !== undefined) {
    args = portableArray(input.args, "Plugin runtime args", 64).map((value, index) => {
      const argument = portableText(value, `Plugin runtime arg ${index}`, 1_024)
      if (
        /[\s"'`;|&`$(){}[\]<>]/u.test(argument) ||
        argument.includes("\\") ||
        /(^|=)(?:\/|[A-Za-z]:)/u.test(argument) ||
        /(^|[=/])\.{1,2}(?:\/|$)/u.test(argument)
      ) {
        throw new TypeError(
          `Plugin runtime arg ${index} must be a static CLI token without code, native paths, or traversal`,
        )
      }
      return argument
    })
  }
  return { ...(args === undefined ? {} : { args }), command, type: "mcp-stdio" }
}
