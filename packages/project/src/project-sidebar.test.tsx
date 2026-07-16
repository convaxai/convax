import { describe, expect, test } from "bun:test"
import type { ProjectFilesController, ProjectFilesControllerSnapshot } from "@convax/project-files"
import { renderToStaticMarkup } from "react-dom/server"
import type { ProjectController, ProjectControllerSnapshot } from "./controller"
import { ProjectSidebar } from "./project-sidebar"

const emptySnapshot: ProjectControllerSnapshot = {
  activeProjectId: null,
  changingActiveProject: false,
  error: null,
  initialized: true,
  projects: [],
}

const emptyFilesSnapshot: ProjectFilesControllerSnapshot = {
  error: null,
  expandedPaths: [],
  listings: {},
  loadingPaths: [],
  projectId: null,
  selectedPaths: [],
}

const controller = {
  getSnapshot: () => emptySnapshot,
  subscribe: () => () => undefined,
} as unknown as ProjectController

const filesController = {
  getSnapshot: () => emptyFilesSnapshot,
  subscribe: () => () => undefined,
} as unknown as ProjectFilesController

describe("ProjectSidebar", () => {
  test("stays mounted for initialization but renders nothing when the host hides an empty project sidebar", () => {
    const markup = renderToStaticMarkup(<ProjectSidebar controller={controller} filesController={filesController} hideWhenNoProject />)

    expect(markup).toBe("")
  })
})
