import { afterEach, describe, expect, mock, test } from "bun:test"
import { CanvasResourcePartialFailureError, type CanvasResourceBusinessService } from "@convax/canvas/application"
import { createCanvasDocument } from "@convax/canvas/core"
import { canvasResourcePartialFailureKind } from "../canvas-resource-private-contract"

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

const { registerCanvasResourceIpc } = await import("./canvas-document-ipc")

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
