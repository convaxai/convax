import {
  assertBoundedNfcStringV2,
  assertDenseArrayV2,
  assertExactKeysV2,
  compareUtf8V2,
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint64V2,
  structuredDigestV2,
  type DigestV2,
} from "@convax/collaboration"
import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2 } from "./kernel-integration"
import type {
  DocumentShardResetApprovalCoreV2,
  DocumentShardResetApprovalV2,
  DocumentShardResetConfirmationCoreV2,
  DocumentShardResetConfirmationV2,
} from "./reset-contracts"
import type {
  EmptyProjectIndexGenesisAttestationCoreV2,
  EmptyProjectIndexGenesisAttestationV2,
  ProjectResetApprovalCoreV2,
  ProjectResetApprovalV2,
  TeamEpochRolloverChallengeCoreV2,
  TeamEpochRolloverChallengeV2,
  TeamEpochRolloverProofCoreV2,
  TeamEpochRolloverProofV2,
  TeamEpochRolloverReceiptCoreV2,
  TeamEpochRolloverReceiptV2,
} from "./rollover-contracts"

export function documentShardResetConfirmationCoreDigestV2(core: DocumentShardResetConfirmationCoreV2): DigestV2 {
  return structuredDigestV2("convax.document-shard-reset-confirmation-core/2", parseDocumentShardResetConfirmationCoreV2(core))
}

export function documentShardResetApprovalCoreDigestV2(core: DocumentShardResetApprovalCoreV2): DigestV2 {
  return structuredDigestV2("convax.document-shard-reset-approval-core/2", parseDocumentShardResetApprovalCoreV2(core))
}

export function projectResetApprovalCoreDigestV2(core: ProjectResetApprovalCoreV2): DigestV2 {
  return structuredDigestV2("convax.project-reset-approval-core/2", parseProjectResetApprovalCoreV2(core))
}

export function teamEpochRolloverChallengeCoreDigestV2(core: TeamEpochRolloverChallengeCoreV2): DigestV2 {
  return structuredDigestV2("convax.team-epoch-rollover-challenge-core/2", parseTeamEpochRolloverChallengeCoreV2(core))
}

export function teamEpochRolloverProofCoreDigestV2(core: TeamEpochRolloverProofCoreV2): DigestV2 {
  return structuredDigestV2("convax.team-epoch-rollover-proof-core/2", parseTeamEpochRolloverProofCoreV2(core))
}

export function emptyProjectIndexGenesisAttestationCoreDigestV2(core: EmptyProjectIndexGenesisAttestationCoreV2): DigestV2 {
  return structuredDigestV2("convax.empty-project-index-genesis-attestation-core/2", parseEmptyProjectIndexGenesisAttestationCoreV2(core))
}

export function teamEpochRolloverReceiptCoreDigestV2(core: TeamEpochRolloverReceiptCoreV2): DigestV2 {
  return structuredDigestV2("convax.team-epoch-rollover-receipt-core/2", parseTeamEpochRolloverReceiptCoreV2(core))
}

export function parseDocumentShardResetConfirmationCoreV2(value: unknown): DocumentShardResetConfirmationCoreV2 {
  assertExactKeysV2(value, ["format", "confirmationId", "projectId", "projectEpoch", "oldScope", "newScope", "reason", "routeCasCoreDigest", "predecessorActivationDigest", "stagedGenesisCheckpointObjectDigest", "stagedGenesisFullUpdateDigest", "stagedGenesisStateVectorDigest", "initiatorMemberId", "initiatorReplicaId", "initiatorActorId", "initiatorActorCredentialCoreDigest", "confirmationStatement", "protocolDigest"], "DocumentShardResetConfirmationCoreV2")
  if (value.format !== "convax.document-shard-reset-confirmation-core/2" || !isShardReason(value.reason) || value.confirmationStatement !== "replace-one-canvas-shard-and-retain-old-recovery-bytes") invalid("Shard reset confirmation discriminators are invalid")
  const oldScope = canvasScope(value.oldScope)
  const newScope = canvasScope(value.newScope)
  assertResetScopes(oldScope, newScope, parseProjectIdV2(value.projectId), parseId128V2(value.projectEpoch))
  return Object.freeze({ format: value.format, confirmationId: parseId128V2(value.confirmationId), projectId: parseProjectIdV2(value.projectId), projectEpoch: parseId128V2(value.projectEpoch), oldScope, newScope, reason: value.reason, routeCasCoreDigest: parseDigestV2(value.routeCasCoreDigest), predecessorActivationDigest: parseDigestV2(value.predecessorActivationDigest), stagedGenesisCheckpointObjectDigest: parseDigestV2(value.stagedGenesisCheckpointObjectDigest), stagedGenesisFullUpdateDigest: parseDigestV2(value.stagedGenesisFullUpdateDigest), stagedGenesisStateVectorDigest: parseDigestV2(value.stagedGenesisStateVectorDigest), initiatorMemberId: parseMemberIdV2(value.initiatorMemberId), initiatorReplicaId: parseReplicaIdV2(value.initiatorReplicaId), initiatorActorId: parseActorIdV2(value.initiatorActorId), initiatorActorCredentialCoreDigest: parseDigestV2(value.initiatorActorCredentialCoreDigest), confirmationStatement: value.confirmationStatement, protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentShardResetConfirmationV2(value: unknown): DocumentShardResetConfirmationV2 {
  return closeSigned(value, "convax.document-shard-reset-confirmation/2", parseDocumentShardResetConfirmationCoreV2, documentShardResetConfirmationCoreDigestV2, "initiatorReplicaSignature")
}

export function parseDocumentShardResetApprovalCoreV2(value: unknown): DocumentShardResetApprovalCoreV2 {
  assertExactKeysV2(value, ["format", "approvalId", "resetClaimCoreDigest", "confirmationCoreDigest", "projectId", "projectEpoch", "oldScope", "newScope", "reason", "routeCasCoreDigest", "adminMemberId", "adminMemberAuthorizationEpoch", "adminCapabilityCoreDigest", "approvalStatement", "protocolDigest"], "DocumentShardResetApprovalCoreV2")
  if (value.format !== "convax.document-shard-reset-approval-core/2" || !isShardReason(value.reason) || value.approvalStatement !== "approve-exact-canvas-shard-reset") invalid("Shard reset approval discriminators are invalid")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const oldScope = canvasScope(value.oldScope)
  const newScope = canvasScope(value.newScope)
  assertResetScopes(oldScope, newScope, projectId, projectEpoch)
  return Object.freeze({ format: value.format, approvalId: parseId128V2(value.approvalId), resetClaimCoreDigest: parseDigestV2(value.resetClaimCoreDigest), confirmationCoreDigest: parseDigestV2(value.confirmationCoreDigest), projectId, projectEpoch, oldScope, newScope, reason: value.reason, routeCasCoreDigest: parseDigestV2(value.routeCasCoreDigest), adminMemberId: parseMemberIdV2(value.adminMemberId), adminMemberAuthorizationEpoch: parseId128V2(value.adminMemberAuthorizationEpoch), adminCapabilityCoreDigest: parseDigestV2(value.adminCapabilityCoreDigest), approvalStatement: value.approvalStatement, protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentShardResetApprovalV2(value: unknown): DocumentShardResetApprovalV2 {
  return closeSigned(value, "convax.document-shard-reset-approval/2", parseDocumentShardResetApprovalCoreV2, documentShardResetApprovalCoreDigestV2, "adminMemberSignature")
}

export function parseProjectResetApprovalCoreV2(value: unknown): ProjectResetApprovalCoreV2 {
  assertExactKeysV2(value, ["format", "resetId", "approvalId", "confirmationCoreDigest", "projectId", "oldProjectEpoch", "reason", "observedOldPrivateTreeDigest", "unsupportedInventoryDigest", "privateDeletionSetDigest", "requestedProtocolDigest", "requestedSchemaDigest", "requestedUriProtocolDigest", "adminMemberId", "adminMemberAuthorizationEpoch", "adminCapabilityCoreDigest", "approvalStatement", "protocolDigest"], "ProjectResetApprovalCoreV2")
  if (value.format !== "convax.project-reset-approval-core/2" || !isProjectReason(value.reason) || value.approvalStatement !== "approve-exact-team-project-reset") invalid("Project reset approval discriminators are invalid")
  const requestedProtocolDigest = protocolDigest(value.requestedProtocolDigest)
  if (protocolDigest(value.protocolDigest) !== requestedProtocolDigest) invalid("Project reset approval protocol digests differ")
  return Object.freeze({ format: value.format, resetId: parseId128V2(value.resetId), approvalId: parseId128V2(value.approvalId), confirmationCoreDigest: parseDigestV2(value.confirmationCoreDigest), projectId: parseProjectIdV2(value.projectId), oldProjectEpoch: parseId128V2(value.oldProjectEpoch), reason: value.reason, observedOldPrivateTreeDigest: parseDigestV2(value.observedOldPrivateTreeDigest), unsupportedInventoryDigest: parseDigestV2(value.unsupportedInventoryDigest), privateDeletionSetDigest: parseDigestV2(value.privateDeletionSetDigest), requestedProtocolDigest, requestedSchemaDigest: parseDigestV2(value.requestedSchemaDigest), requestedUriProtocolDigest: parseDigestV2(value.requestedUriProtocolDigest), adminMemberId: parseMemberIdV2(value.adminMemberId), adminMemberAuthorizationEpoch: parseId128V2(value.adminMemberAuthorizationEpoch), adminCapabilityCoreDigest: parseDigestV2(value.adminCapabilityCoreDigest), approvalStatement: value.approvalStatement, protocolDigest: requestedProtocolDigest })
}

export function parseProjectResetApprovalV2(value: unknown): ProjectResetApprovalV2 {
  return closeSigned(value, "convax.project-reset-approval/2", parseProjectResetApprovalCoreV2, projectResetApprovalCoreDigestV2, "adminMemberSignature")
}

export function parseTeamEpochRolloverChallengeCoreV2(value: unknown): TeamEpochRolloverChallengeCoreV2 {
  assertExactKeysV2(value, ["format", "challengeId", "resetId", "projectId", "oldProjectEpoch", "expectedProjectResetCounter", "projectResetConfirmationCoreDigest", "projectResetApprovalCoreDigest", "observedOldMembershipSnapshotDigest", "observedOldRegistryRootDigest", "observedOldPrivateTreeDigest", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexShardEpoch", "preparedNewMembershipSnapshotCoreDigest", "serverNonce", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "TeamEpochRolloverChallengeCoreV2")
  if (value.format !== "convax.team-epoch-rollover-challenge-core/2" || value.serviceKeyPurpose !== "membership") invalid("Team rollover challenge discriminators are invalid")
  serviceKeyId(value.serviceKeyId)
  return Object.freeze({ format: value.format, challengeId: parseId128V2(value.challengeId), resetId: parseId128V2(value.resetId), projectId: parseProjectIdV2(value.projectId), oldProjectEpoch: parseId128V2(value.oldProjectEpoch), expectedProjectResetCounter: parseUint64V2(value.expectedProjectResetCounter), projectResetConfirmationCoreDigest: parseDigestV2(value.projectResetConfirmationCoreDigest), projectResetApprovalCoreDigest: parseDigestV2(value.projectResetApprovalCoreDigest), observedOldMembershipSnapshotDigest: parseDigestV2(value.observedOldMembershipSnapshotDigest), observedOldRegistryRootDigest: parseDigestV2(value.observedOldRegistryRootDigest), observedOldPrivateTreeDigest: parseDigestV2(value.observedOldPrivateTreeDigest), newProjectEpoch: parseId128V2(value.newProjectEpoch), newMembershipEpoch: parseId128V2(value.newMembershipEpoch), newProjectIndexShardEpoch: parseId128V2(value.newProjectIndexShardEpoch), preparedNewMembershipSnapshotCoreDigest: parseDigestV2(value.preparedNewMembershipSnapshotCoreDigest), serverNonce: parseId128V2(value.serverNonce), issuedAtUnixMs: parseUint64V2(value.issuedAtUnixMs), expiresAtUnixMs: parseUint64V2(value.expiresAtUnixMs), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigestV2(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseTeamEpochRolloverChallengeV2(value: unknown): TeamEpochRolloverChallengeV2 {
  return closeSigned(value, "convax.team-epoch-rollover-challenge/2", parseTeamEpochRolloverChallengeCoreV2, teamEpochRolloverChallengeCoreDigestV2, "serviceSignature")
}

export function parseTeamEpochRolloverProofCoreV2(value: unknown): TeamEpochRolloverProofCoreV2 {
  assertExactKeysV2(value, ["format", "challengeDigest", "resetId", "projectId", "oldProjectEpoch", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexShardEpoch", "expectedProjectResetCounter", "projectResetConfirmationCoreDigest", "projectResetApprovalCoreDigest", "serverNonce", "requesterMemberId", "requesterMemberAuthorizationEpoch", "requesterAdminCapabilityCoreDigest", "stagedEmptyProjectIndexCheckpointDigest", "stagedEmptyProjectIndexFullUpdateDigest", "stagedEmptyProjectIndexStateVectorDigest", "stagedEmptyProjectIndexCanonicalStateDigest", "protocolDigest", "schemaDigest", "uriProtocolDigest"], "TeamEpochRolloverProofCoreV2")
  if (value.format !== "convax.team-epoch-rollover-proof-core/2") invalid("Team rollover proof format is invalid")
  return Object.freeze({ format: value.format, challengeDigest: parseDigestV2(value.challengeDigest), resetId: parseId128V2(value.resetId), projectId: parseProjectIdV2(value.projectId), oldProjectEpoch: parseId128V2(value.oldProjectEpoch), newProjectEpoch: parseId128V2(value.newProjectEpoch), newMembershipEpoch: parseId128V2(value.newMembershipEpoch), newProjectIndexShardEpoch: parseId128V2(value.newProjectIndexShardEpoch), expectedProjectResetCounter: parseUint64V2(value.expectedProjectResetCounter), projectResetConfirmationCoreDigest: parseDigestV2(value.projectResetConfirmationCoreDigest), projectResetApprovalCoreDigest: parseDigestV2(value.projectResetApprovalCoreDigest), serverNonce: parseId128V2(value.serverNonce), requesterMemberId: parseMemberIdV2(value.requesterMemberId), requesterMemberAuthorizationEpoch: parseId128V2(value.requesterMemberAuthorizationEpoch), requesterAdminCapabilityCoreDigest: parseDigestV2(value.requesterAdminCapabilityCoreDigest), stagedEmptyProjectIndexCheckpointDigest: parseDigestV2(value.stagedEmptyProjectIndexCheckpointDigest), stagedEmptyProjectIndexFullUpdateDigest: parseDigestV2(value.stagedEmptyProjectIndexFullUpdateDigest), stagedEmptyProjectIndexStateVectorDigest: parseDigestV2(value.stagedEmptyProjectIndexStateVectorDigest), stagedEmptyProjectIndexCanonicalStateDigest: parseDigestV2(value.stagedEmptyProjectIndexCanonicalStateDigest), protocolDigest: protocolDigest(value.protocolDigest), schemaDigest: parseDigestV2(value.schemaDigest), uriProtocolDigest: parseDigestV2(value.uriProtocolDigest) })
}

export function parseTeamEpochRolloverProofV2(value: unknown): TeamEpochRolloverProofV2 {
  assertExactKeysV2(value, ["format", "core", "requestDigest", "requesterAdminMemberSignature"], "TeamEpochRolloverProofV2")
  if (value.format !== "convax.team-epoch-rollover-proof/2") invalid("Team rollover proof wrapper format is invalid")
  const core = parseTeamEpochRolloverProofCoreV2(value.core)
  const requestDigest = parseDigestV2(value.requestDigest)
  if (requestDigest !== teamEpochRolloverProofCoreDigestV2(core)) invalid("Team rollover proof digest mismatch")
  return Object.freeze({ format: value.format, core, requestDigest, requesterAdminMemberSignature: parseSignatureV2(value.requesterAdminMemberSignature) })
}

export function parseEmptyProjectIndexGenesisAttestationCoreV2(value: unknown): EmptyProjectIndexGenesisAttestationCoreV2 {
  assertExactKeysV2(value, ["format", "projectId", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexScope", "teamEpochRolloverProofCoreDigest", "checkpointDigest", "fullUpdateDigest", "stateVectorDigest", "canonicalStateDigest", "emptyCatalog", "protocolDigest", "schemaDigest", "uriProtocolDigest", "validationArtifactSetDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "EmptyProjectIndexGenesisAttestationCoreV2")
  if (value.format !== "convax.empty-project-index-genesis-attestation-core/2" || value.emptyCatalog !== true || value.serviceKeyPurpose !== "content-attestation") invalid("Empty ProjectIndex attestation discriminators are invalid")
  serviceKeyId(value.serviceKeyId)
  const projectId = parseProjectIdV2(value.projectId)
  const newProjectEpoch = parseId128V2(value.newProjectEpoch)
  const scope = parseDocumentScopeV2(value.newProjectIndexScope)
  if (scope.projectId !== projectId || scope.projectEpoch !== newProjectEpoch || scope.docKind !== "project-index" || scope.docId !== "project-index") invalid("Empty ProjectIndex attestation scope is invalid")
  return Object.freeze({ format: value.format, projectId, newProjectEpoch, newMembershipEpoch: parseId128V2(value.newMembershipEpoch), newProjectIndexScope: scope, teamEpochRolloverProofCoreDigest: parseDigestV2(value.teamEpochRolloverProofCoreDigest), checkpointDigest: parseDigestV2(value.checkpointDigest), fullUpdateDigest: parseDigestV2(value.fullUpdateDigest), stateVectorDigest: parseDigestV2(value.stateVectorDigest), canonicalStateDigest: parseDigestV2(value.canonicalStateDigest), emptyCatalog: true, protocolDigest: protocolDigest(value.protocolDigest), schemaDigest: parseDigestV2(value.schemaDigest), uriProtocolDigest: parseDigestV2(value.uriProtocolDigest), validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest), trustBundleDigest: parseDigestV2(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseEmptyProjectIndexGenesisAttestationV2(value: unknown): EmptyProjectIndexGenesisAttestationV2 {
  return closeSigned(value, "convax.empty-project-index-genesis-attestation/2", parseEmptyProjectIndexGenesisAttestationCoreV2, emptyProjectIndexGenesisAttestationCoreDigestV2, "serviceSignature")
}

export function parseTeamEpochRolloverReceiptCoreV2(value: unknown): TeamEpochRolloverReceiptCoreV2 {
  assertExactKeysV2(value, ["format", "resetId", "requestDigest", "projectId", "oldProjectEpoch", "newProjectEpoch", "newMembershipEpoch", "newProjectIndexShardEpoch", "projectResetConfirmationCoreDigest", "projectResetApprovalCoreDigest", "newMembershipSnapshotDigest", "newRequesterMemberCredentialCoreDigest", "newRequesterAdminCapabilityCoreDigest", "newProjectIndexScope", "emptyProjectIndexGenesisAttestationCoreDigest", "emptyProjectIndexCheckpointDigest", "emptyProjectIndexFullUpdateDigest", "emptyProjectIndexStateVectorDigest", "emptyProjectIndexCanonicalStateDigest", "closedSessionCredentialDigests", "retiredOldEpochState", "committedProjectResetCounter", "protocolDigest", "schemaDigest", "uriProtocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "TeamEpochRolloverReceiptCoreV2")
  if (value.format !== "convax.team-epoch-rollover-receipt-core/2" || value.retiredOldEpochState !== "permanently-fenced-recovery-only" || value.serviceKeyPurpose !== "membership") invalid("Team rollover receipt discriminators are invalid")
  serviceKeyId(value.serviceKeyId)
  const projectId = parseProjectIdV2(value.projectId)
  const newProjectEpoch = parseId128V2(value.newProjectEpoch)
  const scope = parseDocumentScopeV2(value.newProjectIndexScope)
  if (scope.projectId !== projectId || scope.projectEpoch !== newProjectEpoch || scope.docKind !== "project-index" || scope.docId !== "project-index" || scope.shardEpoch !== parseId128V2(value.newProjectIndexShardEpoch)) invalid("Team rollover receipt ProjectIndex scope is invalid")
  return Object.freeze({ format: value.format, resetId: parseId128V2(value.resetId), requestDigest: parseDigestV2(value.requestDigest), projectId, oldProjectEpoch: parseId128V2(value.oldProjectEpoch), newProjectEpoch, newMembershipEpoch: parseId128V2(value.newMembershipEpoch), newProjectIndexShardEpoch: parseId128V2(value.newProjectIndexShardEpoch), projectResetConfirmationCoreDigest: parseDigestV2(value.projectResetConfirmationCoreDigest), projectResetApprovalCoreDigest: parseDigestV2(value.projectResetApprovalCoreDigest), newMembershipSnapshotDigest: parseDigestV2(value.newMembershipSnapshotDigest), newRequesterMemberCredentialCoreDigest: parseDigestV2(value.newRequesterMemberCredentialCoreDigest), newRequesterAdminCapabilityCoreDigest: parseDigestV2(value.newRequesterAdminCapabilityCoreDigest), newProjectIndexScope: scope, emptyProjectIndexGenesisAttestationCoreDigest: parseDigestV2(value.emptyProjectIndexGenesisAttestationCoreDigest), emptyProjectIndexCheckpointDigest: parseDigestV2(value.emptyProjectIndexCheckpointDigest), emptyProjectIndexFullUpdateDigest: parseDigestV2(value.emptyProjectIndexFullUpdateDigest), emptyProjectIndexStateVectorDigest: parseDigestV2(value.emptyProjectIndexStateVectorDigest), emptyProjectIndexCanonicalStateDigest: parseDigestV2(value.emptyProjectIndexCanonicalStateDigest), closedSessionCredentialDigests: sortedDigests(value.closedSessionCredentialDigests, 512), retiredOldEpochState: value.retiredOldEpochState, committedProjectResetCounter: parseUint64V2(value.committedProjectResetCounter), protocolDigest: protocolDigest(value.protocolDigest), schemaDigest: parseDigestV2(value.schemaDigest), uriProtocolDigest: parseDigestV2(value.uriProtocolDigest), trustBundleDigest: parseDigestV2(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseTeamEpochRolloverReceiptV2(value: unknown): TeamEpochRolloverReceiptV2 {
  return closeSigned(value, "convax.team-epoch-rollover-receipt/2", parseTeamEpochRolloverReceiptCoreV2, teamEpochRolloverReceiptCoreDigestV2, "serviceSignature")
}

function closeSigned<Core, Result>(value: unknown, format: string, parseCore: (value: unknown) => Core, digest: (core: Core) => DigestV2, signatureKey: "initiatorReplicaSignature" | "adminMemberSignature" | "serviceSignature"): Result {
  assertExactKeysV2(value, ["format", "core", "coreDigest", signatureKey], format)
  if (value.format !== format) invalid(`${format} wrapper format is invalid`)
  const core = parseCore(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== digest(core)) invalid(`${format} digest mismatch`)
  return Object.freeze({ format, core, coreDigest, [signatureKey]: parseSignatureV2(value[signatureKey]) }) as Result
}

function canvasScope(value: unknown) {
  const scope = parseDocumentScopeV2(value)
  if (scope.docKind !== "canvas") invalid("Shard reset scope must be Canvas")
  return scope as DocumentShardResetConfirmationCoreV2["oldScope"]
}

function assertResetScopes(oldScope: DocumentShardResetConfirmationCoreV2["oldScope"], newScope: DocumentShardResetConfirmationCoreV2["newScope"], projectId: string, projectEpoch: string): void {
  if (oldScope.projectId !== projectId || newScope.projectId !== projectId || oldScope.projectEpoch !== projectEpoch || newScope.projectEpoch !== projectEpoch || oldScope.docId !== newScope.docId || oldScope.shardEpoch === newScope.shardEpoch) invalid("Shard reset scopes do not describe one epoch rotation")
}

function sortedDigests(value: unknown, maximum: number): readonly DigestV2[] {
  assertDenseArrayV2(value, "digest list")
  if (value.length > maximum) invalid("Digest list exceeds capacity")
  const values = value.map(parseDigestV2)
  for (let index = 1; index < values.length; index += 1) if (compareUtf8V2(values[index - 1]!, values[index]!) >= 0) invalid("Digest list must be strictly sorted and unique")
  return Object.freeze(values)
}

function serviceKeyId(value: unknown): asserts value is string {
  assertBoundedNfcStringV2(value, 1, 128, "reset service key id")
}

function protocolDigest(value: unknown): DigestV2 {
  const digest = parseDigestV2(value)
  if (digest !== PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2.requiredProtocolDigest) invalid("Reset protocol digest is not the selected R5 digest")
  return digest
}

function isShardReason(value: unknown): value is DocumentShardResetConfirmationCoreV2["reason"] {
  return value === "incompatible-canvas-schema" || value === "document-lamport-exhaustion" || value === "unrecoverable-certified-history-corruption"
}

function isProjectReason(value: unknown): value is ProjectResetApprovalCoreV2["reason"] {
  return value === "unsupported-portable-version" || value === "incompatible-project-index-schema" || value === "unrecoverable-project-index-corruption" || value === "explicit-empty-project-reset"
}

function invalid(message: string): never {
  throw new TypeError(message)
}
