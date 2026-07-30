import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act, useRef, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import {
  WorkspaceUtilityCollapseButton,
  WorkspaceUtilityDrawer,
  type WorkspaceUtilityActiveMode,
} from "./workspace-utility-drawer"

const modes = [
  { label: "Agent", value: "agent" },
  { label: "Inspector", value: "inspector" },
] as const

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    Node: testWindow.Node,
    document: testWindow.document,
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

describe("WorkspaceUtilityDrawer", () => {
  test("renders Inspector while retaining the Agent slot and caller-owned width", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={({ modeNavigation }) => (
          <div>
            {modeNavigation}
            Agent session
          </div>
        )}
        closeLabel="Close utilities"
        inspector={<div>Inspector details</div>}
        mode="inspector"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
        style={{ maxWidth: 620, width: 380 }}
      />,
    )

    expect(markup).toContain('data-workspace-utility-mode="inspector"')
    expect(markup).toContain("max-width:620px")
    expect(markup).toContain("width:380px")
    expect(markup).toContain('data-workspace-utility-panel="agent"')
    expect(markup).toContain("Agent session")
    expect(markup).toContain('data-workspace-utility-panel="inspector"')
    expect(markup).toContain("Inspector details")
    expect(markup).not.toContain("Generate")
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(2)
    expect(markup.match(/role="tablist"/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="Close utilities"')
  })

  test("keeps the collapse control inside the active Inspector content header", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={() => <div>Agent</div>}
        closeLabel="Collapse utility sidebar"
        inspector={<div>Inspector details</div>}
        mode="inspector"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
      />,
    )

    expect(markup).toContain('data-workspace-utility-close=""')
    expect(markup).toContain('aria-label="Collapse utility sidebar"')
    expect(markup).toContain('title="Collapse utility sidebar"')
    expect(markup).toContain("size-6")
    expect(markup).toContain("lucide-panel-right-close")
    expect(markup).not.toContain("lucide-x")
    expect(markup).toContain('data-workspace-utility-content-header=""')
    expect(markup.indexOf("data-workspace-utility-content-header")).toBeGreaterThan(
      markup.indexOf('data-workspace-utility-panel="inspector"'),
    )
  })

  test("keeps Agent component state mounted across mode switches and close/reopen", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined

    function StatefulAgent({
      closeLabel,
      navigation,
      onClose,
    }: {
      closeLabel: string
      navigation: ReactNode
      onClose(): void
    }) {
      const [draftRevision, setDraftRevision] = useState(0)
      return (
        <div data-agent-state={draftRevision}>
          {navigation}
          <button onClick={() => setDraftRevision((value) => value + 1)} type="button">
            Change draft
          </button>
          <button aria-label={closeLabel} onClick={onClose} type="button">
            Close
          </button>
        </div>
      )
    }

    function Harness() {
      const [mode, setMode] = useState<WorkspaceUtilityActiveMode | "closed">("agent")
      return (
        <WorkspaceUtilityDrawer
          agent={({ closeLabel, modeNavigation, onClose }) => (
            <StatefulAgent closeLabel={closeLabel} navigation={modeNavigation} onClose={onClose} />
          )}
          closeLabel="Close utilities"
          collapsedEntry={
            <button onClick={() => setMode("agent")} type="button">
              Open Agent
            </button>
          }
          inspector={<div>Inspector details</div>}
          mode={mode}
          modes={modes}
          onClose={() => setMode("closed")}
          onModeChange={setMode}
        />
      )
    }

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<Harness />))

      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === "Change draft")
          ?.click(),
      )
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")

      const inspectorTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === "Inspector",
      )
      await act(async () => {
        inspectorTab?.focus()
        inspectorTab?.click()
      })
      const activeInspectorTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === "Inspector",
      )
      expect(document.activeElement).toBe(activeInspectorTab ?? null)
      expect(container.querySelector('[data-workspace-utility-panel="agent"]')?.hasAttribute("hidden")).toBeTrue()
      expect(container.querySelector('[data-workspace-utility-panel="inspector"]')).not.toBeNull()
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")

      const agentTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === "Agent",
      )
      await act(async () => {
        agentTab?.focus()
        agentTab?.click()
      })
      const activeAgentTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === "Agent",
      )
      expect(document.activeElement).toBe(activeAgentTab ?? null)
      expect(container.querySelector('[data-workspace-utility-panel="agent"]')?.hasAttribute("hidden")).toBeFalse()
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")

      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close utilities"]')?.click())
      expect(container.querySelector("[data-workspace-utility-drawer]")?.getAttribute("data-workspace-utility-state")).toBe(
        "closed",
      )
      expect(container.querySelector("[data-workspace-utility-drawer]")?.getAttribute("style")).toContain("width: 0")
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")
      expect(container.textContent).toContain("Open Agent")
      expect(container.querySelector("[data-workspace-utility-entry-state]")?.getAttribute("aria-hidden")).toBeNull()
      expect(container.querySelector("[data-workspace-utility-entry-state]")?.hasAttribute("inert")).toBeFalse()

      await act(async () => {
        const openButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Open Agent",
        )
        openButton?.focus()
        openButton?.click()
      })
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")
      expect(container.querySelector("[data-workspace-utility-entry-state]")?.getAttribute("aria-hidden")).toBe("true")
      expect(container.querySelector("[data-workspace-utility-entry-state]")?.hasAttribute("inert")).toBeTrue()

      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
        await Promise.resolve()
      })
      expect(container.querySelector("[data-workspace-utility-drawer]")?.getAttribute("data-workspace-utility-state")).toBe(
        "closed",
      )
      expect(document.activeElement?.textContent).toBe("Open Agent")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("fails visibly when a scoped active utility has no eligible content", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={() => <div>Agent</div>}
        closeLabel="Close utilities"
        mode="inspector"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
        unavailableLabel="Inspector is no longer available."
      />,
    )

    expect(markup).toContain("Inspector is no longer available.")
    expect(markup).toContain('role="status"')
  })

  test("keeps floating overlay layouts non-modal while Sheet layouts remain modal", () => {
    const overlayMarkup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={() => <div>Agent</div>}
        closeLabel="Close utilities"
        mode="agent"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
        presentation="overlay"
      />,
    )
    const markup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={() => <div>Agent</div>}
        closeLabel="Close utilities"
        modal
        mode="agent"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
        presentation="sheet"
      />,
    )

    expect(overlayMarkup).not.toContain('role="dialog"')
    expect(overlayMarkup).not.toContain('aria-modal="true"')
    expect(overlayMarkup).not.toContain("workspace-utility-backdrop")
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain("bg-backdrop")
    expect(markup).toContain("workspace-utility-drawer--sheet")
    expect(markup).toContain('data-workspace-utility-presentation="sheet"')
  })

  test("keeps the compact entry mounted for coordinated motion while removing it from interaction", () => {
    const closedMarkup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={() => <div>Agent</div>}
        closeLabel="Close utilities"
        collapsedEntry={<button type="button">Open Agent</button>}
        mode="closed"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
        presentation="overlay"
      />,
    )
    const openMarkup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={() => <div>Agent</div>}
        closeLabel="Close utilities"
        collapsedEntry={<button type="button">Open Agent</button>}
        mode="agent"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
        presentation="overlay"
      />,
    )

    expect(closedMarkup).toContain('<div class="workspace-utility-entry" data-workspace-utility-entry-state="visible">')
    expect(openMarkup).toContain(
      '<div aria-hidden="true" class="workspace-utility-entry" data-workspace-utility-entry-state="hidden" inert="">',
    )
  })

  test("coordinates utility drawer and compact-entry motion with a reduced-motion terminal state", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()
    const entryRule = styles.match(/\.workspace-utility-entry \{[\s\S]*?\n\}/)?.[0] ?? ""
    const hiddenEntryRule =
      styles.match(/\.workspace-utility-entry\[data-workspace-utility-entry-state="hidden"\] \{[\s\S]*?\n\}/)?.[0] ?? ""

    expect(entryRule).toContain("position: absolute")
    expect(entryRule).toContain("inset: 0")
    expect(entryRule).toContain("pointer-events: none")
    expect(entryRule).toContain("opacity 300ms cubic-bezier(0.78, 0, 0.22, 1)")
    expect(entryRule).toContain("translate 300ms cubic-bezier(0.78, 0, 0.22, 1)")
    expect(hiddenEntryRule).toContain("translate: 16px 0")
    expect(hiddenEntryRule).toContain("visibility 0s linear 300ms")
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.workspace-utility-entry[\s\S]*transition-delay: 0ms;[\s\S]*transition-duration: 0ms;/,
    )
  })

  test("keeps the Sheet focus trapped, dismisses on Escape, and returns focus", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button data-utility-opener onClick={() => setOpen(true)} type="button">
            Open utilities
          </button>
          <WorkspaceUtilityDrawer
            agent={({ closeLabel, onClose }) => (
              <>
                <button type="button">Agent action</button>
                <WorkspaceUtilityCollapseButton label={closeLabel} onClose={onClose} />
              </>
            )}
            closeLabel="Close utilities"
            modal
            mode={open ? "agent" : "closed"}
            modes={modes}
            onClose={() => setOpen(false)}
            onModeChange={() => undefined}
            presentation="sheet"
          />
        </>
      )
    }

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<Harness />))

      const opener = container.querySelector<HTMLButtonElement>("[data-utility-opener]")!
      await act(async () => {
        opener.focus()
        opener.click()
        await Promise.resolve()
      })

      const drawer = container.querySelector<HTMLElement>("[data-workspace-utility-drawer]")!
      expect(drawer.contains(document.activeElement)).toBeTrue()
      expect(document.body.style.overflow).toBe("hidden")

      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
        await Promise.resolve()
      })

      expect(drawer.getAttribute("data-workspace-utility-state")).toBe("closed")
      expect(drawer.getAttribute("aria-hidden")).toBe("true")
      expect(drawer.querySelector('[data-workspace-utility-panel="agent"]')?.hasAttribute("hidden")).toBeFalse()
      expect(document.activeElement === opener).toBeTrue()
      expect(document.body.style.overflow).toBe("")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("restores the retained titlebar opener after the dock closes", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined

    function Harness() {
      const [drawerOpen, setDrawerOpen] = useState(false)
      const [openerHidden, setOpenerHidden] = useState(false)
      const openerRef = useRef<HTMLButtonElement>(null)
      return (
        <>
          <div aria-hidden={openerHidden || undefined} inert={openerHidden || undefined}>
            <button
              data-titlebar-agent
              onClick={() => {
                setOpenerHidden(true)
                setDrawerOpen(true)
              }}
              ref={openerRef}
              type="button"
            >
              Open Agent
            </button>
          </div>
          <WorkspaceUtilityDrawer
            agent={({ closeLabel, onClose }) => <WorkspaceUtilityCollapseButton label={closeLabel} onClose={onClose} />}
            closeLabel="Close utilities"
            mode={drawerOpen ? "agent" : "closed"}
            modes={modes}
            onClose={() => {
              setOpenerHidden(false)
              setDrawerOpen(false)
            }}
            onModeChange={() => undefined}
            presentation="dock"
            returnFocusTarget={openerRef.current}
          />
        </>
      )
    }

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<Harness />))
      const opener = container.querySelector<HTMLButtonElement>("[data-titlebar-agent]")!
      await act(async () => {
        opener.focus()
        opener.click()
        await Promise.resolve()
      })
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="Close utilities"]')?.click()
        await Promise.resolve()
      })

      expect(opener.closest("[inert]")).toBeNull()
      expect(document.activeElement === opener).toBeTrue()
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  for (const [initialPresentation, nextPresentation] of [
    ["dock", "overlay"],
    ["overlay", "dock"],
  ] as const) {
    test(`restores the external opener after ${initialPresentation} -> ${nextPresentation} -> close`, async () => {
      const restoreWindow = installTestWindow()
      let root: Root | undefined
      let changePresentation: (() => void) | undefined

      function Harness() {
        const [open, setOpen] = useState(false)
        const [presentation, setPresentation] = useState(initialPresentation)
        changePresentation = () => setPresentation(nextPresentation)
        return (
          <>
            <button data-utility-opener onClick={() => setOpen(true)} type="button">
              Open utilities
            </button>
            <WorkspaceUtilityDrawer
              agent={({ closeLabel, onClose }) => (
                <>
                  <button type="button">Agent action</button>
                  <WorkspaceUtilityCollapseButton label={closeLabel} onClose={onClose} />
                </>
              )}
              closeLabel="Close utilities"
              modal={presentation === "overlay"}
              mode={open ? "agent" : "closed"}
              modes={modes}
              onClose={() => setOpen(false)}
              onModeChange={() => undefined}
              presentation={presentation}
            />
          </>
        )
      }

      try {
        const container = document.createElement("div")
        document.body.append(container)
        root = createRoot(container)
        await act(async () => root?.render(<Harness />))

        const opener = container.querySelector<HTMLButtonElement>("[data-utility-opener]")!
        await act(async () => {
          opener.focus()
          opener.click()
          await Promise.resolve()
        })

        const drawer = container.querySelector<HTMLElement>("[data-workspace-utility-drawer]")!
        expect(drawer.contains(document.activeElement)).toBeTrue()

        await act(async () => {
          changePresentation?.()
          await Promise.resolve()
        })
        expect(drawer.getAttribute("data-workspace-utility-presentation")).toBe(nextPresentation)

        await act(async () => {
          container.querySelector<HTMLButtonElement>('button[aria-label="Close utilities"]')?.click()
          await Promise.resolve()
        })

        expect(drawer.getAttribute("data-workspace-utility-state")).toBe("closed")
        expect(drawer.getAttribute("aria-hidden")).toBe("true")
        expect(drawer.contains(document.activeElement)).toBeFalse()
        expect(document.activeElement).toBe(opener)
      } finally {
        if (root) await act(async () => root?.unmount())
        await restoreWindow()
      }
    })
  }

  test("defines floating open and close motion, Sheet motion, and reduced-motion overrides", async () => {
    const styles = await Bun.file(new URL("./styles.css", import.meta.url)).text()

    expect(styles).toContain("border-radius: 18px")
    expect(styles).toContain("var(--ui-surface-panel) 80%")
    expect(styles).toContain("blur(40px) saturate(150%)")
    expect(styles).toContain("0 8px 40px -12px rgb(0 0 0 / 50%)")
    expect(styles).toContain("300ms cubic-bezier(0.78, 0, 0.22, 1)")
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)")
    expect(styles).toContain('[data-workspace-utility-state="closed"]')
    expect(styles).toContain(".workspace-utility-drawer--sheet")
    expect(styles).toContain("visibility 0s linear 300ms")
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0ms/)
  })
})
