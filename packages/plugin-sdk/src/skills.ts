import {
  PLUGIN_API_CATALOG_MAJOR,
  isPluginApiId,
  parseRuntimePluginApiDeclaration,
  pluginApiCatalog,
  type PluginApiDeclaration,
} from "@convax/plugin-api"

import type { PortablePluginAgentContribution } from "./generation"
import {
  assertPortableKeys,
  parsePortablePluginRelativePath,
  validatePortablePluginSegment,
  portableArray,
  portableRecord,
  portableText,
} from "./primitives"

export interface PortablePluginSkillUses {
  readonly optionalHostApis?: readonly string[]
  readonly pluginTools?: readonly string[]
  readonly requiredHostApis?: readonly string[]
}

export interface PortablePluginSkillContribution {
  readonly name: string
  readonly path: string
  readonly uses?: PortablePluginSkillUses
}

const agentSkillPluginApis = new Set<string>(
  pluginApiCatalog.apis
    .filter((definition) => definition.audience.includes("agent-skill"))
    .map((definition) => definition.id),
)
const agentToolIdPattern = /^[a-z][a-z0-9_]{0,63}$/

function skillName(value: unknown, label: string) {
  const name = portableText(value, label, 64)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
    throw new TypeError(`${label} must use kebab-case`)
  }
  validatePortablePluginSegment(name)
  return name
}

function parseSkillUses(
  value: unknown,
  label: string,
  hostApi: PluginApiDeclaration<string>,
): PortablePluginSkillUses {
  const input = portableRecord(value, label)
  assertPortableKeys(input, ["optionalHostApis", "pluginTools", "requiredHostApis"], label)
  const declaration = parseRuntimePluginApiDeclaration({
    major: PLUGIN_API_CATALOG_MAJOR,
    required: input.requiredHostApis ?? [],
    optional: input.optionalHostApis ?? [],
  })
  const topLevelRequired = new Set(hostApi.required)
  const topLevelDeclared = new Set([...hostApi.required, ...hostApi.optional])
  for (const id of declaration.required) {
    if (!topLevelRequired.has(id)) {
      throw new TypeError(`${label} required Host API must be required by the Plugin: ${id}`)
    }
    if (isPluginApiId(id) && !agentSkillPluginApis.has(id)) {
      throw new TypeError(`${label} Host API is not available to Agent Skills: ${id}`)
    }
  }
  for (const id of declaration.optional) {
    if (!topLevelDeclared.has(id)) {
      throw new TypeError(`${label} optional Host API must be declared by the Plugin: ${id}`)
    }
    if (isPluginApiId(id) && !agentSkillPluginApis.has(id)) {
      throw new TypeError(`${label} Host API is not available to Agent Skills: ${id}`)
    }
  }
  let pluginTools: string[] | undefined
  if (input.pluginTools !== undefined) {
    pluginTools = portableArray(input.pluginTools, `${label} pluginTools`, 32, true).map(
      (value, index) => {
        const id = portableText(value, `${label} pluginTools ${index}`, 64)
        if (!agentToolIdPattern.test(id)) {
          throw new TypeError(`${label} plugin tool id must use lower snake_case: ${id}`)
        }
        return id
      },
    )
    if (new Set(pluginTools).size !== pluginTools.length) {
      throw new TypeError(`${label} pluginTools contain duplicate ids`)
    }
  }
  if (
    declaration.required.length === 0 &&
    declaration.optional.length === 0 &&
    pluginTools === undefined
  ) {
    throw new TypeError(`${label} must declare at least one Host API or Plugin tool`)
  }
  return {
    ...(declaration.optional.length === 0
      ? {}
      : { optionalHostApis: [...declaration.optional] }),
    ...(pluginTools === undefined ? {} : { pluginTools }),
    ...(declaration.required.length === 0
      ? {}
      : { requiredHostApis: [...declaration.required] }),
  }
}

export function parsePortablePluginSkills(
  value: unknown,
  hostApi: PluginApiDeclaration<string>,
): readonly PortablePluginSkillContribution[] | undefined {
  if (value === undefined) return undefined
  const skills = portableArray(value, "Plugin Skill contributions", 32, true).map(
    (value, index) => {
      const label = `Plugin Skill contribution ${index}`
      const input = portableRecord(value, label)
      assertPortableKeys(input, ["name", "path", "uses"], label)
      const name = skillName(input.name, `${label} name`)
      const path = parsePortablePluginRelativePath(input.path, `${label} path`)
      if (path.split("/").at(-1) !== name) {
        throw new TypeError(`${label} path must name its Skill directory: ${name}`)
      }
      const uses =
        input.uses === undefined
          ? undefined
          : parseSkillUses(input.uses, `${label} uses`, hostApi)
      return { name, path, ...(uses === undefined ? {} : { uses }) }
    },
  )
  if (new Set(skills.map((skill) => skill.name)).size !== skills.length) {
    throw new TypeError("Plugin Skill contributions contain duplicate names")
  }
  if (
    new Set(skills.map((skill) => skill.path.toLocaleLowerCase("en-US"))).size !==
    skills.length
  ) {
    throw new TypeError("Plugin Skill contributions contain duplicate paths")
  }
  return skills
}

export function validatePortableSkillToolReferences(
  skills: readonly PortablePluginSkillContribution[] | undefined,
  agent: PortablePluginAgentContribution | undefined,
) {
  const declaredTools = new Set(agent?.tools?.map((tool) => tool.id) ?? [])
  for (const skill of skills ?? []) {
    for (const tool of skill.uses?.pluginTools ?? []) {
      if (!declaredTools.has(tool)) {
        throw new TypeError(`Plugin Skill ${skill.name} references an unknown Agent tool: ${tool}`)
      }
    }
  }
}
