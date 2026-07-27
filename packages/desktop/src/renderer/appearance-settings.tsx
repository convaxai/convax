import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  Switch,
  cn,
} from "@convax/ui"
import { Palette } from "lucide-react"
import { useEffect, useState, type KeyboardEvent } from "react"
import type { AppearancePreferences } from "./appearance-preferences"
import {
  appAppearanceThemes,
  appearanceAccentIds,
  appearanceAccents,
  appearancePresetIds,
  isAppearanceAccentSelectionId,
  isAppearancePresetId,
  normalizeCustomAccentColor,
  resolveAppearanceAccentTokens,
  type AppAppearanceTheme,
  type AppearanceAccentSelectionId,
  type AppearancePresetId,
} from "./appearance-themes"

export type AppearanceSaveState = "idle" | "saving" | "saved" | "error"

export interface AppearanceSettingsProps {
  locale: "en" | "zh-CN"
  onChange: (preferences: AppearancePreferences) => void
  preferences: AppearancePreferences
  saveState?: AppearanceSaveState
}

const zhPresetDescriptions: Record<AppearancePresetId, string> = {
  paper: "温暖、安静的界面与画布，适合长时间的空间创作。",
  graphite: "中性炭灰表面与画布，清晰而克制。",
  midnight: "近黑影院式工作空间，语义色更明亮。",
  studio: "适合视觉创作的冷调日光工作空间。",
}

const zhAccentLabels = {
  blue: "蓝色",
  custom: "自定义",
  cyan: "青色",
  green: "绿色",
  orange: "橙色",
  rose: "玫红",
  violet: "紫色",
} as const satisfies Record<AppearanceAccentSelectionId, string>

function copy(locale: AppearanceSettingsProps["locale"]) {
  return locale === "zh-CN"
    ? {
        accessibility: "辅助功能",
        accent: "强调色",
        accentDescription: "用于按钮、选中态、焦点环与画布激活元素；自定义颜色会自动适配对比度。",
        appearance: "主题与颜色",
        custom: "自定义",
        customAccent: "自定义强调色",
        customColorInvalid: "请输入 3 位或 6 位十六进制颜色。",
        darkThemes: "深色主题",
        error: "未能保存。当前选择会保留在本次会话中。",
        highContrast: "提高对比度",
        contrastDescription: "增强边框和辅助文字对比度。",
        lightThemes: "浅色主题",
        motionDescription: "减少界面位移和非必要过渡。",
        reducedMotion: "减少动态效果",
        saved: "已自动保存",
        saving: "正在保存…",
        theme: "主题",
        themeDescription: "一套主题同时作用于应用窗口、Agent 与画布，不修改画布文档。",
      }
    : {
        accessibility: "Accessibility",
        accent: "Accent color",
        accentDescription: "Used for actions, selection, focus, and active Canvas elements, with automatic contrast.",
        appearance: "Theme and color",
        custom: "Custom",
        customAccent: "Custom accent color",
        customColorInvalid: "Enter a 3 or 6 digit hexadecimal color.",
        darkThemes: "Dark themes",
        error: "Could not save. Your choice remains active for this session.",
        highContrast: "Increase contrast",
        contrastDescription: "Strengthens borders and supporting text contrast.",
        lightThemes: "Light themes",
        motionDescription: "Reduces interface movement and non-essential transitions.",
        reducedMotion: "Reduce motion",
        saved: "Saved automatically",
        saving: "Saving…",
        theme: "Theme",
        themeDescription: "One theme applies to the app shell, Agent, and Canvas without changing Canvas documents.",
      }
}

function ThemeMark({ theme }: { theme: AppAppearanceTheme }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold shadow-[inset_0_0_0_1px_rgb(127_127_127_/_0.22)]"
      style={{
        backgroundColor: theme.tokens["surface-raised"],
        color: theme.tokens.brand,
      }}
    >
      Aa
    </span>
  )
}

function AccentMark({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0_/_0.12),0_0_0_1px_rgb(255_255_255_/_0.12)]"
      style={{ backgroundColor: color }}
    />
  )
}

function ThemeSelect({
  labels,
  locale,
  onValueChange,
  value,
}: {
  labels: ReturnType<typeof copy>
  locale: AppearanceSettingsProps["locale"]
  onValueChange: (theme: AppearancePresetId) => void
  value: AppearancePresetId
}) {
  const selected = appAppearanceThemes[value]
  const groups = [
    { label: labels.lightThemes, scheme: "light" as const },
    { label: labels.darkThemes, scheme: "dark" as const },
  ]

  return (
    <Select onValueChange={(next) => isAppearancePresetId(next) && onValueChange(next)} value={value}>
      <SelectTrigger
        aria-labelledby="appearance-theme-label"
        className="h-10 min-w-52 rounded-lg bg-surface-raised px-2.5 shadow-none active:scale-[0.98]"
        data-appearance-theme-select=""
        id="appearance-theme-select"
      >
        <SelectValue>
          <span className="flex min-w-0 items-center gap-2.5">
            <ThemeMark theme={selected} />
            <span className="truncate font-medium">{selected.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="w-72">
        {groups.map((group, groupIndex) => (
          <div key={group.scheme}>
            {groupIndex > 0 ? <SelectSeparator /> : null}
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
              {group.label}
            </div>
            {appearancePresetIds
              .filter((id) => appAppearanceThemes[id].scheme === group.scheme)
              .map((id) => {
                const theme = appAppearanceThemes[id]
                return (
                  <SelectItem className="min-h-12 gap-2.5 pl-8" key={id} value={id}>
                    <ThemeMark theme={theme} />
                    <span className="min-w-0">
                      <span className="block font-medium">{theme.label}</span>
                      <span className="block truncate text-[11px] text-text-tertiary">
                        {locale === "zh-CN" ? zhPresetDescriptions[id] : theme.description}
                      </span>
                    </span>
                  </SelectItem>
                )
              })}
          </div>
        ))}
      </SelectContent>
    </Select>
  )
}

function CustomAccentInput({
  color,
  labels,
  onCommit,
}: {
  color: string
  labels: ReturnType<typeof copy>
  onCommit: (color: string) => void
}) {
  const [draft, setDraft] = useState(color)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(color)
    setInvalid(false)
  }, [color])

  const commit = () => {
    const normalized = normalizeCustomAccentColor(draft)
    if (!normalized) {
      setInvalid(true)
      return
    }
    setDraft(normalized)
    setInvalid(false)
    onCommit(normalized)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit()
      event.currentTarget.blur()
    }
    if (event.key === "Escape") {
      setDraft(color)
      setInvalid(false)
      event.currentTarget.blur()
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label
        aria-label={labels.customAccent}
        className="relative grid size-10 cursor-pointer place-items-center overflow-hidden rounded-lg bg-surface-raised shadow-[inset_0_0_0_1px_var(--ui-border-default)] active:scale-[0.96]"
        style={{ color }}
      >
        <span className="size-5 rounded-full bg-current shadow-[inset_0_0_0_1px_rgb(0_0_0_/_0.12)]" />
        <input
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(event) => {
            const normalized = normalizeCustomAccentColor(event.currentTarget.value)
            if (!normalized) return
            setDraft(normalized)
            setInvalid(false)
            onCommit(normalized)
          }}
          type="color"
          value={color}
        />
      </label>
      <div>
        <input
          aria-describedby={invalid ? "appearance-custom-accent-error" : undefined}
          aria-invalid={invalid}
          aria-label={labels.customAccent}
          className={cn(
            "h-10 w-24 rounded-lg bg-surface-raised px-3 font-mono text-xs uppercase text-text-primary shadow-[inset_0_0_0_1px_var(--ui-border-default)] outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/45",
            invalid && "ring-1 ring-status-danger focus-visible:ring-status-danger",
          )}
          key={color}
          onBlur={commit}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            setInvalid(false)
          }}
          onKeyDown={handleKeyDown}
          type="text"
          value={draft}
        />
        {invalid ? (
          <span className="sr-only" id="appearance-custom-accent-error" role="alert">
            {labels.customColorInvalid}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function accentLabel(locale: AppearanceSettingsProps["locale"], id: AppearanceAccentSelectionId) {
  return locale === "zh-CN" ? zhAccentLabels[id] : id === "custom" ? "Custom" : appearanceAccents[id].label
}

function AccentSelect({
  customAccent,
  labels,
  locale,
  onValueChange,
  theme,
  value,
}: {
  customAccent: string
  labels: ReturnType<typeof copy>
  locale: AppearanceSettingsProps["locale"]
  onValueChange: (accent: AppearanceAccentSelectionId) => void
  theme: AppearancePresetId
  value: AppearanceAccentSelectionId
}) {
  const scheme = appAppearanceThemes[theme].scheme
  const selectedColor = resolveAppearanceAccentTokens(theme, value, customAccent).brand

  return (
    <Select onValueChange={(next) => isAppearanceAccentSelectionId(next) && onValueChange(next)} value={value}>
      <SelectTrigger
        aria-labelledby="appearance-accent-label"
        className="h-10 min-w-40 rounded-lg bg-surface-raised shadow-none active:scale-[0.98]"
        data-appearance-accent-select=""
        id="appearance-accent-select"
      >
        <SelectValue>
          <span className="flex items-center gap-2">
            <AccentMark color={selectedColor} />
            <span className="font-medium">{accentLabel(locale, value)}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="w-52">
        {appearanceAccentIds.map((id) => (
          <SelectItem className="gap-2.5" key={id} value={id}>
            <AccentMark color={appearanceAccents[id][scheme].brand} />
            <span>{accentLabel(locale, id)}</span>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem className="gap-2.5" value="custom">
          <AccentMark color={customAccent} />
          <span>{labels.custom}</span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

export function AppearanceSettings({ locale, onChange, preferences, saveState = "idle" }: AppearanceSettingsProps) {
  const labels = copy(locale)
  const update = (patch: Partial<AppearancePreferences>) => onChange({ ...preferences, ...patch })

  return (
    <div className="space-y-9" data-appearance-settings="true">
      <section aria-labelledby="appearance-heading">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold" id="appearance-heading">
            <Palette aria-hidden="true" className="size-4 text-text-tertiary" />
            {labels.appearance}
          </h3>
          <SaveStatus labels={labels} state={saveState} />
        </div>
        <div className="border-y border-border-subtle">
          <SettingsRow
            action={
              <ThemeSelect
                labels={labels}
                locale={locale}
                onValueChange={(theme) => update({ theme })}
                value={preferences.theme}
              />
            }
            description={labels.themeDescription}
            label={<span id="appearance-theme-label">{labels.theme}</span>}
          />
          <SettingsRow
            action={
              <div className="flex items-center gap-2">
                <AccentSelect
                  customAccent={preferences.customAccent}
                  labels={labels}
                  locale={locale}
                  onValueChange={(accent) => update({ accent })}
                  theme={preferences.theme}
                  value={preferences.accent}
                />
                {preferences.accent === "custom" ? (
                  <CustomAccentInput
                    color={preferences.customAccent}
                    labels={labels}
                    onCommit={(customAccent) => update({ accent: "custom", customAccent })}
                  />
                ) : null}
              </div>
            }
            description={labels.accentDescription}
            label={<span id="appearance-accent-label">{labels.accent}</span>}
          />
        </div>
      </section>

      <section aria-labelledby="appearance-accessibility">
        <h3 className="mb-3 text-sm font-semibold" id="appearance-accessibility">
          {labels.accessibility}
        </h3>
        <div className="border-y border-border-subtle">
          <SettingsRow
            action={
              <Switch
                aria-label={labels.highContrast}
                checked={preferences.highContrast}
                onCheckedChange={(highContrast) => update({ highContrast })}
              />
            }
            description={labels.contrastDescription}
            label={labels.highContrast}
          />
          <SettingsRow
            action={
              <Switch
                aria-label={labels.reducedMotion}
                checked={preferences.reducedMotion}
                onCheckedChange={(reducedMotion) => update({ reducedMotion })}
              />
            }
            description={labels.motionDescription}
            label={labels.reducedMotion}
          />
        </div>
      </section>
    </div>
  )
}

function SaveStatus({ labels, state }: { labels: ReturnType<typeof copy>; state: AppearanceSaveState }) {
  if (state === "idle") return null
  return (
    <span
      className={cn("shrink-0 text-[11px]", state === "error" ? "text-status-danger" : "text-text-tertiary")}
      role="status"
    >
      {state === "saving" ? labels.saving : state === "error" ? labels.error : labels.saved}
    </span>
  )
}
