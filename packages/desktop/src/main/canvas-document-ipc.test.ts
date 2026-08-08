import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { CanvasApplicationCommandResult, CanvasApplicationQueryResult } from "@convax/canvas/application"
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
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { ProjectTextFileConflictError } from "@convax/project-files"

import { canvasTextResourceConflictKind } from "../canvas-resource-private-contract"
import { canvasResourceIpcChannel, canvasTextResourceIpcChannel } from "../desktop-protocol"
import { canvasDocumentIpcChannels } from "../canvas-document-contracts"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"

type TestEvent = { sender: { id: number } }
type InvokeHandler = (event: TestEvent, input: unknown) => unknown
const handlers = new Map<string, InvokeHandler>()
const event = { sender: { id: 7 } }
const document = createCanvasDocument({ id: "canvas-main" })
const sessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(3)))
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
  test("resolves the canonical Canvas resource, publishes its new Project version, and relinks the same node", async () => {
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
        isTrustedSender: () => true,
        preparation: { prepare },
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: fixture.projectId }),
        resources: { relinkPreparedResource },
      },
    )
    await expect(
      handlers.get(canvasTextResourceIpcChannel)!(event, {
        content: nextContent,
        contentRevision: fixture.reference.blob.digest,
        nodeId: "text-node",
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
        isTrustedSender: () => true,
        preparation: { prepare },
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: fixture.projectId }),
        resources: { relinkPreparedResource },
      },
    )
    await expect(
      handlers.get(canvasTextResourceIpcChannel)!(event, {
        content: "new",
        contentRevision: fixture.reference.blob.digest,
        nodeId: "text-node",
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
        isTrustedSender: () => true,
        preparation: { prepare: async () => prepared },
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: fixture.projectId }),
        resources: { relinkPreparedResource },
      },
    )

    await expect(
      handlers.get(canvasTextResourceIpcChannel)!(event, {
        content: nextContent,
        contentRevision: fixture.reference.blob.digest,
        nodeId: "text-node",
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
