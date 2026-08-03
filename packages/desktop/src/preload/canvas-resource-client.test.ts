import { describe, expect, mock, test } from "bun:test"
import { canvasResourcePartialFailureKind } from "../canvas-resource-private-contract"
import { CanvasTextResourceConflictError } from "@convax/canvas/application"
import {
  canvasResourceHydrateStaleIpcChannel,
  canvasResourceReadConnectedImageIpcChannel,
  canvasTextResourceIpcChannel,
} from "../desktop-protocol"
import { createCanvasDocument, createTextNode } from "@convax/canvas/core"
import { createCanvasResourcePreloadClient, createCanvasTextResourcePreloadClient } from "./canvas-resource-client"

function request(overrides: Record<string, unknown> = {}) {
  return {
    anchor: { x: 20, y: 40 },
    canvasId: "canvas-main",
    commandId: "add-resources",
    expectedRevision: 3,
    localFiles: [],
    projectId: "project-one",
    sources: [{ kind: "host-file" as const, path: "media/hero.png", sourceId: "hero" }],
    ...overrides,
  }
}

function setup(
  invoke = mock(
    async (_channel?: string, _input?: unknown): Promise<unknown> => ({
      createdNodeIds: ["created"],
      revision: 4,
      warnings: [],
    }),
  ),
) {
  let nextToken = 0
  const client = createCanvasResourcePreloadClient({
    getPathForFile: (file) => `/native/${file.name}`,
    invoke,
    now: () => 100,
    randomUUID: () => `token-${++nextToken}`,
  })
  return { client, invoke }
}

describe("preload Canvas resource client", () => {
  test("relinks from one portable Project source without accepting Project ids, references, native paths, or bodies", async () => {
    const { client, invoke } = setup()

    await expect(
      client.relink({
        canvasId: "canvas-main",
        commandId: "relink-project-file",
        expectedRevision: 3,
        nodeId: "image-node",
        source: { kind: "host-file", path: "media/replacement.png" },
      }),
    ).resolves.toMatchObject({ revision: 4 })

    expect(invoke).toHaveBeenCalledWith("canvas:resource-relink", {
      canvasId: "canvas-main",
      commandId: "relink-project-file",
      expectedRevision: 3,
      nodeId: "image-node",
      source: { kind: "host-file", path: "media/replacement.png" },
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("projectId")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("reference")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("body")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("/native/")
  })

  test("registers and consumes a local-file relink token exactly once while keeping its path out of relink IPC", async () => {
    const invoke = mock(
      async (channel?: string, _input?: unknown): Promise<unknown> =>
        channel === "canvas:resource-local-file-register"
          ? undefined
          : { createdNodeIds: [], revision: 4, warnings: [] },
    )
    const { client } = setup(invoke)
    const file = new File(["replacement"], "replacement.png", { type: "image/png" })
    const sourceToken = client.createLocalFileToken(file)
    const input = {
      canvasId: "canvas-main",
      commandId: "relink-local-file",
      expectedRevision: 3,
      nodeId: "image-node",
      source: { kind: "local-file" as const, mediaType: file.type, name: file.name, sourceToken },
    }

    await expect(client.relink(input)).resolves.toMatchObject({ revision: 4 })
    expect(invoke.mock.calls[0]).toEqual([
      "canvas:resource-local-file-register",
      { sourcePath: "/native/replacement.png", sourceToken },
    ])
    expect(invoke.mock.calls[1]).toEqual([
      "canvas:resource-relink",
      {
        canvasId: "canvas-main",
        commandId: "relink-local-file",
        expectedRevision: 3,
        nodeId: "image-node",
        source: { kind: "local-file", mediaType: "image/png", name: "replacement.png", sourceToken },
      },
    ])
    expect(JSON.stringify(invoke.mock.calls[1])).not.toContain("/native/")
    await expect(client.relink({ ...input, commandId: "reuse-local-file" })).rejects.toThrow("authorization")
  })

  test("requests an editable managed-text copy without sending text, a reference, path, or Project id", async () => {
    const { client, invoke } = setup()

    await expect(
      client.saveEditableCopy({
        canvasId: "canvas-main",
        commandId: "save-editable-copy",
        expectedRevision: 3,
        nodeId: "managed-text",
      }),
    ).resolves.toMatchObject({ revision: 4 })

    expect(invoke).toHaveBeenCalledWith("canvas:resource-save-editable-copy", {
      canvasId: "canvas-main",
      commandId: "save-editable-copy",
      expectedRevision: 3,
      nodeId: "managed-text",
    })
    const serialized = JSON.stringify(invoke.mock.calls)
    expect(serialized).not.toContain("projectId")
    expect(serialized).not.toContain("reference")
    expect(serialized).not.toContain("content")
    expect(serialized).not.toContain("path")
  })

  test("requests stale runtime hydration without exposing a native path", async () => {
    const document = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "note",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/a.md" } },
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        }),
      ],
    })
    const hydrated = {
      ...document,
      nodes: document.nodes.map((node) => ({
        ...node,
        data: { ...node.data, resourceState: { status: "ready", text: "fresh" } },
      })),
    }
    const invoke = mock(async () => hydrated)
    const { client } = setup(invoke)

    await expect(client.hydrateStale({ canvasId: "canvas-main", revision: document.revision })).resolves.toEqual(
      hydrated,
    )
    expect(invoke).toHaveBeenCalledWith(canvasResourceHydrateStaleIpcChannel, {
      canvasId: "canvas-main",
      revision: document.revision,
    })
  })

  test("reads a connected image using only Canvas guards and node ids", async () => {
    const invoke = mock(async () => ({
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      name: "hero.png",
      size: 8,
    }))
    const { client } = setup(invoke)

    const result = await client.readConnectedImage({
      canvasId: "canvas-main",
      expectedRevision: 3,
      nodeId: "image-node",
      ownerNodeId: "plugin-node",
    })

    expect(invoke).toHaveBeenCalledWith(canvasResourceReadConnectedImageIpcChannel, {
      canvasId: "canvas-main",
      expectedRevision: 3,
      nodeId: "image-node",
      ownerNodeId: "plugin-node",
    })
    expect(result).toEqual({
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      name: "hero.png",
      size: 8,
    })
    const serialized = JSON.stringify(invoke.mock.calls)
    expect(serialized).not.toContain("projectId")
    expect(serialized).not.toContain("path")
    expect(serialized).not.toContain("reference")
    expect(serialized).not.toContain("body")
  })

  test("rejects non-canonical connected-image responses", async () => {
    const valid = {
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      name: "hero.png",
      size: 8,
    }
    for (const response of [
      { ...valid, path: "/native/hero.png" },
      { ...valid, mimeType: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,iVBORw0KGgo=" },
      { ...valid, dataUrl: "data:image/png;base64,not canonical" },
      { ...valid, size: 7 },
    ]) {
      const { client } = setup(mock(async () => response))
      await expect(
        client.readConnectedImage({
          canvasId: "canvas-main",
          expectedRevision: 3,
          nodeId: "image-node",
          ownerNodeId: "plugin-node",
        }),
      ).rejects.toThrow("Connected Canvas image response is invalid")
    }
  })

  test("consumes a local File token into a Main-private path without exposing it in the result", async () => {
    const { client, invoke } = setup()
    const file = new File(["outside"], "outside.png", { type: "image/png" })
    const sourceToken = client.createLocalFileToken(file)

    const result = await client.add(
      request({
        localFiles: [{ mediaType: file.type, name: file.name, sourceId: "outside", sourceToken }],
        parentId: "focused-group",
      }),
    )

    expect(invoke).toHaveBeenCalledWith("canvas:resource-add", {
      anchor: { x: 20, y: 40 },
      canvasId: "canvas-main",
      commandId: "add-resources",
      expectedRevision: 3,
      externalFiles: [
        {
          mediaType: "image/png",
          name: "outside.png",
          sourceId: "outside",
          sourcePath: "/native/outside.png",
        },
      ],
      parentId: "focused-group",
      projectId: "project-one",
      sources: [{ kind: "host-file", path: "media/hero.png", sourceId: "hero" }],
    })
    expect(JSON.stringify(result)).not.toContain("/native/outside.png")
    await expect(
      client.add(
        request({
          commandId: "reuse-token",
          localFiles: [{ name: file.name, sourceId: "outside", sourceToken }],
          sources: [],
        }),
      ),
    ).rejects.toThrow("authorization")
  })

  test("rejects duplicate tokens and cross-array source ids without partially consuming the batch", async () => {
    const { client, invoke } = setup()
    const file = new File(["outside"], "outside.png")
    const sourceToken = client.createLocalFileToken(file)

    await expect(
      client.add(
        request({
          localFiles: [
            { name: file.name, sourceId: "outside-a", sourceToken },
            { name: file.name, sourceId: "outside-b", sourceToken },
          ],
          sources: [],
        }),
      ),
    ).rejects.toThrow("duplicated")
    await expect(
      client.add(
        request({
          localFiles: [{ name: file.name, sourceId: "hero", sourceToken }],
        }),
      ),
    ).rejects.toThrow("source id is duplicated")
    expect(invoke).not.toHaveBeenCalled()

    await expect(
      client.add(
        request({
          commandId: "valid-retry",
          localFiles: [{ name: file.name, sourceId: "outside", sourceToken }],
          sources: [],
        }),
      ),
    ).resolves.toMatchObject({ revision: 4 })
  })

  test("an invalid token does not consume valid peers, while an IPC failure consumes the whole valid batch", async () => {
    const invoke = mock(async () => {
      throw new Error("ENOENT: /native/private/outside.png")
    })
    const { client } = setup(invoke)
    const first = client.createLocalFileToken(new File(["a"], "a.png"))

    await expect(
      client.add(
        request({
          localFiles: [
            { name: "a.png", sourceId: "a", sourceToken: first },
            { name: "missing.png", sourceId: "missing", sourceToken: "missing-token" },
          ],
          sources: [],
        }),
      ),
    ).rejects.toThrow("authorization")
    expect(invoke).not.toHaveBeenCalled()

    let failure: unknown
    try {
      await client.add(
        request({
          commandId: "ipc-failure",
          localFiles: [{ name: "a.png", sourceId: "a", sourceToken: first }],
          sources: [],
        }),
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    const message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain("Could not add")
    expect(message).not.toContain("/native/")
    expect(invoke).toHaveBeenCalledTimes(1)
    await expect(
      client.add(
        request({
          commandId: "after-ipc-failure",
          localFiles: [{ name: "a.png", sourceId: "a", sourceToken: first }],
          sources: [],
        }),
      ),
    ).rejects.toThrow("authorization")
  })

  test("does not evict or consume valid tokens when a full-capacity batch contains an invalid token", async () => {
    const { client, invoke } = setup()
    const tokens = Array.from({ length: 1_000 }, (_, index) =>
      client.createLocalFileToken(new File([String(index)], `file-${index}.txt`)),
    )
    const oldest = tokens[0]!

    await expect(
      client.add(
        request({
          localFiles: [
            { name: "file-0.txt", sourceId: "oldest", sourceToken: oldest },
            { name: "missing.txt", sourceId: "missing", sourceToken: "missing-token" },
          ],
          sources: [],
        }),
      ),
    ).rejects.toThrow("authorization")
    expect(invoke).not.toHaveBeenCalled()

    await expect(
      client.add(
        request({
          commandId: "use-oldest-after-invalid-batch",
          localFiles: [{ name: "file-0.txt", sourceId: "oldest", sourceToken: oldest }],
          sources: [],
        }),
      ),
    ).resolves.toMatchObject({ revision: 4 })
  })

  test("does not mint a token for an in-memory File without a native path", () => {
    const client = createCanvasResourcePreloadClient({
      getPathForFile: () => "",
      invoke: async () => ({ createdNodeIds: [], revision: 0, warnings: [] }),
      randomUUID: () => "unused",
    })
    expect(client.createLocalFileToken(new File(["memory"], "memory.txt"))).toBe("")
  })

  test("reports bounded partial success when a new-text commit fails after Notes publication", async () => {
    const { client } = setup(
      mock(async () => ({ kind: canvasResourcePartialFailureKind, retainedLabels: ["Notes/Brief-a1.md"] })),
    )

    let failure: unknown
    try {
      await client.add(
        request({
          localFiles: [],
          sources: [{ kind: "new-text", sourceId: "note", text: "Draft" }],
        }),
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    const message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain("retained")
    expect(message).toContain("Notes/Brief-a1.md")
    expect(message).not.toContain("/native/")
  })

  test("does not claim retention for an ordinary invoke failure", async () => {
    const { client } = setup(
      mock(async () => {
        throw new Error("Canvas save failed after writing /native/project/Notes/Private.md")
      }),
    )

    let failure: unknown
    try {
      await client.add(request())
    } catch (error) {
      failure = error
    }
    const message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain("Could not add")
    expect(message).not.toContain("retained")
    expect(message).not.toContain("Notes/Private.md")
    expect(message).not.toContain("/native/")
  })
})

describe("Canvas text resource preload client", () => {
  test("sends only node id, content, and content revision", async () => {
    const invoke = mock(async () => ({ contentRevision: "b".repeat(64) }))
    const client = createCanvasTextResourcePreloadClient({ invoke })

    await expect(
      client.save(
        { content: "# Changed", contentRevision: "a".repeat(64), nodeId: "text-node" },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ contentRevision: "b".repeat(64) })

    expect(invoke).toHaveBeenCalledWith(canvasTextResourceIpcChannel, {
      content: "# Changed",
      contentRevision: "a".repeat(64),
      nodeId: "text-node",
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("projectId")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("path")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("reference")
  })

  test("does not invoke Main when already aborted", async () => {
    const invoke = mock(async () => ({ contentRevision: "b".repeat(64) }))
    const client = createCanvasTextResourcePreloadClient({ invoke })
    const controller = new AbortController()
    controller.abort(new DOMException("Aborted", "AbortError"))

    await expect(
      client.save({ content: "changed", contentRevision: "a".repeat(64), nodeId: "text-node" }, controller.signal),
    ).rejects.toHaveProperty("name", "AbortError")
    expect(invoke).not.toHaveBeenCalled()
  })

  test("reconstructs a typed conflict and bounds ordinary native failures", async () => {
    const conflict = createCanvasTextResourcePreloadClient({
      invoke: async () => ({ actualRevision: "c".repeat(64), kind: "canvas-text-resource-conflict" }),
    })
    let conflictError: unknown
    try {
      await conflict.save(
        { content: "changed", contentRevision: "a".repeat(64), nodeId: "text-node" },
        new AbortController().signal,
      )
    } catch (error) {
      conflictError = error
    }
    expect(conflictError).toBeInstanceOf(CanvasTextResourceConflictError)
    expect((conflictError as CanvasTextResourceConflictError).actualRevision).toBe("c".repeat(64))

    const failed = createCanvasTextResourcePreloadClient({
      invoke: async () => {
        throw new Error("ENOENT /native/private/project/Notes/brief.md")
      },
    })
    await expect(
      failed.save(
        { content: "changed", contentRevision: "a".repeat(64), nodeId: "text-node" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Could not save the Canvas text resource")
  })
})
