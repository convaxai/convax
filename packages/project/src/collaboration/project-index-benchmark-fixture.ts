import {
  encodeBase64url,
  encodeFullUpdate,
  parseActorId,
  parseDigest,
  parseId128,
  parseProjectId,
  parseUint32,
  parseUint64,
  type OwnerIntentConstructionContext,
} from "@convax/collaboration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  PROJECT_INDEX_ROOT_NAME,
  constructProjectFileCreateIntent,
  createProjectIndexYDoc,
  projectIndexIntentDigest,
  validateProjectIndexYDoc,
  type ProjectEntryRecord,
  type ProjectOperationReceipt,
  type ProjectIndexSnapshot,
} from "./project-index"
import * as Y from "yjs"

const actorId = parseActorId(encodeBase64url(new Uint8Array(32).fill(7)))
const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
const shardEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(2)))
const projectId = parseProjectId("benchmark-project")
const protocolDigest = parseDigest("1".repeat(64))
const uriProtocolDigest = parseDigest("2".repeat(64))
const rootDirectoryId = `pd_${"a".repeat(64)}` as const

/** Fixed-state ProjectIndex fixture for the real benchmark runner. */
export function createProjectIndexBenchmarkFixture(resourceCount: number): {
  readonly document: Y.Doc
  readonly fullUpdate: Uint8Array
  readonly ownerResourceCount: number
} {
  return populateProjectIndexBenchmarkFixture(genesis(), resourceCount)
}

/** Populates a benchmark-only cardinality base, then proves it with the production validator. */
export function populateProjectIndexBenchmarkFixture(
  document: Y.Doc,
  resourceCount: number,
): {
  readonly document: Y.Doc
  readonly fullUpdate: Uint8Array
  readonly ownerResourceCount: number
} {
  if (!Number.isSafeInteger(resourceCount) || resourceCount < 0 || resourceCount > 4096) {
    throw new TypeError("ProjectIndex benchmark fixture resource count must be a safe integer from 0 through 4096")
  }
  const emptySnapshot = validateProjectIndexYDoc(document)
  const inserted = Array.from({ length: resourceCount }, (_, index) => resourceRecords(emptySnapshot, index)).flat()
  document.transact(() => {
    const root = document.getMap(PROJECT_INDEX_ROOT_NAME)
    for (const item of inserted) {
      const facts = root.get(item.root)
      if (!(facts instanceof Y.Map) || facts.has(item.key)) {
        throw new Error("benchmark ProjectIndex bulk fixture contains an invalid or duplicate fact")
      }
      facts.set(item.key, item.record)
    }
  }, "project-index-benchmark-fixture")
  const snapshot = validateProjectIndexYDoc(document)
  return Object.freeze({
    document,
    fullUpdate: encodeFullUpdate(document),
    ownerResourceCount: snapshot.entries.size - 1,
  })
}

function genesis(): Y.Doc {
  const rootEntry: ProjectEntryRecord = {
    format: "convax.project-entry",
    entryId: rootDirectoryId,
    kind: "directory",
    storageClass: null,
    contentPolicy: "none",
    provenance: "project-root",
    conflictSource: null,
    createdByActorId: actorId,
    createdByOperationId: id(0),
    createdStamp: {
      format: "convax.portable-stamp",
      lamport: parseUint64("0"),
      actorId,
      operationId: id(0),
      writeOrdinal: parseUint32("0"),
    },
  }
  return createProjectIndexYDoc(
    {
      format: "convax.project-index-identity",
      schema: "convax.project-index.v2",
      projectId,
      projectEpoch,
      shardEpoch,
      rootDirectoryId,
      protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest,
      migrationImportBaseProofDigest: null,
    },
    rootEntry,
  )
}

function resourceRecords(snapshot: ProjectIndexSnapshot, index: number) {
  const identity = snapshot.identity
  const scope: OwnerIntentConstructionContext["scope"] = Object.freeze({
    projectId: identity.projectId,
    projectEpoch: identity.projectEpoch,
    docKind: "project-index",
    docId: "project-index",
    shardEpoch: identity.shardEpoch,
  })
  const context: OwnerIntentConstructionContext = Object.freeze({
    scope,
    actorId,
    actorSequence: parseUint64(String(index + 1)),
    operationId: id(index + 1),
    lamport: parseUint64(String(index + 1)),
    baseFrontierDigest: parseDigest("3".repeat(64)),
    protocolDigest: identity.protocolDigest,
    ownerSchemaDigest: identity.schemaDigest,
    validationArtifactSetDigest: parseDigest("4".repeat(64)),
  })
  const constructed = constructProjectFileCreateIntent({
    snapshot,
    context,
    parentDirectoryId: identity.rootDirectoryId,
    basename: `resource-${index}.md`,
    blob: {
      format: "convax.blob-ref",
      algorithm: "sha256",
      digest: parseDigest(index.toString(16).padStart(64, "0")),
      byteLength: parseUint64("1"),
      mime: "text/markdown",
    },
    contentPolicy: "conflict-preserving-text",
    storageClass: "project-file",
    provenance: "user",
  })
  if (constructed === "rejected") throw new Error("benchmark ProjectIndex resource construction rejected")
  if (constructed.intent.kind !== "project.file.create")
    throw new Error("benchmark ProjectIndex constructor returned another intent")
  const { entry, location, initialVersion } = constructed.intent.body
  if (location === null) throw new Error("benchmark ProjectIndex file must be located")
  const intentDigest = projectIndexIntentDigest(constructed.intent)
  const receipt: ProjectOperationReceipt = Object.freeze({
    format: "convax.project-operation-receipt",
    actorId: context.actorId,
    operationId: context.operationId,
    intentKind: constructed.intent.kind,
    intentDigest,
    allocatedIds: Object.freeze([entry.entryId, location.claimId, initialVersion.versionId].sort()),
    firstWriteOrdinal: parseUint32("0"),
    writeCount: parseUint32("4"),
    stampLamport: context.lamport,
  })
  return Object.freeze([
    Object.freeze({ root: "entries" as const, key: entry.entryId, record: entry }),
    Object.freeze({
      root: "entryLocations" as const,
      key: `l:${location.entryId}:${location.claimId}`,
      record: location,
    }),
    Object.freeze({
      root: "contentFamilies" as const,
      key: `v:${initialVersion.primaryFileId}:${initialVersion.versionId}`,
      record: initialVersion,
    }),
    Object.freeze({ root: "operations" as const, key: `o:${context.actorId}:${context.operationId}`, record: receipt }),
  ])
}

function id(seed: number) {
  const bytes = new Uint8Array(16)
  new DataView(bytes.buffer).setUint32(12, seed)
  return parseId128(encodeBase64url(bytes))
}
