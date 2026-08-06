import { describe, expect, mock, test } from "bun:test"
import {
  CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  createCanvasYDoc,
  validateCanvasYDoc,
  type BoundedOperationReceipt,
  type CanvasSnapshot,
} from "@convax/canvas/collaboration"
import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseProjectId,
  parseReplicaId,
  type OwnerValidatedState,
} from "@convax/collaboration"
import type { MainCollaborationDocumentSession } from "./collaboration-document-session"
import { createCanvasCollaborationSessionOwner } from "./canvas-collaboration-session-owner"

const ref = { scopeId: "project-a", canvasId: "canvas-a" }

describe("CanvasCollaborationSessionOwner Project quiescence", () => {
  test("records Plugin semantic roots in the mounted Main undo chain and clears them on unmount", async () => {
    const session = semanticRootSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: async () => session.value,
    })
    const actor = { kind: "plugin", id: "plugin-snapshot" }
    const opened = await owner.open({ ref, actor })
    expect(opened.canUndo).toBeFalse()

    await owner.submitAuthoritative({
      ref,
      caller: "plugin",
      actor,
      commandId: "creation-group-one",
      command: {} as never,
    })
    expect((await owner.queryRenderer(ref, opened.sessionId)).canUndo).toBeTrue()

    owner.close({ ref, sessionId: opened.sessionId })
    expect((await owner.open({ ref, actor })).canUndo).toBeFalse()
    owner.dispose()
  })

  test("flushes, disposes, and blocks lazy reopen until the Project resumes", async () => {
    const sessions: ReturnType<typeof fakeSession>[] = []
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      async openDocumentSession() {
        const session = fakeSession()
        sessions.push(session)
        return session.value
      },
    })

    await owner.flush(ref)
    await owner.quiesceProject(ref.scopeId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.flush).toHaveBeenCalledTimes(2)
    expect(sessions[0]!.dispose).toHaveBeenCalledTimes(1)
    await expect(owner.flush(ref)).rejects.toThrow("quiesced")

    owner.resumeProject(ref.scopeId)
    await owner.flush(ref)
    expect(sessions).toHaveLength(2)
    owner.dispose()
  })

  test("a pending lazy open cannot publish after the Project quiescence barrier", async () => {
    let resolveOpen!: (session: MainCollaborationDocumentSession<"canvas">) => void
    const pending = new Promise<MainCollaborationDocumentSession<"canvas">>((resolve) => { resolveOpen = resolve })
    const session = fakeSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: () => pending,
    })

    const opening = owner.flush(ref)
    const quiescing = owner.quiesceProject(ref.scopeId)
    resolveOpen(session.value)

    await expect(opening).rejects.toThrow("quiesced")
    await quiescing
    expect(session.dispose).toHaveBeenCalledTimes(1)
    owner.dispose()
  })
})

function inertOptions() {
  return {
    createSessionId: () => parseId128(Buffer.alloc(16, 1).toString("base64url")),
    createCursorToken: () => parseId128(Buffer.alloc(16, 2).toString("base64url")),
    resolveFacts: async () => ({ status: "rejected" as const }),
    applicationCommands: { construct: () => "rejected" as const },
  }
}

function fakeSession() {
  const flush = mock(async () => undefined)
  const dispose = mock(() => undefined)
  const value: MainCollaborationDocumentSession<"canvas"> = {
    scope: {
      projectId: "project-a" as never,
      projectEpoch: parseId128(Buffer.alloc(16, 3).toString("base64url")),
      docKind: "canvas",
      docId: `cv_${"a".repeat(64)}` as never,
      shardEpoch: parseId128(Buffer.alloc(16, 4).toString("base64url")),
    },
    query: async <T>(_project: (state: OwnerValidatedState<"canvas">) => T): Promise<T> => {
      throw new Error("unused")
    },
    submit: async () => { throw new Error("unused") },
    flush,
    subscribe: () => () => undefined,
    dispose,
  }
  return { value, flush, dispose }
}

function semanticRootSession() {
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(3)))
  const shardEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(4)))
  const scope = Object.freeze({
    projectId: parseProjectId("project-a"),
    projectEpoch,
    docKind: "canvas" as const,
    docId: parseCanvasId(`cv_${"1".repeat(64)}`),
    shardEpoch,
  })
  const document = createCanvasYDoc(
    scope,
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    parseDigest("2".repeat(64)),
    parseDigest("3".repeat(64)),
    parseReplicaId("replica_00000001"),
  )
  let snapshot: CanvasSnapshot = validateCanvasYDoc(document)
  document.destroy()
  const value: MainCollaborationDocumentSession<"canvas"> = {
    scope,
    query: async <T>(project: (state: OwnerValidatedState<"canvas">) => T): Promise<T> =>
      project({ value: snapshot } as OwnerValidatedState<"canvas">),
    submit: async (input) => {
      const operationId = input.operationId!
      const receipt: BoundedOperationReceipt = Object.freeze({
        format: "convax.canvas-operation-receipt",
        actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(5))),
        operationId,
        intentKind: "canvas.agent.create",
        intentDigest: parseDigest("4".repeat(64)),
        baseFrontierDigest: parseDigest("5".repeat(64)),
        resultEntities: Object.freeze([]),
        semanticRoot: true,
        historyMaterialDigest: parseDigest("6".repeat(64)),
      })
      snapshot = Object.freeze({ ...snapshot, operations: new Map([[`operation/${operationId}`, receipt]]) })
      return { status: "saved-locally", frame: { header: { core: { operationId } } } } as never
    },
    flush: async () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  }
  return { value }
}
