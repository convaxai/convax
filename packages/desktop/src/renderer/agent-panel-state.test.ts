import type { AgentResource, AgentSession } from "@convax/agent-runtime"
import { describe, expect, mock, test } from "bun:test"
import {
  AgentSessionStateRequestTracker,
  canvasAgentResource,
  EmbeddedConversationSessionCache,
  containEmbeddedResourceDrag,
  embeddedConversationSessionKey,
  embeddedConversationTitle,
  embeddedConversationTitlePrefix,
  displayedAgentSession,
  filterStandaloneAgentSessions,
  forgetStaleEmbeddedConversation,
  agentSessionContentKey,
  isAgentScrollNearBottom,
  mergeAgentResources,
  selectAgentSessionAfterRefresh,
  resolveAgentCompactStatus,
  type StorageLike,
  withAgentStoppingState,
} from "./agent-panel-state"

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function session(id: string, title: string): AgentSession {
  return {
    createdAt: 1,
    directory: "/project",
    id,
    title,
    updatedAt: 1,
  }
}

describe("mergeAgentResources", () => {
  test("deduplicates resources while preserving group priority", () => {
    const locked: AgentResource[] = [
      { kind: "file", name: "Locked name", path: "/project/readme.md" },
      { kind: "resource", name: "Current canvas", uri: "convax://canvas/canvas-1" },
      { kind: "resource", name: "Node context", uri: "convax://canvas/canvas-1/node/node-1" },
    ]
    const attached: AgentResource[] = [
      { kind: "file", name: "User name", path: "/project/readme.md" },
      { kind: "directory", path: "/project/src" },
      { kind: "skill", name: "review" },
      { kind: "skill", name: "review" },
      { kind: "resource", name: "Duplicate node", uri: "convax://canvas/canvas-1/node/node-1" },
    ]

    expect(mergeAgentResources(locked, attached)).toEqual([locked[0], locked[1], locked[2], attached[1], attached[2]])
  })

  test("does not mutate any input group", () => {
    const first: AgentResource[] = [{ kind: "file", path: "/project/a.ts" }]
    const second: AgentResource[] = [{ kind: "file", path: "/project/b.ts" }]

    mergeAgentResources(first, second)

    expect(first).toEqual([{ kind: "file", path: "/project/a.ts" }])
    expect(second).toEqual([{ kind: "file", path: "/project/b.ts" }])
  })
})

describe("embedded resource drag containment", () => {
  test("stops every handled drag phase only for embedded panels", () => {
    const embeddedStop = mock(() => undefined)
    const standaloneStop = mock(() => undefined)

    for (const phase of ["dragenter", "dragleave", "dragover", "drop"]) {
      containEmbeddedResourceDrag(true, { stopPropagation: embeddedStop })
      containEmbeddedResourceDrag(false, { stopPropagation: standaloneStop })
      expect(phase).toBeString()
    }

    expect(embeddedStop).toHaveBeenCalledTimes(4)
    expect(standaloneStop).not.toHaveBeenCalled()
  })

  test("encodes a dragged canvas as a host-owned structured resource", () => {
    expect(canvasAgentResource({ id: "canvas/a b", name: "Main" })).toEqual({
      kind: "resource",
      name: "Main",
      uri: "convax://canvas/canvas%2Fa%20b",
    })
  })
})

describe("EmbeddedConversationSessionCache", () => {
  test("isolates session ids by both scope and conversation key", () => {
    const cache = new EmbeddedConversationSessionCache()
    cache.remember("project-a", "node-1", "session-a-1")
    cache.remember("project-a", "node-2", "session-a-2")
    cache.remember("project-b", "node-1", "session-b-1")

    expect(cache.get("project-a", "node-1")).toBe("session-a-1")
    expect(cache.get("project-a", "node-2")).toBe("session-a-2")
    expect(cache.get("project-b", "node-1")).toBe("session-b-1")
  })

  test("restores mappings and embedded ids after a renderer restart", () => {
    const storage = new MemoryStorage()
    const firstRenderer = new EmbeddedConversationSessionCache(storage)
    firstRenderer.remember("project-a", "node-1", "session-a")

    const nextRenderer = new EmbeddedConversationSessionCache(storage)

    expect(nextRenderer.get("project-a", "node-1")).toBe("session-a")
    expect(nextRenderer.hasSessionId("session-a")).toBeTrue()
  })

  test("restarts one embedded conversation without exposing its previous session", () => {
    const cache = new EmbeddedConversationSessionCache()
    cache.remember("project-a", "node-1", "session-old")
    cache.remember("project-a", "node-1", "session-new")

    expect(cache.get("project-a", "node-1")).toBe("session-new")
    expect(cache.hasSessionId("session-old")).toBeTrue()
    expect(cache.hasSessionId("session-new")).toBeTrue()
  })

  test("ignores malformed persisted data", () => {
    const storage = new MemoryStorage()
    storage.setItem("test-key", "not-json")

    expect(new EmbeddedConversationSessionCache(storage, "test-key").get("project-a", "node-1")).toBeUndefined()
  })

  test("does not cache an embedded conversation without an explicit key", () => {
    const cache = new EmbeddedConversationSessionCache()
    cache.remember("project-a", undefined, "session-a")

    expect(cache.get("project-a", undefined)).toBeUndefined()
    expect(embeddedConversationSessionKey("project-a", undefined)).toBeUndefined()
  })

  test("uses an unambiguous composite key", () => {
    expect(embeddedConversationSessionKey("a:b", "c")).not.toBe(embeddedConversationSessionKey("a", "b:c"))
  })

  test("forgets only the matching stale mapping but retains its hidden id", () => {
    const storage = new MemoryStorage()
    const cache = new EmbeddedConversationSessionCache(storage)
    cache.remember("project-a", "node-1", "session-a")

    expect(forgetStaleEmbeddedConversation(cache, "project-a", "node-1", "other-session")).toBeFalse()
    expect(forgetStaleEmbeddedConversation(cache, "project-a", "node-1", "session-a")).toBeTrue()
    expect(cache.get("project-a", "node-1")).toBeUndefined()
    expect(cache.hasSessionId("session-a")).toBeTrue()

    const restored = new EmbeddedConversationSessionCache(storage)
    expect(restored.get("project-a", "node-1")).toBeUndefined()
    expect(restored.hasSessionId("session-a")).toBeTrue()
  })
})

describe("embedded session visibility", () => {
  test("uses a reserved title prefix for newly created embedded sessions", () => {
    expect(embeddedConversationTitle("canvas-1:node-1")).toStartWith(embeddedConversationTitlePrefix)
  })

  test("filters sessions by both recorded id and reserved title", () => {
    const cache = new EmbeddedConversationSessionCache()
    cache.remember("project-a", "node-1", "recorded-embedded")
    const sessions = [
      session("normal", "Project chat"),
      session("recorded-embedded", "Untitled"),
      session("title-embedded", embeddedConversationTitle("another node")),
    ]

    expect(filterStandaloneAgentSessions(sessions, cache).map((item) => item.id)).toEqual(["normal"])
  })
})

describe("parallel session presentation", () => {
  const sessions = [session("latest", "Latest"), session("background", "Background")]

  test("background completion never steals a still-valid current selection", () => {
    expect(selectAgentSessionAfterRefresh(sessions, "latest", "background")).toBe("latest")
    expect(selectAgentSessionAfterRefresh(sessions, undefined, "background")).toBe("background")
  })

  test("falls back only when the selected session disappeared", () => {
    expect(selectAgentSessionAfterRefresh(sessions, "missing", "also-missing")).toBe("latest")
  })
})

describe("compact Agent status", () => {
  test("prioritizes actionable input, active work, failure, and explicit pending changes", () => {
    expect(
      resolveAgentCompactStatus({
        failed: true,
        interaction: "permission",
        pendingChanges: true,
        working: true,
      }),
    ).toEqual({
      detail: "Permission required",
      kind: "needs-approval",
      label: "Needs approval",
    })
    expect(resolveAgentCompactStatus({ failed: true, pendingChanges: true, working: true })).toEqual({
      kind: "working",
      label: "Working",
    })
    expect(resolveAgentCompactStatus({ failed: true, pendingChanges: true })).toEqual({
      kind: "failed",
      label: "Failed",
    })
    expect(resolveAgentCompactStatus({ pendingChanges: true })).toEqual({
      kind: "pending-changes",
      label: "Changes ready",
    })
    expect(resolveAgentCompactStatus({})).toEqual({ kind: "idle", label: "Idle" })
  })

  test("distinguishes a question from a permission using visible text", () => {
    expect(resolveAgentCompactStatus({ interaction: "question" }).detail).toBe("Answer required")
    expect(resolveAgentCompactStatus({ interaction: "permission" }).detail).toBe("Permission required")
  })
})

describe("agent message scrolling", () => {
  test("follows only when the viewport is genuinely near the bottom", () => {
    expect(isAgentScrollNearBottom({ clientHeight: 400, scrollHeight: 1_000, scrollTop: 584 })).toBeTrue()
    expect(isAgentScrollNearBottom({ clientHeight: 400, scrollHeight: 1_000, scrollTop: 550 })).toBeFalse()
  })

  test("uses a stable key for equivalent polling results", () => {
    const state = {
      messages: [],
      pendingPermissions: [],
      pendingQuestions: [],
      session: session("one", "One"),
      status: { type: "busy" as const },
    }
    expect(agentSessionContentKey(state)).toBe(agentSessionContentKey(structuredClone(state)))
    expect(agentSessionContentKey({ ...state, status: { type: "idle" } })).not.toBe(agentSessionContentKey(state))
  })
})

describe("Agent abort presentation state", () => {
  test("settles local stopping state after abort completion and failure", async () => {
    const completedStates: boolean[] = []
    expect(
      await withAgentStoppingState(
        (stopping) => completedStates.push(stopping),
        async () => "aborted",
      ),
    ).toBe("aborted")
    expect(completedStates).toEqual([true, false])

    const failedStates: boolean[] = []
    const failure = await withAgentStoppingState(
      (stopping) => failedStates.push(stopping),
      async () => {
        throw new Error("abort failed")
      },
    ).then(
      () => "resolved",
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
    )
    expect(failure).toBe("abort failed")
    expect(failedStates).toEqual([true, false])
  })

  test("does not let a deferred abort settle a replacement scope or an unmounted panel", async () => {
    let resolveAbort: () => void = () => undefined
    const abortRequest = new Promise<void>((resolve) => {
      resolveAbort = () => resolve()
    })
    let oldScopeIsCurrent = true
    let displayedStopping = false
    const pending = withAgentStoppingState(
      (stopping) => {
        displayedStopping = stopping
      },
      () => abortRequest,
      () => oldScopeIsCurrent,
    )

    expect(displayedStopping).toBeTrue()
    oldScopeIsCurrent = false
    displayedStopping = false
    displayedStopping = true
    resolveAbort()
    await pending

    expect(displayedStopping).toBeTrue()
  })
})

describe("displayed agent session", () => {
  const visible = {
    documentVisible: true,
    historyVisible: false,
    open: true,
    projectId: "project-one",
    selectedSessionId: "session-one",
    stateSessionId: "session-one",
  }

  test("returns only the conversation whose content is visibly mounted", () => {
    expect(displayedAgentSession(visible)).toEqual({
      projectId: "project-one",
      sessionId: "session-one",
    })
  })

  test("does not acknowledge hidden or mismatched content", () => {
    expect(displayedAgentSession({ ...visible, documentVisible: false })).toBeUndefined()
    expect(displayedAgentSession({ ...visible, historyVisible: true })).toBeUndefined()
    expect(displayedAgentSession({ ...visible, open: false })).toBeUndefined()
    expect(displayedAgentSession({ ...visible, projectId: undefined })).toBeUndefined()
    expect(displayedAgentSession({ ...visible, selectedSessionId: undefined })).toBeUndefined()
    expect(displayedAgentSession({ ...visible, stateSessionId: undefined })).toBeUndefined()
    expect(displayedAgentSession({ ...visible, stateSessionId: "session-two" })).toBeUndefined()
  })
})

describe("parallel session state requests", () => {
  test("invalidates only an older request for the same scope and session", () => {
    const tracker = new AgentSessionStateRequestTracker()
    const firstA = tracker.begin("project-a", "session-a")
    const firstB = tracker.begin("project-a", "session-b")
    const otherScopeA = tracker.begin("project-b", "session-a")
    const secondA = tracker.begin("project-a", "session-a")

    expect(firstA()).toBeFalse()
    expect(secondA()).toBeTrue()
    expect(firstB()).toBeTrue()
    expect(otherScopeA()).toBeTrue()

    tracker.clear()
    expect(secondA()).toBeFalse()
    expect(firstB()).toBeFalse()

    const afterClearA = tracker.begin("project-a", "session-a")
    expect(afterClearA()).toBeTrue()
    expect(secondA()).toBeFalse()
  })
})
