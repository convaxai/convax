import { randomBytes } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import {
  decodeRestrictedJcs,
  encodeBase64url,
  encodeRestrictedJcs,
  parseId128,
  parseMemberId,
  parseProjectId,
  structuredDigest,
  type MemberId,
  type ProjectId,
} from "@convax/collaboration"

import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"

const FORMAT = "convax.desktop-project-member-identity/1" as const

interface ProjectMemberIdentityRecord {
  readonly format: typeof FORMAT
  readonly projectId: ProjectId
  readonly memberId: MemberId
}

/** Main/userData owner for one stable local member identity per Project. */
export class NodeProjectTeamMemberIdentityStore {
  constructor(
    private readonly rootDirectory: string,
    private readonly createMemberId: () => MemberId = () =>
      parseMemberId(parseId128(encodeBase64url(randomBytes(16)))),
  ) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Project member identity root must be absolute")
  }

  async resolve(projectIdInput: ProjectId): Promise<MemberId> {
    const projectId = parseProjectId(projectIdInput)
    await ensureDirectory(this.rootDirectory)
    const target = path.join(this.rootDirectory, `${selector(projectId)}.jcs`)
    try {
      return (await readRecord(target, projectId)).memberId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const record = parseRecord({ format: FORMAT, projectId, memberId: this.createMemberId() }, projectId)
    const bytes = encodeRestrictedJcs(record)
    try {
      const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await handle.writeFile(bytes); await syncFileBytes(handle) } finally { await handle.close() }
      await syncDirectoryEntry(this.rootDirectory)
      return record.memberId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return (await readRecord(target, projectId)).memberId
    }
  }
}

async function readRecord(target: string, projectId: ProjectId): Promise<ProjectMemberIdentityRecord> {
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Project member identity entry is untrusted")
  const bytes = new Uint8Array(await fs.readFile(target))
  const record = parseRecord(decodeRestrictedJcs(bytes), projectId)
  if (!sameBytes(bytes, encodeRestrictedJcs(record))) throw new Error("Project member identity entry is noncanonical")
  return record
}

function parseRecord(value: unknown, expectedProjectId: ProjectId): ProjectMemberIdentityRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Project member identity record is invalid")
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("\0") !== ["format", "memberId", "projectId"].join("\0") || record.format !== FORMAT) {
    throw new Error("Project member identity record has unsupported fields")
  }
  const projectId = parseProjectId(record.projectId)
  if (projectId !== expectedProjectId) throw new Error("Project member identity crossed Project")
  return Object.freeze({ format: FORMAT, projectId, memberId: parseMemberId(record.memberId) })
}

function selector(projectId: ProjectId): string {
  return structuredDigest("convax.desktop-project-member-identity-selector", {
    format: "convax.desktop-project-member-identity-selector",
    projectId,
  })
}

async function ensureDirectory(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project member identity root is untrusted")
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}
