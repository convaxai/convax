import { describe, expect, test } from "bun:test"
import type { ProjectCanvasController, ProjectCanvasControllerSnapshot } from "@convax/project/canvas"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectCanvasSidebar } from "./project-canvas-sidebar"

const snapshot: ProjectCanvasControllerSnapshot = {
  busy: false,
  canvases: [
    { createdAt: 1, id: "canvas-1", name: "Canvas 1", updatedAt: 1 },
    { createdAt: 2, id: "canvas-2", name: "Canvas 2", updatedAt: 2 },
  ],
  error: null,
  projectId: "project-1",
}

const controller = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
} as unknown as ProjectCanvasController

describe("ProjectCanvasSidebar", () => {
  test("renders the active canvas with vertical breathing room", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        controller={controller}
        onActivate={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    )

    expect(markup).toContain('data-project-canvas-id="canvas-1"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain("group my-0.5 flex h-8")
  })
})
