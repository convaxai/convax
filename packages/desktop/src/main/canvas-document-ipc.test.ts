import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type {
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
} from "@convax/canvas/application"
import type { BoundedOperationReceiptV2 } from "@convax/canvas/collaboration"
import { createCanvasDocument, createTextNode } from "@convax/canvas/core"
import { parseActorIdV2, parseDigestV2, parseId128V2 } from "@convax/collaboration"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { ProjectTextFileConflictError } from "@convax/project-files"

import { canvasTextResourceConflictKind } from "../canvas-resource-private-contract"
import {
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
const receipt: BoundedOperationReceiptV2 = {
  format: "convax.canvas-operation-receipt/2",
  actorId: parseActorIdV2("A".repeat(43)),
  operationId: parseId128V2("A".repeat(22)),
  intentDigest: parseDigestV2("d".repeat(64)),
  baseFrontierDigest: parseDigestV2("e".repeat(64)),
  intentKind: "canvas.elements.remove/2",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigestV2("f".repeat(64)),
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
      ...input, metadata: { ...input.metadata, title: "Hydrated" },
    }))
    registerCanvasDocumentIpc(
      { execute: mock(), query },
      { hydrate },
      { isTrustedSender: () => true },
    )

    const result = await handlers.get(canvasDocumentIpcChannels.load)!(event, {
      canvasId: "canvas-main", scopeId: "project-one",
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
    await expect(Promise.resolve().then(() => handlers.get(canvasDocumentIpcChannels.execute)!(event, {
      ...base, expectedRevision: 9,
    }))).rejects.toThrow("unsupported fields")
    await expect(Promise.resolve().then(() => handlers.get(canvasDocumentIpcChannels.execute)!(event, {
      ...base, ref: { ...base.ref, version: 9 },
    }))).rejects.toThrow("reference is invalid")
    expect(execute).not.toHaveBeenCalled()
  })

  test("rejects untrusted renderer commands before parsing or mutation", async () => {
    const execute = mock(async () => commandResult())
    registerCanvasDocumentIpc(
      { execute, query: mock() },
      { hydrate: async ({ document: input }) => input },
      { isTrustedSender: () => false },
    )
    await expect(Promise.resolve().then(() =>
      handlers.get(canvasDocumentIpcChannels.execute)!(event, null),
    )).rejects.toThrow("untrusted renderer")
    expect(execute).not.toHaveBeenCalled()
  })
})

describe("Canvas resource IPC", () => {
  test("binds resource creation to the invoking Workbench scope and returns receipt plus projection", async () => {
    const addResources = mock(async () => commandResult())
    registerCanvasResourceIpc(
      { addPreparedResources: mock(), addResources },
      { withAdmittedLocalFiles: mock() },
      {
        application: { query: mock() },
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one" }),
      },
    )
    const input = {
      anchor: { x: 10, y: 20 },
      canvasId: "canvas-main",
      commandId: "renderer-add",
      externalFiles: [],
      projectId: "project-one",
      sources: [{ kind: "new-text", sourceId: "note", text: "hello" }],
    }

    await expect(handlers.get(canvasResourceIpcChannel)!(event, input)).resolves.toEqual({
      createdNodeIds: ["created"],
      operationReceipt: receipt,
      projection: document,
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
      },
    )

    await expect(handlers.get(canvasResourceIpcChannel)!(event, {
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "invalid-relation",
      externalFiles: [],
      projectId: "project-one",
      relation: { anchorNodeIds: ["same", "same"], mode: "connect" },
      sources: [],
    })).rejects.toThrow("must be unique")
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
      },
    )
    await expect(handlers.get(canvasResourceIpcChannel)!(event, {
      anchor: { x: 0, y: 0 }, canvasId: "canvas-main", commandId: "stale",
      externalFiles: [], projectId: "project-one", sources: [],
    })).rejects.toThrow("live Workbench scope")
    expect(addResources).not.toHaveBeenCalled()
  })
})

describe("Canvas text resource IPC", () => {
  test("uses content hash CAS while Canvas itself has no document revision", async () => {
    const textDocument = createCanvasDocument({
      id: "canvas-main",
      nodes: [createTextNode({
        id: "text-node",
        position: { x: 0, y: 0 },
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/a.md" } },
        name: "a.md",
        resourceState: { status: "ready" },
      })],
    })
    const compareAndReplaceTextFile = mock(async () => ({ contentRevision: "b".repeat(64) }))
    registerCanvasTextResourceIpc(
      { compareAndReplaceTextFile },
      { query: async () => ({ nodes: [], projection: textDocument }) },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one" }),
      },
    )
    await expect(handlers.get(canvasTextResourceIpcChannel)!(event, {
      content: "new", contentRevision: "a".repeat(64), nodeId: "text-node",
    })).resolves.toEqual({ contentRevision: "b".repeat(64) })
    expect(compareAndReplaceTextFile).toHaveBeenCalledWith({
      content: "new",
      expectedRevision: "a".repeat(64),
      path: "Notes/a.md",
      projectId: "project-one",
    })
  })

  test("returns only the typed text conflict without leaking native errors", async () => {
    const textDocument = createCanvasDocument({
      id: "canvas-main",
      nodes: [createTextNode({
        id: "text-node", position: { x: 0, y: 0 }, name: "a.md", resourceState: { status: "ready" },
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/a.md" } },
      })],
    })
    registerCanvasTextResourceIpc(
      { compareAndReplaceTextFile: async () => { throw new ProjectTextFileConflictError("a".repeat(64), "c".repeat(64)) } },
      { query: async () => ({ nodes: [], projection: textDocument }) },
      {
        isTrustedSender: () => true,
        resolveActiveCanvas: async () => ({ canvasId: "canvas-main", projectId: "project-one" }),
      },
    )
    await expect(handlers.get(canvasTextResourceIpcChannel)!(event, {
      content: "new", contentRevision: "a".repeat(64), nodeId: "text-node",
    })).resolves.toEqual({ actualRevision: "c".repeat(64), kind: canvasTextResourceConflictKind })
  })
})

function commandResult(): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: ["created"],
    changed: true,
    createdNodeIds: ["created"],
    document,
    operationReceipt: receipt,
    warnings: ["normalized"],
  }
}
