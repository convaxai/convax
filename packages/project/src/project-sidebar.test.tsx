import { describe, expect, mock, test } from "bun:test"
import {
  parseProjectEntryDrag,
  PROJECT_ENTRY_DRAG_TYPE,
  type ProjectFilesController,
  type ProjectFilesControllerSnapshot,
} from "@convax/project-files"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import type { ProjectController, ProjectControllerSnapshot } from "./controller"
import { fitProjectFilename } from "./project-filename"
import { ProjectSidebar } from "./project-sidebar"
import {
  captureProjectImageThumbnail,
  captureProjectVideoThumbnail,
  type ProjectFilePreviewHandle,
} from "./project-sidebar-items"

const emptySnapshot: ProjectControllerSnapshot = {
  activeProjectId: null,
  changingActiveProject: false,
  error: null,
  initialized: true,
  pendingRecoveryProjectId: null,
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
    expect(markup).toContain('aria-label="Add file or folder"')
    expect(markup.match(/aria-label="Add file or folder"/g)).toHaveLength(1)
    expect(markup).not.toContain('aria-label="New file"')
    expect(markup).not.toContain('aria-label="New folder"')
    expect(markup).toContain('aria-label="Refresh files"')
    expect(markup).not.toContain('data-project-header-path="/project"')
    expect(markup).not.toContain("Application settings")
    expect(markup).not.toContain("Should not be embedded")
  })

  test("renders a single contiguous filename label that can be measured for middle ellipsis", async () => {
    const filename = "generated-84ad9857-8490-4faf-891f-f9bda25a8551.jpg"
    const directoryName = "a-very-long-directory-name-that-keeps-end-ellipsis"
    const snapshot: ProjectFilesControllerSnapshot = {
      ...activeFilesSnapshot,
      listings: {
        "": {
          entries: [
            {
              kind: "directory",
              modifiedAt: 1,
              name: directoryName,
              parentPath: "",
              path: directoryName,
              size: 0,
            },
            {
              kind: "file",
              modifiedAt: 2,
              name: filename,
              parentPath: "",
              path: filename,
              size: 128,
            },
          ],
          path: "",
          projectId: "project-1",
        },
      },
    }
    const markup = renderToStaticMarkup(
      <ProjectSidebar
        controller={
          {
            getSnapshot: () => activeSnapshot,
            subscribe: () => () => undefined,
          } as unknown as ProjectController
        }
        filesController={
          {
            getSnapshot: () => snapshot,
            subscribe: () => () => undefined,
          } as unknown as ProjectFilesController
        }
        presentation="workspace"
      />,
    )
    const testWindow = new Window({ url: "https://convax.test/" })
    try {
      testWindow.document.body.innerHTML = markup
      const fileRow = testWindow.document.querySelector(`[data-project-entry-path="${filename}"]`)
      const displayName = fileRow?.querySelector("[data-project-filename]") as HTMLElement | null | undefined
      const visibleName = displayName?.querySelector("[data-project-filename-visible]") as
        | HTMLElement
        | null
        | undefined

      expect(displayName?.getAttribute("aria-label")).toBe(filename)
      expect(displayName?.getAttribute("title")).toBe(filename)
      expect(visibleName?.textContent).toBe(filename)
      expect(displayName?.querySelectorAll("[data-project-filename-visible]")).toHaveLength(1)
      expect(
        testWindow.document
          .querySelector(`[data-project-entry-path="${directoryName}"]`)
          ?.querySelector("[data-project-filename]"),
      ).toBeNull()
    } finally {
      await testWindow.happyDOM.close()
    }
  })

  test("keeps the complete filename when it fits and otherwise removes only the middle", () => {
    const filename = "generated-84ad9857-8490-4faf-891f-f9bda25a8551.jpg"
    const measureText = (value: string) => value.length * 10

    expect(fitProjectFilename(filename, measureText(filename), measureText)).toBe(filename)
    const compactName = fitProjectFilename(filename, 240, measureText)
    expect(compactName.startsWith("gene")).toBe(true)
    expect(compactName).toContain("…")
    expect(compactName.endsWith("5a8551.jpg")).toBe(true)
    expect(measureText(compactName)).toBeLessThanOrEqual(240)
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

  test("offers the compact Project-files-over-Canvas hierarchy without a redundant Canvas collapse control", () => {
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
    expect(markup).toContain("border-b border-border-subtle")
    expect(markup).toContain("Canvas region")
    expect(markup.indexOf(">Project files<")).toBeLessThan(markup.indexOf(">Canvas<"))
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-label="Resize Project files and Canvas sections"')
    expect(markup).toContain('aria-valuetext="50% — Project files"')
    expect(markup).not.toContain('aria-label="Collapse Canvases"')
    expect(markup).not.toContain('aria-label="Expand Canvases"')
    expect(markup).toContain('aria-valuenow="50"')
    expect(markup).toContain('aria-label="Open project folder"')
    expect(markup).toContain('aria-label="Add file or folder"')
    expect(markup.match(/aria-label="Add file or folder"/g)).toHaveLength(1)
    expect(markup).not.toContain('aria-label="Refresh files"')
    expect(markup).toContain('aria-label="Rename Example"')
    expect(markup).toContain('data-project-sidebar-project-actions=""')
    expect(markup).toContain('data-canvas-query=""')
  })

  test("keeps the splitter allocation when the Project files section is collapsed", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    const directoryEntry = {
      kind: "directory" as const,
      modifiedAt: 1,
      name: "Media",
      parentPath: "",
      path: "Media",
    }
    const workspaceFilesSnapshot: ProjectFilesControllerSnapshot = {
      ...activeFilesSnapshot,
      listings: {
        "": {
          entries: [directoryEntry],
          path: "",
          projectId: "project-1",
        },
      },
    }
    let root: Root | undefined
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
            extension={{ content: <div>Canvas region</div>, label: "Canvases" }}
            filesController={
              {
                getSnapshot: () => workspaceFilesSnapshot,
                selectEntry: () => undefined,
                subscribe: () => () => undefined,
                toggleDirectory: async () => undefined,
              } as unknown as ProjectFilesController
            }
            presentation="workspace"
          />,
        ),
      )

      const projectRow = container.querySelector<HTMLElement>('[data-project-entry-path="Media"]')
      expect(projectRow?.className).toContain("h-7")
      expect(projectRow?.className).not.toContain("pl-4")
      expect(projectRow?.className).toContain("text-[13px]")
      expect(projectRow?.className).toContain("hover:bg-interactive-hover")
      expect(projectRow?.querySelector<HTMLElement>("[data-project-tree-indent]")?.style.width).toBe("16px")
      expect(projectRow?.querySelector<HTMLButtonElement>('button[aria-label="Expand Media"]')?.className).toContain(
        "size-6",
      )
      expect(projectRow?.querySelector('button[aria-label="More actions for Media"]')).not.toBeNull()
      const collapsedProjectSplitter = container.querySelector<HTMLElement>("[data-project-sidebar-splitter]")
      expect(collapsedProjectSplitter?.getAttribute("aria-disabled")).toBeNull()
      expect(collapsedProjectSplitter?.tabIndex).toBe(0)
      await act(async () =>
        collapsedProjectSplitter?.dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
        ),
      )
      expect(collapsedProjectSplitter?.getAttribute("aria-valuenow")).toBe("55")

      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[data-project-sidebar-section="project"] button[aria-expanded="true"]')
          ?.click(),
      )

      const splitter = container.querySelector<HTMLElement>("[data-project-sidebar-splitter]")
      expect(splitter?.getAttribute("aria-label")).toBe("Resize Project files and Canvas sections")
      expect(splitter?.getAttribute("aria-disabled")).toBeNull()
      expect(splitter?.getAttribute("aria-valuenow")).toBe("55")
      expect(splitter?.tabIndex).toBe(0)
      expect(splitter?.querySelector(".bg-brand")).not.toBeNull()
      expect(container.querySelector<HTMLElement>('[data-project-sidebar-section="canvas"]')?.style.flex).toBe(
        "0.45 1 0px",
      )
      expect(container.querySelector('[data-project-entry-path="Media"]')).toBeNull()
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
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
    const openEntry = mock(async () => undefined)
    const onFileActivate = mock(() => undefined)
    const resolveFileThumbnailUrl = mock(() => {
      throw new Error("The preview lease must own production image thumbnail decoding")
    })
    const releasePreview = mock(async () => undefined)
    const openFilePreview = mock(async ({ path }: { path: string; projectId: string; purpose: string }) => ({
      release: releasePreview,
      url: `convax-project-preview://lease/stream?path=${encodeURIComponent(path)}`,
    }))
    const originalCreateElement = document.createElement.bind(document)
    const drawImage = mock(() => undefined)
    Object.defineProperty(document, "createElement", {
      configurable: true,
      value: (name: string, options?: ElementCreationOptions) => {
        if (name === "canvas") {
          return {
            getContext: () => ({ drawImage }),
            height: 0,
            toDataURL: () => "data:image/jpeg;base64,bW91bnQtY292ZXI=",
            width: 0,
          } as unknown as HTMLCanvasElement
        }
        const element = originalCreateElement(name, options)
        if (name === "video") {
          Object.defineProperties(element, {
            load: {
              configurable: true,
              value: () => queueMicrotask(() => element.dispatchEvent(new Event("loadeddata"))),
            },
            videoHeight: { configurable: true, value: 720 },
            videoWidth: { configurable: true, value: 1_280 },
          })
        }
        if (name === "img") {
          Object.defineProperties(element, {
            naturalHeight: { configurable: true, value: 900 },
            naturalWidth: { configurable: true, value: 1_600 },
          })
          queueMicrotask(() => element.dispatchEvent(new Event("load")))
        }
        return element
      },
    })
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
                openEntry,
                selectEntry,
                subscribe: () => () => undefined,
              } as unknown as ProjectFilesController
            }
            onFileActivate={onFileActivate}
            openFilePreview={openFilePreview}
            presentation="workspace"
            resolveFileThumbnailUrl={resolveFileThumbnailUrl}
          />,
        ),
      )
      await act(async () => {
        await Bun.sleep(0)
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Open project folder"]')?.click(),
      )
      expect(openEntry).toHaveBeenCalledWith("")

      const row = container.querySelector<HTMLElement>('[data-project-entry-path="Media/reference.png"]')!
      const thumbnail = row.querySelector<HTMLImageElement>("img")
      expect(thumbnail?.src).toBe("data:image/jpeg;base64,bW91bnQtY292ZXI=")
      expect(resolveFileThumbnailUrl).not.toHaveBeenCalled()
      expect(
        container.querySelector<HTMLElement>('[data-project-entry-path="Media/source.mp4"]')?.querySelector("img")?.src,
      ).toBe("data:image/jpeg;base64,bW91bnQtY292ZXI=")
      expect(drawImage).toHaveBeenCalledTimes(2)
      expect(openFilePreview).toHaveBeenCalledWith({
        path: "Media/reference.png",
        projectId: "project-1",
        purpose: "thumbnail",
      })
      expect(openFilePreview).toHaveBeenCalledWith({
        path: "Media/source.mp4",
        projectId: "project-1",
        purpose: "thumbnail",
      })
      expect(releasePreview).toHaveBeenCalledTimes(2)

      await act(async () => row.click())
      expect(selectEntry).toHaveBeenCalledWith("Media/reference.png", { range: false, toggle: false })
      expect(onFileActivate).toHaveBeenCalledWith({ entry: imageEntry, projectId: "project-1" })

      const videoRow = container.querySelector<HTMLElement>('[data-project-entry-path="Media/source.mp4"]')!
      await act(async () => {
        videoRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
        await Bun.sleep(140)
        await Promise.resolve()
      })
      const videoPreview = document.querySelector<HTMLElement>('[data-project-file-preview="Media/source.mp4"]')
      const video = videoPreview?.querySelector("video")
      expect(video?.src).toContain("convax-project-preview://lease/stream")
      expect(video?.crossOrigin).toBe("anonymous")
      expect(openFilePreview).toHaveBeenCalledWith({
        path: "Media/source.mp4",
        projectId: "project-1",
        purpose: "preview",
      })

      await act(async () => {
        videoRow.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
        await Bun.sleep(110)
      })
      expect(document.querySelector('[data-project-file-preview="Media/source.mp4"]')).toBeNull()
      expect(releasePreview).toHaveBeenCalledTimes(3)

      const dragData = new Map<string, string>()
      const dragStart = new Event("dragstart", { bubbles: true })
      Object.defineProperty(dragStart, "dataTransfer", {
        value: {
          effectAllowed: "none",
          setData(type: string, value: string) {
            dragData.set(type, value)
          },
        },
      })
      await act(async () => row.dispatchEvent(dragStart))
      expect(parseProjectEntryDrag(dragData.get(PROJECT_ENTRY_DRAG_TYPE) ?? "")?.entries).toEqual([
        {
          kind: "file",
          name: "reference.png",
          path: "Media/reference.png",
          presentation: {
            intrinsicHeight: 900,
            intrinsicWidth: 1_600,
            mediaKind: "image",
            thumbnailDataUrl: "data:image/jpeg;base64,bW91bnQtY292ZXI=",
          },
        },
      ])

      const videoDragData = new Map<string, string>()
      const videoDragStart = new Event("dragstart", { bubbles: true })
      Object.defineProperty(videoDragStart, "dataTransfer", {
        value: {
          effectAllowed: "none",
          setData(type: string, value: string) {
            videoDragData.set(type, value)
          },
        },
      })
      await act(async () => videoRow.dispatchEvent(videoDragStart))
      expect(parseProjectEntryDrag(videoDragData.get(PROJECT_ENTRY_DRAG_TYPE) ?? "")?.entries).toEqual([
        {
          kind: "file",
          name: "source.mp4",
          path: "Media/source.mp4",
          presentation: {
            intrinsicHeight: 720,
            intrinsicWidth: 1_280,
            mediaKind: "video",
            thumbnailDataUrl: "data:image/jpeg;base64,bW91bnQtY292ZXI=",
          },
        },
      ])
    } finally {
      Object.defineProperty(document, "createElement", { configurable: true, value: originalCreateElement })
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("keeps legacy thumbnail resolvers compatible while normalizing structured intrinsic metadata", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    const entries = [
      {
        kind: "file" as const,
        modifiedAt: 21,
        name: "structured.png",
        parentPath: "",
        path: "Media/structured.png",
        size: 21,
      },
      {
        kind: "file" as const,
        modifiedAt: 22,
        name: "legacy.png",
        parentPath: "",
        path: "Media/legacy.png",
        size: 22,
      },
      {
        kind: "file" as const,
        modifiedAt: 23,
        name: "broken.png",
        parentPath: "",
        path: "Media/broken.png",
        size: 23,
      },
    ]
    const resolveFileThumbnailUrl = mock(({ path }: { path: string }) => {
      if (path.endsWith("structured.png")) {
        return {
          dataUrl: "data:image/png;base64,c3RydWN0dXJlZA==",
          intrinsicHeight: 600,
          intrinsicWidth: 800,
        }
      }
      if (path.endsWith("legacy.png")) return "data:image/png;base64,bGVnYWN5"
      throw new Error("synchronous thumbnail resolver failure")
    })
    const selectEntry = mock(() => undefined)
    const filesSnapshot: ProjectFilesControllerSnapshot = {
      ...activeFilesSnapshot,
      listings: {
        "": {
          entries,
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
            presentation="workspace"
            resolveFileThumbnailUrl={resolveFileThumbnailUrl}
          />,
        ),
      )
      await act(async () => {
        await Bun.sleep(0)
        await Promise.resolve()
      })

      expect(
        container
          .querySelector<HTMLElement>('[data-project-entry-path="Media/structured.png"]')
          ?.querySelector<HTMLImageElement>("img")?.src,
      ).toBe("data:image/png;base64,c3RydWN0dXJlZA==")
      expect(
        container
          .querySelector<HTMLElement>('[data-project-entry-path="Media/legacy.png"]')
          ?.querySelector<HTMLImageElement>("img")?.src,
      ).toBe("data:image/png;base64,bGVnYWN5")
      expect(
        container
          .querySelector<HTMLElement>('[data-project-entry-path="Media/broken.png"]')
          ?.querySelector<HTMLImageElement>("img"),
      ).toBeNull()
      expect(resolveFileThumbnailUrl).toHaveBeenCalledTimes(3)

      const dragEntry = async (path: string) => {
        const data = new Map<string, string>()
        const dragStart = new Event("dragstart", { bubbles: true })
        Object.defineProperty(dragStart, "dataTransfer", {
          value: {
            effectAllowed: "none",
            setData(type: string, value: string) {
              data.set(type, value)
            },
          },
        })
        await act(async () =>
          container.querySelector<HTMLElement>(`[data-project-entry-path="${path}"]`)?.dispatchEvent(dragStart),
        )
        return parseProjectEntryDrag(data.get(PROJECT_ENTRY_DRAG_TYPE) ?? "")?.entries[0]
      }
      expect(await dragEntry("Media/structured.png")).toMatchObject({
        presentation: {
          intrinsicHeight: 600,
          intrinsicWidth: 800,
          mediaKind: "image",
          thumbnailDataUrl: "data:image/png;base64,c3RydWN0dXJlZA==",
        },
      })
      expect(await dragEntry("Media/legacy.png")).not.toHaveProperty("presentation")
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("releases an image-thumbnail lease after decode failure", async () => {
    const restoreWindow = installTestWindow()
    const originalCreateElement = document.createElement.bind(document)
    Object.defineProperty(document, "createElement", {
      configurable: true,
      value: (name: string, options?: ElementCreationOptions) => {
        const element = originalCreateElement(name, options)
        if (name === "img") queueMicrotask(() => element.dispatchEvent(new Event("error")))
        return element
      },
    })
    const release = mock(async () => undefined)
    try {
      await expect(
        captureProjectImageThumbnail(
          { path: "Media/invalid.png", projectId: "project-1" },
          async () => ({ release, url: "convax-project-preview://lease/invalid" }),
          new AbortController().signal,
        ),
      ).rejects.toThrow("could not be decoded")
      expect(release).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(document, "createElement", { configurable: true, value: originalCreateElement })
      await restoreWindow()
    }
  })

  test("releases an image-thumbnail lease when its row unmounts during open", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    let resolveOpen!: (handle: ProjectFilePreviewHandle) => void
    const opened = new Promise<ProjectFilePreviewHandle>((resolve) => {
      resolveOpen = resolve
    })
    const release = mock(async () => undefined)
    const openFilePreview = mock(() => opened)
    const imageEntry = {
      kind: "file" as const,
      modifiedAt: 24,
      name: "unmounted.png",
      parentPath: "",
      path: "Media/unmounted.png",
      size: 24,
    }
    const filesSnapshot: ProjectFilesControllerSnapshot = {
      ...activeFilesSnapshot,
      listings: { "": { entries: [imageEntry], path: "", projectId: "project-1" } },
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
                subscribe: () => () => undefined,
              } as unknown as ProjectFilesController
            }
            openFilePreview={openFilePreview}
            presentation="workspace"
          />,
        ),
      )
      expect(openFilePreview).toHaveBeenCalledWith({
        path: "Media/unmounted.png",
        projectId: "project-1",
        purpose: "thumbnail",
      })

      await act(async () => root?.unmount())
      root = undefined
      await act(async () => {
        resolveOpen({ release, url: "convax-project-preview://lease/unmounted" })
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(release).toHaveBeenCalledTimes(1)
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("releases a video-thumbnail lease when its row is canceled during open", async () => {
    let resolveOpen!: (handle: ProjectFilePreviewHandle) => void
    const opened = new Promise<ProjectFilePreviewHandle>((resolve) => {
      resolveOpen = resolve
    })
    const release = mock(async () => undefined)
    const openPreview = mock(() => opened)
    const abortController = new AbortController()
    const thumbnail = captureProjectVideoThumbnail(
      { path: "Media/canceled.mp4", projectId: "project-1" },
      openPreview,
      abortController.signal,
    )

    abortController.abort()
    resolveOpen({ release, url: "convax-project-preview://lease/stream" })

    await expect(thumbnail).rejects.toMatchObject({ name: "AbortError" })
    expect(openPreview).toHaveBeenCalledWith({
      path: "Media/canceled.mp4",
      projectId: "project-1",
      purpose: "thumbnail",
    })
    expect(release).toHaveBeenCalledTimes(1)
  })
})
