import { randomBytes } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import {
  decodeRestrictedJcsV2,
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  structuredDigestV2,
  type MemberIdV2,
  type ProjectIdV2,
} from "@convax/collaboration"

const FORMAT = "convax.desktop-project-member-identity/1" as const

interface ProjectMemberIdentityRecordV1 {
  readonly format: typeof FORMAT
  readonly projectId: ProjectIdV2
  readonly memberId: MemberIdV2
}

/** Main/userData owner for one stable local member identity per Project. */
export class NodeProjectTeamMemberIdentityStoreV1 {
  constructor(
    private readonly rootDirectory: string,
    private readonly createMemberId: () => MemberIdV2 = () =>
      parseMemberIdV2(parseId128V2(encodeBase64urlV2(randomBytes(16)))),
  ) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Project member identity root must be absolute")
  }

  async resolve(projectIdInput: ProjectIdV2): Promise<MemberIdV2> {
    const projectId = parseProjectIdV2(projectIdInput)
    await ensureDirectory(this.rootDirectory)
    const target = path.join(this.rootDirectory, `${selector(projectId)}.jcs`)
    try {
      return (await readRecord(target, projectId)).memberId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const record = parseRecord({ format: FORMAT, projectId, memberId: this.createMemberId() }, projectId)
    const bytes = encodeRestrictedJcsV2(record)
    try {
      const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await syncDirectory(this.rootDirectory)
      return record.memberId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return (await readRecord(target, projectId)).memberId
    }
  }
}

async function readRecord(target: string, projectId: ProjectIdV2): Promise<ProjectMemberIdentityRecordV1> {
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Project member identity entry is untrusted")
  const bytes = new Uint8Array(await fs.readFile(target))
  const record = parseRecord(decodeRestrictedJcsV2(bytes), projectId)
  if (!sameBytes(bytes, encodeRestrictedJcsV2(record))) throw new Error("Project member identity entry is noncanonical")
  return record
}

function parseRecord(value: unknown, expectedProjectId: ProjectIdV2): ProjectMemberIdentityRecordV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Project member identity record is invalid")
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("\0") !== ["format", "memberId", "projectId"].join("\0") || record.format !== FORMAT) {
    throw new Error("Project member identity record has unsupported fields")
  }
  const projectId = parseProjectIdV2(record.projectId)
  if (projectId !== expectedProjectId) throw new Error("Project member identity crossed Project")
  return Object.freeze({ format: FORMAT, projectId, memberId: parseMemberIdV2(record.memberId) })
}

function selector(projectId: ProjectIdV2): string {
  return structuredDigestV2("convax.desktop-project-member-identity-selector/2", {
    format: "convax.desktop-project-member-identity-selector/2",
    projectId,
  })
}

async function ensureDirectory(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project member identity root is untrusted")
}

async function syncDirectory(target: string): Promise<void> {
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await handle.sync() } finally { await handle.close() }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}
