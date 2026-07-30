import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import {
  agentComposerTokenPresentation,
  findAgentComposerQueryRange,
  parseAgentComposerResource,
  repairAgentComposerInsertedTriggerSelection,
  serializeAgentComposerResource,
} from "./agent-composer-dom"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    HTMLElement: testWindow.HTMLElement,
    Node: testWindow.Node,
    Text: testWindow.Text,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

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

describe("Agent composer DOM query selection", () => {
  test("moves a newly inserted trigger behind the caret before resolving its query", async () => {
    const restore = installTestWindow()
    try {
      const root = document.createElement("div")
      const trigger = document.createTextNode("@")
      root.append(trigger)
      document.body.append(root)
      const range = document.createRange()
      range.setStart(trigger, 0)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)

      expect(
        repairAgentComposerInsertedTriggerSelection(root, {
          data: "@",
          inputType: "insertText",
        }),
      ).toBe(true)
      expect(selection?.anchorNode).toBe(trigger)
      expect(selection?.anchorOffset).toBe(1)
      expect(findAgentComposerQueryRange(root)).toMatchObject({
        end: 1,
        query: "",
        start: 0,
        trigger: "reference",
      })
    } finally {
      await restore()
    }
  })
})
