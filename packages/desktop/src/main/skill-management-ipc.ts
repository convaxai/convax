import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"
import type {
  DesktopSkillClient,
  DesktopSkillCatalogItem,
  DesktopSkillDetails,
  DesktopSkillShowcase,
  DesktopSkillShowcaseMedia,
  DesktopSkillSource,
  DesktopSkillSummary,
  DesktopSkillTarget,
} from "../skill-management-contracts"
import type { DesktopSkillManager } from "./skill-manager"

export interface SkillManagementCatalogPort {
  getSkillDetails(id: string): Promise<DesktopSkillDetails>
  getSkillShowcase(id: string, media: DesktopSkillShowcaseMedia): Promise<DesktopSkillShowcase | null>
  installSkill(id: string): Promise<DesktopSkillSummary>
  listSkillCatalog(installedNames: ReadonlySet<string>): Promise<DesktopSkillCatalogItem[]>
  subscribe?(listener: () => void): () => void
}

type SkillClientInput<Method extends Exclude<keyof DesktopSkillClient, "onDidChange">> = Parameters<
  DesktopSkillClient[Method]
>[0]

export const skillManagementIpcChannels = {
  changed: "agent:skills-changed",
  getSkillDetails: "agent:skill-details",
  getSkillShowcase: "agent:skill-showcase",
  importSkill: "agent:skill-import",
  installCatalogSkill: "agent:skill-catalog-install",
  listSkills: "agent:skills-list",
  openSkill: "agent:skill-open",
  uninstallSkill: "agent:skill-uninstall",
} as const

export interface DesktopSkillProjectResolver {
  resolveEntryPath(input: { projectId: string }): Promise<string>
}

function showDirectoryDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function requireExactRecord(value: unknown, keys: readonly string[], message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message)
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new Error(message)
  }
  return record
}

function requireSkillTarget(value: unknown): DesktopSkillTarget {
  const base = requireExactRecord(
    value,
    value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).kind === "catalog"
      ? ["id", "kind"]
      : ["kind", "name", "source"],
    "Skill target is invalid",
  )
  if (base.kind === "catalog" && typeof base.id === "string" && skillNamePattern.test(base.id)) {
    return { id: base.id, kind: "catalog" }
  }
  if (
    base.kind === "installed" &&
    typeof base.name === "string" &&
    skillNamePattern.test(base.name) &&
    (base.source === "global" || base.source === "managed")
  ) {
    return { kind: "installed", name: base.name, source: base.source as DesktopSkillSource }
  }
  throw new Error("Skill target is invalid")
}

function requireDetailsInput(input: unknown) {
  const record = requireExactRecord(input, ["target"], "Skill details request must contain only a target")
  return { target: requireSkillTarget(record.target) }
}

function requireShowcaseInput(input: unknown) {
  const record = requireExactRecord(
    input,
    ["media", "target"],
    "Skill showcase request must contain only a target and media",
  )
  if (record.media !== "poster" && record.media !== "animation") {
    throw new Error("Skill showcase media must be poster or animation")
  }
  return {
    media: record.media as DesktopSkillShowcaseMedia,
    target: requireSkillTarget(record.target),
  }
}

export function registerSkillManagementIpc(
  manager: DesktopSkillManager,
  projects: DesktopSkillProjectResolver,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  remoteCatalog?: SkillManagementCatalogPort,
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
  const unsubscribeRemote = remoteCatalog?.subscribe?.(publishChange)
  const disposers = [
    register<SkillClientInput<"getSkillDetails">, Awaited<ReturnType<DesktopSkillClient["getSkillDetails"]>>>(
      skillManagementIpcChannels.getSkillDetails,
      (_event, input) => {
        const { target } = requireDetailsInput(input)
        if (target.kind === "installed") {
          return manager.getInstalledSkillDetails(target.name, target.source)
        }
        if (manager.hasCatalogSkill(target.id)) return manager.getCatalogSkillDetails(target.id)
        if (!remoteCatalog) throw new Error(`Remote Skill catalog item was not found: ${target.id}`)
        return remoteCatalog.getSkillDetails(target.id)
      },
    ),
    register<SkillClientInput<"getSkillShowcase">, Awaited<ReturnType<DesktopSkillClient["getSkillShowcase"]>>>(
      skillManagementIpcChannels.getSkillShowcase,
      async (_event, input) => {
        const { media, target } = requireShowcaseInput(input)
        const id = target.kind === "catalog" ? target.id : target.name
        const builtin = await manager.getBuiltinSkillShowcase(id, media)
        return builtin ?? remoteCatalog?.getSkillShowcase(id, media) ?? null
      },
    ),
    register<SkillClientInput<"listSkills">, Awaited<ReturnType<DesktopSkillClient["listSkills"]>>>(
      skillManagementIpcChannels.listSkills,
      async (_event, input) => {
        const inventory = await manager.list(
          input?.scopeId ? await projects.resolveEntryPath({ projectId: input.scopeId }) : undefined,
        )
        const installedNames = new Set(inventory.skills.filter((skill) => skill.managed).map((skill) => skill.name))
        const remote = (await remoteCatalog?.listSkillCatalog(installedNames).catch(() => [])) ?? []
        return { ...inventory, catalog: [...inventory.catalog, ...remote] }
      },
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
      (_event, input) => {
        if (manager.hasCatalogSkill(input.id)) return manager.installCatalogSkill(input.id)
        if (remoteCatalog) return remoteCatalog.installSkill(input.id)
        throw new Error(`Skill catalog item was not found: ${input.id}`)
      },
    ),
    register<SkillClientInput<"openSkill">, Awaited<ReturnType<DesktopSkillClient["openSkill"]>>>(
      skillManagementIpcChannels.openSkill,
      async (_event, input) => {
        const directory = input.scopeId ? await projects.resolveEntryPath({ projectId: input.scopeId }) : undefined
        const location = await manager.resolveSkillLocation(input.name, directory)
        const error = await shell.openPath(location)
        if (error) throw new Error(`Open Skill failed: ${error}`)
      },
    ),
    register<SkillClientInput<"uninstallSkill">, Awaited<ReturnType<DesktopSkillClient["uninstallSkill"]>>>(
      skillManagementIpcChannels.uninstallSkill,
      (_event, input) => manager.uninstall(input.name),
    ),
  ]
  return () => {
    unsubscribe()
    unsubscribeRemote?.()
    disposers.forEach((dispose) => dispose())
  }
}
