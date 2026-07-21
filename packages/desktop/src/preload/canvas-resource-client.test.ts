import { describe, expect, mock, test } from "bun:test"
import { canvasResourcePartialFailureKind } from "../canvas-resource-private-contract"
import { createCanvasResourcePreloadClient } from "./canvas-resource-client"

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
  test("consumes a local File token into a Main-private path without exposing it in the result", async () => {
    const { client, invoke } = setup()
    const file = new File(["outside"], "outside.png", { type: "image/png" })
    const sourceToken = client.createLocalFileToken(file)

    const result = await client.add(
      request({
        localFiles: [{ mediaType: file.type, name: file.name, sourceId: "outside", sourceToken }],
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
