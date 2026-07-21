import { afterEach, describe, expect, mock, test } from "bun:test"
import { CanvasResourcePartialFailureError, type CanvasResourceBusinessService } from "@convax/canvas/application"
import { createCanvasDocument, createTextNode } from "@convax/canvas/core"
import { ProjectTextFileConflictError } from "@convax/project-files"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import {
  canvasResourcePartialFailureKind,
  canvasTextResourceConflictKind,
} from "../canvas-resource-private-contract"

type InvokeHandler = (event: TestEvent, input: unknown) => unknown
interface TestEvent {
  sender: { id: number }
}

const handlers = new Map<string, InvokeHandler>()

mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

const { registerCanvasDocumentIpc, registerCanvasResourceIpc, registerCanvasTextResourceIpc } = await import(
  "./canvas-document-ipc"
)

afterEach(() => handlers.clear())

function applicationResult() {
  return {
    affectedNodeIds: ["created"],
    changed: true,
    createdNodeIds: ["created"],
    document: { ...createCanvasDocument({ id: "canvas-main" }), revision: 8 },
    storageVersion: "v8",
    warnings: ["normalized"],
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    anchor: { x: 10, y: 20 },
    canvasId: "canvas-main",
    commandId: "renderer-add",
    expectedRevision: 7,
    externalFiles: [],
    projectId: "project-one",
    sources: [{ kind: "host-file", path: "media/hero.png", sourceId: "hero" }],
    ...overrides,
  }
}

describe("Canvas resource IPC", () => {
  test("binds resource addition to the invoking renderer scope and fixes the UI actor in Main", async () => {
    const event = { sender: { id: 42 } }
    const resolvedEvents: TestEvent[] = []
    const addPreparedResources = mock(
      async (..._args: Parameters<CanvasResourceBusinessService["addPreparedResources"]>) => applicationResult(),
    )
    const addResources = mock(async (..._args: Parameters<CanvasResourceBusinessService["addResources"]>) =>
      applicationResult(),
    )
    const withAdmittedExternalFiles = mock(async (_input, commit) =>
      commit({
        items: [{ id: "outside", kind: "image", metadata: {}, state: { status: "stale" } }],
      }),
    )
    const dispose = registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedExternalFiles },
      {
        isTrustedSender: () => true,
        async resolveActiveCanvas(actualEvent) {
          resolvedEvents.push(actualEvent as TestEvent)
          return { canvasId: "canvas-main", projectId: "project-one", revision: 7 }
        },
      },
    )

    const result = await handlers.get("canvas:resource-add")!(
      event,
      request({
        externalFiles: [
          {
            mediaType: "image/png",
            name: "outside.png",
            sourceId: "outside",
            sourcePath: "/native/outside.png",
          },
        ],
      }),
    )

    expect(resolvedEvents).toEqual([event])
    expect(withAdmittedExternalFiles).toHaveBeenCalledWith(
      {
        files: [
          {
            mediaType: "image/png",
            name: "outside.png",
            sourceId: "outside",
            sourcePath: "/native/outside.png",
          },
        ],
        projectId: "project-one",
      },
      expect.any(Function),
    )
    expect(addPreparedResources).toHaveBeenCalledTimes(1)
    expect(addPreparedResources.mock.calls[0]?.[0]).toEqual({
      actor: { id: "desktop:renderer", kind: "ui" },
      anchor: { x: 10, y: 20 },
      canvasId: "canvas-main",
      commandId: "renderer-add",
      expectedRevision: 7,
      relation: undefined,
      scopeId: "project-one",
      sources: [{ kind: "host-file", path: "media/hero.png", sourceId: "hero" }],
    })
    expect(addResources).not.toHaveBeenCalled()
    expect(result).toEqual({ createdNodeIds: ["created"], revision: 8, warnings: ["normalized"] })
    expect(JSON.stringify(result)).not.toContain("/native/outside.png")
    dispose()
  })

  test("uses addResources once when no local File admission is needed", async () => {
    const addResources = mock(async (..._args: Parameters<CanvasResourceBusinessService["addResources"]>) =>
      applicationResult(),
    )
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources },
      { withAdmittedExternalFiles: mock() },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )

    await handlers.get("canvas:resource-add")!({ sender: { id: 1 } }, request())
    expect(addResources).toHaveBeenCalledTimes(1)
  })

  test("rejects stale guards before resource preparation and never selects another renderer", async () => {
    const addPreparedResources = mock()
    const addResources = mock()
    const withAdmittedExternalFiles = mock()
    registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedExternalFiles },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async (event) =>
          event.sender.id === 9 ? { canvasId: "canvas-other", projectId: "project-other", revision: 1 } : null,
      },
    )

    await expect(handlers.get("canvas:resource-add")!({ sender: { id: 9 } }, request())).rejects.toThrow(
      "live Workbench scope",
    )
    expect(addPreparedResources).not.toHaveBeenCalled()
    expect(addResources).not.toHaveBeenCalled()
    expect(withAdmittedExternalFiles).not.toHaveBeenCalled()
  })

  test("validates the complete relation shape before invoking Canvas business services", async () => {
    const addPreparedResources = mock()
    const addResources = mock()
    registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedExternalFiles: mock() },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )

    for (const relation of [
      { anchorNodeIds: "anchor", mode: "connect" },
      { anchorNodeIds: [""], mode: "connect" },
      { anchorNodeIds: ["anchor"], direction: "sideways", mode: "connect" },
      { anchorNodeIds: ["anchor"], mode: "invalid" },
    ]) {
      await expect(handlers.get("canvas:resource-add")!({ sender: { id: 1 } }, request({ relation }))).rejects.toThrow(
        "relation",
      )
    }
    expect(addPreparedResources).not.toHaveBeenCalled()
    expect(addResources).not.toHaveBeenCalled()
  })

  test("rejects source ids duplicated across portable and external inputs before admission", async () => {
    const addPreparedResources = mock()
    const addResources = mock()
    const withAdmittedExternalFiles = mock()
    registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedExternalFiles },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )

    await expect(
      handlers.get("canvas:resource-add")!(
        { sender: { id: 1 } },
        request({
          externalFiles: [{ name: "outside.png", sourceId: "hero", sourcePath: "/native/private/outside.png" }],
        }),
      ),
    ).rejects.toThrow("source id is duplicated")
    expect(withAdmittedExternalFiles).not.toHaveBeenCalled()
    expect(addPreparedResources).not.toHaveBeenCalled()
    expect(addResources).not.toHaveBeenCalled()
  })

  test("bounds local-file failures without returning a native path", async () => {
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock() },
      {
        async withAdmittedExternalFiles() {
          throw new Error("ENOENT: /native/private/outside.png")
        },
      },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )

    let failure: unknown
    try {
      await handlers.get("canvas:resource-add")!(
        { sender: { id: 1 } },
        request({
          externalFiles: [{ name: "outside.png", sourceId: "outside", sourcePath: "/native/private/outside.png" }],
          sources: [],
        }),
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    const message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain("selected local files")
    expect(message).not.toContain("/native/")
  })

  test("returns a Main-private partial-failure tag for mixed local and published resources", async () => {
    const nativeFailure = new Error("Canvas save failed at /native/project/.convax/document.json")
    registerCanvasResourceIpc(
      {
        async addPreparedResources() {
          throw new CanvasResourcePartialFailureError(nativeFailure, [{ label: "Notes/Brief-a1.md" }])
        },
        addResources: mock(),
      },
      {
        async withAdmittedExternalFiles(_input, commit) {
          return commit({
            items: [{ id: "outside", kind: "image", metadata: {}, state: { status: "stale" } }],
          })
        },
      },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )

    const result = await handlers.get("canvas:resource-add")!(
      { sender: { id: 1 } },
      request({
        externalFiles: [{ name: "outside.png", sourceId: "outside", sourcePath: "/native/private/outside.png" }],
        sources: [{ kind: "new-text", sourceId: "brief", text: "# Brief" }],
      }),
    )

    expect(result).toEqual({ kind: canvasResourcePartialFailureKind, retainedLabels: ["Notes/Brief-a1.md"] })
    expect(JSON.stringify(result)).not.toContain("/native/")
  })

  test("never forwards malicious or non-Notes partial-failure labels", async () => {
    for (const label of [
      "../private.md",
      "Generated/private.md",
      "Notes/nested/private.md",
      "Notes/private.txt",
      "Notes/C:/private.md",
    ]) {
      handlers.clear()
      registerCanvasResourceIpc(
        {
          async addPreparedResources() {
            throw new CanvasResourcePartialFailureError(new Error("ENOENT: /native/private/source"), [{ label }])
          },
          addResources: mock(),
        },
        {
          async withAdmittedExternalFiles(_input, commit) {
            return commit({
              items: [{ id: "outside", kind: "image", metadata: {}, state: { status: "stale" } }],
            })
          },
        },
        {
          isTrustedSender: () => true,
          resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
        },
      )

      let failure: unknown
      try {
        await handlers.get("canvas:resource-add")!(
          { sender: { id: 1 } },
          request({
            externalFiles: [{ name: "outside.png", sourceId: "outside", sourcePath: "/native/private/outside.png" }],
            sources: [{ kind: "new-text", sourceId: "brief", text: "# Brief" }],
          }),
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      const message = failure instanceof Error ? failure.message : String(failure)
      expect(message).toContain("selected resources")
      expect(message).not.toContain(label)
      expect(message).not.toContain("/native/")
    }
  })
})

function textDocument(reference: unknown = { kind: "project-file", path: "Notes/brief.md" }) {
  return {
    ...createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "text-node",
          metadata: { [projectResourceReferenceKey]: reference },
          name: "brief.md",
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        }),
      ],
    }),
    revision: 4,
  }
}

describe("Canvas document hydration IPC", () => {
  test("hydrates document loads in Main through the dedicated Project hydrator", async () => {
    const document = textDocument()
    const load = mock(async () => ({ document, storageVersion: "storage-4" }))
    const hydrate = mock(async ({ document: loaded }) => ({
      ...loaded,
      nodes: loaded.nodes.map((node: ReturnType<typeof textDocument>["nodes"][number]) => ({
        ...node,
        data: { ...node.data, resourceState: { status: "ready", text: "# Hydrated" } },
      })),
    }))
    registerCanvasDocumentIpc(
      { load, save: mock() },
      { hydrate },
      { isTrustedSender: () => true },
    )

    const result = await handlers.get("canvas:document-load")!(
      { sender: { id: 2 } },
      { canvasId: "canvas-main", scopeId: "project-one" },
    )

    expect(hydrate).toHaveBeenCalledWith({ document, projectId: "project-one" })
    expect(result).toMatchObject({
      document: { nodes: [expect.objectContaining({ data: expect.objectContaining({ resourceState: { status: "ready", text: "# Hydrated" } }) })] },
      storageVersion: "storage-4",
    })
  })
})

describe("Canvas text resource IPC", () => {
  function register(options: {
    document?: ReturnType<typeof textDocument>
    replace?: (input: unknown) => Promise<{ contentRevision: string }>
    resolve?: (event: TestEvent) => Promise<{ canvasId: string; projectId: string; revision: number } | null>
  } = {}) {
    const compareAndReplaceTextFile = mock(
      options.replace ?? (async () => ({ contentRevision: "b".repeat(64) })),
    )
    const load = mock(async () => ({
      document: options.document ?? textDocument(),
      storageVersion: "storage-4",
    }))
    const resolveActiveCanvas = mock(
      options.resolve ?? (async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 4 })),
    )
    registerCanvasTextResourceIpc(
      { compareAndReplaceTextFile },
      { load },
      { isTrustedSender: () => true, resolveActiveCanvas },
    )
    return { compareAndReplaceTextFile, load, resolveActiveCanvas }
  }

  test("reloads the live Canvas and binds node id to its exact Project file reference", async () => {
    const ports = register()
    const event = { sender: { id: 7 } }

    const result = await handlers.get("canvas:text-resource-save")!(event, {
      content: "# Changed",
      contentRevision: "a".repeat(64),
      nodeId: "text-node",
    })

    expect(ports.resolveActiveCanvas).toHaveBeenCalledWith(event)
    expect(ports.load).toHaveBeenCalledWith({ canvasId: "canvas-main", scopeId: "project-one" })
    expect(ports.compareAndReplaceTextFile).toHaveBeenCalledWith({
      content: "# Changed",
      expectedRevision: "a".repeat(64),
      path: "Notes/brief.md",
      projectId: "project-one",
    })
    expect(result).toEqual({ contentRevision: "b".repeat(64) })
  })

  test("rejects forged scope, path, and reference fields before loading", async () => {
    for (const extra of [
      { projectId: "project-other" },
      { canvasId: "canvas-other" },
      { path: "Notes/other.md" },
      { reference: { kind: "project-file", path: "Notes/other.md" } },
    ]) {
      handlers.clear()
      const ports = register()
      await expect(
        handlers.get("canvas:text-resource-save")!({ sender: { id: 1 } }, {
          content: "changed",
          contentRevision: "a".repeat(64),
          nodeId: "text-node",
          ...extra,
        }),
      ).rejects.toThrow(/unsupported field/i)
      expect(ports.load).not.toHaveBeenCalled()
      expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
    }
  })

  test("rejects managed, directory, non-text, and non-Markdown/plain-text nodes", async () => {
    const references = [
      { kind: "managed-asset", name: "brief.md", sha256: "d".repeat(64) },
      { kind: "project-directory", path: "Notes" },
      { kind: "project-file", path: "Notes/archive.bin" },
    ]
    for (const reference of references) {
      handlers.clear()
      const ports = register({ document: textDocument(reference) })
      await expect(
        handlers.get("canvas:text-resource-save")!({ sender: { id: 1 } }, {
          content: "changed",
          contentRevision: "a".repeat(64),
          nodeId: "text-node",
        }),
      ).rejects.toThrow("not editable")
      expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
    }

    handlers.clear()
    const document = textDocument()
    document.nodes[0] = { ...document.nodes[0]!, data: { ...document.nodes[0]!.data, kind: "image" } }
    const ports = register({ document })
    await expect(
      handlers.get("canvas:text-resource-save")!({ sender: { id: 1 } }, {
        content: "changed",
        contentRevision: "a".repeat(64),
        nodeId: "text-node",
      }),
    ).rejects.toThrow("not editable")
    expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
  })

  test("rechecks live scope before CAS and rejects a stale sender", async () => {
    let calls = 0
    const ports = register({
      resolve: async () =>
        ++calls === 1
          ? { canvasId: "canvas-main", projectId: "project-one", revision: 4 }
          : { canvasId: "canvas-other", projectId: "project-one", revision: 1 },
    })

    await expect(
      handlers.get("canvas:text-resource-save")!({ sender: { id: 8 } }, {
        content: "changed",
        contentRevision: "a".repeat(64),
        nodeId: "text-node",
      }),
    ).rejects.toThrow("live Workbench scope")
    expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
  })

  test("rejects a loaded durable document from a different live Canvas revision", async () => {
    const ports = register({ document: { ...textDocument(), revision: 5 } })

    await expect(
      handlers.get("canvas:text-resource-save")!({ sender: { id: 8 } }, {
        content: "changed",
        contentRevision: "a".repeat(64),
        nodeId: "text-node",
      }),
    ).rejects.toThrow("live Workbench scope")

    expect(ports.resolveActiveCanvas).toHaveBeenCalledTimes(1)
    expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
  })

  test("rejects the same live Canvas when its revision changes before CAS", async () => {
    let calls = 0
    const ports = register({
      resolve: async () => ({
        canvasId: "canvas-main",
        projectId: "project-one",
        revision: ++calls === 1 ? 4 : 5,
      }),
    })

    await expect(
      handlers.get("canvas:text-resource-save")!({ sender: { id: 8 } }, {
        content: "changed",
        contentRevision: "a".repeat(64),
        nodeId: "text-node",
      }),
    ).rejects.toThrow("live Workbench scope")

    expect(ports.resolveActiveCanvas).toHaveBeenCalledTimes(2)
    expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
  })

  test("returns only a typed conflict without leaking native errors", async () => {
    register({
      replace: async () => {
        throw new ProjectTextFileConflictError("a".repeat(64), "c".repeat(64))
      },
    })

    const result = await handlers.get("canvas:text-resource-save")!({ sender: { id: 1 } }, {
      content: "changed",
      contentRevision: "a".repeat(64),
      nodeId: "text-node",
    })

    expect(result).toEqual({ actualRevision: "c".repeat(64), kind: canvasTextResourceConflictKind })
    expect(JSON.stringify(result)).not.toContain("/native/")
  })
})
