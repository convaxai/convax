import { expect, mock, test } from "bun:test"

import { DesktopMarketplaceCapabilityInstaller } from "./marketplace-capability-installer"

function fixture() {
  const hardRefreshPlugin = mock(async () => undefined)
  const refreshPetProvider = mock(async () => undefined)
  const scheduleStartupRefresh = mock(() => undefined)
  const installer = new DesktopMarketplaceCapabilityInstaller({
    authorizePlugin: async () => null,
    currentPluginAuthorization: async () => null,
    disablePlugin: async () => undefined,
    enablePlugin: async () => undefined,
    fetchArtifact: async () => new Uint8Array(),
    hardRefreshPlugin,
    installLocalPlugin: async () => undefined,
    installLocalSkill: async () => undefined,
    mcp: { hardRefresh: async () => undefined } as never,
    refreshPetProvider,
    remote: {} as never,
    resolveInstalledTransition: async () => "unknown",
    resolvePackage: async () => {
      throw new Error("not used")
    },
    scheduleStartupRefresh,
    uninstallPlugin: async () => undefined,
    uninstallSkill: async () => undefined,
    verifyPluginAuthorization: async () => false,
  })
  return { hardRefreshPlugin, installer, refreshPetProvider, scheduleStartupRefresh }
}

test("refreshes Pet discovery after a committed Marketplace Plugin lifecycle change", async () => {
  const value = fixture()

  await value.installer.hardRefresh({ id: "soft-companion", kind: "plugin" })

  expect(value.hardRefreshPlugin).toHaveBeenCalledTimes(1)
  expect(value.hardRefreshPlugin).toHaveBeenCalledWith("soft-companion")
  expect(value.refreshPetProvider).toHaveBeenCalledWith("soft-companion")
})

test("forwards one non-blocking startup refresh for the committed Plugin and Skill batch", () => {
  const value = fixture()

  value.installer.scheduleStartupRefresh([
    { id: "canvas-storyboard", kind: "skill" },
    { id: "ffmpeg-tools", kind: "plugin" },
    { id: "ignored", kind: "mcp-server" },
  ])

  expect(value.scheduleStartupRefresh).toHaveBeenCalledWith([
    { id: "canvas-storyboard", kind: "skill" },
    { id: "ffmpeg-tools", kind: "plugin" },
  ])
})

test("does not refresh Pet discovery for standalone Skill or MCP lifecycle changes", async () => {
  const value = fixture()

  await value.installer.hardRefresh({ id: "canvas-storyboard", kind: "skill" })
  await value.installer.hardRefresh({ id: "io.example/server", kind: "mcp-server" })

  expect(value.refreshPetProvider).not.toHaveBeenCalled()
})
