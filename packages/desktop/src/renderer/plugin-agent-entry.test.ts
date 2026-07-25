import { describe, expect, mock, test } from "bun:test"

import { openPluginInAgent, pluginAgentComposerResource, showPluginAgentSession } from "./plugin-agent-entry"

describe("Plugin Agent entry", () => {
  test("uses one owned Skill without branching on the Plugin id", () => {
    for (const name of ["remote-editor", "research-assistant"]) {
      expect(
        pluginAgentComposerResource({
          contributes: { skills: [{ name, path: `skills/${name}` }] },
        }),
      ).toEqual({ kind: "skill", name })
    }
  })

  test("does not guess between zero or multiple owned Skills", () => {
    expect(pluginAgentComposerResource({ contributes: {} })).toBeUndefined()
    expect(
      pluginAgentComposerResource({
        contributes: {
          skills: [
            { name: "edit", path: "skills/edit" },
            { name: "export", path: "skills/export" },
          ],
        },
      }),
    ).toBeUndefined()
  })

  test("opens the Agent composer with the one unambiguous owned Skill", () => {
    const addResources = mock(() => undefined)
    const focusComposer = mock(() => undefined)

    openPluginInAgent(
      {
        contributes: { skills: [{ name: "remote-editor", path: "skills/remote-editor" }] },
      },
      { addResources, focusComposer },
    )

    expect(addResources).toHaveBeenCalledWith([{ kind: "skill", name: "remote-editor" }])
    expect(focusComposer).not.toHaveBeenCalled()
  })

  test("opens an empty composer when the Plugin has no single workflow", () => {
    const addResources = mock(() => undefined)
    const focusComposer = mock(() => undefined)

    openPluginInAgent({ contributes: {} }, { addResources, focusComposer })

    expect(addResources).not.toHaveBeenCalled()
    expect(focusComposer).toHaveBeenCalledTimes(1)
  })

  test("shows a Plugin-started session and finishes that exact scoped session once", () => {
    const calls: unknown[] = []
    const session = {
      createdAt: 1,
      directory: "/portable/project",
      id: "session-1",
      title: "Plugin: ChatCut",
      updatedAt: 1,
    }
    const panel = {
      finishSession(input: unknown) {
        calls.push(["finish", input])
      },
      showSession(input: unknown) {
        calls.push(["show", input])
        return true
      },
    }

    const finish = showPluginAgentSession(panel, { scopeId: "project-1", session })
    finish()
    finish()

    expect(calls).toEqual([
      ["show", { scopeId: "project-1", session }],
      ["finish", { scopeId: "project-1", sessionId: "session-1" }],
    ])
  })

  test("fails instead of starting a hidden Plugin Agent session", () => {
    expect(() =>
      showPluginAgentSession(null, {
        scopeId: "project-1",
        session: {
          createdAt: 1,
          directory: "/portable/project",
          id: "session-1",
          title: "Plugin: ChatCut",
          updatedAt: 1,
        },
      }),
    ).toThrow("Agent panel is not ready")
  })
})
