import { describe, expect, mock, test } from "bun:test"
import type { ProjectFilesController, ProjectFilesControllerSnapshot } from "@convax/project-files"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
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
  projects: [
    {
      createdAt: 1,
      id: "project-1",
      lastOpenedAt: 1,
      name: "Example",
      rootPath: "/project",
    },
  ],
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

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    MouseEvent: testWindow.MouseEvent,
    Node: testWindow.Node,
    document: testWindow.document,
    localStorage: testWindow.localStorage,
    window: testWindow,
  })) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

describe("ProjectSidebar", () => {
  test("stays mounted for initialization but renders nothing when the host hides an empty project sidebar", () => {
    const markup = renderToStaticMarkup(
      <ProjectSidebar controller={controller} filesController={filesController} hideWhenNoProject />,
    )

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
    expect(markup).toContain('data-project-sidebar-footer=""')
    expect(markup).toContain("mt-auto min-w-0 shrink-0 overflow-hidden")
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
            entries: [
              {
                kind: "file",
                modifiedAt: 1,
                name: "stale.md",
                parentPath: "",
                path: "stale.md",
                size: 10,
              },
            ],
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

  test("offers the compact Canvas-over-Project hierarchy without replacing Project ownership", () => {
    const markup = renderToStaticMarkup(
      <ProjectSidebar
        controller={
          {
            getSnapshot: () => activeSnapshot,
            subscribe: () => () => undefined,
          } as unknown as ProjectController
        }
        extension={{
          content: ({ query }) => <div data-canvas-query={query}>Canvas region</div>,
          label: "Canvases",
        }}
        filesController={
          {
            getSnapshot: () => activeFilesSnapshot,
            subscribe: () => () => undefined,
          } as unknown as ProjectFilesController
        }
        presentation="workspace"
        searchLabel="Search sidebar"
      />,
    )

    expect(markup).toContain('aria-label="Search sidebar"')
    expect(markup).toContain('data-project-sidebar-presentation="workspace"')
    expect(markup).toContain('data-project-sidebar-section="canvas"')
    expect(markup).toContain('data-project-sidebar-section="project"')
    expect(markup).toContain("bg-surface-panel")
    expect(markup).toContain("Canvas region")
    expect(markup.indexOf(">Canvas<")).toBeLessThan(markup.indexOf(">Project<"))
    expect(markup).toContain('aria-label="Resize Canvas and Project sections"')
    expect(markup).toContain('aria-label="Rename Example"')
    expect(markup).toContain('data-canvas-query=""')
  })

  test("restores asynchronous media thumbnails, hover previews, and host-owned file activation", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    const imageEntry = {
      kind: "file" as const,
      modifiedAt: 7,
      name: "reference.png",
      parentPath: "",
      path: "Media/reference.png",
      size: 128,
    }
    const largeVideoEntry = {
      kind: "file" as const,
      modifiedAt: 8,
      name: "source.mp4",
      parentPath: "",
      path: "Media/source.mp4",
      size: 9 * 1024 * 1024,
    }
    const selectEntry = mock(() => undefined)
    const onFileActivate = mock(() => undefined)
    const resolveFileUrl = mock(async () => "data:image/png;base64,cHJldmlldw==")
    const filesSnapshot: ProjectFilesControllerSnapshot = {
      ...activeFilesSnapshot,
      listings: {
        "": {
          entries: [imageEntry, largeVideoEntry],
          path: "",
          projectId: "project-1",
        },
      },
    }
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectSidebar
            controller={
              {
                getSnapshot: () => activeSnapshot,
                initialize: async () => undefined,
                subscribe: () => () => undefined,
              } as unknown as ProjectController
            }
            filesController={
              {
                getSnapshot: () => filesSnapshot,
                selectEntry,
                subscribe: () => () => undefined,
              } as unknown as ProjectFilesController
            }
            onFileActivate={onFileActivate}
            presentation="workspace"
            resolveFileUrl={resolveFileUrl}
          />,
        ),
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      const row = container.querySelector<HTMLElement>('[data-project-entry-path="Media/reference.png"]')!
      const thumbnail = row.querySelector<HTMLImageElement>("img")
      expect(thumbnail?.src).toBe("data:image/png;base64,cHJldmlldw==")
      expect(resolveFileUrl).toHaveBeenCalledTimes(1)
      expect(
        container.querySelector<HTMLElement>('[data-project-entry-path="Media/source.mp4"]')?.querySelector("video"),
      ).toBeNull()

      await act(async () => row.click())
      expect(selectEntry).toHaveBeenCalledWith("Media/reference.png", { range: false, toggle: false })
      expect(onFileActivate).toHaveBeenCalledWith({ entry: imageEntry, projectId: "project-1" })

      await act(async () => {
        row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
        await Bun.sleep(140)
      })
      expect(document.querySelector('[data-project-file-preview="Media/reference.png"]')).not.toBeNull()
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })
})
