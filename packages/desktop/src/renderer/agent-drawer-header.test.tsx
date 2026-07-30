import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentDrawerHeader, AgentDrawerTrigger } from "./agent-drawer-header"
import type { AgentCompactStatus } from "./agent-panel-state"

const idle: AgentCompactStatus = { kind: "idle", label: "Idle" }

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
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

describe("Agent drawer header", () => {
  test("communicates status with text and exposes every drawer action by accessible name", () => {
    const markup = renderToStaticMarkup(
      <AgentDrawerHeader
        createDisabled={false}
        historyVisible={false}
        onClose={() => undefined}
        onCreate={() => undefined}
        onHistory={() => undefined}
        status={{ detail: "Waiting for permission", kind: "needs-approval", label: "Needs approval" }}
        title="Atlas Agent"
        toolCount={12}
      />,
    )

    expect(markup).toContain("Atlas Agent")
    expect(markup).toContain("Needs approval")
    expect(markup).toContain("12 tools")
    expect(markup).toContain('aria-label="Conversation history"')
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('aria-label="New conversation"')
    expect(markup).toContain('aria-label="Close agent"')
    expect(markup).toContain("h-10")
    expect(markup).toContain("size-7")
    expect(markup).not.toContain("shadow-[0_1px_0")
  })

  test("composes utility navigation into the same header without losing Agent identity", () => {
    const markup = renderToStaticMarkup(
      <AgentDrawerHeader
        closeLabel="Close utilities"
        collapse
        createDisabled={false}
        historyVisible
        onClose={() => undefined}
        onCreate={() => undefined}
        onHistory={() => undefined}
        status={{ kind: "working", label: "Working" }}
        title="Atlas Agent"
        toolCount={8}
        utilityNavigation={<div data-utility-navigation>Agent Generate Inspector</div>}
      />,
    )

    expect(markup).toContain("data-utility-navigation")
    expect(markup).toContain('aria-label="Close utilities"')
    expect(markup).toContain("Atlas Agent")
    expect(markup).toContain("Working")
    expect(markup).toContain("8 tools")
    expect(markup).toContain("h-7")
    expect(markup).toContain("border-border-subtle")
    expect(markup).toContain('data-workspace-utility-close=""')
    expect(markup).toContain("lucide-panel-right-close")
    expect(markup).not.toContain("lucide-chevron-right")
    expect(markup.match(/Atlas Agent/g)).toHaveLength(1)
  })

  test("opens from a compact entry without reserving a collapsed sidebar", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const onOpen = mock(() => undefined)
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(<AgentDrawerTrigger onOpen={onOpen} status={{ kind: "working", label: "Working" }} />),
      )

      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Open agent"]')
      expect(button?.textContent).not.toContain("Working")
      expect(document.querySelector('[role="status"]')?.textContent).toContain("Agent status: Working")
      expect(button?.closest("[data-agent-drawer-entry]")?.getAttribute("style")).toBeNull()
      await act(async () => button?.click())
      expect(onOpen).toHaveBeenCalledTimes(1)
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("keeps an icon-only idle entry accessible through its name and live status", () => {
    const markup = renderToStaticMarkup(<AgentDrawerTrigger onOpen={() => undefined} status={idle} />)
    expect(markup).toContain("Idle")
    expect(markup).toContain('aria-label="Open agent"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain("lucide-panel-right-open")
    expect(markup).not.toContain("lucide-bot")
    expect(markup).not.toContain("shadow")
  })

  test("keeps the titlebar opener mounted but inert while the Agent dock is open", () => {
    const markup = renderToStaticMarkup(<AgentDrawerTrigger hidden onOpen={() => undefined} status={idle} />)

    expect(markup).toContain('data-agent-drawer-entry-state="hidden"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain("inert")
    expect(markup).toContain("invisible opacity-0")
  })
})
