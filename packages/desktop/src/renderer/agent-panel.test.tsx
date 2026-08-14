import type { AgentMessage, AgentMessagePart } from "@convax/agent-runtime"
import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentRuntimeStatus, ConversationTurnView, MessagePartView, routeAgentSkillOpen } from "./agent-panel"
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

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("Agent conversation activity", () => {
  test("keeps an accessible activity status without visible OpenCode loading copy", () => {
    const idle = renderToStaticMarkup(
      <AgentRuntimeStatus runtimeBusy={false} stopping={false} submitting={false} />,
    )
    const running = renderToStaticMarkup(<AgentRuntimeStatus runtimeBusy stopping={false} submitting={false} />)
    const submitting = renderToStaticMarkup(
      <AgentRuntimeStatus runtimeBusy={false} stopping={false} submitting />,
    )
    const stopping = renderToStaticMarkup(
      <AgentRuntimeStatus runtimeBusy={false} stopping submitting={false} />,
    )

    expect(idle).toContain('data-agent-runtime-status="idle"')
    expect(idle).not.toContain("Submitting message")
    expect(idle).not.toContain("Response in progress")
    expect(idle).not.toContain("Stopping response")
    expect(idle).not.toContain("<svg")
    expect(running).toContain('aria-live="polite"')
    expect(running).toContain('data-agent-runtime-status="running"')
    expect(running).toContain('class="sr-only"')
    expect(running).toContain("Response in progress")
    expect(submitting).toContain('data-agent-runtime-status="submitting"')
    expect(submitting).toContain("Submitting message")
    expect(stopping).toContain('data-agent-runtime-status="stopping"')
    expect(stopping).toContain("Stopping response")
    expect(running).not.toContain("OpenCode is working")
    expect(submitting).not.toContain("OpenCode")
  })

  test("keeps streaming delivery visible without making the busy response its own live region", () => {
    const streamingPart: AgentMessagePart = { id: "text-1", text: "Partial response", type: "text" }
    const streamingMessage: AgentMessage = {
      createdAt: 1,
      id: "assistant-streaming",
      model: { modelId: "mimo-v2.5-free", providerId: "opencode" },
      parts: [streamingPart],
      role: "assistant",
      sessionId: "session-1",
    }
    const turn: AgentConversationTurn = {
      activity: [],
      delivery: { message: streamingMessage, parts: [streamingPart] },
      errors: [],
      id: "turn-streaming",
      interrupted: false,
      tools: { count: 0, failed: 0, outcome: "none", pending: 0, running: 0, succeeded: 0 },
    }

    const streamingMarkup = renderToStaticMarkup(
      <ConversationTurnView busy onOpenSkill={async () => undefined} turn={turn} />,
    )
    const readyMarkup = renderToStaticMarkup(
      <ConversationTurnView
        busy={false}
        onOpenSkill={async () => undefined}
        turn={{
          ...turn,
          delivery: {
            message: { ...streamingMessage, completedAt: 2 },
            parts: [streamingPart],
          },
        }}
      />,
    )
    const runningCompletedMarkup = renderToStaticMarkup(
      <ConversationTurnView
        busy={false}
        copyDisabled
        onOpenSkill={async () => undefined}
        turn={{
          ...turn,
          delivery: {
            message: { ...streamingMessage, completedAt: 2 },
            parts: [streamingPart],
          },
        }}
      />,
    )

    expect(streamingMarkup).toContain("Partial response")
    expect(streamingMarkup).toContain('data-agent-message-model="opencode/mimo-v2.5-free"')
    expect(streamingMarkup).toContain("opencode/mimo-v2.5-free")
    expect(streamingMarkup).toContain('aria-busy="true"')
    expect(streamingMarkup).toContain('aria-live="polite"')
    expect(streamingMarkup).toContain("data-agent-response-announcer")
    expect(streamingMarkup).not.toMatch(/<article[^>]*aria-live/)
    expect(streamingMarkup).not.toContain('aria-label="Copy response"')
    expect(readyMarkup).toContain('aria-busy="false"')
    expect(readyMarkup).not.toMatch(/<article[^>]*aria-live/)
    expect(readyMarkup).toContain('aria-label="Copy response"')
    expect(runningCompletedMarkup).not.toContain('aria-label="Copy response"')
  })

  test("keeps one announcer mounted for request, first chunk, delta, and completion", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const userMessage: AgentMessage = {
      createdAt: 1,
      id: "user-live",
      parts: [{ id: "user-text", text: "Stream it", type: "text" }],
      role: "user",
      sessionId: "session-live",
    }
    const baseTurn: AgentConversationTurn = {
      activity: [],
      errors: [],
      id: "turn-live",
      interrupted: false,
      tools: { count: 0, failed: 0, outcome: "none", pending: 0, running: 0, succeeded: 0 },
      user: { message: userMessage, parts: userMessage.parts },
    }
    const assistant = (value: string, completedAt?: number) => {
      const part: AgentMessagePart = { id: "assistant-text", text: value, type: "text" }
      const message: AgentMessage = {
        completedAt,
        createdAt: 2,
        id: "assistant-live",
        parts: [part],
        role: "assistant",
        sessionId: "session-live",
      }
      return { message, parts: [part] }
    }

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)

      await act(async () =>
        root?.render(<ConversationTurnView busy onOpenSkill={async () => undefined} turn={baseTurn} />),
      )
      const announcer = document.querySelector<HTMLElement>("[data-agent-response-announcer]")
      expect(announcer?.textContent).toBe("Agent response requested.")

      await act(async () =>
        root?.render(
          <ConversationTurnView
            busy
            onOpenSkill={async () => undefined}
            turn={{ ...baseTurn, delivery: assistant("First chunk") }}
          />,
        ),
      )
      expect(document.querySelector("[data-agent-response-announcer]")).toBe(announcer)
      expect(announcer?.textContent).toBe("Agent response started. First chunk")
      expect(document.querySelector("article[aria-busy=true]")?.hasAttribute("aria-live")).toBeFalse()

      await act(async () =>
        root?.render(
          <ConversationTurnView
            busy
            onOpenSkill={async () => undefined}
            turn={{ ...baseTurn, delivery: assistant("First chunk and more") }}
          />,
        ),
      )
      expect(announcer?.textContent).toBe("Agent response continued. and more")
      expect(announcer?.textContent).not.toContain("First chunk")

      await act(async () =>
        root?.render(
          <ConversationTurnView
            busy={false}
            onOpenSkill={async () => undefined}
            turn={{ ...baseTurn, delivery: assistant("First chunk and more done", 3) }}
          />,
        ),
      )
      expect(announcer?.textContent).toBe("Agent response complete. done")
      expect(document.querySelector("article[aria-busy=false]")?.hasAttribute("aria-live")).toBeFalse()
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("copies completed assistant text and reports success accessibly", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const writeText = mock(async (_text: string) => undefined)

    try {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      })
      const textPart: AgentMessagePart = { id: "text-copy", text: "Copy this response", type: "text" }
      const message: AgentMessage = {
        completedAt: 2,
        createdAt: 1,
        id: "assistant-copy",
        parts: [textPart],
        role: "assistant",
        sessionId: "session-1",
      }
      const turn: AgentConversationTurn = {
        activity: [],
        delivery: { message, parts: [textPart] },
        errors: [],
        id: "turn-copy",
        interrupted: false,
        tools: { count: 0, failed: 0, outcome: "none", pending: 0, running: 0, succeeded: 0 },
      }
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)

      await act(async () =>
        root?.render(<ConversationTurnView busy={false} onOpenSkill={async () => undefined} turn={turn} />),
      )
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy response"]')?.click())

      expect(writeText).toHaveBeenCalledWith("Copy this response")
      expect(document.querySelector("[data-agent-copy-status]")?.textContent).toBe("Copied")
      expect(document.querySelector('button[aria-label="Response copied"]')).not.toBeNull()
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("contains clipboard failure and offers a safe manual fallback", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const writeText = mock(async () => {
      throw new Error("clipboard details must stay private")
    })

    try {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      })
      const textPart: AgentMessagePart = { id: "text-copy-fail", text: "Copy safely", type: "text" }
      const message: AgentMessage = {
        completedAt: 2,
        createdAt: 1,
        id: "assistant-copy-fail",
        parts: [textPart],
        role: "assistant",
        sessionId: "session-1",
      }
      const turn: AgentConversationTurn = {
        activity: [],
        delivery: { message, parts: [textPart] },
        errors: [],
        id: "turn-copy-fail",
        interrupted: false,
        tools: { count: 0, failed: 0, outcome: "none", pending: 0, running: 0, succeeded: 0 },
      }
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)

      await act(async () =>
        root?.render(<ConversationTurnView busy={false} onOpenSkill={async () => undefined} turn={turn} />),
      )
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy response"]')?.click())

      const status = document.querySelector("[data-agent-copy-status]")?.textContent
      expect(status).toContain("Select the response text and copy it manually")
      expect(status).not.toContain("clipboard details")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("ignores deferred clipboard completion after scope replacement, a new run, and unmount", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    const firstCopy = deferred<void>()
    const secondCopy = deferred<void>()
    const thirdCopy = deferred<void>()
    const requests = [firstCopy, secondCopy, thirdCopy]
    const writeText = mock(() => requests.shift()?.promise ?? Promise.resolve())
    const turn = (sessionId: string, value: string): AgentConversationTurn => {
      const part: AgentMessagePart = { id: "same-part", text: value, type: "text" }
      const message: AgentMessage = {
        completedAt: 2,
        createdAt: 1,
        id: "same-message",
        parts: [part],
        role: "assistant",
        sessionId,
      }
      return {
        activity: [],
        delivery: { message, parts: [part] },
        errors: [],
        id: "same-turn",
        interrupted: false,
        tools: { count: 0, failed: 0, outcome: "none", pending: 0, running: 0, succeeded: 0 },
      }
    }

    try {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      })
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)

      await act(async () =>
        root?.render(
          <ConversationTurnView
            busy={false}
            key="project-a:session-shared:same-turn"
            onOpenSkill={async () => undefined}
            turn={turn("session-shared", "Old project response")}
          />,
        ),
      )
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy response"]')?.click())
      await act(async () =>
        root?.render(
          <ConversationTurnView
            busy={false}
            key="project-b:session-shared:same-turn"
            onOpenSkill={async () => undefined}
            turn={turn("session-shared", "Current project response")}
          />,
        ),
      )
      await act(async () => {
        firstCopy.resolve()
        await firstCopy.promise
      })
      expect(document.body.textContent).toContain("Current project response")
      expect(document.querySelector("[data-agent-copy-status]")).toBeNull()

      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy response"]')?.click())
      await act(async () =>
        root?.render(
          <ConversationTurnView
            busy={false}
            copyDisabled
            key="project-b:session-shared:same-turn"
            onOpenSkill={async () => undefined}
            turn={turn("session-shared", "Current project response")}
          />,
        ),
      )
      await act(async () => {
        secondCopy.resolve()
        await secondCopy.promise
      })
      await act(async () =>
        root?.render(
          <ConversationTurnView
            busy={false}
            key="project-b:session-shared:same-turn"
            onOpenSkill={async () => undefined}
            turn={turn("session-shared", "Current project response")}
          />,
        ),
      )
      expect(document.querySelector("[data-agent-copy-status]")).toBeNull()
      expect(document.querySelector('button[aria-label="Copy response"]')).not.toBeNull()

      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy response"]')?.click())
      await act(async () => root?.unmount())
      root = undefined
      await act(async () => {
        thirdCopy.resolve()
        await thirdCopy.promise
      })
      expect(document.body.textContent).toBe("")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

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
    expect(markup).toContain('data-agent-tool-state="success"')
    expect(markup).toContain("Completed")
    expect(markup).toContain("agent-tool-call__detail")
  })

  test("labels typed queued, running, completed, failed, and interrupted tool states", () => {
    const renderTool = (state: Extract<AgentMessagePart, { type: "tool" }>["state"], interrupted = false) =>
      renderToStaticMarkup(
        <MessagePartView
          interrupted={interrupted}
          onOpenSkill={async () => undefined}
          part={{ callId: "call", id: "tool", state, tool: "example", type: "tool" }}
        />,
      )

    expect(renderTool({ input: {}, status: "pending" })).toContain('data-agent-tool-state="pending"')
    expect(renderTool({ input: {}, status: "pending" })).toContain("Queued")
    expect(renderTool({ input: {}, status: "running", title: "Run" })).toContain('data-agent-tool-state="running"')
    expect(renderTool({ input: {}, output: "ok", status: "completed", title: "Done" })).toContain(
      'data-agent-tool-state="success"',
    )
    expect(renderTool({ error: "failed", input: {}, status: "error" })).toContain('data-agent-tool-state="failure"')
    const cancelled = renderTool({ error: "host-safe terminal detail", input: {}, status: "error" }, true)
    expect(cancelled).toContain('data-agent-tool-state="cancelled"')
    expect(cancelled).toContain("Cancelled")
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
    expect(markup).toContain("Activity complete")
    expect(markup).toContain("1 succeeded · 14m 18s")
    expect(markup).not.toContain("data-agent-tool-call")
  })

  test("keeps active status prominent without expanding the full log", () => {
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
      <ConversationTurnView awaitingInput busy={false} onOpenSkill={async () => undefined} turn={turn} />,
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain("Needs your response")
    expect(markup).not.toContain(">Interrupted<")
    expect(markup).not.toContain('data-agent-activity-content="true"')
    expect(markup).toContain("text-text-tertiary")
    expect(markup).not.toMatch(/(?:class="|\s)text-text-primary(?:\s|")/)
  })

  test("starts collapsed while working and still lets the user reveal activity after completion", async () => {
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
    const renderTurn = () => <ConversationTurnView busy={busy} onOpenSkill={async () => undefined} turn={turn} />

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(renderTurn()))
      expect(document.querySelector("[data-agent-activity] button")?.getAttribute("aria-expanded")).toBe("false")

      busy = false
      await act(async () => root?.render(renderTurn()))
      expect(document.querySelector("[data-agent-activity] button")?.getAttribute("aria-expanded")).toBe("false")
      expect(document.body.textContent).toContain("Activity complete")
      expect(document.body.textContent).toContain("2s")
      expect(document.body.textContent).not.toContain("Checking the project")

      await act(async () => document.querySelector<HTMLElement>("[data-agent-activity] > button")?.click())
      expect(document.querySelector("[data-agent-activity] button")?.getAttribute("aria-expanded")).toBe("true")
      expect(document.body.textContent).toContain("Activity complete")
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
        root?.render(<ConversationTurnView busy={false} onOpenSkill={async () => undefined} turn={turn} />),
      )

      expect(document.querySelector("[data-agent-tool-call]")).toBeNull()
      await act(async () =>
        document.querySelector("[data-agent-activity]")?.dispatchEvent(new Event("pointerover", { bubbles: true })),
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
    const styles = readFileSync(fileURLToPath(new URL("./agent-panel.css", import.meta.url)), "utf8")

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
    expect(source).toContain("data-agent-drawer-collapsed")
    expect(source).toContain("props.collapsedEntry === false")
    expect(source).not.toContain("style={{ width: props.layout?.collapsedWidth }}")
    expect(source).toContain("const hosted = !embedded && props.hosted === true")
    expect(source).toContain("const open = hosted || embedded || props.layout?.open === true")
    expect(source).toContain("data-agent-panel-hosted={hosted || undefined}")
    expect(source).toContain("!embedded && !hosted && props.layout?.resizable !== false")
    expect(source).toContain("collapse={hosted}")
    expect(source).toContain("hosted ? props.utilityOnClose")
    expect(source).toContain("utilityNavigation={hosted ? props.utilityNavigation : undefined}")
    expect(source).toContain("withAgentStoppingState")
    expect(source).toContain("isCurrentScope,")
    expect(source).toContain("key={`${conversationScope}:${sessionId}:${turn.id}`}")
    expect(source).toContain('aria-label={responseStopping ? "Stopping response" : "Stop response"}')
    expect(source).toContain("disabled={responseStopping}")
    expect(source).toContain('import "./agent-panel.css"')
    expect(source).toContain("loading && !sessionState")
    expect(source).toContain('label="Loading conversation…"')
    expect(source).toContain("props.loading && props.sessions.length === 0")
    expect(source).toContain('label="Loading…"')
    expect(source).toContain("LoadingSpinner")
    expect(source).toContain('data-agent-composer-action="reference"')
    expect(source).toContain('data-agent-composer-action="skill"')
    expect(source).toContain('data-agent-composer-action="model"')
    expect(source).toContain('<Bot className="size-3.5 shrink-0" />')
    expect(source).toContain("const modelPickerDisabled = runtimeBusy || responseStopping || creatingSession || submitting")
    expect(source).toContain("disabled={!props.projectId || modelPickerDisabled}")
    expect(source).toContain("data-agent-composer-editor")
    expect(source).toContain("modelPickerRef.current")
    expect(source).toContain(
      "shouldDismissAgentResourcePicker(modelPickerAnchorRef.current, event.target, modelPickerRef.current)",
    )
    expect(source).toContain("onElementChange={setModelPickerElement}")
    expect(source).toContain("data-agent-runtime-state")
    expect(source).toContain("revalidateAgentSendCatalogs")
    expect(source).toContain("sharedGenerationController.refresh()")
    expect(source).toContain("reconcileReady: false")
    expect(source).toContain("refreshShared: true")
    expect(source).toContain("throwOnError: true")
    expect(source).toContain(
      "reconcileToolInputValues(result.fields, current, cachedDescription?.toolId !== selectedId)",
    )
    expect(source).toContain("generationToolInputOwnerRef.current !== generationToolInputOwner")
    expect(source).toContain("if (ownerChanged) setGenerationToolInput({})")
    expect(source).not.toContain(
      "[generationDescriptionScope, props.projectId, selectedGenerationTool, sharedGenerationController]",
    )
    expect(styles).toContain("--agent-composer-radius: 24px")
    expect(styles).toContain("--agent-message-enter-duration: 150ms")
    expect(styles).toContain('.agent-composer-frame[data-agent-composer-state="running"]::before')
    expect(source).toContain("data-agent-composer-disabled")
    expect(source).toContain("data-agent-composer-has-content")
    expect(styles).toContain(".agent-composer-frame:focus-within")
    expect(styles).toContain('.agent-composer-frame[data-agent-composer-state="submitting"]::before')
    expect(styles).toContain('.agent-composer-frame[data-agent-composer-disabled="true"]')
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)")
    expect(styles).not.toContain("transition: all")
  })

  test("keeps IME composition from dispatching Enter as a prompt", () => {
    const source = readFileSync(fileURLToPath(new URL("./agent-panel.tsx", import.meta.url)), "utf8")

    expect(source).toMatch(
      /onKeyDown=\{\(event\) => \{[\s\S]*?event\.nativeEvent\.isComposing[\s\S]*?return[\s\S]*?event\.key === "Enter"[\s\S]*?void send\(\)/,
    )
  })
})

describe("Agent conversation visibility contract", () => {
  test("reports displayed content immediately and when the document becomes visible", () => {
    const source = readFileSync(fileURLToPath(new URL("./agent-panel.tsx", import.meta.url)), "utf8")
    expect(source).toContain("displayedAgentSession")
    expect(source).toContain('document.addEventListener("visibilitychange", reportDisplayed)')
  })
})
