import { describe, expect, mock, test } from "bun:test"
import type { ProjectCanvasController, ProjectCanvasControllerSnapshot } from "@convax/project/canvas"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import {
  listProjectCanvasLeafNodes,
  ProjectCanvasSidebar,
  ProjectCanvasSidebarTools,
  ProjectCanvasSwitcher,
  summarizeProjectCanvasLeaves,
} from "./project-canvas-sidebar"

const snapshot: ProjectCanvasControllerSnapshot = {
  busy: false,
  canvases: [
    { createdAt: 1, id: "canvas-1", name: "Canvas 1", updatedAt: 1 },
    { createdAt: 2, id: "canvas-2", name: "Canvas 2", updatedAt: 2 },
  ],
  error: null,
  creationAvailability: "available",
  projectId: "project-1",
}

const controller = {
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
} as unknown as ProjectCanvasController

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({
    Element: testWindow.Element,
    Event: testWindow.Event,
    FocusEvent: testWindow.FocusEvent,
    HTMLElement: testWindow.HTMLElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    MouseEvent: testWindow.MouseEvent,
    MutationObserver: testWindow.MutationObserver,
    Node: testWindow.Node,
    PointerEvent: testWindow.PointerEvent,
    cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
    document: testWindow.document,
    getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
    navigator: testWindow.navigator,
    requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
    window: testWindow,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"))
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true })
  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

const nestedNodes = [
  {
    children: [
      { id: "question", kind: "text", label: "Question" },
      { id: "answer", kind: "text", label: "Answer" },
      {
        children: [{ id: "source", kind: "image", label: "Source image" }],
        id: "references",
        kind: "group",
        label: "References",
      },
    ],
    folderColor: "green" as const,
    folderEmoji: "leaf" as const,
    id: "research",
    kind: "group",
    label: "Research",
  },
  { id: "clip", kind: "video", label: "Final cut" },
  { id: "plugin-node", kind: "Plugin.storyai-3d-director-desk", label: "3D Director" },
  { folderColor: "blue" as const, id: "empty-group", kind: "group", label: "Empty group" },
]

describe("ProjectCanvasSidebar", () => {
  test("moves Canvas selection into one compact header switcher", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSwitcher
        activeCanvasId="canvas-1"
        controller={controller}
        onActivate={() => undefined}
        onDelete={() => undefined}
      />,
    )

    expect(markup).toContain('data-project-canvas-switcher=""')
    expect(markup).toContain("Canvas 1")
    expect(markup).toContain('aria-label="Switch canvas, current Canvas 1"')
    expect(markup).not.toContain('data-project-canvas-id="canvas-1"')
    expect(markup).not.toContain('data-project-canvas-row=""')
  })

  test("opens Canvas switching from the header", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectCanvasSwitcher
            activeCanvasId="canvas-1"
            controller={controller}
            onActivate={() => undefined}
            onDelete={() => undefined}
          />,
        ),
      )
      const trigger = container.querySelector<HTMLButtonElement>("[data-project-canvas-switcher]")!
      await act(async () => trigger.click())
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("counts nested resource leaves once and excludes structural groups", () => {
    expect(listProjectCanvasLeafNodes(nestedNodes).map((node) => node.id)).toEqual([
      "question",
      "answer",
      "source",
      "clip",
      "plugin-node",
    ])
    expect(summarizeProjectCanvasLeaves(nestedNodes)).toEqual([
      { count: 2, kind: "text", label: "Text" },
      { count: 1, kind: "image", label: "Image" },
      { count: 1, kind: "video", label: "Video" },
      { count: 1, kind: "plugin", label: "Plugin" },
    ])
  })

  test("exposes a compact multi-select type filter without a header total", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebarTools
        filteredKinds={new Set(["image", "text"])}
        nodes={nestedNodes}
        onFilteredKindsChange={() => undefined}
      />,
    )

    expect(markup).not.toContain("data-project-canvas-leaf-count")
    expect(markup).not.toContain("leaf nodes")
    expect(markup).toContain('aria-label="Filter canvas nodes by type"')
    expect(markup).toContain('aria-pressed="true"')
  })

  test("closes the type filter from click-outside or its trigger", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectCanvasSidebarTools
            filteredKinds={new Set()}
            nodes={nestedNodes}
            onFilteredKindsChange={() => undefined}
          />,
        ),
      )
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Filter canvas nodes by type"]')!
      await act(async () => trigger.click())
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
      await act(async () =>
        document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true })),
      )
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
      await act(async () => trigger.click())
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
      await act(async () => trigger.click())
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("renders the active Canvas nodes directly without a duplicated Canvas tree level", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        activeNodes={{
          canvasId: "canvas-1",
          nodes: [
            { id: "node-image", kind: "image", label: "Reference image", previewUrl: "asset://reference" },
            { id: "node-notes", kind: "text", label: "Notes" },
          ],
          projectId: "project-1",
        }}
        controller={controller}
      />,
    )

    expect(markup).toContain('aria-label="Canvas 1 nodes"')
    expect(markup).toContain('data-project-canvas-view="tree"')
    expect(markup).toContain('data-project-canvas-node-id="node-image"')
    expect(markup).toContain('data-project-canvas-node-preview="image"')
    expect(markup).toContain('data-project-canvas-node-icon="text"')
    expect(markup).not.toContain('data-project-canvas-id="canvas-1"')
    expect(markup).not.toContain("Collapse Canvas 1 nodes")
  })

  test("keeps the previous standalone controls as a compatibility header", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        activeNodes={{ canvasId: "canvas-1", nodes: nestedNodes, projectId: "project-1" }}
        controller={controller}
        onActivate={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    )

    expect(markup).toContain('data-project-canvas-legacy-header=""')
    expect(markup).toContain('aria-label="Switch canvas, current Canvas 1"')
    expect(markup).toContain('aria-label="New canvas"')
  })

  test("flattens selected leaf types and omits containers and unmatched leaves", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        activeNodes={{ canvasId: "canvas-1", nodes: nestedNodes, projectId: "project-1" }}
        controller={controller}
        filteredKinds={new Set(["image", "video"])}
      />,
    )

    expect(markup).toContain('data-project-canvas-view="flat"')
    expect(markup).toContain('data-project-canvas-node-id="source"')
    expect(markup).toContain('data-project-canvas-node-id="clip"')
    expect(markup).toContain('data-project-canvas-node-depth="0"')
    expect(markup).not.toContain('data-project-canvas-node-id="research"')
    expect(markup).not.toContain('data-project-canvas-node-id="question"')
  })

  test("expands nested Group rows without activating the Group node", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    const onNodeActivate = mock(() => undefined)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectCanvasSidebar
            activeCanvasId="canvas-1"
            activeNodes={{ canvasId: "canvas-1", nodes: nestedNodes, projectId: "project-1" }}
            controller={controller}
            onNodeActivate={onNodeActivate}
          />,
        ),
      )

      const research = container.querySelector<HTMLButtonElement>('[data-project-canvas-node-id="research"]')!
      const folderPreview = research.querySelector<HTMLElement>('[data-project-canvas-node-icon="fold"]')!
      const folderGlyph = folderPreview.querySelector<HTMLElement>("[data-ui-folder-glyph]")!
      const folderEmoji = research.querySelector<HTMLElement>('[data-project-canvas-node-folder-emoji="leaf"]')!
      const folderLabel = research.querySelector<HTMLElement>("[data-project-canvas-node-label]")!
      expect(folderGlyph).not.toBeNull()
      expect(folderEmoji.textContent).toContain("🍃")
      expect(folderPreview.nextElementSibling?.contains(folderEmoji)).toBe(true)
      expect(folderEmoji.nextElementSibling).toBe(folderLabel)
      expect(container.querySelector('[data-project-canvas-node-id="question"]')).toBeNull()

      await act(async () => research.click())
      expect(onNodeActivate).not.toHaveBeenCalled()
      expect(container.querySelector('[data-project-canvas-node-id="question"]')).not.toBeNull()

      const references = container.querySelector<HTMLButtonElement>('[data-project-canvas-node-id="references"]')!
      await act(async () => references.click())
      const source = container.querySelector<HTMLButtonElement>('[data-project-canvas-node-id="source"]')!
      expect(source.dataset.projectCanvasNodeDepth).toBe("2")
      expect(research.dataset.projectCanvasNodeSticky).toBe("")
      expect(research.className).toContain("sticky")
      expect(research.style.top).toBe("0px")
      expect(references.dataset.projectCanvasNodeSticky).toBe("")
      expect(references.style.top).toBe("32px")
      expect(
        container.querySelector<HTMLElement>('[data-project-canvas-indent-guide="0"]')?.style.insetInlineStart,
      ).toBe("34px")
      expect(
        container.querySelector<HTMLElement>('[data-project-canvas-indent-guide="1"]')?.style.insetInlineStart,
      ).toBe("50px")
      await act(async () => source.click())
      expect(onNodeActivate).toHaveBeenCalledWith({ canvasId: "canvas-1", nodeId: "source" })
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("searches only the active Canvas and keeps the matching ancestor path", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        activeNodes={{
          canvasId: "canvas-1",
          nodes: [...nestedNodes, { id: "unrelated", kind: "text", label: "Unrelated note" }],
          projectId: "project-1",
        }}
        controller={controller}
        query="source"
      />,
    )

    expect(markup).toContain('data-project-canvas-node-id="research"')
    expect(markup).toContain('data-project-canvas-node-id="references"')
    expect(markup).toContain('data-project-canvas-node-id="source"')
    expect(markup).not.toContain('data-project-canvas-node-id="unrelated"')
  })

  test("ignores a late active-node outline after the Project scope changes", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    const listeners = new Set<() => void>()
    let currentSnapshot = snapshot
    let resolveOldNodes: ((nodes: readonly { id: string; kind: string; label: string }[]) => void) | undefined
    const oldNodes = new Promise<readonly { id: string; kind: string; label: string }[]>((resolve) => {
      resolveOldNodes = resolve
    })
    const scopedController = {
      getSnapshot: () => currentSnapshot,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    } as unknown as ProjectCanvasController
    const loadNodes = mock(({ projectId }: { projectId: string }) =>
      projectId === "project-1" ? oldNodes : Promise.resolve([{ id: "fresh-node", kind: "text", label: "Fresh node" }]),
    )
    const onNodesResolved = mock(() => undefined)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectCanvasSidebar
            activeCanvasId="canvas-1"
            controller={scopedController}
            loadNodes={loadNodes}
            onNodesResolved={onNodesResolved}
          />,
        ),
      )
      currentSnapshot = {
        ...snapshot,
        canvases: [{ createdAt: 3, id: "canvas-3", name: "Canvas 3", updatedAt: 3 }],
        projectId: "project-2",
      }
      await act(async () => {
        for (const listener of listeners) listener()
        root?.render(
          <ProjectCanvasSidebar
            activeCanvasId="canvas-3"
            controller={scopedController}
            loadNodes={loadNodes}
            onNodesResolved={onNodesResolved}
          />,
        )
        await Promise.resolve()
      })
      await act(async () => {
        resolveOldNodes?.([{ id: "stale-node", kind: "image", label: "Stale node" }])
        await oldNodes
        await Promise.resolve()
      })

      expect(container.querySelector('[data-project-canvas-node-id="stale-node"]')).toBeNull()
      expect(container.querySelector('[data-project-canvas-node-id="fresh-node"]')?.textContent).toContain("Fresh node")
      expect(onNodesResolved).toHaveBeenCalledTimes(1)
      expect(onNodesResolved).toHaveBeenCalledWith({
        canvasId: "canvas-3",
        nodes: [{ id: "fresh-node", kind: "text", label: "Fresh node" }],
        projectId: "project-2",
      })
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })
})
