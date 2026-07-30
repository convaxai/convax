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
    expect(markup).toContain("group my-0.5 flex min-h-8")
    expect(markup).toContain("ring-1 ring-primary/20")
    expect(markup).toContain('aria-label="More actions for Canvas 1"')
  })

  test("filters Canvas rows from the shared sidebar query without changing active ownership", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        controller={controller}
        onActivate={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
        query="Canvas 2"
      />,
    )

    expect(markup).not.toContain('data-project-canvas-id="canvas-1"')
    expect(markup).toContain('data-project-canvas-id="canvas-2"')
  })

  test("shows an explicit empty search result while retaining the Canvas catalog", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        controller={controller}
        onActivate={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
        query="missing"
      />,
    )

    expect(markup).toContain("No matching canvases.")
    expect(markup).toContain('role="status"')
  })
})
