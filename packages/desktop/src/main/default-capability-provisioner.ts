import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { WebPluginManager } from "./plugin-manager"
import type { DesktopSkillManager } from "./skill-manager"

const schema = "convax.default-capabilities/1" as const

interface ProvisioningState {
  plugins: string[]
  schema: typeof schema
  skills: string[]
}

export async function provisionDefaultCapabilities(input: {
  catalog: readonly DesktopBuiltinPluginBundle[]
  pluginManager: Pick<
    WebPluginManager,
    "installOrUpdateBuiltinBundle" | "isBuiltinBundleInstalled" | "list" | "resolveAsset"
  >
  skillManager: Pick<DesktopSkillManager, "installManagedAtStartup" | "listManaged">
  stateFile: string
}) {
  const state = await readState(input.stateFile)
  for (const item of input.catalog) {
    if (!item.defaultInstall) continue
    const provisionedBefore = state.plugins.includes(item.manifest.id)
    const installed = (await input.pluginManager.list()).find((plugin) => plugin.id === item.manifest.id)
    if (provisionedBefore && !installed) continue
    if (!(await input.pluginManager.isBuiltinBundleInstalled(item.bundle))) {
      await ("legacyBundleDigests" in item
        ? input.pluginManager.installOrUpdateBuiltinBundle(item.bundle, {
            legacyBundleDigests: item.legacyBundleDigests,
          })
        : input.pluginManager.installOrUpdateBuiltinBundle(item.bundle))
    }
    if (!provisionedBefore) {
      state.plugins.push(item.manifest.id)
      await writeState(input.stateFile, state)
    }
  }

  for (const item of input.catalog) {
    if (!item.defaultInstallCompanionSkill || !item.manifest.skill) continue
    if (!item.companionSkillName) throw new Error(`Default Plugin companion Skill name is missing: ${item.manifest.id}`)
    const skillFile = await input.pluginManager.resolveAsset(item.manifest.id, item.manifest.skill).catch(() => null)
    if (!skillFile) continue
    const skillName = item.companionSkillName
    if (state.skills.includes(skillName)) continue
    const managedSkills = await input.skillManager.listManaged()
    if (!managedSkills.some((skill) => skill.name === skillName)) {
      const installed = await input.skillManager.installManagedAtStartup(path.dirname(skillFile))
      if (installed.name !== skillName) {
        throw new Error(`Plugin companion Skill name does not match its catalog metadata: ${item.manifest.id}`)
      }
    }
    state.skills.push(skillName)
    await writeState(input.stateFile, state)
  }
}

async function readState(stateFile: string): Promise<ProvisioningState> {
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(stateFile, "utf8"))
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { plugins: [], schema, skills: [] }
    if (error instanceof SyntaxError) throw new Error("Default capability provisioning state is invalid JSON")
    throw error
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Default capability provisioning state is invalid")
  const input = value as Record<string, unknown>
  if (
    input.schema !== schema ||
    !validIds(input.plugins) ||
    !validIds(input.skills) ||
    Object.keys(input).some((key) => !["plugins", "schema", "skills"].includes(key))
  ) {
    throw new Error("Default capability provisioning state is invalid")
  }
  return { plugins: [...input.plugins], schema, skills: [...input.skills] }
}

async function writeState(stateFile: string, state: ProvisioningState) {
  await fs.mkdir(path.dirname(stateFile), { mode: 0o700, recursive: true })
  const temporary = `${stateFile}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(
      temporary,
      `${JSON.stringify(
        {
          plugins: [...new Set(state.plugins)].sort(),
          schema,
          skills: [...new Set(state.skills)].sort(),
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    )
    await fs.rename(temporary, stateFile)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 1_000 &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 128) &&
    new Set(value).size === value.length
  )
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}
