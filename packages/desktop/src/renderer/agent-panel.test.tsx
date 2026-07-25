import type { AgentMessage, AgentMessagePart } from "@convax/agent-runtime"
import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { ConversationTurnView, MessagePartView, routeAgentSkillOpen } from "./agent-panel"
import type { AgentConversationTurn } from "./agent-conversation-presentation"

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

describe("Agent conversation activity", () => {
  test("renders every tool call as a flat row whose detail appears only after a click", () => {
    const part: AgentMessagePart = {
      callId: "call-1",
      id: "tool-1",
      state: { input: { path: "README.md" }, output: "done", status: "completed", title: "Read file" },
      tool: "read",
      type: "tool",
    }
    const view = MessagePartView({ onOpenSkill: async () => undefined, part })

    expect(view?.type).toBe("details")
    if (!view) throw new Error("Expected the tool call disclosure to render")
    const markup = renderToStaticMarkup(view)
    expect(markup).not.toContain(' open=""')
    expect(markup).toContain("data-agent-tool-call")
    expect(markup).toContain("Read file")
    expect(markup).toContain("done")
    expect(markup).not.toContain('class="ml-5 mt-1 hidden')
    expect(markup).not.toContain("group-open/tool:block")
    expect(markup).not.toContain("group-hover/tool:block")
    expect(markup).not.toContain("group-focus-within/tool:block")
    expect(markup).not.toContain("border border-border")
    expect(markup).not.toContain("min-w-0 flex-1 truncate")
  })

  test("renders completed activity as an in-conversation collapsed duration row", () => {
    const part: AgentMessagePart = {
      callId: "call-1",
      id: "tool-1",
      state: { input: {}, output: "done", status: "completed", title: "Read file" },
      tool: "read",
      type: "tool",
    }
    const message: AgentMessage = {
      createdAt: 1,
      completedAt: 858_001,
      id: "assistant-1",
      parts: [part],
      role: "assistant",
      sessionId: "session-1",
    }
    const turn: AgentConversationTurn = {
      activity: [{ message, parts: [part] }],
      durationMs: 858_000,
      errors: [],
      id: "turn-1",
      interrupted: false,
      tools: { count: 1, failed: 0, outcome: "success", pending: 0, running: 0, succeeded: 1 },
    }

    const markup = renderToStaticMarkup(
      <ConversationTurnView busy={false} onOpenSkill={async () => undefined} turn={turn} />,
    )

    expect(markup).toContain('data-agent-activity="true"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain("Worked for 14m 18s")
    expect(markup).not.toContain("data-agent-tool-call")
  })

  test("keeps activity expanded while working or waiting for user input", () => {
    const reasoning: AgentMessagePart = { id: "reasoning-1", text: "Checking the project", type: "reasoning" }
    const message: AgentMessage = {
      createdAt: 1,
      id: "assistant-1",
      parts: [reasoning],
      role: "assistant",
      sessionId: "session-1",
    }
    const turn: AgentConversationTurn = {
      activity: [{ message, parts: [reasoning] }],
      errors: [],
      id: "turn-1",
      interrupted: true,
      tools: { count: 0, failed: 0, outcome: "none", pending: 0, running: 0, succeeded: 0 },
    }

    const markup = renderToStaticMarkup(
      <ConversationTurnView
        awaitingInput
        busy={false}
        onOpenSkill={async () => undefined}
        turn={turn}
      />,
    )

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain("Waiting for your response")
    expect(markup).not.toContain(">Interrupted<")
    expect(markup).toContain('data-agent-activity-content="true"')
    expect(markup).toContain("text-muted-foreground")
    expect(markup).not.toMatch(/(?:class="|\s)text-foreground(?:\s|")/)
  })

  test("auto-collapses when work finishes and still lets the user reopen the turn", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    let busy = true
    const reasoning: AgentMessagePart = { id: "reasoning-1", text: "Checking the project", type: "reasoning" }
    const message: AgentMessage = {
      createdAt: 1,
      completedAt: 2_001,
      id: "assistant-1",
      parts: [reasoning],
      role: "assistant",
      sessionId: "session-1",
    }
    const turn: AgentConversationTurn = {
      activity: [{ message, parts: [reasoning] }],
      durationMs: 2_000,
      errors: [],
      id: "turn-1",
      interrupted: false,
      tools: { count: 0, failed: 0, outcome: "none", pending: 0, running: 0, succeeded: 0 },
    }
    const renderTurn = () => (
      <ConversationTurnView busy={busy} onOpenSkill={async () => undefined} turn={turn} />
    )

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(renderTurn()))
      expect(document.querySelector("[data-agent-activity] button")?.getAttribute("aria-expanded")).toBe("true")

      busy = false
      await act(async () => root?.render(renderTurn()))
      expect(document.querySelector("[data-agent-activity] button")?.getAttribute("aria-expanded")).toBe("false")
      expect(document.body.textContent).toContain("Worked for 2s")
      expect(document.body.textContent).not.toContain("Checking the project")

      await act(async () => document.querySelector<HTMLElement>("[data-agent-activity] > button")?.click())
      expect(document.querySelector("[data-agent-activity] button")?.getAttribute("aria-expanded")).toBe("true")
      expect(document.body.textContent).toContain("Thought through the task")
      expect(document.body.textContent).toContain("Checking the project")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("renders a selected Skill as a clickable name without its instruction body", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const part: AgentMessagePart = { id: "skill-1", name: "review", type: "skill" }
    const onOpenSkill = mock(async () => undefined)

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(<MessagePartView onOpenSkill={onOpenSkill} part={part} />))

      const button = document.querySelector<HTMLButtonElement>('button[title="Open review Skill"]')
      expect(button?.textContent).toContain("review")
      await act(async () => button?.click())
      expect(onOpenSkill).toHaveBeenCalledWith("review")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("keeps Plugin tool details interactively expandable and falls back to input detail", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const part: AgentMessagePart = {
      callId: "call-plugin",
      id: "tool-plugin",
      state: { input: { pluginId: "example", prompt: "Generate" }, output: "", status: "completed", title: "Plugin" },
      tool: "plugin.generate",
      type: "tool",
    }
    const message: AgentMessage = {
      createdAt: 1,
      id: "assistant-plugin",
      parts: [part],
      role: "assistant",
      sessionId: "session-1",
    }
    const turn: AgentConversationTurn = {
      activity: [{ message, parts: [part] }],
      errors: [],
      id: "turn-plugin",
      interrupted: false,
      tools: { count: 1, failed: 0, outcome: "success", pending: 0, running: 0, succeeded: 1 },
    }

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <ConversationTurnView busy={false} onOpenSkill={async () => undefined} turn={turn} />,
        ),
      )

      expect(document.querySelector("[data-agent-tool-call]")).toBeNull()
      await act(async () =>
        document
          .querySelector("[data-agent-activity]")
          ?.dispatchEvent(new Event("pointerover", { bubbles: true })),
      )
      expect(document.querySelector("[data-agent-tool-call]")).toBeNull()
      await act(async () => document.querySelector<HTMLElement>("[data-agent-activity] > button")?.click())
      const disclosure = document.querySelector<HTMLDetailsElement>("[data-agent-tool-call]")
      expect(disclosure).not.toBeNull()
      expect(disclosure?.open).toBeFalse()
      await act(async () => disclosure?.querySelector("summary")?.click())
      expect(disclosure?.open).toBeTrue()
      expect(disclosure?.querySelector("pre")?.classList.contains("hidden")).toBeFalse()
      expect(disclosure?.textContent).toContain('"pluginId": "example"')
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })
})

describe("Agent composer source contract", () => {
  test("opens managed Skills in capability details and external Skills locally", async () => {
    const openLocal = mock(async () => undefined)
    const openManagedDetails = mock(async () => true)

    expect(await routeAgentSkillOpen("managed", "project-1", openManagedDetails, openLocal)).toBe("details")
    expect(openLocal).not.toHaveBeenCalled()

    const openExternalDetails = mock(async () => false)
    expect(await routeAgentSkillOpen("external", "project-1", openExternalDetails, openLocal)).toBe("local")
    expect(openLocal).toHaveBeenCalledWith({ name: "external", scopeId: "project-1" })
  })

  test("uses dedicated @ and $ composer triggers and structured resources", () => {
    const source = readFileSync(fileURLToPath(new URL("./agent-panel.tsx", import.meta.url)), "utf8")

    expect(source).toContain('aria-label="Reference Project or Canvas content"')
    expect(source).toContain('aria-label="Use a Skill"')
    expect(source).toContain("agentComposerResources(submittedDraft)")
    expect(source).toContain("window.convax.projectFiles.listDirectory")
    expect(source).toContain("window.convax.canvas.documents.load")
    expect(source).toContain("buildAgentProjectReferenceTree")
    expect(source).toContain("buildAgentCanvasReferenceTree")
    expect(source).toContain("await props.beforePrompt?.()")
    expect(source).toContain("requestTrackerRef.current.begin")
    expect(source).toContain("requestTrackerRef.current.invalidate()")
    expect(source).toContain("setCapabilitiesError(undefined)")
    expect(source).toContain("activeScopeRef.current === scope")
    expect(source).toContain("compositionControllerRef.current.start()")
    expect(source).toContain("compositionControllerRef.current.finish")
    expect(source).toMatch(
      /onKeyUp=\{\(event\) => \{[\s\S]*?compositionControllerRef\.current\.runWhenIdle\(updateComposerQuery\)/,
    )
    expect(source).toContain("onOpenSkill={openSkill}")
    expect(source).toContain("referenceStatusById={referenceStatusById}")
    expect(source).toContain("createAgentComposerPickerAnchor")
    expect(source).not.toContain("target.top - 324")
    expect(source).toContain("event.nativeEvent.isComposing")
    expect(source).toContain('event.key === "Escape"')
    expect(source).toContain('event.key === "Tab"')
    expect(source).toContain("aria-autocomplete")
    expect(source).toContain("aria-activedescendant")
    expect(source).toContain("captureAgentComposerSelection")
    expect(source).toContain("replaceComposerDraft(submittedDraft)")
    expect(source).toContain("button.disabled = interactionDisabled")
    expect(source).not.toContain("Hide agent activity")
    expect(source).not.toContain("Show agent activity")
    expect(source).not.toContain("findAgentSkillSlashQuery")
    expect(source).not.toContain('aria-label="Add context or Skill"')
  })
})

describe("Agent conversation visibility contract", () => {
  test("reports displayed content immediately and when the document becomes visible", () => {
    const source = readFileSync(fileURLToPath(new URL("./agent-panel.tsx", import.meta.url)), "utf8")
    expect(source).toContain("displayedAgentSession")
    expect(source).toContain('document.addEventListener("visibilitychange", reportDisplayed)')
  })
})
