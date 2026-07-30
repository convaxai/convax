import { describe, expect, test } from "bun:test"

import { parsePortablePluginCanvasUiContribution, portablePluginUiIconTokens } from "./ui"

function contribution() {
  return {
    commands: [
      {
        icon: "play",
        id: "preview.play",
        target: { message: "player.play", type: "renderer-message" },
        title: { default: "Play preview", "zh-CN": "播放预览" },
      },
      {
        id: "scene.settings",
        target: { message: "scene.settings.open", type: "renderer-message" },
        title: { default: "Scene settings" },
      },
    ],
    menus: [
      {
        command: "scene.settings",
        group: "scene",
        id: "scene-settings-menu",
        order: 20,
        placement: "overflow",
      },
    ],
    toolbar: [{ command: "preview.play", id: "preview-play-toolbar", order: 10 }],
  }
}

describe("portable Plugin Canvas UI commands", () => {
  test("normalizes one command registry shared by toolbar and owning-node overflow placements", () => {
    const parsed = parsePortablePluginCanvasUiContribution(contribution())

    expect(parsed.commands[0]).toEqual({
      icon: "play",
      id: "preview.play",
      target: { message: "player.play", type: "renderer-message" },
      title: { default: "Play preview", "zh-CN": "播放预览" },
    })
    expect(parsed.toolbar).toEqual([{ command: "preview.play", id: "preview-play-toolbar", order: 10 }])
    expect(parsed.menus).toEqual([
      {
        command: "scene.settings",
        group: "scene",
        id: "scene-settings-menu",
        order: 20,
        placement: "overflow",
      },
    ])
    expect(Object.isFrozen(parsed)).toBeTrue()
    expect(Object.isFrozen(parsed.commands[0].target)).toBeTrue()
    expect(Object.isFrozen(parsed.commands[0].title)).toBeTrue()
    expect(portablePluginUiIconTokens).not.toContain("svg")
  })

  test("rejects unknown command references and duplicate command or placement identities", () => {
    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        toolbar: [{ command: "missing.command", id: "missing-toolbar" }],
      }),
    ).toThrow("unknown command")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        commands: [contribution().commands[0], contribution().commands[0]],
      }),
    ).toThrow("duplicate id")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        menus: [
          {
            command: "scene.settings",
            id: "shared-placement",
            placement: "overflow",
          },
        ],
        toolbar: [{ command: "preview.play", id: "shared-placement" }],
      }),
    ).toThrow("duplicate id")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        toolbar: [
          { command: "preview.play", id: "preview-play-a" },
          { command: "preview.play", id: "preview-play-b" },
        ],
      }),
    ).toThrow("duplicate command reference")
  })

  test("rejects arbitrary Host targets, global placements, presentation drift, and executable icons", () => {
    expect(() =>
      parsePortablePluginCanvasUiContribution({
        commands: [
          {
            id: "dangerous",
            target: { function: "filesystem.delete", type: "host-function" },
            title: { default: "Dangerous" },
          },
        ],
      }),
    ).toThrow("renderer-message")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        menus: [
          {
            command: "scene.settings",
            id: "global-menu",
            placement: "application-menu",
          },
        ],
      }),
    ).toThrow("overflow")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        toolbar: [
          {
            command: "preview.play",
            id: "drifting-toolbar",
            title: "A second title",
          },
        ],
      }),
    ).toThrow("unsupported or missing fields")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        commands: [
          {
            icon: "<svg onload=alert(1)>",
            id: "preview.play",
            target: { message: "player.play", type: "renderer-message" },
            title: { default: "Play preview" },
          },
        ],
      }),
    ).toThrow("Host icon token")
  })

  test("rejects unbounded fields, malformed ids, duplicate surface references, and unknown fields", () => {
    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        commands: [
          {
            id: "Preview Play",
            target: { message: "player.play", type: "renderer-message" },
            title: { default: "Play preview" },
          },
        ],
      }),
    ).toThrow("stable Plugin-local id")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        menus: [
          { command: "scene.settings", id: "settings-a", placement: "overflow" },
          { command: "scene.settings", id: "settings-b", placement: "overflow" },
        ],
      }),
    ).toThrow("duplicate command reference")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        commands: contribution().commands.map((command) => ({
          ...command,
          target: { ...command.target, message: "x".repeat(129) },
        })),
      }),
    ).toThrow("bounded, trimmed string")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        ...contribution(),
        globalMenus: [],
      }),
    ).toThrow("unsupported or missing fields")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        commands: null,
      }),
    ).toThrow("bounded array")

    expect(() =>
      parsePortablePluginCanvasUiContribution({
        commands: [
          {
            id: "unused.command",
            target: { message: "unused", type: "renderer-message" },
            title: { default: "Unused" },
          },
        ],
      }),
    ).toThrow("no owning-node placement")
  })
})
