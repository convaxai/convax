import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signDigest } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcs,
  encodeBase64url,
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSessionId,
  parseSignature,
  parseUint64,
  structuredDigest,
  type Id128,
  type MemberId,
  type ProjectId,
  type PublicKey,
  type ReplicaId,
  type ReplicaSignerPort,
  type SessionId,
  type Uint64,
} from "@convax/collaboration"

import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"

interface TeamIdentityVaultRecord {
  readonly format: "convax.desktop-user-managed-team-identity-key"
  readonly purpose: "member" | "session"
  readonly projectId: ProjectId
  readonly memberId: MemberId
  readonly projectEpoch: Id128 | null
  readonly replicaId: ReplicaId | null
  readonly sessionId: SessionId | null
  readonly expiresAtUnixMs: Uint64 | null
  readonly privateKeyPkcs8Base64url: string
}

export interface TeamIdentitySigningKey {
  readonly publicKey: PublicKey
  readonly signer: ReplicaSignerPort
}

type MemberKeyIdentity = Readonly<{ projectId: ProjectId; memberId: MemberId }>
type SessionKeyIdentity = Readonly<{
  projectId: ProjectId
  projectEpoch: Id128
  memberId: MemberId
  replicaId: ReplicaId
  sessionId: SessionId
  expiresAtUnixMs: Uint64
}>

/** Main-private user-managed key owner for long-lived member and per-session identities. */
export class ElectronTeamIdentityVault {
  constructor(private readonly rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Team identity vault root must be absolute")
  }

  ensureMemberKey(input: MemberKeyIdentity): Promise<TeamIdentitySigningKey> {
    const identity = Object.freeze({
      purpose: "member" as const,
      projectId: parseProjectId(input.projectId),
      memberId: parseMemberId(input.memberId),
      projectEpoch: null,
      replicaId: null,
      sessionId: null,
      expiresAtUnixMs: null,
    })
    return this.ensure(identity)
  }

  openMemberSigner(input: MemberKeyIdentity & { readonly expectedPublicKey: PublicKey }) {
    return this.open(
      Object.freeze({
        purpose: "member" as const,
        projectId: parseProjectId(input.projectId),
        memberId: parseMemberId(input.memberId),
        projectEpoch: null,
        replicaId: null,
        sessionId: null,
        expiresAtUnixMs: null,
      }),
      input.expectedPublicKey,
    )
  }

  ensureSessionKey(input: SessionKeyIdentity): Promise<TeamIdentitySigningKey> {
    return this.ensure(parseSessionIdentity(input))
  }

  openSessionSigner(input: SessionKeyIdentity & { readonly expectedPublicKey: PublicKey }) {
    return this.open(parseSessionIdentity(input), input.expectedPublicKey)
  }

  async removeSessionKey(input: SessionKeyIdentity): Promise<"removed" | "missing"> {
    const identity = parseSessionIdentity(input)
    const target = this.target(identity)
    if (!(await isFile(target))) return "missing"
    const record = await this.readRecord(target)
    if (!sameIdentity(record, identity)) throw new Error("Team identity vault key crossed identity")
    await fs.unlink(target)
    await syncDirectory(this.rootDirectory)
    return "removed"
  }

  async pruneExpiredSessionKeys(input: {
    readonly nowUnixMs: Uint64
    readonly maximumEntries?: number
  }): Promise<number> {
    const now = BigInt(parseUint64(input.nowUnixMs))
    const maximumEntries = input.maximumEntries ?? 1_024
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 4_096) {
      throw new TypeError("Team identity vault prune bound is invalid")
    }
    await ensureDirectory(this.rootDirectory)
    const entries = await fs.readdir(this.rootDirectory)
    if (entries.length > maximumEntries) throw new Error("Team identity vault exceeds the bounded prune scan")
    let removed = 0
    for (const entry of entries) {
      if (!/^[0-9a-f]{64}\.key$/.test(entry)) throw new Error("Team identity store contains an untrusted entry")
      const target = path.join(this.rootDirectory, entry)
      const record = await this.readRecord(target)
      if (record.purpose !== "session" || BigInt(record.expiresAtUnixMs!) > now) continue
      await fs.unlink(target)
      removed += 1
    }
    if (removed > 0) await syncDirectory(this.rootDirectory)
    return removed
  }

  private async ensure(
    identity: Omit<TeamIdentityVaultRecord, "format" | "privateKeyPkcs8Base64url">,
  ): Promise<TeamIdentitySigningKey> {
    await ensureDirectory(this.rootDirectory)
    const target = this.target(identity)
    if (await isFile(target)) return this.load(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      const record: TeamIdentityVaultRecord = Object.freeze({
        format: "convax.desktop-user-managed-team-identity-key",
        ...identity,
        privateKeyPkcs8Base64url: privateKeyPkcs8.toString("base64url"),
      })
      try {
        await writeNewRecord(target, record)
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
    } finally {
      privateKeyPkcs8.fill(0)
    }
    return this.load(identity, target)
  }

  private async open(
    identity: Omit<TeamIdentityVaultRecord, "format" | "privateKeyPkcs8Base64url">,
    expectedPublicKey: PublicKey,
  ): Promise<ReplicaSignerPort | "missing" | "rejected"> {
    const target = this.target(identity)
    if (!(await isFile(target))) return "missing"
    try {
      const loaded = await this.load(identity, target)
      return loaded.publicKey === parsePublicKey(expectedPublicKey) ? loaded.signer : "rejected"
    } catch {
      return "rejected"
    }
  }

  private async load(
    identity: Omit<TeamIdentityVaultRecord, "format" | "privateKeyPkcs8Base64url">,
    target: string,
  ): Promise<TeamIdentitySigningKey> {
    const parsed = await this.readRecord(target)
    if (!sameIdentity(parsed, identity)) throw new Error("Team identity vault key crossed identity")
    const privateDer = Buffer.from(parsed.privateKeyPkcs8Base64url, "base64url")
    if (privateDer.toString("base64url") !== parsed.privateKeyPkcs8Base64url) {
      privateDer.fill(0)
      throw new Error("Team identity vault PKCS#8 encoding is noncanonical")
    }
    try {
      const privateKey = createPrivateKey({ key: privateDer, format: "der", type: "pkcs8" })
      const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer
      if (publicDer.byteLength < 32) throw new Error("Team identity vault public key is invalid")
      const publicKey = parsePublicKey(encodeBase64url(publicDer.subarray(publicDer.byteLength - 32)))
      const signer: ReplicaSignerPort = Object.freeze({
        async sign(digest: Uint8Array) {
          if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) {
            throw new TypeError("Team identity signer accepts only an exact 32-byte purpose digest")
          }
          return parseSignature(encodeBase64url(signDigest(null, Buffer.from(digest), privateKey)))
        },
      })
      return Object.freeze({ publicKey, signer })
    } finally {
      privateDer.fill(0)
    }
  }

  private async readRecord(target: string): Promise<TeamIdentityVaultRecord> {
    if (!(await isFile(target))) throw new Error("Team identity vault entry is missing")
    return parseRecord(decodeRestrictedJcs(await readRecordBytes(target)))
  }

  private target(identity: Omit<TeamIdentityVaultRecord, "format" | "privateKeyPkcs8Base64url">): string {
    const { expiresAtUnixMs: _expiry, ...nativeIdentity } = identity
    const digest = structuredDigest("convax.desktop-user-managed-team-identity-key/1", nativeIdentity)
    return path.join(this.rootDirectory, `${parseDigest(digest)}.key`)
  }
}

function parseSessionIdentity(input: SessionKeyIdentity) {
  return Object.freeze({
    purpose: "session" as const,
    projectId: parseProjectId(input.projectId),
    memberId: parseMemberId(input.memberId),
    projectEpoch: parseId128(input.projectEpoch),
    replicaId: parseReplicaId(input.replicaId),
    sessionId: parseSessionId(input.sessionId),
    expiresAtUnixMs: parseUint64(input.expiresAtUnixMs),
  })
}

function parseRecord(value: unknown): TeamIdentityVaultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Team identity vault plaintext is invalid")
  const record = value as Record<string, unknown>
  const keys = [
    "expiresAtUnixMs",
    "format",
    "memberId",
    "privateKeyPkcs8Base64url",
    "projectEpoch",
    "projectId",
    "purpose",
    "replicaId",
    "sessionId",
  ]
  if (
    Object.keys(record).sort().join("\0") !== keys.sort().join("\0") ||
    record.format !== "convax.desktop-user-managed-team-identity-key" ||
    (record.purpose !== "member" && record.purpose !== "session") ||
    typeof record.privateKeyPkcs8Base64url !== "string" ||
    record.privateKeyPkcs8Base64url.length < 1 ||
    record.privateKeyPkcs8Base64url.length > 512
  ) {
    throw new Error("Team identity vault plaintext has unsupported fields")
  }
  const base = {
    format: "convax.desktop-user-managed-team-identity-key" as const,
    purpose: record.purpose,
    projectId: parseProjectId(record.projectId),
    memberId: parseMemberId(record.memberId),
    privateKeyPkcs8Base64url: record.privateKeyPkcs8Base64url,
  }
  if (record.purpose === "member") {
    if (
      record.projectEpoch !== null ||
      record.replicaId !== null ||
      record.sessionId !== null ||
      record.expiresAtUnixMs !== null
    )
      throw new Error("Member key identity fields are invalid")
    return Object.freeze({
      ...base,
      purpose: "member",
      projectEpoch: null,
      replicaId: null,
      sessionId: null,
      expiresAtUnixMs: null,
    })
  }
  if (
    record.projectEpoch === null ||
    record.replicaId === null ||
    record.sessionId === null ||
    record.expiresAtUnixMs === null
  )
    throw new Error("Session key identity fields are invalid")
  return Object.freeze({
    ...base,
    purpose: "session",
    projectEpoch: parseId128(record.projectEpoch),
    replicaId: parseReplicaId(record.replicaId),
    sessionId: parseSessionId(record.sessionId),
    expiresAtUnixMs: parseUint64(record.expiresAtUnixMs),
  })
}

function sameIdentity(
  left: TeamIdentityVaultRecord,
  right: Omit<TeamIdentityVaultRecord, "format" | "privateKeyPkcs8Base64url">,
): boolean {
  return (
    left.purpose === right.purpose &&
    left.projectId === right.projectId &&
    left.memberId === right.memberId &&
    left.projectEpoch === right.projectEpoch &&
    left.replicaId === right.replicaId &&
    left.sessionId === right.sessionId &&
    left.expiresAtUnixMs === right.expiresAtUnixMs
  )
}

async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Team identity vault root is untrusted")
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("Team identity key directory permissions are too broad")
  }
}

async function writeNewRecord(target: string, record: TeamIdentityVaultRecord): Promise<void> {
  const bytes = encodeRestrictedJcs(record)
  const handle = await fs.open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await handle.writeFile(bytes)
    await syncFileBytes(handle)
  } finally {
    await handle.close()
  }
  await syncDirectory(path.dirname(target))
}

async function readRecordBytes(target: string): Promise<Uint8Array> {
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > 4 * 1024) {
      throw new Error("Team identity key is not a bounded plain file")
    }
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
      throw new Error("Team identity key permissions are too broad")
    }
    return new Uint8Array(await handle.readFile())
  } finally {
    await handle.close()
  }
}

async function syncDirectory(target: string): Promise<void> {
  await syncDirectoryEntry(target)
}

async function isFile(target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Team identity vault entry is untrusted")
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST"
}
