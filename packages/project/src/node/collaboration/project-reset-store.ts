import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  type DigestV2,
  type Id128V2,
  type ProjectIdV2,
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
  readonly resetId: Id128V2
  readonly projectId: ProjectIdV2
  readonly oldProjectEpoch: Id128V2 | null
  readonly newProjectEpoch: Id128V2
  readonly newMembershipEpoch: Id128V2 | null
  readonly newProjectIndexShardEpoch: Id128V2
  readonly reason: ProjectResetReasonV2
  readonly observedOldPrivateTreeDigest: DigestV2
  readonly unsupportedInventoryDigest: DigestV2
  readonly privateDeletionSetDigest: DigestV2
  readonly requestedProtocolDigest: DigestV2
  readonly requestedSchemaDigest: DigestV2
  readonly requestedUriProtocolDigest: DigestV2
  readonly emptyProjectIndexCheckpointDigest: DigestV2
  readonly emptyProjectIndexFullUpdateDigest: DigestV2
  readonly emptyProjectIndexStateVectorDigest: DigestV2
  readonly emptyProjectIndexCanonicalStateDigest: DigestV2
  readonly projectResetConfirmationCoreDigest: DigestV2
  readonly projectResetApprovalCoreDigest: DigestV2 | null
  readonly teamEpochRolloverRequestDigest: DigestV2 | null
  readonly emptyProjectIndexGenesisAttestationCoreDigest: DigestV2 | null
  readonly teamEpochRolloverReceiptCoreDigest: DigestV2 | null
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
  const value = decodeRestrictedJcsV2(await readBoundedPlainFile(path.join(directory, RECORDS_FILE)))
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
    resetId: parseId128V2(value.resetId),
    projectId: parseProjectIdV2(value.projectId),
    oldProjectEpoch: value.oldProjectEpoch === null ? null : parseId128V2(value.oldProjectEpoch),
    newProjectEpoch: parseId128V2(value.newProjectEpoch),
    newMembershipEpoch: value.newMembershipEpoch === null ? null : parseId128V2(value.newMembershipEpoch),
    newProjectIndexShardEpoch: parseId128V2(value.newProjectIndexShardEpoch),
    reason: value.reason,
    observedOldPrivateTreeDigest: parseDigestV2(value.observedOldPrivateTreeDigest),
    unsupportedInventoryDigest: parseDigestV2(value.unsupportedInventoryDigest),
    privateDeletionSetDigest: parseDigestV2(value.privateDeletionSetDigest),
    requestedProtocolDigest: parseDigestV2(value.requestedProtocolDigest),
    requestedSchemaDigest: parseDigestV2(value.requestedSchemaDigest),
    requestedUriProtocolDigest: parseDigestV2(value.requestedUriProtocolDigest),
    emptyProjectIndexCheckpointDigest: parseDigestV2(value.emptyProjectIndexCheckpointDigest),
    emptyProjectIndexFullUpdateDigest: parseDigestV2(value.emptyProjectIndexFullUpdateDigest),
    emptyProjectIndexStateVectorDigest: parseDigestV2(value.emptyProjectIndexStateVectorDigest),
    emptyProjectIndexCanonicalStateDigest: parseDigestV2(value.emptyProjectIndexCanonicalStateDigest),
    projectResetConfirmationCoreDigest: parseDigestV2(value.projectResetConfirmationCoreDigest),
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
  const bytes = encodeRestrictedJcsV2(value)
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

function nullableDigest(value: unknown): DigestV2 | null {
  return value === null ? null : parseDigestV2(value)
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
