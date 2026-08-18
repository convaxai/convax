import {
  parsePortablePluginGenerationContribution,
  validatePortableToolReferences,
  type PortablePluginGenerationContribution,
} from "./generation"
import {
  parsePortablePluginLlmContribution,
  parsePortablePluginServiceContribution,
  type PortablePluginLlmContribution,
  type PortablePluginMcpStdioRuntime,
  type PortablePluginServiceAction,
} from "./runtime-contributions"
import {
  assertPortableKeys,
  portableArray,
  portableRecord,
  portableText,
  validatePortablePluginSegment,
} from "./primitives"

export const maximumPortablePluginServicesV9 = 16
export const maximumPortablePluginRuntimeArgs = 64

export interface PortablePluginServiceRuntimeProfileV9 {
  readonly args?: readonly string[]
}

export interface PortablePluginServiceContributionV9 {
  readonly actions: readonly PortablePluginServiceAction[]
  readonly description: string
  readonly generation?: PortablePluginGenerationContribution
  readonly id: string
  readonly llm?: PortablePluginLlmContribution
  readonly name: string
  readonly runtime: PortablePluginServiceRuntimeProfileV9
}

function parseServiceId(value: unknown, label: string) {
  const id = portableText(value, label, 80)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new TypeError(`${label} must use kebab-case`)
  }
  validatePortablePluginSegment(id)
  return id
}

function parseRuntimeArgument(value: unknown, label: string) {
  const argument = portableText(value, label, 1_024)
  if (
    /[\s"'`;|&`$(){}[\]<>]/u.test(argument) ||
    argument.includes("\\") ||
    /(^|=)(?:\/|[A-Za-z]:)/u.test(argument) ||
    /(^|[=/])\.{1,2}(?:\/|$)/u.test(argument)
  ) {
    throw new TypeError(`${label} must be a static CLI token without code, native paths, or traversal`)
  }
  return argument
}

function parseServiceRuntimeProfile(
  value: unknown,
  label: string,
  baseArgumentCount: number,
): PortablePluginServiceRuntimeProfileV9 {
  const input = portableRecord(value, label)
  assertPortableKeys(input, ["args"], label)
  if (input.args === undefined) return {}
  const args = portableArray(input.args, `${label} args`, maximumPortablePluginRuntimeArgs).map((argument, index) =>
    parseRuntimeArgument(argument, `${label} arg ${index}`),
  )
  if (baseArgumentCount + args.length > maximumPortablePluginRuntimeArgs) {
    throw new TypeError(
      `${label} effective args must contain at most ${maximumPortablePluginRuntimeArgs} items including base runtime args`,
    )
  }
  return { args }
}

export function parsePortablePluginServiceContributionsV9(
  value: unknown,
  runtime: PortablePluginMcpStdioRuntime | undefined,
  pluginId: string,
): readonly PortablePluginServiceContributionV9[] {
  const baseArgumentCount = runtime?.args?.length ?? 0
  const services = portableArray(value, "Plugin services", maximumPortablePluginServicesV9, true).map(
    (value, index) => {
      const label = `Plugin service ${index}`
      const input = portableRecord(value, label)
      assertPortableKeys(input, ["actions", "description", "generation", "id", "llm", "name", "runtime"], label)
      const generation =
        input.generation === undefined ? undefined : parsePortablePluginGenerationContribution(input.generation)
      validatePortableToolReferences({ generation })
      const llm = input.llm === undefined ? undefined : parsePortablePluginLlmContribution(input.llm)
      return {
        actions: parsePortablePluginServiceContribution({ actions: input.actions }).actions,
        description: portableText(input.description, `${label} description`, 2_000),
        ...(generation === undefined ? {} : { generation }),
        id: parseServiceId(input.id, `${label} id`),
        ...(llm === undefined ? {} : { llm }),
        name: portableText(input.name, `${label} name`, 120),
        runtime: parseServiceRuntimeProfile(input.runtime, `${label} runtime`, baseArgumentCount),
      }
    },
  )
  if (new Set(services.map((service) => service.id)).size !== services.length) {
    throw new TypeError("Plugin services contain duplicate ids")
  }
  if (services.some((service) => service.id === pluginId)) {
    throw new TypeError("Plugin service id must differ from the Plugin id")
  }
  return services
}
