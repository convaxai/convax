import { describe, expect, test } from "bun:test"
import {
  parseDigestV2,
  type ActorIdV2,
  type DecodedCausalEditFrameV2,
  type Id128V2,
  type OwnerExternalFactPortV2,
  type OwnerIntentConstructionContextV2,
  type OwnerIntentValidationContextV2,
  type OwnerValidatedStateV2,
  type ProjectIdV2,
  type Uint32V2,
} from "@convax/collaboration"
import * as Y from "yjs"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  applyProjectIndexCandidateIntentV2,
  createProjectIndexYDocV2,
  projectIndexIntentDigestV2,
  projectProjectIndexV2,
  validateProjectIndexYDocV2,
  type ProjectEntryRecordV2,
  type ProjectIndexIntentV2,
} from "../collaboration/project-index"
import {
  ProjectIndexCanvasApplicationV2,
  type ProjectIndexDocumentSessionPortV2,
} from "./project-index-application"

const projectId = "project-a" as ProjectIdV2
const projectEpoch = id(1)
const projectShardEpoch = id(2)
const protocolDigest = digest("protocol")
const actorId = actor(3)

describe("ProjectIndexCanvasApplicationV2", () => {
  test("queries blob currentness only through validated ProjectIndex owner state", async () => {
    const fixture = createFixture()
    const application = fixture.application({ stageCanvasGenesis: async () => "rejected" })
    expect(await application.queryCurrentBlobDigests({ projectId })).toEqual(new Set())
    await expect(application.queryCurrentBlobDigests({ projectId: "project-other" as ProjectIdV2 })).rejects.toThrow("another Project")
  })

  test("creates only after stage frame and Canvas genesis are durable", async () => {
    const fixture = createFixture()
    let observedStaged = false
    const application = fixture.application({
      async stageCanvasGenesis(input) {
        const routes = projectProjectIndexV2(fixture.document).canvasRoutes
        observedStaged = routes.length === 1 && routes[0]?.state === "staged"
        expect(input.predecessor.frame.frameDigest).toBe(digest("frame-1"))
        expect(input.predecessor.acceptedFrontierDigest).toBe(digest("frontier-1"))
        return {
          predecessorFrameDigest: input.predecessor.frame.frameDigest,
          stagedProjectIndexFrontierDigest: input.predecessor.acceptedFrontierDigest,
          checkpointObjectDigest: digest("canvas-G"),
        }
      },
    })

    const result = await application.submitRouteCommand({
      projectId,
      command: { format: "convax.project-canvas-route-command/2", kind: "project.canvas.route.create/2", title: "Team Canvas" },
    })
    expect(observedStaged).toBe(true)
    expect(result.status).toBe("committed")
    if (result.status !== "committed") throw new Error("create rejected")
    expect(result.catalog.visibleCanvases).toHaveLength(1)
    expect(result.catalog.visibleCanvases[0]).toMatchObject({
      canvasId: result.canvasId,
      state: "live",
      title: "Team Canvas",
    })
    expect(fixture.submittedKinds).toEqual([
      "project.canvas.route.stage/2",
      "project.canvas.route.activate/2",
    ])
  })

  test("leaves a staged route invisible when genesis is pending", async () => {
    const fixture = createFixture()
    const application = fixture.application({ stageCanvasGenesis: async () => "pending" })
    const result = await application.submitRouteCommand({
      projectId,
      command: { format: "convax.project-canvas-route-command/2", kind: "project.canvas.route.create/2", title: "Pending" },
    })
    expect(result).toEqual({ status: "rejected", code: "dependency-pending" })
    const catalog = await application.queryCatalog({ projectId })
    expect(catalog.routes).toHaveLength(1)
    expect(catalog.routes[0]?.state).toBe("staged")
    expect(catalog.visibleCanvases).toEqual([])
    expect(fixture.submittedKinds).toEqual(["project.canvas.route.stage/2"])
  })

  test("does not write a staged route when Canvas author preflight is pending", async () => {
    const fixture = createFixture()
    let stagingCalled = false
    const application = fixture.application({
      preflightCanvasGenesis: async () => "pending",
      async stageCanvasGenesis() {
        stagingCalled = true
        return "pending"
      },
    })
    const result = await application.submitRouteCommand({
      projectId,
      command: {
        format: "convax.project-canvas-route-command/2",
        kind: "project.canvas.route.create/2",
        title: "No unteamed authority",
      },
    })
    expect(result).toEqual({ status: "rejected", code: "dependency-pending" })
    expect(stagingCalled).toBe(false)
    expect(fixture.submittedKinds).toEqual([])
    expect(projectProjectIndexV2(fixture.document).canvasRoutes).toEqual([])
  })

  test("cancellation after durable genesis does not falsely activate the staged route", async () => {
    const fixture = createFixture()
    const abort = new AbortController()
    const application = fixture.application({
      async stageCanvasGenesis(input) {
        abort.abort()
        return {
          predecessorFrameDigest: input.predecessor.frame.frameDigest,
          stagedProjectIndexFrontierDigest: input.predecessor.acceptedFrontierDigest,
          checkpointObjectDigest: digest("cancelled-G"),
        }
      },
    })
    const result = await application.submitRouteCommand({
      projectId,
      signal: abort.signal,
      command: { format: "convax.project-canvas-route-command/2", kind: "project.canvas.route.create/2", title: "Cancelled" },
    })
    expect(result).toEqual({ status: "rejected", code: "cancelled" })
    expect((await application.queryCatalog({ projectId })).routes[0]?.state).toBe("staged")
  })

  test("renames and tombstones through the same ProjectIndex intent path", async () => {
    const fixture = createFixture()
    const application = fixture.application({
      async stageCanvasGenesis(input) {
        return {
          predecessorFrameDigest: input.predecessor.frame.frameDigest,
          stagedProjectIndexFrontierDigest: input.predecessor.acceptedFrontierDigest,
          checkpointObjectDigest: digest("rename-G"),
        }
      },
    })
    const created = await application.submitRouteCommand({
      projectId,
      command: { format: "convax.project-canvas-route-command/2", kind: "project.canvas.route.create/2", title: "Before" },
    })
    if (created.status !== "committed") throw new Error("create rejected")
    const renamed = await application.submitRouteCommand({
      projectId,
      command: {
        format: "convax.project-canvas-route-command/2",
        kind: "project.canvas.route.rename/2",
        canvasId: created.canvasId,
        title: "After",
      },
    })
    expect(renamed.status).toBe("committed")
    if (renamed.status !== "committed") throw new Error("rename rejected")
    expect(renamed.catalog.visibleCanvases[0]?.title).toBe("After")
    const tombstoned = await application.submitRouteCommand({
      projectId,
      command: {
        format: "convax.project-canvas-route-command/2",
        kind: "project.canvas.route.tombstone/2",
        canvasId: created.canvasId,
      },
    })
    expect(tombstoned.status).toBe("committed")
    if (tombstoned.status !== "committed") throw new Error("tombstone rejected")
    expect(tombstoned.catalog.visibleCanvases).toEqual([])
    expect(tombstoned.catalog.routes[0]?.state).toBe("tombstoned")
  })
})

function createFixture() {
  const document = genesis()
  const submittedKinds: string[] = []
  let submission = 0
  let operation = 10
  const externalFacts = {
    resolveFact: () => ({ status: "rejected" as const }),
  } as unknown as OwnerExternalFactPortV2<"project-index">
  const session: ProjectIndexDocumentSessionPortV2 = {
    scope: {
      projectId,
      projectEpoch,
      docKind: "project-index",
      docId: "project-index",
      shardEpoch: projectShardEpoch,
    },
    async query(project) {
      return project({ owner: "project-index", value: validateProjectIndexYDocV2(document) } as OwnerValidatedStateV2<"project-index">)
    },
    async submit(input) {
      submission += 1
      const context = constructionContext(input.operationId ?? id(200 + submission), String(submission))
      const prepared = await input.prepare({
        base: { owner: "project-index", value: validateProjectIndexYDocV2(document) } as OwnerValidatedStateV2<"project-index">,
        context,
        signal: input.signal,
      })
      const typedIntent = prepared.typedIntent as ProjectIndexIntentV2
      submittedKinds.push(typedIntent.kind)
      const validationContext: OwnerIntentValidationContextV2 = {
        ...context,
        intentDigest: projectIndexIntentDigestV2(typedIntent),
      }
      const applied = applyProjectIndexCandidateIntentV2(document, validationContext, typedIntent, {
        verifyBlob: () => true,
        verifyCanvasGenesis: () => true,
        verifyResetAuthorization: () => true,
      })
      if (applied === "rejected") throw new Error("fake ProjectIndex session rejected intent")
      const frameDigest = digest(`frame-${submission}`)
      return {
        status: "saved-locally",
        acceptedFrontierDigest: digest(`frontier-${submission}`),
        frame: {
          frameDigest,
          header: { core: { scope: session.scope, operationId: context.operationId } },
        } as unknown as DecodedCausalEditFrameV2,
      }
    },
  }
  return {
    document,
    submittedKinds,
    application(genesis: Pick<
      ConstructorParameters<typeof ProjectIndexCanvasApplicationV2>[0]["genesis"],
      "stageCanvasGenesis"
    > & Partial<ConstructorParameters<typeof ProjectIndexCanvasApplicationV2>[0]["genesis"]>) {
      return new ProjectIndexCanvasApplicationV2({
        session,
        genesis: {
          preflightCanvasGenesis: async () => "ready",
          ...genesis,
        },
        facts: { resolve: async () => ({ status: "resolved", port: externalFacts }) },
        createOperationId: () => id(operation++),
        createShardEpoch: () => id(operation++),
      })
    },
  }
}

function genesis(): Y.Doc {
  const context = constructionContext(id(1), "0")
  const rootDirectoryId = `pd_${"a".repeat(64)}` as const
  const rootEntry: ProjectEntryRecordV2 = {
    format: "convax.project-entry/2",
    entryId: rootDirectoryId,
    kind: "directory",
    storageClass: null,
    contentPolicy: "none",
    provenance: "project-root",
    conflictSource: null,
    createdByActorId: context.actorId,
    createdByOperationId: context.operationId,
    createdStamp: {
      format: "convax.portable-stamp/2",
      lamport: context.lamport,
      actorId: context.actorId,
      operationId: context.operationId,
      writeOrdinal: "0" as Uint32V2,
    },
  }
  return createProjectIndexYDocV2({
    format: "convax.project-index-identity/2",
    schema: "convax.project-index.v2",
    projectId,
    projectEpoch,
    shardEpoch: projectShardEpoch,
    rootDirectoryId,
    protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    uriProtocolDigest: digest("uri"),
  }, rootEntry)
}

function constructionContext(operationId: Id128V2, lamport: string): OwnerIntentConstructionContextV2 {
  return {
    scope: { projectId, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch: projectShardEpoch },
    actorId,
    actorSequence: "1" as never,
    operationId,
    lamport: lamport as never,
    baseFrontierDigest: digest("base"),
    protocolDigest,
    ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    validationArtifactSetDigest: digest("artifacts"),
  }
}

function id(byte: number): Id128V2 {
  return Buffer.alloc(16, byte).toString("base64url") as Id128V2
}

function actor(byte: number): ActorIdV2 {
  return Buffer.alloc(32, byte).toString("base64url") as ActorIdV2
}

function digest(seed: string) {
  return parseDigestV2(Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64))
}
