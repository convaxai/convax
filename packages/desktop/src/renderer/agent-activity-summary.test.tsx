import type { AgentMessage, AgentMessagePart } from "@convax/agent-runtime"
import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentActivitySummary, describeAgentActivity, formatAgentActivityDuration } from "./agent-activity-summary"
import type { AgentConversationTurn } from "./agent-conversation-presentation"

function turn(
  options: {
    durationMs?: number
    errors?: string[]
    interrupted?: boolean
    tools?: Partial<AgentConversationTurn["tools"]>
  } = {},
): AgentConversationTurn {
  const part: AgentMessagePart = {
    callId: "call-1",
    id: "tool-1",
    state: { input: {}, output: "done", status: "completed", title: "Read file" },
    tool: "read",
    type: "tool",
  }
  const message: AgentMessage = {
    completedAt: 2,
    createdAt: 1,
    id: "assistant-1",
    parts: [part],
    role: "assistant",
    sessionId: "session-1",
  }
  return {
    activity: [{ message, parts: [part] }],
    durationMs: options.durationMs,
    errors: (options.errors ?? []).map((text) => ({ message, text })),
    id: "turn-1",
    interrupted: options.interrupted ?? false,
    tools: {
      count: 1,
      failed: 0,
      outcome: "success",
      pending: 0,
      running: 0,
      succeeded: 1,
      ...options.tools,
    },
  }
}

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

describe("Agent activity summary", () => {
  test("formats bounded, readable durations", () => {
    expect(formatAgentActivityDuration(undefined)).toBeUndefined()
    expect(formatAgentActivityDuration(-1)).toBeUndefined()
    expect(formatAgentActivityDuration(500)).toBe("<1s")
    expect(formatAgentActivityDuration(858_000)).toBe("14m 18s")
  })

  test("reports accurate completed and failed tool counts without calling a success a failure", () => {
    expect(describeAgentActivity(turn({ durationMs: 2_000 }), { busy: false })).toEqual({
      detail: "1 succeeded · 2s",
      label: "Activity complete",
      tone: "success",
    })
    expect(
      describeAgentActivity(
        turn({
          durationMs: 3_000,
          tools: { count: 3, failed: 1, outcome: "failure", succeeded: 2 },
        }),
        { busy: false },
      ),
    ).toEqual({
      detail: "2 succeeded · 1 failed · 3s",
      label: "Completed with errors",
      tone: "failure",
    })
  })

  test("keeps running activity collapsed while exposing live progress in text", () => {
    const markup = renderToStaticMarkup(
      <AgentActivitySummary
        busy
        turn={turn({
          tools: { count: 3, outcome: "running", running: 1, succeeded: 2 },
        })}
      >
        <div data-tool-log>Full tool log</div>
      </AgentActivitySummary>,
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain("Working")
    expect(markup).toContain("2 complete · 1 running")
    expect(markup).not.toContain("Full tool log")
  })

  test("keeps failures prominent while details remain keyboard-toggleable", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(
          <AgentActivitySummary turn={turn({ tools: { failed: 1, outcome: "failure", succeeded: 0 } })}>
            <div data-tool-log>Failure details</div>
          </AgentActivitySummary>,
        ),
      )
      const button = document.querySelector<HTMLButtonElement>("[data-agent-activity] > button")
      expect(button?.textContent).toContain("Completed with errors")
      expect(button?.getAttribute("aria-expanded")).toBe("false")
      expect(document.querySelector("[data-tool-log]")).toBeNull()

      await act(async () => button?.click())
      expect(button?.getAttribute("aria-expanded")).toBe("true")
      expect(document.querySelector("[data-tool-log]")?.textContent).toBe("Failure details")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })
})
