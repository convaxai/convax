import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseProjectId,
  type Digest,
  type Id128,
  type ProjectId,
} from "@convax/collaboration"

import {
  parseProjectResetConfirmationV2,
  type ProjectResetConfirmationV2,
  type ProjectResetReasonV2,
} from "../../collaboration-protocol/project-reset"
import { fsyncProjectDirectoryV2 } from "./directory-durability"

const RECORDS_FILE = "project-reset-records-v2.jcs"
const MAX_RECORD_BYTES = 64 * 1024

export type ProjectResetManifestStateV2 =
  | "reset-staged"
  | "reset-authorized"
  | "reset-publishing"
  | "reset-published"
  | "reset-retiring-old"
  | "reset-complete"

export interface ProjectResetManifestV2 {
  readonly format: "convax.project-reset-manifest/2"
  readonly resetId: Id128
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128 | null
  readonly newProjectEpoch: Id128
  readonly newMembershipEpoch: Id128 | null
  readonly newProjectIndexShardEpoch: Id128
  readonly reason: ProjectResetReasonV2
  readonly observedOldPrivateTreeDigest: Digest
  readonly unsupportedInventoryDigest: Digest
  readonly privateDeletionSetDigest: Digest
  readonly requestedProtocolDigest: Digest
  readonly requestedSchemaDigest: Digest
  readonly requestedUriProtocolDigest: Digest
  readonly emptyProjectIndexCheckpointDigest: Digest
  readonly emptyProjectIndexFullUpdateDigest: Digest
  readonly emptyProjectIndexStateVectorDigest: Digest
  readonly emptyProjectIndexCanonicalStateDigest: Digest
  readonly projectResetConfirmationCoreDigest: Digest
  readonly projectResetApprovalCoreDigest: Digest | null
  readonly teamEpochRolloverRequestDigest: Digest | null
  readonly emptyProjectIndexGenesisAttestationCoreDigest: Digest | null
  readonly teamEpochRolloverReceiptCoreDigest: Digest | null
  readonly state: ProjectResetManifestStateV2
}

export interface ProjectResetRecordsV2 {
  readonly format: "convax.project-reset-records/2"
  readonly manifest: ProjectResetManifestV2
  readonly confirmation: ProjectResetConfirmationV2
}

export async function writeProjectResetRecordsV2(
  collaborationDirectory: string,
  records: ProjectResetRecordsV2,
): Promise<void> {
  const directory = await requireCollaborationDirectory(collaborationDirectory)
  const normalized = normalizeRecords(records)
  await writeOrReplaceRecord(path.join(directory, RECORDS_FILE), encodeBounded(normalized))
}

export async function readProjectResetRecordsV2(
  collaborationDirectory: string,
): Promise<ProjectResetRecordsV2> {
  const directory = await requireCollaborationDirectory(collaborationDirectory)
  const value = decodeRestrictedJcs(await readBoundedPlainFile(path.join(directory, RECORDS_FILE)))
  if (!isPlainRecord(value) || !hasExactKeys(value, ["format", "manifest", "confirmation"]) ||
    value.format !== "convax.project-reset-records/2") throw new TypeError("Project reset records schema is invalid")
  const normalized = normalizeRecords({
    format: value.format,
    confirmation: parseProjectResetConfirmationV2(value.confirmation),
    manifest: parseProjectResetManifestV2(value.manifest),
  })
  return Object.freeze(normalized)
}

export function parseProjectResetManifestV2(value: unknown): ProjectResetManifestV2 {
  const keys = [
    "format", "resetId", "projectId", "oldProjectEpoch", "newProjectEpoch", "newMembershipEpoch",
    "newProjectIndexShardEpoch", "reason", "observedOldPrivateTreeDigest", "unsupportedInventoryDigest",
    "privateDeletionSetDigest", "requestedProtocolDigest", "requestedSchemaDigest", "requestedUriProtocolDigest",
    "emptyProjectIndexCheckpointDigest", "emptyProjectIndexFullUpdateDigest", "emptyProjectIndexStateVectorDigest",
    "emptyProjectIndexCanonicalStateDigest", "projectResetConfirmationCoreDigest",
    "projectResetApprovalCoreDigest", "teamEpochRolloverRequestDigest",
    "emptyProjectIndexGenesisAttestationCoreDigest", "teamEpochRolloverReceiptCoreDigest", "state",
  ] as const
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) || value.format !== "convax.project-reset-manifest/2" ||
    !isResetReason(value.reason) || !isState(value.state)) {
    throw new TypeError("Project reset manifest schema is invalid")
  }
  return Object.freeze({
    format: value.format,
    resetId: parseId128(value.resetId),
    projectId: parseProjectId(value.projectId),
    oldProjectEpoch: value.oldProjectEpoch === null ? null : parseId128(value.oldProjectEpoch),
    newProjectEpoch: parseId128(value.newProjectEpoch),
    newMembershipEpoch: value.newMembershipEpoch === null ? null : parseId128(value.newMembershipEpoch),
    newProjectIndexShardEpoch: parseId128(value.newProjectIndexShardEpoch),
    reason: value.reason,
    observedOldPrivateTreeDigest: parseDigest(value.observedOldPrivateTreeDigest),
    unsupportedInventoryDigest: parseDigest(value.unsupportedInventoryDigest),
    privateDeletionSetDigest: parseDigest(value.privateDeletionSetDigest),
    requestedProtocolDigest: parseDigest(value.requestedProtocolDigest),
    requestedSchemaDigest: parseDigest(value.requestedSchemaDigest),
    requestedUriProtocolDigest: parseDigest(value.requestedUriProtocolDigest),
    emptyProjectIndexCheckpointDigest: parseDigest(value.emptyProjectIndexCheckpointDigest),
    emptyProjectIndexFullUpdateDigest: parseDigest(value.emptyProjectIndexFullUpdateDigest),
    emptyProjectIndexStateVectorDigest: parseDigest(value.emptyProjectIndexStateVectorDigest),
    emptyProjectIndexCanonicalStateDigest: parseDigest(value.emptyProjectIndexCanonicalStateDigest),
    projectResetConfirmationCoreDigest: parseDigest(value.projectResetConfirmationCoreDigest),
    projectResetApprovalCoreDigest: nullableDigest(value.projectResetApprovalCoreDigest),
    teamEpochRolloverRequestDigest: nullableDigest(value.teamEpochRolloverRequestDigest),
    emptyProjectIndexGenesisAttestationCoreDigest: nullableDigest(value.emptyProjectIndexGenesisAttestationCoreDigest),
    teamEpochRolloverReceiptCoreDigest: nullableDigest(value.teamEpochRolloverReceiptCoreDigest),
    state: value.state,
  })
}

function normalizeRecords(records: ProjectResetRecordsV2): ProjectResetRecordsV2 {
  if (records.format !== "convax.project-reset-records/2") throw new TypeError("Project reset records format is invalid")
  const confirmation = parseProjectResetConfirmationV2(records.confirmation)
  const manifest = parseProjectResetManifestV2(records.manifest)
  if (manifest.resetId !== confirmation.core.resetId || manifest.projectId !== confirmation.core.projectId ||
    manifest.oldProjectEpoch !== confirmation.core.oldProjectEpoch || manifest.reason !== confirmation.core.reason ||
    manifest.observedOldPrivateTreeDigest !== confirmation.core.observedOldPrivateTreeDigest ||
    manifest.unsupportedInventoryDigest !== confirmation.core.unsupportedInventoryDigest ||
    manifest.privateDeletionSetDigest !== confirmation.core.privateDeletionSetDigest ||
    manifest.requestedProtocolDigest !== confirmation.core.requestedProtocolDigest ||
    manifest.requestedSchemaDigest !== confirmation.core.requestedSchemaDigest ||
    manifest.requestedUriProtocolDigest !== confirmation.core.requestedUriProtocolDigest ||
    manifest.projectResetConfirmationCoreDigest !== confirmation.coreDigest) {
    throw new TypeError("Project reset manifest and confirmation differ")
  }
  if (manifest.oldProjectEpoch === null && (
    manifest.newMembershipEpoch !== null || manifest.projectResetApprovalCoreDigest !== null ||
    manifest.teamEpochRolloverRequestDigest !== null || manifest.emptyProjectIndexGenesisAttestationCoreDigest !== null ||
    manifest.teamEpochRolloverReceiptCoreDigest !== null || confirmation.core.confirmationPrincipal.kind !== "local-project-owner"
  )) throw new TypeError("Unteamed Project reset contains team authority")
  return Object.freeze({ format: records.format, manifest, confirmation })
}

function encodeBounded(value: unknown): Uint8Array {
  const bytes = encodeRestrictedJcs(value)
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RECORD_BYTES) throw new TypeError("Project reset record is too large")
  return bytes
}

async function requireCollaborationDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) {
    throw new TypeError("Project reset store directory must be canonical and absolute")
  }
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("Project reset store is not a plain directory")
  return directory
}

async function writeOrReplaceRecord(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${target}.next`
  try {
    const handle = await fs.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const pending = await readBoundedPlainFile(temporary)
    if (!sameBytes(pending, bytes)) throw new TypeError("Project reset record transition is ambiguous")
  }
  try { await fs.rename(temporary, target) } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  await fsyncProjectDirectoryV2(path.dirname(target))
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}

async function readBoundedPlainFile(target: string): Promise<Uint8Array> {
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_RECORD_BYTES) {
    throw new TypeError("Project reset record is not a bounded plain file")
  }
  const bytes = Uint8Array.from(await fs.readFile(target))
  return bytes
}

function nullableDigest(value: unknown): Digest | null {
  return value === null ? null : parseDigest(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
}

function isResetReason(value: unknown): value is ProjectResetReasonV2 {
  return value === "unsupported-portable-version" || value === "incompatible-project-index-schema" ||
    value === "unrecoverable-project-index-corruption" || value === "explicit-empty-project-reset"
}

function isState(value: unknown): value is ProjectResetManifestStateV2 {
  return value === "reset-staged" || value === "reset-authorized" || value === "reset-publishing" ||
    value === "reset-published" || value === "reset-retiring-old" || value === "reset-complete"
}
