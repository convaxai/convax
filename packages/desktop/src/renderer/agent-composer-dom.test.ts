import { describe, expect, test } from "bun:test"
import {
  agentComposerTokenPresentation,
  parseAgentComposerResource,
  serializeAgentComposerResource,
} from "./agent-composer-dom"

describe("Agent composer DOM resource codec", () => {
  test("round trips every AgentResource family through a versioned attribute", () => {
    const resources = [
      { kind: "file" as const, mime: "text/markdown", name: "Readme", path: "README.md" },
      { kind: "directory" as const, path: "src" },
      { kind: "resource" as const, name: "Canvas", uri: "convax://canvas/main" },
      { kind: "skill" as const, name: "review" },
    ]

    expect(resources.map((resource) => parseAgentComposerResource(serializeAgentComposerResource(resource)))).toEqual(
      resources,
    )
  })

  test("rejects malformed, unsupported, and structurally invalid resources", () => {
    expect(parseAgentComposerResource("not-json")).toBeNull()
    expect(parseAgentComposerResource(JSON.stringify({ resource: { kind: "file", path: "a" }, version: 2 }))).toBeNull()
    expect(parseAgentComposerResource(JSON.stringify({ resource: { kind: "file", path: "" }, version: 1 }))).toBeNull()
    expect(parseAgentComposerResource(JSON.stringify({ resource: { kind: "skill", name: 42 }, version: 1 }))).toBeNull()
    expect(parseAgentComposerResource(JSON.stringify({ resource: { kind: "unknown" }, version: 1 }))).toBeNull()
  })

  test("uses distinct Convax capsule families and accessible labels", () => {
    expect(agentComposerTokenPresentation({ kind: "skill", name: "review" })).toMatchObject({
      editLabel: "Change Skill: review",
      family: "skill",
      label: "review",
      prefix: "$",
      removeLabel: "Remove Skill: review",
    })
    expect(
      agentComposerTokenPresentation({ kind: "resource", name: "Main", uri: "convax://canvas/main" }),
    ).toMatchObject({
      editLabel: "Change Canvas reference: Main",
      family: "canvas",
      label: "Main",
      prefix: "@",
      removeLabel: "Remove Canvas reference: Main",
    })
    expect(agentComposerTokenPresentation({ kind: "file", path: "docs/guide.md" })).toMatchObject({
      family: "project",
      label: "guide.md",
      prefix: "@",
    })
  })
})
