import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  parseMemberIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  structuredDigestV2,
  type ActorIdV2,
  type DigestV2,
  type DecodedCausalEditFrameV2,
  type Id128V2,
  type OwnerIntentValidationContextV2,
  type PortableStampV2,
  type Uint32V2,
} from "@convax/collaboration"
import { fromProjectUri } from "@convax/uri"
import * as Y from "yjs"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  applyProjectIndexCandidateIntentV2,
  cloneProjectIndexYDocV2,
  constructProjectCanvasRouteActivationIntentV2,
  constructProjectCanvasRouteRenameIntentV2,
  constructProjectCanvasRouteResetIntentV2,
  constructProjectCanvasRouteStageIntentV2,
  constructProjectCanvasRouteTombstoneIntentV2,
  createProjectIndexYDocV2,
  deriveProjectIdentityV2,
  encodeProjectCanonicalStateV2,
  materializeProjectIndexIntentGuardsV2,
  projectCanvasRouteProjectionDigestV2,
  projectCanvasRouteProjectionV2,
  projectIndexIntentDigestV2,
  projectIndexCurrentBlobReferencesV2,
  parseProjectResourceReferenceV2,
  projectIndexRecordDigestV2,
  requiredProjectIndexBlobDigestsV2,
  projectProjectIndexV2,
  selectedProjectIndexDocumentOwnerArtifactDefinitionV2,
  validateProjectIndexYDocV2,
  type ProjectBlobRefV2,
  type ProjectContentPromotionRecordV2,
  type ProjectContentVersionRecordV2,
  type ProjectEntryRecordV2,
  type ProjectIndexIntentV2,
  type ProjectPathReservationRecordV2,
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

describe("ProjectIndex R5 owner schema", () => {
  test("constructs the closed stage, activation, rename and tombstone route intents from the exact base", () => {
    const document = genesis()
    const stageContext = draftContext(actor(2), id128(41), "2")
    const staged = constructProjectCanvasRouteStageIntentV2({
      snapshot: validateProjectIndexYDocV2(document),
      context: stageContext,
      shardEpoch: id128(42),
      title: "Team Canvas",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(stageContext, staged.intent)
    expect(applyProjectIndexCandidateIntentV2(document, stage.context, stage.intent, facts)).not.toBe("rejected")

    const activationContext = draftContext(actor(2), id128(43), "3")
    const activationIntent = constructProjectCanvasRouteActivationIntentV2({
      snapshot: validateProjectIndexYDocV2(document),
      context: activationContext,
      canvasId: staged.canvasId,
      projectIndexRouteDependencyFrameDigest: digest("stage-frame"),
      canvasGenesisCheckpointObjectDigest: digest("canvas-genesis"),
      stagedProjectIndexFrontierDigest: digest("stage-frontier"),
    })
    if (activationIntent === "rejected") throw new Error("activation construction rejected")
    const activation = withDigest(activationContext, activationIntent)
    expect(applyProjectIndexCandidateIntentV2(document, activation.context, activation.intent, facts)).not.toBe(
      "rejected",
    )

    const renameContext = draftContext(actor(2), id128(44), "4")
    const renameIntent = constructProjectCanvasRouteRenameIntentV2({
      snapshot: validateProjectIndexYDocV2(document),
      context: renameContext,
      canvasId: staged.canvasId,
      title: "Renamed",
    })
    if (renameIntent === "rejected") throw new Error("rename construction rejected")
    const rename = withDigest(renameContext, renameIntent)
    expect(applyProjectIndexCandidateIntentV2(document, rename.context, rename.intent, facts)).not.toBe("rejected")

    const tombstoneContext = draftContext(actor(2), id128(45), "5")
    const tombstoneIntent = constructProjectCanvasRouteTombstoneIntentV2({
      snapshot: validateProjectIndexYDocV2(document),
      context: tombstoneContext,
      canvasId: staged.canvasId,
    })
    if (tombstoneIntent === "rejected") throw new Error("tombstone construction rejected")
    const tombstone = withDigest(tombstoneContext, tombstoneIntent)
    expect(applyProjectIndexCandidateIntentV2(document, tombstone.context, tombstone.intent, facts)).not.toBe(
      "rejected",
    )
    expect(projectProjectIndexV2(document).canvasRoutes).toEqual([
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
    expect(selectedProjectIndexDocumentOwnerArtifactDefinitionV2.owner).toBe("project-index")
    expect([...doc.getMap("convax.project-index.v2").keys()].sort()).toEqual([
      "canvasRoutes", "contentFamilies", "contentPromotions", "entries", "entryLocations",
      "entryTombstones", "identity", "operations", "pathReservations",
    ])
    expect(new TextDecoder().decode(encodeProjectCanonicalStateV2(doc))).toContain(
      '"format":"convax.project-index-canonical-state/2"',
    )
  })

  test("requires exact guards for directory and file create", () => {
    const document = genesis()
    const directoryContext = draftContext(actor(5), id128(71), "1")
    const directoryId = deriveProjectIdentityV2(directoryContext, "directory", "0" as Uint32V2) as `pd_${string}`
    const locationId = deriveProjectIdentityV2(directoryContext, "location", "1" as Uint32V2) as `pl_${string}`
    const directoryIntent = {
      format: "convax.typed-intent/2",
      kind: "project.directory.create/2",
      guards: [],
      body: {
        entry: {
          format: "convax.project-entry/2",
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
          format: "convax.project-entry-location/2",
          claimId: locationId,
          entryId: directoryId,
          state: "linked",
          parentDirectoryId: rootDirectoryId,
          basename: "Scenes",
          reason: "create",
          stamp: stamp(directoryContext, "1"),
        },
      },
    } as ProjectIndexIntentV2
    const emptyDirectory = withDigest(directoryContext, directoryIntent)
    expect(applyProjectIndexCandidateIntentV2(cloneProjectIndexYDocV2(document), emptyDirectory.context, emptyDirectory.intent, facts)).toBe("rejected")
    const guardedDirectory = materializeProjectIndexIntentGuardsV2({
      snapshot: validateProjectIndexYDocV2(document), context: directoryContext, intent: directoryIntent,
    })
    if (guardedDirectory === "rejected") throw new Error("directory guards rejected")
    const builtDirectory = withDigest(directoryContext, guardedDirectory)
    expect(applyProjectIndexCandidateIntentV2(document, builtDirectory.context, builtDirectory.intent, facts)).not.toBe("rejected")

    const fileContext = draftContext(actor(5), id128(72), "2")
    const fileId = deriveProjectIdentityV2(fileContext, "file", "0" as Uint32V2) as `pf_${string}`
    const fileLocationId = deriveProjectIdentityV2(fileContext, "location", "1" as Uint32V2) as `pl_${string}`
    const versionId = deriveProjectIdentityV2(fileContext, "version", "2" as Uint32V2) as `pv_${string}`
    const blob = blobRef("guarded-create")
    const fileIntent = {
      format: "convax.typed-intent/2",
      kind: "project.file.create/2",
      guards: [],
      body: {
        entry: {
          format: "convax.project-entry/2", entryId: fileId, kind: "file", storageClass: "project-file",
          contentPolicy: "immutable", provenance: "user", conflictSource: null,
          createdByActorId: fileContext.actorId, createdByOperationId: fileContext.operationId,
          createdStamp: stamp(fileContext, "0"),
        },
        location: {
          format: "convax.project-entry-location/2", claimId: fileLocationId, entryId: fileId,
          state: "linked", parentDirectoryId: directoryId, basename: "shot.md", reason: "create",
          stamp: stamp(fileContext, "1"),
        },
        initialVersion: version(fileId, versionId, "initial", blob, [], null, fileContext, "2"),
      },
    } as ProjectIndexIntentV2
    const emptyFile = withDigest(fileContext, fileIntent)
    expect(applyProjectIndexCandidateIntentV2(cloneProjectIndexYDocV2(document), emptyFile.context, emptyFile.intent, facts)).toBe("rejected")
    const guardedFile = materializeProjectIndexIntentGuardsV2({
      snapshot: validateProjectIndexYDocV2(document), context: fileContext, intent: fileIntent,
    })
    if (guardedFile === "rejected") throw new Error("file guards rejected")
    const builtFile = withDigest(fileContext, guardedFile)
    expect(applyProjectIndexCandidateIntentV2(document, builtFile.context, builtFile.intent, facts)).not.toBe("rejected")
  })

  test("requires current location and live-entry guards for locate and tombstone", () => {
    const document = genesis()
    const created = createFile(document, "conflict-preserving-text", actor(1), id128(73), "1", "move.md")
    const locateContext = draftContext(actor(2), id128(74), "2")
    const claimId = deriveProjectIdentityV2(locateContext, "location", "0" as Uint32V2) as `pl_${string}`
    const locateIntent = {
      format: "convax.typed-intent/2", kind: "project.entry.locate/2", guards: [],
      body: { location: {
        format: "convax.project-entry-location/2", claimId, entryId: created.fileId,
        state: "linked", parentDirectoryId: rootDirectoryId, basename: "moved.md", reason: "move",
        stamp: stamp(locateContext, "0"),
      } },
    } as ProjectIndexIntentV2
    const emptyLocate = withDigest(locateContext, locateIntent)
    expect(applyProjectIndexCandidateIntentV2(cloneProjectIndexYDocV2(document), emptyLocate.context, emptyLocate.intent, facts)).toBe("rejected")
    const guardedLocate = materializeProjectIndexIntentGuardsV2({ snapshot: validateProjectIndexYDocV2(document), context: locateContext, intent: locateIntent })
    if (guardedLocate === "rejected") throw new Error("locate guards rejected")
    const builtLocate = withDigest(locateContext, guardedLocate)
    expect(applyProjectIndexCandidateIntentV2(document, builtLocate.context, builtLocate.intent, facts)).not.toBe("rejected")

    const tombstoneContext = draftContext(actor(2), id128(75), "3")
    const tombstoneId = deriveProjectIdentityV2(tombstoneContext, "tombstone", "0" as Uint32V2) as `pt_${string}`
    const entry = validateProjectIndexYDocV2(document).entries.get(created.fileId)!
    const tombstoneIntent = {
      format: "convax.typed-intent/2", kind: "project.entry.tombstone/2", guards: [],
      body: { tombstone: {
        format: "convax.project-entry-tombstone/2", tombstoneId, entryId: created.fileId,
        reason: "explicit-delete", observedEntryDigest: projectIndexRecordDigestV2(entry),
        stamp: stamp(tombstoneContext, "0"),
      } },
    } as ProjectIndexIntentV2
    const emptyTombstone = withDigest(tombstoneContext, tombstoneIntent)
    expect(applyProjectIndexCandidateIntentV2(cloneProjectIndexYDocV2(document), emptyTombstone.context, emptyTombstone.intent, facts)).toBe("rejected")
    const guardedTombstone = materializeProjectIndexIntentGuardsV2({ snapshot: validateProjectIndexYDocV2(document), context: tombstoneContext, intent: tombstoneIntent })
    if (guardedTombstone === "rejected") throw new Error("tombstone guards rejected")
    const builtTombstone = withDigest(tombstoneContext, guardedTombstone)
    expect(applyProjectIndexCandidateIntentV2(document, builtTombstone.context, builtTombstone.intent, facts)).not.toBe("rejected")
  })

  test("requires exact family-head guards for text writes and binary overwrites", () => {
    const textDocument = genesis()
    const textCreated = createFile(textDocument, "conflict-preserving-text", actor(1), id128(76), "1", "guarded.md")
    const textContext = draftContext(actor(2), id128(77), "2")
    const textVersionId = deriveProjectIdentityV2(textContext, "version", "0" as Uint32V2) as `pv_${string}`
    const conflictFileId = deriveProjectIdentityV2(textContext, "file", "1" as Uint32V2) as `pf_${string}`
    const promotionId = deriveProjectIdentityV2(textContext, "promotion", "2" as Uint32V2) as `pp_${string}`
    const reservationId = deriveProjectIdentityV2(textContext, "reservation", "3" as Uint32V2) as `pr_${string}`
    const textVersion = version(textCreated.fileId, textVersionId, "text-write", blobRef("guarded-text"), [textCreated.initialVersionId], null, textContext, "0")
    const textIntent = {
      format: "convax.typed-intent/2", kind: "project.file.write-text/2", guards: [],
      body: {
        version: textVersion,
        conflictEntry: {
          format: "convax.project-entry/2", entryId: conflictFileId, kind: "file", storageClass: "project-file",
          contentPolicy: "conflict-preserving-text", provenance: "content-conflict-copy",
          conflictSource: { primaryFileId: textCreated.fileId, sourceVersionId: textVersionId, promotionId, reservationId },
          createdByActorId: textContext.actorId, createdByOperationId: textContext.operationId,
          createdStamp: stamp(textContext, "1"),
        },
        promotion: {
          format: "convax.project-content-promotion/2", promotionId, primaryFileId: textCreated.fileId,
          versionId: textVersionId, reservedConflictFileId: conflictFileId, reservationId,
          stamp: stamp(textContext, "2"),
        },
        reservation: {
          format: "convax.project-path-reservation/2", reservationId, kind: "content-conflict-copy",
          primaryFileId: textCreated.fileId, versionId: textVersionId, reservedEntryId: conflictFileId,
          canonicalPath: `.convax-conflicts/${conflictFileId}/content`, originalBasenameHint: "guarded.md",
          stamp: stamp(textContext, "3"),
        },
      },
    } as ProjectIndexIntentV2
    const emptyText = withDigest(textContext, textIntent)
    expect(applyProjectIndexCandidateIntentV2(cloneProjectIndexYDocV2(textDocument), emptyText.context, emptyText.intent, facts)).toBe("rejected")
    const guardedText = materializeProjectIndexIntentGuardsV2({ snapshot: validateProjectIndexYDocV2(textDocument), context: textContext, intent: textIntent })
    if (guardedText === "rejected") throw new Error("text guards rejected")
    const staleText = withDigest(textContext, {
      ...guardedText,
      guards: guardedText.guards.map((guard) => guard.kind === "family-live-heads"
        ? { ...guard, projectionDigest: digest("stale-family") }
        : guard),
    })
    expect(applyProjectIndexCandidateIntentV2(cloneProjectIndexYDocV2(textDocument), staleText.context, staleText.intent, facts)).toBe("rejected")
    const builtText = withDigest(textContext, guardedText)
    expect(applyProjectIndexCandidateIntentV2(textDocument, builtText.context, builtText.intent, facts)).not.toBe("rejected")

    const binaryDocument = genesis()
    const binaryCreated = createFile(binaryDocument, "overwritable-binary", actor(1), id128(78), "1", "guarded.png")
    const binaryContext = draftContext(actor(3), id128(79), "2")
    const binaryVersionId = deriveProjectIdentityV2(binaryContext, "version", "0" as Uint32V2) as `pv_${string}`
    const binaryIntent = {
      format: "convax.typed-intent/2", kind: "project.file.overwrite-binary/2", guards: [],
      body: { version: version(binaryCreated.fileId, binaryVersionId, "binary-overwrite", blobRef("guarded-binary"), [binaryCreated.initialVersionId], "1", binaryContext, "0") },
    } as ProjectIndexIntentV2
    const emptyBinary = withDigest(binaryContext, binaryIntent)
    expect(applyProjectIndexCandidateIntentV2(cloneProjectIndexYDocV2(binaryDocument), emptyBinary.context, emptyBinary.intent, facts)).toBe("rejected")
    const guardedBinary = materializeProjectIndexIntentGuardsV2({ snapshot: validateProjectIndexYDocV2(binaryDocument), context: binaryContext, intent: binaryIntent })
    if (guardedBinary === "rejected") throw new Error("binary guards rejected")
    const builtBinary = withDigest(binaryContext, guardedBinary)
    expect(applyProjectIndexCandidateIntentV2(binaryDocument, builtBinary.context, builtBinary.intent, facts)).not.toBe("rejected")
  })

  test("rejects empty, stale or widened route guards and a staged-route rename attack", () => {
    const document = genesis()
    const stageContext = draftContext(actor(2), id128(51), "2")
    const staged = constructProjectCanvasRouteStageIntentV2({
      snapshot: validateProjectIndexYDocV2(document),
      context: stageContext,
      shardEpoch: id128(52),
      title: "Guarded",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    expect(staged.intent.guards).toHaveLength(3)

    const emptyGuardStage = withDigest(stageContext, { ...staged.intent, guards: [] })
    expect(
      applyProjectIndexCandidateIntentV2(
        cloneProjectIndexYDocV2(document),
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
    } as unknown as ProjectIndexIntentV2)
    expect(
      applyProjectIndexCandidateIntentV2(
        cloneProjectIndexYDocV2(document),
        widenedGuardStage.context,
        widenedGuardStage.intent,
        facts,
      ),
    ).toBe("rejected")

    const stage = withDigest(stageContext, staged.intent)
    expect(applyProjectIndexCandidateIntentV2(document, stage.context, stage.intent, facts)).not.toBe("rejected")
    const snapshot = validateProjectIndexYDocV2(document)
    const projection = projectCanvasRouteProjectionV2(snapshot, staged.canvasId)
    expect(projectCanvasRouteProjectionDigestV2(projection)).toMatch(/^[0-9a-f]{64}$/)

    const mutationContext = draftContext(actor(3), id128(53), "3")
    const tombstone = constructProjectCanvasRouteTombstoneIntentV2({
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
      applyProjectIndexCandidateIntentV2(
        cloneProjectIndexYDocV2(document),
        staleGuardTombstone.context,
        staleGuardTombstone.intent,
        facts,
      ),
    ).toBe("rejected")

    const stagedRename = withDigest(mutationContext, {
      format: "convax.typed-intent/2",
      kind: "project.canvas.route.rename/2",
      guards: tombstone.guards,
      body: {
        metadata: {
          format: "convax.canvas-route-metadata/2",
          transitionId: deriveProjectIdentityV2(mutationContext, "route-transition", "0" as Uint32V2),
          canvasId: staged.canvasId,
          title: "Must not rename staged",
          observedActivationDigest: digest("invented-activation"),
          stamp: stamp(mutationContext, "0"),
        },
      },
    } as ProjectIndexIntentV2)
    expect(
      applyProjectIndexCandidateIntentV2(
        cloneProjectIndexYDocV2(document),
        stagedRename.context,
        stagedRename.intent,
        facts,
      ),
    ).toBe("rejected")
  })

  test("accepts only an exactly cross-bound authorized route reset and projects one live shard", () => {
    const document = genesis()
    const stageContext = draftContext(actor(2), id128(61), "2")
    const staged = constructProjectCanvasRouteStageIntentV2({
      snapshot: validateProjectIndexYDocV2(document),
      context: stageContext,
      shardEpoch: id128(62),
      title: "Resettable",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const stage = withDigest(stageContext, staged.intent)
    expect(applyProjectIndexCandidateIntentV2(document, stage.context, stage.intent, facts)).not.toBe("rejected")

    const activationContext = draftContext(actor(2), id128(63), "3")
    const activationValue = constructProjectCanvasRouteActivationIntentV2({
      snapshot: validateProjectIndexYDocV2(document),
      context: activationContext,
      canvasId: staged.canvasId,
      projectIndexRouteDependencyFrameDigest: digest("reset-stage-frame"),
      canvasGenesisCheckpointObjectDigest: digest("reset-initial-genesis"),
      stagedProjectIndexFrontierDigest: digest("reset-stage-frontier"),
    })
    if (activationValue === "rejected") throw new Error("activation construction rejected")
    const activation = withDigest(activationContext, activationValue)
    expect(applyProjectIndexCandidateIntentV2(document, activation.context, activation.intent, facts)).not.toBe("rejected")

    const snapshot = validateProjectIndexYDocV2(document)
    const current = projectCanvasRouteProjectionV2(snapshot, staged.canvasId)
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
      format: "convax.document-shard-reset-route-cas-core/2" as const,
      operationId: resetContext.operationId,
      canvasId: staged.canvasId,
      oldScope,
      newScope,
      predecessorActivationDigest: current.currentActivationDigest,
      stagedGenesisCheckpointObjectDigest: digest("reset-genesis-checkpoint"),
      stagedGenesisFullUpdateDigest: digest("reset-genesis-update"),
      stagedGenesisStateVectorDigest: digest("reset-genesis-vector"),
    }
    const routeCasCoreDigest = structuredDigestV2(
      "convax.document-shard-reset-route-cas-core-digest/2",
      routeCasCore,
    )
    const initiatorMemberId = parseMemberIdV2(id128(66))
    const initiatorReplicaId = parseReplicaIdV2("replica_00000042")
    const adminMemberId = parseMemberIdV2(id128(67))
    const adminCapabilityCoreDigest = digest("reset-admin-capability")
    const reason = "incompatible-canvas-schema" as const
    const confirmationCore = {
      format: "convax.document-shard-reset-confirmation-core/2" as const,
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
      format: "convax.document-shard-reset-confirmation/2" as const,
      core: confirmationCore,
      coreDigest: structuredDigestV2("convax.document-shard-reset-confirmation-core/2", confirmationCore),
      initiatorReplicaSignature: signature(),
    }
    const claimCore = {
      format: "convax.document-shard-reset-claim-core/2" as const,
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
    const claimCoreDigest = structuredDigestV2(
      "convax.document-shard-reset-claim-core-digest/2",
      claimCore,
    )
    const approvalCore = {
      format: "convax.document-shard-reset-approval-core/2" as const,
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
      format: "convax.document-shard-reset-approval/2" as const,
      core: approvalCore,
      coreDigest: structuredDigestV2("convax.document-shard-reset-approval-core/2", approvalCore),
      adminMemberSignature: signature(),
    }
    const resetClaim = {
      format: "convax.document-shard-reset-claim/2" as const,
      core: claimCore,
      coreDigest: claimCoreDigest,
      initiatorSignature: signature(),
      adminApprovalDigest: approval.coreDigest,
    }
    const resetValue = constructProjectCanvasRouteResetIntentV2({
      snapshot,
      context: resetContext,
      routeCasCore,
      resetClaim,
      confirmation,
      approval,
    })
    if (resetValue === "rejected") throw new Error("reset construction rejected")
    const reset = withDigest(resetContext, resetValue)
    const beforeReset = cloneProjectIndexYDocV2(document)
    expect(applyProjectIndexCandidateIntentV2(document, reset.context, reset.intent, facts)).not.toBe("rejected")
    expect(projectCanvasRouteProjectionV2(validateProjectIndexYDocV2(document), staged.canvasId)).toMatchObject({
      state: "live",
      currentActivationDigest: projectIndexRecordDigestV2(resetValue.body.resetCommit),
      currentShardEpoch: newShardEpoch,
      ancestryRecordDigests: [
        expect.any(String),
        current.currentActivationDigest,
        projectIndexRecordDigestV2(resetValue.body.resetCommit),
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
      applyProjectIndexCandidateIntentV2(
        cloneProjectIndexYDocV2(beforeReset),
        attacked.context,
        attacked.intent,
        facts,
      ),
    ).toBe("rejected")
  })

  test("converges under opposite arrival order while retaining a concurrent text conflict copy", () => {
    const base = genesis()
    const created = createFile(base, "conflict-preserving-text", actor(1), id128(11), "1", "notes.md")
    const left = cloneProjectIndexYDocV2(base)
    const right = cloneProjectIndexYDocV2(base)
    const leftWrite = textWrite(left, created.fileId, created.initialVersionId, actor(2), id128(12), "2", "left")
    const rightWrite = textWrite(right, created.fileId, created.initialVersionId, actor(3), id128(13), "2", "right")

    const mergedLeftFirst = cloneProjectIndexYDocV2(base)
    Y.applyUpdate(mergedLeftFirst, Y.encodeStateAsUpdate(left), "left-first")
    Y.applyUpdate(mergedLeftFirst, Y.encodeStateAsUpdate(right), "right-second")
    const mergedRightFirst = cloneProjectIndexYDocV2(base)
    Y.applyUpdate(mergedRightFirst, Y.encodeStateAsUpdate(right), "right-first")
    Y.applyUpdate(mergedRightFirst, Y.encodeStateAsUpdate(left), "left-second")

    expect(projectProjectIndexV2(mergedLeftFirst)).toEqual(projectProjectIndexV2(mergedRightFirst))
    expect(encodeProjectCanonicalStateV2(mergedLeftFirst)).toEqual(encodeProjectCanonicalStateV2(mergedRightFirst))
    const family = projectProjectIndexV2(mergedLeftFirst).contentFamilies[0]!
    const expectedCurrent = rightWrite.actorId > leftWrite.actorId ? rightWrite.versionId : leftWrite.versionId
    expect(family.currentVersionId).toBe(expectedCurrent)
    expect(family.liveHeadVersionIds).toEqual([leftWrite.versionId, rightWrite.versionId].sort())
    expect(family.activeConflictFileIds).toHaveLength(1)
    const currentBlobRoots = projectIndexCurrentBlobReferencesV2(mergedLeftFirst)
    expect(currentBlobRoots).toHaveLength(2)
    expect(currentBlobRoots.map((reference) => reference.entryFileId).sort()).toEqual([
      created.fileId,
      family.activeConflictFileIds[0],
    ].sort())
    expect(() => parseProjectResourceReferenceV2({
      ...currentBlobRoots[0],
      canonicalUri: currentBlobRoots[0]!.canonicalUri.replace(currentBlobRoots[0]!.blob.digest, "0".repeat(64)),
    })).toThrow("binding")
  })

  test("Canvas tombstone dominates a late concurrent activation in either arrival order", () => {
    const genesisDoc = genesis()
    const stageContext = draftContext(actor(2), id128(21), "2")
    const staged = constructProjectCanvasRouteStageIntentV2({
      snapshot: validateProjectIndexYDocV2(genesisDoc),
      context: stageContext,
      shardEpoch: id128(22),
      title: "Team Canvas",
    })
    if (staged === "rejected") throw new Error("stage construction rejected")
    const canvasId = staged.canvasId
    const stageIntent = withDigest(stageContext, staged.intent)
    const stageDoc = cloneProjectIndexYDocV2(genesisDoc)
    expect(applyProjectIndexCandidateIntentV2(stageDoc, stageIntent.context, stageIntent.intent, facts)).not.toBe("rejected")

    const activationContext = draftContext(actor(4), id128(24), "3")
    const activationIntentValue = constructProjectCanvasRouteActivationIntentV2({
      snapshot: validateProjectIndexYDocV2(stageDoc),
      context: activationContext,
      canvasId,
      projectIndexRouteDependencyFrameDigest: digest("stage-frame"),
      canvasGenesisCheckpointObjectDigest: digest("canvas-genesis"),
      stagedProjectIndexFrontierDigest: digest("staged-frontier"),
    })
    if (activationIntentValue === "rejected") throw new Error("activation construction rejected")
    const activationIntent = withDigest(activationContext, activationIntentValue)
    const activationDoc = cloneProjectIndexYDocV2(stageDoc)
    expect(applyProjectIndexCandidateIntentV2(activationDoc, activationIntent.context, activationIntent.intent, facts)).not.toBe("rejected")

    const deleteContext = draftContext(actor(3), id128(23), "3")
    const deleteIntentValue = constructProjectCanvasRouteTombstoneIntentV2({
      snapshot: validateProjectIndexYDocV2(stageDoc),
      context: deleteContext,
      canvasId,
    })
    if (deleteIntentValue === "rejected") throw new Error("tombstone construction rejected")
    const deleteIntent = withDigest(deleteContext, deleteIntentValue)
    const deleteDoc = cloneProjectIndexYDocV2(stageDoc)
    expect(applyProjectIndexCandidateIntentV2(deleteDoc, deleteIntent.context, deleteIntent.intent, facts)).not.toBe("rejected")

    const one = cloneProjectIndexYDocV2(stageDoc)
    Y.applyUpdate(one, Y.encodeStateAsUpdate(activationDoc)); Y.applyUpdate(one, Y.encodeStateAsUpdate(deleteDoc))
    const two = cloneProjectIndexYDocV2(stageDoc)
    Y.applyUpdate(two, Y.encodeStateAsUpdate(deleteDoc)); Y.applyUpdate(two, Y.encodeStateAsUpdate(activationDoc))
    expect(projectProjectIndexV2(one)).toEqual(projectProjectIndexV2(two))
    expect(projectProjectIndexV2(one).canvasRoutes).toEqual([
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
    const low = cloneProjectIndexYDocV2(base)
    const high = cloneProjectIndexYDocV2(base)
    const lowWrite = binaryWrite(low, created.fileId, created.initialVersionId, actor(2), id128(32), "2")
    const highWrite = binaryWrite(high, created.fileId, created.initialVersionId, actor(4), id128(33), "2")
    const merged = cloneProjectIndexYDocV2(base)
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(high)); Y.applyUpdate(merged, Y.encodeStateAsUpdate(low))
    const family = projectProjectIndexV2(merged).contentFamilies[0]
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
    expect(requiredProjectIndexBlobDigestsV2(frameFor(created.intent))).toEqual([created.blobDigest])

    const routeContext = draftContext(actor(3), id128(71), "2")
    const stage = constructProjectCanvasRouteStageIntentV2({
      snapshot: validateProjectIndexYDocV2(document), context: routeContext, shardEpoch: id128(72), title: "Canvas",
    })
    if (stage === "rejected") throw new Error("stage construction rejected")
    expect(requiredProjectIndexBlobDigestsV2(frameFor(stage.intent))).toEqual([])
  })
})

function genesis(): Y.Doc {
  const genesisContext = draftContext(actor(1), id128(1), "0")
  const rootEntry: ProjectEntryRecordV2 = {
    format: "convax.project-entry/2", entryId: rootDirectoryId, kind: "directory", storageClass: null,
    contentPolicy: "none", provenance: "project-root", conflictSource: null,
    createdByActorId: genesisContext.actorId, createdByOperationId: genesisContext.operationId,
    createdStamp: stamp(genesisContext, "0"),
  }
  return createProjectIndexYDocV2({
    format: "convax.project-index-identity/2", schema: "convax.project-index.v2", projectId: "project-a" as never,
    projectEpoch, shardEpoch, rootDirectoryId, protocolDigest,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2, uriProtocolDigest,
  }, rootEntry)
}

function createFile(doc: Y.Doc, policy: "conflict-preserving-text" | "overwritable-binary", actorId: ActorIdV2, operationId: Id128V2, lamport: string, basename: string) {
  const draft = draftContext(actorId, operationId, lamport)
  const fileId = deriveProjectIdentityV2(draft, "file", "0" as Uint32V2) as ProjectEntryRecordV2["entryId"] & `pf_${string}`
  const locationId = deriveProjectIdentityV2(draft, "location", "1" as Uint32V2) as `pl_${string}`
  const versionId = deriveProjectIdentityV2(draft, "version", "2" as Uint32V2) as `pv_${string}`
  const entry: ProjectEntryRecordV2 = { format: "convax.project-entry/2", entryId: fileId, kind: "file", storageClass: "project-file", contentPolicy: policy, provenance: "user", conflictSource: null, createdByActorId: actorId, createdByOperationId: operationId, createdStamp: stamp(draft, "0") }
  const blob = blobRef(`initial-${basename}`)
  const initialVersion: ProjectContentVersionRecordV2 = version(fileId, versionId, "initial", blob, [], policy === "overwritable-binary" ? "0" : null, draft, "2")
  const unguarded = { format: "convax.typed-intent/2", kind: "project.file.create/2", guards: [], body: { entry, location: { format: "convax.project-entry-location/2", claimId: locationId, entryId: fileId, state: "linked", parentDirectoryId: rootDirectoryId, basename, reason: "create", stamp: stamp(draft, "1") }, initialVersion } } as ProjectIndexIntentV2
  const guarded = materializeProjectIndexIntentGuardsV2({ snapshot: validateProjectIndexYDocV2(doc), context: draft, intent: unguarded })
  if (guarded === "rejected") throw new Error("file create guard construction rejected")
  const built = withDigest(draft, guarded)
  const result = applyProjectIndexCandidateIntentV2(doc, built.context, built.intent, facts)
  if (result === "rejected") validateProjectIndexYDocV2(doc)
  expect(result).not.toBe("rejected")
  return { fileId, initialVersionId: versionId, blobDigest: blob.digest, intent: built.intent }
}

function frameFor(intent: ProjectIndexIntentV2): DecodedCausalEditFrameV2 {
  return {
    header: { core: { scope: draftContext(actor(9), id128(99), "9").scope, intentKind: intent.kind } },
    sections: { typedIntentJcs: encodeRestrictedJcsV2(intent) },
  } as unknown as DecodedCausalEditFrameV2
}

function textWrite(doc: Y.Doc, fileId: `pf_${string}`, parent: `pv_${string}`, actorId: ActorIdV2, operationId: Id128V2, lamport: string, content: string) {
  const draft = draftContext(actorId, operationId, lamport)
  const versionId = deriveProjectIdentityV2(draft, "version", "0" as Uint32V2) as `pv_${string}`
  const conflictFileId = deriveProjectIdentityV2(draft, "file", "1" as Uint32V2) as `pf_${string}`
  const promotionId = deriveProjectIdentityV2(draft, "promotion", "2" as Uint32V2) as `pp_${string}`
  const reservationId = deriveProjectIdentityV2(draft, "reservation", "3" as Uint32V2) as `pr_${string}`
  const blob = blobRef(content)
  const versionRecord = version(fileId, versionId, "text-write", blob, [parent], null, draft, "0")
  const conflictEntry: ProjectEntryRecordV2 = { format: "convax.project-entry/2", entryId: conflictFileId, kind: "file", storageClass: "project-file", contentPolicy: "conflict-preserving-text", provenance: "content-conflict-copy", conflictSource: { primaryFileId: fileId, sourceVersionId: versionId, promotionId, reservationId }, createdByActorId: actorId, createdByOperationId: operationId, createdStamp: stamp(draft, "1") }
  const promotion: ProjectContentPromotionRecordV2 = { format: "convax.project-content-promotion/2", promotionId, primaryFileId: fileId, versionId, reservedConflictFileId: conflictFileId, reservationId, stamp: stamp(draft, "2") }
  const reservation: ProjectPathReservationRecordV2 = { format: "convax.project-path-reservation/2", reservationId, kind: "content-conflict-copy", primaryFileId: fileId, versionId, reservedEntryId: conflictFileId, canonicalPath: `.convax-conflicts/${conflictFileId}/content`, originalBasenameHint: "notes.md", stamp: stamp(draft, "3") }
  const unguarded = { format: "convax.typed-intent/2", kind: "project.file.write-text/2", guards: [], body: { version: versionRecord, conflictEntry, promotion, reservation } } as ProjectIndexIntentV2
  const guarded = materializeProjectIndexIntentGuardsV2({ snapshot: validateProjectIndexYDocV2(doc), context: draft, intent: unguarded })
  if (guarded === "rejected") throw new Error("text write guard construction rejected")
  const built = withDigest(draft, guarded)
  expect(applyProjectIndexCandidateIntentV2(doc, built.context, built.intent, facts)).not.toBe("rejected")
  return { versionId, actorId }
}

function binaryWrite(doc: Y.Doc, fileId: `pf_${string}`, parent: `pv_${string}`, actorId: ActorIdV2, operationId: Id128V2, lamport: string) {
  const draft = draftContext(actorId, operationId, lamport)
  const versionId = deriveProjectIdentityV2(draft, "version", "0" as Uint32V2) as `pv_${string}`
  const record = version(fileId, versionId, "binary-overwrite", blobRef(versionId), [parent], "1", draft, "0")
  const unguarded = { format: "convax.typed-intent/2", kind: "project.file.overwrite-binary/2", guards: [], body: { version: record } } as ProjectIndexIntentV2
  const guarded = materializeProjectIndexIntentGuardsV2({ snapshot: validateProjectIndexYDocV2(doc), context: draft, intent: unguarded })
  if (guarded === "rejected") throw new Error("binary write guard construction rejected")
  const built = withDigest(draft, guarded)
  expect(applyProjectIndexCandidateIntentV2(doc, built.context, built.intent, facts)).not.toBe("rejected")
  return { versionId }
}

function version(fileId: `pf_${string}`, versionId: `pv_${string}`, writeClass: ProjectContentVersionRecordV2["writeClass"], blob: ProjectBlobRefV2, supersedesVersionIds: readonly `pv_${string}`[], binaryLogicalCounter: string | null, context: OwnerIntentValidationContextV2, ordinal: string): ProjectContentVersionRecordV2 {
  return { format: "convax.project-content-version/2", primaryFileId: fileId, versionId, writeClass, blob, canonicalRevisionUri: fromProjectUri({ projectId: "project-a", projectEpoch, entryId: fileId, blob: `sha256:${blob.digest}` }).toString(), supersedesVersionIds, binaryLogicalCounter: binaryLogicalCounter as never, creatorActorId: context.actorId, creatorOperationId: context.operationId, stamp: stamp(context, ordinal) }
}

function withDigest<T extends ProjectIndexIntentV2>(context: OwnerIntentValidationContextV2, intent: T) {
  return { intent, context: { ...context, intentDigest: projectIndexIntentDigestV2(intent) } }
}

function draftContext(actorId: ActorIdV2, operationId: Id128V2, lamport: string): OwnerIntentValidationContextV2 {
  return { scope: { projectId: "project-a" as never, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch }, actorId, actorSequence: "1" as never, operationId, lamport: lamport as never, baseFrontierDigest: digest("frontier"), protocolDigest, ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2, validationArtifactSetDigest: digest("artifacts"), intentDigest: digest("draft") }
}

function stamp(context: OwnerIntentValidationContextV2, writeOrdinal: string): PortableStampV2 {
  return { format: "convax.portable-stamp/2", lamport: context.lamport, actorId: context.actorId, operationId: context.operationId, writeOrdinal: writeOrdinal as Uint32V2 }
}

function blobRef(seed: string): ProjectBlobRefV2 {
  return { format: "convax.blob-ref/2", algorithm: "sha256", digest: digest(seed), byteLength: String(seed.length) as never, mime: "application/octet-stream" }
}

function digest(seed: string): DigestV2 {
  const bytes = new TextEncoder().encode(seed)
  return Array.from(new Uint8Array(awaitlessSha(bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("") as DigestV2
}

function awaitlessSha(bytes: Uint8Array): ArrayBuffer {
  // Tests need only deterministic valid digest-shaped values; this is deliberately not protocol hashing.
  const result = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) result[index % 32] = (result[index % 32]! + bytes[index]! + index) & 0xff
  return result.buffer
}

function id128(byte: number): Id128V2 { return Buffer.alloc(16, byte).toString("base64url") as Id128V2 }
function actor(byte: number): ActorIdV2 { return Buffer.alloc(32, byte).toString("base64url") as ActorIdV2 }
function signature() {
  return parseSignatureV2(
    encodeBase64urlV2(
      Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0),
    ),
  )
}

// Keep the JCS codec exercised by the convergence fixture and silence accidental non-JCS additions.
void encodeRestrictedJcsV2
