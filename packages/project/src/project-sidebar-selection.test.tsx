import { describe, expect, test } from "bun:test"
import type { ProjectFilesController, ProjectFilesControllerSnapshot } from "@convax/project-files"
import { renderToStaticMarkup } from "react-dom/server"
import type { ProjectController, ProjectControllerSnapshot } from "./controller"
import { ProjectSidebar } from "./project-sidebar"

const projectSnapshot: ProjectControllerSnapshot = {
  activeProjectId: "project-1",
  changingActiveProject: false,
  error: null,
  initialized: true,
  pendingRecoveryProjectId: null,
  projects: [{
    createdAt: 1,
    id: "project-1",
    lastOpenedAt: 1,
    name: "Example",
    rootPath: "/project",
  }],
}

const filesSnapshot: ProjectFilesControllerSnapshot = {
  error: null,
  expandedPaths: [],
  listings: {
    "": {
      entries: [{
        kind: "file",
        modifiedAt: 1,
        name: "notes.md",
        parentPath: "",
        path: "notes.md",
        size: 42,
      }],
      path: "",
      projectId: "project-1",
    },
  },
  loadingPaths: [],
  projectId: "project-1",
  selectedPaths: ["notes.md"],
}

const controller = {
  getSnapshot: () => projectSnapshot,
  subscribe: () => () => undefined,
} as unknown as ProjectController

const filesController = {
  getSnapshot: () => filesSnapshot,
  subscribe: () => () => undefined,
} as unknown as ProjectFilesController

describe("ProjectSidebar selection styling", () => {
  test("keeps selected rows inset and leaves the application identity to the footer", () => {
    const markup = renderToStaticMarkup(
      <ProjectSidebar controller={controller} filesController={filesController} />,
    )

    expect(markup).toContain('data-project-entry-path="notes.md"')
    expect(markup).toContain("group my-0.5 flex h-7")
    expect(markup).not.toContain(">CX</span>")
  })
})
