import { describe, expect, test } from "bun:test"
import { applicationCommandMenuItems } from "./application-command-palette"

describe("ApplicationCommandPalette", () => {
  test("projects explicit commands without turning presentation into a registry", () => {
    const items = applicationCommandMenuItems([
      {
        group: "canvas",
        id: "canvas.search",
        keywords: ["node"],
        label: "Search current Canvas",
        run: () => undefined,
        shortcut: "⌘F",
      },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      description: "Canvas",
      id: "canvas.search",
      keywords: ["canvas", "node"],
      label: "Search current Canvas",
      shortcut: "⌘F",
    })
  })
})
