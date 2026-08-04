import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  type ActorIdV2,
  type DigestV2,
  type Id128V2,
  type OwnerIntentConstructionContextV2,
  type OwnerValidatedStateV2,
  type ProjectIdV2,
} from "@convax/collaboration"
import * as Y from "yjs"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  applyProjectIndexCandidateIntentV2,
  createProjectIndexYDocV2,
  projectIndexIntentDigestV2,
  validateProjectIndexYDocV2,
  type ProjectEntryRecordV2,
  type ProjectIndexIntentV2,
} from "../collaboration/project-index"
import { ProjectIndexFileApplicationV2 } from "./project-index-file-application"
import type { ProjectIndexDocumentSessionPortV2 } from "./project-index-application"

const projectId = "project-a" as ProjectIdV2
const projectEpoch = id128(1)
const shardEpoch = id128(2)
const protocolDigest = digest("protocol")
const uriProtocolDigest = digest("uri")
const rootDirectoryId = `pd_${"a".repeat(64)}` as const

describe("ProjectIndexFileApplicationV2", () => {
  test("admits bytes before committing a stable file identity and projects the hash-pinned materialization plan", async () => {
    const document = genesis()
    const order: string[] = []
    const context = constructionContext(actor(1), id128(3), "1")
    const session = applyingSession(document, context, order)
    const application = new ProjectIndexFileApplicationV2({
      session,
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: { async publish({ reference, exactBytes }) {
        order.push("blob")
        expect(reference.blob.digest).toBe(digestBytes(exactBytes))
      } },
      createOperationId: () => context.operationId,
    })

    const result = await application.publishFile({
      projectId,
      path: "notes.md",
      exactBytes: new TextEncoder().encode("hello\n"),
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
  })

  test("reports durable blob admission failure without committing ProjectIndex", async () => {
    const document = genesis()
    const order: string[] = []
    const context = constructionContext(actor(1), id128(4), "1")
    const application = new ProjectIndexFileApplicationV2({
      session: applyingSession(document, context, order),
      facts: { async resolve() { return { status: "resolved", port: {} as never } } },
      blobs: { async publish() { throw new Error("disk full") } },
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
    expect(validateProjectIndexYDocV2(document).entries.size).toBe(1)
  })
})

function applyingSession(document: Y.Doc, context: OwnerIntentConstructionContextV2, order: string[]): ProjectIndexDocumentSessionPortV2 {
  const scope = context.scope as ProjectIndexDocumentSessionPortV2["scope"]
  return {
    scope,
    async query(project) { return project(validated(document)) },
    async submit(input) {
      const prepared = await input.prepare({ base: validated(document), context })
      const intent = prepared.typedIntent as ProjectIndexIntentV2
      const applied = applyProjectIndexCandidateIntentV2(
        document,
        { ...context, intentDigest: projectIndexIntentDigestV2(intent) },
        intent,
        { verifyBlob: () => true, verifyCanvasGenesis: () => true, verifyResetAuthorization: () => true },
      )
      if (applied === "rejected") throw new Error("ProjectIndex test intent rejected")
      order.push("commit")
      return {} as never
    },
  }
}

function validated(document: Y.Doc): OwnerValidatedStateV2<"project-index"> {
  return { owner: "project-index", value: validateProjectIndexYDocV2(document) } as OwnerValidatedStateV2<"project-index">
}

function genesis(): Y.Doc {
  const context = constructionContext(actor(9), id128(9), "0")
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
    createdStamp: { format: "convax.portable-stamp/2", lamport: "0" as never, actorId: context.actorId, operationId: context.operationId, writeOrdinal: "0" as never },
  }
  return createProjectIndexYDocV2({
    format: "convax.project-index-identity/2",
    schema: "convax.project-index.v2",
    projectId,
    projectEpoch,
    shardEpoch,
    rootDirectoryId,
    protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    uriProtocolDigest,
  }, rootEntry)
}

function constructionContext(actorId: ActorIdV2, operationId: Id128V2, lamport: string): OwnerIntentConstructionContextV2 {
  return {
    scope: { projectId, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
    actorId,
    actorSequence: "1" as never,
    operationId,
    lamport: lamport as never,
    baseFrontierDigest: digest("frontier"),
    protocolDigest,
    ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    validationArtifactSetDigest: digest("artifacts"),
  }
}

function id128(byte: number): Id128V2 { return encodeBase64urlV2(Buffer.alloc(16, byte)) as Id128V2 }
function actor(byte: number): ActorIdV2 { return encodeBase64urlV2(Buffer.alloc(32, byte)) as ActorIdV2 }
function digest(seed: string): DigestV2 { return digestBytes(new TextEncoder().encode(seed)) }
function digestBytes(bytes: Readonly<Uint8Array>): DigestV2 { return createHash("sha256").update(new Uint8Array(bytes)).digest("hex") as DigestV2 }
