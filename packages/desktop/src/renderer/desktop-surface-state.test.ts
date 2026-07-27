import { describe, expect, test } from "bun:test"
import {
  closeDesktopSettings,
  createDesktopSurfaceState,
  openDesktopHome,
  openDesktopSettings,
  openDesktopWorkspace,
} from "./desktop-surface-state"

describe("Desktop surface state", () => {
  test("starts at Home without inventing project or canvas state", () => {
    expect(createDesktopSurfaceState()).toEqual({ kind: "home" })
  })

  test("opens Home and returns to Workspace without embedding domain state", () => {
    const home = openDesktopHome(openDesktopWorkspace(createDesktopSurfaceState()))
    expect(home).toEqual({ kind: "home" })
    expect(openDesktopWorkspace(home)).toEqual({ kind: "workspace" })
  })

  test("opens a Settings section and returns to the previous surface", () => {
    const home = openDesktopHome(createDesktopSurfaceState())
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
})
