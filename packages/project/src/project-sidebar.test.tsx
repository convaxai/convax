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

const activeSnapshot: ProjectControllerSnapshot = {
  ...emptySnapshot,
  activeProjectId: "project-1",
  projects: [{
    createdAt: 1,
    id: "project-1",
    lastOpenedAt: 1,
    name: "Example",
    rootPath: "/project",
  }],
}

const activeFilesSnapshot: ProjectFilesControllerSnapshot = {
  ...emptyFilesSnapshot,
  listings: {
    "": {
      entries: [],
      path: "",
      projectId: "project-1",
    },
  },
  projectId: "project-1",
}

describe("ProjectSidebar", () => {
  test("stays mounted for initialization but renders nothing when the host hides an empty project sidebar", () => {
    const markup = renderToStaticMarkup(<ProjectSidebar controller={controller} filesController={filesController} hideWhenNoProject />)

    expect(markup).toBe("")
  })

  test("leaves application-specific footer actions to the host", () => {
    const activeController = {
      getSnapshot: () => activeSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectController
    const activeFilesController = {
      getSnapshot: () => activeFilesSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectFilesController

    const markup = renderToStaticMarkup(
      <ProjectSidebar
        controller={activeController}
        filesController={activeFilesController}
        footerActions={<button type="button">Application settings</button>}
      />,
    )

    expect(markup).toContain("Application settings")
    const pathIndex = markup.indexOf('data-project-header-path="/project"')
    expect(pathIndex).toBeGreaterThan(-1)
    expect(pathIndex).toBeLessThan(markup.indexOf('aria-label="Example files"'))
    expect(markup).toContain('aria-label="Project path: /project"')
    expect(markup).not.toContain('aria-label="Open folder"')
  })

  test("keeps Files and an injected capability in the original vertical split", () => {
    const activeController = {
      getSnapshot: () => activeSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectController
    const activeFilesController = {
      getSnapshot: () => activeFilesSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectFilesController

    const markup = renderToStaticMarkup(
      <ProjectSidebar
        controller={activeController}
        extension={{
          content: <div>Canvas catalog projection</div>,
          count: 2,
          label: "Canvases",
        }}
        filesController={activeFilesController}
      />,
    )

    expect(markup.indexOf(">Files<")).toBeLessThan(markup.indexOf(">Canvases<"))
    expect(markup).toContain('aria-label="Resize Files and Canvases sections"')
    expect(markup).toContain("Canvas catalog projection")
    expect(markup).not.toContain('role="tablist"')
  })

  test("embeds the original file capability without Project switcher or host footer chrome", () => {
    const activeController = {
      getSnapshot: () => activeSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectController
    const activeFilesController = {
      getSnapshot: () => activeFilesSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectFilesController

    const markup = renderToStaticMarkup(
      <ProjectSidebar
        controller={activeController}
        extension={{
          content: <div>Should not be embedded</div>,
          label: "Canvases",
        }}
        filesController={activeFilesController}
        footerActions={<button type="button">Application settings</button>}
        presentation="embedded-files"
      />,
    )

    expect(markup).toContain('data-project-files-view="embedded"')
    expect(markup).toContain('aria-label="Example files"')
    expect(markup).toContain('aria-label="New file"')
    expect(markup).toContain('aria-label="New folder"')
    expect(markup).toContain('aria-label="Refresh files"')
    expect(markup).not.toContain('data-project-header-path="/project"')
    expect(markup).not.toContain("Application settings")
    expect(markup).not.toContain("Should not be embedded")
  })

  test("does not expose a stale file projection after the active Project changes", () => {
    const activeController = {
      getSnapshot: () => activeSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectController
    const staleFilesController = {
      getSnapshot: () => ({
        ...activeFilesSnapshot,
        listings: {
          "": {
            entries: [{
              kind: "file",
              modifiedAt: 1,
              name: "stale.md",
              parentPath: "",
              path: "stale.md",
              size: 10,
            }],
            path: "",
            projectId: "old-project",
          },
        },
        projectId: "old-project",
      }),
      subscribe: () => () => undefined,
    } as unknown as ProjectFilesController

    const markup = renderToStaticMarkup(
      <ProjectSidebar
        controller={activeController}
        filesController={staleFilesController}
        presentation="embedded-files"
      />,
    )

    expect(markup).toContain('aria-label="Example files"')
    expect(markup).not.toContain("stale.md")
  })
})
