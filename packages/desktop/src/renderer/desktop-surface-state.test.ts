import { describe, expect, test } from "bun:test"
import {
  closeDesktopSettings,
  createDesktopSurfaceState,
  openDesktopSettings,
  openDesktopWorkspace,
} from "./desktop-surface-state"

describe("Desktop surface state", () => {
  test("starts in the Project bootstrap surface without inventing domain state", () => {
    expect(createDesktopSurfaceState()).toEqual({ kind: "home" })
  })

  test("commits Workspace without embedding Project or Canvas state", () => {
    expect(openDesktopWorkspace(createDesktopSurfaceState())).toEqual({ kind: "workspace" })
  })

  test("opens a Settings section and returns to the previous surface", () => {
    const home = createDesktopSurfaceState()
    const settings = openDesktopSettings(home, "capabilities", "storyboard")

    expect(settings).toEqual({
      initialSection: "capabilities",
      initialSkillName: "storyboard",
      kind: "settings",
      returnTo: "home",
    })
    expect(closeDesktopSettings(settings)).toEqual({ kind: "home" })
  })

  test("replaces Settings targets without losing the original return surface", () => {
    const first = openDesktopSettings(openDesktopWorkspace(createDesktopSurfaceState()), "general")
    const second = openDesktopSettings(first, "services")

    expect(second).toEqual({
      initialSection: "services",
      kind: "settings",
      returnTo: "workspace",
    })
    expect(closeDesktopSettings(second)).toEqual({ kind: "workspace" })
  })

  test("carries a concrete Service target into Settings", () => {
    expect(openDesktopSettings(createDesktopSurfaceState(), "services", undefined, "plugin:account-tools")).toEqual({
      initialSection: "services",
      initialServiceId: "plugin:account-tools",
      kind: "settings",
      returnTo: "home",
    })
  })
})
