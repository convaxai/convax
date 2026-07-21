import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "../document"
import type { CanvasDocumentRepository, CanvasDocumentSaveRequest, CanvasDocumentSnapshot } from "./persistence"
import {
  CanvasApplicationService,
  CanvasCommandIdConflictError,
  CanvasTransactionIdConflictError,
  type CanvasApplicationCommandRequest,
} from "./service"

describe("canvas application service", () => {
  test("loads, executes, and compare-and-swap saves one business command", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({
        id: "canvas-main",
        nodes: [createTextNode({ id: "first", position: { x: 0, y: 0 }, text: "Launch brief" })],
      }),
      storageVersion: "v1",
    }
    const saves: CanvasDocumentSaveRequest[] = []
    const repository: CanvasDocumentRepository = {
      async load() {
        return snapshot
      },
      async save(request) {
        saves.push(request)
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    }
    const commits: unknown[] = []
    const service = new CanvasApplicationService(repository, {
      onDidCommit(event) {
        commits.push(event)
        throw new Error("observer failure must not change persistence")
      },
    })
    const request: CanvasApplicationCommandRequest = {
      canvasId: "canvas-main",
      scopeId: "project_one",
      envelope: {
        actor: { id: "agent_one", kind: "agent" },
        command: { type: "nodes.move", delta: { x: 20, y: 10 }, nodeIds: ["first"] },
        commandId: "move_first",
        expectedRevision: 0,
      },
    }
    const result = await service.execute(request)

    expect(result.document).toMatchObject({ revision: 1, nodes: [{ id: "first", position: { x: 20, y: 10 } }] })
    expect(result.storageVersion).toBe("v2")
    expect(commits).toEqual([
      {
        actor: { id: "agent_one", kind: "agent" },
        canvasId: "canvas-main",
        revision: 1,
        scopeId: "project_one",
        storageVersion: "v2",
      },
    ])
    expect(saves[0]?.expectedStorageVersion).toBe("v1")
    expect(await service.execute(request)).toBe(result)
    expect(saves).toHaveLength(1)
    await expect(
      service.execute({
        ...request,
        envelope: {
          ...request.envelope,
          command: { type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["first"] },
        },
      }),
    ).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
    expect(
      (await service.query({ canvasId: "canvas-main", scopeId: "project_one" }, { text: "launch" })).nodes.map(
        (node) => node.id,
      ),
    ).toEqual(["first"])
  })

  test("applies a transaction in order with one revision, one CAS save, and transaction idempotency", async () => {
    let loads = 0
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({
        id: "canvas-transaction",
        nodes: [createTextNode({ id: "first", position: { x: 0, y: 0 } })],
      }),
      storageVersion: "v1",
    }
    const saves: CanvasDocumentSaveRequest[] = []
    const repository: CanvasDocumentRepository = {
      async load() {
        loads += 1
        return snapshot
      },
      async save(request) {
        saves.push(request)
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    }
    const service = new CanvasApplicationService(repository)
    const request = {
      canvasId: "canvas-transaction",
      scopeId: "project_one",
      envelope: {
        actor: { id: "plugin_one", kind: "plugin" },
        commands: [
          { type: "nodes.move" as const, delta: { x: 20, y: 10 }, nodeIds: ["first"] },
          { type: "nodes.move" as const, delta: { x: 5, y: -2 }, nodeIds: ["first"] },
          {
            type: "nodes.setGeometry" as const,
            updates: [{ nodeId: "first", position: { x: 80, y: 90 }, size: { height: 240, width: 360 } }],
          },
        ],
        expectedRevision: 0,
        transactionId: "transaction_one",
      },
    }

    const result = await service.executeTransaction(request)

    expect(result.document).toMatchObject({
      revision: 1,
      nodes: [{ id: "first", position: { x: 80, y: 90 }, style: { height: 240, width: 360 } }],
    })
    expect(saves).toHaveLength(1)
    expect(saves[0]?.expectedStorageVersion).toBe("v1")
    expect(await service.executeTransaction(request)).toBe(result)
    expect(loads).toBe(1)
    await expect(
      service.executeTransaction({
        ...request,
        envelope: {
          ...request.envelope,
          commands: [{ type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["first"] }],
        },
      }),
    ).rejects.toBeInstanceOf(CanvasTransactionIdConflictError)
    expect(saves).toHaveLength(1)
  })

  test("does not save a partially applied transaction when a later command fails", async () => {
    const document = createCanvasDocument({
      id: "canvas-atomic",
      nodes: [createTextNode({ id: "first", position: { x: 0, y: 0 } })],
    })
    let saves = 0
    const service = new CanvasApplicationService({
      async load() {
        return { document, storageVersion: "v1" }
      },
      async save() {
        saves += 1
        return { storageVersion: "v2" }
      },
    })

    await expect(
      service.executeTransaction({
        canvasId: document.id,
        scopeId: "project_one",
        envelope: {
          actor: { id: "plugin_one", kind: "plugin" },
          commands: [
            { type: "nodes.move", delta: { x: 20, y: 10 }, nodeIds: ["first"] },
            { type: "nodes.setGeometry", updates: [{ nodeId: "missing", position: { x: 0, y: 0 } }] },
          ],
          expectedRevision: 0,
          transactionId: "transaction_failure",
        },
      }),
    ).rejects.toThrow("was not found")
    expect(saves).toBe(0)
    expect(document.nodes[0]?.position).toEqual({ x: 0, y: 0 })
  })

  test.each(["command", "transaction"] as const)(
    "does not save a %s canceled while its document is loading",
    async (kind) => {
      const document = createCanvasDocument({
        id: `canvas-canceled-${kind}`,
        nodes: [createTextNode({ id: "first", position: { x: 0, y: 0 } })],
      })
      let releaseLoad!: (snapshot: CanvasDocumentSnapshot) => void
      const loadStarted = Promise.withResolvers<void>()
      const loadResult = new Promise<CanvasDocumentSnapshot>((resolve) => {
        releaseLoad = resolve
      })
      let saves = 0
      const service = new CanvasApplicationService({
        async load() {
          loadStarted.resolve()
          return loadResult
        },
        async save() {
          saves += 1
          return { storageVersion: "v2" }
        },
      })
      const controller = new AbortController()
      const cancellation = new DOMException("Caller stopped", "AbortError")
      const operation =
        kind === "command"
          ? service.execute({
              canvasId: document.id,
              envelope: {
                actor: { id: "agent_one", kind: "agent" },
                command: { type: "nodes.move", delta: { x: 20, y: 10 }, nodeIds: ["first"] },
                commandId: "canceled_command",
                expectedRevision: 0,
              },
              scopeId: "project_one",
              signal: controller.signal,
            })
          : service.executeTransaction({
              canvasId: document.id,
              envelope: {
                actor: { id: "plugin_one", kind: "plugin" },
                commands: [{ type: "nodes.move", delta: { x: 20, y: 10 }, nodeIds: ["first"] }],
                expectedRevision: 0,
                transactionId: "canceled_transaction",
              },
              scopeId: "project_one",
              signal: controller.signal,
            })

      await loadStarted.promise
      controller.abort(cancellation)
      releaseLoad({ document, storageVersion: "v1" })

      await expect(operation).rejects.toBe(cancellation)
      expect(saves).toBe(0)
      expect(document.nodes[0]?.position).toEqual({ x: 0, y: 0 })
    },
  )

  test("bounds retained idempotency documents by serialized size", async () => {
    let loads = 0
    const document = createCanvasDocument({
      id: "canvas-large-replay",
      nodes: [createTextNode({ id: "large", position: { x: 0, y: 0 }, text: "x".repeat(1024 * 1024) })],
    })
    const service = new CanvasApplicationService({
      async load() {
        loads += 1
        return { document: structuredClone(document), storageVersion: "v1" }
      },
      async save() {
        throw new Error("A no-op transaction must not save")
      },
    })
    const transaction = (transactionId: string) =>
      service.executeTransaction({
        canvasId: document.id,
        scopeId: "project_one",
        envelope: {
          actor: { id: "plugin_one", kind: "plugin" },
          commands: [],
          expectedRevision: 0,
          transactionId,
        },
      })

    for (let index = 0; index < 6; index += 1) await transaction(`transaction_${index}`)
    expect(loads).toBe(6)
    await transaction("transaction_5")
    expect(loads).toBe(6)
    await transaction("transaction_0")
    expect(loads).toBe(7)
  })
})
