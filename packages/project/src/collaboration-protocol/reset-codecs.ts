import {
  assertBoundedNfcString,
  assertDenseArray,
  assertExactKeys,
  compareUtf8,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint64,
  structuredDigest,
  type Digest,
} from "@convax/collaboration"
import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION } from "./kernel-integration"
import type {
  DocumentShardResetApprovalCore,
  DocumentShardResetApproval,
  DocumentShardResetConfirmationCore,
  DocumentShardResetConfirmation,
} from "./reset-contracts"
import type {
  EmptyProjectIndexGenesisAttestationCore,
  EmptyProjectIndexGenesisAttestation,
  ProjectResetApprovalCore,
  ProjectResetApproval,
  TeamEpochRolloverChallengeCore,
  TeamEpochRolloverChallenge,
  TeamEpochRolloverProofCore,
  TeamEpochRolloverProof,
  TeamEpochRolloverReceiptCore,
  TeamEpochRolloverReceipt,
} from "./rollover-contracts"

export function documentShardResetConfirmationCoreDigest(core: DocumentShardResetConfirmationCore): Digest {
  return structuredDigest("convax.document-shard-reset-confirmation-core", parseDocumentShardResetConfirmationCore(core))
}

export function documentShardResetApprovalCoreDigest(core: DocumentShardResetApprovalCore): Digest {
  return structuredDigest("convax.document-shard-reset-approval-core", parseDocumentShardResetApprovalCore(core))
}

export function projectResetApprovalCoreDigest(core: ProjectResetApprovalCore): Digest {
  return structuredDigest("convax.project-reset-approval-core", parseProjectResetApprovalCore(core))
}

export function teamEpochRolloverChallengeCoreDigest(core: TeamEpochRolloverChallengeCore): Digest {
  return structuredDigest("convax.team-epoch-rollover-challenge-core", parseTeamEpochRolloverChallengeCore(core))
}

export function teamEpochRolloverProofCoreDigest(core: TeamEpochRolloverProofCore): Digest {
  return structuredDigest("convax.team-epoch-rollover-proof-core", parseTeamEpochRolloverProofCore(core))
}

export function emptyProjectIndexGenesisAttestationCoreDigest(core: EmptyProjectIndexGenesisAttestationCore): Digest {
  return structuredDigest("convax.empty-project-index-genesis-attestation-core", parseEmptyProjectIndexGenesisAttestationCore(core))
}

export function teamEpochRolloverReceiptCoreDigest(core: TeamEpochRolloverReceiptCore): Digest {
  return structuredDigest("convax.team-epoch-rollover-receipt-core", parseTeamEpochRolloverReceiptCore(core))
}

export function parseDocumentShardResetConfirmationCore(value: unknown): DocumentShardResetConfirmationCore {
  assertExactKeys(value, ["format", "confirmationId", "projectId", "projectEpoch", "oldScope", "newScope", "reason", "routeCasCoreDigest", "predecessorActivationDigest", "stagedGenesisCheckpointObjectDigest", "stagedGenesisFullUpdateDigest", "stagedGenesisStateVectorDigest", "initiatorMemberId", "initiatorReplicaId", "initiatorActorId", "initiatorActorCredentialCoreDigest", "confirmationStatement", "protocolDigest"], "DocumentShardResetConfirmationCore")
  if (value.format !== "convax.document-shard-reset-confirmation-core" || !isShardReason(value.reason) || value.confirmationStatement !== "replace-one-canvas-shard-and-retain-old-recovery-bytes") invalid("Shard reset confirmation discriminators are invalid")
  const oldScope = canvasScope(value.oldScope)
  const newScope = canvasScope(value.newScope)
  assertResetScopes(oldScope, newScope, parseProjectId(value.projectId), parseId128(value.projectEpoch))
  return Object.freeze({ format: value.format, confirmationId: parseId128(value.confirmationId), projectId: parseProjectId(value.projectId), projectEpoch: parseId128(value.projectEpoch), oldScope, newScope, reason: value.reason, routeCasCoreDigest: parseDigest(value.routeCasCoreDigest), predecessorActivationDigest: parseDigest(value.predecessorActivationDigest), stagedGenesisCheckpointObjectDigest: parseDigest(value.stagedGenesisCheckpointObjectDigest), stagedGenesisFullUpdateDigest: parseDigest(value.stagedGenesisFullUpdateDigest), stagedGenesisStateVectorDigest: parseDigest(value.stagedGenesisStateVectorDigest), initiatorMemberId: parseMemberId(value.initiatorMemberId), initiatorReplicaId: parseReplicaId(value.initiatorReplicaId), initiatorActorId: parseActorId(value.initiatorActorId), initiatorActorCredentialCoreDigest: parseDigest(value.initiatorActorCredentialCoreDigest), confirmationStatement: value.confirmationStatement, protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentShardResetConfirmation(value: unknown): DocumentShardResetConfirmation {
  return closeSigned(value, "convax.document-shard-reset-confirmation", parseDocumentShardResetConfirmationCore, documentShardResetConfirmationCoreDigest, "initiatorReplicaSignature")
}

export function parseDocumentShardResetApprovalCore(value: unknown): DocumentShardResetApprovalCore {
  assertExactKeys(value, ["format", "approvalId", "resetClaimCoreDigest", "confirmationCoreDigest", "projectId", "projectEpoch", "oldScope", "newScope", "reason", "routeCasCoreDigest", "adminMemberId", "adminMemberAuthorizationEpoch", "adminCapabilityCoreDigest", "approvalStatement", "protocolDigest"], "DocumentShardResetApprovalCore")
  if (value.format !== "convax.document-shard-reset-approval-core" || !isShardReason(value.reason) || value.approvalStatement !== "approve-exact-canvas-shard-reset") invalid("Shard reset approval discriminators are invalid")
  const projectId = parseProjectId(value.projectId)
  const projectEpoch = parseId128(value.projectEpoch)
  const oldScope = canvasScope(value.oldScope)
  const newScope = canvasScope(value.newScope)
  assertResetScopes(oldScope, newScope, projectId, projectEpoch)
  return Object.freeze({ format: value.format, approvalId: parseId128(value.approvalId), resetClaimCoreDigest: parseDigest(value.resetClaimCoreDigest), confirmationCoreDigest: parseDigest(value.confirmationCoreDigest), projectId, projectEpoch, oldScope, newScope, reason: value.reason, routeCasCoreDigest: parseDigest(value.routeCasCoreDigest), adminMemberId: parseMemberId(value.adminMemberId), adminMemberAuthorizationEpoch: parseId128(value.adminMemberAuthorizationEpoch), adminCapabilityCoreDigest: parseDigest(value.adminCapabilityCoreDigest), approvalStatement: value.approvalStatement, protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentShardResetApproval(value: unknown): DocumentShardResetApproval {
  return closeSigned(value, "convax.document-shard-reset-approval", parseDocumentShardResetApprovalCore, documentShardResetApprovalCoreDigest, "adminMemberSignature")
}

export function parseProjectResetApprovalCore(value: unknown): ProjectResetApprovalCore {
  assertExactKeys(value, ["format", "resetId", "approvalId", "confirmationCoreDigest", "projectId", "oldProjectEpoch", "reason", "observedOldPrivateTreeDigest", "unsupportedInventoryDigest", "privateDeletionSetDigest", "requestedProtocolDigest", "requestedSchemaDigest", "requestedUriProtocolDigest", "adminMemberId", "adminMemberAuthorizationEpoch", "adminCapabilityCoreDigest", "approvalStatement", "protocolDigest"], "ProjectResetApprovalCore")
  if (value.format !== "convax.project-reset-approval-core" || !isProjectReason(value.reason) || value.approvalStatement !== "approve-exact-team-project-reset") invalid("Project reset approval discriminators are invalid")
  const requestedProtocolDigest = protocolDigest(value.requestedProtocolDigest)
  if (protocolDigest(value.protocolDigest) !== requestedProtocolDigest) invalid("Project reset approval protocol digests differ")
  return Object.freeze({ format: value.format, resetId: parseId128(value.resetId), approvalId: parseId128(value.approvalId), confirmationCoreDigest: parseDigest(value.confirmationCoreDigest), projectId: parseProjectId(value.projectId), oldProjectEpoch: parseId128(value.oldProjectEpoch), reason: value.reason, observedOldPrivateTreeDigest: parseDigest(value.observedOldPrivateTreeDigest), unsupportedInventoryDigest: parseDigest(value.unsupportedInventoryDigest), privateDeletionSetDigest: parseDigest(value.privateDeletionSetDigest), requestedProtocolDigest, requestedSchemaDigest: parseDigest(value.requestedSchemaDigest), requestedUriProtocolDigest: parseDigest(value.requestedUriProtocolDigest), adminMemberId: parseMemberId(value.adminMemberId), adminMemberAuthorizationEpoch: parseId128(value.adminMemberAuthorizationEpoch), adminCapabilityCoreDigest: parseDigest(value.adminCapabilityCoreDigest), approvalStatement: value.approvalStatement, protocolDigest: requestedProtocolDigest })
}

export function parseProjectResetApproval(value: unknown): ProjectResetApproval {
  return closeSigned(value, "convax.project-reset-approval", parseProjectResetApprovalCore, projectResetApprovalCoreDigest, "adminMemberSignature")
}

export function parseTeamEpochRolloverChallengeCore(value: unknown): TeamEpochRolloverChallengeCore {
  assertExactKeys(value, ["format", "challengeId", "resetId", "projectId", "oldProjectEpoch", "expectedProjectResetCounter", "projectResetConfirmationCoreDigest", "projectResetApprovalCoreDigest", "observedOldMembershipSnapshotDigest", "observedOldRegistryRootDigest", "observedOldPrivateTreeDigest", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexShardEpoch", "preparedNewMembershipSnapshotCoreDigest", "serverNonce", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "TeamEpochRolloverChallengeCore")
  if (value.format !== "convax.team-epoch-rollover-challenge-core" || value.serviceKeyPurpose !== "membership") invalid("Team rollover challenge discriminators are invalid")
  serviceKeyId(value.serviceKeyId)
  return Object.freeze({ format: value.format, challengeId: parseId128(value.challengeId), resetId: parseId128(value.resetId), projectId: parseProjectId(value.projectId), oldProjectEpoch: parseId128(value.oldProjectEpoch), expectedProjectResetCounter: parseUint64(value.expectedProjectResetCounter), projectResetConfirmationCoreDigest: parseDigest(value.projectResetConfirmationCoreDigest), projectResetApprovalCoreDigest: parseDigest(value.projectResetApprovalCoreDigest), observedOldMembershipSnapshotDigest: parseDigest(value.observedOldMembershipSnapshotDigest), observedOldRegistryRootDigest: parseDigest(value.observedOldRegistryRootDigest), observedOldPrivateTreeDigest: parseDigest(value.observedOldPrivateTreeDigest), newProjectEpoch: parseId128(value.newProjectEpoch), newMembershipEpoch: parseId128(value.newMembershipEpoch), newProjectIndexShardEpoch: parseId128(value.newProjectIndexShardEpoch), preparedNewMembershipSnapshotCoreDigest: parseDigest(value.preparedNewMembershipSnapshotCoreDigest), serverNonce: parseId128(value.serverNonce), issuedAtUnixMs: parseUint64(value.issuedAtUnixMs), expiresAtUnixMs: parseUint64(value.expiresAtUnixMs), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigest(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseTeamEpochRolloverChallenge(value: unknown): TeamEpochRolloverChallenge {
  return closeSigned(value, "convax.team-epoch-rollover-challenge", parseTeamEpochRolloverChallengeCore, teamEpochRolloverChallengeCoreDigest, "serviceSignature")
}

export function parseTeamEpochRolloverProofCore(value: unknown): TeamEpochRolloverProofCore {
  assertExactKeys(value, ["format", "challengeDigest", "resetId", "projectId", "oldProjectEpoch", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexShardEpoch", "expectedProjectResetCounter", "projectResetConfirmationCoreDigest", "projectResetApprovalCoreDigest", "serverNonce", "requesterMemberId", "requesterMemberAuthorizationEpoch", "requesterAdminCapabilityCoreDigest", "stagedEmptyProjectIndexCheckpointDigest", "stagedEmptyProjectIndexFullUpdateDigest", "stagedEmptyProjectIndexStateVectorDigest", "stagedEmptyProjectIndexCanonicalStateDigest", "protocolDigest", "schemaDigest", "uriProtocolDigest"], "TeamEpochRolloverProofCore")
  if (value.format !== "convax.team-epoch-rollover-proof-core") invalid("Team rollover proof format is invalid")
  return Object.freeze({ format: value.format, challengeDigest: parseDigest(value.challengeDigest), resetId: parseId128(value.resetId), projectId: parseProjectId(value.projectId), oldProjectEpoch: parseId128(value.oldProjectEpoch), newProjectEpoch: parseId128(value.newProjectEpoch), newMembershipEpoch: parseId128(value.newMembershipEpoch), newProjectIndexShardEpoch: parseId128(value.newProjectIndexShardEpoch), expectedProjectResetCounter: parseUint64(value.expectedProjectResetCounter), projectResetConfirmationCoreDigest: parseDigest(value.projectResetConfirmationCoreDigest), projectResetApprovalCoreDigest: parseDigest(value.projectResetApprovalCoreDigest), serverNonce: parseId128(value.serverNonce), requesterMemberId: parseMemberId(value.requesterMemberId), requesterMemberAuthorizationEpoch: parseId128(value.requesterMemberAuthorizationEpoch), requesterAdminCapabilityCoreDigest: parseDigest(value.requesterAdminCapabilityCoreDigest), stagedEmptyProjectIndexCheckpointDigest: parseDigest(value.stagedEmptyProjectIndexCheckpointDigest), stagedEmptyProjectIndexFullUpdateDigest: parseDigest(value.stagedEmptyProjectIndexFullUpdateDigest), stagedEmptyProjectIndexStateVectorDigest: parseDigest(value.stagedEmptyProjectIndexStateVectorDigest), stagedEmptyProjectIndexCanonicalStateDigest: parseDigest(value.stagedEmptyProjectIndexCanonicalStateDigest), protocolDigest: protocolDigest(value.protocolDigest), schemaDigest: parseDigest(value.schemaDigest), uriProtocolDigest: parseDigest(value.uriProtocolDigest) })
}

export function parseTeamEpochRolloverProof(value: unknown): TeamEpochRolloverProof {
  assertExactKeys(value, ["format", "core", "requestDigest", "requesterAdminMemberSignature"], "TeamEpochRolloverProof")
  if (value.format !== "convax.team-epoch-rollover-proof") invalid("Team rollover proof wrapper format is invalid")
  const core = parseTeamEpochRolloverProofCore(value.core)
  const requestDigest = parseDigest(value.requestDigest)
  if (requestDigest !== teamEpochRolloverProofCoreDigest(core)) invalid("Team rollover proof digest mismatch")
  return Object.freeze({ format: value.format, core, requestDigest, requesterAdminMemberSignature: parseSignature(value.requesterAdminMemberSignature) })
}

export function parseEmptyProjectIndexGenesisAttestationCore(value: unknown): EmptyProjectIndexGenesisAttestationCore {
  assertExactKeys(value, ["format", "projectId", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexScope", "teamEpochRolloverProofCoreDigest", "checkpointDigest", "fullUpdateDigest", "stateVectorDigest", "canonicalStateDigest", "emptyCatalog", "protocolDigest", "schemaDigest", "uriProtocolDigest", "validationArtifactSetDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "EmptyProjectIndexGenesisAttestationCore")
  if (value.format !== "convax.empty-project-index-genesis-attestation-core" || value.emptyCatalog !== true || value.serviceKeyPurpose !== "content-attestation") invalid("Empty ProjectIndex attestation discriminators are invalid")
  serviceKeyId(value.serviceKeyId)
  const projectId = parseProjectId(value.projectId)
  const newProjectEpoch = parseId128(value.newProjectEpoch)
  const scope = parseDocumentScope(value.newProjectIndexScope)
  if (scope.projectId !== projectId || scope.projectEpoch !== newProjectEpoch || scope.docKind !== "project-index" || scope.docId !== "project-index") invalid("Empty ProjectIndex attestation scope is invalid")
  return Object.freeze({ format: value.format, projectId, newProjectEpoch, newMembershipEpoch: parseId128(value.newMembershipEpoch), newProjectIndexScope: scope, teamEpochRolloverProofCoreDigest: parseDigest(value.teamEpochRolloverProofCoreDigest), checkpointDigest: parseDigest(value.checkpointDigest), fullUpdateDigest: parseDigest(value.fullUpdateDigest), stateVectorDigest: parseDigest(value.stateVectorDigest), canonicalStateDigest: parseDigest(value.canonicalStateDigest), emptyCatalog: true, protocolDigest: protocolDigest(value.protocolDigest), schemaDigest: parseDigest(value.schemaDigest), uriProtocolDigest: parseDigest(value.uriProtocolDigest), validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest), trustBundleDigest: parseDigest(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseEmptyProjectIndexGenesisAttestation(value: unknown): EmptyProjectIndexGenesisAttestation {
  return closeSigned(value, "convax.empty-project-index-genesis-attestation", parseEmptyProjectIndexGenesisAttestationCore, emptyProjectIndexGenesisAttestationCoreDigest, "serviceSignature")
}

export function parseTeamEpochRolloverReceiptCore(value: unknown): TeamEpochRolloverReceiptCore {
  assertExactKeys(value, ["format", "resetId", "requestDigest", "projectId", "oldProjectEpoch", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexShardEpoch", "projectResetConfirmationCoreDigest", "projectResetApprovalCoreDigest", "newMembershipSnapshotDigest", "newRequesterMemberCredentialCoreDigest", "newRequesterAdminCapabilityCoreDigest", "newProjectIndexScope", "emptyProjectIndexGenesisAttestationCoreDigest", "emptyProjectIndexCheckpointDigest", "emptyProjectIndexFullUpdateDigest", "emptyProjectIndexStateVectorDigest", "emptyProjectIndexCanonicalStateDigest", "closedSessionCredentialDigests", "retiredOldEpochState", "committedProjectResetCounter", "protocolDigest", "schemaDigest", "uriProtocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "TeamEpochRolloverReceiptCore")
  if (value.format !== "convax.team-epoch-rollover-receipt-core" || value.retiredOldEpochState !== "permanently-fenced-recovery-only" || value.serviceKeyPurpose !== "membership") invalid("Team rollover receipt discriminators are invalid")
  serviceKeyId(value.serviceKeyId)
  const projectId = parseProjectId(value.projectId)
  const newProjectEpoch = parseId128(value.newProjectEpoch)
  const scope = parseDocumentScope(value.newProjectIndexScope)
  if (scope.projectId !== projectId || scope.projectEpoch !== newProjectEpoch || scope.docKind !== "project-index" || scope.docId !== "project-index" || scope.shardEpoch !== parseId128(value.newProjectIndexShardEpoch)) invalid("Team rollover receipt ProjectIndex scope is invalid")
  return Object.freeze({ format: value.format, resetId: parseId128(value.resetId), requestDigest: parseDigest(value.requestDigest), projectId, oldProjectEpoch: parseId128(value.oldProjectEpoch), newProjectEpoch, newMembershipEpoch: parseId128(value.newMembershipEpoch), newProjectIndexShardEpoch: parseId128(value.newProjectIndexShardEpoch), projectResetConfirmationCoreDigest: parseDigest(value.projectResetConfirmationCoreDigest), projectResetApprovalCoreDigest: parseDigest(value.projectResetApprovalCoreDigest), newMembershipSnapshotDigest: parseDigest(value.newMembershipSnapshotDigest), newRequesterMemberCredentialCoreDigest: parseDigest(value.newRequesterMemberCredentialCoreDigest), newRequesterAdminCapabilityCoreDigest: parseDigest(value.newRequesterAdminCapabilityCoreDigest), newProjectIndexScope: scope, emptyProjectIndexGenesisAttestationCoreDigest: parseDigest(value.emptyProjectIndexGenesisAttestationCoreDigest), emptyProjectIndexCheckpointDigest: parseDigest(value.emptyProjectIndexCheckpointDigest), emptyProjectIndexFullUpdateDigest: parseDigest(value.emptyProjectIndexFullUpdateDigest), emptyProjectIndexStateVectorDigest: parseDigest(value.emptyProjectIndexStateVectorDigest), emptyProjectIndexCanonicalStateDigest: parseDigest(value.emptyProjectIndexCanonicalStateDigest), closedSessionCredentialDigests: sortedDigests(value.closedSessionCredentialDigests, 512), retiredOldEpochState: value.retiredOldEpochState, committedProjectResetCounter: parseUint64(value.committedProjectResetCounter), protocolDigest: protocolDigest(value.protocolDigest), schemaDigest: parseDigest(value.schemaDigest), uriProtocolDigest: parseDigest(value.uriProtocolDigest), trustBundleDigest: parseDigest(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseTeamEpochRolloverReceipt(value: unknown): TeamEpochRolloverReceipt {
  return closeSigned(value, "convax.team-epoch-rollover-receipt", parseTeamEpochRolloverReceiptCore, teamEpochRolloverReceiptCoreDigest, "serviceSignature")
}

function closeSigned<Core, Result>(value: unknown, format: string, parseCore: (value: unknown) => Core, digest: (core: Core) => Digest, signatureKey: "initiatorReplicaSignature" | "adminMemberSignature" | "serviceSignature"): Result {
  assertExactKeys(value, ["format", "core", "coreDigest", signatureKey], format)
  if (value.format !== format) invalid(`${format} wrapper format is invalid`)
  const core = parseCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== digest(core)) invalid(`${format} digest mismatch`)
  return Object.freeze({ format, core, coreDigest, [signatureKey]: parseSignature(value[signatureKey]) }) as Result
}

function canvasScope(value: unknown) {
  const scope = parseDocumentScope(value)
  if (scope.docKind !== "canvas") invalid("Shard reset scope must be Canvas")
  return scope as DocumentShardResetConfirmationCore["oldScope"]
}

function assertResetScopes(oldScope: DocumentShardResetConfirmationCore["oldScope"], newScope: DocumentShardResetConfirmationCore["newScope"], projectId: string, projectEpoch: string): void {
  if (oldScope.projectId !== projectId || newScope.projectId !== projectId || oldScope.projectEpoch !== projectEpoch || newScope.projectEpoch !== projectEpoch || oldScope.docId !== newScope.docId || oldScope.shardEpoch === newScope.shardEpoch) invalid("Shard reset scopes do not describe one epoch rotation")
}

function sortedDigests(value: unknown, maximum: number): readonly Digest[] {
  assertDenseArray(value, "digest list")
  if (value.length > maximum) invalid("Digest list exceeds capacity")
  const values = value.map(parseDigest)
  for (let index = 1; index < values.length; index += 1) if (compareUtf8(values[index - 1]!, values[index]!) >= 0) invalid("Digest list must be strictly sorted and unique")
  return Object.freeze(values)
}

function serviceKeyId(value: unknown): asserts value is string {
  assertBoundedNfcString(value, 1, 128, "reset service key id")
}

function protocolDigest(value: unknown): Digest {
  const digest = parseDigest(value)
  if (digest !== PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION.requiredProtocolDigest) invalid("Reset protocol digest is not the current protocol digest")
  return digest
}

function isShardReason(value: unknown): value is DocumentShardResetConfirmationCore["reason"] {
  return value === "incompatible-canvas-schema" || value === "document-lamport-exhaustion" || value === "unrecoverable-certified-history-corruption"
}

function isProjectReason(value: unknown): value is ProjectResetApprovalCore["reason"] {
  return value === "unsupported-portable-version" || value === "incompatible-project-index-schema" || value === "unrecoverable-project-index-corruption" || value === "explicit-empty-project-reset"
}

function invalid(message: string): never {
  throw new TypeError(message)
}
