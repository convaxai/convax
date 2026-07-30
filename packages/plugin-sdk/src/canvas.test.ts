import { describe, expect, test } from "bun:test"

import { parsePortablePluginCanvasContribution } from "./canvas"

describe("portable Canvas contributions", () => {
  test("normalizes renderer selectors and selection actions", () => {
    const contribution = parsePortablePluginCanvasContribution({
      renderer: { extensions: [".TIMELINE"], mimeTypes: ["Application/X-Timeline"] },
      selectionActions: [
        {
          description: { default: "Inspect video" },
          editor: "confirmation",
          id: "inspect",
          steps: [{ tool: "video.inspect" }],
          target: "video",
          title: { default: "Inspect" },
        },
      ],
    })
    expect(contribution.renderer?.extensions).toEqual([".timeline"])
    expect(contribution.renderer?.mimeTypes).toEqual(["application/x-timeline"])
  })

  test("rejects ownerless UI, duplicate actions, and unknown fields", () => {
    expect(() =>
      parsePortablePluginCanvasContribution({
        renderer: { create: true, secretBridge: true },
      }),
    ).toThrow("unsupported field: secretBridge")
    expect(() =>
      parsePortablePluginCanvasContribution({
        selectionActions: [
          {
            description: { default: "One" },
            editor: "confirmation",
            id: "duplicate",
            steps: [{ tool: "video.one" }],
            target: "video",
            title: { default: "One" },
          },
          {
            description: { default: "Two" },
            editor: "confirmation",
            id: "duplicate",
            steps: [{ tool: "video.two" }],
            target: "video",
            title: { default: "Two" },
          },
        ],
      }),
    ).toThrow("duplicate ids")
  })

  test("admits only the generic immediate cutout presentation combination", () => {
    const action = {
      description: {
        default: "Create a transparent image beside the selection",
        "zh-CN": "在选中图片旁创建透明图片",
      },
      editor: "immediate",
      id: "remove-background",
      presentation: "cutout-scan",
      steps: [{ tool: "image.background-remove" }],
      target: "image",
      title: { default: "Remove background", "zh-CN": "抠图" },
    } as const

    expect(parsePortablePluginCanvasContribution({ selectionActions: [action] }).selectionActions?.[0]).toEqual(action)

    for (const invalid of [
      { ...action, editor: "confirmation" },
      { ...action, presentation: undefined },
      { ...action, presentation: "provider-animation" },
      { ...action, target: "video" },
    ]) {
      expect(() => parsePortablePluginCanvasContribution({ selectionActions: [invalid] })).toThrow(
        "immediate editor requires image target and cutout-scan presentation",
      )
    }
  })
})
