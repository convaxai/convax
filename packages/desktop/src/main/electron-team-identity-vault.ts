import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signDigest } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeBase64urlV2,
  encodeRestrictedJcsTextV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSessionIdV2,
  parseSignatureV2,
  parseUint64V2,
  structuredDigestV2,
  type Id128V2,
  type MemberIdV2,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaIdV2,
  type ReplicaSignerPortV2,
  type SessionIdV2,
  type Uint64V2,
} from "@convax/collaboration"

import type { ElectronSafeStoragePortV2 } from "./electron-replica-signing-vault"

interface TeamIdentityVaultRecordV2 {
  readonly format: "convax.desktop-team-identity-key/2"
  readonly purpose: "member" | "session"
  readonly projectId: ProjectIdV2
  readonly memberId: MemberIdV2
  readonly projectEpoch: Id128V2 | null
  readonly replicaId: ReplicaIdV2 | null
  readonly sessionId: SessionIdV2 | null
  readonly expiresAtUnixMs: Uint64V2 | null
  readonly privateKeyPkcs8Base64url: string
}

export interface TeamIdentitySigningKeyV1 {
  readonly publicKey: PublicKeyV2
  readonly signer: ReplicaSignerPortV2
}

type MemberKeyIdentityV1 = Readonly<{ projectId: ProjectIdV2; memberId: MemberIdV2 }>
type SessionKeyIdentityV1 = Readonly<{
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  memberId: MemberIdV2
  replicaId: ReplicaIdV2
  sessionId: SessionIdV2
  expiresAtUnixMs: Uint64V2
}>

/** Main-private OS-vault key owner for long-lived member and per-session signing identities. */
export class ElectronTeamIdentityVaultV1 {
  constructor(
    private readonly rootDirectory: string,
    private readonly safeStorage: ElectronSafeStoragePortV2,
  ) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Team identity vault root must be absolute")
  }

  ensureMemberKey(input: MemberKeyIdentityV1): Promise<TeamIdentitySigningKeyV1> {
    const identity = Object.freeze({
      purpose: "member" as const,
      projectId: parseProjectIdV2(input.projectId),
      memberId: parseMemberIdV2(input.memberId),
      projectEpoch: null,
      replicaId: null,
      sessionId: null,
      expiresAtUnixMs: null,
    })
    return this.ensure(identity)
  }

  openMemberSigner(input: MemberKeyIdentityV1 & { readonly expectedPublicKey: PublicKeyV2 }) {
    return this.open(Object.freeze({
      purpose: "member" as const,
      projectId: parseProjectIdV2(input.projectId),
      memberId: parseMemberIdV2(input.memberId),
      projectEpoch: null,
      replicaId: null,
      sessionId: null,
      expiresAtUnixMs: null,
    }), input.expectedPublicKey)
  }

  ensureSessionKey(input: SessionKeyIdentityV1): Promise<TeamIdentitySigningKeyV1> {
    return this.ensure(parseSessionIdentity(input))
  }

  openSessionSigner(input: SessionKeyIdentityV1 & { readonly expectedPublicKey: PublicKeyV2 }) {
    return this.open(parseSessionIdentity(input), input.expectedPublicKey)
  }

  async removeSessionKey(input: SessionKeyIdentityV1): Promise<"removed" | "missing"> {
    this.requireSecureBackend()
    const identity = parseSessionIdentity(input)
    const target = this.target(identity)
    if (!await isFile(target)) return "missing"
    const record = await this.readRecord(target)
    if (!sameIdentity(record, identity)) throw new Error("Team identity vault key crossed identity")
    await fs.unlink(target)
    await syncDirectory(this.rootDirectory)
    return "removed"
  }

  async pruneExpiredSessionKeys(input: {
    readonly nowUnixMs: Uint64V2
    readonly maximumEntries?: number
  }): Promise<number> {
    this.requireSecureBackend()
    const now = BigInt(parseUint64V2(input.nowUnixMs))
    const maximumEntries = input.maximumEntries ?? 1_024
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 4_096) {
      throw new TypeError("Team identity vault prune bound is invalid")
    }
    await ensureDirectory(this.rootDirectory)
    const entries = await fs.readdir(this.rootDirectory)
    if (entries.length > maximumEntries) throw new Error("Team identity vault exceeds the bounded prune scan")
    let removed = 0
    for (const entry of entries) {
      if (!/^[0-9a-f]{64}\.vault$/.test(entry)) throw new Error("Team identity vault contains an untrusted entry")
      const target = path.join(this.rootDirectory, entry)
      const record = await this.readRecord(target)
      if (record.purpose !== "session" || BigInt(record.expiresAtUnixMs!) > now) continue
      await fs.unlink(target)
      removed += 1
    }
    if (removed > 0) await syncDirectory(this.rootDirectory)
    return removed
  }

  private async ensure(identity: Omit<TeamIdentityVaultRecordV2, "format" | "privateKeyPkcs8Base64url">): Promise<TeamIdentitySigningKeyV1> {
    this.requireSecureBackend()
    await ensureDirectory(this.rootDirectory)
    const target = this.target(identity)
    if (await isFile(target)) return this.load(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      const record: TeamIdentityVaultRecordV2 = Object.freeze({
        format: "convax.desktop-team-identity-key/2",
        ...identity,
        privateKeyPkcs8Base64url: privateKeyPkcs8.toString("base64url"),
      })
      const encrypted = this.safeStorage.encryptString(encodeRestrictedJcsTextV2(record))
      try {
        await writeNewEncrypted(target, encrypted)
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      } finally {
        encrypted.fill(0)
      }
    } finally {
      privateKeyPkcs8.fill(0)
    }
    return this.load(identity, target)
  }

  private async open(
    identity: Omit<TeamIdentityVaultRecordV2, "format" | "privateKeyPkcs8Base64url">,
    expectedPublicKey: PublicKeyV2,
  ): Promise<ReplicaSignerPortV2 | "missing" | "unavailable" | "rejected"> {
    if (!this.hasSecureBackend()) return "unavailable"
    const target = this.target(identity)
    if (!await isFile(target)) return "missing"
    try {
      const loaded = await this.load(identity, target)
      return loaded.publicKey === parsePublicKeyV2(expectedPublicKey) ? loaded.signer : "rejected"
    } catch {
      return "rejected"
    }
  }

  private async load(
    identity: Omit<TeamIdentityVaultRecordV2, "format" | "privateKeyPkcs8Base64url">,
    target: string,
  ): Promise<TeamIdentitySigningKeyV1> {
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
      const publicKey = parsePublicKeyV2(encodeBase64urlV2(publicDer.subarray(publicDer.byteLength - 32)))
      const signer: ReplicaSignerPortV2 = Object.freeze({
        async sign(digest: Uint8Array) {
          if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) {
            throw new TypeError("Team identity signer accepts only an exact 32-byte purpose digest")
          }
          return parseSignatureV2(encodeBase64urlV2(signDigest(null, Buffer.from(digest), privateKey)))
        },
      })
      return Object.freeze({ publicKey, signer })
    } finally {
      privateDer.fill(0)
    }
  }

  private async readRecord(target: string): Promise<TeamIdentityVaultRecordV2> {
    if (!await isFile(target)) throw new Error("Team identity vault entry is missing")
    const encrypted = Buffer.from(await fs.readFile(target))
    let plaintext = ""
    try { plaintext = this.safeStorage.decryptString(encrypted) } finally { encrypted.fill(0) }
    try {
      return parseRecord(decodeRestrictedJcsV2(new TextEncoder().encode(plaintext)))
    } finally {
      plaintext = ""
    }
  }

  private target(identity: Omit<TeamIdentityVaultRecordV2, "format" | "privateKeyPkcs8Base64url">): string {
    const { expiresAtUnixMs: _expiry, ...nativeIdentity } = identity
    const digest = structuredDigestV2("convax.desktop-team-identity-native-key-v3/2", nativeIdentity)
    return path.join(this.rootDirectory, `${parseDigestV2(digest)}.vault`)
  }

  private hasSecureBackend(): boolean {
    return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== "basic_text"
  }

  private requireSecureBackend(): void {
    if (!this.hasSecureBackend()) throw new Error("OS-backed team identity vault is unavailable")
  }
}

function parseSessionIdentity(input: SessionKeyIdentityV1) {
  return Object.freeze({
    purpose: "session" as const,
    projectId: parseProjectIdV2(input.projectId),
    memberId: parseMemberIdV2(input.memberId),
    projectEpoch: parseId128V2(input.projectEpoch),
    replicaId: parseReplicaIdV2(input.replicaId),
    sessionId: parseSessionIdV2(input.sessionId),
    expiresAtUnixMs: parseUint64V2(input.expiresAtUnixMs),
  })
}

function parseRecord(value: unknown): TeamIdentityVaultRecordV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Team identity vault plaintext is invalid")
  const record = value as Record<string, unknown>
  const keys = ["expiresAtUnixMs", "format", "memberId", "privateKeyPkcs8Base64url", "projectEpoch", "projectId", "purpose", "replicaId", "sessionId"]
  if (Object.keys(record).sort().join("\0") !== keys.sort().join("\0") ||
    record.format !== "convax.desktop-team-identity-key/2" ||
    (record.purpose !== "member" && record.purpose !== "session") ||
    typeof record.privateKeyPkcs8Base64url !== "string" || record.privateKeyPkcs8Base64url.length < 1 || record.privateKeyPkcs8Base64url.length > 512) {
    throw new Error("Team identity vault plaintext has unsupported fields")
  }
  const base = {
    format: "convax.desktop-team-identity-key/2" as const,
    purpose: record.purpose,
    projectId: parseProjectIdV2(record.projectId),
    memberId: parseMemberIdV2(record.memberId),
    privateKeyPkcs8Base64url: record.privateKeyPkcs8Base64url,
  }
  if (record.purpose === "member") {
    if (record.projectEpoch !== null || record.replicaId !== null || record.sessionId !== null || record.expiresAtUnixMs !== null) throw new Error("Member key identity fields are invalid")
    return Object.freeze({ ...base, purpose: "member", projectEpoch: null, replicaId: null, sessionId: null, expiresAtUnixMs: null })
  }
  if (record.projectEpoch === null || record.replicaId === null || record.sessionId === null || record.expiresAtUnixMs === null) throw new Error("Session key identity fields are invalid")
  return Object.freeze({
    ...base,
    purpose: "session",
    projectEpoch: parseId128V2(record.projectEpoch),
    replicaId: parseReplicaIdV2(record.replicaId),
    sessionId: parseSessionIdV2(record.sessionId),
    expiresAtUnixMs: parseUint64V2(record.expiresAtUnixMs),
  })
}

function sameIdentity(
  left: TeamIdentityVaultRecordV2,
  right: Omit<TeamIdentityVaultRecordV2, "format" | "privateKeyPkcs8Base64url">,
): boolean {
  return left.purpose === right.purpose && left.projectId === right.projectId && left.memberId === right.memberId &&
    left.projectEpoch === right.projectEpoch && left.replicaId === right.replicaId && left.sessionId === right.sessionId &&
    left.expiresAtUnixMs === right.expiresAtUnixMs
}

async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Team identity vault root is untrusted")
}

async function writeNewEncrypted(target: string, encrypted: Readonly<Uint8Array>): Promise<void> {
  const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(encrypted); await handle.sync() } finally { await handle.close() }
  await syncDirectory(path.dirname(target))
}

async function syncDirectory(target: string): Promise<void> {
  const directory = await fs.open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await directory.sync() } finally { await directory.close() }
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
