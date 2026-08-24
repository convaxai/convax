import { describe, expect, mock, test } from "bun:test"
import {
  adaptCanvasApplicationCommand,
  applyCanvasCandidateIntent,
  CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  canvasOperationReceipt,
  canvasSnapshotFromValidatedOwnerState,
  constructCanvasAuthoritativeIntent,
  createCanvasDocumentOwnerRuntime,
  createCanvasYDoc,
  deriveCanvasCommandOperationId,
  derivedNodeRef,
  parseCanvasCertifiedProjectionPatch,
  projectCanvas,
  readCanvasCertifiedProjectionIdentity,
  type BoundedOperationReceipt,
  type CanvasExternalFactContext,
  type CanvasResourceProofRef,
  type CanvasResourceRef,
  type CanvasSnapshot,
  type CanvasTypedIntentUnion,
} from "@convax/canvas/collaboration"
import type { CanvasCertifiedAddResourcesResult } from "@convax/canvas/application"
import {
  CanvasApplicationService,
  CanvasResourceBusinessService,
} from "@convax/canvas/application"
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
  type OwnerExternalFactPort,
  type OwnerIntentValidationContext,
  type OwnerValidatedState,
} from "@convax/collaboration"
import type { MainCollaborationDocumentSession } from "./collaboration-document-session"
import { loadHistoricalTestAuthority } from "./collaboration-authority.test-support"
import { createCanvasCollaborationSessionOwner } from "./canvas-collaboration-session-owner"

const canvasId = parseCanvasId(`cv_${"1".repeat(64)}`)
const ref = { scopeId: "project-a", canvasId }
const testAuthority = await loadHistoricalTestAuthority()
const testCanvasRuntime = createCanvasDocumentOwnerRuntime(testAuthority)

describe("CanvasCollaborationSessionOwner Project quiescence", () => {
  test("keeps prepared resource runtime aligned to typed-intent ordinals when the receipt sorts node ids", async () => {
    const actor = { kind: "renderer" as const, id: "renderer-resource-ordinal" }
    const session = resourceCommandSession()
    const commandId = resourceCommandIdWithReceiptOrderDifferentFromOrdinal(session.scope, actor)
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      applicationCommands: { construct: adaptCanvasApplicationCommand },
      openDocumentSession: async () => session.value,
      resolveFacts: async () => ({
        status: "resolved" as const,
        port: validCanvasExternalFacts() as unknown as OwnerExternalFactPort<"canvas">,
      }),
    })
    const resources = new CanvasResourceBusinessService(
      {
        prepare: async () => ({
          items: [
            resourceItem("first", currentResourceProof(30), "first"),
            resourceItem("second", currentResourceProof(40), "second"),
          ],
        }),
      },
      new CanvasApplicationService(owner),
    )

    const added = await resources.addResources({
      actor,
      anchor: { x: 0, y: 0 },
      canvasId: ref.canvasId,
      commandId,
      scopeId: ref.scopeId,
      sources: [
        { kind: "host-file", path: "Notes/first.md", sourceId: "first" },
        { kind: "host-file", path: "Notes/second.md", sourceId: "second" },
      ],
    })
    const receiptNodeIds = added.operationReceipt.resultEntities
      .filter((entity) => entity.kind === "node")
      .map((entity) => entity.id)

    expect(added.createdResourceNodeIds).toBeDefined()
    const ordinalNodeIds = added.createdResourceNodeIds!
    expect(ordinalNodeIds).toEqual(added.createdNodeIds)
    expect(ordinalNodeIds).not.toEqual(receiptNodeIds)
    expect(added.preparedResources.map(({ nodeId }) => nodeId)).toEqual([...ordinalNodeIds])
    expect(added.preparedResources.map(({ state }) => state.text)).toEqual(["first", "second"])
    owner.dispose()
  })

  test("clones only exact live resource targets and rejects stale incarnations", async () => {
    const session = targetedNodeSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: async () => session.value,
    })
    const opened = await owner.open({ ref, actor: { kind: "renderer", id: "renderer-one" } })
    expect(opened.document.nodes).toHaveLength(2)
    const target = opened.nodeEntities[0]!
    const other = opened.nodeEntities[1]!

    const bounded = await owner.queryRendererResourceTargets(ref, opened.sessionId, [target])

    expect(bounded.edges).toEqual([])
    expect(bounded.nodes.map((node) => node.id)).toEqual([target.nodeId])
    expect(bounded.nodes[0]).not.toBe(opened.document.nodes.find((node) => node.id === target.nodeId))
    const repeated = await owner.queryRendererResourceTargets(ref, opened.sessionId, [target])
    expect(repeated.nodes[0]).not.toBe(bounded.nodes[0])
    await expect(
      owner.queryRendererResourceTargets(ref, opened.sessionId, [
        { entity: { ...target.entity, incarnation: other.entity.incarnation }, nodeId: target.nodeId },
      ]),
    ).rejects.toThrow("target is stale")
    owner.dispose()
  })

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

  test("delivers the owner-certified patch with an exact transient runtime sidecar", async () => {
    const session = preparedResourceSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: async () => session.value,
    })
    const actor = { kind: "renderer", id: "renderer-prepared-resources" }
    const opened = await owner.open({ ref, actor })
    const queryCountAfterOpen = session.queryCount()
    const result = preparedCertifiedResult(
      session.patch,
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
    expect(delivered.status).toBe("certified")
    if (delivered.status !== "certified") throw new Error("Prepared resource delivery was unavailable")
    expect(delivered.patch).toBe(session.patch)
    expect(delivered.runtimePatches).toEqual(result.preparedResources)
    expect(delivered.ref).toEqual(ref)
    expect(delivered.sessionId).toBe(opened.sessionId)
    expect(session.queryCount()).toBe(queryCountAfterOpen)
    owner.dispose()
  })

  test("drops an invalid runtime sidecar without discarding the certified durable patch", async () => {
    const session = preparedResourceSession()
    const owner = createCanvasCollaborationSessionOwner({
      ...inertOptions(),
      openDocumentSession: async () => session.value,
    })
    const actor = { kind: "renderer", id: "renderer-mismatched-resource" }
    const opened = await owner.open({ ref, actor })
    const result = preparedCertifiedResult(
      session.patch,
      session.receipt,
      session.textNode.id,
      session.imageNode.id,
    )
    const delivered = await owner.deliverApplicationCommit({
      ref,
      rendererActorId: actor.id,
      sessionId: opened.sessionId,
      result: {
        ...result,
        preparedResources: [
          ...result.preparedResources.slice(0, 1),
          { ...result.preparedResources[1]!, nodeId: "forged-node" },
        ],
      },
    })
    expect(delivered.status).toBe("certified")
    if (delivered.status !== "certified") throw new Error("Prepared resource delivery was unavailable")
    expect(delivered.patch).toBe(session.patch)
    expect(delivered.runtimePatches).toEqual([])
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

function validatedCanvasSnapshot(
  document: Parameters<typeof applyCanvasCandidateIntent>[0],
): CanvasSnapshot {
  const state = testCanvasRuntime.protocolPort.validateBase(document)
  if (typeof state === "string") throw new Error(`Canvas fixture base was ${state}`)
  const snapshot = canvasSnapshotFromValidatedOwnerState(state)
  if (!snapshot) throw new Error("Canvas fixture snapshot is unavailable")
  return snapshot
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
  const protocolDigest = testAuthority.protocolDigest
  const document = createCanvasYDoc(
    scope,
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    protocolDigest,
    parseDigest("3".repeat(64)),
    parseReplicaId("replica_00000001"),
  )
  let snapshot: CanvasSnapshot = validatedCanvasSnapshot(document)
  let sequence = 1
  const value: MainCollaborationDocumentSession<"canvas"> = {
    scope,
    query: async <T>(project: (state: OwnerValidatedState<"canvas">) => T): Promise<T> =>
      project({ value: snapshot } as OwnerValidatedState<"canvas">),
    submit: async (input) => {
      const operationId = input.operationId!
      const actorId = parseActorId(encodeBase64url(new Uint8Array(32).fill(5)))
      const context: OwnerIntentValidationContext = Object.freeze({
        scope,
        actorId,
        actorSequence: parseUint64(String(sequence)),
        operationId,
        lamport: parseUint64(String(sequence)),
        intentDigest: parseDigest((32 + sequence).toString(16).padStart(2, "0").repeat(32)),
        baseFrontierDigest: parseDigest("5".repeat(64)),
        protocolDigest,
        ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
        validationArtifactSetDigest: parseDigest("6".repeat(64)),
      })
      const constructed = constructCanvasAuthoritativeIntent({
        snapshot,
        context,
        command: {
          kind: "agent-node-create",
          title: `Semantic root ${sequence}`,
          instructions: null,
          position: { x: sequence * 24, y: sequence * 24 },
          size: { width: 240, height: 120 },
        },
      })
      if (constructed === "rejected") throw new Error("Semantic-root fixture command was rejected")
      const result = applyCanvasCandidateIntent(document, context, constructed.intent, validCanvasExternalFacts())
      if (result === "pending" || result === "rejected") {
        throw new Error(`Semantic-root fixture commit ${result}`)
      }
      snapshot = validatedCanvasSnapshot(document)
      sequence += 1
      return {
        status: "saved-locally",
        frame: { frameDigest: parseDigest("7".repeat(64)), header: { core: { actorId, operationId } } },
      } as never
    },
    flush: async () => undefined,
    subscribe: () => () => undefined,
    dispose: () => document.destroy(),
  }
  return { value }
}

function resourceCommandSession() {
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(21)))
  const shardEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(22)))
  const protocolDigest = testAuthority.protocolDigest
  const scope = Object.freeze({
    projectId: parseProjectId("project-a"),
    projectEpoch,
    docKind: "canvas" as const,
    docId: canvasId,
    shardEpoch,
  })
  const document = createCanvasYDoc(
    scope,
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    protocolDigest,
    parseDigest("e".repeat(64)),
    parseReplicaId("replica_00000001"),
  )
  let snapshot = validatedCanvasSnapshot(document)
  const value: MainCollaborationDocumentSession<"canvas"> = {
    scope,
    query: async <T>(project: (state: OwnerValidatedState<"canvas">) => T): Promise<T> =>
      project({ value: snapshot } as OwnerValidatedState<"canvas">),
    submit: async (input) => {
      const operationId = input.operationId!
      const context = resourceCommandContext(scope, protocolDigest, operationId)
      const prepared = await input.prepare({
        base: { value: snapshot } as OwnerValidatedState<"canvas">,
        context,
        signal: input.signal,
      })
      const result = applyCanvasCandidateIntent(
        document,
        context,
        prepared.typedIntent as CanvasTypedIntentUnion,
        validCanvasExternalFacts(),
      )
      if (result === "pending" || result === "rejected") throw new Error(`Resource fixture commit ${result}`)
      snapshot = validatedCanvasSnapshot(document)
      return {
        status: "saved-locally",
        frame: {
          frameDigest: parseDigest("f".repeat(64)),
          header: { core: { actorId: context.actorId, operationId } },
        },
      } as never
    },
    flush: async () => undefined,
    subscribe: () => () => undefined,
    dispose: () => document.destroy(),
  }
  return { scope, value }
}

function resourceCommandContext(
  scope: ReturnType<typeof resourceCommandSession>["scope"],
  protocolDigest: ReturnType<typeof parseDigest>,
  operationId: ReturnType<typeof parseId128>,
): OwnerIntentValidationContext {
  return Object.freeze({
    scope,
    actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(23))),
    actorSequence: parseUint64("1"),
    operationId,
    lamport: parseUint64("1"),
    intentDigest: parseDigest("1".repeat(64)),
    baseFrontierDigest: parseDigest("2".repeat(64)),
    protocolDigest,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    validationArtifactSetDigest: parseDigest("3".repeat(64)),
  })
}

function resourceCommandIdWithReceiptOrderDifferentFromOrdinal(
  scope: ReturnType<typeof resourceCommandSession>["scope"],
  actor: { readonly id: string; readonly kind: "renderer" },
): string {
  for (let index = 0; index < 100; index += 1) {
    const commandId = `resource-ordinal-${index}`
    const operationId = deriveCanvasCommandOperationId({ actor, commandId, ref })
    const context = resourceCommandContext(scope, testAuthority.protocolDigest, operationId)
    const ordinalNodeIds = ["0", "1"].map((ordinal) => derivedNodeRef(context, parseUint32(ordinal)).id)
    if (ordinalNodeIds[0]! > ordinalNodeIds[1]!) return commandId
  }
  throw new Error("Could not construct a resource operation whose receipt order differs from ordinal order")
}

function validCanvasExternalFacts() {
  return Object.freeze({
    validateCurrentResource: () => "valid" as const,
    validatePluginArtifact: () => "valid" as const,
    validatePluginState: () => "valid" as const,
    validateGenerationBegin: () => "valid" as const,
    validateGenerationRecovery: () => "valid" as const,
  })
}

function currentResourceProof(seed: number): Extract<CanvasResourceProofRef, { mode: "current-owner-state" }> {
  const ownerProofDigest = parseDigest(seed.toString(16).padStart(2, "0").repeat(32))
  return {
    format: "convax.canvas-resource-proof-ref",
    mode: "current-owner-state",
    resource: {
      format: "convax.canvas-resource-ref",
      uri:
        `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
        `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${String(seed % 10).repeat(64)}` +
        `?blob=sha256%3A${String((seed + 1) % 10).repeat(64)}&path=Notes%2Fresource.md`,
      mediaClass: "text",
      mime: "text/markdown",
      byteLength: parseUint64("12"),
      contentDigest: parseDigest(((seed + 1) % 256).toString(16).padStart(2, "0").repeat(32)),
      ownerProofDigest,
    },
    ownerProofDigest,
    requireCurrentLiveVersion: true,
  }
}

function resourceItem(
  id: string,
  proof: Extract<CanvasResourceProofRef, { mode: "current-owner-state" }>,
  text: string,
) {
  return {
    id,
    kind: "text" as const,
    metadata: { convaxCanvasResourceProof: proof },
    name: `${id}.md`,
    state: { status: "ready" as const, text },
  }
}

function targetedNodeSession() {
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(13)))
  const shardEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(14)))
  const protocolDigest = testAuthority.protocolDigest
  const scope = Object.freeze({
    projectId: parseProjectId("project-a"),
    projectEpoch,
    docKind: "canvas" as const,
    docId: canvasId,
    shardEpoch,
  })
  const document = createCanvasYDoc(
    scope,
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    protocolDigest,
    parseDigest("a".repeat(64)),
    parseReplicaId("replica_00000001"),
  )
  addAgentNode(document, scope, protocolDigest, 15, "First")
  addAgentNode(document, scope, protocolDigest, 16, "Second")
  const snapshot = validatedCanvasSnapshot(document)
  document.destroy()
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
  return { value }
}

function preparedResourceSession() {
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(11)))
  const shardEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(12)))
  const protocolDigest = testAuthority.protocolDigest
  const routeDigest = parseDigest("b".repeat(64))
  const scope = Object.freeze({
    projectId: parseProjectId("project-a"),
    projectEpoch,
    docKind: "canvas" as const,
    docId: canvasId,
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
          { createdNodeOrdinal: parseUint32("0"), proof: preparedCurrentResourceProof(textResource) },
          { createdNodeOrdinal: parseUint32("1"), proof: preparedCurrentResourceProof(imageResource) },
        ],
      },
      body: {
        placement: {
          anchor: { x: 80, y: 120 },
          gap: 24,
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
  const snapshot = validatedCanvasSnapshot(document)
  document.destroy()
  const receipt = canvasOperationReceipt(snapshot, operationContext.actorId, operationContext.operationId)
  if (!receipt) throw new Error("Resource fixture receipt is missing")
  const identity = readCanvasCertifiedProjectionIdentity(snapshot)
  if (!identity) throw new Error("Resource fixture projection identity is missing")
  const projected = projectCanvas(snapshot)
  const patch = parseCanvasCertifiedProjectionPatch({
    format: "convax.canvas-certified-projection-patch",
    kind: "resource-append",
    canvasId: identity.canvasId,
    ownerSchemaDigest: identity.ownerSchemaDigest,
    baseStateCommitmentDigest: parseDigest("8".repeat(64)),
    resultStateCommitmentDigest: identity.stateCommitmentDigest,
    receipt,
    nodes: projected.nodes,
    edges: projected.edges,
  })
  let queries = 0
  const query = async <T>(project: (state: OwnerValidatedState<"canvas">) => T): Promise<T> => {
    queries += 1
    return project({ value: snapshot } as OwnerValidatedState<"canvas">)
  }
  const value: MainCollaborationDocumentSession<"canvas"> = {
    scope,
    query,
    submit: async () => {
      throw new Error("unused")
    },
    flush: async () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  }
  return { imageNode, patch, queryCount: () => queries, receipt, textNode, value }
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

function preparedCurrentResourceProof(resource: CanvasResourceRef) {
  return {
    format: "convax.canvas-resource-proof-ref" as const,
    mode: "current-owner-state" as const,
    resource,
    ownerProofDigest: resource.ownerProofDigest,
    requireCurrentLiveVersion: true as const,
  }
}

function preparedCertifiedResult(
  patch: ReturnType<typeof parseCanvasCertifiedProjectionPatch>,
  receipt: BoundedOperationReceipt,
  textNodeId: string,
  imageNodeId: string,
): CanvasCertifiedAddResourcesResult {
  return {
    affectedNodeIds: [textNodeId, imageNodeId],
    changed: true,
    createdNodeIds: [textNodeId, imageNodeId],
    createdResourceNodeIds: [textNodeId, imageNodeId],
    operationReceipt: receipt,
    acceptedFrameDigest: parseDigest("9".repeat(64)),
    projectionDelivery: { status: "certified", patch },
    preparedResources: [
      {
        nodeId: textNodeId,
        state: {
          contentRevision: "text-r1",
          editableText: true,
          status: "ready",
          text: "# Immediately editable",
        },
      },
      { nodeId: imageNodeId, state: { status: "ready", url: "blob:prepared-image" } },
    ],
    warnings: [],
  }
}

function addAgentNode(
  document: Parameters<typeof applyCanvasCandidateIntent>[0],
  scope: Parameters<typeof createCanvasYDoc>[0],
  protocolDigest: ReturnType<typeof parseDigest>,
  seed: number,
  title: string,
) {
  const context: OwnerIntentValidationContext = Object.freeze({
    scope,
    actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(seed))),
    actorSequence: parseUint64(String(seed)),
    operationId: parseId128(encodeBase64url(new Uint8Array(16).fill(seed))),
    lamport: parseUint64(String(seed)),
    intentDigest: parseDigest(seed.toString(16).padStart(2, "0").repeat(32)),
    baseFrontierDigest: parseDigest((seed + 32).toString(16).padStart(2, "0").repeat(32)),
    protocolDigest,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    validationArtifactSetDigest: parseDigest("b".repeat(64)),
  })
  const ordinal = parseUint32("0")
  const node = derivedNodeRef(context, ordinal)
  const result = applyCanvasCandidateIntent(
    document,
    context,
    {
      format: "convax.typed-intent",
      kind: "canvas.agent.create",
      guard: { ordinal, node, expectedAbsent: true },
      body: {
        node: {
          ordinal,
          nodeId: node.id,
          incarnation: node.incarnation,
          role: "agent",
          position: { x: seed, y: seed },
          size: { width: 240, height: 120 },
          data: { format: "convax.canvas-node-data", kind: "agent", title, instructions: null },
          plugin: null,
        },
      },
    },
    {
      validateCurrentResource: () => "valid",
      validatePluginArtifact: () => "valid",
      validatePluginState: () => "valid",
      validateGenerationBegin: () => "valid",
      validateGenerationRecovery: () => "valid",
    },
  )
  if (result === "pending" || result === "rejected") throw new Error(`Fixture node creation ${result}`)
}
