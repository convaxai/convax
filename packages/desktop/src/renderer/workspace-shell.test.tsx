import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { WorkspaceShell } from "./workspace-shell"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    HTMLIFrameElement: testWindow.HTMLIFrameElement,
    MouseEvent: testWindow.MouseEvent,
    Node: testWindow.Node,
    PointerEvent: testWindow.PointerEvent,
    document: testWindow.document,
    navigator: testWindow.navigator,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
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

function pointer(type: string, pointerId: number) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: pointerId === 1, pointerId })
}

async function nextFrame() {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

describe("WorkspaceShell", () => {
  test("keeps the workspace interactive when no blocking surface is active", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked={false}>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain('data-workspace-shell="true"')
    expect(markup).toContain('data-host-pointer-gesture-root="true"')
    expect(markup).toContain(">Canvas</div>")
    expect(markup).not.toContain("aria-hidden")
    expect(markup).not.toContain("inert")
  })

  test("hides and disables the workspace while a blocking surface is active", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked resizing>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain(" inert=")
    expect(markup).toContain("cursor-col-resize")
    expect(markup).toContain("select-none")
    expect(markup).toContain('data-workbench-resizing=""')
  })

  test("keeps the status bar outside the scrollable workspace row", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell blocked={false} statusBar={<footer data-test-status="true">Ready</footer>}>
        <div>Canvas</div>
      </WorkspaceShell>,
    )

    expect(markup).toContain("flex-col")
    expect(markup).toContain("min-h-0 flex-1")
    expect(markup).toContain('data-test-status="true"')
    expect(markup.indexOf("Canvas")).toBeLessThan(markup.indexOf("Ready"))
  })

  test("delegates Canvas toolbar clamping to the host-neutral inset adapter", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()

    expect(styles).not.toContain("--workspace-canvas-toolbar-offset")
    expect(source).toContain("resolveWorkspaceCanvasViewportInsets")
    expect(source).toContain("viewportInsets={canvasViewportInsets}")
  })

  test("disables width easing for both sidebars during direct resize gestures", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()

    expect(styles).toMatch(
      /\[data-workbench-resizing\] \.project-sidebar-shell[\s\S]*?\[data-workbench-resizing\] \.workspace-utility-drawer\[data-workspace-utility-state\][\s\S]*?transition: none;/,
    )
  })

  test("locks both drag-collapsed sidebars against reopening for one second", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()

    expect(source).toContain("const sidebarCollapseReopenDelayMs = 1_000")
    expect(source.match(/collapseReopenDelayMs: sidebarCollapseReopenDelayMs/g)).toHaveLength(2)
    expect(source).not.toContain("setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)")
    expect(
      source.match(/ensureWorkbenchPartVisible\(workbenchLayoutController, WorkbenchLayoutParts.SecondarySidebar\)/g),
    ).toHaveLength(3)
  })

  test("composes one Project entry, keeps the account menu in the sidebar, and removes titlebar search chrome", async () => {
    const indexSource = await Bun.file(new URL("./index.tsx", import.meta.url)).text()
    const sidebarProjectionSource = await Bun.file(
      new URL("./project-canvas-sidebar-projection.ts", import.meta.url),
    ).text()
    const titlebarSource = await Bun.file(new URL("./application-titlebar.tsx", import.meta.url)).text()

    expect(indexSource.match(/<ProjectSidebarShell/g)?.length).toBe(1)
    expect(indexSource).not.toContain("<ProjectSidebarTrigger")
    expect(
      indexSource.match(
        /footerActions=\{\s*<ApplicationMenu locale=\{locale\} onOpenSettings=\{openSettings\} services=\{serviceCatalogSnapshot\} \/>\s*\}/,
      ),
    ).not.toBeNull()
    expect(indexSource.match(/<ApplicationMenu[\s\S]{0,80}\bcompact/)).toBeNull()
    expect(titlebarSource).toContain('from "lucide-react"')
    expect(titlebarSource).not.toContain("onOpenCommands")
    expect(indexSource).toContain('id: "application.command-palette"')
    expect(indexSource).toContain('chords: [primaryShortcutChord("k")]')
    expect(indexSource).toContain("leadingActionHostRef={setProjectTitlebarEntryHost}")
    expect(indexSource).toContain("entryPortal={settingsSection ? null : projectTitlebarEntryHost}")
    expect(indexSource).toContain("<AgentDrawerTrigger")
    expect(indexSource).toContain("open={secondarySidebar.visible}")
    expect(indexSource).toContain("onClose={closeWorkspaceUtility}")
    expect(indexSource).not.toContain("<WorkspaceUtilityCollapseButton")
    expect(indexSource.match(/collapsedEntry=/g)).toHaveLength(1)
    expect(indexSource).toContain("collapsedEntry={false}")
    expect(indexSource).toContain("<CanvasTitlebarTitle")
    expect(indexSource).toContain('productLabel={effectivePrimaryDesktopSurface === "workspace" ? "" : "Convax"}')
    expect(indexSource).toContain("onDocumentChange={publishActiveCanvasNodes}")
    expect(indexSource).toContain("onNodeActivate={activateProjectCanvasNode}")
    expect(indexSource).not.toContain("<ProjectCanvasSwitcher")
    expect(indexSource).toContain('filesLabel={locale === "zh-CN" ? "项目文件" : "Project files"}')
    expect(indexSource).toContain(
      'locale === "zh-CN" ? "调整项目文件和画布区域大小" : "Resize Project files and Canvas sections"',
    )
    expect(indexSource).toContain(
      'searchLabel={locale === "zh-CN" ? "搜索画布或项目文件" : "Search Canvas or Project files"}',
    )
    expect(indexSource).toContain(
      "onActivate={(canvasId) => projectCanvasWorkbench.openCanvas(activeProject.id, canvasId)}",
    )
    expect(indexSource).toContain(
      "onDelete={(canvasId) => projectCanvasWorkbench.deleteCanvas(activeProject.id, canvasId)}",
    )
    expect(indexSource).toContain("projectCanvasSidebarNodes(document)")
    expect(sidebarProjectionSource).toContain("projectCanvasSidebarNodePreview(node)")
    expect(sidebarProjectionSource).toContain('node.data.kind === "image"')
    expect(sidebarProjectionSource).toContain('previewType: "video" as const')
    expect(indexSource).toContain('type: "nodes.reveal"')
    expect(titlebarSource).toContain('data-application-titlebar-leading=""')
    expect(titlebarSource).toContain('data-application-titlebar-center=""')
    expect(titlebarSource).toContain('data-application-titlebar-right=""')
    expect(titlebarSource).not.toContain("ConvaxBrand")
  })

  test("opens whole-Canvas Generate through the mounted Canvas handle, not the utility drawer", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()

    expect(source).toContain("mounted.handle.openGenerate()")
    expect(source).not.toContain("openGenerateUtility")
    expect(source).not.toContain('value: "generate" as const')
    expect(source).not.toContain("<CanvasGenerationPanel")
    expect(source).not.toContain("onGenerateRequest=")
  })

  test("keeps Settings as the original full-page surface instead of a Sheet", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()

    expect(source).toContain("<SettingsView")
    expect(source).toContain('className="absolute inset-0 z-[100]"')
    expect(source).not.toContain("WorkspaceSettingsSheet")
    expect(source).not.toContain('presentation="sheet"')
    expect(styles).not.toContain(".workspace-settings-sheet")
  })

  test("blocks embedded frames for every host-started pointer until all pointers release and one frame passes", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <WorkspaceShell blocked={false}>
            <button data-host-target type="button">
              Host target
            </button>
            <iframe data-web-plugin-iframe="" title="Plugin" />
          </WorkspaceShell>,
        ),
      )
      const shell = container.querySelector<HTMLElement>("[data-workspace-shell]")!
      const hostTarget = container.querySelector<HTMLElement>("[data-host-target]")!
      const iframe = container.querySelector<HTMLIFrameElement>("iframe")!
      iframe.focus()
      expect(document.activeElement).toBe(iframe)

      hostTarget.dispatchEvent(pointer("pointerdown", 1))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()
      expect(document.activeElement).not.toBe(iframe)

      hostTarget.dispatchEvent(pointer("pointerdown", 2))
      window.dispatchEvent(pointer("pointerup", 99))
      window.dispatchEvent(pointer("pointerup", 1))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()

      window.dispatchEvent(pointer("pointerup", 2))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()
      await act(nextFrame)
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeFalse()
    } finally {
      await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("releases a host gesture one frame after window blur", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <WorkspaceShell blocked={false}>
            <div data-host-target>Canvas</div>
          </WorkspaceShell>,
        ),
      )
      const shell = container.querySelector<HTMLElement>("[data-workspace-shell]")!
      const target = container.querySelector<HTMLElement>("[data-host-target]")!
      target.dispatchEvent(pointer("pointerdown", 1))
      window.dispatchEvent(new Event("blur"))
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeTrue()
      await act(nextFrame)
      expect(shell.hasAttribute("data-host-pointer-gesture")).toBeFalse()
    } finally {
      await act(async () => root?.unmount())
      await restoreWindow()
    }
  })
})
