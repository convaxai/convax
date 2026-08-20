import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  encodeRestrictedJcs,
  canonicalStateDigest,
  installCurrentProtocolAuthority,
  parseMemberId,
  parseReplicaId,
  parseSignature,
  structuredDigest,
  type ActorId,
  type Digest,
  type DecodedCausalEditFrame,
  type Id128,
  type OwnerIntentValidationContext,
  type OwnerStateCommitment,
  type OwnerStateCommitmentIssuer,
  type OwnerValidatedState,
  type PortableStamp,
  type Uint32,
} from "@convax/collaboration"
import { fromProjectUri } from "@convax/uri"
import * as projectRoot from "../index"
import * as Y from "yjs"
import { createProjectIndexBenchmarkFixture } from "./project-index-benchmark-fixture"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  ProjectIndexSchemaError,
  applyProjectIndexCandidateIntent,
  cloneProjectIndexYDoc,
  constructProjectDirectoryCreateIntent,
  constructProjectFileCreateIntent,
  constructProjectCanvasRouteActivationIntent,
  constructProjectCanvasRouteRenameIntent,
  constructProjectCanvasRouteResetIntent,
  constructProjectCanvasRouteStageIntent,
  constructProjectCanvasRouteTombstoneIntent,
  createProjectIndexYDoc,
  createProjectIndexDocumentOwnerRuntime,
  deriveProjectIdentity,
  encodeProjectCanonicalState,
  materializeProjectIndexIntentGuards,
  projectCanvasRouteProjectionDigest,
  projectCanvasRouteProjection,
  projectIndexIntentDigest,
  projectIndexCurrentBlobReferences,
  projectIndexCurrentBlobReferencesForFamiliesFromValidatedOwnerState,
  projectIndexCanonicalStructuralCounts,
  projectIndexEntryAtPortablePathFromValidatedOwnerState,
  projectIndexSnapshotFromValidatedOwnerState,
  parseProjectIndexResourceReference,
  projectIndexRecordDigest,
  requiredProjectIndexBlobDigests,
  projectProjectIndex,
  selectedProjectIndexDocumentOwnerArtifactDefinition,
  validateProjectIndexYDoc,
  type ProjectBlobRef,
  type ProjectContentConflictCopyRecord,
  type ProjectContentVersionRecord,
  type ProjectEntryRecord,
  type ProjectIndexIntent,
  type ProjectPathReservationRecord,
} from "./project-index"

const projectEpoch = id128(1)
const shardEpoch = id128(2)
const protocolDigest = digest("protocol")
const uriProtocolDigest = digest("uri")
const rootDirectoryId = `pd_${"a".repeat(64)}` as const
const facts = Object.freeze({
  verifyBlob: () => true,
  verifyCanvasGenesis: () => true,
  verifyResetAuthorization: () => true,
})

describe("ProjectIndex owner schema", () => {
  test("recognizes schema-bound validated snapshots across package entrypoint constructor identities", () => {
    const snapshot = validateProjectIndexYDoc(genesis())
    const crossEntrypointSnapshot = Object.freeze({
      ...snapshot,
      entries: new Map(snapshot.entries),
      canvasRoutes: new Map(snapshot.canvasRoutes),
      operations: new Map(snapshot.operations),
    })
    const state = Object.freeze({
      owner: "project-index",
      value: crossEntrypointSnapshot,
    }) as OwnerValidatedState<"project-index">

    expect(projectIndexSnapshotFromValidatedOwnerState(state)).toBe(crossEntrypointSnapshot)
    expect(projectIndexSnapshotFromValidatedOwnerState(Object.freeze({
      owner: "project-index",
      value: {
        identity: snapshot.identity,
        entries: snapshot.entries,
        canvasRoutes: snapshot.canvasRoutes,
        operations: snapshot.operations,
      },
    }) as OwnerValidatedState<"project-index">)).toBeNull()
  })

  test("constructs the closed stage, activation, rename and tombstone route intents from the exact base", () => {
    const document = genesis()
    const stageContext = draftContext(actor(2), id128(41), "2")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(document),
      context: stageContext,
      shardEpoch: id128(42),
      title: "Team Canvas",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(stageContext, staged.intent)
    expect(applyProjectIndexCandidateIntent(document, stage.context, stage.intent, facts)).not.toBe("rejected")

    const activationContext = draftContext(actor(2), id128(43), "3")
    const activationIntent = constructProjectCanvasRouteActivationIntent({
      snapshot: validateProjectIndexYDoc(document),
      context: activationContext,
      canvasId: staged.canvasId,
      projectIndexRouteDependencyFrameDigest: digest("stage-frame"),
      canvasGenesisCheckpointObjectDigest: digest("canvas-genesis"),
      stagedProjectIndexFrontierDigest: digest("stage-frontier"),
    })
    if (activationIntent === "rejected") throw new Error("activation construction rejected")
    const activation = withDigest(activationContext, activationIntent)
    expect(applyProjectIndexCandidateIntent(document, activation.context, activation.intent, facts)).not.toBe(
      "rejected",
    )
    if (activation.intent.kind !== "project.canvas.route.activate") {
      throw new Error("activation constructor returned the wrong intent kind")
    }
    const forgedImportedBaseActivation = Object.freeze({
      ...activation.intent,
      body: Object.freeze({
        activation: Object.freeze({
          ...activation.intent.body.activation,
          projectIndexRouteDependency: Object.freeze({
            kind: "migration-import-base" as const,
            digest: digest("forged-import-base"),
          }),
        }),
      }),
    }) as ProjectIndexIntent
    expect(applyProjectIndexCandidateIntent(
      cloneProjectIndexYDoc(document),
      activation.context,
      forgedImportedBaseActivation,
      facts,
    )).toBe("rejected")

    const renameContext = draftContext(actor(2), id128(44), "4")
    const renameIntent = constructProjectCanvasRouteRenameIntent({
      snapshot: validateProjectIndexYDoc(document),
      context: renameContext,
      canvasId: staged.canvasId,
      title: "Renamed",
    })
    if (renameIntent === "rejected") throw new Error("rename construction rejected")
    const rename = withDigest(renameContext, renameIntent)
    expect(applyProjectIndexCandidateIntent(document, rename.context, rename.intent, facts)).not.toBe("rejected")

    const tombstoneContext = draftContext(actor(2), id128(45), "5")
    const tombstoneIntent = constructProjectCanvasRouteTombstoneIntent({
      snapshot: validateProjectIndexYDoc(document),
      context: tombstoneContext,
      canvasId: staged.canvasId,
    })
    if (tombstoneIntent === "rejected") throw new Error("tombstone construction rejected")
    const tombstone = withDigest(tombstoneContext, tombstoneIntent)
    expect(applyProjectIndexCandidateIntent(document, tombstone.context, tombstone.intent, facts)).not.toBe(
      "rejected",
    )
    expect(projectProjectIndex(document).canvasRoutes).toEqual([
      expect.objectContaining({
        canvasId: staged.canvasId,
        state: "tombstoned",
        currentShardEpoch: null,
        currentActivationDigest: null,
        currentTitle: null,
      }),
    ])
  })

  test("is the selected /2 owner artifact and emits the exact nine-root canonical state", () => {
    const doc = genesis()
    expect(selectedProjectIndexDocumentOwnerArtifactDefinition.owner).toBe("project-index")
    expect([...doc.getMap("convax.project-index.v2").keys()].sort()).toEqual([
      "canvasRoutes", "contentConflictCopies", "contentFamilies", "entries", "entryLocations",
      "entryTombstones", "identity", "operations", "pathReservations",
    ])
    expect(new TextDecoder().decode(encodeProjectCanonicalState(doc))).toContain(
      '"format":"convax.project-index-canonical-state"',
    )
  })

  test("binds the exact ProjectIndex state commitment through the selected runtime", () => {
    const runtime = createProjectIndexDocumentOwnerRuntime(installCurrentProtocolAuthority())
    const source = genesis()
    const base = runtime.protocolPort.validateBase(source)
    if (typeof base === "string") throw new Error("selected ProjectIndex base rejected")
    const draft = draftContext(actor(26), id128(260), "1")
    const built = constructProjectDirectoryCreateIntent({
      snapshot: validateProjectIndexYDoc(source),
      context: draft,
      parentDirectoryId: rootDirectoryId,
      basename: "Commitment",
    })
    if (built === "rejected") throw new Error("selected ProjectIndex create rejected")
    const exact = withDigest(draft, built.intent)
    const candidate = rawCloneProjectIndexYDoc(source)
    selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
      base,
      candidate,
      context: exact.context,
    })
    let result: ReturnType<typeof runtime.protocolPort.applyIntent> = "rejected"
    candidate.transact(() => {
      result = runtime.protocolPort.applyIntent(base, candidate, exact.context, exact.intent, emptyOwnerFacts())
    })
    if (typeof result === "string") throw new Error("selected ProjectIndex apply rejected")
    expect(runtime.protocolPort.validatePost(base, candidate, result)).not.toBe("rejected")
  })

  test("does not expose the selected definition or its acceleration hooks from the package root", () => {
    expect("selectedProjectIndexDocumentOwnerArtifactDefinition" in projectRoot).toBe(false)
    expect("createProjectIndexDocumentOwnerRuntime" in projectRoot).toBe(true)
  })

  test("does not treat a stable Yjs state vector as proof that ProjectIndex was not mutated", () => {
    const document = genesis()
    const entries = document.getMap("convax.project-index.v2").get("entries")
    if (!(entries instanceof Y.Map)) throw new Error("entries root is missing")
    const before = Y.encodeStateVector(document)

    entries.delete(rootDirectoryId)

    expect(Y.encodeStateVector(document)).toEqual(before)
    expect(() => validateProjectIndexYDoc(document)).toThrow()
  })

  test("reuses only unchanged owner-validated views and returns fresh canonical bytes", () => {
    const document = genesis()
    const validationCalls = countFullProjectIndexValidations(document)
    const protocol = ownerProtocol()

    const first = protocol.canonicalStateBytes(document)
    const second = protocol.canonicalStateBytes(document)
    expect(first).not.toBe("rejected")
    expect(second).not.toBe("rejected")
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
    expect(protocol.validateBase(document)).not.toBe("rejected")
    expect(validationCalls()).toBe(1)

    if (first === "rejected") throw new Error("canonical state rejected")
    first[0] ^= 0xff
    const third = protocol.canonicalStateBytes(document)
    expect(third).not.toBe("rejected")
    expect(third).toEqual(second)
    expect(validationCalls()).toBe(1)
  })

  test("transfers only the exact validated post cache to an equal local replica", () => {
    const source = genesis()
    const target = new Y.Doc()
    target.getMap("convax.project-index.v2")
    Y.applyUpdate(target, Y.encodeStateAsUpdate(source))
    const protocol = ownerProtocol()
    const state = protocol.validateBase(source)
    if (typeof state === "string") throw new Error("source validation rejected")
    const canonical = protocol.canonicalStateBytes(source)
    if (typeof canonical === "string") throw new Error("source canonicalization rejected")
    const commitmentDigest = testProjectIndexCommitmentDigest(state)
    const targetValidationCalls = countFullProjectIndexValidations(target)

    selectedProjectIndexDocumentOwnerArtifactDefinition.installValidatedPostCache?.({
      scope: {
        projectId: "project-a" as never,
        projectEpoch,
        docKind: "project-index",
        docId: "project-index",
        shardEpoch,
      },
      source,
      target,
      state,
      canonicalStateDigest: commitmentDigest,
      durableHeadDigest: digest("certified-head"),
    })
    canonical[0] ^= 0xff

    const warm = protocol.validateBase(target)
    expect(typeof warm).not.toBe("string")
    expect(targetValidationCalls()).toBe(0)
    expect(protocol.canonicalStateBytes(target)).toEqual(encodeProjectCanonicalState(target))
    const readCertified = selectedProjectIndexDocumentOwnerArtifactDefinition.readCertifiedCanonicalDigest
    expect(readCertified?.({
      scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
      document: target,
      durableHeadDigest: digest("certified-head"),
      expectedCanonicalStateDigest: commitmentDigest,
    })).not.toBeNull()
    expect(readCertified?.({
      scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
      document: target,
      durableHeadDigest: digest("wrong-head"),
      expectedCanonicalStateDigest: commitmentDigest,
    })).toBeNull()

    const reopened = new Y.Doc()
    reopened.getMap("convax.project-index.v2")
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(target))
    const reopenedValidationCalls = countFullProjectIndexValidations(reopened)
    expect(readCertified?.({
      scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
      document: reopened,
      durableHeadDigest: digest("certified-head"),
      expectedCanonicalStateDigest: commitmentDigest,
    })).toBeNull()
    expect(typeof protocol.validateBase(reopened)).not.toBe("string")
    expect(reopenedValidationCalls()).toBeGreaterThan(0)
  })

  test("skips base canonical JCS only for the exact certified durable head", () => {
    const source = genesis()
    const target = rawCloneProjectIndexYDoc(source)
    const counted = countingOwnerProtocol()
    const state = counted.protocol.validateBase(source)
    if (typeof state === "string") throw new Error("source validation rejected")
    const canonical = counted.protocol.canonicalStateBytes(source)
    if (typeof canonical === "string") throw new Error("source canonicalization rejected")
    const commitmentDigest = testProjectIndexCommitmentDigest(state)
    const durableHeadDigest = digest("warm-certified-head")
    selectedProjectIndexDocumentOwnerArtifactDefinition.installValidatedPostCache?.({
      scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
      source,
      target,
      state,
      canonicalStateDigest: commitmentDigest,
      durableHeadDigest,
    })

    counted.reset()
    expect(selectedProjectIndexDocumentOwnerArtifactDefinition.readCertifiedCanonicalDigest?.({
      scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
      document: target,
      durableHeadDigest,
      expectedCanonicalStateDigest: commitmentDigest,
    })).toBe(commitmentDigest)
    expect(counted.calls()).toBe(0)
    expect(counted.protocol.canonicalStateBytes(target)).not.toBe("rejected")
    expect(counted.calls()).toBe(1)

    counted.reset()
    expect(selectedProjectIndexDocumentOwnerArtifactDefinition.readCertifiedCanonicalDigest?.({
      scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
      document: target,
      durableHeadDigest: digest("wrong-head"),
      expectedCanonicalStateDigest: commitmentDigest,
    })).toBeNull()
    counted.protocol.canonicalStateBytes(target)
    counted.protocol.canonicalStateBytes(target)
    expect(counted.calls()).toBe(2)

    counted.reset()
    target.transact(() => undefined)
    expect(selectedProjectIndexDocumentOwnerArtifactDefinition.readCertifiedCanonicalDigest?.({
      scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch },
      document: target,
      durableHeadDigest,
      expectedCanonicalStateDigest: commitmentDigest,
    })).toBeNull()
    counted.protocol.canonicalStateBytes(target)
    counted.protocol.canonicalStateBytes(target)
    expect(counted.calls()).toBe(2)
  })

  test("cache-transfer mismatch is a no-op and forces full fallback", () => {
    const source = genesis()
    const target = new Y.Doc()
    target.getMap("convax.project-index.v2")
    Y.applyUpdate(target, Y.encodeStateAsUpdate(source))
    const protocol = ownerProtocol()
    const state = protocol.validateBase(source)
    if (typeof state === "string") throw new Error("source validation rejected")
    if (typeof protocol.canonicalStateBytes(source) === "string") throw new Error("source canonicalization rejected")
    const targetValidationCalls = countFullProjectIndexValidations(target)

    selectedProjectIndexDocumentOwnerArtifactDefinition.installValidatedPostCache?.({
      scope: {
        projectId: "different-project" as never,
        projectEpoch,
        docKind: "project-index",
        docId: "project-index",
        shardEpoch,
      },
      source,
      target,
      state,
      canonicalStateDigest: testProjectIndexCommitmentDigest(state),
      durableHeadDigest: digest("mismatch-head"),
    })

    expect(typeof protocol.validateBase(target)).not.toBe("string")
    expect(targetValidationCalls()).toBeGreaterThan(0)
  })

  test("exposes runtime-immutable snapshot maps through public and branded owner state", () => {
    const document = genesis()
    const protocol = ownerProtocol()
    const publicSnapshot = validateProjectIndexYDoc(document)
    const ownerState = protocol.validateBase(document)
    if (typeof ownerState === "string") throw new Error("owner state rejected")
    const ownerSnapshot = ownerState.value as typeof publicSnapshot
    const beforePublicCanonical = encodeProjectCanonicalState(document)
    const beforeOwnerCanonical = protocol.canonicalStateBytes(document)
    if (beforeOwnerCanonical === "rejected") throw new Error("owner canonical state rejected")

    for (const snapshot of [publicSnapshot, ownerSnapshot]) {
      for (const collection of [
        snapshot.entries,
        snapshot.entryLocations,
        snapshot.entryTombstones,
        snapshot.contentFamilies,
        snapshot.contentConflictCopies,
        snapshot.pathReservations,
        snapshot.canvasRoutes,
        snapshot.operations,
      ]) {
        const mutable = collection as unknown as Map<string, unknown>
        expect(typeof mutable.set).toBe("undefined")
        expect(typeof mutable.delete).toBe("undefined")
        expect(typeof mutable.clear).toBe("undefined")
        expect(() => mutable.set("injected", {})).toThrow()
        expect(() => mutable.delete([...collection.keys()][0] ?? "missing")).toThrow()
        expect(() => mutable.clear()).toThrow()
      }
    }

    expect(validateProjectIndexYDoc(document).entries.has(rootDirectoryId)).toBeTrue()
    expect(encodeProjectCanonicalState(document)).toEqual(beforePublicCanonical)
    expect(protocol.canonicalStateBytes(document)).toEqual(beforeOwnerCanonical)
  })

  test("invalidates cached owner views on delete, nested mutation, and empty root registration", () => {
    const protocol = ownerProtocol()
    const deleted = genesis()
    expect(protocol.validateBase(deleted)).not.toBe("rejected")
    projectIndexChildMap(deleted, "entries").delete(rootDirectoryId)
    expect(protocol.validateBase(deleted)).toBe("rejected")

    const nested = genesis()
    expect(protocol.validateBase(nested)).not.toBe("rejected")
    projectIndexChildMap(nested, "identity").set("unexpected", {})
    expect(protocol.validateBase(nested)).toBe("rejected")

    const extraRoot = genesis()
    expect(protocol.validateBase(extraRoot)).not.toBe("rejected")
    extraRoot.getMap("empty-bypass-root")
    expect(protocol.validateBase(extraRoot)).toBe("rejected")
  })

  test("does not reuse validated bytes after digest mutation or across a reopened document", () => {
    const protocol = ownerProtocol()
    const document = genesis()
    const before = protocol.canonicalStateBytes(document)
    if (before === "rejected") throw new Error("canonical state rejected")
    const identity = projectIndexChildMap(document, "identity").get("project") as Record<string, unknown>
    projectIndexChildMap(document, "identity").set("project", { ...identity, protocolDigest: digest("changed-protocol") })
    const after = protocol.canonicalStateBytes(document)
    expect(after).not.toBe("rejected")
    expect(after).not.toEqual(before)

    const reopened = cloneProjectIndexYDoc(document)
    const reopenedCalls = countFullProjectIndexValidations(reopened)
    expect(protocol.validateBase(reopened)).not.toBe("rejected")
    expect(reopenedCalls()).toBe(1)
  })

  test("keeps public post-validation and delegates the owner postcondition only to validatePost", () => {
    const protocol = ownerProtocol()
    const base = genesis()
    const stageContext = draftContext(actor(9), id128(91), "1")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(base), context: stageContext, shardEpoch: id128(92), title: "Cached",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(stageContext, staged.intent)

    const baseCalls = countFullProjectIndexValidations(base)
    expect(protocol.canonicalStateBytes(base)).not.toBe("rejected")
    expect(protocol.canonicalStateBytes(base)).not.toBe("rejected")
    const baseState = protocol.validateBase(base)
    expect(baseState).not.toBe("rejected")
    expect(baseCalls()).toBe(1)

    const candidate = rawCloneProjectIndexYDoc(base)
    const candidateCalls = countFullProjectIndexValidations(candidate)
    if (typeof baseState === "string") throw new Error("base rejected")
    const result = protocol.applyIntent(baseState, candidate, stage.context, stage.intent, emptyOwnerFacts())
    if (result === "rejected" || result === "pending") throw new Error("candidate rejected")
    expect(candidateCalls()).toBe(0)
    expect(protocol.validatePost(baseState, candidate, result)).not.toBe("rejected")
    expect(candidateCalls()).toBe(1)
    expect(protocol.canonicalStateBytes(candidate)).not.toBe("rejected")
    expect(protocol.canonicalStateBytes(candidate)).not.toBe("rejected")
    expect(candidateCalls()).toBe(1)

    const materialized = rawCloneProjectIndexYDoc(candidate)
    const materializedCalls = countFullProjectIndexValidations(materialized)
    expect(protocol.validateBase(materialized)).not.toBe("rejected")
    expect(protocol.canonicalStateBytes(materialized)).not.toBe("rejected")
    expect(materializedCalls()).toBe(1)
    expect(baseCalls() + candidateCalls() + materializedCalls()).toBe(3)
  })

  test("uses sealed owner transaction evidence for directory and file create while direct apply falls back", () => {
    const protocol = ownerProtocol()
    const run = (kind: "directory" | "file" | "file-located", operation: number) => {
      const base = genesis()
      const context = draftContext(actor(14), id128(operation), "1")
      const snapshot = validateProjectIndexYDoc(base)
      const built = kind === "directory"
        ? constructProjectDirectoryCreateIntent({ snapshot, context, parentDirectoryId: rootDirectoryId, basename: "Fast" })
        : constructProjectFileCreateIntent({
          snapshot, context,
          parentDirectoryId: kind === "file-located" ? rootDirectoryId : null,
          basename: kind === "file-located" ? "fast.md" : null,
          blob: blobRef(`fast-${kind}`), contentPolicy: "immutable",
          storageClass: kind === "file-located" ? "project-file" : "managed-blob",
          provenance: kind === "file-located" ? "user" : "managed-admission",
        })
      if (built === "rejected") throw new Error("create construction rejected")
      const exact = withDigest(context, built.intent)
      const baseState = protocol.validateBase(base)
      if (typeof baseState === "string") throw new Error("base rejected")
      const candidate = rawCloneProjectIndexYDoc(base)
      const calls = countFullProjectIndexValidations(candidate)
      selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
        base: baseState, candidate, context: exact.context,
      })
      const ownerFacts = {
        resolveFact(requirement: { kind: string; factDigest: string; request: { sha256: string } }) {
          return {
            status: "resolved",
            requirement,
            value: {
              format: "convax.project-index-external-fact-result",
              kind: requirement.kind,
              requestSha256: requirement.request.sha256,
              factDigest: requirement.factDigest,
              decision: "verified",
            },
          }
        },
      } as never
      let result: ReturnType<typeof protocol.applyIntent> = "rejected"
      candidate.transact(() => {
        result = protocol.applyIntent(baseState, candidate, exact.context, exact.intent, ownerFacts)
      }, Object.freeze({ format: "kernel-owned-test-transaction" }))
      if (typeof result === "string") throw new Error("owner apply rejected")
      const validated = protocol.validatePost(baseState, candidate, result)
      expect(typeof validated).not.toBe("string")
      expect(calls()).toBe(0)
      expect(protocol.canonicalStateBytes(candidate)).toEqual(encodeProjectCanonicalState(candidate))
    }
    run("directory", 141)
    run("file", 142)
    run("file-located", 144)

    const base = genesis()
    const context = draftContext(actor(14), id128(143), "1")
    const built = constructProjectDirectoryCreateIntent({
      snapshot: validateProjectIndexYDoc(base), context, parentDirectoryId: rootDirectoryId, basename: "Fallback",
    })
    if (built === "rejected") throw new Error("directory construction rejected")
    const exact = withDigest(context, built.intent)
    const baseState = protocol.validateBase(base)
    if (typeof baseState === "string") throw new Error("base rejected")
    const candidate = rawCloneProjectIndexYDoc(base)
    const calls = countFullProjectIndexValidations(candidate)
    const result = protocol.applyIntent(baseState, candidate, exact.context, exact.intent, emptyOwnerFacts())
    if (typeof result === "string") throw new Error("direct apply rejected")
    expect(typeof protocol.validatePost(baseState, candidate, result)).not.toBe("string")
    expect(calls()).toBe(1)
  })

  test("keeps 256 consecutive file-create heads incremental with exact non-enumerating lookups", () => {
    const protocol = ownerProtocol()
    const candidate = genesis()
    const initialSymbols = Object.getOwnPropertySymbols(validateProjectIndexYDoc(candidate))
    const initialState = protocol.validateBase(candidate)
    if (typeof initialState === "string") throw new Error("initial ProjectIndex validation rejected")
    let state: OwnerValidatedState<"project-index"> = initialState
    const fullTraversals = countFullProjectIndexValidations(candidate)
    let lastFileId: `pf_${string}` | undefined
    let lastPath = ""
    const ownerFacts = {
      resolveFact(requirement: { kind: string; factDigest: string; request: { sha256: string } }) {
        return {
          status: "resolved",
          requirement,
          value: {
            format: "convax.project-index-external-fact-result",
            kind: requirement.kind,
            requestSha256: requirement.request.sha256,
            factDigest: requirement.factDigest,
            decision: "verified",
          },
        }
      },
    } as never

    for (let index = 0; index < 256; index += 1) {
      const snapshot = projectIndexSnapshotFromValidatedOwnerState(state)
      if (snapshot === null) throw new Error("incremental ProjectIndex state lost its snapshot")
      const draft = draftContext(actor(24), id128(index), String(index + 1))
      lastPath = `notes-${index}.md`
      const built = constructProjectFileCreateIntent({
        snapshot,
        context: draft,
        parentDirectoryId: rootDirectoryId,
        basename: lastPath,
        blob: blobRef(`consecutive-${index}`),
        contentPolicy: "immutable",
        storageClass: "project-file",
        provenance: "user",
      })
      if (built === "rejected") throw new Error(`file create ${index} rejected`)
      lastFileId = built.fileId
      const exact = withDigest(draft, built.intent)
      selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
        base: state,
        candidate,
        context: exact.context,
      })
      let result: ReturnType<typeof protocol.applyIntent> = "rejected"
      candidate.transact(() => {
        result = protocol.applyIntent(state, candidate, exact.context, exact.intent, ownerFacts)
      })
      if (typeof result === "string") throw new Error(`file apply ${index} rejected`)
      const validated = protocol.validatePost(state, candidate, result)
      if (typeof validated === "string") throw new Error(`file post ${index} rejected`)
      state = validated
      expect(projectIndexCurrentBlobReferencesForFamiliesFromValidatedOwnerState(state, [built.fileId]))
        .toHaveLength(1)
      expect(projectIndexEntryAtPortablePathFromValidatedOwnerState(state, lastPath))
        .toEqual({ entryId: built.fileId, kind: "file" })
    }

    expect(fullTraversals()).toBe(0)
    const finalSnapshot = projectIndexSnapshotFromValidatedOwnerState(state)
    if (finalSnapshot === null || lastFileId === undefined) throw new Error("final incremental snapshot is absent")
    const finalSymbols = Object.getOwnPropertySymbols(finalSnapshot)
    expect(finalSymbols).toEqual(initialSymbols)
    expect(finalSymbols.map((symbol) => Reflect.get(finalSnapshot, symbol))).toEqual([true])
    for (const collection of snapshotCollections(finalSnapshot)) {
      expect(Object.getOwnPropertyNames(collection)).toEqual([])
      expect(Object.getOwnPropertySymbols(collection)).toEqual([])
      expect(typeof (collection as { set?: unknown }).set).toBe("undefined")
      expect(typeof (collection as { delete?: unknown }).delete).toBe("undefined")
      expect(typeof (collection as { clear?: unknown }).clear).toBe("undefined")
    }
    withRejectedProjectIndexSnapshotIteration(finalSnapshot, () => {
      expect(projectIndexCurrentBlobReferencesForFamiliesFromValidatedOwnerState(state, [lastFileId!]))
        .toHaveLength(1)
      expect(projectIndexEntryAtPortablePathFromValidatedOwnerState(state, lastPath))
        .toEqual({ entryId: lastFileId, kind: "file" })
    })
  })

  test("keeps fixed-k file create structurally logarithmic at 256, 1024 and 4096 resources", () => {
    for (const resourceCount of [256, 1024, 4096] as const) {
      const source = createProjectIndexBenchmarkFixture(resourceCount).document
      const protocol = ownerProtocol()
      const base = protocol.validateBase(source)
      if (typeof base === "string") throw new Error(`source ${resourceCount} rejected`)
      const snapshot = projectIndexSnapshotFromValidatedOwnerState(base)
      if (snapshot === null) throw new Error(`source ${resourceCount} snapshot rejected`)
      const draft = {
        ...draftContext(actor(25), id128(resourceCount + 10), "2"),
        scope: {
          projectId: snapshot.identity.projectId,
          projectEpoch: snapshot.identity.projectEpoch,
          docKind: "project-index" as const,
          docId: "project-index" as const,
          shardEpoch: snapshot.identity.shardEpoch,
        },
      }
      const built = constructProjectFileCreateIntent({
        snapshot,
        context: draft,
        parentDirectoryId: snapshot.identity.rootDirectoryId,
        basename: `structural-${resourceCount}.md`,
        blob: blobRef(`structural-${resourceCount}`),
        contentPolicy: "immutable",
        storageClass: "project-file",
        provenance: "user",
      })
      if (built === "rejected") throw new Error(`file ${resourceCount} construction rejected`)
      const exact = withDigest(draft, built.intent)
      const candidate = rawCloneProjectIndexYDoc(source)
      selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
        base,
        candidate,
        context: exact.context,
      })
      const before = projectIndexCanonicalStructuralCounts()
      let result: ReturnType<typeof protocol.applyIntent> = "rejected"
      candidate.transact(() => {
        result = protocol.applyIntent(base, candidate, exact.context, exact.intent, verifiedOwnerFacts())
      })
      if (typeof result === "string") throw new Error(`file ${resourceCount} apply rejected`)
      const state = protocol.validatePost(base, candidate, result)
      if (typeof state === "string") throw new Error(`file ${resourceCount} post rejected`)
      const after = projectIndexCanonicalStructuralCounts()
      const delta = structuralCountDelta(before, after)
      const logarithmicHeight = Math.ceil(Math.log2(resourceCount + 2))

      expect(delta.fullBuilds, `${resourceCount} canonical full builds`).toBe(0)
      expect(delta.fullBuildEntryVisits, `${resourceCount} canonical full visits`).toBe(0)
      expect(delta.fullBuildComparisons, `${resourceCount} canonical full comparisons`).toBe(0)
      expect(delta.historicalEntryVisits, `${resourceCount} canonical history visits`).toBe(0)
      expect(delta.historicalEntryCopies, `${resourceCount} canonical history copies`).toBe(0)
      expect(delta.flattenEntryVisits, `${resourceCount} audit flatten visits`).toBe(0)
      expect(delta.evidenceEntryVisits, `${resourceCount} legacy evidence visits`).toBe(0)
      expect(delta.incrementalInsertions, `${resourceCount} canonical insertions`).toBe(4)
      expect(delta.insertionComparisons, `${resourceCount} canonical path comparisons`)
        .toBeLessThanOrEqual(12 * logarithmicHeight + 32)
      expect(delta.persistentNodeCopies, `${resourceCount} canonical path copies`)
        .toBeLessThanOrEqual(24 * logarithmicHeight + 64)
      expect(delta.commitmentColdBuilds, `${resourceCount} commitment cold builds`).toBe(0)
      expect(delta.commitmentColdEntryVisits, `${resourceCount} commitment cold visits`).toBe(0)
      expect(delta.commitmentApplyCalls, `${resourceCount} commitment applies`).toBe(1)
      expect(delta.commitmentMutationCount, `${resourceCount} commitment mutations`).toBe(4)
      expect(delta.commitmentHistoricalEntryVisits, `${resourceCount} commitment history visits`).toBe(0)
      expect(delta.trieInsertCodeUnits, `${resourceCount} lookup-trie inserted key bytes`).toBeLessThanOrEqual(2_048)
      expect(delta.trieNodeCopies, `${resourceCount} lookup-trie path copies`).toBeLessThanOrEqual(2_048)
      expect(delta.trieEdgeCopies, `${resourceCount} lookup-trie bounded edge copies`).toBeLessThanOrEqual(65_536)

      // Full canonical bytes are a window-external audit oracle, never part of
      // the measured owner-frame commitment path above.
      expect(protocol.canonicalStateBytes(candidate)).toEqual(encodeProjectCanonicalState(candidate))
    }
  }, 30_000)

  test("derives byte-identical 512 and 2k create canonical state from certified collection fragments", () => {
    for (const resourceCount of [512, 2048] as const) {
      const source = createProjectIndexBenchmarkFixture(resourceCount).document
      const sourceSnapshot = validateProjectIndexYDoc(source)
      const protocol = ownerProtocol()
      const sourceState = protocol.validateBase(source)
      if (typeof sourceState === "string") throw new Error("source rejected")
      const sourceBytes = protocol.canonicalStateBytes(source)
      if (typeof sourceBytes === "string") throw new Error("source canonical rejected")
      const sourceDigest = testProjectIndexCommitmentDigest(sourceState)
      const durableHeadDigest = digest(`fragment-head-${resourceCount}`)
      const target = rawCloneProjectIndexYDoc(source)
      selectedProjectIndexDocumentOwnerArtifactDefinition.installValidatedPostCache?.({
        scope: {
          projectId: sourceSnapshot.identity.projectId,
          projectEpoch: sourceSnapshot.identity.projectEpoch,
          docKind: "project-index",
          docId: "project-index",
          shardEpoch: sourceSnapshot.identity.shardEpoch,
        },
        source,
        target,
        state: sourceState,
        canonicalStateDigest: sourceDigest,
        durableHeadDigest,
      })
      const base = protocol.validateBase(target)
      if (typeof base === "string") throw new Error("warm base rejected")
      const draft = {
        ...draftContext(actor(21), id128(resourceCount), "2"),
        scope: {
          projectId: sourceSnapshot.identity.projectId,
          projectEpoch: sourceSnapshot.identity.projectEpoch,
          docKind: "project-index" as const,
          docId: "project-index" as const,
          shardEpoch: sourceSnapshot.identity.shardEpoch,
        },
      }
      const built = constructProjectDirectoryCreateIntent({
        snapshot: sourceSnapshot,
        context: draft,
        parentDirectoryId: sourceSnapshot.identity.rootDirectoryId,
        basename: `Incremental-${resourceCount}`,
      })
      if (built === "rejected") throw new Error("create rejected")
      const exact = withDigest(draft, built.intent)
      const candidate = rawCloneProjectIndexYDoc(target)
      const fullTraversals = countFullProjectIndexValidations(candidate)
      selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
        base,
        candidate,
        context: exact.context,
        baseCanonicalProof: { canonicalStateDigest: sourceDigest, durableHeadDigest },
      })
      let result: ReturnType<typeof protocol.applyIntent> = "rejected"
      candidate.transact(() => {
        result = protocol.applyIntent(base, candidate, exact.context, exact.intent, emptyOwnerFacts())
      })
      if (typeof result === "string") throw new Error("owner apply rejected")
      const collectionVisits = countLargeCanonicalCollectionVisits(resourceCount)
      const snapshotCloneVisits = countLargeMapIteratorVisits(resourceCount)
      let incremental: ReturnType<typeof protocol.canonicalStateBytes>
      try {
        expect(protocol.validatePost(base, candidate, result)).not.toBe("rejected")
        incremental = protocol.canonicalStateBytes(candidate)
      } finally {
        collectionVisits.restore()
        snapshotCloneVisits.restore()
      }
      expect(incremental).not.toBe("rejected")
      expect(fullTraversals(), `${resourceCount} incremental traversals`).toBe(0)
      expect(collectionVisits.calls(), `${resourceCount} changed collection visits`).toBe(0)
      expect(snapshotCloneVisits.calls(), `${resourceCount} snapshot clone visits`).toBe(0)
      expect(incremental).toEqual(encodeProjectCanonicalState(candidate))
      expect(fullTraversals(), `${resourceCount} differential full traversal`).toBe(1)

      const fileDraft = {
        ...draftContext(actor(23), id128(resourceCount + 1), "3"),
        scope: draft.scope,
      }
      const fileBuilt = constructProjectFileCreateIntent({
        snapshot: sourceSnapshot,
        context: fileDraft,
        parentDirectoryId: sourceSnapshot.identity.rootDirectoryId,
        basename: `incremental-${resourceCount}.md`,
        blob: blobRef(`incremental-file-${resourceCount}`),
        contentPolicy: "immutable",
        storageClass: "project-file",
        provenance: "user",
      })
      if (fileBuilt === "rejected") throw new Error("file create rejected")
      const fileExact = withDigest(fileDraft, fileBuilt.intent)
      const fileCandidate = rawCloneProjectIndexYDoc(target)
      const fileFullTraversals = countFullProjectIndexValidations(fileCandidate)
      selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
        base,
        candidate: fileCandidate,
        context: fileExact.context,
        baseCanonicalProof: { canonicalStateDigest: sourceDigest, durableHeadDigest },
      })
      const verifiedFacts = {
        resolveFact(requirement: { kind: string; factDigest: string; request: { sha256: string } }) {
          return { status: "resolved", requirement, value: { format: "convax.project-index-external-fact-result", kind: requirement.kind, requestSha256: requirement.request.sha256, factDigest: requirement.factDigest, decision: "verified" } }
        },
      } as never
      let fileResult: ReturnType<typeof protocol.applyIntent> = "rejected"
      fileCandidate.transact(() => {
        fileResult = protocol.applyIntent(base, fileCandidate, fileExact.context, fileExact.intent, verifiedFacts)
      })
      if (typeof fileResult === "string") throw new Error("owner file apply rejected")
      const fileCollectionVisits = countLargeCanonicalCollectionVisits(resourceCount)
      let fileIncremental: ReturnType<typeof protocol.canonicalStateBytes>
      try {
        expect(protocol.validatePost(base, fileCandidate, fileResult)).not.toBe("rejected")
        fileIncremental = protocol.canonicalStateBytes(fileCandidate)
      } finally {
        fileCollectionVisits.restore()
      }
      expect(fileIncremental).not.toBe("rejected")
      expect(fileFullTraversals(), `${resourceCount} file incremental traversals`).toBe(0)
      expect(fileCollectionVisits.calls(), `${resourceCount} file changed collection visits`).toBe(0)
      const fileFull = encodeProjectCanonicalState(fileCandidate)
      expect(fileIncremental).toEqual(fileFull)
      if (fileIncremental === "rejected") throw new Error("incremental file canonical rejected")
      expect(canonicalStateDigest(PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST, fileIncremental)).toBe(
        canonicalStateDigest(PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST, fileFull),
      )
      expect(fileFullTraversals(), `${resourceCount} file differential full traversal`).toBe(1)
      fileCandidate.transact(() => undefined)
    }
  }, 30_000)

  test("rejects a tampered canonical proof and falls back to full canonicalization", () => {
    const source = createProjectIndexBenchmarkFixture(512).document
    const snapshot = validateProjectIndexYDoc(source)
    const protocol = ownerProtocol()
    const sourceState = protocol.validateBase(source)
    if (typeof sourceState === "string") throw new Error("base rejected")
    const sourceBytes = protocol.canonicalStateBytes(source)
    if (typeof sourceBytes === "string") throw new Error("canonical rejected")
    const sourceDigest = testProjectIndexCommitmentDigest(sourceState)
    const target = rawCloneProjectIndexYDoc(source)
    selectedProjectIndexDocumentOwnerArtifactDefinition.installValidatedPostCache?.({
      scope: { projectId: snapshot.identity.projectId, projectEpoch: snapshot.identity.projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch: snapshot.identity.shardEpoch },
      source,
      target,
      state: sourceState,
      canonicalStateDigest: sourceDigest,
      durableHeadDigest: digest("actual-head"),
    })
    const base = protocol.validateBase(target)
    if (typeof base === "string") throw new Error("warm base rejected")
    const draft = {
      ...draftContext(actor(22), id128(220), "2"),
      scope: { projectId: snapshot.identity.projectId, projectEpoch: snapshot.identity.projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: snapshot.identity.shardEpoch },
    }
    const built = constructProjectDirectoryCreateIntent({ snapshot, context: draft, parentDirectoryId: snapshot.identity.rootDirectoryId, basename: "Tamper" })
    if (built === "rejected") throw new Error("create rejected")
    const exact = withDigest(draft, built.intent)
    const candidate = rawCloneProjectIndexYDoc(target)
    const fullTraversals = countFullProjectIndexValidations(candidate)
    selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
      base,
      candidate,
      context: exact.context,
      baseCanonicalProof: {
        canonicalStateDigest: sourceDigest,
        durableHeadDigest: digest("unmatched-head"),
      },
    })
    let result: ReturnType<typeof protocol.applyIntent> = "rejected"
    candidate.transact(() => { result = protocol.applyIntent(base, candidate, exact.context, exact.intent, emptyOwnerFacts()) })
    if (typeof result === "string") throw new Error("owner apply rejected")
    expect(protocol.validatePost(base, candidate, result)).not.toBe("rejected")
    expect(protocol.canonicalStateBytes(candidate)).toEqual(encodeProjectCanonicalState(candidate))
    expect(fullTraversals()).toBe(1)
  })

  test("falls back for every mutation outside the sealed create transaction", () => {
    const cases = [
      ["empty-root", (candidate: Y.Doc) => { candidate.getMap("unexpected-empty-root") }, true],
      ["delete-revert", (candidate: Y.Doc, entryKey: string) => {
        const entries = projectIndexChildMap(candidate, "entries")
        const value = entries.get(entryKey)
        candidate.transact(() => { entries.delete(entryKey); entries.set(entryKey, value) })
      }, false],
      ["overwrite", (candidate: Y.Doc, entryKey: string) => {
        const entries = projectIndexChildMap(candidate, "entries")
        const value = entries.get(entryKey) as Record<string, unknown>
        entries.set(entryKey, { ...value, provenance: "generated" })
      }, false],
      ["nested", (candidate: Y.Doc) => { projectIndexChildMap(candidate, "entries").set("pf_nested", new Y.Map()) }, true],
      ["extra-key", (candidate: Y.Doc) => { projectIndexChildMap(candidate, "operations").set("extra", {}) }, true],
      ["post-transaction", (candidate: Y.Doc) => { candidate.transact(() => undefined) }, false],
    ] as const
    for (const [name, mutate, rejects] of cases) {
      const protocol = ownerProtocol()
      const base = genesis()
      const context = draftContext(actor(15), id128(150 + cases.findIndex((item) => item[0] === name)), "1")
      const built = constructProjectDirectoryCreateIntent({
        snapshot: validateProjectIndexYDoc(base), context, parentDirectoryId: rootDirectoryId, basename: `Fault-${name}`,
      })
      if (built === "rejected") throw new Error("directory construction rejected")
      const exact = withDigest(context, built.intent)
      const baseState = protocol.validateBase(base)
      if (typeof baseState === "string") throw new Error("base rejected")
      const candidate = rawCloneProjectIndexYDoc(base)
      const calls = countFullProjectIndexValidations(candidate)
      selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({ base: baseState, candidate, context: exact.context })
      let result: ReturnType<typeof protocol.applyIntent> = "rejected"
      candidate.transact(() => { result = protocol.applyIntent(baseState, candidate, exact.context, exact.intent, emptyOwnerFacts()) })
      if (typeof result === "string") throw new Error("owner apply rejected")
      mutate(candidate, built.directoryId)
      if (rejects) expect(() => protocol.validatePost(baseState, candidate, result as never), name).toThrow()
      else expect(typeof protocol.validatePost(baseState, candidate, result as never), name).not.toBe("string")
      if (name === "empty-root") expect(calls(), name).toBe(0)
      else expect(calls(), name).toBe(1)
    }

    const protocol = ownerProtocol()
    const base = genesis()
    const context = draftContext(actor(15), id128(159), "1")
    const built = constructProjectDirectoryCreateIntent({
      snapshot: validateProjectIndexYDoc(base), context, parentDirectoryId: rootDirectoryId, basename: "Outer",
    })
    if (built === "rejected") throw new Error("directory construction rejected")
    const exact = withDigest(context, built.intent)
    const baseState = protocol.validateBase(base)
    if (typeof baseState === "string") throw new Error("base rejected")
    const candidate = rawCloneProjectIndexYDoc(base)
    const calls = countFullProjectIndexValidations(candidate)
    let result: ReturnType<typeof protocol.applyIntent> = "rejected"
    candidate.transact(() => {
      expect(() => selectedProjectIndexDocumentOwnerArtifactDefinition.armCandidateTransactionCapture?.({
        base: baseState, candidate, context: exact.context,
      })).toThrow("arm before")
      result = protocol.applyIntent(baseState, candidate, exact.context, exact.intent, emptyOwnerFacts())
    })
    if (typeof result === "string") throw new Error("outer apply rejected")
    expect(typeof protocol.validatePost(baseState, candidate, result)).not.toBe("string")
    expect(calls()).toBe(1)
  })

  test("public apply rejects a mutation injected immediately after its reducer transaction", () => {
    const document = genesis()
    const context = draftContext(actor(10), id128(101), "1")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(document), context, shardEpoch: id128(102), title: "Public postcondition",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(context, staged.intent)
    const originalTransact = document.transact.bind(document)
    let injected = false
    document.transact = ((transaction: () => void, origin?: unknown) => {
      originalTransact(transaction, origin)
      if (!injected && origin === "project-index-intent-v2") {
        injected = true
        document.getMap("unexpected-owner-root")
      }
    }) as typeof document.transact

    expect(applyProjectIndexCandidateIntent(document, stage.context, stage.intent, facts)).toBe("rejected")
    expect(() => validateProjectIndexYDoc(document)).toThrow()
  })

  test("a separately invoked owner apply phase cannot yield a commit-admissible invalid state", () => {
    const protocol = ownerProtocol()
    const base = genesis()
    const context = draftContext(actor(11), id128(111), "1")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(base), context, shardEpoch: id128(112), title: "Owner postcondition",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(context, staged.intent)
    const baseState = protocol.validateBase(base)
    if (baseState === "rejected" || baseState === "pending") throw new Error("base rejected")
    const candidate = rawCloneProjectIndexYDoc(base)
    const validationCalls = countFullProjectIndexValidations(candidate)
    const result = protocol.applyIntent(baseState, candidate, stage.context, stage.intent, emptyOwnerFacts())
    if (result === "rejected" || result === "pending") throw new Error("owner apply rejected")
    expect(validationCalls()).toBe(0)

    candidate.getMap("unexpected-owner-root")
    expect(() => protocol.validatePost(baseState, candidate, result)).toThrow(ProjectIndexSchemaError)
    expect(protocol.canonicalStateBytes(candidate)).toBe("rejected")
  })

  test("owner apply rejects an empty extra root before reducing the candidate", () => {
    const protocol = ownerProtocol()
    const base = genesis()
    const context = draftContext(actor(13), id128(131), "1")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(base), context, shardEpoch: id128(132), title: "Closed root",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(context, staged.intent)
    const baseState = protocol.validateBase(base)
    if (typeof baseState === "string") throw new Error("base rejected")
    const candidate = rawCloneProjectIndexYDoc(base)
    candidate.getMap("empty-extra-root")

    expect(protocol.applyIntent(baseState, candidate, stage.context, stage.intent, emptyOwnerFacts())).toBe("rejected")
    expect(projectIndexChildMap(candidate, "canvasRoutes").size).toBe(0)
  })

  test("owner-only reducer is byte-equivalent to the fully validated public reducer", () => {
    const protocol = ownerProtocol()
    const base = genesis()
    const context = draftContext(actor(12), id128(121), "1")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(base), context, shardEpoch: id128(122), title: "Equivalent",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(context, staged.intent)
    const baseVector = Y.encodeStateVector(base)
    const publicCandidate = rawCloneProjectIndexYDoc(base)
    const ownerCandidate = rawCloneProjectIndexYDoc(base)
    const deterministicClientId = 0x5a17c0de
    publicCandidate.clientID = deterministicClientId
    ownerCandidate.clientID = deterministicClientId

    const publicResult = applyProjectIndexCandidateIntent(publicCandidate, stage.context, stage.intent, facts)
    const baseState = protocol.validateBase(base)
    if (typeof baseState === "string") throw new Error("base rejected")
    const ownerResult = protocol.applyIntent(baseState, ownerCandidate, stage.context, stage.intent, emptyOwnerFacts())
    if (publicResult === "rejected" || ownerResult === "rejected" || ownerResult === "pending") throw new Error("equivalence apply rejected")
    const wrappedPublicResult = { owner: "project-index", value: { result: publicResult, scope: stage.context.scope } } as never

    expect(Y.encodeStateAsUpdate(ownerCandidate, baseVector)).toEqual(Y.encodeStateAsUpdate(publicCandidate, baseVector))
    expect(protocol.deriveActualWriteEvidence(ownerResult)).toEqual(protocol.deriveActualWriteEvidence(wrappedPublicResult))
    expect(protocol.canonicalStateBytes(ownerCandidate)).toEqual(protocol.canonicalStateBytes(publicCandidate))
  })

  test("drops views first captured after an outer transaction started", () => {
    const validateProtocol = ownerProtocol()
    const deleted = genesis()
    let calls: (() => number) | undefined
    deleted.transact(() => {
      calls = countFullProjectIndexValidations(deleted)
      expect(validateProtocol.validateBase(deleted)).not.toBe("rejected")
      projectIndexChildMap(deleted, "entries").delete(rootDirectoryId)
    })
    expect(validateProtocol.validateBase(deleted)).toBe("rejected")
    expect(calls?.()).toBe(2)

    const canonicalProtocol = ownerProtocol()
    const changed = genesis()
    let during: Uint8Array | "rejected" = "rejected"
    changed.transact(() => {
      during = canonicalProtocol.canonicalStateBytes(changed)
      const identity = projectIndexChildMap(changed, "identity").get("project") as Record<string, unknown>
      projectIndexChildMap(changed, "identity").set("project", {
        ...identity,
        protocolDigest: digest("outer-transaction-protocol"),
      })
    })
    const after = canonicalProtocol.canonicalStateBytes(changed)
    expect(during).not.toBe("rejected")
    expect(after).not.toBe("rejected")
    expect(after).not.toEqual(during)
  })

  test("requires exact guards for directory and file create", () => {
    const document = genesis()
    const directoryContext = draftContext(actor(5), id128(71), "1")
    const directoryId = deriveProjectIdentity(directoryContext, "directory", "0" as Uint32) as `pd_${string}`
    const locationId = deriveProjectIdentity(directoryContext, "location", "1" as Uint32) as `pl_${string}`
    const directoryIntent = {
      format: "convax.typed-intent",
      kind: "project.directory.create",
      guards: [],
      body: {
        entry: {
          format: "convax.project-entry",
          entryId: directoryId,
          kind: "directory",
          storageClass: null,
          contentPolicy: "none",
          provenance: "user",
          conflictSource: null,
          createdByActorId: directoryContext.actorId,
          createdByOperationId: directoryContext.operationId,
          createdStamp: stamp(directoryContext, "0"),
        },
        location: {
          format: "convax.project-entry-location",
          claimId: locationId,
          entryId: directoryId,
          state: "linked",
          parentDirectoryId: rootDirectoryId,
          basename: "Scenes",
          reason: "create",
          stamp: stamp(directoryContext, "1"),
        },
      },
    } as ProjectIndexIntent
    const emptyDirectory = withDigest(directoryContext, directoryIntent)
    expect(applyProjectIndexCandidateIntent(cloneProjectIndexYDoc(document), emptyDirectory.context, emptyDirectory.intent, facts)).toBe("rejected")
    const guardedDirectory = materializeProjectIndexIntentGuards({
      snapshot: validateProjectIndexYDoc(document), context: directoryContext, intent: directoryIntent,
    })
    if (guardedDirectory === "rejected") throw new Error("directory guards rejected")
    const builtDirectory = withDigest(directoryContext, guardedDirectory)
    expect(applyProjectIndexCandidateIntent(document, builtDirectory.context, builtDirectory.intent, facts)).not.toBe("rejected")

    const fileContext = draftContext(actor(5), id128(72), "2")
    const fileId = deriveProjectIdentity(fileContext, "file", "0" as Uint32) as `pf_${string}`
    const fileLocationId = deriveProjectIdentity(fileContext, "location", "1" as Uint32) as `pl_${string}`
    const versionId = deriveProjectIdentity(fileContext, "version", "2" as Uint32) as `pv_${string}`
    const blob = blobRef("guarded-create")
    const fileIntent = {
      format: "convax.typed-intent",
      kind: "project.file.create",
      guards: [],
      body: {
        entry: {
          format: "convax.project-entry", entryId: fileId, kind: "file", storageClass: "project-file",
          contentPolicy: "immutable", provenance: "user", conflictSource: null,
          createdByActorId: fileContext.actorId, createdByOperationId: fileContext.operationId,
          createdStamp: stamp(fileContext, "0"),
        },
        location: {
          format: "convax.project-entry-location", claimId: fileLocationId, entryId: fileId,
          state: "linked", parentDirectoryId: directoryId, basename: "shot.md", reason: "create",
          stamp: stamp(fileContext, "1"),
        },
        initialVersion: version(fileId, versionId, "initial", blob, [], null, fileContext, "2"),
      },
    } as ProjectIndexIntent
    const emptyFile = withDigest(fileContext, fileIntent)
    expect(applyProjectIndexCandidateIntent(cloneProjectIndexYDoc(document), emptyFile.context, emptyFile.intent, facts)).toBe("rejected")
    const guardedFile = materializeProjectIndexIntentGuards({
      snapshot: validateProjectIndexYDoc(document), context: fileContext, intent: fileIntent,
    })
    if (guardedFile === "rejected") throw new Error("file guards rejected")
    const builtFile = withDigest(fileContext, guardedFile)
    expect(applyProjectIndexCandidateIntent(document, builtFile.context, builtFile.intent, facts)).not.toBe("rejected")
  })

  test("requires current location and live-entry guards for locate and tombstone", () => {
    const document = genesis()
    const created = createFile(document, "conflict-preserving-text", actor(1), id128(73), "1", "move.md")
    const locateContext = draftContext(actor(2), id128(74), "2")
    const claimId = deriveProjectIdentity(locateContext, "location", "0" as Uint32) as `pl_${string}`
    const locateIntent = {
      format: "convax.typed-intent", kind: "project.entry.locate", guards: [],
      body: { location: {
        format: "convax.project-entry-location", claimId, entryId: created.fileId,
        state: "linked", parentDirectoryId: rootDirectoryId, basename: "moved.md", reason: "move",
        stamp: stamp(locateContext, "0"),
      } },
    } as ProjectIndexIntent
    const emptyLocate = withDigest(locateContext, locateIntent)
    expect(applyProjectIndexCandidateIntent(cloneProjectIndexYDoc(document), emptyLocate.context, emptyLocate.intent, facts)).toBe("rejected")
    const guardedLocate = materializeProjectIndexIntentGuards({ snapshot: validateProjectIndexYDoc(document), context: locateContext, intent: locateIntent })
    if (guardedLocate === "rejected") throw new Error("locate guards rejected")
    const builtLocate = withDigest(locateContext, guardedLocate)
    expect(applyProjectIndexCandidateIntent(document, builtLocate.context, builtLocate.intent, facts)).not.toBe("rejected")

    const tombstoneContext = draftContext(actor(2), id128(75), "3")
    const tombstoneId = deriveProjectIdentity(tombstoneContext, "tombstone", "0" as Uint32) as `pt_${string}`
    const entry = validateProjectIndexYDoc(document).entries.get(created.fileId)!
    const tombstoneIntent = {
      format: "convax.typed-intent", kind: "project.entry.tombstone", guards: [],
      body: { tombstone: {
        format: "convax.project-entry-tombstone", tombstoneId, entryId: created.fileId,
        reason: "explicit-delete", observedEntryDigest: projectIndexRecordDigest(entry),
        stamp: stamp(tombstoneContext, "0"),
      } },
    } as ProjectIndexIntent
    const emptyTombstone = withDigest(tombstoneContext, tombstoneIntent)
    expect(applyProjectIndexCandidateIntent(cloneProjectIndexYDoc(document), emptyTombstone.context, emptyTombstone.intent, facts)).toBe("rejected")
    const guardedTombstone = materializeProjectIndexIntentGuards({ snapshot: validateProjectIndexYDoc(document), context: tombstoneContext, intent: tombstoneIntent })
    if (guardedTombstone === "rejected") throw new Error("tombstone guards rejected")
    const builtTombstone = withDigest(tombstoneContext, guardedTombstone)
    expect(applyProjectIndexCandidateIntent(document, builtTombstone.context, builtTombstone.intent, facts)).not.toBe("rejected")
  })

  test("requires exact family-head guards for text writes and binary overwrites", () => {
    const textDocument = genesis()
    const textCreated = createFile(textDocument, "conflict-preserving-text", actor(1), id128(76), "1", "guarded.md")
    const textContext = draftContext(actor(2), id128(77), "2")
    const textVersionId = deriveProjectIdentity(textContext, "version", "0" as Uint32) as `pv_${string}`
    const conflictFileId = deriveProjectIdentity(textContext, "file", "1" as Uint32) as `pf_${string}`
    const conflictCopyId = deriveProjectIdentity(textContext, "conflictCopy", "2" as Uint32) as `pp_${string}`
    const reservationId = deriveProjectIdentity(textContext, "reservation", "3" as Uint32) as `pr_${string}`
    const textVersion = version(textCreated.fileId, textVersionId, "text-write", blobRef("guarded-text"), [textCreated.initialVersionId], null, textContext, "0")
    const textIntent = {
      format: "convax.typed-intent", kind: "project.file.write-text", guards: [],
      body: {
        version: textVersion,
        conflictEntry: {
          format: "convax.project-entry", entryId: conflictFileId, kind: "file", storageClass: "project-file",
          contentPolicy: "conflict-preserving-text", provenance: "content-conflict-copy",
          conflictSource: { primaryFileId: textCreated.fileId, sourceVersionId: textVersionId, conflictCopyId, reservationId },
          createdByActorId: textContext.actorId, createdByOperationId: textContext.operationId,
          createdStamp: stamp(textContext, "1"),
        },
        conflictCopy: {
          format: "convax.project-content-conflict-copy", conflictCopyId, primaryFileId: textCreated.fileId,
          versionId: textVersionId, reservedConflictFileId: conflictFileId, reservationId,
          stamp: stamp(textContext, "2"),
        },
        reservation: {
          format: "convax.project-path-reservation", reservationId, kind: "content-conflict-copy",
          primaryFileId: textCreated.fileId, versionId: textVersionId, reservedEntryId: conflictFileId,
          canonicalPath: `.convax-conflicts/${conflictFileId}/content`, originalBasenameHint: "guarded.md",
          stamp: stamp(textContext, "3"),
        },
      },
    } as ProjectIndexIntent
    const emptyText = withDigest(textContext, textIntent)
    expect(applyProjectIndexCandidateIntent(cloneProjectIndexYDoc(textDocument), emptyText.context, emptyText.intent, facts)).toBe("rejected")
    const guardedText = materializeProjectIndexIntentGuards({ snapshot: validateProjectIndexYDoc(textDocument), context: textContext, intent: textIntent })
    if (guardedText === "rejected") throw new Error("text guards rejected")
    const staleText = withDigest(textContext, {
      ...guardedText,
      guards: guardedText.guards.map((guard) => guard.kind === "family-live-heads"
        ? { ...guard, projectionDigest: digest("stale-family") }
        : guard),
    })
    expect(applyProjectIndexCandidateIntent(cloneProjectIndexYDoc(textDocument), staleText.context, staleText.intent, facts)).toBe("rejected")
    const builtText = withDigest(textContext, guardedText)
    expect(applyProjectIndexCandidateIntent(textDocument, builtText.context, builtText.intent, facts)).not.toBe("rejected")

    const binaryDocument = genesis()
    const binaryCreated = createFile(binaryDocument, "overwritable-binary", actor(1), id128(78), "1", "guarded.png")
    const binaryContext = draftContext(actor(3), id128(79), "2")
    const binaryVersionId = deriveProjectIdentity(binaryContext, "version", "0" as Uint32) as `pv_${string}`
    const binaryIntent = {
      format: "convax.typed-intent", kind: "project.file.overwrite-binary", guards: [],
      body: { version: version(binaryCreated.fileId, binaryVersionId, "binary-overwrite", blobRef("guarded-binary"), [binaryCreated.initialVersionId], "1", binaryContext, "0") },
    } as ProjectIndexIntent
    const emptyBinary = withDigest(binaryContext, binaryIntent)
    expect(applyProjectIndexCandidateIntent(cloneProjectIndexYDoc(binaryDocument), emptyBinary.context, emptyBinary.intent, facts)).toBe("rejected")
    const guardedBinary = materializeProjectIndexIntentGuards({ snapshot: validateProjectIndexYDoc(binaryDocument), context: binaryContext, intent: binaryIntent })
    if (guardedBinary === "rejected") throw new Error("binary guards rejected")
    const builtBinary = withDigest(binaryContext, guardedBinary)
    expect(applyProjectIndexCandidateIntent(binaryDocument, builtBinary.context, builtBinary.intent, facts)).not.toBe("rejected")
  })

  test("rejects empty, stale or widened route guards and a staged-route rename attack", () => {
    const document = genesis()
    const stageContext = draftContext(actor(2), id128(51), "2")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(document),
      context: stageContext,
      shardEpoch: id128(52),
      title: "Guarded",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    expect(staged.intent.guards).toHaveLength(3)

    const emptyGuardStage = withDigest(stageContext, { ...staged.intent, guards: [] })
    expect(
      applyProjectIndexCandidateIntent(
        cloneProjectIndexYDoc(document),
        emptyGuardStage.context,
        emptyGuardStage.intent,
        facts,
      ),
    ).toBe("rejected")
    const widenedGuardStage = withDigest(stageContext, {
      ...staged.intent,
      guards: staged.intent.guards.map((guard) =>
        guard.kind === "route-state" ? { ...guard, extension: true } : guard,
      ),
    } as unknown as ProjectIndexIntent)
    expect(
      applyProjectIndexCandidateIntent(
        cloneProjectIndexYDoc(document),
        widenedGuardStage.context,
        widenedGuardStage.intent,
        facts,
      ),
    ).toBe("rejected")

    const stage = withDigest(stageContext, staged.intent)
    expect(applyProjectIndexCandidateIntent(document, stage.context, stage.intent, facts)).not.toBe("rejected")
    const snapshot = validateProjectIndexYDoc(document)
    const projection = projectCanvasRouteProjection(snapshot, staged.canvasId)
    expect(projectCanvasRouteProjectionDigest(projection)).toMatch(/^[0-9a-f]{64}$/)

    const mutationContext = draftContext(actor(3), id128(53), "3")
    const tombstone = constructProjectCanvasRouteTombstoneIntent({
      snapshot,
      context: mutationContext,
      canvasId: staged.canvasId,
    })
    if (tombstone === "rejected") throw new Error("tombstone construction rejected")
    const staleGuardTombstone = withDigest(mutationContext, {
      ...tombstone,
      guards: tombstone.guards.map((guard) =>
        guard.kind === "route-state" ? { ...guard, projectionDigest: digest("stale-route") } : guard,
      ),
    })
    expect(
      applyProjectIndexCandidateIntent(
        cloneProjectIndexYDoc(document),
        staleGuardTombstone.context,
        staleGuardTombstone.intent,
        facts,
      ),
    ).toBe("rejected")

    const stagedRename = withDigest(mutationContext, {
      format: "convax.typed-intent",
      kind: "project.canvas.route.rename",
      guards: tombstone.guards,
      body: {
        metadata: {
          format: "convax.canvas-route-metadata",
          transitionId: deriveProjectIdentity(mutationContext, "route-transition", "0" as Uint32),
          canvasId: staged.canvasId,
          title: "Must not rename staged",
          observedActivationDigest: digest("invented-activation"),
          stamp: stamp(mutationContext, "0"),
        },
      },
    } as ProjectIndexIntent)
    expect(
      applyProjectIndexCandidateIntent(
        cloneProjectIndexYDoc(document),
        stagedRename.context,
        stagedRename.intent,
        facts,
      ),
    ).toBe("rejected")
  })

  test("accepts only an exactly cross-bound authorized route reset and projects one live shard", () => {
    const document = genesis()
    const stageContext = draftContext(actor(2), id128(61), "2")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(document),
      context: stageContext,
      shardEpoch: id128(62),
      title: "Resettable",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(stageContext, staged.intent)
    expect(applyProjectIndexCandidateIntent(document, stage.context, stage.intent, facts)).not.toBe("rejected")

    const activationContext = draftContext(actor(2), id128(63), "3")
    const activationValue = constructProjectCanvasRouteActivationIntent({
      snapshot: validateProjectIndexYDoc(document),
      context: activationContext,
      canvasId: staged.canvasId,
      projectIndexRouteDependencyFrameDigest: digest("reset-stage-frame"),
      canvasGenesisCheckpointObjectDigest: digest("reset-initial-genesis"),
      stagedProjectIndexFrontierDigest: digest("reset-stage-frontier"),
    })
    if (activationValue === "rejected") throw new Error("activation construction rejected")
    const activation = withDigest(activationContext, activationValue)
    expect(applyProjectIndexCandidateIntent(document, activation.context, activation.intent, facts)).not.toBe("rejected")

    const snapshot = validateProjectIndexYDoc(document)
    const current = projectCanvasRouteProjection(snapshot, staged.canvasId)
    if (current.currentActivationDigest === null || current.currentShardEpoch === null) {
      throw new Error("live route projection missing")
    }
    const resetContext = draftContext(actor(2), id128(64), "4")
    const newShardEpoch = id128(65)
    const oldScope = {
      ...resetContext.scope,
      docKind: "canvas" as const,
      docId: staged.canvasId,
      shardEpoch: current.currentShardEpoch,
    }
    const newScope = { ...oldScope, shardEpoch: newShardEpoch }
    const routeCasCore = {
      format: "convax.document-shard-reset-route-cas-core" as const,
      operationId: resetContext.operationId,
      canvasId: staged.canvasId,
      oldScope,
      newScope,
      predecessorActivationDigest: current.currentActivationDigest,
      stagedGenesisCheckpointObjectDigest: digest("reset-genesis-checkpoint"),
      stagedGenesisFullUpdateDigest: digest("reset-genesis-update"),
      stagedGenesisStateVectorDigest: digest("reset-genesis-vector"),
    }
    const routeCasCoreDigest = structuredDigest(
      "convax.document-shard-reset-route-cas-core-digest",
      routeCasCore,
    )
    const initiatorMemberId = parseMemberId(id128(66))
    const initiatorReplicaId = parseReplicaId("replica_00000042")
    const adminMemberId = parseMemberId(id128(67))
    const adminCapabilityCoreDigest = digest("reset-admin-capability")
    const reason = "incompatible-canvas-schema" as const
    const confirmationCore = {
      format: "convax.document-shard-reset-confirmation-core" as const,
      confirmationId: id128(68),
      projectId: resetContext.scope.projectId,
      projectEpoch: resetContext.scope.projectEpoch,
      oldScope,
      newScope,
      reason,
      routeCasCoreDigest,
      predecessorActivationDigest: current.currentActivationDigest,
      stagedGenesisCheckpointObjectDigest: routeCasCore.stagedGenesisCheckpointObjectDigest,
      stagedGenesisFullUpdateDigest: routeCasCore.stagedGenesisFullUpdateDigest,
      stagedGenesisStateVectorDigest: routeCasCore.stagedGenesisStateVectorDigest,
      initiatorMemberId,
      initiatorReplicaId,
      initiatorActorId: resetContext.actorId,
      initiatorActorCredentialCoreDigest: digest("reset-actor-credential"),
      confirmationStatement: "replace-one-canvas-shard-and-retain-old-recovery-bytes" as const,
      protocolDigest,
    }
    const confirmation = {
      format: "convax.document-shard-reset-confirmation" as const,
      core: confirmationCore,
      coreDigest: structuredDigest("convax.document-shard-reset-confirmation-core", confirmationCore),
      initiatorReplicaSignature: signature(),
    }
    const claimCore = {
      format: "convax.document-shard-reset-claim-core" as const,
      projectIndexScope: resetContext.scope as never,
      oldScope,
      newScope,
      reason,
      oldProtocolDigest: protocolDigest,
      newProtocolDigest: protocolDigest,
      oldSchemaDigest: digest("old-canvas-schema"),
      newSchemaDigest: digest("new-canvas-schema"),
      stagedGenesisCheckpointObjectDigest: routeCasCore.stagedGenesisCheckpointObjectDigest,
      stagedGenesisFullUpdateDigest: routeCasCore.stagedGenesisFullUpdateDigest,
      stagedGenesisStateVectorDigest: routeCasCore.stagedGenesisStateVectorDigest,
      routeCasCoreDigest,
      initiatorMemberId,
      initiatorReplicaId,
      initiatorActorId: resetContext.actorId,
      adminMemberId,
      adminAuthorizationDigest: adminCapabilityCoreDigest,
      explicitConfirmationReceiptDigest: confirmation.coreDigest,
    }
    const claimCoreDigest = structuredDigest(
      "convax.document-shard-reset-claim-core-digest",
      claimCore,
    )
    const approvalCore = {
      format: "convax.document-shard-reset-approval-core" as const,
      approvalId: id128(69),
      resetClaimCoreDigest: claimCoreDigest,
      confirmationCoreDigest: confirmation.coreDigest,
      projectId: resetContext.scope.projectId,
      projectEpoch: resetContext.scope.projectEpoch,
      oldScope,
      newScope,
      reason,
      routeCasCoreDigest,
      adminMemberId,
      adminMemberAuthorizationEpoch: id128(70),
      adminCapabilityCoreDigest,
      approvalStatement: "approve-exact-canvas-shard-reset" as const,
      protocolDigest,
    }
    const approval = {
      format: "convax.document-shard-reset-approval" as const,
      core: approvalCore,
      coreDigest: structuredDigest("convax.document-shard-reset-approval-core", approvalCore),
      adminMemberSignature: signature(),
    }
    const resetClaim = {
      format: "convax.document-shard-reset-claim" as const,
      core: claimCore,
      coreDigest: claimCoreDigest,
      initiatorSignature: signature(),
      adminApprovalDigest: approval.coreDigest,
    }
    const resetValue = constructProjectCanvasRouteResetIntent({
      snapshot,
      context: resetContext,
      routeCasCore,
      resetClaim,
      confirmation,
      approval,
    })
    if (resetValue === "rejected") throw new Error("reset construction rejected")
    const reset = withDigest(resetContext, resetValue)
    const beforeReset = cloneProjectIndexYDoc(document)
    expect(applyProjectIndexCandidateIntent(document, reset.context, reset.intent, facts)).not.toBe("rejected")
    expect(projectCanvasRouteProjection(validateProjectIndexYDoc(document), staged.canvasId)).toMatchObject({
      state: "live",
      currentActivationDigest: projectIndexRecordDigest(resetValue.body.resetCommit),
      currentShardEpoch: newShardEpoch,
      ancestryRecordDigests: [
        expect.any(String),
        current.currentActivationDigest,
        projectIndexRecordDigest(resetValue.body.resetCommit),
      ],
    })

    const attacked = withDigest(resetContext, {
      ...resetValue,
      body: {
        ...resetValue.body,
        resetCommit: {
          ...resetValue.body.resetCommit,
          approvalCoreDigest: digest("swapped-approval"),
        },
      },
    })
    expect(
      applyProjectIndexCandidateIntent(
        cloneProjectIndexYDoc(beforeReset),
        attacked.context,
        attacked.intent,
        facts,
      ),
    ).toBe("rejected")
  })

  test("converges under opposite arrival order while retaining a concurrent text conflict copy", () => {
    const base = genesis()
    const created = createFile(base, "conflict-preserving-text", actor(1), id128(11), "1", "notes.md")
    const left = cloneProjectIndexYDoc(base)
    const right = cloneProjectIndexYDoc(base)
    const leftWrite = textWrite(left, created.fileId, created.initialVersionId, actor(2), id128(12), "2", "left")
    const rightWrite = textWrite(right, created.fileId, created.initialVersionId, actor(3), id128(13), "2", "right")

    const mergedLeftFirst = cloneProjectIndexYDoc(base)
    Y.applyUpdate(mergedLeftFirst, Y.encodeStateAsUpdate(left), "left-first")
    Y.applyUpdate(mergedLeftFirst, Y.encodeStateAsUpdate(right), "right-second")
    const mergedRightFirst = cloneProjectIndexYDoc(base)
    Y.applyUpdate(mergedRightFirst, Y.encodeStateAsUpdate(right), "right-first")
    Y.applyUpdate(mergedRightFirst, Y.encodeStateAsUpdate(left), "left-second")

    expect(projectProjectIndex(mergedLeftFirst)).toEqual(projectProjectIndex(mergedRightFirst))
    expect(encodeProjectCanonicalState(mergedLeftFirst)).toEqual(encodeProjectCanonicalState(mergedRightFirst))
    const family = projectProjectIndex(mergedLeftFirst).contentFamilies[0]!
    const expectedCurrent = rightWrite.actorId > leftWrite.actorId ? rightWrite.versionId : leftWrite.versionId
    expect(family.currentVersionId).toBe(expectedCurrent)
    expect(family.liveHeadVersionIds).toEqual([leftWrite.versionId, rightWrite.versionId].sort())
    expect(family.activeConflictFileIds).toHaveLength(1)
    const currentBlobRoots = projectIndexCurrentBlobReferences(mergedLeftFirst)
    expect(currentBlobRoots).toHaveLength(2)
    expect(currentBlobRoots.map((reference) => reference.entryFileId).sort()).toEqual([
      created.fileId,
      family.activeConflictFileIds[0],
    ].sort())
    expect(() => parseProjectIndexResourceReference({
      ...currentBlobRoots[0],
      canonicalUri: currentBlobRoots[0]!.canonicalUri.replace(currentBlobRoots[0]!.blob.digest, "0".repeat(64)),
    })).toThrow("binding")
  })

  test("Canvas tombstone dominates a late concurrent activation in either arrival order", () => {
    const genesisDoc = genesis()
    const stageContext = draftContext(actor(2), id128(21), "2")
    const staged = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(genesisDoc),
      context: stageContext,
      shardEpoch: id128(22),
      title: "Team Canvas",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const canvasId = staged.canvasId
    const stageIntent = withDigest(stageContext, staged.intent)
    const stageDoc = cloneProjectIndexYDoc(genesisDoc)
    expect(applyProjectIndexCandidateIntent(stageDoc, stageIntent.context, stageIntent.intent, facts)).not.toBe("rejected")

    const activationContext = draftContext(actor(4), id128(24), "3")
    const activationIntentValue = constructProjectCanvasRouteActivationIntent({
      snapshot: validateProjectIndexYDoc(stageDoc),
      context: activationContext,
      canvasId,
      projectIndexRouteDependencyFrameDigest: digest("stage-frame"),
      canvasGenesisCheckpointObjectDigest: digest("canvas-genesis"),
      stagedProjectIndexFrontierDigest: digest("staged-frontier"),
    })
    if (activationIntentValue === "rejected") throw new Error("activation construction rejected")
    const activationIntent = withDigest(activationContext, activationIntentValue)
    const activationDoc = cloneProjectIndexYDoc(stageDoc)
    expect(applyProjectIndexCandidateIntent(activationDoc, activationIntent.context, activationIntent.intent, facts)).not.toBe("rejected")

    const deleteContext = draftContext(actor(3), id128(23), "3")
    const deleteIntentValue = constructProjectCanvasRouteTombstoneIntent({
      snapshot: validateProjectIndexYDoc(stageDoc),
      context: deleteContext,
      canvasId,
    })
    if (deleteIntentValue === "rejected") throw new Error("tombstone construction rejected")
    const deleteIntent = withDigest(deleteContext, deleteIntentValue)
    const deleteDoc = cloneProjectIndexYDoc(stageDoc)
    expect(applyProjectIndexCandidateIntent(deleteDoc, deleteIntent.context, deleteIntent.intent, facts)).not.toBe("rejected")

    const one = cloneProjectIndexYDoc(stageDoc)
    Y.applyUpdate(one, Y.encodeStateAsUpdate(activationDoc)); Y.applyUpdate(one, Y.encodeStateAsUpdate(deleteDoc))
    const two = cloneProjectIndexYDoc(stageDoc)
    Y.applyUpdate(two, Y.encodeStateAsUpdate(deleteDoc)); Y.applyUpdate(two, Y.encodeStateAsUpdate(activationDoc))
    expect(projectProjectIndex(one)).toEqual(projectProjectIndex(two))
    expect(projectProjectIndex(one).canvasRoutes).toEqual([
      expect.objectContaining({
        canvasId,
        state: "tombstoned",
        currentShardEpoch: null,
        currentActivationDigest: null,
        currentTitle: null,
      }),
    ])
  })

  test("selects overwritable binary current by logical counter then actorId, never arrival order", () => {
    const base = genesis()
    const created = createFile(base, "overwritable-binary", actor(1), id128(31), "1", "cover.png")
    const low = cloneProjectIndexYDoc(base)
    const high = cloneProjectIndexYDoc(base)
    const lowWrite = binaryWrite(low, created.fileId, created.initialVersionId, actor(2), id128(32), "2")
    const highWrite = binaryWrite(high, created.fileId, created.initialVersionId, actor(4), id128(33), "2")
    const merged = cloneProjectIndexYDoc(base)
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(high)); Y.applyUpdate(merged, Y.encodeStateAsUpdate(low))
    const family = projectProjectIndex(merged).contentFamilies[0]
    expect(family?.currentVersionId).toBe(highWrite.versionId)
    expect(family?.currentVersionId).not.toBe(lowWrite.versionId)
    expect(family?.currentResourceReference).toMatchObject({
      entryFileId: created.fileId,
      familyPrimaryFileId: created.fileId,
      versionId: highWrite.versionId,
    })
    expect(family?.currentResourceReference?.canonicalUri).toContain(`entries/${created.fileId}?blob=sha256%3A`)
    expect(family?.currentResourceReferenceDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  test("extracts the exact Project blob closure while route intents require no blobs", () => {
    const document = genesis()
    const created = createFile(document, "conflict-preserving-text", actor(3), id128(70), "1", "notes.md")
    expect(requiredProjectIndexBlobDigests(frameFor(created.intent))).toEqual([created.blobDigest])

    const routeContext = draftContext(actor(3), id128(71), "2")
    const stage = constructProjectCanvasRouteStageIntent({
      snapshot: validateProjectIndexYDoc(document), context: routeContext, shardEpoch: id128(72), title: "Canvas",
    })
    if (stage === "rejected") throw new Error("stage construction rejected")
    expect(requiredProjectIndexBlobDigests(frameFor(stage.intent))).toEqual([])
  })
})

function genesis(): Y.Doc {
  const genesisContext = draftContext(actor(1), id128(1), "0")
  const rootEntry: ProjectEntryRecord = {
    format: "convax.project-entry", entryId: rootDirectoryId, kind: "directory", storageClass: null,
    contentPolicy: "none", provenance: "project-root", conflictSource: null,
    createdByActorId: genesisContext.actorId, createdByOperationId: genesisContext.operationId,
    createdStamp: stamp(genesisContext, "0"),
  }
  return createProjectIndexYDoc({
    format: "convax.project-index-identity", schema: "convax.project-index.v2", projectId: "project-a" as never,
    projectEpoch, shardEpoch, rootDirectoryId, protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST, uriProtocolDigest,
    migrationImportBaseProofDigest: null,
  }, rootEntry)
}

function createFile(doc: Y.Doc, policy: "conflict-preserving-text" | "overwritable-binary", actorId: ActorId, operationId: Id128, lamport: string, basename: string) {
  const draft = draftContext(actorId, operationId, lamport)
  const fileId = deriveProjectIdentity(draft, "file", "0" as Uint32) as ProjectEntryRecord["entryId"] & `pf_${string}`
  const locationId = deriveProjectIdentity(draft, "location", "1" as Uint32) as `pl_${string}`
  const versionId = deriveProjectIdentity(draft, "version", "2" as Uint32) as `pv_${string}`
  const entry: ProjectEntryRecord = { format: "convax.project-entry", entryId: fileId, kind: "file", storageClass: "project-file", contentPolicy: policy, provenance: "user", conflictSource: null, createdByActorId: actorId, createdByOperationId: operationId, createdStamp: stamp(draft, "0") }
  const blob = blobRef(`initial-${basename}`)
  const initialVersion: ProjectContentVersionRecord = version(fileId, versionId, "initial", blob, [], policy === "overwritable-binary" ? "0" : null, draft, "2")
  const unguarded = { format: "convax.typed-intent", kind: "project.file.create", guards: [], body: { entry, location: { format: "convax.project-entry-location", claimId: locationId, entryId: fileId, state: "linked", parentDirectoryId: rootDirectoryId, basename, reason: "create", stamp: stamp(draft, "1") }, initialVersion } } as ProjectIndexIntent
  const guarded = materializeProjectIndexIntentGuards({ snapshot: validateProjectIndexYDoc(doc), context: draft, intent: unguarded })
  if (guarded === "rejected") throw new Error("file create guard construction rejected")
  const built = withDigest(draft, guarded)
  const result = applyProjectIndexCandidateIntent(doc, built.context, built.intent, facts)
  if (result === "rejected") validateProjectIndexYDoc(doc)
  expect(result).not.toBe("rejected")
  return { fileId, initialVersionId: versionId, blobDigest: blob.digest, intent: built.intent }
}

function frameFor(intent: ProjectIndexIntent): DecodedCausalEditFrame {
  return {
    header: { core: { scope: draftContext(actor(9), id128(99), "9").scope, intentKind: intent.kind } },
    sections: { typedIntentJcs: encodeRestrictedJcs(intent) },
  } as unknown as DecodedCausalEditFrame
}

function textWrite(doc: Y.Doc, fileId: `pf_${string}`, parent: `pv_${string}`, actorId: ActorId, operationId: Id128, lamport: string, content: string) {
  const draft = draftContext(actorId, operationId, lamport)
  const versionId = deriveProjectIdentity(draft, "version", "0" as Uint32) as `pv_${string}`
  const conflictFileId = deriveProjectIdentity(draft, "file", "1" as Uint32) as `pf_${string}`
  const conflictCopyId = deriveProjectIdentity(draft, "conflictCopy", "2" as Uint32) as `pp_${string}`
  const reservationId = deriveProjectIdentity(draft, "reservation", "3" as Uint32) as `pr_${string}`
  const blob = blobRef(content)
  const versionRecord = version(fileId, versionId, "text-write", blob, [parent], null, draft, "0")
  const conflictEntry: ProjectEntryRecord = { format: "convax.project-entry", entryId: conflictFileId, kind: "file", storageClass: "project-file", contentPolicy: "conflict-preserving-text", provenance: "content-conflict-copy", conflictSource: { primaryFileId: fileId, sourceVersionId: versionId, conflictCopyId, reservationId }, createdByActorId: actorId, createdByOperationId: operationId, createdStamp: stamp(draft, "1") }
  const conflictCopy: ProjectContentConflictCopyRecord = { format: "convax.project-content-conflict-copy", conflictCopyId, primaryFileId: fileId, versionId, reservedConflictFileId: conflictFileId, reservationId, stamp: stamp(draft, "2") }
  const reservation: ProjectPathReservationRecord = { format: "convax.project-path-reservation", reservationId, kind: "content-conflict-copy", primaryFileId: fileId, versionId, reservedEntryId: conflictFileId, canonicalPath: `.convax-conflicts/${conflictFileId}/content`, originalBasenameHint: "notes.md", stamp: stamp(draft, "3") }
  const unguarded = { format: "convax.typed-intent", kind: "project.file.write-text", guards: [], body: { version: versionRecord, conflictEntry, conflictCopy, reservation } } as ProjectIndexIntent
  const guarded = materializeProjectIndexIntentGuards({ snapshot: validateProjectIndexYDoc(doc), context: draft, intent: unguarded })
  if (guarded === "rejected") throw new Error("text write guard construction rejected")
  const built = withDigest(draft, guarded)
  expect(applyProjectIndexCandidateIntent(doc, built.context, built.intent, facts)).not.toBe("rejected")
  return { versionId, actorId }
}

function binaryWrite(doc: Y.Doc, fileId: `pf_${string}`, parent: `pv_${string}`, actorId: ActorId, operationId: Id128, lamport: string) {
  const draft = draftContext(actorId, operationId, lamport)
  const versionId = deriveProjectIdentity(draft, "version", "0" as Uint32) as `pv_${string}`
  const record = version(fileId, versionId, "binary-overwrite", blobRef(versionId), [parent], "1", draft, "0")
  const unguarded = { format: "convax.typed-intent", kind: "project.file.overwrite-binary", guards: [], body: { version: record } } as ProjectIndexIntent
  const guarded = materializeProjectIndexIntentGuards({ snapshot: validateProjectIndexYDoc(doc), context: draft, intent: unguarded })
  if (guarded === "rejected") throw new Error("binary write guard construction rejected")
  const built = withDigest(draft, guarded)
  expect(applyProjectIndexCandidateIntent(doc, built.context, built.intent, facts)).not.toBe("rejected")
  return { versionId }
}

function version(fileId: `pf_${string}`, versionId: `pv_${string}`, writeClass: ProjectContentVersionRecord["writeClass"], blob: ProjectBlobRef, supersedesVersionIds: readonly `pv_${string}`[], binaryLogicalCounter: string | null, context: OwnerIntentValidationContext, ordinal: string): ProjectContentVersionRecord {
  return { format: "convax.project-content-version", primaryFileId: fileId, versionId, writeClass, blob, canonicalRevisionUri: fromProjectUri({ projectId: "project-a", projectEpoch, entryId: fileId, blob: `sha256:${blob.digest}` }).toString(), supersedesVersionIds, binaryLogicalCounter: binaryLogicalCounter as never, creatorActorId: context.actorId, creatorOperationId: context.operationId, stamp: stamp(context, ordinal) }
}

function withDigest<T extends ProjectIndexIntent>(context: OwnerIntentValidationContext, intent: T) {
  return { intent, context: { ...context, intentDigest: projectIndexIntentDigest(intent) } }
}

function ownerProtocol() {
  return selectedProjectIndexDocumentOwnerArtifactDefinition.createDefinitions(testOwnerProcessValues()).protocol
}

function countingOwnerProtocol() {
  let canonicalCalls = 0
  const definitions = selectedProjectIndexDocumentOwnerArtifactDefinition.createDefinitions(testOwnerProcessValues())
  return {
    protocol: {
      ...definitions.protocol,
      canonicalStateBytes(document: Y.Doc) {
        canonicalCalls += 1
        return definitions.protocol.canonicalStateBytes(document)
      },
    },
    calls: () => canonicalCalls,
    reset: () => { canonicalCalls = 0 },
  }
}

const testProjectIndexCommitmentDigestsByState = new WeakMap<object, Digest>()
let testProjectIndexCommitmentSequence = 0

function testOwnerProcessValues() {
  const commitments = new WeakMap<object, Digest>()
  const issue = (): OwnerStateCommitment => {
    const commitment = Object.freeze({}) as OwnerStateCommitment
    testProjectIndexCommitmentSequence += 1
    commitments.set(
      commitment as object,
      structuredDigest("convax.project-index-test-state-commitment", {
        format: "convax.project-index-test-state-commitment",
        sequence: String(testProjectIndexCommitmentSequence),
      }),
    )
    return commitment
  }
  const stateCommitment = Object.freeze({
    build: () => issue(),
    apply(base: OwnerStateCommitment) {
      if (!commitments.has(base as object)) throw new TypeError("Unknown test ProjectIndex commitment")
      return issue()
    },
    digest(commitment: OwnerStateCommitment) {
      const value = commitments.get(commitment as object)
      if (value === undefined) throw new TypeError("Unknown test ProjectIndex commitment")
      return value
    },
  }) satisfies OwnerStateCommitmentIssuer
  return {
    wrapValidatedState: (value: unknown) => Object.freeze({ owner: "project-index", value }),
    wrapApplyResult: (value: unknown) => Object.freeze({ owner: "project-index", value }),
    stateCommitment,
    bindStateCommitment(_document: Y.Doc, state: OwnerValidatedState<"project-index">, commitment: OwnerStateCommitment) {
      testProjectIndexCommitmentDigestsByState.set(state as object, stateCommitment.digest(commitment))
      return state
    },
  } as never
}

function testProjectIndexCommitmentDigest(state: OwnerValidatedState<"project-index">): Digest {
  const digest = testProjectIndexCommitmentDigestsByState.get(state as object)
  if (digest === undefined) throw new TypeError("Test ProjectIndex state has no bound commitment")
  return digest
}

function emptyOwnerFacts() {
  return {
    resolveFact() { throw new Error("unexpected ProjectIndex external fact") },
  } as never
}

function verifiedOwnerFacts() {
  return {
    resolveFact(requirement: { kind: string; factDigest: string; request: { sha256: string } }) {
      return {
        status: "resolved",
        requirement,
        value: {
          format: "convax.project-index-external-fact-result",
          kind: requirement.kind,
          requestSha256: requirement.request.sha256,
          factDigest: requirement.factDigest,
          decision: "verified",
        },
      }
    },
  } as never
}

function structuralCountDelta(
  before: ReturnType<typeof projectIndexCanonicalStructuralCounts>,
  after: ReturnType<typeof projectIndexCanonicalStructuralCounts>,
): ReturnType<typeof projectIndexCanonicalStructuralCounts> {
  return Object.fromEntries(
    Object.entries(before).map(([key, value]) => [
      key,
      after[key as keyof typeof after] - value,
    ]),
  ) as ReturnType<typeof projectIndexCanonicalStructuralCounts>
}

function projectIndexChildMap(document: Y.Doc, key: string): Y.Map<unknown> {
  const value = document.getMap("convax.project-index.v2").get(key)
  if (!(value instanceof Y.Map)) throw new Error(`${key} is missing`)
  return value
}

function countFullProjectIndexValidations(document: Y.Doc): () => number {
  const entries = projectIndexChildMap(document, "entries")
  const original = entries.entries.bind(entries)
  let calls = 0
  Object.defineProperty(entries, "entries", {
    configurable: true,
    value() {
      calls += 1
      return original()
    },
  })
  return () => calls
}

function countLargeCanonicalCollectionVisits(minimumSize: number): { calls(): number; restore(): void } {
  const original = Map.prototype.entries
  let calls = 0
  Map.prototype.entries = function entries<K, V>(this: Map<K, V>): MapIterator<[K, V]> {
    if (this.size >= minimumSize) calls += 1
    return original.call(this) as MapIterator<[K, V]>
  }
  return {
    calls: () => calls,
    restore() { Map.prototype.entries = original },
  }
}

function countLargeMapIteratorVisits(minimumSize: number): { calls(): number; restore(): void } {
  const original = Map.prototype[Symbol.iterator]
  let calls = 0
  Map.prototype[Symbol.iterator] = function iterator<K, V>(this: Map<K, V>): MapIterator<[K, V]> {
    if (this.size >= minimumSize) calls += 1
    return original.call(this) as MapIterator<[K, V]>
  }
  return {
    calls: () => calls,
    restore() { Map.prototype[Symbol.iterator] = original },
  }
}

function withRejectedProjectIndexSnapshotIteration(snapshot: ReturnType<typeof validateProjectIndexYDoc>, run: () => void): void {
  const prototypes = new Set(snapshotCollections(snapshot).map((collection) => Object.getPrototypeOf(collection) as object))
  const keys: readonly PropertyKey[] = ["entries", "keys", "values", "forEach", Symbol.iterator]
  const descriptors: Array<readonly [object, PropertyKey, PropertyDescriptor]> = []
  for (const prototype of prototypes) {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
      if (descriptor === undefined) continue
      descriptors.push([prototype, key, descriptor])
      Object.defineProperty(prototype, key, {
        configurable: true,
        value() { throw new Error("exact ProjectIndex lookup enumerated historical snapshot data") },
      })
    }
  }
  try {
    run()
  } finally {
    for (const [prototype, key, descriptor] of descriptors) {
      Object.defineProperty(prototype, key, descriptor)
    }
  }
}

function snapshotCollections(snapshot: ReturnType<typeof validateProjectIndexYDoc>): ReadonlyMap<string, unknown>[] {
  return [
    snapshot.entries,
    snapshot.entryLocations,
    snapshot.entryTombstones,
    snapshot.contentFamilies,
    snapshot.contentConflictCopies,
    snapshot.pathReservations,
    snapshot.canvasRoutes,
    snapshot.operations,
  ]
}

function rawCloneProjectIndexYDoc(document: Y.Doc): Y.Doc {
  const clone = new Y.Doc()
  clone.getMap("convax.project-index.v2")
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(document))
  return clone
}

function draftContext(actorId: ActorId, operationId: Id128, lamport: string): OwnerIntentValidationContext {
  return { scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch }, actorId, actorSequence: "1" as never, operationId, lamport: lamport as never, baseFrontierDigest: digest("frontier"), protocolDigest, ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST, validationArtifactSetDigest: digest("artifacts"), intentDigest: digest("draft") }
}

function stamp(context: OwnerIntentValidationContext, writeOrdinal: string): PortableStamp {
  return { format: "convax.portable-stamp", lamport: context.lamport, actorId: context.actorId, operationId: context.operationId, writeOrdinal: writeOrdinal as Uint32 }
}

function blobRef(seed: string): ProjectBlobRef {
  return { format: "convax.blob-ref", algorithm: "sha256", digest: digest(seed), byteLength: String(seed.length) as never, mime: "application/octet-stream" }
}

function digest(seed: string): Digest {
  const bytes = new TextEncoder().encode(seed)
  return Array.from(new Uint8Array(awaitlessSha(bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("") as Digest
}

function awaitlessSha(bytes: Uint8Array): ArrayBuffer {
  // Tests need only deterministic valid digest-shaped values; this is deliberately not protocol hashing.
  const result = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) result[index % 32] = (result[index % 32]! + bytes[index]! + index) & 0xff
  return result.buffer
}

function id128(byte: number): Id128 { return Buffer.alloc(16, byte).toString("base64url") as Id128 }
function actor(byte: number): ActorId { return Buffer.alloc(32, byte).toString("base64url") as ActorId }
function signature() {
  return parseSignature(
    encodeBase64url(
      Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0),
    ),
  )
}

// Keep the JCS codec exercised by the convergence fixture and silence accidental non-JCS additions.
void encodeRestrictedJcs
