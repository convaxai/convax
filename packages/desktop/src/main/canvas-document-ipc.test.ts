import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { CanvasResourcePartialFailureError, type CanvasResourceBusinessService } from "@convax/canvas/application"
import {
  createCanvasDocument,
  createFolderNode,
  createMediaNode,
  createTextNode,
  type CanvasNode,
} from "@convax/canvas/core"
import { ProjectTextFileConflictError } from "@convax/project-files"
import { dehydrateProjectCanvasDocument, projectResourceReferenceKey } from "@convax/project/canvas"
import { canvasResourcePartialFailureKind, canvasTextResourceConflictKind } from "../canvas-resource-private-contract"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"

type InvokeHandler = (event: TestEvent, input: unknown) => unknown
interface TestEvent {
  sender: { id: number }
}

const handlers = new Map<string, InvokeHandler>()

beforeEach(() => {
  configureElectronMock({
    ipcMain: {
      handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
  })
})

const { registerCanvasDocumentIpc, registerCanvasResourceIpc, registerCanvasTextResourceIpc } = await import(
  "./canvas-document-ipc"
)

afterEach(() => {
  handlers.clear()
  resetElectronMock()
})

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
  test("binds portable relink to the live node and commits one exactly compatible prepared resource", async () => {
    const oldReference = { kind: "project-file" as const, path: "media/missing.png" }
    const document = {
      ...createCanvasDocument({
        id: "canvas-main",
        nodes: [
          createMediaNode({
            id: "image-node",
            position: { x: 0, y: 0 },
            resource: {
              id: "old",
              kind: "image",
              metadata: { [projectResourceReferenceKey]: oldReference },
              state: { status: "missing" },
            },
          }),
        ],
      }),
      revision: 7,
    }
    const prepared = {
      items: [
        {
          id: "relink",
          kind: "image" as const,
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "media/replacement.png" } },
          name: "replacement.png",
          state: { status: "stale" as const },
        },
      ],
    }
    const prepare = mock(async () => prepared)
    const relinkPreparedResource = mock(async () => applicationResult())
    let active = { canvasId: "canvas-main", projectId: "project-one", revision: 7 }
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock(), relinkPreparedResource },
      { prepare, withAdmittedLocalFiles: mock() },
      {
        documents: { load: mock(async () => ({ document, storageVersion: "v7" })) },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => active,
      },
    )

    const input = {
      canvasId: "canvas-main",
      commandId: "relink-project-file",
      expectedRevision: 7,
      nodeId: "image-node",
      source: { kind: "host-file", path: "media/replacement.png" },
    }
    const result = await handlers.get("canvas:resource-relink")!({ sender: { id: 1 } }, input)
    active = { ...active, revision: 8 }
    await expect(handlers.get("canvas:resource-relink")!({ sender: { id: 1 } }, input)).resolves.toEqual(result)

    expect(prepare).toHaveBeenCalledWith({
      canvasId: "canvas-main",
      scopeId: "project-one",
      sources: [{ kind: "host-file", path: "media/replacement.png", sourceId: "relink" }],
    })
    expect(relinkPreparedResource).toHaveBeenCalledWith(
      {
        actor: { id: "desktop:renderer", kind: "ui" },
        canvasId: "canvas-main",
        commandId: "relink-project-file",
        expectedRevision: 7,
        metadataKeysToRemove: ["convaxProjectResourceBindings"],
        nodeId: "image-node",
        scopeId: "project-one",
      },
      prepared,
    )
    expect(result).toEqual({ revision: 8, warnings: ["normalized"] })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(relinkPreparedResource).toHaveBeenCalledTimes(1)
  })

  test("consumes a sender-scoped local relink token once and rejects stale scope, native fields, and incompatible types", async () => {
    const image = createMediaNode({
      id: "image-node",
      position: { x: 0, y: 0 },
      resource: {
        id: "old",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "old.png" } },
        state: { status: "missing" },
      },
    })
    const document = { ...createCanvasDocument({ id: "canvas-main", nodes: [image] }), revision: 7 }
    const withAdmittedLocalFiles = mock(async (_input, commit) =>
      commit({
        items: [
          {
            id: "relink",
            kind: "video",
            metadata: {
              [projectResourceReferenceKey]: { kind: "managed-asset", name: "wrong.mp4", sha256: "a".repeat(64) },
            },
            state: { status: "stale" },
          },
        ],
      }),
    )
    const relinkPreparedResource = mock()
    let scopeCalls = 0
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock(), relinkPreparedResource },
      { prepare: mock(), withAdmittedLocalFiles },
      {
        documents: { load: mock(async () => ({ document, storageVersion: "v7" })) },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => {
          scopeCalls += 1
          return { canvasId: "canvas-main", projectId: "project-one", revision: 7 }
        },
      },
    )
    const event = { sender: { id: 11 } }
    await handlers.get("canvas:resource-local-file-register")!(event, {
      sourcePath: "/native/replacement.mp4",
      sourceToken: "canvas-resource_token-one",
    })
    const relink = {
      canvasId: "canvas-main",
      commandId: "relink-local",
      expectedRevision: 7,
      nodeId: "image-node",
      source: { kind: "local-file", name: "replacement.mp4", sourceToken: "canvas-resource_token-one" },
    }

    await expect(handlers.get("canvas:resource-relink")!(event, relink)).rejects.toThrow("selected local file")
    expect(withAdmittedLocalFiles).toHaveBeenCalledTimes(1)
    expect(relinkPreparedResource).not.toHaveBeenCalled()
    await expect(handlers.get("canvas:resource-relink")!(event, { ...relink, commandId: "reused" })).rejects.toThrow(
      "selected local file",
    )
    await expect(
      handlers.get("canvas:resource-relink")!(event, { ...relink, nativePath: "/native/attack" }),
    ).rejects.toThrow("unsupported field")
    expect(scopeCalls).toBeGreaterThan(0)
  })

  test("publishes a managed text editable copy, returns bounded txt partial success, and rejects a scope switch", async () => {
    const reference = {
      kind: "managed-asset" as const,
      mediaType: "text/plain",
      name: "notes.txt",
      sha256: "b".repeat(64),
    }
    const document = {
      ...createCanvasDocument({
        id: "canvas-main",
        nodes: [
          createTextNode({
            id: "text-node",
            metadata: { [projectResourceReferenceKey]: reference },
            name: "notes.txt",
            position: { x: 0, y: 0 },
            resourceState: { editableText: false, status: "ready", text: "managed" },
          }),
        ],
      }),
      revision: 7,
    }
    const prepared = {
      items: [
        {
          id: "editable-copy",
          kind: "text" as const,
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/notes-copy.txt" } },
          name: "notes-copy.txt",
          state: { editableText: true, status: "ready" as const, text: "managed" },
        },
      ],
      retainedOnFailure: [{ label: "Notes/notes-copy.txt" }],
    }
    const prepareManagedTextEditableCopy = mock(async () => prepared)
    let failRelink = true
    const relinkPreparedResource = mock(async () => {
      if (failRelink) {
        throw new CanvasResourcePartialFailureError(
          new Error("save failed /native/private"),
          prepared.retainedOnFailure,
        )
      }
      return applicationResult()
    })
    let active = { canvasId: "canvas-main", projectId: "project-one", revision: 7 }
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock(), relinkPreparedResource },
      { prepare: mock(), prepareManagedTextEditableCopy, withAdmittedLocalFiles: mock() },
      {
        documents: { load: mock(async () => ({ document, storageVersion: "v7" })) },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => active,
      },
    )
    const input = {
      canvasId: "canvas-main",
      commandId: "editable-copy",
      expectedRevision: 7,
      nodeId: "text-node",
    }

    await expect(handlers.get("canvas:resource-save-editable-copy")!({ sender: { id: 4 } }, input)).resolves.toEqual({
      kind: canvasResourcePartialFailureKind,
      retainedLabels: ["Notes/notes-copy.txt"],
    })
    await expect(handlers.get("canvas:resource-save-editable-copy")!({ sender: { id: 4 } }, input)).resolves.toEqual({
      kind: canvasResourcePartialFailureKind,
      retainedLabels: ["Notes/notes-copy.txt"],
    })
    expect(prepareManagedTextEditableCopy).toHaveBeenCalledTimes(1)
    expect(relinkPreparedResource).toHaveBeenCalledTimes(1)
    expect(prepareManagedTextEditableCopy).toHaveBeenCalledWith({
      projectId: "project-one",
      reference,
      sourceId: "editable-copy",
    })
    expect(JSON.stringify(prepareManagedTextEditableCopy.mock.calls)).not.toContain('managed"')

    failRelink = false
    const successfulInput = { ...input, commandId: "editable-copy-success" }
    const successful = await handlers.get("canvas:resource-save-editable-copy")!({ sender: { id: 4 } }, successfulInput)
    active = { ...active, revision: 8 }
    await expect(
      handlers.get("canvas:resource-save-editable-copy")!({ sender: { id: 4 } }, successfulInput),
    ).resolves.toEqual(successful)
    expect(prepareManagedTextEditableCopy).toHaveBeenCalledTimes(2)
    expect(relinkPreparedResource).toHaveBeenCalledTimes(2)

    active = { ...active, revision: 7 }
    prepareManagedTextEditableCopy.mockImplementation(async () => {
      active = { canvasId: "other", projectId: "project-two", revision: 0 }
      return prepared
    })
    await expect(
      handlers.get("canvas:resource-save-editable-copy")!(
        { sender: { id: 4 } },
        {
          ...input,
          commandId: "scope-switch",
        },
      ),
    ).resolves.toEqual({
      kind: canvasResourcePartialFailureKind,
      retainedLabels: ["Notes/notes-copy.txt"],
    })
    expect(relinkPreparedResource).toHaveBeenCalledTimes(2)
  })

  test("rejects text and folder relinks whose prepared typed reference is incompatible", async () => {
    const cases = [
      {
        node: createTextNode({
          id: "resource-node",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "missing.md" } },
          position: { x: 0, y: 0 },
          resourceState: { status: "missing" },
        }),
        prepared: {
          id: "relink",
          kind: "text" as const,
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "replacement.html" } },
          state: { status: "stale" as const },
        },
        expected: "Markdown or plain text",
      },
      {
        node: createFolderNode({
          id: "resource-node",
          position: { x: 0, y: 0 },
          resource: {
            id: "old",
            kind: "folder",
            metadata: { [projectResourceReferenceKey]: { kind: "project-directory", path: "missing" } },
            name: "missing",
            state: { status: "missing" },
          },
        }),
        prepared: {
          id: "relink",
          kind: "folder" as const,
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "replacement" } },
          name: "replacement",
          state: { status: "stale" as const },
        },
        expected: "Project directory",
      },
    ]

    for (const item of cases) {
      handlers.clear()
      const document = {
        ...createCanvasDocument({ id: "canvas-main", nodes: [item.node] }),
        revision: 7,
      }
      const relinkPreparedResource = mock()
      registerCanvasResourceIpc(
        { addPreparedResources: mock(), addResources: mock(), relinkPreparedResource },
        {
          prepare: mock(async () => ({ items: [item.prepared] })),
          withAdmittedLocalFiles: mock(),
        },
        {
          documents: { load: mock(async () => ({ document, storageVersion: "v7" })) },
          isTrustedSender: () => true,
          resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
        },
      )

      await expect(
        handlers.get("canvas:resource-relink")!(
          { sender: { id: 1 } },
          {
            canvasId: "canvas-main",
            commandId: `invalid-${item.node.data.kind}`,
            expectedRevision: 7,
            nodeId: "resource-node",
            source: { kind: "host-file", path: "replacement" },
          },
        ),
      ).rejects.toThrow(item.expected)
      expect(relinkPreparedResource).not.toHaveBeenCalled()
    }
  })

  test("rejects an external directory before relink commit and consumes its local token", async () => {
    const document = {
      ...createCanvasDocument({
        id: "canvas-main",
        nodes: [
          createMediaNode({
            id: "file-node",
            position: { x: 0, y: 0 },
            resource: {
              id: "old",
              kind: "file",
              metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "missing.bin" } },
              state: { status: "missing" },
            },
          }),
        ],
      }),
      revision: 7,
    }
    const relinkPreparedResource = mock()
    const withAdmittedLocalFiles = mock(async () => {
      throw new Error("External managed asset source is not a regular file")
    })
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock(), relinkPreparedResource },
      { withAdmittedLocalFiles },
      {
        documents: { load: mock(async () => ({ document, storageVersion: "v7" })) },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )
    const event = { sender: { id: 18 } }
    const sourceToken = "canvas-resource_directory-token"
    await handlers.get("canvas:resource-local-file-register")!(event, {
      sourcePath: "/native/external-directory",
      sourceToken,
    })
    const request = {
      canvasId: "canvas-main",
      commandId: "external-directory",
      expectedRevision: 7,
      nodeId: "file-node",
      source: { kind: "local-file", name: "external-directory", sourceToken },
    }

    await expect(handlers.get("canvas:resource-relink")!(event, request)).rejects.toThrow("selected local file")
    await expect(
      handlers.get("canvas:resource-relink")!(event, {
        ...request,
        commandId: "external-directory-reuse",
      }),
    ).rejects.toThrow("selected local file")
    expect(withAdmittedLocalFiles).toHaveBeenCalledTimes(1)
    expect(relinkPreparedResource).not.toHaveBeenCalled()
  })

  test("binds resource addition to the invoking renderer scope and fixes the UI actor in Main", async () => {
    const event = { sender: { id: 42 } }
    const resolvedEvents: TestEvent[] = []
    const addPreparedResources = mock(
      async (..._args: Parameters<CanvasResourceBusinessService["addPreparedResources"]>) => applicationResult(),
    )
    const addResources = mock(async (..._args: Parameters<CanvasResourceBusinessService["addResources"]>) =>
      applicationResult(),
    )
    const withAdmittedLocalFiles = mock(async (_input, commit) =>
      commit({
        items: [{ id: "outside", kind: "image", metadata: {}, state: { status: "stale" } }],
      }),
    )
    const dispose = registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedLocalFiles },
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
        sources: [],
      }),
    )

    expect(resolvedEvents).toEqual([event])
    expect(withAdmittedLocalFiles).toHaveBeenCalledWith(
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
      sources: [],
    })
    expect(addResources).not.toHaveBeenCalled()
    expect(result).toEqual({ createdNodeIds: ["created"], revision: 8, warnings: ["normalized"] })
    expect(JSON.stringify(result)).not.toContain("/native/outside.png")
    dispose()
  })

  test("prepares new text before local-file admission and deduplicates the complete physical operation", async () => {
    const events: string[] = []
    const prepare = mock(async () => {
      events.push("prepare:new-text")
      return {
        items: [
          {
            id: "note",
            kind: "text" as const,
            metadata: {
              [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/Brief-a1.md" },
            },
            state: { status: "ready" as const, text: "# Brief" },
          },
        ],
        retainedOnFailure: [{ label: "Notes/Brief-a1.md" }],
      }
    })
    const withAdmittedLocalFiles = mock(async (_input, commit) => {
      events.push("admission:enter")
      const result = await commit({
        items: [
          {
            id: "outside",
            kind: "image" as const,
            metadata: {
              [projectResourceReferenceKey]: {
                kind: "managed-asset",
                name: "outside.png",
                sha256: "a".repeat(64),
              },
            },
            state: { status: "stale" as const },
          },
        ],
      })
      events.push("admission:leave")
      return result
    })
    const addPreparedResources = mock(
      async (...[actualRequest, prepared]: Parameters<CanvasResourceBusinessService["addPreparedResources"]>) => {
        events.push("canvas:add")
        expect(actualRequest.sources).toEqual([])
        expect(prepared.items.map((item) => item.id)).toEqual(["note", "outside"])
        expect(prepared.retainedOnFailure).toEqual([{ label: "Notes/Brief-a1.md" }])
        return applicationResult()
      },
    )
    registerCanvasResourceIpc(
      { addPreparedResources, addResources: mock() },
      { prepare, withAdmittedLocalFiles },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )
    const input = request({
      commandId: "mixed-new-text-local-file",
      externalFiles: [
        {
          mediaType: "image/png",
          name: "outside.png",
          sourceId: "outside",
          sourcePath: "/native/outside.png",
        },
      ],
      sources: [{ kind: "new-text", name: "Brief", sourceId: "note", text: "# Brief" }],
    })

    const first = await handlers.get("canvas:resource-add")!({ sender: { id: 42 } }, input)
    const replay = await handlers.get("canvas:resource-add")!({ sender: { id: 42 } }, input)

    expect(replay).toEqual(first)
    expect(events).toEqual(["prepare:new-text", "admission:enter", "canvas:add", "admission:leave"])
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(withAdmittedLocalFiles).toHaveBeenCalledTimes(1)
    expect(addPreparedResources).toHaveBeenCalledTimes(1)
  })

  test("uses addResources once when no local File admission is needed", async () => {
    const addResources = mock(async (..._args: Parameters<CanvasResourceBusinessService["addResources"]>) =>
      applicationResult(),
    )
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources },
      { withAdmittedLocalFiles: mock() },
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
    const withAdmittedLocalFiles = mock()
    registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedLocalFiles },
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
    expect(withAdmittedLocalFiles).not.toHaveBeenCalled()
  })

  test("validates the complete relation shape before invoking Canvas business services", async () => {
    const addPreparedResources = mock()
    const addResources = mock()
    registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedLocalFiles: mock() },
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
    const withAdmittedLocalFiles = mock()
    registerCanvasResourceIpc(
      { addPreparedResources, addResources },
      { withAdmittedLocalFiles },
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
    expect(withAdmittedLocalFiles).not.toHaveBeenCalled()
    expect(addPreparedResources).not.toHaveBeenCalled()
    expect(addResources).not.toHaveBeenCalled()
  })

  test("bounds local-file failures without returning a native path", async () => {
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock() },
      {
        async withAdmittedLocalFiles() {
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
        async prepare() {
          return { items: [] }
        },
        async withAdmittedLocalFiles(_input, commit) {
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
      "Notes/private.rtf",
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
          async prepare() {
            return { items: [] }
          },
          async withAdmittedLocalFiles(_input, commit) {
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

  test("reads a directly connected typed image twice without accepting a path or reference", async () => {
    const reference = { kind: "project-file" as const, path: "Images/hero.png" }
    const image = createMediaNode({
      id: "image-node",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: reference },
        state: { status: "stale" },
      },
    })
    const owner: CanvasNode = {
      data: { kind: "plugin.example", label: "Plugin", metadata: {} },
      id: "plugin-node",
      position: { x: 100, y: 0 },
      type: "file",
    }
    const document = {
      ...createCanvasDocument({
        edges: [{ id: "image-to-plugin", source: image.id, target: owner.id, type: "canvas" }],
        id: "canvas-main",
        nodes: [image, owner],
      }),
      revision: 7,
    }
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const readImage = mock(async () => ({
      bytes,
      contentDigest: "a".repeat(64),
      mimeType: "image/png" as const,
      name: "hero.png",
      size: bytes.byteLength,
    }))
    const load = mock(async () => ({ document, storageVersion: "v7" }))
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock() },
      { withAdmittedLocalFiles: mock() },
      {
        documents: { load },
        images: { readImage },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )

    const result = await handlers.get("canvas:resource-read-connected-image")!(
      { sender: { id: 1 } },
      { canvasId: "canvas-main", expectedRevision: 7, nodeId: "image-node", ownerNodeId: "plugin-node" },
    )

    expect(load).toHaveBeenCalledTimes(3)
    expect(readImage).toHaveBeenCalledTimes(2)
    expect(readImage).toHaveBeenNthCalledWith(1, {
      maximumBytes: 16 * 1024 * 1024,
      projectId: "project-one",
      reference,
    })
    expect(readImage).toHaveBeenNthCalledWith(2, {
      maximumBytes: 16 * 1024 * 1024,
      projectId: "project-one",
      reference,
    })
    expect(result).toEqual({
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      mimeType: "image/png",
      name: "hero.png",
      size: bytes.byteLength,
    })
    expect(JSON.stringify(result)).not.toContain("path")
    expect(JSON.stringify(result)).not.toContain("reference")
    expect(JSON.stringify(result)).not.toContain("project-one")
  })

  test("rejects stale connected-image authority and physical bytes after the bounded read", async () => {
    const reference = {
      kind: "managed-asset" as const,
      mediaType: "image/png",
      name: "hero.png",
      sha256: "a".repeat(64),
    }
    const image = createMediaNode({
      id: "image-node",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: reference },
        state: { status: "stale" },
      },
    })
    const owner: CanvasNode = {
      data: { kind: "plugin.example", label: "Plugin", metadata: {} },
      id: "plugin-node",
      position: { x: 100, y: 0 },
      type: "file",
    }
    const document = {
      ...createCanvasDocument({
        edges: [{ id: "image-to-plugin", source: image.id, target: owner.id, type: "canvas" }],
        id: "canvas-main",
        nodes: [image, owner],
      }),
      revision: 7,
    }
    let readCount = 0
    const readImage = mock(async () => {
      readCount += 1
      const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, readCount])
      return {
        bytes,
        contentDigest: `${readCount}`.repeat(64),
        mimeType: "image/png" as const,
        name: "hero.png",
        size: bytes.byteLength,
      }
    })
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources: mock() },
      { withAdmittedLocalFiles: mock() },
      {
        documents: { load: mock(async () => ({ document, storageVersion: "v7" })) },
        images: { readImage },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
      },
    )
    const event = { sender: { id: 1 } }
    const input = { canvasId: "canvas-main", expectedRevision: 7, nodeId: "image-node", ownerNodeId: "plugin-node" }

    await expect(handlers.get("canvas:resource-read-connected-image")!(event, input)).rejects.toThrow(/changed/i)
    document.edges.length = 0
    await expect(handlers.get("canvas:resource-read-connected-image")!(event, input)).rejects.toThrow(/connected/i)
    expect(readImage).toHaveBeenCalledTimes(2)
    await expect(
      handlers.get("canvas:resource-read-connected-image")!(event, { ...input, path: "Images/hero.png" }),
    ).rejects.toThrow(/unsupported field/i)
  })

  test("rejects forged connected-image scope, topology, type, and references before reading bytes", async () => {
    const reference = { kind: "project-file" as const, path: "Images/hero.png" }
    const image = createMediaNode({
      id: "image-node",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: reference },
        state: { status: "stale" },
      },
    })
    const owner: CanvasNode = {
      data: { kind: "plugin.example", label: "Plugin", metadata: {} },
      id: "plugin-node",
      position: { x: 100, y: 0 },
      type: "file",
    }
    const valid = {
      ...createCanvasDocument({
        edges: [{ id: "image-to-plugin", source: image.id, target: owner.id, type: "canvas" }],
        id: "canvas-main",
        nodes: [image, owner],
      }),
      revision: 7,
    }
    const input = { canvasId: "canvas-main", expectedRevision: 7, nodeId: image.id, ownerNodeId: owner.id }
    const reverseEdge = {
      ...valid,
      edges: [{ id: "plugin-to-image", source: owner.id, target: image.id, type: "canvas" as const }],
    }
    const directoryImage = {
      ...valid,
      nodes: valid.nodes.map((node) =>
        node.id === image.id
          ? {
              ...node,
              data: {
                ...node.data,
                metadata: {
                  [projectResourceReferenceKey]: { kind: "project-directory" as const, path: "Images" },
                },
              },
            }
          : node,
      ),
    }
    const malformedImage = {
      ...valid,
      nodes: valid.nodes.map((node) =>
        node.id === image.id
          ? {
              ...node,
              data: {
                ...node.data,
                metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "../escape.png" } },
              },
            }
          : node,
      ),
    }

    for (const testCase of [
      { active: null, document: valid, trusted: true },
      {
        active: { canvasId: "other-canvas", projectId: "project-one", revision: 7 },
        document: valid,
        trusted: true,
      },
      {
        active: { canvasId: "canvas-main", projectId: "project-one", revision: 7 },
        document: reverseEdge,
        trusted: true,
      },
      {
        active: { canvasId: "canvas-main", projectId: "project-one", revision: 7 },
        document: directoryImage,
        trusted: true,
      },
      {
        active: { canvasId: "canvas-main", projectId: "project-one", revision: 7 },
        document: malformedImage,
        trusted: true,
      },
      {
        active: { canvasId: "canvas-main", projectId: "project-one", revision: 7 },
        document: valid,
        trusted: false,
      },
    ]) {
      handlers.clear()
      const readImage = mock()
      registerCanvasResourceIpc(
        { addPreparedResources: mock(), addResources: mock() },
        { withAdmittedLocalFiles: mock() },
        {
          documents: { load: mock(async () => ({ document: testCase.document, storageVersion: "v7" })) },
          images: { readImage },
          isTrustedSender: () => testCase.trusted,
          resolveActiveCanvas: async () => testCase.active,
        },
      )

      await expect(
        handlers.get("canvas:resource-read-connected-image")!({ sender: { id: 1 } }, input),
      ).rejects.toThrow()
      expect(readImage).not.toHaveBeenCalled()
    }
  })

  test("rechecks connected-image authority after each physical read", async () => {
    const originalReference = { kind: "project-file" as const, path: "Images/hero.png" }
    const image = createMediaNode({
      id: "image-node",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: originalReference },
        state: { status: "stale" },
      },
    })
    const owner: CanvasNode = {
      data: { kind: "plugin.example", label: "Plugin", metadata: {} },
      id: "plugin-node",
      position: { x: 100, y: 0 },
      type: "file",
    }
    const valid = {
      ...createCanvasDocument({
        edges: [{ id: "image-to-plugin", source: image.id, target: owner.id, type: "canvas" }],
        id: "canvas-main",
        nodes: [image, owner],
      }),
      revision: 7,
    }
    const changedReference = {
      ...valid,
      nodes: valid.nodes.map((node) =>
        node.id === image.id
          ? {
              ...node,
              data: {
                ...node.data,
                metadata: {
                  [projectResourceReferenceKey]: { kind: "project-file" as const, path: "Images/replacement.png" },
                },
              },
            }
          : node,
      ),
    }
    const disconnected = { ...valid, edges: [] }
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const input = { canvasId: "canvas-main", expectedRevision: 7, nodeId: image.id, ownerNodeId: owner.id }

    for (const testCase of [
      { changed: disconnected, changedAtLoad: 2, expectedReads: 1 },
      { changed: changedReference, changedAtLoad: 3, expectedReads: 2 },
    ]) {
      handlers.clear()
      let loads = 0
      const load = mock(async () => {
        loads += 1
        return { document: loads >= testCase.changedAtLoad ? testCase.changed : valid, storageVersion: "v7" }
      })
      const readImage = mock(async () => ({
        bytes,
        contentDigest: "a".repeat(64),
        mimeType: "image/png" as const,
        name: "hero.png",
        size: bytes.byteLength,
      }))
      registerCanvasResourceIpc(
        { addPreparedResources: mock(), addResources: mock() },
        { withAdmittedLocalFiles: mock() },
        {
          documents: { load },
          images: { readImage },
          isTrustedSender: () => true,
          resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 7 }),
        },
      )

      await expect(
        handlers.get("canvas:resource-read-connected-image")!({ sender: { id: 1 } }, input),
      ).rejects.toThrow()
      expect(readImage).toHaveBeenCalledTimes(testCase.expectedReads)
      expect(load).toHaveBeenCalledTimes(testCase.changedAtLoad)
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
  test("opens GC scheduling from authoritative Canvas document access without exposing whole-document save", async () => {
    const document = textDocument()
    const completeProjectCanvasAccess = mock(() => undefined)
    const prepareProjectCanvasAccess = mock(() => completeProjectCanvasAccess)
    const load = mock(async () => {
      expect(prepareProjectCanvasAccess).toHaveBeenCalledWith("project-one")
      expect(completeProjectCanvasAccess).not.toHaveBeenCalled()
      return { document, storageVersion: "storage-4" }
    })
    const save = mock(async () => ({ storageVersion: "storage-5" }))
    registerCanvasDocumentIpc(
      { load, save },
      { hydrate: mock(async ({ document: loaded }) => loaded) },
      { isTrustedSender: () => true, prepareProjectCanvasAccess },
    )

    await handlers.get("canvas:document-load")!(
      { sender: { id: 2 } },
      { canvasId: "canvas-main", scopeId: "project-one" },
    )

    expect(handlers.has("canvas:document-save")).toBeFalse()
    expect(save).not.toHaveBeenCalled()
    expect(prepareProjectCanvasAccess).toHaveBeenCalledTimes(1)
    expect(completeProjectCanvasAccess).toHaveBeenCalledTimes(1)
  })

  test("does not open GC scheduling when the Canvas document load fails", async () => {
    const completeProjectCanvasAccess = mock(() => undefined)
    const prepareProjectCanvasAccess = mock(() => completeProjectCanvasAccess)
    registerCanvasDocumentIpc(
      {
        load: mock(async () => {
          throw new Error("unsupported Canvas document")
        }),
        save: mock(),
      },
      { hydrate: mock() },
      { isTrustedSender: () => true, prepareProjectCanvasAccess },
    )

    await expect(
      handlers.get("canvas:document-load")!({ sender: { id: 2 } }, { canvasId: "canvas-main", scopeId: "project-one" }),
    ).rejects.toThrow("unsupported Canvas document")
    expect(prepareProjectCanvasAccess).toHaveBeenCalledWith("project-one")
    expect(completeProjectCanvasAccess).not.toHaveBeenCalled()
  })

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
    registerCanvasDocumentIpc({ load, save: mock() }, { hydrate }, { isTrustedSender: () => true })

    const result = await handlers.get("canvas:document-load")!(
      { sender: { id: 2 } },
      { canvasId: "canvas-main", scopeId: "project-one" },
    )

    expect(hydrate).toHaveBeenCalledWith({ document, projectId: "project-one" })
    expect(result).toMatchObject({
      document: {
        nodes: [
          expect.objectContaining({
            data: expect.objectContaining({ resourceState: { status: "ready", text: "# Hydrated" } }),
          }),
        ],
      },
      storageVersion: "storage-4",
    })
  })

  test("hydrates only stale resources for the invoking renderer's exact live document", async () => {
    const document = textDocument()
    const durable = dehydrateProjectCanvasDocument(document)
    const hydrateStale = mock(async ({ document: requested }) => ({
      ...requested,
      nodes: requested.nodes.map((node: ReturnType<typeof textDocument>["nodes"][number]) => ({
        ...node,
        data: { ...node.data, resourceState: { status: "ready", text: "fresh" } },
      })),
    }))
    const event = { sender: { id: 27 } }
    const load = mock(async () => ({ document: durable, storageVersion: "storage-4" }))
    registerCanvasDocumentIpc(
      { load, save: mock() },
      { hydrate: mock(), hydrateStale },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async (actualEvent) => {
          expect(actualEvent.sender.id).toBe(27)
          return { canvasId: "canvas-main", projectId: "project-one", revision: 4 }
        },
      },
    )

    const result = await handlers.get("canvas:resource-hydrate-stale")!(event, {
      canvasId: "canvas-main",
      revision: 4,
    })

    expect(load).toHaveBeenCalledWith({ canvasId: "canvas-main", scopeId: "project-one" })
    expect(hydrateStale).toHaveBeenCalledWith({ document, projectId: "project-one" })
    expect(result).toMatchObject({
      nodes: [
        expect.objectContaining({
          data: expect.objectContaining({ resourceState: { status: "ready", text: "fresh" } }),
        }),
      ],
    })
  })

  test("rejects renderer-supplied scope and document fields before a forged reference can be read", async () => {
    const forged = textDocument({ kind: "project-file", path: "Secrets/forged.md" })
    const load = mock(async () => ({
      document: dehydrateProjectCanvasDocument(textDocument()),
      storageVersion: "storage-4",
    }))
    const hydrateStale = mock(async () => {
      throw new Error("forged reference was read")
    })
    registerCanvasDocumentIpc(
      { load, save: mock() },
      { hydrate: mock(), hydrateStale },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one", revision: 4 }),
      },
    )

    await expect(
      handlers.get("canvas:resource-hydrate-stale")!(
        { sender: { id: 27 } },
        {
          canvasId: "canvas-main",
          document: forged,
          projectId: "project-one",
        },
      ),
    ).rejects.toThrow("unsupported field")
    expect(load).not.toHaveBeenCalled()
    expect(hydrateStale).not.toHaveBeenCalled()
  })
})

describe("Canvas text resource IPC", () => {
  function register(
    options: {
      document?: ReturnType<typeof textDocument>
      replace?: (input: unknown) => Promise<{ contentRevision: string }>
      resolve?: (event: TestEvent) => Promise<{ canvasId: string; projectId: string; revision: number } | null>
    } = {},
  ) {
    const compareAndReplaceTextFile = mock(options.replace ?? (async () => ({ contentRevision: "b".repeat(64) })))
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
        handlers.get("canvas:text-resource-save")!(
          { sender: { id: 1 } },
          {
            content: "changed",
            contentRevision: "a".repeat(64),
            nodeId: "text-node",
            ...extra,
          },
        ),
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
        handlers.get("canvas:text-resource-save")!(
          { sender: { id: 1 } },
          {
            content: "changed",
            contentRevision: "a".repeat(64),
            nodeId: "text-node",
          },
        ),
      ).rejects.toThrow("not editable")
      expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
    }

    handlers.clear()
    const document = textDocument()
    document.nodes[0] = { ...document.nodes[0]!, data: { ...document.nodes[0]!.data, kind: "image" } }
    const ports = register({ document })
    await expect(
      handlers.get("canvas:text-resource-save")!(
        { sender: { id: 1 } },
        {
          content: "changed",
          contentRevision: "a".repeat(64),
          nodeId: "text-node",
        },
      ),
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
      handlers.get("canvas:text-resource-save")!(
        { sender: { id: 8 } },
        {
          content: "changed",
          contentRevision: "a".repeat(64),
          nodeId: "text-node",
        },
      ),
    ).rejects.toThrow("live Workbench scope")
    expect(ports.compareAndReplaceTextFile).not.toHaveBeenCalled()
  })

  test("rejects a loaded durable document from a different live Canvas revision", async () => {
    const ports = register({ document: { ...textDocument(), revision: 5 } })

    await expect(
      handlers.get("canvas:text-resource-save")!(
        { sender: { id: 8 } },
        {
          content: "changed",
          contentRevision: "a".repeat(64),
          nodeId: "text-node",
        },
      ),
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
      handlers.get("canvas:text-resource-save")!(
        { sender: { id: 8 } },
        {
          content: "changed",
          contentRevision: "a".repeat(64),
          nodeId: "text-node",
        },
      ),
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

    const result = await handlers.get("canvas:text-resource-save")!(
      { sender: { id: 1 } },
      {
        content: "changed",
        contentRevision: "a".repeat(64),
        nodeId: "text-node",
      },
    )

    expect(result).toEqual({ actualRevision: "c".repeat(64), kind: canvasTextResourceConflictKind })
    expect(JSON.stringify(result)).not.toContain("/native/")
  })
})
