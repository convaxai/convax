import { describe, expect, mock, test } from "bun:test"
import { parsePortablePluginCanvasUiContribution, parsePortablePluginI18n } from "@convax/plugin-sdk"
import { desktopPluginHostProtocolV8 } from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import { DesktopPluginNodeCommandRegistry } from "./plugin-node-command-registry"

const frame = {
  activeRevision: 7,
  activeSetDigest: "a".repeat(64),
  canvasId: "canvas-1",
  nodeId: "node-1",
  pluginId: "generic-plugin",
  pluginVersion: "1.2.3",
  projectId: "project-1",
  snapshotDigest: "b".repeat(64),
}

function contribution() {
  return parsePortablePluginCanvasUiContribution({
    commands: [
      {
        icon: "play",
        id: "preview.play",
        target: { message: "renderer.preview.play", type: "renderer-message" },
        title: { default: "Play preview", "zh-CN": "播放预览" },
      },
      {
        id: "scene.settings",
        target: { message: "renderer.scene.settings", type: "renderer-message" },
        title: { default: "Scene settings", "zh-CN": "场景设置" },
      },
    ],
    menus: [
      {
        command: "scene.settings",
        group: "scene",
        id: "settings-menu",
        order: 20,
        placement: "overflow",
      },
    ],
    toolbar: [{ command: "preview.play", id: "play-toolbar", order: 10 }],
  })
}

describe("DesktopPluginNodeCommandRegistry", () => {
  test("projects toolbar and overflow menu from the same command definitions", () => {
    const frames = new DesktopPluginFrameRegistry()
    frames.register({ ...frame, send: () => undefined })
    const registry = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)
    const projection = registry.project(frame, "zh-CN")

    expect(projection.toolbar).toEqual([
      {
        commandId: "preview.play",
        enabled: true,
        icon: "play",
        label: "播放预览",
        order: 10,
        placementId: "play-toolbar",
      },
    ])
    expect(projection.menu).toEqual([
      {
        commandId: "scene.settings",
        enabled: true,
        group: "scene",
        label: "场景设置",
        order: 20,
        placement: "overflow",
        placementId: "settings-menu",
      },
    ])
  })

  test("resolves command keys through the Plugin resource before the inline fallback", () => {
    const frames = new DesktopPluginFrameRegistry()
    const keyed = parsePortablePluginCanvasUiContribution({
      commands: [
        {
          id: "preview.play",
          target: { message: "renderer.preview.play", type: "renderer-message" },
          title: { default: "Play preview", key: "command.preview.play", "zh-CN": "旧播放文案" },
        },
      ],
      toolbar: [{ command: "preview.play", id: "play-toolbar" }],
    })
    const i18n = parsePortablePluginI18n({
      defaultLocale: "en",
      messages: { en: {}, "zh-CN": { "command.preview.play": "播放新预览" } },
    })
    const registry = new DesktopPluginNodeCommandRegistry(frame.pluginId, keyed, frames, i18n)

    expect(registry.project(frame, "zh-CN").toolbar[0]?.label).toBe("播放新预览")
  })

  test("sends only the command-owned renderer message to the exact captured frame", () => {
    const frames = new DesktopPluginFrameRegistry()
    const send = mock(() => undefined)
    frames.register({ ...frame, send })
    const registry = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)
    const projection = registry.project(frame, "en")

    expect(registry.execute(projection.toolbar[0])).toBe(true)
    expect(send).toHaveBeenCalledWith({
      command: "renderer.preview.play",
      protocol: desktopPluginHostProtocolV8,
      type: "command",
    })
  })

  test("executes an overflow placement through the same command registry", () => {
    const frames = new DesktopPluginFrameRegistry()
    const send = mock(() => undefined)
    frames.register({ ...frame, send })
    const registry = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)
    const projection = registry.project(frame, "en")

    expect(registry.execute(projection.menu[0])).toBe(true)
    expect(send).toHaveBeenCalledWith({
      command: "renderer.scene.settings",
      protocol: desktopPluginHostProtocolV8,
      type: "command",
    })
  })

  test("does not deliver a stale projected command to a replacement frame", () => {
    const frames = new DesktopPluginFrameRegistry()
    const oldSend = mock(() => undefined)
    const disposeOld = frames.register({ ...frame, send: oldSend })
    const registry = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)
    const stale = registry.project(frame, "en").toolbar[0]

    disposeOld()
    const replacementSend = mock(() => undefined)
    frames.register({ ...frame, send: replacementSend })

    expect(registry.execute(stale)).toBe(false)
    expect(oldSend).not.toHaveBeenCalled()
    expect(replacementSend).not.toHaveBeenCalled()
    expect(registry.execute(registry.project(frame, "en").toolbar[0])).toBe(true)
    expect(replacementSend).toHaveBeenCalledTimes(1)
  })

  test("keeps commands visible but disabled until the exact owning frame is mounted", () => {
    const frames = new DesktopPluginFrameRegistry()
    const registry = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)
    const projection = registry.project(frame, "en")

    expect(projection.toolbar[0]?.enabled).toBe(false)
    expect(projection.menu[0]?.enabled).toBe(false)
    expect(registry.execute(projection.menu[0])).toBe(false)
  })

  test("rejects forged projections and registry cross-use", () => {
    const frames = new DesktopPluginFrameRegistry()
    const send = mock(() => undefined)
    frames.register({ ...frame, send })
    const first = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)
    const second = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)
    const projected = first.project(frame, "en").toolbar[0]

    expect(second.execute(projected)).toBe(false)
    expect(
      first.execute({
        ...projected,
        commandId: "scene.settings",
      }),
    ).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  test("cannot project one Plugin's commands onto another Plugin's owning node", () => {
    const frames = new DesktopPluginFrameRegistry()
    const registry = new DesktopPluginNodeCommandRegistry(frame.pluginId, contribution(), frames)

    expect(() => registry.project({ ...frame, pluginId: "another-plugin" }, "en")).toThrow("another Plugin")
  })
})
