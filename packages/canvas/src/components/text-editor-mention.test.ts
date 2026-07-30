import { describe, expect, test } from "bun:test"
import { MarkdownManager } from "@tiptap/markdown"
import StarterKit from "@tiptap/starter-kit"
import { createAgentNode, createCanvasDocument, createGroupNode, createMediaNode, createTextNode } from "../document"
import {
  createCanvasTextMentionExtension,
  getCanvasTextMentionCandidates,
  isCanvasTextMentionCandidate,
  moveCanvasTextMentionIndex,
} from "./text-editor-mention"

describe("Canvas text mention candidates", () => {
  test("finds matching current-Canvas material nodes in document order", () => {
    const target = createTextNode({
      id: "target",
      label: "Draft",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "" },
    })
    const referenceText = createTextNode({
      id: "reference-text",
      label: "Research notes",
      metadata: {},
      position: { x: 320, y: 0 },
      resourceState: { status: "ready", text: "" },
    })
    const image = createMediaNode({
      id: "image",
      position: { x: 640, y: 0 },
      resource: {
        id: "project-image",
        kind: "image",
        name: "Research board",
        metadata: {},
        state: { status: "ready", url: "convax-asset://project/research-board" },
      },
    })
    const unrelated = createMediaNode({
      id: "video",
      position: { x: 960, y: 0 },
      resource: {
        id: "project-video",
        kind: "video",
        name: "Launch reel",
        metadata: {},
        state: { status: "ready" },
      },
    })

    const candidates = getCanvasTextMentionCandidates(
      createCanvasDocument({ id: "canvas-mentions", nodes: [target, referenceText, image, unrelated] }),
      target.id,
      "research",
    )

    expect(candidates).toEqual([
      { id: referenceText.id, kind: "text", label: "Research notes" },
      {
        id: image.id,
        kind: "image",
        label: "Research board",
        thumbnailUrl: "convax-asset://project/research-board",
      },
    ])
  })

  test("excludes the edited node, structural groups, Agent nodes, and caps large result sets", () => {
    const target = createTextNode({
      id: "target",
      label: "Draft",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "" },
    })
    const group = createGroupNode({
      height: 300,
      id: "group",
      label: "Group",
      position: { x: 0, y: 300 },
      width: 400,
    })
    const agent = createAgentNode({ id: "agent", position: { x: 500, y: 300 } })
    const materials = Array.from({ length: 60 }, (_, index) =>
      createTextNode({
        id: `material-${index}`,
        label: `Material ${index}`,
        metadata: {},
        position: { x: index * 20, y: 600 },
        resourceState: { status: "ready", text: "" },
      }),
    )

    const candidates = getCanvasTextMentionCandidates(
      createCanvasDocument({ id: "canvas-many-mentions", nodes: [target, group, agent, ...materials] }),
      target.id,
      "",
    )

    expect(candidates).toHaveLength(50)
    expect(candidates.map((candidate) => candidate.id)).not.toContain(target.id)
    expect(candidates.map((candidate) => candidate.id)).not.toContain(group.id)
    expect(candidates.map((candidate) => candidate.id)).not.toContain(agent.id)
    expect(
      getCanvasTextMentionCandidates(
        createCanvasDocument({ id: "canvas-searched-mentions", nodes: [target, ...materials] }),
        target.id,
        "Material 59",
      ),
    ).toHaveLength(1)
    expect(
      isCanvasTextMentionCandidate(
        createCanvasDocument({ id: "canvas-revalidated-mentions", nodes: [target, ...materials] }),
        target.id,
        "material-59",
      ),
    ).toBeTrue()
  })

  test("round trips mention identity and highlight metadata through Markdown", () => {
    const mention = createCanvasTextMentionExtension({
      enabled: () => true,
      items: () => [],
      onSelect: () => true,
    })
    const markdown = new MarkdownManager({
      extensions: [StarterKit, mention],
    })
    const serialized = markdown.serialize({
      content: [
        {
          content: [
            { text: "See ", type: "text" },
            {
              attrs: {
                id: "canvas-image-node",
                label: 'Research "board" ]\n第二行',
                mentionSuggestionChar: "@",
              },
              type: "mention",
            },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    })

    expect(serialized).toContain(
      '[@ encoding="uri" id="canvas-image-node" label="Research%20%22board%22%20%5D%0A%E7%AC%AC%E4%BA%8C%E8%A1%8C"]',
    )
    expect(markdown.parse(serialized).content?.[0]?.content?.[1]).toMatchObject({
      attrs: {
        id: "canvas-image-node",
        label: 'Research "board" ]\n第二行',
      },
      type: "mention",
    })
    expect(markdown.parse('[@ id="legacy-node" label="Legacy%20board"]').content?.[0]?.content?.[0]).toMatchObject({
      attrs: {
        id: "legacy-node",
        label: "Legacy%20board",
      },
      type: "mention",
    })
    expect(mention.options.HTMLAttributes).toMatchObject({
      class: "convax-text-editor__mention",
    })
  })

  test("moves the active candidate with all four arrow keys and bounded jumps", () => {
    expect(moveCanvasTextMentionIndex(0, "ArrowDown", 4)).toBe(1)
    expect(moveCanvasTextMentionIndex(0, "ArrowRight", 4)).toBe(1)
    expect(moveCanvasTextMentionIndex(0, "ArrowUp", 4)).toBe(3)
    expect(moveCanvasTextMentionIndex(0, "ArrowLeft", 4)).toBe(3)
    expect(moveCanvasTextMentionIndex(2, "Home", 4)).toBe(0)
    expect(moveCanvasTextMentionIndex(2, "End", 4)).toBe(3)
    expect(moveCanvasTextMentionIndex(2, "ArrowDown", 0)).toBe(0)
  })
})
