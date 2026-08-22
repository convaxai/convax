import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type {
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
  CanvasResourcePreparationResult,
} from "@convax/canvas/application"
import { canvasProjectionResourceMetadataKey, type BoundedOperationReceipt } from "@convax/canvas/collaboration"
import { createCanvasDocument, createTextNode } from "@convax/canvas/core"
import {
  encodeBase64url,
  ordinarySha256,
  parseActorId,
  parseDigest,
  parseId128,
  parseProjectId,
} from "@convax/collaboration"
import { parseProjectIndexResourceReference, projectIndexResourceReferenceDigest } from "@convax/project"
import { hydrateStaleProjectCanvasResources, projectResourceReferenceKey } from "@convax/project/canvas"
import { ProjectTextFileConflictError } from "@convax/project-files"

import { canvasTextResourceConflictKind } from "../canvas-resource-private-contract"
import {
  canvasResourceHydrateStaleIpcChannel,
  canvasResourceIpcChannel,
  canvasTextResourceIpcChannel,
} from "../desktop-protocol"
import { canvasDocumentIpcChannels } from "../canvas-document-contracts"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"

type TestEvent = { sender: { id: number } }
type InvokeHandler = (event: TestEvent, input: unknown) => unknown
const handlers = new Map<string, InvokeHandler>()
const event = { sender: { id: 7 } }
const document = createCanvasDocument({ id: "canvas-main" })
const sessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(3)))
const otherSessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(4)))
const acceptedFrameDigest = parseDigest("a".repeat(64))
const receipt: BoundedOperationReceipt = {
  format: "convax.canvas-operation-receipt",
  actorId: parseActorId("A".repeat(43)),
  operationId: parseId128("A".repeat(22)),
  intentDigest: parseDigest("d".repeat(64)),
  baseFrontierDigest: parseDigest("e".repeat(64)),
  intentKind: "canvas.elements.remove",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigest("f".repeat(64)),
}

const resourceSessions = {
  deliverApplicationCommit: mock(async () =>
    Object.freeze({
      status: "accepted" as const,
      acceptedFrameDigest,
      projection: Object.freeze({
        format: "convax.canvas-session-projection" as const,
        ref: { canvasId: "canvas-main", scopeId: "project-one" },
        sessionId,
        document,
        edgeEntities: [],
        nodeEntities: [],
        canUndo: true,
        canRedo: false,
      }),
    }),
  ),
  queryRenderer: mock(async () =>
    Object.freeze({
      format: "convax.canvas-session-projection" as const,
      ref: { canvasId: "canvas-main", scopeId: "project-one" },
      sessionId,
      document,
      edgeEntities: [],
      nodeEntities: [],
      canUndo: true,
      canRedo: false,
    }),
  ),
}

function hydrationRequest(scopeId: string, nodeIds?: readonly string[]) {
  return {
    ref: { canvasId: "canvas-main", scopeId },
    sessionId,
    ...(nodeIds === undefined ? {} : { nodeIds }),
  }
}

function acceptingHydrationSessions() {
  return { requireRendererLease: mock(() => undefined) }
}

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

describe("Canvas document IPC", () => {
  test("loads the collaboration projection and hydrates only its Main-side resource view", async () => {
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({ nodes: [], projection: document }))
    const hydrate = mock(async ({ document: input }: { document: typeof document }) => ({
      ...input,
      metadata: { ...input.metadata, title: "Hydrated" },
    }))
    registerCanvasDocumentIpc({ execute: mock(), query }, { hydrate }, { isTrustedSender: () => true })

    const result = await handlers.get(canvasDocumentIpcChannels.load)!(event, {
      canvasId: "canvas-main",
      scopeId: "project-one",
    })
    expect(query).toHaveBeenCalledWith({ canvasId: "canvas-main", scopeId: "project-one" })
    expect(hydrate).toHaveBeenCalledWith({ document, projectId: "project-one" })
    expect(result).toMatchObject({ projection: { metadata: { title: "Hydrated" } } })
  })

  test("maps a renderer command to the shared typed application and returns its receipt", async () => {
    const execute = mock(async (): Promise<CanvasApplicationCommandResult> => commandResult())
    registerCanvasDocumentIpc(
      { execute, query: mock() },
      { hydrate: async ({ document: input }) => input },
      { isTrustedSender: () => true },
    )
    const input = {
      command: { type: "elements.remove", nodeIds: ["node-a"] },
      commandId: "remove-node",
      ref: { canvasId: "canvas-main", scopeId: "project-one" },
    }

    await expect(handlers.get(canvasDocumentIpcChannels.execute)!(event, input)).resolves.toMatchObject({
      operationReceipt: receipt,
    })
    expect(execute).toHaveBeenCalledWith({
      canvasId: "canvas-main",
      scopeId: "project-one",
      envelope: {
        actor: { id: "desktop:renderer:7", kind: "renderer" },
        command: input.command,
        commandId: "remove-node",
      },
    })
  })

  test("rejects the removed document-wide revision/version request fields before application code", async () => {
    const execute = mock(async () => commandResult())
    registerCanvasDocumentIpc(
      { execute, query: mock() },
      { hydrate: async ({ document: input }) => input },
      { isTrustedSender: () => true },
    )
    const base = {
      command: { type: "elements.remove", nodeIds: [] },
      commandId: "legacy",
      ref: { canvasId: "canvas-main", scopeId: "project-one" },
    }
    await expect(
      Promise.resolve().then(() =>
        handlers.get(canvasDocumentIpcChannels.execute)!(event, {
          ...base,
          expectedRevision: 9,
        }),
      ),
    ).rejects.toThrow("unsupported fields")
    await expect(
      Promise.resolve().then(() =>
        handlers.get(canvasDocumentIpcChannels.execute)!(event, {
          ...base,
          ref: { ...base.ref, version: 9 },
        }),
      ),
    ).rejects.toThrow("reference is invalid")
    expect(execute).not.toHaveBeenCalled()
  })

  test("rejects untrusted renderer commands before parsing or mutation", async () => {
    const execute = mock(async () => commandResult())
    registerCanvasDocumentIpc(
      { execute, query: mock() },
      { hydrate: async ({ document: input }) => input },
      { isTrustedSender: () => false },
    )
    await expect(
      Promise.resolve().then(() => handlers.get(canvasDocumentIpcChannels.execute)!(event, null)),
    ).rejects.toThrow("untrusted renderer")
    expect(execute).not.toHaveBeenCalled()
  })

  test("hydrates through the exact mounted lease without waiting for a renderer reverse request", async () => {
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({ nodes: [], projection: document }))
    const hydrateStale = mock(async ({ document: input }: { document: typeof document }) => input)
    const requireRendererLease = mock(() => undefined)
    const resolveActiveCanvas = mock(() => new Promise<never>(() => undefined))
    const options = {
      isTrustedSender: () => true,
      resolveActiveCanvas,
      sessions: { requireRendererLease },
    }
    registerCanvasDocumentIpc(
      { execute: mock(), query },
      { hydrate: async ({ document: input }) => input, hydrateStale },
      options,
    )

    let timeout: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      Promise.resolve(
        handlers.get(canvasResourceHydrateStaleIpcChannel)!(event, hydrationRequest("project-one", ["target"])),
      ).then((value) => ({ status: "resolved" as const, value })),
      new Promise<{ status: "timed-out" }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: "timed-out" }), 1_000)
      }),
    ])
    if (timeout) clearTimeout(timeout)

    expect(result.status).toBe("resolved")
    expect(resolveActiveCanvas).not.toHaveBeenCalled()
    expect(requireRendererLease).toHaveBeenCalledTimes(3)
    expect(requireRendererLease).toHaveBeenCalledWith({
      ref: { canvasId: "canvas-main", scopeId: "project-one" },
      rendererActorId: "desktop:renderer:7",
      sessionId,
    })
  })

  test("rejects the wrong renderer, reference, or session before querying the Canvas", async () => {
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({ nodes: [], projection: document }))
    const expected = hydrationRequest("project-one")
    const requireRendererLease = mock(
      (input: { ref: { canvasId: string; scopeId: string }; rendererActorId: string; sessionId: string }) => {
        if (
          input.rendererActorId !== "desktop:renderer:7" ||
          input.ref.canvasId !== expected.ref.canvasId ||
          input.ref.scopeId !== expected.ref.scopeId ||
          input.sessionId !== expected.sessionId
        ) {
          throw new Error("Canvas renderer session is stale or belongs to another renderer")
        }
      },
    )
    registerCanvasDocumentIpc(
      { execute: mock(), query },
      {
        hydrate: async ({ document: input }) => input,
        hydrateStale: async ({ document: input }) => input,
      },
      { isTrustedSender: () => true, sessions: { requireRendererLease } },
    )
    const handler = handlers.get(canvasResourceHydrateStaleIpcChannel)!

    await expect(handler({ sender: { id: 8 } }, expected)).rejects.toThrow("belongs to another renderer")
    await expect(handler(event, { ...expected, ref: { ...expected.ref, canvasId: "canvas-other" } })).rejects.toThrow(
      "belongs to another renderer",
    )
    await expect(handler(event, { ...expected, sessionId: otherSessionId })).rejects.toThrow(
      "belongs to another renderer",
    )
    await expect(handler(event, { canvasId: "canvas-main", nodeIds: ["legacy"] })).rejects.toThrow("unsupported field")

    expect(query).not.toHaveBeenCalled()
  })

  test("does not return hydrated state after the mounted lease closes", async () => {
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({ nodes: [], projection: document }))
    const hydrateStale = mock(async ({ document: input }: { document: typeof document }) => input)
    let leaseChecks = 0
    const requireRendererLease = mock(() => {
      leaseChecks += 1
      if (leaseChecks === 3) throw new Error("Canvas renderer session is stale")
    })
    registerCanvasDocumentIpc(
      { execute: mock(), query },
      { hydrate: async ({ document: input }) => input, hydrateStale },
      { isTrustedSender: () => true, sessions: { requireRendererLease } },
    )

    await expect(
      handlers.get(canvasResourceHydrateStaleIpcChannel)!(event, hydrationRequest("project-one", ["target"])),
    ).rejects.toThrow("session is stale")
    expect(query).toHaveBeenCalledTimes(1)
    expect(hydrateStale).toHaveBeenCalledTimes(1)
    expect(requireRendererLease).toHaveBeenCalledTimes(3)
  })

  test("forwards only the requested stale resource while preserving another stale resource", async () => {
    const resources = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "target",
          metadata: {
            [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/target.md" },
          },
          position: { x: 0, y: 0 },
          resourceState: { status: "stale", text: "target-before" },
        }),
        createTextNode({
          id: "untouched",
          metadata: {
            [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/untouched.md" },
          },
          position: { x: 20, y: 0 },
          resourceState: { status: "stale", text: "untouched-before" },
        }),
      ],
    })
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({ nodes: [], projection: resources }))
    const resolve = mock(async (reference: { kind: string; path?: string }) => ({
      status: "ready" as const,
      text: `hydrated:${reference.path}`,
    }))
    registerCanvasDocumentIpc(
      { execute: mock(), query },
      {
        hydrate: async ({ document: input }) => input,
        hydrateStale: ({ document: input, nodeIds }) => {
          const targets = new Set(nodeIds ?? [])
          return hydrateStaleProjectCanvasResources(input, resolve, (node) => targets.has(node.id))
        },
      },
      {
        isTrustedSender: () => true,
        sessions: acceptingHydrationSessions(),
      },
    )

    const result = (await handlers.get(canvasResourceHydrateStaleIpcChannel)!(
      event,
      hydrationRequest("project-one", ["target"]),
    )) as typeof resources

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith({ kind: "project-file", path: "Notes/target.md" })
    expect(result.nodes[0]!.data.resourceState).toEqual({
      status: "ready",
      text: "hydrated:Notes/target.md",
    })
    expect(result.nodes[1]).toBe(resources.nodes[1])
    expect(result.nodes[1]!.data.resourceState).toEqual({ status: "stale", text: "untouched-before" })
  })

  test("forwards a stale canonical new-text target to the Project hydrator", async () => {
    const fixture = canonicalTextResource("# First projection")
    const canonical = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "new-text",
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
          name: "new-note.md",
          position: { x: 0, y: 0 },
          resourceState: { mediaType: "text/markdown", name: "new-note.md", status: "stale" },
        }),
      ],
    })
    const hydrateStale = mock(
      async ({ document: input, nodeIds }: { document: typeof canonical; nodeIds?: readonly string[] }) => {
        expect(nodeIds).toEqual(["new-text"])
        expect(input).toBe(canonical)
        return {
          ...input,
          nodes: input.nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              resourceState: {
                editableText: true,
                status: "ready" as const,
                text: "# First projection",
              },
            },
          })),
        }
      },
    )
    registerCanvasDocumentIpc(
      { execute: mock(), query: async () => ({ nodes: [], projection: canonical }) },
      { hydrate: async ({ document: input }) => input, hydrateStale },
      {
        isTrustedSender: () => true,
        sessions: acceptingHydrationSessions(),
      },
    )

    const hydrated = (await handlers.get(canvasResourceHydrateStaleIpcChannel)!(
      event,
      hydrationRequest(fixture.projectId, ["new-text"]),
    )) as typeof canonical

    expect(hydrated.nodes[0]!.data.resourceState).toEqual({
      editableText: true,
      status: "ready",
      text: "# First projection",
    })
    expect(hydrateStale).toHaveBeenCalledTimes(1)
  })

  test("lets the Project hydrator treat ready and deleted target races as idempotent", async () => {
    const fixture = canonicalTextResource("ready")
    const ready = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "ready",
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
          position: { x: 0, y: 0 },
          resourceState: { editableText: true, status: "ready", text: "ready" },
        }),
      ],
    })
    const hydrateStale = mock(
      async ({ document: input, nodeIds }: { document: typeof ready; nodeIds?: readonly string[] }) => {
        expect(nodeIds).toEqual(["ready", "deleted-before-query"])
        return input
      },
    )
    registerCanvasDocumentIpc(
      { execute: mock(), query: async () => ({ nodes: [], projection: ready }) },
      { hydrate: async ({ document: input }) => input, hydrateStale },
      {
        isTrustedSender: () => true,
        sessions: acceptingHydrationSessions(),
      },
    )

    await expect(
      handlers.get(canvasResourceHydrateStaleIpcChannel)!(
        event,
        hydrationRequest(fixture.projectId, ["ready", "deleted-before-query"]),
      ),
    ).resolves.toBe(ready)
  })

  test("propagates the Project owner's rejection of a live invalid hydration target", async () => {
    const invalid = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "invalid",
          metadata: {},
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        }),
      ],
    })
    const hydrateStale = mock(async () => {
      throw new Error("Canvas resource refresh target invalid is not a Project-hydratable resource")
    })
    registerCanvasDocumentIpc(
      { execute: mock(), query: async () => ({ nodes: [], projection: invalid }) },
      { hydrate: async ({ document: input }) => input, hydrateStale },
      {
        isTrustedSender: () => true,
        sessions: acceptingHydrationSessions(),
      },
    )

    await expect(
      handlers.get(canvasResourceHydrateStaleIpcChannel)!(event, hydrationRequest("project-one", ["invalid"])),
    ).rejects.toThrow("not a Project-hydratable resource")
    expect(hydrateStale).toHaveBeenCalledTimes(1)
  })

  test("keeps the target-free resource hydration request as the full refresh compatibility path", async () => {
    const resources = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "first",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/first.md" } },
          position: { x: 0, y: 0 },
          resourceState: { status: "ready" },
        }),
        createTextNode({
          id: "second",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/second.md" } },
          position: { x: 20, y: 0 },
          resourceState: { status: "ready" },
        }),
      ],
    })
    const resolve = mock(async () => ({ status: "ready" as const, text: "hydrated" }))
    registerCanvasDocumentIpc(
      { execute: mock(), query: async () => ({ nodes: [], projection: resources }) },
      {
        hydrate: async ({ document: input }) => input,
        hydrateStale: ({ document: input }) => hydrateStaleProjectCanvasResources(input, resolve),
      },
      {
        isTrustedSender: () => true,
        sessions: acceptingHydrationSessions(),
      },
    )

    await handlers.get(canvasResourceHydrateStaleIpcChannel)!(event, hydrationRequest("project-one"))

    expect(resolve).toHaveBeenCalledTimes(2)
  })

  test("rejects duplicate and over-bound hydration targets before native hydration", async () => {
    const query = mock(async (): Promise<CanvasApplicationQueryResult> => ({ nodes: [], projection: document }))
    const hydrateStale = mock(async ({ document: input }: { document: typeof document }) => input)
    registerCanvasDocumentIpc(
      { execute: mock(), query },
      { hydrate: async ({ document: input }) => input, hydrateStale },
      {
        isTrustedSender: () => true,
        sessions: acceptingHydrationSessions(),
      },
    )
    const invoke = (input: unknown) =>
      Promise.resolve().then(() => handlers.get(canvasResourceHydrateStaleIpcChannel)!(event, input))

    await expect(invoke(hydrationRequest("project-one", ["same", "same"]))).rejects.toThrow("must be unique")
    await expect(
      invoke(
        hydrationRequest(
          "project-one",
          Array.from({ length: 4_097 }, (_, index) => `node-${index}`),
        ),
      ),
    ).rejects.toThrow("target node ids are invalid")
    await expect(invoke(hydrationRequest("project-one", ["x".repeat(257)]))).rejects.toThrow(
      "target node id is invalid",
    )

    expect(query).not.toHaveBeenCalled()
    expect(hydrateStale).not.toHaveBeenCalled()
  })
})

describe("Canvas resource IPC", () => {
  test("binds resource creation to the invoking Workbench scope and returns receipt plus projection", async () => {
    const addResources = mock(async () => commandResult())
    const diagnostics: Array<{ byteLength: number; callCount: number; stage: string }> = []
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources },
      { withAdmittedLocalFiles: mock() },
      {
        application: { query: mock() },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one" }),
        sessions: resourceSessions,
        diagnostics: {
          record({ byteLength, callCount, stage }) {
            diagnostics.push({ byteLength, callCount, stage })
          },
        },
      },
    )
    const input = {
      anchor: { x: 10, y: 20 },
      anchorOrigin: "center" as const,
      canvasId: "canvas-main",
      commandId: "renderer-add",
      externalFiles: [],
      projectId: "project-one",
      sessionId,
      sources: [{ kind: "new-text", sourceId: "note", text: "hello" }],
    }

    await expect(handlers.get(canvasResourceIpcChannel)!(event, input)).resolves.toEqual({
      createdNodeIds: ["created"],
      delivery: await resourceSessions.deliverApplicationCommit(),
      operationReceipt: receipt,
      warnings: ["normalized"],
    })
    expect(addResources).toHaveBeenCalledWith({
      actor: { id: "desktop:renderer", kind: "ui" },
      anchor: { x: 10, y: 20 },
      anchorOrigin: "center",
      canvasId: "canvas-main",
      commandId: "renderer-add",
      relation: undefined,
      scopeId: "project-one",
      sources: input.sources,
    })
    expect(diagnostics).toEqual([
      { byteLength: 5, callCount: 1, stage: "canvas-submit" },
      { byteLength: 0, callCount: 1, stage: "response-projection-invalidation" },
    ])
  })

  test("prepares mixed inputs concurrently while preserving local-before-source item order", async () => {
    const events: string[] = []
    const localPrepared = {
      items: [
        {
          id: "local-image",
          kind: "image" as const,
          metadata: {},
          name: "local.png",
          state: { status: "ready" as const },
        },
      ],
      retainedOnFailure: [{ label: "Notes/local.md" }],
      warnings: ["local-warning"],
    }
    const sourcePrepared = {
      items: [
        {
          id: "source-text",
          kind: "text" as const,
          metadata: {},
          name: "source.md",
          state: { status: "ready" as const },
        },
      ],
      retainedOnFailure: [{ label: "Notes/source.md" }],
      warnings: ["source-warning"],
    }
    const prepare = mock(async () => {
      events.push("source:start")
      await Promise.resolve()
      events.push("source:complete")
      return sourcePrepared
    })
    const withAdmittedLocalFiles = async <T>(
      _input: { files: readonly unknown[]; projectId: string },
      commit: (prepared: CanvasResourcePreparationResult) => Promise<T>,
    ): Promise<T> => {
      events.push("local:start")
      return commit(localPrepared)
    }
    const addPreparedResources = mock(async (_request: unknown, prepared: CanvasResourcePreparationResult) => {
      events.push(`submit:${prepared.items.map(({ id }) => id).join(",")}`)
      return { ...commandResult(), createdNodeIds: prepared.items.map(({ id }) => id) }
    })
    registerCanvasResourceIpc(
      { addPreparedResources, addResources: mock() },
      { prepare, withAdmittedLocalFiles },
      {
        application: { query: mock() },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one" }),
        sessions: resourceSessions,
      },
    )

    await expect(
      handlers.get(canvasResourceIpcChannel)!(event, {
        anchor: { x: 10, y: 20 },
        canvasId: "canvas-main",
        commandId: "renderer-mixed-add",
        externalFiles: [
          {
            mediaType: "image/png",
            name: "local.png",
            sourceId: "local-image",
            sourcePath: "/tmp/local.png",
          },
        ],
        projectId: "project-one",
        sessionId,
        sources: [{ kind: "new-text", sourceId: "source-text", text: "hello" }],
      }),
    ).resolves.toMatchObject({ createdNodeIds: ["local-image", "source-text"] })
    expect(events).toEqual(["source:start", "local:start", "source:complete", "submit:local-image,source-text"])
    expect(addPreparedResources).toHaveBeenCalledWith(expect.objectContaining({ sources: [] }), {
      items: [...localPrepared.items, ...sourcePrepared.items],
      retainedOnFailure: [...localPrepared.retainedOnFailure, ...sourcePrepared.retainedOnFailure],
      warnings: [...localPrepared.warnings, ...sourcePrepared.warnings],
    })
  })

  test("rejects an unknown resource anchor origin before invoking the typed Canvas application", async () => {
    const addResources = mock(async () => commandResult())
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources },
      { withAdmittedLocalFiles: mock() },
      {
        application: { query: mock() },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one" }),
        sessions: resourceSessions,
      },
    )

    await expect(
      handlers.get(canvasResourceIpcChannel)!(event, {
        anchor: { x: 0, y: 0 },
        anchorOrigin: "bottom-right",
        canvasId: "canvas-main",
        commandId: "invalid-anchor-origin",
        externalFiles: [],
        projectId: "project-one",
        sessionId,
        sources: [{ kind: "new-text", sourceId: "note", text: "hello" }],
      }),
    ).rejects.toThrow("anchor origin is invalid")
    expect(addResources).not.toHaveBeenCalled()
  })

  test("retains strict relation validation before invoking the typed Canvas application", async () => {
    const addResources = mock(async () => commandResult())
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources },
      { withAdmittedLocalFiles: mock() },
      {
        application: { query: mock() },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one" }),
        sessions: resourceSessions,
      },
    )

    await expect(
      handlers.get(canvasResourceIpcChannel)!(event, {
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "invalid-relation",
        externalFiles: [],
        projectId: "project-one",
        sessionId,
        relation: { anchorNodeIds: ["same", "same"], mode: "connect" },
        sources: [],
      }),
    ).rejects.toThrow("must be unique")
    expect(addResources).not.toHaveBeenCalled()
  })

  test("rejects a stale Project/Canvas scope before resource preparation", async () => {
    const addResources = mock(async () => commandResult())
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources },
      { withAdmittedLocalFiles: mock() },
      {
        application: { query: mock() },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "other", projectId: "project-one" }),
        sessions: resourceSessions,
      },
    )
    await expect(
      handlers.get(canvasResourceIpcChannel)!(event, {
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "stale",
        externalFiles: [],
        projectId: "project-one",
        sessionId,
        sources: [],
      }),
    ).rejects.toThrow("live Workbench scope")
    expect(addResources).not.toHaveBeenCalled()
  })
})

describe("Canvas text resource IPC", () => {
  test("keeps the original session-bound Canvas target while publishing a background save", async () => {
    const fixture = canonicalTextResource("before")
    const textDocument = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "text-node",
          position: { x: 0, y: 0 },
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
          name: "a.md",
          resourceState: { status: "ready" },
        }),
      ],
    })
    const nextContent = "after"
    const nextRevision = ordinarySha256(new TextEncoder().encode(nextContent))
    const compareAndReplaceTextFile = mock(async () => ({ contentRevision: nextRevision }))
    const prepared = {
      items: [
        {
          id: "text-save",
          kind: "text" as const,
          metadata: { [projectResourceReferenceKey]: { kind: "project-file" as const, path: "Notes/a.md" } },
          mimeType: "text/markdown",
          name: "a.md",
          state: { contentRevision: nextRevision, status: "ready" as const, text: nextContent },
        },
      ],
    }
    const prepare = mock(async () => prepared)
    const relinkPreparedResource = mock(async () => commandResult())
    registerCanvasTextResourceIpc(
      { compareAndReplaceTextFile },
      { query: async () => ({ nodes: [], projection: textDocument }) },
      {
        currentResources: {
          queryCurrentResources: async () => [
            {
              materializedPath: "Notes/a.md",
              reference: fixture.reference,
              storageClass: "project-file" as const,
            },
          ],
        },
        getActiveProjectId: () => fixture.projectId,
        isTrustedSender: () => true,
        preparation: { prepare },
        resources: { relinkPreparedResource },
        sessions: resourceSessions,
      },
    )
    await expect(
      handlers.get(canvasTextResourceIpcChannel)!(event, {
        canvasId: "canvas-main",
        content: nextContent,
        contentRevision: fixture.reference.blob.digest,
        nodeId: "text-node",
        projectId: fixture.projectId,
        sessionId,
      }),
    ).resolves.toEqual({ contentRevision: nextRevision })
    expect(compareAndReplaceTextFile).toHaveBeenCalledWith({
      content: nextContent,
      expectedRevision: fixture.reference.blob.digest,
      path: "Notes/a.md",
      projectId: fixture.projectId,
    })
    expect(prepare).toHaveBeenCalledWith({
      canvasId: "canvas-main",
      scopeId: fixture.projectId,
      sources: [{ kind: "host-file", path: "Notes/a.md", sourceId: "text-save" }],
    })
    expect(relinkPreparedResource).toHaveBeenCalledWith(
      {
        actor: { id: "desktop:renderer:7", kind: "renderer" },
        canvasId: "canvas-main",
        commandId: expect.stringMatching(/^canvas-text-save:[a-f0-9]{64}$/),
        metadataKeysToRemove: ["convaxProjectResourceBindings"],
        nodeId: "text-node",
        scopeId: fixture.projectId,
      },
      prepared,
    )
    expect(resourceSessions.queryRenderer).toHaveBeenCalledWith(
      { canvasId: "canvas-main", scopeId: fixture.projectId },
      sessionId,
    )
  })

  test("rejects a background text save that cannot prove its originating mounted Canvas lease", async () => {
    const fixture = canonicalTextResource("before")
    const query = mock()
    const compareAndReplaceTextFile = mock()
    const queryRenderer = mock(async () => {
      throw new Error("stale renderer lease")
    })
    registerCanvasTextResourceIpc(
      { compareAndReplaceTextFile },
      { query },
      {
        currentResources: { queryCurrentResources: mock() },
        getActiveProjectId: () => fixture.projectId,
        isTrustedSender: () => true,
        preparation: { prepare: mock() },
        resources: { relinkPreparedResource: mock() },
        sessions: { queryRenderer },
      },
    )

    await expect(
      handlers.get(canvasTextResourceIpcChannel)!(event, {
        canvasId: "canvas-main",
        content: "after",
        contentRevision: fixture.reference.blob.digest,
        nodeId: "text-node",
        projectId: fixture.projectId,
        sessionId,
      }),
    ).rejects.toThrow("Could not save the Canvas text resource")
    expect(queryRenderer).toHaveBeenCalledWith({ canvasId: "canvas-main", scopeId: fixture.projectId }, sessionId)
    expect(query).not.toHaveBeenCalled()
    expect(compareAndReplaceTextFile).not.toHaveBeenCalled()
  })

  test("returns only the typed text conflict without leaking native errors", async () => {
    const fixture = canonicalTextResource("before")
    const textDocument = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "text-node",
          position: { x: 0, y: 0 },
          name: "a.md",
          resourceState: { status: "ready" },
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
        }),
      ],
    })
    const prepare = mock()
    const relinkPreparedResource = mock()
    registerCanvasTextResourceIpc(
      {
        compareAndReplaceTextFile: async () => {
          throw new ProjectTextFileConflictError(fixture.reference.blob.digest, "c".repeat(64))
        },
      },
      { query: async () => ({ nodes: [], projection: textDocument }) },
      {
        currentResources: {
          queryCurrentResources: async () => [
            {
              materializedPath: "Notes/a.md",
              reference: fixture.reference,
              storageClass: "project-file" as const,
            },
          ],
        },
        getActiveProjectId: () => fixture.projectId,
        isTrustedSender: () => true,
        preparation: { prepare },
        resources: { relinkPreparedResource },
        sessions: resourceSessions,
      },
    )
    await expect(
      handlers.get(canvasTextResourceIpcChannel)!(event, {
        canvasId: "canvas-main",
        content: "new",
        contentRevision: fixture.reference.blob.digest,
        nodeId: "text-node",
        projectId: fixture.projectId,
        sessionId,
      }),
    ).resolves.toEqual({ actualRevision: "c".repeat(64), kind: canvasTextResourceConflictKind })
    expect(prepare).not.toHaveBeenCalled()
    expect(relinkPreparedResource).not.toHaveBeenCalled()
  })

  test("finishes ProjectIndex and Canvas publication when retry observes the exact already-written bytes", async () => {
    const fixture = canonicalTextResource("before")
    const nextContent = "after"
    const nextRevision = ordinarySha256(new TextEncoder().encode(nextContent))
    const textDocument = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "text-node",
          metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
          name: "a.md",
          position: { x: 0, y: 0 },
          resourceState: { status: "ready" },
        }),
      ],
    })
    const prepared = {
      items: [
        {
          id: "text-save",
          kind: "text" as const,
          metadata: { [projectResourceReferenceKey]: { kind: "project-file" as const, path: "Notes/a.md" } },
          mimeType: "text/markdown",
          name: "a.md",
          state: { contentRevision: nextRevision, status: "ready" as const, text: nextContent },
        },
      ],
    }
    const relinkPreparedResource = mock(async () => commandResult())
    registerCanvasTextResourceIpc(
      {
        compareAndReplaceTextFile: async () => {
          throw new ProjectTextFileConflictError(fixture.reference.blob.digest, nextRevision)
        },
      },
      { query: async () => ({ nodes: [], projection: textDocument }) },
      {
        currentResources: {
          queryCurrentResources: async () => [
            {
              materializedPath: "Notes/a.md",
              reference: fixture.reference,
              storageClass: "project-file" as const,
            },
          ],
        },
        getActiveProjectId: () => fixture.projectId,
        isTrustedSender: () => true,
        preparation: { prepare: async () => prepared },
        resources: { relinkPreparedResource },
        sessions: resourceSessions,
      },
    )

    await expect(
      handlers.get(canvasTextResourceIpcChannel)!(event, {
        canvasId: "canvas-main",
        content: nextContent,
        contentRevision: fixture.reference.blob.digest,
        nodeId: "text-node",
        projectId: fixture.projectId,
        sessionId,
      }),
    ).resolves.toEqual({ contentRevision: nextRevision })
    expect(relinkPreparedResource).toHaveBeenCalledTimes(1)
  })
})

function commandResult(): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: ["created"],
    changed: true,
    createdNodeIds: ["created"],
    document,
    operationReceipt: receipt,
    acceptedFrameDigest,
    warnings: ["normalized"],
  }
}

function canonicalTextResource(content: string) {
  const projectId = parseProjectId("project_0123456789abcdef0123456789abcdef")
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
  const digest = ordinarySha256(new TextEncoder().encode(content))
  const fileId = `pf_${"a".repeat(64)}`
  const reference = parseProjectIndexResourceReference({
    format: "convax.project-resource-reference",
    projectId,
    projectEpoch,
    entryFileId: fileId,
    familyPrimaryFileId: fileId,
    versionId: `pv_${"b".repeat(64)}`,
    canonicalUri: `convax-project://${projectId}/epochs/${projectEpoch}/entries/${fileId}?blob=sha256%3A${digest}`,
    blob: {
      format: "convax.blob-ref",
      algorithm: "sha256",
      digest,
      byteLength: String(new TextEncoder().encode(content).byteLength) as never,
      mime: "text/markdown",
    },
    versionRecordDigest: ordinarySha256(new TextEncoder().encode(`version:${digest}`)),
  })
  return {
    projectId,
    reference,
    resource: {
      format: "convax.canvas-resource-ref" as const,
      uri: reference.canonicalUri,
      mediaClass: "text" as const,
      mime: reference.blob.mime,
      byteLength: reference.blob.byteLength,
      contentDigest: reference.blob.digest,
      ownerProofDigest: projectIndexResourceReferenceDigest(reference),
    },
  }
}
