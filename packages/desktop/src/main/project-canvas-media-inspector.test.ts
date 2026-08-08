import { describe, expect, mock, test } from "bun:test"
import { createProjectCanvasMediaInspector } from "./project-canvas-media-inspector"

describe("Project Canvas media inspector", () => {
  test("decodes the admitted Project resource before Canvas creation", async () => {
    const createFromBuffer = mock((_bytes: Buffer) => ({
      getSize: () => ({ height: 900, width: 1_600 }),
      isEmpty: () => false,
    }))
    const inspector = createProjectCanvasMediaInspector({
      decoder: { createFromBuffer },
    })

    const result = await inspector.inspect({
      bytes: new TextEncoder().encode("image"),
      kind: "image",
      mimeType: "image/png",
      name: "hero.png",
    })

    expect(result).toEqual({ height: 900, width: 1_600 })
    expect(createFromBuffer).toHaveBeenCalledTimes(1)
  })
})
