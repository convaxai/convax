import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CanvasInspector } from "./canvas-inspector"

describe("CanvasInspector", () => {
  test("renders a compact read-only semantic projection without controls", () => {
    const markup = renderToStaticMarkup(
      <CanvasInspector
        projection={{
          description: "A source frame",
          documentId: "canvas",
          kind: "node",
          label: "Frame",
          nodeId: "frame",
          nodeKind: "image",
          rendererId: "image",
          scopeId: "scope",
          sections: [
            {
              fields: [{ id: "name", label: "Name", value: "frame.png" }],
              id: "resource",
              label: "Resource",
            },
          ],
          status: "idle",
          viewId: "view",
        }}
      />,
    )

    expect(markup).toContain('aria-label="Frame inspector"')
    expect(markup).toContain('data-read-only=""')
    expect(markup).toContain("<dt")
    expect(markup).toContain("<dd")
    expect(markup).not.toContain("<button")
    expect(markup).not.toContain("<input")
  })
})
