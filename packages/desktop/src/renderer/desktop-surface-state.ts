import type { SettingsSection } from "./settings-view"

export type DesktopPrimarySurface = "home" | "workspace"

export type DesktopSurfaceState =
  | { kind: DesktopPrimarySurface }
  | {
      initialSection: SettingsSection
      initialSkillName?: string
      kind: "settings"
      returnTo: DesktopPrimarySurface
    }

export function createDesktopSurfaceState(): DesktopSurfaceState {
  return { kind: "home" }
}

export function openDesktopHome(_current: DesktopSurfaceState): DesktopSurfaceState {
  return { kind: "home" }
}

export function openDesktopWorkspace(_current: DesktopSurfaceState): DesktopSurfaceState {
  return { kind: "workspace" }
}

export function openDesktopSettings(
  current: DesktopSurfaceState,
  initialSection: SettingsSection,
  initialSkillName?: string,
): DesktopSurfaceState {
  const returnTo = current.kind === "settings" ? current.returnTo : current.kind
  return {
    initialSection,
    ...(initialSkillName ? { initialSkillName } : {}),
    kind: "settings",
    returnTo,
  }
}

export function closeDesktopSettings(current: DesktopSurfaceState): DesktopSurfaceState {
  return current.kind === "settings" ? { kind: current.returnTo } : current
}
