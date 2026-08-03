import {
  assertBoundedNfcStringV2,
  assertExactKeysV2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  structuredDigestV2,
  type ActorIdV2,
  type DigestV2,
  type Id128V2,
  type MemberIdV2,
  type ProjectIdV2,
  type ReplicaIdV2,
  type SignatureV2,
} from "@convax/collaboration"

export type ProjectResetReasonV2 =
  | "unsupported-portable-version"
  | "incompatible-project-index-schema"
  | "unrecoverable-project-index-corruption"
  | "explicit-empty-project-reset"

export type ProjectResetConfirmationPrincipalV2 =
  | Readonly<{
      kind: "team-replica"
      memberId: MemberIdV2
      replicaId: ReplicaIdV2
      actorId: ActorIdV2
      actorCredentialCoreDigest: DigestV2
    }>
  | Readonly<{
      kind: "local-project-owner"
      localProjectBindingDigest: DigestV2
      localConfirmationKeyId: string
    }>

export interface ProjectResetConfirmationCoreV2 {
  readonly format: "convax.project-reset-confirmation-core/2"
  readonly resetId: Id128V2
  readonly confirmationId: Id128V2
  readonly projectId: ProjectIdV2
  readonly oldProjectEpoch: Id128V2 | null
  readonly reason: ProjectResetReasonV2
  readonly observedOldPrivateTreeDigest: DigestV2
  readonly unsupportedInventoryDigest: DigestV2
  readonly privateDeletionSetDigest: DigestV2
  readonly stableProjectIdPreserved: true
  readonly ordinaryProjectFilesPreserved: true
  readonly deletionStatement: "delete-exact-displayed-private-project-state"
  readonly requestedProtocolDigest: DigestV2
  readonly requestedSchemaDigest: DigestV2
  readonly requestedUriProtocolDigest: DigestV2
  readonly confirmationPrincipal: ProjectResetConfirmationPrincipalV2
  readonly protocolDigest: DigestV2
}

export interface ProjectResetConfirmationV2 {
  readonly format: "convax.project-reset-confirmation/2"
  readonly core: ProjectResetConfirmationCoreV2
  readonly coreDigest: DigestV2
  readonly confirmationSignature: SignatureV2
}

export function parseProjectResetConfirmationCoreV2(value: unknown): ProjectResetConfirmationCoreV2 {
  assertExactKeysV2(value, [
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
  const requestedProtocolDigest = parseDigestV2(value.requestedProtocolDigest)
  const protocolDigest = parseDigestV2(value.protocolDigest)
  if (protocolDigest !== requestedProtocolDigest) throw new TypeError("Project reset protocol digests differ")
  return Object.freeze({
    format: value.format,
    resetId: parseId128V2(value.resetId),
    confirmationId: parseId128V2(value.confirmationId),
    projectId: parseProjectIdV2(value.projectId),
    oldProjectEpoch: value.oldProjectEpoch === null ? null : parseId128V2(value.oldProjectEpoch),
    reason: value.reason,
    observedOldPrivateTreeDigest: parseDigestV2(value.observedOldPrivateTreeDigest),
    unsupportedInventoryDigest: parseDigestV2(value.unsupportedInventoryDigest),
    privateDeletionSetDigest: parseDigestV2(value.privateDeletionSetDigest),
    stableProjectIdPreserved: true,
    ordinaryProjectFilesPreserved: true,
    deletionStatement: value.deletionStatement,
    requestedProtocolDigest,
    requestedSchemaDigest: parseDigestV2(value.requestedSchemaDigest),
    requestedUriProtocolDigest: parseDigestV2(value.requestedUriProtocolDigest),
    confirmationPrincipal: parsePrincipal(value.confirmationPrincipal),
    protocolDigest,
  })
}

export function projectResetConfirmationCoreDigestV2(value: ProjectResetConfirmationCoreV2): DigestV2 {
  return structuredDigestV2("convax.project-reset-confirmation-core/2", parseProjectResetConfirmationCoreV2(value))
}

/** Pure Ed25519 signs the decoded core digest; there is no second signature domain. */
export function projectResetConfirmationSignatureMessageV2(value: DigestV2): Uint8Array {
  return Uint8Array.from(parseDigestV2(value).match(/../gu)!, (pair) => Number.parseInt(pair, 16))
}

export function parseProjectResetConfirmationV2(value: unknown): ProjectResetConfirmationV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "confirmationSignature"], "ProjectResetConfirmationV2")
  if (value.format !== "convax.project-reset-confirmation/2") throw new TypeError("Project reset confirmation format is invalid")
  const core = parseProjectResetConfirmationCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== projectResetConfirmationCoreDigestV2(core)) throw new TypeError("Project reset confirmation digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    confirmationSignature: parseSignatureV2(value.confirmationSignature),
  })
}

function parsePrincipal(value: unknown): ProjectResetConfirmationPrincipalV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Project reset principal is invalid")
  if ((value as { kind?: unknown }).kind === "local-project-owner") {
    assertExactKeysV2(value, ["kind", "localProjectBindingDigest", "localConfirmationKeyId"], "Local Project reset principal")
    assertBoundedNfcStringV2(value.localConfirmationKeyId, 1, 128, "local confirmation key id")
    return Object.freeze({
      kind: "local-project-owner",
      localProjectBindingDigest: parseDigestV2(value.localProjectBindingDigest),
      localConfirmationKeyId: value.localConfirmationKeyId,
    })
  }
  assertExactKeysV2(value, ["kind", "memberId", "replicaId", "actorId", "actorCredentialCoreDigest"], "Team Project reset principal")
  if (value.kind !== "team-replica") throw new TypeError("Project reset principal kind is invalid")
  return Object.freeze({
    kind: value.kind,
    memberId: parseMemberIdV2(value.memberId),
    replicaId: parseReplicaIdV2(value.replicaId),
    actorId: parseActorIdV2(value.actorId),
    actorCredentialCoreDigest: parseDigestV2(value.actorCredentialCoreDigest),
  })
}

function isReason(value: unknown): value is ProjectResetReasonV2 {
  return value === "unsupported-portable-version" || value === "incompatible-project-index-schema" ||
    value === "unrecoverable-project-index-corruption" || value === "explicit-empty-project-reset"
}
