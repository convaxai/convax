import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  type ActorId,
  type Digest,
  type Id128,
  type OwnerIntentConstructionContext,
  type OwnerValidatedState,
  type ProjectId,
} from "@convax/collaboration"
import * as Y from "yjs"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  applyProjectIndexCandidateIntent,
  constructProjectFileCreateIntent,
  createProjectIndexYDoc,
  decodeProjectIndexBlobPublicationCurrentnessRequest,
  projectIndexIntentDigest,
  projectIndexIntentDependencies,
  validateProjectIndexYDoc,
  type ProjectEntryRecord,
  type ProjectIndexIntent,
} from "../collaboration/project-index"
import { ProjectIndexFileApplication } from "./project-index-file-application"
import { ProjectIndexCanvasApplication, type ProjectIndexDocumentSessionPort } from "./project-index-application"

const projectId = "project-a" as ProjectId
const projectEpoch = id128(1)
const shardEpoch = id128(2)
const protocolDigest = digest("protocol")
const uriProtocolDigest = digest("uri")
const rootDirectoryId = `pd_${"a".repeat(64)}` as const

describe("ProjectIndexFileApplication", () => {
  test("keeps blob fact request identity stable when the frame carries a different wire intent digest", () => {
    const context = constructionContext(actor(1), id128(10), "1")
    const snapshot = validateProjectIndexYDoc(genesis())
    const blob = {
      format: "convax.blob-ref" as const,
      algorithm: "sha256" as const,
      digest: digest("blob"),
      byteLength: "5" as never,
      mime: "text/markdown",
    }
    const constructed = constructProjectFileCreateIntent({
      snapshot,
      context,
      parentDirectoryId: rootDirectoryId,
      basename: "notes.md",
      blob,
      contentPolicy: "conflict-preserving-text",
      storageClass: "project-file",
      provenance: "user",
    })
    if (constructed === "rejected") throw new Error("ProjectIndex file intent construction rejected")

    const dependencies = projectIndexIntentDependencies(
      { ...context, intentDigest: digest("other-wire-intent") },
      constructed.intent,
    )
    const requirement = dependencies.externalFacts[0]
    expect(requirement).toBeDefined()
    const request = decodeProjectIndexBlobPublicationCurrentnessRequest(requirement!.request.exactJcs)
    expect(request).not.toBe("rejected")
    expect(request === "rejected" ? null : request.intentDigest).toBe(projectIndexIntentDigest(constructed.intent))
  })

  test("admits bytes before committing a stable file identity and projects the hash-pinned materialization plan", async () => {
    const document = genesis()
    const order: string[] = []
    const sourceBytes = new TextEncoder().encode("hello\n")
    const context = constructionContext(actor(1), id128(3), "1")
    const session = applyingSession(document, context, order)
    const application = new ProjectIndexFileApplication({
      session,
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: {
        async admitManaged() { throw new Error("not used") },
        async publish({ reference, exactBytes }) {
          order.push("blob")
          expect(exactBytes).not.toBe(sourceBytes)
          expect(reference.blob.digest).toBe(digestBytes(exactBytes))
        },
      },
      createOperationId: () => context.operationId,
    })

    const result = await application.publishFile({
      projectId,
      path: "notes.md",
      exactBytes: sourceBytes,
      mime: "text/markdown",
      contentPolicy: "conflict-preserving-text",
    })
    expect(result.status).toBe("committed")
    expect(result.status === "committed" ? result.entryId.startsWith("pf_") : false).toBeTrue()
    expect(order).toEqual(["blob", "commit"])

    const plan = await application.queryFileMaterializationPlan({ projectId })
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({
      entryId: result.status === "committed" ? result.entryId : "",
      kind: "file",
      path: "notes.md",
    })
    expect(plan.entries[0]?.reference?.blob.digest).toBe(digestBytes(new TextEncoder().encode("hello\n")))
    const currentResources = await new ProjectIndexCanvasApplication({
      session,
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      genesis: {
        async preflightCanvasGenesis() { return "pending" },
        async stageCanvasGenesis() { return "pending" },
      },
      createOperationId: () => id128(8),
      createShardEpoch: () => id128(9),
    }).queryCurrentResources({ projectId })
    expect(currentResources).toEqual([
      expect.objectContaining({
        materializedPath: "notes.md",
        reference: expect.objectContaining({ entryFileId: result.status === "committed" ? result.entryId : "" }),
        storageClass: "project-file",
      }),
    ])
  })

  test("reuses a verified digest and exact byte view without the compatibility copy-and-hash path", async () => {
    const document = genesis()
    const order: string[] = []
    const context = constructionContext(actor(1), id128(40), "1")
    const exactBytes = Buffer.allocUnsafe(64 * 1024 * 1024)
    const exactDigest = digest("stable-reader-verified")
    const application = new ProjectIndexFileApplication({
      session: applyingSession(document, context, order),
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: {
        async admitManaged() { throw new Error("not used") },
        async publish(input) {
          expect(input.exactBytes).toBe(exactBytes)
          expect(input.reference.blob.digest).toBe(exactDigest)
          order.push("blob")
        },
      },
      createOperationId: () => context.operationId,
    })

    const result = await application.publishFile({
      projectId,
      path: "large-video.mp4",
      exactBytes,
      exactDigest,
      mime: "video/mp4",
      contentPolicy: "overwritable-binary",
    })

    expect(result).toMatchObject({ status: "committed", reference: { blob: { digest: exactDigest } } })
    expect(order).toEqual(["blob", "commit"])
  })

  test("rejects malformed verified digests and leaves valid mismatches to the durable blob verifier", async () => {
    const document = genesis()
    const order: string[] = []
    const context = constructionContext(actor(1), id128(41), "1")
    let publications = 0
    const application = new ProjectIndexFileApplication({
      session: applyingSession(document, context, order),
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: {
        async admitManaged() { throw new Error("not used") },
        async publish({ reference, exactBytes }) {
          publications += 1
          if (reference.blob.digest !== digestBytes(exactBytes)) throw new Error("digest mismatch")
        },
      },
      createOperationId: () => context.operationId,
    })
    const exactBytes = new TextEncoder().encode("actual bytes")

    await expect(
      application.publishFile({
        projectId,
        path: "invalid.bin",
        exactBytes,
        exactDigest: "INVALID" as Digest,
        mime: "application/octet-stream",
        contentPolicy: "overwritable-binary",
      }),
    ).rejects.toThrow("Digest")
    expect(publications).toBe(0)

    expect(
      await application.publishFile({
        projectId,
        path: "mismatch.bin",
        exactBytes,
        exactDigest: digest("different bytes"),
        mime: "application/octet-stream",
        contentPolicy: "overwritable-binary",
      }),
    ).toEqual({ status: "partial-success", code: "blob-publication-failed" })
    expect(publications).toBe(1)
    expect(order).toEqual([])
  })

  test("resolves a nested path through the current path-claim winner", async () => {
    const document = genesis()
    const application = (context: OwnerIntentConstructionContext) => new ProjectIndexFileApplication({
      session: applyingSession(document, context, []),
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: {
        async admitManaged() { throw new Error("not used") },
        async publish() {},
      },
      createOperationId: () => context.operationId,
    })
    const first = await application(constructionContext(actor(1), id128(30), "1"))
      .createDirectory({ projectId, path: "Notes" })
    const winner = await application(constructionContext(actor(1), id128(31), "2"))
      .createDirectory({ projectId, path: "Notes" })
    const file = await application(constructionContext(actor(1), id128(32), "3"))
      .publishFile({
        projectId,
        path: "Notes/nested.md",
        exactBytes: new TextEncoder().encode("nested\n"),
        mime: "text/markdown",
        contentPolicy: "conflict-preserving-text",
      })

    expect(first.status).toBe("committed")
    expect(winner.status).toBe("committed")
    expect(file.status).toBe("committed")
    if (winner.status !== "committed" || file.status !== "committed") throw new Error("nested path setup failed")
    const snapshot = validateProjectIndexYDoc(document)
    const selected = [...snapshot.entryLocations.values()]
      .filter((claim) => claim.entryId === file.entryId)
      .at(-1)
    expect(String(selected?.parentDirectoryId)).toBe(String(winner.entryId))
    const plan = await application(constructionContext(actor(1), id128(33), "4"))
      .queryFileMaterializationPlan({ projectId })
    expect(plan.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ entryId: winner.entryId, path: "Notes" }),
      expect.objectContaining({ entryId: file.entryId, path: "Notes/nested.md" }),
      expect.objectContaining({
        entryId: first.status === "committed" ? first.entryId : "",
        path: first.status === "committed"
          ? `.convax-conflicts/path-claims/${first.entryId}/content`
          : "",
      }),
    ]))
  })

  test("reports durable blob admission failure without committing ProjectIndex", async () => {
    const document = genesis()
    const order: string[] = []
    const context = constructionContext(actor(1), id128(4), "1")
    const application = new ProjectIndexFileApplication({
      session: applyingSession(document, context, order),
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: {
        async admitManaged() { throw new Error("not used") },
        async publish() { throw new Error("disk full") },
      },
      createOperationId: () => context.operationId,
    })
    expect(await application.publishFile({
      projectId,
      path: "notes.md",
      exactBytes: new TextEncoder().encode("hello\n"),
      mime: "text/markdown",
      contentPolicy: "conflict-preserving-text",
    })).toEqual({ status: "partial-success", code: "blob-publication-failed" })
    expect(order).toEqual([])
    expect(validateProjectIndexYDoc(document).entries.size).toBe(1)
  })

  test("streams a managed admission before creating one immutable unlocated identity and re-admits existing bytes", async () => {
    const document = genesis()
    const order: string[] = []
    const context = constructionContext(actor(1), id128(5), "1")
    const bytes = new TextEncoder().encode("managed-media")
    const blob = {
      format: "convax.blob-ref" as const,
      algorithm: "sha256" as const,
      digest: digestBytes(bytes),
      byteLength: String(bytes.byteLength) as never,
      mime: "video/mp4",
    }
    let admissions = 0
    const application = new ProjectIndexFileApplication({
      session: applyingSession(document, context, order),
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: {
        async admitManaged({ reference, admission }) {
          admissions += 1
          const received: number[] = []
          await admission.readChunks(async (chunk) => { received.push(...chunk) })
          expect(received).toEqual([...bytes])
          expect(reference.blob).toEqual(blob)
          order.push("managed-blob")
        },
        async publish() { throw new Error("not used") },
      },
      createOperationId: () => context.operationId,
    })
    const admission = () => ({
      blob,
      async readChunks(consume: (chunk: Readonly<Uint8Array>) => Promise<void>) {
        await consume(bytes.subarray(0, 3))
        await consume(bytes.subarray(3))
      },
    })

    const first = await application.admitManagedBlob({ projectId, admission: admission() })
    const second = await application.admitManagedBlob({ projectId, admission: admission() })

    expect(first).toMatchObject({ status: "committed", reference: { blob } })
    expect(second).toEqual(first)
    expect(admissions).toBe(2)
    expect(order).toEqual(["managed-blob", "commit", "managed-blob"])
    const snapshot = validateProjectIndexYDoc(document)
    const managed = [...snapshot.entries.values()].filter((entry) => entry.storageClass === "managed-blob")
    expect(managed).toHaveLength(1)
    expect(managed[0]).toMatchObject({
      contentPolicy: "immutable",
      provenance: "managed-admission",
      storageClass: "managed-blob",
    })
    const projection = new ProjectIndexCanvasApplication({
      session: applyingSession(document, context, []),
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      genesis: {
        async preflightCanvasGenesis() { return "pending" },
        async stageCanvasGenesis() { return "pending" },
      },
      createOperationId: () => id128(6),
      createShardEpoch: () => id128(7),
    })
    expect(await projection.queryCurrentResources({ projectId })).toEqual([
      expect.objectContaining({
        materializedPath: null,
        reference: first.status === "committed" ? first.reference : null,
        storageClass: "managed-blob",
      }),
    ])
  })
})

function applyingSession(document: Y.Doc, context: OwnerIntentConstructionContext, order: string[]): ProjectIndexDocumentSessionPort {
  const scope = context.scope as ProjectIndexDocumentSessionPort["scope"]
  return {
    scope,
    async query(project) { return project(validated(document)) },
    async submit(input) {
      const prepared = await input.prepare({ base: validated(document), context })
      const intent = prepared.typedIntent as ProjectIndexIntent
      const applied = applyProjectIndexCandidateIntent(
        document,
        { ...context, intentDigest: projectIndexIntentDigest(intent) },
        intent,
        { verifyBlob: () => true, verifyCanvasGenesis: () => true, verifyResetAuthorization: () => true },
      )
      if (applied === "rejected") throw new Error("ProjectIndex test intent rejected")
      order.push("commit")
      return {} as never
    },
  }
}

function validated(document: Y.Doc): OwnerValidatedState<"project-index"> {
  return { owner: "project-index", value: validateProjectIndexYDoc(document) } as OwnerValidatedState<"project-index">
}

function genesis(): Y.Doc {
  const context = constructionContext(actor(9), id128(9), "0")
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
    createdStamp: { format: "convax.portable-stamp", lamport: "0" as never, actorId: context.actorId, operationId: context.operationId, writeOrdinal: "0" as never },
  }
  return createProjectIndexYDoc({
    format: "convax.project-index-identity",
    schema: "convax.project-index.v2",
    projectId,
    projectEpoch,
    shardEpoch,
    rootDirectoryId,
    protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    uriProtocolDigest,
  }, rootEntry)
}

function constructionContext(actorId: ActorId, operationId: Id128, lamport: string): OwnerIntentConstructionContext {
  return {
    scope: { projectId, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
    actorId,
    actorSequence: "1" as never,
    operationId,
    lamport: lamport as never,
    baseFrontierDigest: digest("frontier"),
    protocolDigest,
    ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    validationArtifactSetDigest: digest("artifacts"),
  }
}

function id128(byte: number): Id128 { return encodeBase64url(Buffer.alloc(16, byte)) as Id128 }
function actor(byte: number): ActorId { return encodeBase64url(Buffer.alloc(32, byte)) as ActorId }
function digest(seed: string): Digest { return digestBytes(new TextEncoder().encode(seed)) }
function digestBytes(bytes: Readonly<Uint8Array>): Digest { return createHash("sha256").update(new Uint8Array(bytes)).digest("hex") as Digest }
