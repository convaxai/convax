import { describe, expect, test } from "bun:test"
import { canvasCommandCapabilities, getCanvasCommandCapability } from "./capabilities"

describe("canvas command capability catalog", () => {
  test("makes business operations the default Agent surface and keeps primitives explicit", () => {
    expect(canvasCommandCapabilities.map((capability) => capability.commandType)).toEqual([
      "document.patch",
      "canvas.auto-layout",
      "resources.add",
      "elements.remove",
      "nodes.align",
      "nodes.connect",
      "nodes.distribute",
      "nodes.group",
      "nodes.layout",
      "nodes.move",
      "nodes.setGeometry",
      "nodes.ungroup",
    ])
    expect(getCanvasCommandCapability("resources.add")).toMatchObject({
      defaultForAgent: true,
      layer: "business",
    })
    expect(getCanvasCommandCapability("canvas.auto-layout")).toMatchObject({
      defaultForAgent: true,
      layer: "business",
    })
    expect(canvasCommandCapabilities.filter((capability) => capability.layer === "primitive")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commandType: "document.patch", defaultForAgent: false }),
        expect.objectContaining({ commandType: "nodes.move", defaultForAgent: false }),
        expect.objectContaining({ commandType: "elements.remove", defaultForAgent: false }),
      ]),
    )
    expect(new Set(canvasCommandCapabilities.map((capability) => capability.commandType)).size).toBe(
      canvasCommandCapabilities.length,
    )
  })
})
