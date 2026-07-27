export const semanticThemeTokenNames = [
  "surface-canvas",
  "surface-panel",
  "surface-raised",
  "surface-inset",
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "text-disabled",
  "brand",
  "on-brand",
  "selection",
  "on-selection",
  "interactive-hover",
  "interactive-selected",
  "interactive-selected-border",
  "interactive-pressed",
  "drop-target",
  "backdrop",
  "focus-ring",
  "status-danger",
  "status-danger-surface",
  "status-warning",
  "status-warning-surface",
  "status-success",
  "status-success-surface",
  "status-info",
  "status-info-surface",
  "border-subtle",
  "border-default",
  "border-strong",
  "control-background",
] as const

export type SemanticThemeTokenName = (typeof semanticThemeTokenNames)[number]
export type SemanticThemeTokens = Readonly<Record<SemanticThemeTokenName, string>>

export function semanticThemeVariableName(token: SemanticThemeTokenName) {
  return `--ui-${token}` as const
}
