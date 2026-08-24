import { describe, expect, test } from "bun:test"
import {
  parseDigest,
  type ActorId,
  type DecodedCausalEditFrame,
  type Id128,
  type OwnerExternalFactPort,
  type OwnerIntentConstructionContext,
  type OwnerIntentValidationContext,
  type OwnerValidatedState,
  type ProjectId,
  type Uint32,
} from "@convax/collaboration"
import * as Y from "yjs"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  applyProjectIndexCandidateIntent,
  createProjectIndexYDoc,
  projectIndexIntentDigest,
  projectProjectIndex,
  validateProjectIndexYDoc,
  type ProjectEntryRecord,
  type ProjectIndexIntent,
} from "../collaboration/project-index"
import {
  ProjectIndexCanvasApplication,
  type ProjectIndexDocumentSessionPort,
} from "./project-index-application"

const projectId = "project-a" as ProjectId
const projectEpoch = id(1)
const projectShardEpoch = id(2)
const protocolDigest = digest("protocol")
const actorId = actor(3)

describe("ProjectIndexCanvasApplication", () => {
  test("queries blob currentness only through validated ProjectIndex owner state", async () => {
    const fixture = createFixture()
    const application = fixture.application({ stageCanvasGenesis: async () => "rejected" })
    expect(await application.queryCurrentBlobDigests({ projectId })).toEqual(new Set())
    await expect(application.queryCurrentBlobDigests({ projectId: "project-other" as ProjectId })).rejects.toThrow("another Project")
  })

  test("creates only after stage frame and Canvas genesis are durable", async () => {
    const fixture = createFixture()
    let observedStaged = false
    const application = fixture.application({
      async stageCanvasGenesis(input) {
        const routes = projectProjectIndex(fixture.document).canvasRoutes
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
      command: { format: "convax.project-canvas-route-command", kind: "project.canvas.route.create", title: "Team Canvas" },
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
      "project.canvas.route.stage",
      "project.canvas.route.activate",
    ])
  })

  test("leaves a staged route invisible when genesis is pending", async () => {
    const fixture = createFixture()
    const application = fixture.application({ stageCanvasGenesis: async () => "pending" })
    const result = await application.submitRouteCommand({
      projectId,
      command: { format: "convax.project-canvas-route-command", kind: "project.canvas.route.create", title: "Pending" },
    })
    expect(result).toEqual({ status: "rejected", code: "dependency-pending" })
    const catalog = await application.queryCatalog({ projectId })
    expect(catalog.routes).toHaveLength(1)
    expect(catalog.routes[0]?.state).toBe("staged")
    expect(catalog.visibleCanvases).toEqual([])
    expect(fixture.submittedKinds).toEqual(["project.canvas.route.stage"])
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
        format: "convax.project-canvas-route-command",
        kind: "project.canvas.route.create",
        title: "No unteamed authority",
      },
    })
    expect(result).toEqual({ status: "rejected", code: "dependency-pending" })
    expect(stagingCalled).toBe(false)
    expect(fixture.submittedKinds).toEqual([])
    expect(projectProjectIndex(fixture.document).canvasRoutes).toEqual([])
    expect((await application.queryCatalog({ projectId })).creationAvailability).toBe("local-authority-unavailable")
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
      command: { format: "convax.project-canvas-route-command", kind: "project.canvas.route.create", title: "Cancelled" },
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
      command: { format: "convax.project-canvas-route-command", kind: "project.canvas.route.create", title: "Before" },
    })
    if (created.status !== "committed") throw new Error("create rejected")
    const renamed = await application.submitRouteCommand({
      projectId,
      command: {
        format: "convax.project-canvas-route-command",
        kind: "project.canvas.route.rename",
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
        format: "convax.project-canvas-route-command",
        kind: "project.canvas.route.tombstone",
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
  let latestFrame: DecodedCausalEditFrame | undefined
  const externalFacts = {
    resolveFact: () => ({ status: "rejected" as const }),
  } as unknown as OwnerExternalFactPort<"project-index">
  const session: ProjectIndexDocumentSessionPort = {
    scope: {
      projectId,
      projectEpoch,
      docKind: "project-index",
      docId: "project-index",
      shardEpoch: projectShardEpoch,
    },
    async query(project) {
      return project({ owner: "project-index", value: validateProjectIndexYDoc(document) } as OwnerValidatedState<"project-index">)
    },
    async submit(input) {
      submission += 1
      const context = constructionContext(input.operationId ?? id(200 + submission), String(submission))
      const prepared = await input.prepare({
        base: { owner: "project-index", value: validateProjectIndexYDoc(document) } as OwnerValidatedState<"project-index">,
        context,
        signal: input.signal,
      })
      const typedIntent = prepared.typedIntent as ProjectIndexIntent
      submittedKinds.push(typedIntent.kind)
      const validationContext: OwnerIntentValidationContext = {
        ...context,
        intentDigest: projectIndexIntentDigest(typedIntent),
      }
      const applied = applyProjectIndexCandidateIntent(document, validationContext, typedIntent, {
        verifyBlob: () => true,
        verifyCanvasGenesis: () => true,
        verifyResetAuthorization: () => true,
      })
      if (applied === "rejected") throw new Error("fake ProjectIndex session rejected intent")
      const frameDigest = digest(`frame-${submission}`)
      const frame = {
        frameDigest,
        header: { format: "convax.causal-edit-frame", core: { scope: session.scope, operationId: context.operationId } },
      } as unknown as DecodedCausalEditFrame
      latestFrame = frame
      return {
        status: "saved-locally" as const,
        acceptedFrontierDigest: digest(`frontier-${submission}`),
        frame,
      }
    },
  }
  return {
    document,
    submittedKinds,
    lastFrame: () => latestFrame,
    application(genesis: Pick<
      ConstructorParameters<typeof ProjectIndexCanvasApplication>[0]["genesis"],
      "stageCanvasGenesis"
    > & Partial<ConstructorParameters<typeof ProjectIndexCanvasApplication>[0]["genesis"]>) {
      return new ProjectIndexCanvasApplication({
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
  const rootEntry: ProjectEntryRecord = {
    format: "convax.project-entry",
    entryId: rootDirectoryId,
    kind: "directory",
    storageClass: null,
    contentPolicy: "none",
    provenance: "project-root",
    conflictSource: null,
    createdByActorId: context.actorId,
    createdByOperationId: context.operationId,
    createdStamp: {
      format: "convax.portable-stamp",
      lamport: context.lamport,
      actorId: context.actorId,
      operationId: context.operationId,
      writeOrdinal: "0" as Uint32,
    },
  }
  return createProjectIndexYDoc({
    format: "convax.project-index-identity",
    schema: "convax.project-index.v2",
    projectId,
    projectEpoch,
    shardEpoch: projectShardEpoch,
    rootDirectoryId,
    protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    uriProtocolDigest: digest("uri"),
    migrationImportBaseProofDigest: null,
  }, rootEntry)
}

function constructionContext(operationId: Id128, lamport: string): OwnerIntentConstructionContext {
  return {
    scope: { projectId, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch: projectShardEpoch },
    actorId,
    actorSequence: "1" as never,
    operationId,
    lamport: lamport as never,
    baseFrontierDigest: digest("base"),
    protocolDigest,
    ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    validationArtifactSetDigest: digest("artifacts"),
  }
}

function id(byte: number): Id128 {
  return Buffer.alloc(16, byte).toString("base64url") as Id128
}

function actor(byte: number): ActorId {
  return Buffer.alloc(32, byte).toString("base64url") as ActorId
}

function digest(seed: string) {
  return parseDigest(Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64))
}
