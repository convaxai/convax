import {
  assertBoundedNfcString,
  assertExactKeys,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  structuredDigest,
  type ActorId,
  type Digest,
  type Id128,
  type MemberId,
  type ProjectId,
  type ReplicaId,
  type Signature,
} from "@convax/collaboration"

export type ProjectResetReasonV2 =
  | "unsupported-portable-version"
  | "incompatible-project-index-schema"
  | "unrecoverable-project-index-corruption"
  | "explicit-empty-project-reset"

export type ProjectResetConfirmationPrincipalV2 =
  | Readonly<{
      kind: "team-replica"
      memberId: MemberId
      replicaId: ReplicaId
      actorId: ActorId
      actorCredentialCoreDigest: Digest
    }>
  | Readonly<{
      kind: "local-project-owner"
      localProjectBindingDigest: Digest
      localConfirmationKeyId: string
    }>

export interface ProjectResetConfirmationCoreV2 {
  readonly format: "convax.project-reset-confirmation-core/2"
  readonly resetId: Id128
  readonly confirmationId: Id128
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128 | null
  readonly reason: ProjectResetReasonV2
  readonly observedOldPrivateTreeDigest: Digest
  readonly unsupportedInventoryDigest: Digest
  readonly privateDeletionSetDigest: Digest
  readonly stableProjectIdPreserved: true
  readonly ordinaryProjectFilesPreserved: true
  readonly deletionStatement: "delete-exact-displayed-private-project-state"
  readonly requestedProtocolDigest: Digest
  readonly requestedSchemaDigest: Digest
  readonly requestedUriProtocolDigest: Digest
  readonly confirmationPrincipal: ProjectResetConfirmationPrincipalV2
  readonly protocolDigest: Digest
}

export interface ProjectResetConfirmationV2 {
  readonly format: "convax.project-reset-confirmation/2"
  readonly core: ProjectResetConfirmationCoreV2
  readonly coreDigest: Digest
  readonly confirmationSignature: Signature
}

export function parseProjectResetConfirmationCoreV2(value: unknown): ProjectResetConfirmationCoreV2 {
  assertExactKeys(value, [
    "format", "resetId", "confirmationId", "projectId", "oldProjectEpoch", "reason",
    "observedOldPrivateTreeDigest", "unsupportedInventoryDigest", "privateDeletionSetDigest",
    "stableProjectIdPreserved", "ordinaryProjectFilesPreserved", "deletionStatement",
    "requestedProtocolDigest", "requestedSchemaDigest", "requestedUriProtocolDigest",
    "confirmationPrincipal", "protocolDigest",
  ], "ProjectResetConfirmationCoreV2")
  if (
    value.format !== "convax.project-reset-confirmation-core/2" ||
    !isReason(value.reason) ||
    value.stableProjectIdPreserved !== true ||
    value.ordinaryProjectFilesPreserved !== true ||
    value.deletionStatement !== "delete-exact-displayed-private-project-state"
  ) throw new TypeError("Project reset confirmation core discriminators are invalid")
  const requestedProtocolDigest = parseDigest(value.requestedProtocolDigest)
  const protocolDigest = parseDigest(value.protocolDigest)
  if (protocolDigest !== requestedProtocolDigest) throw new TypeError("Project reset protocol digests differ")
  return Object.freeze({
    format: value.format,
    resetId: parseId128(value.resetId),
    confirmationId: parseId128(value.confirmationId),
    projectId: parseProjectId(value.projectId),
    oldProjectEpoch: value.oldProjectEpoch === null ? null : parseId128(value.oldProjectEpoch),
    reason: value.reason,
    observedOldPrivateTreeDigest: parseDigest(value.observedOldPrivateTreeDigest),
    unsupportedInventoryDigest: parseDigest(value.unsupportedInventoryDigest),
    privateDeletionSetDigest: parseDigest(value.privateDeletionSetDigest),
    stableProjectIdPreserved: true,
    ordinaryProjectFilesPreserved: true,
    deletionStatement: value.deletionStatement,
    requestedProtocolDigest,
    requestedSchemaDigest: parseDigest(value.requestedSchemaDigest),
    requestedUriProtocolDigest: parseDigest(value.requestedUriProtocolDigest),
    confirmationPrincipal: parsePrincipal(value.confirmationPrincipal),
    protocolDigest,
  })
}

export function projectResetConfirmationCoreDigestV2(value: ProjectResetConfirmationCoreV2): Digest {
  return structuredDigest("convax.project-reset-confirmation-core/2", parseProjectResetConfirmationCoreV2(value))
}

/** Pure Ed25519 signs the decoded core digest; there is no second signature domain. */
export function projectResetConfirmationSignatureMessageV2(value: Digest): Uint8Array {
  return Uint8Array.from(parseDigest(value).match(/../gu)!, (pair) => Number.parseInt(pair, 16))
}

export function parseProjectResetConfirmationV2(value: unknown): ProjectResetConfirmationV2 {
  assertExactKeys(value, ["format", "core", "coreDigest", "confirmationSignature"], "ProjectResetConfirmationV2")
  if (value.format !== "convax.project-reset-confirmation/2") throw new TypeError("Project reset confirmation format is invalid")
  const core = parseProjectResetConfirmationCoreV2(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== projectResetConfirmationCoreDigestV2(core)) throw new TypeError("Project reset confirmation digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    confirmationSignature: parseSignature(value.confirmationSignature),
  })
}

function parsePrincipal(value: unknown): ProjectResetConfirmationPrincipalV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Project reset principal is invalid")
  if ((value as { kind?: unknown }).kind === "local-project-owner") {
    assertExactKeys(value, ["kind", "localProjectBindingDigest", "localConfirmationKeyId"], "Local Project reset principal")
    assertBoundedNfcString(value.localConfirmationKeyId, 1, 128, "local confirmation key id")
    return Object.freeze({
      kind: "local-project-owner",
      localProjectBindingDigest: parseDigest(value.localProjectBindingDigest),
      localConfirmationKeyId: value.localConfirmationKeyId,
    })
  }
  assertExactKeys(value, ["kind", "memberId", "replicaId", "actorId", "actorCredentialCoreDigest"], "Team Project reset principal")
  if (value.kind !== "team-replica") throw new TypeError("Project reset principal kind is invalid")
  return Object.freeze({
    kind: value.kind,
    memberId: parseMemberId(value.memberId),
    replicaId: parseReplicaId(value.replicaId),
    actorId: parseActorId(value.actorId),
    actorCredentialCoreDigest: parseDigest(value.actorCredentialCoreDigest),
  })
}

function isReason(value: unknown): value is ProjectResetReasonV2 {
  return value === "unsupported-portable-version" || value === "incompatible-project-index-schema" ||
    value === "unrecoverable-project-index-corruption" || value === "explicit-empty-project-reset"
}
