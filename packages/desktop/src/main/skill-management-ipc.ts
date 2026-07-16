import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"
import { dirname } from "node:path"
import type { DesktopSkillClient } from "../skill-management-contracts"
import type { WebPluginManager } from "./plugin-manager"
import type { DesktopSkillManager } from "./skill-manager"

type SkillClientInput<Method extends Exclude<keyof DesktopSkillClient, "onDidChange">> = Parameters<DesktopSkillClient[Method]>[0]

export const skillManagementIpcChannels = {
  changed: "agent:skills-changed",
  importSkill: "agent:skill-import",
  installCatalogSkill: "agent:skill-catalog-install",
  installPluginSkill: "agent:skill-plugin-install",
  listSkills: "agent:skills-list",
  uninstallSkill: "agent:skill-uninstall",
} as const

export interface DesktopSkillProjectResolver {
  resolveEntryPath(input: { projectId: string }): Promise<string>
}

function showDirectoryDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

export function registerSkillManagementIpc(
  manager: DesktopSkillManager,
  projects: DesktopSkillProjectResolver,
  plugins: Pick<WebPluginManager, "list" | "resolveAsset">,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
) {
  const register = <Input, Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, input: Input) => Promise<Result> | Result,
  ) => {
    ipcMain.handle(channel, (event, input: Input) => {
      if (!isTrustedSender(event)) throw new Error("Skill IPC request came from an untrusted renderer")
      return handler(event, input)
    })
    return () => ipcMain.removeHandler(channel)
  }
  const publishChange = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send(skillManagementIpcChannels.changed)
    }
  }
  const unsubscribe = manager.subscribe(publishChange)
  const disposers = [
    register<SkillClientInput<"listSkills">, Awaited<ReturnType<DesktopSkillClient["listSkills"]>>>(
      skillManagementIpcChannels.listSkills,
      async (_event, input) => manager.list(input?.scopeId
        ? await projects.resolveEntryPath({ projectId: input.scopeId })
        : undefined),
    ),
    register<undefined, Awaited<ReturnType<DesktopSkillClient["importSkill"]>>>(
      skillManagementIpcChannels.importSkill,
      async (event) => {
        const selected = await showDirectoryDialog(event, {
          buttonLabel: "Import Skill",
          properties: ["openDirectory"],
          title: "Choose a Skill folder containing SKILL.md",
        })
        if (selected.canceled || !selected.filePaths[0]) return null
        return manager.importFromDirectory(selected.filePaths[0])
      },
    ),
    register<SkillClientInput<"installCatalogSkill">, Awaited<ReturnType<DesktopSkillClient["installCatalogSkill"]>>>(
      skillManagementIpcChannels.installCatalogSkill,
      (_event, input) => manager.installCatalogSkill(input.id),
    ),
    register<SkillClientInput<"installPluginSkill">, Awaited<ReturnType<DesktopSkillClient["installPluginSkill"]>>>(
      skillManagementIpcChannels.installPluginSkill,
      async (_event, input) => {
        const plugin = (await plugins.list()).find((candidate) => candidate.id === input.pluginId)
        if (!plugin) throw new Error(`Installed Plugin was not found: ${input.pluginId}`)
        if (!plugin.skill) throw new Error(`Plugin does not include a companion Skill: ${input.pluginId}`)
        const skillFile = await plugins.resolveAsset(plugin.id, plugin.skill)
        return manager.importFromDirectory(dirname(skillFile))
      },
    ),
    register<SkillClientInput<"uninstallSkill">, Awaited<ReturnType<DesktopSkillClient["uninstallSkill"]>>>(
      skillManagementIpcChannels.uninstallSkill,
      (_event, input) => manager.uninstall(input.name),
    ),
  ]
  return () => {
    unsubscribe()
    disposers.forEach((dispose) => dispose())
  }
}
