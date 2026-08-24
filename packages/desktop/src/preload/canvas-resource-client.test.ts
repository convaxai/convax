import { describe, expect, mock, test } from "bun:test"
import { canvasResourcePartialFailureKind } from "../canvas-resource-private-contract"
import { CanvasTextResourceConflictError } from "@convax/canvas/application/errors"
import {
  canvasResourceHydrateStaleIpcChannel,
  canvasResourceIpcChannel,
  canvasResourceReadConnectedImageIpcChannel,
  canvasTextResourceIpcChannel,
} from "../desktop-protocol"
import { encodeBase64url, parseActorId, parseDigest, parseId128, parseUint64 } from "@convax/collaboration"
import { createCanvasResourcePreloadClient, createCanvasTextResourcePreloadClient } from "./canvas-resource-client"

function request(overrides: Record<string, unknown> = {}) {
  return {
    anchor: { x: 20, y: 40 },
    canvasId: "canvas-main",
    commandId: "add-resources",
    localFiles: [],
    projectId: "project-one",
    sessionId: parseId128(encodeBase64url(new Uint8Array(16).fill(3))),
    sources: [{ kind: "host-file" as const, path: "media/hero.png", sourceId: "hero" }],
    ...overrides,
  }
}

const resourceSessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(3)))
const certifiedCanvasId = `cv_${"5".repeat(64)}`
const operationReceipt = {
  format: "convax.canvas-operation-receipt" as const,
  actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(1))),
  operationId: parseId128(encodeBase64url(new Uint8Array(16).fill(2))),
  intentKind: "canvas.agent.create" as const,
  intentDigest: parseDigest("a".repeat(64)),
  baseFrontierDigest: parseDigest("b".repeat(64)),
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigest("c".repeat(64)),
}

const appendedSuffix = encodeBase64url(new Uint8Array(32).fill(7))
const appendedEntity = Object.freeze({
  kind: "node" as const,
  id: `n_${appendedSuffix}`,
  incarnation: `ni_${appendedSuffix}`,
})
const certifiedReceipt = Object.freeze({
  ...operationReceipt,
  intentKind: "canvas.resources.add" as const,
  resultEntities: Object.freeze([appendedEntity]),
})

function certifiedResourceAddResult() {
  const patch = {
    format: "convax.canvas-certified-projection-patch" as const,
    kind: "resource-append" as const,
    canvasId: certifiedCanvasId,
    ownerSchemaDigest: parseDigest("1".repeat(64)),
    baseStateCommitmentDigest: parseDigest("2".repeat(64)),
    resultStateCommitmentDigest: parseDigest("3".repeat(64)),
    receipt: certifiedReceipt,
    nodes: [
      {
        ref: appendedEntity,
        role: "file" as const,
        position: { x: 20, y: 40 },
        size: { width: 320, height: 180 },
        data: {
          format: "convax.canvas-node-data" as const,
          kind: "resource" as const,
          title: "Brief.md",
          resource: {
            format: "convax.canvas-resource-ref" as const,
            uri:
              `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
              `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${"1".repeat(64)}` +
              `?blob=sha256%3A${"2".repeat(64)}&path=Notes%2FBrief.md`,
            mediaClass: "text" as const,
            mime: "text/markdown",
            byteLength: parseUint64("5"),
            contentDigest: parseDigest("2".repeat(64)),
            ownerProofDigest: parseDigest("4".repeat(64)),
          },
        },
        plugin: null,
        parent: null,
        generationLifecycle: "none" as const,
      },
    ],
    edges: [],
  }
  return {
    createdNodeIds: [appendedEntity.id],
    delivery: {
      format: "convax.canvas-resource-certified-projection-delivery" as const,
      status: "certified" as const,
      ref: { canvasId: certifiedCanvasId, scopeId: "project-one" },
      sessionId: resourceSessionId,
      acceptedFrameDigest: parseDigest("d".repeat(64)),
      canUndo: true,
      canRedo: false,
      patch,
      resourceHierarchy: {
        format: "convax.canvas-resource-hierarchy-delta" as const,
        projectionIdentity: {
          format: "convax.canvas-certified-projection-identity" as const,
          canvasId: patch.canvasId,
          ownerSchemaDigest: patch.ownerSchemaDigest,
          stateCommitmentDigest: patch.resultStateCommitmentDigest,
        },
        entries: [{
          entity: appendedEntity,
          nodeId: appendedEntity.id,
          classification: { kind: "not-path-backed" as const },
        }],
      },
      runtimePatches: [{ nodeId: appendedEntity.id, state: { status: "ready" as const, text: "hello" } }],
    },
    operationReceipt: certifiedReceipt,
    warnings: [],
  }
}

function resourceResult(createdNodeIds: readonly string[] = ["created"]) {
  void createdNodeIds
  return {
    delivery: { status: "unavailable" as const },
    operationReceipt,
    warnings: [],
  }
}

function resourceAddResult(createdNodeIds: readonly string[] = ["created"]) {
  return {
    createdNodeIds,
    delivery: { status: "unavailable" as const },
    operationReceipt,
    warnings: [],
  }
}

function setup(
  invoke = mock(
    async (channel?: string, _input?: unknown): Promise<unknown> =>
      channel === canvasResourceIpcChannel ? resourceAddResult() : resourceResult(),
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
  test("accepts only a closed owner-certified patch and its exact transient runtime sidecar", async () => {
    const response = certifiedResourceAddResult()
    const { client } = setup(mock(async () => structuredClone(response)))

    await expect(client.add(request({ canvasId: certifiedCanvasId }))).resolves.toMatchObject({
      createdNodeIds: [appendedEntity.id],
      delivery: {
        format: "convax.canvas-resource-certified-projection-delivery",
        status: "certified",
        patch: { baseStateCommitmentDigest: parseDigest("2".repeat(64)) },
        runtimePatches: [{ nodeId: appendedEntity.id, state: { status: "ready", text: "hello" } }],
      },
    })

    const withoutRuntime = certifiedResourceAddResult()
    withoutRuntime.delivery.runtimePatches = []
    const droppedSidecar = setup(mock(async () => withoutRuntime))
    await expect(droppedSidecar.client.add(request({ canvasId: certifiedCanvasId }))).resolves.toMatchObject({
      delivery: { status: "certified", runtimePatches: [] },
    })

    const widened = certifiedResourceAddResult()
    ;(widened.delivery as unknown as Record<string, unknown>).projection = {}
    const invalid = setup(mock(async () => widened))
    await expect(invalid.client.add(request({ canvasId: certifiedCanvasId }))).rejects.toThrow("field set")

    const withoutHierarchy = certifiedResourceAddResult()
    delete (withoutHierarchy.delivery as unknown as Record<string, unknown>).resourceHierarchy
    await expect(
      setup(mock(async () => withoutHierarchy)).client.add(request({ canvasId: certifiedCanvasId })),
    ).rejects.toThrow("field set")

    const widenedHierarchy = certifiedResourceAddResult()
    ;(widenedHierarchy.delivery.resourceHierarchy as unknown as Record<string, unknown>).nativePath = "/private/a"
    await expect(
      setup(mock(async () => widenedHierarchy)).client.add(request({ canvasId: certifiedCanvasId })),
    ).rejects.toThrow("unknown or missing fields")

    const mismatchedHierarchy = certifiedResourceAddResult()
    mismatchedHierarchy.delivery.resourceHierarchy.projectionIdentity.stateCommitmentDigest = parseDigest("9".repeat(64))
    await expect(
      setup(mock(async () => mismatchedHierarchy)).client.add(request({ canvasId: certifiedCanvasId })),
    ).rejects.toThrow("crossed owner projection identity")
  })

  test("relinks from one portable Project source through its mounted session without references, native paths, or bodies", async () => {
    const { client, invoke } = setup()

    await expect(
      client.relink({
        canvasId: "canvas-main",
        commandId: "relink-project-file",
        nodeId: "image-node",
        projectId: "project-one",
        sessionId: resourceSessionId,
        source: { kind: "host-file", path: "media/replacement.png" },
      }),
    ).resolves.toMatchObject({ delivery: { status: "unavailable" } })

    expect(invoke).toHaveBeenCalledWith("canvas:resource-relink", {
      canvasId: "canvas-main",
      commandId: "relink-project-file",
      nodeId: "image-node",
      projectId: "project-one",
      sessionId: resourceSessionId,
      source: { kind: "host-file", path: "media/replacement.png" },
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("reference")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("body")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("/native/")
  })

  test("registers and consumes a local-file relink token exactly once while keeping its path out of relink IPC", async () => {
    const invoke = mock(
      async (channel?: string, _input?: unknown): Promise<unknown> =>
        channel === "canvas:resource-local-file-register" ? undefined : resourceResult([]),
    )
    const { client } = setup(invoke)
    const file = new File(["replacement"], "replacement.png", { type: "image/png" })
    const sourceToken = client.createLocalFileToken(file)
    const input = {
      canvasId: "canvas-main",
      commandId: "relink-local-file",
      nodeId: "image-node",
      projectId: "project-one",
      sessionId: resourceSessionId,
      source: { kind: "local-file" as const, mediaType: file.type, name: file.name, sourceToken },
    }

    await expect(client.relink(input)).resolves.toMatchObject({
      delivery: { status: "unavailable" },
    })
    expect(invoke.mock.calls[0]).toEqual([
      "canvas:resource-local-file-register",
      { sourcePath: "/native/replacement.png", sourceToken },
    ])
    expect(invoke.mock.calls[1]).toEqual([
      "canvas:resource-relink",
      {
        canvasId: "canvas-main",
        commandId: "relink-local-file",
        nodeId: "image-node",
        projectId: "project-one",
        sessionId: resourceSessionId,
        source: { kind: "local-file", mediaType: "image/png", name: "replacement.png", sourceToken },
      },
    ])
    expect(JSON.stringify(invoke.mock.calls[1])).not.toContain("/native/")
    await expect(client.relink({ ...input, commandId: "reuse-local-file" })).rejects.toThrow("authorization")
  })

  test("requests an editable managed-text copy through its mounted session without sending text, a reference, or path", async () => {
    const { client, invoke } = setup()

    await expect(
      client.saveEditableCopy({
        canvasId: "canvas-main",
        commandId: "save-editable-copy",
        nodeId: "managed-text",
        projectId: "project-one",
        sessionId: resourceSessionId,
      }),
    ).resolves.toMatchObject({ delivery: { status: "unavailable" } })

    expect(invoke).toHaveBeenCalledWith("canvas:resource-save-editable-copy", {
      canvasId: "canvas-main",
      commandId: "save-editable-copy",
      nodeId: "managed-text",
      projectId: "project-one",
      sessionId: resourceSessionId,
    })
    const serialized = JSON.stringify(invoke.mock.calls)
    expect(serialized).not.toContain("reference")
    expect(serialized).not.toContain("content")
    expect(serialized).not.toContain("path")
  })

  test("requests exact session-bound stale targets and accepts only their runtime patches", async () => {
    const suffix = encodeBase64url(new Uint8Array(32).fill(4))
    const target = {
      entity: { id: `n_${suffix}`, incarnation: `ni_${suffix}`, kind: "node" as const },
      nodeId: `n_${suffix}`,
    }
    const response = { patches: [{ nodeId: target.nodeId, state: { status: "ready" as const, text: "fresh" } }] }
    const invoke = mock(async () => response)
    const { client } = setup(invoke)

    await expect(
      client.hydrateStale({
        ref: { canvasId: "canvas-main", scopeId: "project-one" },
        sessionId: resourceSessionId,
        targets: [target],
      }),
    ).resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith(canvasResourceHydrateStaleIpcChannel, {
      ref: { canvasId: "canvas-main", scopeId: "project-one" },
      sessionId: resourceSessionId,
      targets: [target],
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("Notes/a.md")
  })

  test("rejects widened, mismatched, incomplete, or malformed runtime hydration patches", async () => {
    const suffix = encodeBase64url(new Uint8Array(32).fill(5))
    const target = {
      entity: { id: `n_${suffix}`, incarnation: `ni_${suffix}`, kind: "node" as const },
      nodeId: `n_${suffix}`,
    }
    const input = {
      ref: { canvasId: "canvas-main", scopeId: "project-one" },
      sessionId: resourceSessionId,
      targets: [target],
    }
    for (const response of [
      { patches: [], extra: true },
      { patches: [] },
      { patches: [{ nodeId: "different", state: { status: "ready" } }] },
      { patches: [{ extra: true, nodeId: target.nodeId, state: { status: "ready" } }] },
      { patches: [{ nodeId: target.nodeId, state: { nativePath: "/private/a", status: "ready" } }] },
      { patches: [{ nodeId: target.nodeId, state: { status: "ready", text: 42 } }] },
    ]) {
      const { client } = setup(mock(async () => response))
      await expect(client.hydrateStale(input)).rejects.toThrow(/Canvas resource refresh/)
    }
  })

  test("rejects malformed or over-bound hydration targets before crossing IPC", async () => {
    const suffix = encodeBase64url(new Uint8Array(32).fill(6))
    const target = {
      entity: { id: `n_${suffix}`, incarnation: `ni_${suffix}`, kind: "node" as const },
      nodeId: `n_${suffix}`,
    }
    const invoke = mock(async () => ({ patches: [] }))
    const { client } = setup(invoke)

    await expect(
      client.hydrateStale({
        ref: { canvasId: "canvas-main", scopeId: "project-one" },
        sessionId: resourceSessionId,
        targets: Array.from({ length: 4_097 }, () => target),
      }),
    ).rejects.toThrow("Canvas resource refresh targets are invalid")
    await expect(
      client.hydrateStale({
        ref: { canvasId: "canvas-main", scopeId: "project-one" },
        sessionId: resourceSessionId,
        targets: [target, target],
      }),
    ).rejects.toThrow("Canvas resource refresh target is invalid")
    await expect(
      client.hydrateStale({
        ref: { canvasId: "canvas-main", scopeId: "project-one" },
        sessionId: "not-a-session",
        targets: [target],
      } as never),
    ).rejects.toThrow("Canvas resource refresh session id")

    expect(invoke).not.toHaveBeenCalled()
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
      nodeId: "image-node",
      ownerNodeId: "plugin-node",
    })

    expect(invoke).toHaveBeenCalledWith(canvasResourceReadConnectedImageIpcChannel, {
      canvasId: "canvas-main",
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
        anchorOrigin: "center",
        localFiles: [{ mediaType: file.type, name: file.name, sourceId: "outside", sourceToken }],
        parentId: "focused-group",
      }),
    )

    expect(invoke).toHaveBeenCalledWith("canvas:resource-add", {
      anchor: { x: 20, y: 40 },
      anchorOrigin: "center",
      canvasId: "canvas-main",
      commandId: "add-resources",
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
      sessionId: resourceSessionId,
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

  test("rejects an unknown resource anchor origin before invoking Main", async () => {
    const { client, invoke } = setup()

    await expect(client.add(request({ anchorOrigin: "bottom-right" }))).rejects.toThrow(
      "Canvas resource anchor origin is invalid",
    )
    expect(invoke).not.toHaveBeenCalled()
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
    ).resolves.toMatchObject({ delivery: { status: "unavailable" } })
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
    ).resolves.toMatchObject({ delivery: { status: "unavailable" } })
  })

  test("does not mint a token for an in-memory File without a native path", () => {
    const client = createCanvasResourcePreloadClient({
      getPathForFile: () => "",
      invoke: async () => resourceResult([]),
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
  const textSaveRequest = {
    canvasId: "canvas-main",
    content: "# Changed",
    contentRevision: "a".repeat(64),
    nodeId: "text-node",
    projectId: "project-one",
    sessionId: resourceSessionId,
  }

  test("sends the mounted Canvas lease and bounded text update", async () => {
    const invoke = mock(async () => ({ contentRevision: "b".repeat(64) }))
    const client = createCanvasTextResourcePreloadClient({ invoke })

    await expect(client.save(textSaveRequest, new AbortController().signal)).resolves.toEqual({
      contentRevision: "b".repeat(64),
    })

    expect(invoke).toHaveBeenCalledWith(canvasTextResourceIpcChannel, {
      canvasId: "canvas-main",
      content: "# Changed",
      contentRevision: "a".repeat(64),
      nodeId: "text-node",
      projectId: "project-one",
      sessionId: resourceSessionId,
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("path")
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("reference")
  })

  test("does not invoke Main when already aborted", async () => {
    const invoke = mock(async () => ({ contentRevision: "b".repeat(64) }))
    const client = createCanvasTextResourcePreloadClient({ invoke })
    const controller = new AbortController()
    controller.abort(new DOMException("Aborted", "AbortError"))

    await expect(client.save({ ...textSaveRequest, content: "changed" }, controller.signal)).rejects.toHaveProperty(
      "name",
      "AbortError",
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  test("reconstructs a typed conflict and bounds ordinary native failures", async () => {
    const conflict = createCanvasTextResourcePreloadClient({
      invoke: async () => ({ actualRevision: "c".repeat(64), kind: "canvas-text-resource-conflict" }),
    })
    let conflictError: unknown
    try {
      await conflict.save({ ...textSaveRequest, content: "changed" }, new AbortController().signal)
    } catch (error) {
      conflictError = error
    }
    expect(conflictError).toBeInstanceOf(CanvasTextResourceConflictError)
    expect((conflictError as CanvasTextResourceConflictError).actualContentRevision).toBe("c".repeat(64))

    const failed = createCanvasTextResourcePreloadClient({
      invoke: async () => {
        throw new Error("ENOENT /native/private/project/Notes/brief.md")
      },
    })
    await expect(failed.save({ ...textSaveRequest, content: "changed" }, new AbortController().signal)).rejects.toThrow(
      "Could not save the Canvas text resource",
    )
  })
})
