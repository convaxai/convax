import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { ProjectController, ProjectControllerSnapshot } from "./controller"
import { ProjectSidebar } from "./project-sidebar"

const emptySnapshot: ProjectControllerSnapshot = {
  activeCanvasId: null,
  activeProjectId: null,
  canvases: [],
  changingActiveCanvas: false,
  changingActiveProject: false,
  error: null,
  expandedPaths: [],
  initialized: true,
  listings: {},
  loadingPaths: [],
  projects: [],
  selectedPaths: [],
}

const controller = {
  getSnapshot: () => emptySnapshot,
  subscribe: () => () => undefined,
} as unknown as ProjectController

describe("ProjectSidebar", () => {
  test("stays mounted for initialization but renders nothing when the host hides an empty project sidebar", () => {
    const markup = renderToStaticMarkup(<ProjectSidebar controller={controller} hideWhenNoProject />)

    expect(markup).toBe("")
  })
})
