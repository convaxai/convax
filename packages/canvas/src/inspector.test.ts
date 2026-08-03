import { describe, expect, test } from "bun:test"
import { createDefaultCanvasFileRendererRegistry } from "./builtin-registry"
import { createCanvasDocument, createMediaNode, createTextNode } from "./document"
import { createCanvasFileRendererRegistry } from "./file-renderer-registry"
import {
  createCanvasSelectionProjection,
  matchesCanvasSelectionProjectionScope,
  resolveCanvasInspectorProjection,
} from "./inspector"
import { deriveCanvasSelectionContext } from "./selection-context"

const Renderer = () => null

function selection(nodeIds: readonly string[] = [], edgeIds: readonly string[] = []) {
  return deriveCanvasSelectionContext({ edgeIds: new Set(edgeIds), nodeIds: new Set(nodeIds) })
}

describe("Canvas Inspector projection", () => {
  test("publishes bounded built-in metadata without resource bytes, URLs or arbitrary metadata", () => {
    const node = createMediaNode({
      id: "image",
      position: { x: 24, y: 48 },
      resource: {
        height: 1080,
        id: "image",
        kind: "image",
        metadata: { privateToken: "must-not-leak" },
        mimeType: "image/png",
        name: "frame.png",
        state: { status: "ready", url: "asset://private-image" },
        width: 1920,
      },
    })
    const document = createCanvasDocument({ id: "canvas-a", nodes: [node] })
    const projection = resolveCanvasInspectorProjection({
      document,
      renderers: createDefaultCanvasFileRendererRegistry(),
      scopeId: "project-a/canvas-a",
      selection: selection([node.id]),
      viewId: "main",
    })

    expect(projection).toMatchObject({
      documentId: document.id,
      nodeId: node.id,
      rendererId: "image",
      scopeId: "project-a/canvas-a",
      viewId: "main",
    })
    expect(projection?.sections).toContainEqual({
      fields: expect.arrayContaining([
        { id: "name", label: "Name", value: "frame.png" },
        { id: "mime-type", label: "Media type", value: "image/png" },
        { id: "resource-status", label: "Resource", value: "ready" },
      ]),
      id: "resource",
      label: "Resource",
    })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain("asset://private-image")
    expect(serialized).not.toContain("must-not-leak")
  })

  test("fails closed for edge, mixed, unsupported and non-opted-in renderers", () => {
    const text = createTextNode({
      id: "text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const document = createCanvasDocument({ nodes: [text] })
    const builtins = createDefaultCanvasFileRendererRegistry()

    expect(
      resolveCanvasInspectorProjection({
        document,
        renderers: builtins,
        scopeId: "scope",
        selection: selection([], ["edge"]),
        viewId: "view",
      }),
    ).toBeNull()
    expect(
      resolveCanvasInspectorProjection({
        document,
        renderers: builtins,
        scopeId: "scope",
        selection: selection([text.id], ["edge"]),
        viewId: "view",
      }),
    ).toBeNull()

    const unsupported = createCanvasFileRendererRegistry([
      {
        component: Renderer,
        id: "text",
        label: "Untrusted renderer",
        matches: (data) => data.kind === "text",
      },
    ])
    expect(
      resolveCanvasInspectorProjection({
        document,
        renderers: unsupported,
        scopeId: "scope",
        selection: selection([text.id]),
        viewId: "view",
      }),
    ).toBeNull()
  })

  test("rejects faulty or malformed renderer projections", () => {
    const text = createTextNode({
      id: "text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const document = createCanvasDocument({ nodes: [text] })
    const faulty = createCanvasFileRendererRegistry([
      {
        component: Renderer,
        id: "text",
        inspector: {
          project: () => {
            throw new Error("plugin projector failure")
          },
        },
        label: "Text",
        matches: (data) => data.kind === "text",
      },
    ])
    const malformed = createCanvasFileRendererRegistry([
      {
        component: Renderer,
        id: "text",
        inspector: {
          project: () => [
            {
              fields: [
                { id: "duplicate", label: "First", value: "one" },
                { id: "duplicate", label: "Second", value: "two" },
              ],
              id: "unsafe",
              label: "Unsafe",
            },
          ],
        },
        label: "Text",
        matches: (data) => data.kind === "text",
      },
    ])
    const options = {
      document,
      scopeId: "scope",
      selection: selection([text.id]),
      viewId: "view",
    }

    expect(resolveCanvasInspectorProjection({ ...options, renderers: faulty })).toBeNull()
    expect(resolveCanvasInspectorProjection({ ...options, renderers: malformed })).toBeNull()
  })
})

describe("Canvas selection projection", () => {
  test("projects single, multi and clear selection without mutating the document", () => {
    const first = createTextNode({
      id: "first",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const second = createTextNode({
      id: "second",
      metadata: {},
      position: { x: 300, y: 0 },
      resourceState: { status: "ready" },
    })
    const document = createCanvasDocument({ id: "canvas", nodes: [first, second] })
    const before = structuredClone(document)
    const renderers = createDefaultCanvasFileRendererRegistry()
    const common = { document, renderers, scopeId: "scope", viewId: "view" }

    expect(createCanvasSelectionProjection({ ...common, selection: selection() })).toMatchObject({
      inspector: null,
      kind: "none",
      nodeIds: [],
    })
    expect(createCanvasSelectionProjection({ ...common, selection: selection([first.id]) })).toMatchObject({
      inspector: { nodeId: first.id },
      kind: "single-node",
      nodeIds: [first.id],
    })
    expect(createCanvasSelectionProjection({ ...common, selection: selection([first.id, second.id]) })).toMatchObject({
      inspector: null,
      kind: "multi-node",
      nodeIds: [first.id, second.id],
    })
    expect(createCanvasSelectionProjection({ ...common, selection: selection([first.id], ["edge"]) })).toMatchObject({
      inspector: null,
      kind: "mixed",
      nodeIds: [],
    })
    expect(document).toEqual(before)
  })

  test("lets the host reject a stale callback after scope or view replacement", () => {
    const projection = createCanvasSelectionProjection({
      document: createCanvasDocument({ id: "canvas-a" }),
      renderers: createDefaultCanvasFileRendererRegistry(),
      scopeId: "project-a/canvas-a",
      selection: selection(),
      viewId: "view-a",
    })

    expect(
      matchesCanvasSelectionProjectionScope(projection, {
        documentId: "canvas-a",
        scopeId: "project-a/canvas-a",
        viewId: "view-a",
      }),
    ).toBeTrue()
    expect(
      matchesCanvasSelectionProjectionScope(projection, {
        documentId: "canvas-b",
        scopeId: "project-b/canvas-b",
        viewId: "view-b",
      }),
    ).toBeFalse()
  })
})
