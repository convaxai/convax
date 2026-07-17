export type AppLanguagePreference = "zh-CN" | "en"
export type AppLocale = AppLanguagePreference

export const appLanguageStorageKey = "convax.desktop.app-language.v1"

interface AppLanguageStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const languagePreferences: readonly AppLanguagePreference[] = ["zh-CN", "en"]

export function readAppLanguagePreference(storage: Pick<AppLanguageStorage, "getItem">): AppLanguagePreference {
  try {
    const value = JSON.parse(storage.getItem(appLanguageStorageKey) ?? "null") as unknown
    if (!value || typeof value !== "object") return "en"
    const candidate = value as { language?: unknown; version?: unknown }
    if (candidate.version !== 1 || !languagePreferences.includes(candidate.language as AppLanguagePreference))
      return "en"
    return candidate.language as AppLanguagePreference
  } catch {
    return "en"
  }
}

export function writeAppLanguagePreference(
  storage: Pick<AppLanguageStorage, "setItem">,
  language: AppLanguagePreference,
) {
  try {
    storage.setItem(appLanguageStorageKey, JSON.stringify({ language, version: 1 }))
    return true
  } catch {
    return false
  }
}

export function resolveAppLocale(preference: AppLanguagePreference): AppLocale {
  return preference
}

const englishMessages = {
  "appMenu.capabilities": "Skill & Plugin",
  "appMenu.localWorkspace": "Local workspace",
  "appMenu.localWorkspaceDescription": "Settings are stored on this device",
  "appMenu.open": "Open application menu",
  "appMenu.settings": "Settings",
  "capabilities.availableSkills": "Available Skills",
  "capabilities.close": "Close capability center",
  "capabilities.description": "Extend Agent workflows and Canvas experiences",
  "capabilities.globalReadOnly": "Global · read only",
  "capabilities.globalThisDevice": "Global · this device",
  "capabilities.importPlugin": "Import Plugin",
  "capabilities.importSkill": "Import Skill",
  "capabilities.importedPlugins": "Imported Plugins",
  "capabilities.includedSkills": "Included Skills",
  "capabilities.installCompanionSkill": "Install companion Skill",
  "capabilities.installPlugin": "Install Plugin",
  "capabilities.installSkill": "Install Skill",
  "capabilities.installed": "Installed",
  "capabilities.installedVersion": "Installed v{version}",
  "capabilities.loading": "Loading capabilities…",
  "capabilities.managed": "Managed",
  "capabilities.noCatalogPlugins": "The local Plugin catalog is empty.",
  "capabilities.noIncludedSkills": "No included Skills are available yet.",
  "capabilities.noSkills": "No managed or global Skills were found.",
  "capabilities.plugins": "Plugin",
  "capabilities.pluginsDescription":
    "Plugins add sandboxed Canvas renderers and toolbar actions. A companion Skill is optional and installed separately.",
  "capabilities.pluginInstalled": "Plugin installed",
  "capabilities.pluginReady": "Ready on Canvas · Return to Canvas, then right-click or press Tab to add {name}.",
  "capabilities.pluginCatalog": "Plugin catalog",
  "capabilities.skills": "Skill",
  "capabilities.skillsDescription":
    "Skills add reusable Agent workflows. Managed Skills can be removed here; global OpenCode Skills stay read-only.",
  "capabilities.title": "Skill & Plugin",
  "capabilities.unavailable": "Capabilities are not available.",
  "capabilities.uninstall": "Uninstall",
  "capabilities.updateAvailable": "Update available",
  "capabilities.updatePlugin": "Update Plugin",
  "settings.back": "Back to app",
  "settings.capabilities": "Skill & Plugin",
  "settings.general": "General",
  "settings.language": "Language",
  "settings.language.en": "English",
  "settings.language.zhCN": "简体中文",
  "settings.languageDescription": "Choose the language used by the Convax desktop interface.",
  "settings.localDescription": "Preferences for this local Convax workspace",
  "settings.title": "Settings",
} as const

export type AppMessageKey = keyof typeof englishMessages

const chineseMessages = {
  "appMenu.capabilities": "技能与插件",
  "appMenu.localWorkspace": "本地工作区",
  "appMenu.localWorkspaceDescription": "设置保存在这台设备上",
  "appMenu.open": "打开应用菜单",
  "appMenu.settings": "设置",
  "capabilities.availableSkills": "可用技能",
  "capabilities.close": "关闭技能与插件",
  "capabilities.description": "扩展 Agent 工作流和画布体验",
  "capabilities.globalReadOnly": "全局 · 只读",
  "capabilities.globalThisDevice": "全局 · 当前设备",
  "capabilities.importPlugin": "导入插件",
  "capabilities.importSkill": "导入技能",
  "capabilities.importedPlugins": "已导入插件",
  "capabilities.includedSkills": "内置技能",
  "capabilities.installCompanionSkill": "安装配套技能",
  "capabilities.installPlugin": "安装插件",
  "capabilities.installSkill": "安装技能",
  "capabilities.installed": "已安装",
  "capabilities.installedVersion": "已安装 v{version}",
  "capabilities.loading": "正在加载技能与插件…",
  "capabilities.managed": "由 Convax 管理",
  "capabilities.noCatalogPlugins": "本地插件目录为空。",
  "capabilities.noIncludedSkills": "暂无内置技能。",
  "capabilities.noSkills": "未发现由 Convax 管理或全局安装的技能。",
  "capabilities.plugins": "插件",
  "capabilities.pluginsDescription": "插件可增加沙箱化的画布渲染器和工具栏操作；配套技能始终独立安装。",
  "capabilities.pluginInstalled": "插件已安装",
  "capabilities.pluginReady": "已可在画布中使用 · 返回画布后右键或按 Tab 添加 {name}。",
  "capabilities.pluginCatalog": "插件目录",
  "capabilities.skills": "技能",
  "capabilities.skillsDescription":
    "技能用于复用 Agent 工作流。这里可以移除由 Convax 管理的技能；OpenCode 全局技能保持只读。",
  "capabilities.title": "技能与插件",
  "capabilities.unavailable": "技能与插件当前不可用。",
  "capabilities.uninstall": "卸载",
  "capabilities.updateAvailable": "有可用更新",
  "capabilities.updatePlugin": "更新插件",
  "settings.back": "返回应用",
  "settings.capabilities": "技能与插件",
  "settings.general": "常规",
  "settings.language": "语言",
  "settings.language.en": "English",
  "settings.language.zhCN": "简体中文",
  "settings.languageDescription": "选择 Convax 桌面界面使用的语言。",
  "settings.localDescription": "当前本地 Convax 工作区的全局偏好",
  "settings.title": "设置",
} satisfies Record<AppMessageKey, string>

const messages: Record<AppLocale, Record<AppMessageKey, string>> = {
  en: englishMessages,
  "zh-CN": chineseMessages,
}

export function appMessage(locale: AppLocale, key: AppMessageKey, values?: Readonly<Record<string, string | number>>) {
  const message = messages[locale][key]
  if (!values) return message
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  )
}
