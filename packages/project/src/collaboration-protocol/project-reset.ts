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

export type ProjectResetReason =
  | "unsupported-portable-version"
  | "incompatible-project-index-schema"
  | "unrecoverable-project-index-corruption"
  | "explicit-empty-project-reset"

export type ProjectResetConfirmationPrincipal =
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

export interface ProjectResetConfirmationCore {
  readonly format: "convax.project-reset-confirmation-core"
  readonly resetId: Id128
  readonly confirmationId: Id128
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128 | null
  readonly reason: ProjectResetReason
  readonly observedOldPrivateTreeDigest: Digest
  readonly unsupportedInventoryDigest: Digest
  readonly privateDeletionSetDigest: Digest
  readonly stableProjectIdPreserved: true
  readonly ordinaryProjectFilesPreserved: true
  readonly deletionStatement: "delete-exact-displayed-private-project-state"
  readonly requestedProtocolDigest: Digest
  readonly requestedSchemaDigest: Digest
  readonly requestedUriProtocolDigest: Digest
  readonly confirmationPrincipal: ProjectResetConfirmationPrincipal
  readonly protocolDigest: Digest
}

export interface ProjectResetConfirmation {
  readonly format: "convax.project-reset-confirmation"
  readonly core: ProjectResetConfirmationCore
  readonly coreDigest: Digest
  readonly confirmationSignature: Signature
}

export function parseProjectResetConfirmationCore(value: unknown): ProjectResetConfirmationCore {
  assertExactKeys(value, [
    "format", "resetId", "confirmationId", "projectId", "oldProjectEpoch", "reason",
    "observedOldPrivateTreeDigest", "unsupportedInventoryDigest", "privateDeletionSetDigest",
    "stableProjectIdPreserved", "ordinaryProjectFilesPreserved", "deletionStatement",
    "requestedProtocolDigest", "requestedSchemaDigest", "requestedUriProtocolDigest",
    "confirmationPrincipal", "protocolDigest",
  ], "ProjectResetConfirmationCore")
  if (
    value.format !== "convax.project-reset-confirmation-core" ||
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

export function projectResetConfirmationCoreDigest(value: ProjectResetConfirmationCore): Digest {
  return structuredDigest("convax.project-reset-confirmation-core", parseProjectResetConfirmationCore(value))
}

/** Pure Ed25519 signs the decoded core digest; there is no second signature domain. */
export function projectResetConfirmationSignatureMessage(value: Digest): Uint8Array {
  return Uint8Array.from(parseDigest(value).match(/../gu)!, (pair) => Number.parseInt(pair, 16))
}

export function parseProjectResetConfirmation(value: unknown): ProjectResetConfirmation {
  assertExactKeys(value, ["format", "core", "coreDigest", "confirmationSignature"], "ProjectResetConfirmation")
  if (value.format !== "convax.project-reset-confirmation") throw new TypeError("Project reset confirmation format is invalid")
  const core = parseProjectResetConfirmationCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== projectResetConfirmationCoreDigest(core)) throw new TypeError("Project reset confirmation digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    confirmationSignature: parseSignature(value.confirmationSignature),
  })
}

function parsePrincipal(value: unknown): ProjectResetConfirmationPrincipal {
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

function isReason(value: unknown): value is ProjectResetReason {
  return value === "unsupported-portable-version" || value === "incompatible-project-index-schema" ||
    value === "unrecoverable-project-index-corruption" || value === "explicit-empty-project-reset"
}
