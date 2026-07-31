import { describe, expect, mock, test } from "bun:test"
import type { ProjectCanvasController, ProjectCanvasControllerSnapshot } from "@convax/project/canvas"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
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

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries({
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    MouseEvent: testWindow.MouseEvent,
    Node: testWindow.Node,
    document: testWindow.document,
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

describe("ProjectCanvasSidebar", () => {
  test("renders the active canvas as a compact neutral workspace row", () => {
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
    expect(markup).toContain("group my-0.5 flex h-7")
    expect(markup).not.toContain("pl-4")
    expect(markup).toContain("text-[13px]")
    expect(markup).toContain('data-project-canvas-indent=""')
    expect(markup).toContain("bg-interactive-selected")
    expect(markup).not.toContain("ring-1 ring-primary/20")
    expect(markup).toContain('aria-label="More actions for Canvas 1"')
    expect(markup).toContain("overscroll-contain")
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

  test("shows active Canvas nodes as a second collapsible tree level", () => {
    const markup = renderToStaticMarkup(
      <ProjectCanvasSidebar
        activeCanvasId="canvas-1"
        activeNodes={{
          canvasId: "canvas-1",
          nodes: [
            { id: "node-image", kind: "image", label: "Reference image", previewUrl: "asset://reference" },
            { id: "node-notes", kind: "text", label: "Notes" },
            {
              id: "node-video",
              kind: "video",
              label: "Preview clip",
              previewType: "video",
              previewUrl: "asset://clip",
            },
          ],
          projectId: "project-1",
        }}
        controller={controller}
        onActivate={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="Collapse Canvas 1 nodes"')
    expect(markup).toContain('data-project-canvas-node-id="node-image"')
    expect(markup).toContain('data-project-canvas-node-preview="image"')
    expect(markup).toContain('src="asset://reference"')
    expect(markup).toContain('data-project-canvas-node-icon="text"')
    expect(markup).toContain('data-project-canvas-node-preview="video"')
    expect(markup).toContain('src="asset://clip"')
    expect(markup).toContain("<video")
    expect(markup).toContain("Reference image")
    expect(markup).toContain('role="tree"')
    expect(markup).toContain('role="group"')
    expect(markup.indexOf('aria-label="Collapse Canvas 1 nodes"')).toBeLessThan(markup.indexOf(">Canvas 1<"))
  })

  test("toggles the active Canvas outline from its row and reopens it when the Canvas becomes active again", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    let root: Root | undefined
    const activeNodes = {
      canvasId: "canvas-1",
      nodes: [{ id: "node-notes", kind: "text", label: "Notes" }],
      projectId: "project-1",
    }
    const renderSidebar = (activeCanvasId: string) =>
      root?.render(
        <ProjectCanvasSidebar
          activeCanvasId={activeCanvasId}
          activeNodes={activeNodes}
          controller={controller}
          onActivate={() => undefined}
          onCreate={() => undefined}
          onDelete={() => undefined}
        />,
      )
    try {
      root = createRoot(container)
      await act(async () => renderSidebar("canvas-1"))
      await act(async () =>
        container.querySelector<HTMLElement>('[data-project-canvas-id="canvas-1"] [data-project-canvas-row]')?.click(),
      )
      expect(container.querySelector('[data-project-canvas-node-id="node-notes"]')).toBeNull()

      await act(async () => renderSidebar("canvas-2"))
      await act(async () => renderSidebar("canvas-1"))

      expect(container.querySelector('button[aria-label="Collapse Canvas 1 nodes"]')).not.toBeNull()
      expect(container.querySelector('[data-project-canvas-node-id="node-notes"]')?.textContent).toContain("Notes")

      await act(async () =>
        container.querySelector<HTMLElement>('[data-project-canvas-id="canvas-1"] [data-project-canvas-row]')?.click(),
      )
      expect(container.querySelector('[data-project-canvas-node-id="node-notes"]')).toBeNull()
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("loads an expanded Canvas outline and activates its node without changing catalog ownership", async () => {
    const restoreWindow = installTestWindow()
    const container = document.createElement("div")
    document.body.append(container)
    const loadNodes = mock(async ({ canvasId }: { canvasId: string }) =>
      canvasId === "canvas-2" ? [{ id: "node-video", kind: "video", label: "Final cut" }] : [],
    )
    const onNodeActivate = mock(() => undefined)
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectCanvasSidebar
            activeCanvasId="canvas-1"
            controller={controller}
            loadNodes={loadNodes}
            onActivate={() => undefined}
            onCreate={() => undefined}
            onDelete={() => undefined}
            onNodeActivate={onNodeActivate}
          />,
        ),
      )
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Expand Canvas 2 nodes"]')?.click()
        await Promise.resolve()
      })

      const node = container.querySelector<HTMLButtonElement>('[data-project-canvas-node-id="node-video"]')!
      expect(node.textContent).toContain("Final cut")
      await act(async () => node.click())
      expect(onNodeActivate).toHaveBeenCalledWith({ canvasId: "canvas-2", nodeId: "node-video" })

      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Collapse Canvas 2 nodes"]')?.click(),
      )
      expect(container.querySelector('[data-project-canvas-node-id="node-video"]')).toBeNull()
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })

  test("ignores a late node outline after the Project scope changes", async () => {
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
    let root: Root | undefined
    try {
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ProjectCanvasSidebar
            activeCanvasId="canvas-1"
            controller={scopedController}
            loadNodes={loadNodes}
            onActivate={() => undefined}
            onCreate={() => undefined}
            onDelete={() => undefined}
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
            onActivate={() => undefined}
            onCreate={() => undefined}
            onDelete={() => undefined}
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
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
      await restoreWindow()
    }
  })
})
