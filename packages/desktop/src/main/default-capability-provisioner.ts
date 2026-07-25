import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import {
  WebPluginPublicationDeferredError,
  type WebPluginManager,
  type WebPluginPublicationOptions,
} from "./plugin-manager"
import type { RemoteCapabilityInstaller } from "./remote-capability-installer"
import type { DesktopSkillManager } from "./skill-manager"

const schema = "convax.default-capabilities/1" as const

interface ProvisioningState {
  plugins: string[]
  schema: typeof schema
  skills: string[]
}

export interface DefaultRemoteCapability {
  companionSkillName?: string
  pluginId: string
}

export interface DefaultCapabilityProvisioningFailure {
  error: unknown
  id: string
  kind: "plugin" | "skill"
}

export interface DefaultCapabilityProvisioningResult {
  failures: DefaultCapabilityProvisioningFailure[]
}

interface RemoteDefaultProvisioning {
  bootstrapInstaller?: Pick<RemoteCapabilityInstaller, "installPlugin">
  catalog: readonly DefaultRemoteCapability[]
  installer: Pick<RemoteCapabilityInstaller, "installPlugin" | "updatePlugin">
  mode?: "bootstrap" | "network"
}

interface DefaultCapabilityProvisioningInput {
  catalog: readonly DesktopBuiltinPluginBundle[]
  pluginManager: Pick<
    WebPluginManager,
    "installOrUpdateBuiltinBundle" | "isBuiltinBundleInstalled" | "list" | "resolveAsset"
  >
  preparePluginPublication: NonNullable<WebPluginPublicationOptions["beforePublish"]>
  skillManager: Pick<DesktopSkillManager, "installManagedAtStartup" | "listManaged" | "refresh">
  stateFile: string
  remote?: RemoteDefaultProvisioning
}

export async function provisionDefaultCapabilities(
  input: DefaultCapabilityProvisioningInput,
): Promise<DefaultCapabilityProvisioningResult> {
  let deferred = false
  try {
    return await provisionDefaultCapabilitiesOnce(input)
  } catch (error) {
    deferred = error instanceof WebPluginPublicationDeferredError
    throw error
  } finally {
    // Startup publication intentionally batches Skill discovery so a newly
    // installed default Plugin and all of its owned Skills become visible in
    // the same refresh, including when another default failed to provision.
    if (!deferred) await input.skillManager.refresh()
  }
}

async function provisionDefaultCapabilitiesOnce(
  input: DefaultCapabilityProvisioningInput,
): Promise<DefaultCapabilityProvisioningResult> {
  const state = await readState(input.stateFile)
  const failures: DefaultCapabilityProvisioningFailure[] = []
  const blockedPluginIds = new Set<string>()
  const prepareDefaultPluginPublication: NonNullable<WebPluginPublicationOptions["beforePublish"]> = (
    plugin,
    candidate,
  ) => {
    if (plugin.hooks) {
      throw new Error(`Default Plugin Hook update requires an explicit user action: ${plugin.id}`)
    }
    return input.preparePluginPublication(plugin, candidate)
  }
  for (const item of input.catalog) {
    if (!item.defaultInstall) continue
    const provisionedBefore = state.plugins.includes(item.manifest.id)
    const installed = (await input.pluginManager.list()).find((plugin) => plugin.id === item.manifest.id)
    if (provisionedBefore && !installed) continue
    if (!(await input.pluginManager.isBuiltinBundleInstalled(item.bundle))) {
      if (item.manifest.hooks) {
        blockedPluginIds.add(item.manifest.id)
        failures.push({
          error: new Error(`Default Plugin Hook update requires an explicit user action: ${item.manifest.id}`),
          id: item.manifest.id,
          kind: "plugin",
        })
        continue
      }
      await input.pluginManager.installOrUpdateBuiltinBundle(item.bundle, {
        beforePublish: prepareDefaultPluginPublication,
        ...("legacyBundleDigests" in item ? { legacyBundleDigests: item.legacyBundleDigests } : {}),
      })
    }
    if (!provisionedBefore) {
      state.plugins.push(item.manifest.id)
      await writeState(input.stateFile, state)
    }
  }

  for (const item of input.catalog) {
    if (blockedPluginIds.has(item.manifest.id)) continue
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

  const remote = input.remote
  if (!remote) return { failures }
  for (const item of remote.catalog) {
    let installed = (await input.pluginManager.list()).find((plugin) => plugin.id === item.pluginId)
    if ((remote.mode ?? "network") === "bootstrap") {
      // Bootstrap is an offline first-install path only. A receipt preserves an
      // explicit later removal, while an unreceipted same-id package must wait
      // for the network installer to verify and adopt it. Plugin-owned Skills
      // are published by the bootstrap installer; legacy companion Skills wait
      // for the ordinary network phase.
      if (state.plugins.includes(item.pluginId) || installed || !remote.bootstrapInstaller) continue
      try {
        await remote.bootstrapInstaller.installPlugin(item.pluginId, { allowHooks: false })
      } catch (error) {
        if (error instanceof WebPluginPublicationDeferredError) throw error
        failures.push({ error, id: item.pluginId, kind: "plugin" })
        continue
      }
      state.plugins.push(item.pluginId)
      await writeState(input.stateFile, state)
      continue
    }
    if (state.plugins.includes(item.pluginId)) {
      // A receipt plus a missing package means the user removed this default.
      // Its companion must not be newly provisioned behind that choice.
      if (!installed) continue
      try {
        // A receipted local package was verified by its original publication.
        // Refresh only Registry metadata and download bytes when a newer version
        // is available; the current package remains usable on update failure.
        installed = await remote.installer.updatePlugin(item.pluginId, { allowHooks: false })
      } catch (error) {
        if (error instanceof WebPluginPublicationDeferredError) throw error
        // Keep the already-installed version usable when an update check or
        // publication fails; startup must not turn a healthy local Plugin into
        // an unavailable capability merely because the Registry is offline.
        failures.push({ error, id: item.pluginId, kind: "plugin" })
      }
    } else {
      try {
        // A same-id package without our durable default receipt is not trusted
        // merely because it parses. The Registry installer verifies exact
        // package bytes and repairs companion/authorization/owned-Skill state
        // before this installation can be adopted as a managed default.
        installed = installed
          ? await remote.installer.installPlugin(item.pluginId, { allowCurrent: true, allowHooks: false })
          : await remote.installer.installPlugin(item.pluginId, { allowHooks: false })
      } catch (error) {
        if (error instanceof WebPluginPublicationDeferredError) throw error
        failures.push({ error, id: item.pluginId, kind: "plugin" })
        continue
      }
      state.plugins.push(item.pluginId)
      await writeState(input.stateFile, state)
    }

    const skillName = item.companionSkillName
    if (!skillName || state.skills.includes(skillName)) continue
    try {
      if (!installed.skill)
        throw new Error(`Default remote Plugin does not include its companion Skill: ${item.pluginId}`)
      const managedSkills = await input.skillManager.listManaged()
      if (!managedSkills.some((skill) => skill.name === skillName)) {
        const skillFile = await input.pluginManager.resolveAsset(installed.id, installed.skill)
        const companion = await input.skillManager.installManagedAtStartup(path.dirname(skillFile))
        if (companion.name !== skillName) {
          throw new Error(`Remote Plugin companion Skill name does not match its default metadata: ${item.pluginId}`)
        }
      }
      state.skills.push(skillName)
      await writeState(input.stateFile, state)
    } catch (error) {
      failures.push({ error, id: skillName, kind: "skill" })
    }
  }

  return { failures }
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
