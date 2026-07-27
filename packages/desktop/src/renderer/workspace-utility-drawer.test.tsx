import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { WorkspaceUtilityDrawer, type WorkspaceUtilityActiveMode } from "./workspace-utility-drawer"

const modes = [
  { label: "Agent", value: "agent" },
  { label: "Generate", value: "generate" },
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
  test("renders one active utility while retaining the Agent slot and caller-owned width", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={({ modeNavigation }) => (
          <div>
            {modeNavigation}
            Agent session
          </div>
        )}
        closeLabel="Close utilities"
        generate={<div>Generate composer</div>}
        inspector={<div>Inspector details</div>}
        mode="generate"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
        style={{ maxWidth: 620, width: 380 }}
      />,
    )

    expect(markup).toContain('data-workspace-utility-mode="generate"')
    expect(markup).toContain("max-width:620px")
    expect(markup).toContain("width:380px")
    expect(markup).toContain('data-workspace-utility-panel="agent"')
    expect(markup).toContain("Agent session")
    expect(markup).toContain('data-workspace-utility-panel="generate"')
    expect(markup).toContain("Generate composer")
    expect(markup).not.toContain("Inspector details")
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(2)
    expect(markup.match(/role="tablist"/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="Close utilities"')
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
          generate={<div>Generate composer</div>}
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
        [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Change draft",
        )?.click(),
      )
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")

      const generateTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === "Generate",
      )
      await act(async () => {
        generateTab?.focus()
        generateTab?.click()
      })
      expect(document.activeElement).toBe(generateTab ?? null)
      expect(container.querySelector('[data-workspace-utility-panel="agent"]')?.hasAttribute("hidden")).toBeTrue()
      expect(container.querySelector('[data-workspace-utility-panel="generate"]')?.hasAttribute("hidden")).toBeFalse()
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")

      const agentTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === "Agent",
      )
      await act(async () => {
        agentTab?.focus()
        agentTab?.click()
      })
      expect(document.activeElement).toBe(agentTab ?? null)
      expect(container.querySelector('[data-workspace-utility-panel="agent"]')?.hasAttribute("hidden")).toBeFalse()
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")

      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Close utilities"]')?.click(),
      )
      expect(container.querySelector("[data-workspace-utility-drawer]")?.hasAttribute("hidden")).toBeTrue()
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")
      expect(container.textContent).toContain("Open Agent")

      await act(async () => {
        const openButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Open Agent",
        )
        openButton?.focus()
        openButton?.click()
      })
      expect(container.querySelector("[data-agent-state]")?.getAttribute("data-agent-state")).toBe("1")

      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
        await Promise.resolve()
      })
      expect(container.querySelector("[data-workspace-utility-drawer]")?.hasAttribute("hidden")).toBeTrue()
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

  test("uses dialog semantics and a dismissing backdrop for overlay layouts", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceUtilityDrawer
        agent={() => <div>Agent</div>}
        closeLabel="Close utilities"
        modal
        mode="agent"
        modes={modes}
        onClose={() => undefined}
        onModeChange={() => undefined}
      />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain("bg-backdrop")
  })
})
