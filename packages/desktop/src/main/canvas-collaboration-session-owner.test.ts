import { describe, expect, mock, test } from "bun:test"
import {
  CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  applyCanvasCandidateIntent,
  canvasOperationReceipt,
  createCanvasYDoc,
  derivedNodeRef,
  obstacleProjectionDigest,
  validateCanvasYDoc,
  type BoundedOperationReceipt,
  type CanvasExternalFactContext,
  type CanvasResourceRef,
  type CanvasSnapshot,
} from "@convax/canvas/collaboration"
import type { CanvasApplicationCommandResult } from "@convax/canvas/application"
import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseProjectId,
  parseReplicaId,
  parseUint32,
  parseUint64,
  type OwnerIntentValidationContext,
  type OwnerValidatedState,
} from "@convax/collaboration"
import type { MainCollaborationDocumentSession } from "./collaboration-document-session"
import { createCanvasCollaborationSessionOwner } from "./canvas-collaboration-session-owner"

const ref = { scopeId: "project-a", canvasId: "canvas-a" }

describe("CanvasCollaborationSessionOwner Project quiescence", () => {
  test("keeps Plugin semantic roots out of every mounted renderer undo chain", async () => {
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
    expect((await owner.queryRenderer(ref, opened.sessionId)).canUndo).toBeFalse()

    owner.close({ ref, sessionId: opened.sessionId })
    expect((await owner.open({ ref, actor })).canUndo).toBeFalse()
    owner.dispose()
  })

  test("records a renderer semantic root only in its originating lease", async () => {
    const session = semanticRootSession()
    let sessionFill = 10
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      createSessionId: () => parseId128(encodeBase64url(new Uint8Array(16).fill(sessionFill++))),
      openDocumentSession: async () => session.value,
    })
    const actor = { kind: "renderer", id: "renderer-one" }
    const first = await owner.open({ ref, actor })
    const second = await owner.open({ ref, actor: { kind: "renderer", id: "renderer-two" } })
    await owner.submitRenderer({
      ref,
      sessionId: first.sessionId,
      commandId: "move-one",
      command: {} as never,
    })
    expect((await owner.queryRenderer(ref, first.sessionId)).canUndo).toBeTrue()
    expect((await owner.queryRenderer(ref, second.sessionId)).canUndo).toBeFalse()
    owner.dispose()
  })

  test("admits only the exact live renderer-owned lease at Main IPC boundaries", async () => {
    const session = semanticRootSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: async () => session.value,
    })
    const rendererActorId = "desktop:renderer:7"
    const opened = await owner.open({ ref, actor: { kind: "renderer", id: rendererActorId } })

    expect(() => owner.requireRendererLease({ ref, rendererActorId, sessionId: opened.sessionId })).not.toThrow()
    expect(() =>
      owner.requireRendererLease({
        ref,
        rendererActorId: "desktop:renderer:8",
        sessionId: opened.sessionId,
      }),
    ).toThrow("belongs to another renderer")
    expect(() =>
      owner.requireRendererLease({
        ref: { ...ref, canvasId: "canvas-other" },
        rendererActorId,
        sessionId: opened.sessionId,
      }),
    ).toThrow("stale")

    owner.close({ ref, sessionId: opened.sessionId })
    expect(() => owner.requireRendererLease({ ref, rendererActorId, sessionId: opened.sessionId })).toThrow("stale")
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
    const pending = new Promise<MainCollaborationDocumentSession<"canvas">>((resolve) => {
      resolveOpen = resolve
    })
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

  test("delivers prepared editable text and media URLs in the first authoritative projection", async () => {
    const session = preparedResourceSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: async () => session.value,
    })
    const actor = { kind: "renderer", id: "renderer-prepared-resources" }
    const opened = await owner.open({ ref, actor })
    const textBefore = opened.document.nodes.find((node) => node.id === session.textNode.id)!
    const imageBefore = opened.document.nodes.find((node) => node.id === session.imageNode.id)!
    expect(textBefore.data.resourceState).toMatchObject({ status: "stale" })
    expect(imageBefore.data.resourceState).toMatchObject({ status: "stale" })

    const result = preparedApplicationResult(
      opened.document,
      session.receipt,
      session.textNode.id,
      session.imageNode.id,
    )
    const delivered = await owner.deliverApplicationCommit({
      ref,
      rendererActorId: actor.id,
      sessionId: opened.sessionId,
      result,
    })
    expect(delivered.status).toBe("accepted")
    if (delivered.status !== "accepted") throw new Error("Prepared resource delivery was unavailable")

    const text = delivered.projection.document.nodes.find((node) => node.id === session.textNode.id)!
    const image = delivered.projection.document.nodes.find((node) => node.id === session.imageNode.id)!
    expect(text.data.resourceState).toEqual({
      contentRevision: "text-r1",
      editableText: true,
      status: "ready",
      text: "# Immediately editable",
    })
    expect(image.data.resourceState).toEqual({ status: "ready", url: "blob:prepared-image" })
    expect(text.position).toEqual(textBefore.position)
    expect(text.style).toEqual(textBefore.style)
    expect(image.position).toEqual(imageBefore.position)
    expect(image.style).toEqual(imageBefore.style)
    owner.dispose()
  })

  test("rejects prepared runtime state when the durable resource binding does not match", async () => {
    const session = preparedResourceSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: async () => session.value,
    })
    const actor = { kind: "renderer", id: "renderer-mismatched-resource" }
    const opened = await owner.open({ ref, actor })
    const result = preparedApplicationResult(
      opened.document,
      session.receipt,
      session.textNode.id,
      session.imageNode.id,
    )
    const textIndex = result.document.nodes.findIndex((node) => node.id === session.textNode.id)
    const forgedNodes = result.document.nodes.map((node, index) =>
      index === textIndex
        ? {
            ...node,
            data: {
              ...node.data,
              metadata: { forgedResourceBinding: true },
            },
          }
        : node,
    )
    const delivered = await owner.deliverApplicationCommit({
      ref,
      rendererActorId: actor.id,
      sessionId: opened.sessionId,
      result: { ...result, document: { ...result.document, nodes: forgedNodes } },
    })
    expect(delivered.status).toBe("accepted")
    if (delivered.status !== "accepted") throw new Error("Prepared resource delivery was unavailable")

    const text = delivered.projection.document.nodes.find((node) => node.id === session.textNode.id)!
    const image = delivered.projection.document.nodes.find((node) => node.id === session.imageNode.id)!
    expect(text.data.resourceState).toMatchObject({ status: "stale" })
    expect(text.data.metadata).not.toHaveProperty("forgedResourceBinding")
    expect(image.data.resourceState).toEqual({ status: "ready", url: "blob:prepared-image" })
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
    submit: async () => {
      throw new Error("unused")
    },
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
      const actorId = parseActorId(encodeBase64url(new Uint8Array(32).fill(5)))
      const receipt: BoundedOperationReceipt = Object.freeze({
        format: "convax.canvas-operation-receipt",
        actorId,
        operationId,
        intentKind: "canvas.agent.create",
        intentDigest: parseDigest("4".repeat(64)),
        baseFrontierDigest: parseDigest("5".repeat(64)),
        resultEntities: Object.freeze([]),
        semanticRoot: true,
        historyMaterialDigest: parseDigest("6".repeat(64)),
      })
      snapshot = Object.freeze({ ...snapshot, operations: new Map([[`operation/${actorId}/${operationId}`, receipt]]) })
      return {
        status: "saved-locally",
        frame: { frameDigest: parseDigest("7".repeat(64)), header: { core: { actorId, operationId } } },
      } as never
    },
    flush: async () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  }
  return { value }
}

function preparedResourceSession() {
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(11)))
  const shardEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(12)))
  const protocolDigest = parseDigest("a".repeat(64))
  const routeDigest = parseDigest("b".repeat(64))
  const scope = Object.freeze({
    projectId: parseProjectId("project-a"),
    projectEpoch,
    docKind: "canvas" as const,
    docId: parseCanvasId(`cv_${"c".repeat(64)}`),
    shardEpoch,
  })
  const document = createCanvasYDoc(
    scope,
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    protocolDigest,
    routeDigest,
    parseReplicaId("replica_00000001"),
  )
  const operationContext: OwnerIntentValidationContext = Object.freeze({
    scope,
    actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(13))),
    actorSequence: parseUint64("1"),
    operationId: parseId128(encodeBase64url(new Uint8Array(16).fill(14))),
    lamport: parseUint64("1"),
    intentDigest: parseDigest("d".repeat(64)),
    baseFrontierDigest: parseDigest("e".repeat(64)),
    protocolDigest,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    validationArtifactSetDigest: parseDigest("f".repeat(64)),
  })
  const textNode = derivedNodeRef(operationContext, parseUint32("0"))
  const imageNode = derivedNodeRef(operationContext, parseUint32("1"))
  const textResource = preparedResource("text", "1")
  const imageResource = preparedResource("image", "2")
  const facts: CanvasExternalFactContext = Object.freeze({
    validateCurrentResource: () => "valid",
    validatePluginArtifact: () => "valid",
    validatePluginState: () => "valid",
    validateGenerationBegin: () => "valid",
    validateGenerationRecovery: () => "valid",
  })
  const base = validateCanvasYDoc(document)
  const outcome = applyCanvasCandidateIntent(
    document,
    operationContext,
    {
      format: "convax.typed-intent",
      kind: "canvas.resources.add",
      guard: {
        existingEndpoints: [],
        derivedNodes: [
          { ordinal: parseUint32("0"), node: textNode, expectedAbsent: true },
          { ordinal: parseUint32("1"), node: imageNode, expectedAbsent: true },
        ],
        derivedEdges: [],
        resourceProofs: [
          { createdNodeOrdinal: parseUint32("0"), proof: currentResourceProof(textResource) },
          { createdNodeOrdinal: parseUint32("1"), proof: currentResourceProof(imageResource) },
        ],
      },
      body: {
        placement: {
          anchor: { x: 80, y: 120 },
          gap: 24,
          obstacleProjectionDigest: obstacleProjectionDigest(base),
        },
        nodes: [
          {
            ordinal: parseUint32("0"),
            nodeId: textNode.id,
            incarnation: textNode.incarnation,
            size: { width: 320, height: 180 },
            title: "Brief.md",
            resource: textResource,
          },
          {
            ordinal: parseUint32("1"),
            nodeId: imageNode.id,
            incarnation: imageNode.incarnation,
            size: { width: 320, height: 180 },
            title: "Hero.png",
            resource: imageResource,
          },
        ],
        edges: [],
      },
    },
    facts,
  )
  if (outcome === "pending" || outcome === "rejected") throw new Error(`Resource fixture was ${outcome}`)
  const snapshot = validateCanvasYDoc(document)
  document.destroy()
  const receipt = canvasOperationReceipt(snapshot, operationContext.actorId, operationContext.operationId)
  if (!receipt) throw new Error("Resource fixture receipt is missing")
  const value: MainCollaborationDocumentSession<"canvas"> = {
    scope,
    query: async <T>(project: (state: OwnerValidatedState<"canvas">) => T): Promise<T> =>
      project({ value: snapshot } as OwnerValidatedState<"canvas">),
    submit: async () => {
      throw new Error("unused")
    },
    flush: async () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  }
  return { imageNode, receipt, textNode, value }
}

function preparedResource(kind: "text" | "image", seed: "1" | "2"): CanvasResourceRef {
  return {
    format: "convax.canvas-resource-ref",
    uri:
      `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
      `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${seed.repeat(64)}?blob=sha256%3A${seed.repeat(64)}` +
      `&path=${kind === "text" ? "Notes%2FBrief.md" : "Media%2FHero.png"}`,
    mediaClass: kind,
    mime: kind === "text" ? "text/markdown" : "image/png",
    byteLength: parseUint64("12"),
    contentDigest: parseDigest(seed.repeat(64)),
    ownerProofDigest: parseDigest((kind === "text" ? "3" : "4").repeat(64)),
  }
}

function currentResourceProof(resource: CanvasResourceRef) {
  return {
    format: "convax.canvas-resource-proof-ref" as const,
    mode: "current-owner-state" as const,
    resource,
    ownerProofDigest: resource.ownerProofDigest,
    requireCurrentLiveVersion: true as const,
  }
}

function preparedApplicationResult(
  authoritative: CanvasApplicationCommandResult["document"],
  receipt: BoundedOperationReceipt,
  textNodeId: string,
  imageNodeId: string,
): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: [textNodeId, imageNodeId],
    changed: true,
    createdNodeIds: [textNodeId, imageNodeId],
    document: {
      ...authoritative,
      nodes: authoritative.nodes.map((node) => {
        if (node.id === textNodeId) {
          return {
            ...node,
            position: { x: 9_999, y: 9_999 },
            style: { width: 1, height: 1 },
            data: {
              ...node.data,
              resourceState: {
                contentRevision: "text-r1",
                editableText: true,
                status: "ready" as const,
                text: "# Immediately editable",
              },
            },
          }
        }
        if (node.id === imageNodeId) {
          return {
            ...node,
            position: { x: -9_999, y: -9_999 },
            style: { width: 2, height: 2 },
            data: { ...node.data, resourceState: { status: "ready" as const, url: "blob:prepared-image" } },
          }
        }
        return node
      }),
    },
    operationReceipt: receipt,
    acceptedFrameDigest: parseDigest("9".repeat(64)),
    warnings: [],
  }
}
