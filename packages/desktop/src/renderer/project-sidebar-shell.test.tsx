import { describe, expect, mock, test } from "bun:test"
import { ProjectSidebar, type ProjectController } from "@convax/project"
import type { ProjectFilesController, ProjectFilesControllerSnapshot } from "@convax/project-files"
import { Window } from "happy-dom"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ProjectSidebarShell } from "./project-sidebar-shell"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const frames = new Map<ReturnType<typeof testWindow.requestAnimationFrame>, (timestamp: number) => void>()
  testWindow.requestAnimationFrame = (callback) => {
    const frameId = setImmediate(() => undefined)
    clearImmediate(frameId)
    frames.set(frameId, callback)
    return frameId
  }
  testWindow.cancelAnimationFrame = (frameId) => {
    frames.delete(frameId)
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    HTMLInputElement: testWindow.HTMLInputElement,
    InputEvent: testWindow.InputEvent,
    KeyboardEvent: testWindow.KeyboardEvent,
    Node: testWindow.Node,
    PointerEvent: testWindow.PointerEvent,
    document: testWindow.document,
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
  return {
    restore: async () => {
      await testWindow.happyDOM.close()
      for (const [name, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
    runFrames: () => {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(performance.now())
    },
    window: testWindow,
  }
}

function ShellHarness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <ProjectSidebarShell entryLabel="Example" onOpenChange={setOpen} open={open} size={240}>
      <aside>
        <button data-project-sidebar-close="" onClick={() => setOpen(false)} type="button">
          Close
        </button>
      </aside>
    </ProjectSidebarShell>
  )
}

describe("Desktop Project sidebar Shell", () => {
  test("retains a host-provided resize handle after crossing the collapse threshold", async () => {
    const testEnvironment = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectSidebarShell
            entryLabel="Atlas"
            onOpenChange={() => undefined}
            open={false}
            resizeHandle={<span data-resize-handle="" />}
            size={240}
          >
            <aside>Project navigation</aside>
          </ProjectSidebarShell>,
        ),
      )

      expect(container.querySelector("[data-resize-handle]")).not.toBeNull()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("ports the single stable Project identity into the application titlebar host", async () => {
    const testEnvironment = installTestWindow()
    const container = document.createElement("div")
    const titlebarHost = document.createElement("div")
    document.body.append(titlebarHost, container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectSidebarShell
            entryLabel="Atlas"
            entryPortal={titlebarHost}
            onOpenChange={() => undefined}
            open={false}
            size={240}
          >
            <aside>Project navigation</aside>
          </ProjectSidebarShell>,
        ),
      )

      expect(container.querySelector("[data-project-sidebar-entry]")).toBeNull()
      expect(titlebarHost.querySelector("[data-project-sidebar-entry]")?.textContent).toBe("")
      expect(titlebarHost.querySelector('button[title="Open Atlas"]')).not.toBeNull()
      expect(titlebarHost.querySelector('button[aria-label="Open project sidebar"]')).not.toBeNull()
    } finally {
      await act(async () => root?.unmount())
      titlebarHost.remove()
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("reveals the full-height overlay on hover without pinning or consuming layout width", async () => {
    const testEnvironment = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectSidebarShell entryLabel="Example" onOpenChange={() => undefined} open={false} size={240}>
            <aside>Project navigation</aside>
          </ProjectSidebarShell>,
        ),
      )
      const entry = container.querySelector<HTMLElement>(".project-sidebar-entry")!
      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })),
      )

      const shell = container.querySelector<HTMLElement>(".project-sidebar-shell")!
      expect(shell.getAttribute("data-project-sidebar-state")).toBe("open")
      expect(shell.getAttribute("data-project-sidebar-reveal")).toBe("hover")
      expect(shell.hasAttribute("inert")).toBeFalse()
      expect(entry.getAttribute("aria-hidden")).toBeNull()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("hides the titlebar entry while pinned and stays closed after the sidebar close action", async () => {
    const testEnvironment = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () => root?.render(<ShellHarness />))
      await act(async () => testEnvironment.runFrames())
      const entry = container.querySelector<HTMLElement>(".project-sidebar-entry")!
      const close = container.querySelector<HTMLButtonElement>("[data-project-sidebar-close]")!
      const shell = container.querySelector<HTMLElement>(".project-sidebar-shell")!
      expect(entry.querySelector("[data-project-sidebar-entry-state=hidden]")).not.toBeNull()

      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })),
      )
      await act(async () => close.click())
      expect(shell.getAttribute("data-project-sidebar-reveal")).toBe("closed")
      expect(shell.getAttribute("data-project-sidebar-state")).toBe("closed")

      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })),
      )
      expect(shell.getAttribute("data-project-sidebar-state")).toBe("closed")

      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })),
      )
      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })),
      )
      expect(shell.getAttribute("data-project-sidebar-reveal")).toBe("hover")
      expect(shell.getAttribute("data-project-sidebar-state")).toBe("open")
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("dismisses a hover overlay from outside or Escape without stealing Canvas focus", async () => {
    const testEnvironment = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () => root?.render(<ShellHarness initialOpen={false} />))
      await act(async () => testEnvironment.runFrames())
      const entry = container.querySelector<HTMLElement>(".project-sidebar-entry")!
      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })),
      )
      const close = container.querySelector<HTMLButtonElement>("[data-project-sidebar-close]")!
      close.focus()
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })),
      )
      await act(async () => testEnvironment.runFrames())
      const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Open project sidebar"]')!
      expect(container.querySelector("[data-project-sidebar-backdrop]")).toBeNull()
      expect(document.activeElement).toBe(trigger)

      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })),
      )
      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })),
      )
      const canvasTarget = document.createElement("button")
      canvasTarget.textContent = "Canvas target"
      document.body.append(canvasTarget)
      canvasTarget.focus()
      await act(async () =>
        canvasTarget.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, cancelable: true, isPrimary: true }),
        ),
      )
      await act(async () => testEnvironment.runFrames())
      expect(container.querySelector('[data-project-sidebar-state="closed"]')).not.toBeNull()
      expect(document.activeElement).toBe(canvasTarget)
      canvasTarget.remove()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("pins a hover preview into a layout-consuming dock", async () => {
    const testEnvironment = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () => root?.render(<ShellHarness initialOpen={false} />))
      await act(async () => testEnvironment.runFrames())
      const entry = container.querySelector<HTMLElement>(".project-sidebar-entry")!
      await act(async () =>
        entry.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })),
      )
      expect(container.querySelector(".project-sidebar-shell")?.getAttribute("data-project-sidebar-reveal")).toBe(
        "hover",
      )

      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Open project sidebar"]')?.click(),
      )
      const shell = container.querySelector<HTMLElement>(".project-sidebar-shell")!
      expect(shell.getAttribute("data-project-sidebar-reveal")).toBe("pinned")
      expect(shell.getAttribute("data-project-sidebar-presentation")).toBe("dock")
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("keeps the pinned dock open on outside and Escape", async () => {
    const testEnvironment = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () => root?.render(<ShellHarness />))
      await act(async () =>
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })),
      )
      expect(container.querySelector('[data-project-sidebar-state="open"]')).not.toBeNull()
      expect(container.querySelector("[data-project-sidebar-backdrop]")).toBeNull()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("removes sidebar motion for reduced-motion users", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()

    expect(styles).toContain("@media (prefers-reduced-motion: reduce)")
    expect(styles).toContain(".project-sidebar-shell__panel")
    expect(styles).not.toContain(".project-sidebar-backdrop")
    expect(styles).toContain('.project-sidebar-shell[data-project-sidebar-reveal="pinned"]')
    expect(styles).toContain('.project-sidebar-shell[data-project-sidebar-reveal="hover"]')
    expect(styles).toContain("transition-duration: 0ms")
  })

  test("keeps the localized Project-files-over-Canvas hierarchy while Canvas search focuses and returns on Escape", async () => {
    const testEnvironment = installTestWindow()
    const filesSnapshot: ProjectFilesControllerSnapshot = {
      error: null,
      expandedPaths: [],
      listings: {
        "": {
          entries: [
            { kind: "file", modifiedAt: 1, name: "brief.md", parentPath: "", path: "brief.md", size: 20 },
            { kind: "file", modifiedAt: 2, name: "notes.md", parentPath: "", path: "notes.md", size: 20 },
          ],
          path: "",
          projectId: "project-1",
        },
      },
      loadingPaths: [],
      projectId: "project-1",
      selectedPaths: [],
    }
    const projectSnapshot = {
      activeProjectId: "project-1",
      changingActiveProject: false,
      error: null,
      initialized: true,
      projects: [{ createdAt: 1, id: "project-1", lastOpenedAt: 1, name: "Example", rootPath: "/project" }],
    }
    const controller = {
      clearError: () => undefined,
      getSnapshot: () => projectSnapshot,
      initialize: async () => undefined,
      subscribe: () => () => undefined,
    } as unknown as ProjectController
    const filesController = {
      getSnapshot: () => filesSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectFilesController
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined

    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectSidebar
            controller={controller}
            extension={{
              content: ({ query }) => <div data-canvas-query={query}>Canvas region</div>,
              label: "Canvases",
            }}
            filesCanvasResizeLabel="调整项目文件和画布区域大小"
            filesController={filesController}
            filesLabel="项目文件"
            presentation="workspace"
            searchLabel="Search sidebar"
          />,
        ),
      )

      const canvasLabel = [...container.querySelectorAll("span")].find((element) => element.textContent === "Canvas")!
      const projectLabel = [...container.querySelectorAll("span")].find(
        (element) => element.textContent === "项目文件",
      )!
      expect(projectLabel.compareDocumentPosition(canvasLabel) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
      expect(container.querySelector('[aria-label="调整项目文件和画布区域大小"]')).not.toBeNull()
      expect(container.querySelector('[data-project-entry-path="brief.md"]')).not.toBeNull()
      const searchTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Search sidebar"]')!
      await act(async () => searchTrigger.click())
      const searchInput = container.querySelector<HTMLInputElement>('input[aria-label="Search sidebar"]')!
      expect(document.activeElement).toBe(searchInput)
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(searchInput, "brief")
        searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: "brief", inputType: "insertText" }))
        searchInput.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(container.querySelector("[data-canvas-query]")?.getAttribute("data-canvas-query")).toBe("brief")

      await act(async () => {
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
        await Promise.resolve()
      })
      expect(container.querySelector('input[aria-label="Search sidebar"]')).toBeNull()
      expect(document.activeElement).toBe(searchTrigger)

      await act(async () => searchTrigger.click())
      const projectSearch = container.querySelector<HTMLInputElement>('input[aria-label="Search sidebar"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(projectSearch, "brief")
        projectSearch.dispatchEvent(new InputEvent("input", { bubbles: true, data: "brief", inputType: "insertText" }))
      })
      expect(container.querySelector('[data-project-entry-path="brief.md"]')).not.toBeNull()
      expect(container.querySelector('[data-project-entry-path="notes.md"]')).not.toBeNull()
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })

  test("renames the active Project inline and dismisses its create/delete switcher with focus return", async () => {
    const testEnvironment = installTestWindow()
    const renameProject = mock(async () => undefined)
    const projectSnapshot = {
      activeProjectId: "project-1",
      changingActiveProject: false,
      error: null,
      initialized: true,
      projects: [{ createdAt: 1, id: "project-1", lastOpenedAt: 1, name: "Example", rootPath: "/project" }],
    }
    const controller = {
      clearError: () => undefined,
      getSnapshot: () => projectSnapshot,
      initialize: async () => undefined,
      renameProject,
      subscribe: () => () => undefined,
    } as unknown as ProjectController
    const filesSnapshot = {
      error: null,
      expandedPaths: [],
      listings: { "": { entries: [], path: "", projectId: "project-1" } },
      loadingPaths: [],
      projectId: "project-1",
      selectedPaths: [],
    } satisfies ProjectFilesControllerSnapshot
    const filesController = {
      getSnapshot: () => filesSnapshot,
      subscribe: () => () => undefined,
    } as unknown as ProjectFilesController
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined

    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectSidebar
            controller={controller}
            extension={{ content: <div>Canvas region</div>, label: "Canvases" }}
            filesController={filesController}
            presentation="workspace"
          />,
        ),
      )
      const rename = container.querySelector<HTMLButtonElement>('button[aria-label="Rename Example"]')!
      await act(async () => rename.click())
      const canceledInput = container.querySelector<HTMLInputElement>('input[aria-label="Rename active project"]')!
      await act(async () =>
        canceledInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })),
      )
      expect(renameProject).not.toHaveBeenCalled()

      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rename Example"]')!.click())
      const committedInput = container.querySelector<HTMLInputElement>('input[aria-label="Rename active project"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(committedInput, "Launch")
        committedInput.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: "Launch", inputType: "insertText" }),
        )
        committedInput.dispatchEvent(new Event("change", { bubbles: true }))
      })
      await act(async () =>
        committedInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" })),
      )
      expect(renameProject).toHaveBeenCalledWith("project-1", "Launch")

      const switcherTrigger = container.querySelector<HTMLButtonElement>('button[title^="Switch Project"]')!
      await act(async () => switcherTrigger.click())
      expect(container.querySelector("[data-project-switcher]")).not.toBeNull()
      expect(container.querySelector('button[aria-label="Remove Example"]')).not.toBeNull()
      expect(container.textContent).toContain("New project")
      await act(async () =>
        document.body.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, cancelable: true, isPrimary: true }),
        ),
      )
      expect(container.querySelector("[data-project-switcher]")).toBeNull()

      await act(async () => switcherTrigger.click())
      const activeProject = container.querySelector<HTMLButtonElement>(
        "[data-project-switcher] button:not([aria-label])",
      )!
      activeProject.focus()
      await act(async () =>
        activeProject.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })),
      )
      expect(container.querySelector("[data-project-switcher]")).toBeNull()
      expect(document.activeElement).toBe(switcherTrigger)
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      await testEnvironment.restore()
    }
  })
})
