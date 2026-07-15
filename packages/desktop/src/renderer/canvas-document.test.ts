import { describe, expect, test } from "bun:test"
import { createInitialCanvasDocument } from "./canvas-document"

describe("initial canvas document", () => {
  test("starts a project canvas without starter nodes", () => {
    const document = createInitialCanvasDocument({
      canvasId: "canvas-new",
      canvasName: "Canvas 2",
      projectName: "Example",
    })

    expect(document).toMatchObject({
      id: "canvas-new",
      metadata: { title: "Canvas 2" },
      revision: 0,
    })
    expect(document.nodes).toEqual([])
    expect(document.edges).toEqual([])
  })
})
