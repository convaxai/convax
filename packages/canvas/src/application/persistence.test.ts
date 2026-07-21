import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createFolderNode, createMediaNode, createTextNode } from "../document"
import type { CanvasNode } from "../types"
import {
  InvalidCanvasDocumentError,
  parseStoredCanvasDocument,
  serializeCanvasDocument,
  UnsupportedCanvasDocumentVersionError,
} from "./persistence"

describe("canvas document persistence", () => {
  test("strips runtime state from every resource kind before serialization", () => {
    const document = createCanvasDocument({
      id: "canvas_runtime",
      nodes: resourceNodes("SECRET-RUNTIME-VALUE"),
    })

    const bytes = serializeCanvasDocument(document)
    const stored = JSON.parse(bytes) as { document: { nodes: CanvasNode[] } }

    expect(bytes).not.toContain("resourceState")
    expect(bytes).not.toContain("SECRET-RUNTIME-VALUE")
    expect(stored.document.nodes).toHaveLength(6)
    for (const node of stored.document.nodes) {
      expect(node.data).not.toHaveProperty("resourceState")
    }
  })

  test("strips top-level runtime state from a custom Plugin node while preserving namespaced metadata", () => {
    const node = pluginNodeWithRuntimeState("SECRET-PLUGIN-RUNTIME")
    const document = createCanvasDocument({ id: "canvas_plugin_runtime", nodes: [node] })

    const bytes = serializeCanvasDocument(document)
    const stored = JSON.parse(bytes) as { document: { nodes: CanvasNode[] } }

    expect(bytes).not.toContain("resourceState")
    expect(bytes).not.toContain("SECRET-PLUGIN-RUNTIME")
    expect(stored.document.nodes[0]!.data.metadata).toEqual({
      convaxPluginState: { title: "Portable Plugin state" },
    })
  })

  test.each(["text", "image", "video", "audio", "file", "folder"] as const)(
    "rejects durable v2 %s nodes containing runtime state",
    (kind) => {
      const node = resourceNodes("SECRET-PERSISTED").find((candidate) => candidate.data.kind === kind)!
      const document = createCanvasDocument({ id: `canvas_${kind}`, nodes: [node] })

      expect(() => parseStoredCanvasDocument(JSON.stringify({
        document,
        schemaVersion: "convax.canvas/2",
      }), document.id)).toThrow(InvalidCanvasDocumentError)
    },
  )

  test("rejects a durable v2 custom Plugin node containing top-level runtime state", () => {
    const document = createCanvasDocument({
      id: "canvas_plugin_persisted_runtime",
      nodes: [pluginNodeWithRuntimeState("SECRET-PERSISTED-PLUGIN")],
    })

    expect(() => parseStoredCanvasDocument(JSON.stringify({
      document,
      schemaVersion: "convax.canvas/2",
    }), document.id)).toThrow(InvalidCanvasDocumentError)
  })

  test("round trips resource nodes that have no runtime state", () => {
    const node = resourceNodes("TRANSIENT")[0]!
    const { resourceState: _resourceState, ...data } = node.data
    const document = createCanvasDocument({ nodes: [{ ...node, data }] })

    expect(parseStoredCanvasDocument(serializeCanvasDocument(document), document.id)).toEqual(document)
  })

  test("round trips a valid document owned by the expected canvas", () => {
    const pluginState = {
      directorProject: { objects: [{ id: "cube" }] },
      schemaVersion: 1,
    }
    const document = createCanvasDocument({
      id: "canvas_owned",
      nodes: [
        {
          data: {
            kind: "plugin.storyai-3d-director-desk",
            label: "3D Director Desk",
            metadata: { convaxPluginState: pluginState },
          },
          id: "director-node",
          position: { x: 10, y: 20 },
          type: "file",
        },
      ],
      title: "Owned",
    })
    const restored = parseStoredCanvasDocument(serializeCanvasDocument(document), document.id)
    expect(restored).toEqual(document)
    expect(restored.nodes[0]?.data.metadata).not.toBe(document.nodes[0]?.data.metadata)
  })

  test("rejects malformed JSON and a document from another canvas", () => {
    expect(() => parseStoredCanvasDocument("not json", "canvas_expected")).toThrow(InvalidCanvasDocumentError)
    expect(() =>
      parseStoredCanvasDocument(
        serializeCanvasDocument(createCanvasDocument({ id: "canvas_other" })),
        "canvas_expected",
      ),
    ).toThrow(InvalidCanvasDocumentError)
  })

  test("serializes the breaking Canvas v2 envelope", () => {
    const document = createCanvasDocument({ id: "canvas_v2", title: "V2" })
    expect(JSON.parse(serializeCanvasDocument(document))).toEqual({
      document,
      schemaVersion: "convax.canvas/2",
    })
  })

  test("serializes pretty JSON with a trailing newline", () => {
    const document = createCanvasDocument({ id: "canvas_pretty", title: "Pretty" })
    expect(serializeCanvasDocument(document)).toBe(`${JSON.stringify({
      document,
      schemaVersion: "convax.canvas/2",
    }, null, 2)}\n`)
  })

  test.each([
    ["null", null],
    ["array", []],
    ["scalar", 42],
  ] as const)("rejects a non-object %s JSON root", (_kind, value) => {
    expect(() => parseStoredCanvasDocument(JSON.stringify(value), "canvas")).toThrow(
      InvalidCanvasDocumentError,
    )
  })

  test("rejects the former unversioned document without rewriting its bytes", () => {
    const document = createCanvasDocument({ id: "canvas_legacy" })
    const legacy = JSON.stringify(document)
    expect(() => parseStoredCanvasDocument(legacy, "canvas_legacy")).toThrow(
      UnsupportedCanvasDocumentVersionError,
    )
    expect(legacy).toBe(JSON.stringify(document))
  })

  test("distinguishes unsupported versions from malformed v2 documents", () => {
    expect(() =>
      parseStoredCanvasDocument(
        JSON.stringify({
          document: createCanvasDocument({ id: "canvas" }),
          schemaVersion: "convax.canvas/1",
        }),
        "canvas",
      ),
    ).toThrow(UnsupportedCanvasDocumentVersionError)
    expect(() =>
      parseStoredCanvasDocument(
        JSON.stringify({ document: { id: "canvas" }, schemaVersion: "convax.canvas/2" }),
        "canvas",
      ),
    ).toThrow(InvalidCanvasDocumentError)
  })

  test("preserves an object schema version without coercing it", () => {
    const schemaVersion = { toString: null, valueOf: null }
    let thrown: unknown
    try {
      parseStoredCanvasDocument(
        JSON.stringify({ document: createCanvasDocument({ id: "canvas" }), schemaVersion }),
        "canvas",
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(UnsupportedCanvasDocumentVersionError)
    if (!(thrown instanceof UnsupportedCanvasDocumentVersionError)) {
      throw new Error("Expected an unsupported Canvas document version")
    }
    expect(thrown.schemaVersion).toEqual(schemaVersion)
  })
})

function resourceNodes(secret: string): CanvasNode[] {
  return [
    createTextNode({
      id: "text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: secret },
    }),
    ...(["image", "video", "audio", "file"] as const).map((kind, index) => createMediaNode({
      id: kind,
      position: { x: (index + 1) * 100, y: 0 },
      resource: {
        id: `${kind}-resource`,
        kind,
        metadata: {},
        state: { error: secret, status: "ready", url: secret },
      },
    })),
    createFolderNode({
      id: "folder",
      position: { x: 500, y: 0 },
      resource: {
        id: "folder-resource",
        kind: "folder",
        metadata: {},
        name: "Folder",
        state: { error: secret, status: "ready" },
      },
    }),
  ]
}

function pluginNodeWithRuntimeState(secret: string): CanvasNode {
  return {
    data: {
      kind: "plugin.surface",
      label: "Plugin",
      metadata: { convaxPluginState: { title: "Portable Plugin state" } },
      resourceState: { status: "ready", text: secret },
    },
    id: "plugin",
    position: { x: 0, y: 0 },
    type: "file",
  }
}
