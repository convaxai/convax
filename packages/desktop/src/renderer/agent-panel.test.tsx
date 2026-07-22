import type { AgentMessage, AgentMessagePart } from "@convax/agent-runtime"
import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentActivityNotice, ConversationTurnView, MessagePartView } from "./agent-panel"
import type { AgentConversationTurn } from "./agent-conversation-presentation"

describe("Agent conversation activity", () => {
  test("makes a hidden interrupted-run notice directly reveal activity", () => {
    const onShowActivity = mock(() => undefined)
    const notice = AgentActivityNotice({ failed: 2, interrupted: true, onShowActivity })

    expect(notice.type).toBe("button")
    ;(notice.props as { onClick: () => void }).onClick()
    expect(onShowActivity).toHaveBeenCalledTimes(1)
    expect(renderToStaticMarkup(notice)).toContain(
      "Earlier run was interrupted · 2 tool calls failed. Show activity for details.",
    )
  })

  test("renders every tool call as a closed disclosure with inspectable detail", () => {
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
    expect((view.props as { open?: boolean }).open).toBeUndefined()
    const markup = renderToStaticMarkup(view)
    expect(markup).toContain("data-agent-tool-call")
    expect(markup).toContain("Read file")
    expect(markup).toContain("done")
  })

  test("renders revealed activity without another closed disclosure gate", () => {
    const part: AgentMessagePart = {
      callId: "call-1",
      id: "tool-1",
      state: { error: "failed", input: {}, status: "error" },
      tool: "glob",
      type: "tool",
    }
    const message: AgentMessage = {
      createdAt: 1,
      id: "assistant-1",
      parts: [part],
      role: "assistant",
      sessionId: "session-1",
    }
    const turn: AgentConversationTurn = {
      activity: [{ message, parts: [part] }],
      errors: [],
      id: "turn-1",
      interrupted: true,
      tools: { count: 1, failed: 1, outcome: "failure", pending: 0, running: 0, succeeded: 0 },
    }

    const markup = renderToStaticMarkup(
      <ConversationTurnView
        busy={false}
        onOpenSkill={async () => undefined}
        onShowActivity={() => undefined}
        showActivity
        turn={turn}
      />,
    )

    expect(markup).toMatch(/<div[^>]*data-agent-activity/)
    expect(markup).not.toMatch(/<details[^>]*data-agent-activity/)
    expect(markup).toContain("data-agent-tool-call")
    expect(markup).toContain("Interrupted activity")
  })

  test("does not label a turn interrupted while it is waiting for user input", () => {
    const turn: AgentConversationTurn = {
      activity: [],
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
        onShowActivity={() => undefined}
        showActivity={false}
        turn={turn}
      />,
    )

    expect(markup).not.toContain("Earlier run was interrupted")
  })
})

describe("Agent composer source contract", () => {
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
    expect(source).toContain("event.nativeEvent.isComposing")
    expect(source).toContain('event.key === "Escape"')
    expect(source).toContain('event.key === "Tab"')
    expect(source).toContain("aria-autocomplete")
    expect(source).toContain("aria-activedescendant")
    expect(source).toContain("captureAgentComposerSelection")
    expect(source).toContain("replaceComposerDraft(submittedDraft)")
    expect(source).toContain("button.disabled = interactionDisabled")
    expect(source).not.toContain("findAgentSkillSlashQuery")
    expect(source).not.toContain('aria-label="Add context or Skill"')
  })
})
