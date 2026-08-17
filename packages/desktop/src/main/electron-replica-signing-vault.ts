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
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSignature,
  structuredDigest,
  type Id128,
  type ProjectId,
  type PublicKey,
  type ReplicaId,
  type ReplicaSignerPort,
} from "@convax/collaboration"

import type { OfflineReplicaSigningVault } from "./collaboration-production-runtime"
import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"

interface ReplicaVaultRecord {
  readonly format: "convax.desktop-user-managed-replica-key"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly replicaId: ReplicaId
  readonly privateKeyPkcs8Base64url: string
}

interface PendingReplicaVaultRecord {
  readonly format: "convax.desktop-user-managed-pending-replica-key"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly allocationRequestId: Id128
  readonly privateKeyPkcs8Base64url: string
}

export interface CreatedReplicaVaultKey {
  readonly publicKey: PublicKey
  readonly signer: ReplicaSignerPort
}

/**
 * Stores user-managed PKCS#8 bytes below Electron userData. The files are private
 * to the OS user but deliberately do not use Keychain, DPAPI or a Linux secret
 * service. Project data receives actor/credential digests, never private key bytes
 * or a key path.
 */
export class ElectronReplicaSigningVault implements OfflineReplicaSigningVault {
  constructor(private readonly rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Replica signing vault root must be absolute")
  }

  async createReplicaKey(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly replicaId: ReplicaId
  }): Promise<CreatedReplicaVaultKey> {
    const identity = parseIdentity(input)
    await ensureVaultDirectory(this.rootDirectory)
    const target = this.target(identity)
    if (await isFile(target)) return this.load(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      const record: ReplicaVaultRecord = Object.freeze({
        format: "convax.desktop-user-managed-replica-key",
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

  /**
   * Reservation assigns replicaId only after the member has signed the requested
   * public key. This request-bound key is therefore durable before allocation and
   * carries no replica identity until bindPreparedReplicaKey verifies the receipt.
   */
  async prepareReplicaKey(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly allocationRequestId: Id128
  }): Promise<CreatedReplicaVaultKey> {
    const identity = parsePendingIdentity(input)
    await ensureVaultDirectory(this.rootDirectory)
    const target = this.pendingTarget(identity)
    if (await isFile(target)) return this.loadPending(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      await writeNewRecord(
        target,
        Object.freeze({
          format: "convax.desktop-user-managed-pending-replica-key" as const,
          ...identity,
          privateKeyPkcs8Base64url: privateKeyPkcs8.toString("base64url"),
        }),
      )
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    } finally {
      privateKeyPkcs8.fill(0)
    }
    return this.loadPending(identity, target)
  }

  /** Publishes the assigned identity before deleting the recoverable pending key. */
  async bindPreparedReplicaKey(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly allocationRequestId: Id128
    readonly replicaId: ReplicaId
    readonly expectedPublicKey: PublicKey
  }): Promise<CreatedReplicaVaultKey> {
    const pendingIdentity = parsePendingIdentity(input)
    const activeIdentity = parseIdentity(input)
    await ensureVaultDirectory(this.rootDirectory)
    const pendingTarget = this.pendingTarget(pendingIdentity)
    const activeTarget = this.target(activeIdentity)
    if (await isFile(activeTarget)) {
      const active = await this.load(activeIdentity, activeTarget)
      if (active.publicKey !== parsePublicKey(input.expectedPublicKey))
        throw new Error("Assigned replica key crossed reservation identity")
      await fs.unlink(pendingTarget).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      })
      return active
    }
    if (!(await isFile(pendingTarget))) throw new Error("Pending replica key is missing")
    const pendingRecord = await this.readPendingRecord(pendingIdentity, pendingTarget)
    const key = keyFromPkcs8(pendingRecord.privateKeyPkcs8Base64url)
    try {
      if (key.publicKey !== parsePublicKey(input.expectedPublicKey))
        throw new Error("Pending replica key mismatches reservation receipt")
      await writeNewRecord(
        activeTarget,
        Object.freeze({
          format: "convax.desktop-user-managed-replica-key" as const,
          ...activeIdentity,
          privateKeyPkcs8Base64url: pendingRecord.privateKeyPkcs8Base64url,
        }),
      )
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    } finally {
      key.privateDer.fill(0)
    }
    const active = await this.load(activeIdentity, activeTarget)
    if (active.publicKey !== parsePublicKey(input.expectedPublicKey))
      throw new Error("Assigned replica key publication mismatches")
    await fs.unlink(pendingTarget)
    await syncDirectory(path.dirname(pendingTarget))
    return active
  }

  async openSigner(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly replicaId: ReplicaId
    readonly expectedPublicKey: PublicKey
  }): Promise<ReplicaSignerPort | "missing" | "rejected"> {
    const identity = parseIdentity(input)
    const target = this.target(identity)
    if (!(await isFile(target))) return "missing"
    try {
      const loaded = await this.load(identity, target)
      if (loaded.publicKey !== parsePublicKey(input.expectedPublicKey)) return "rejected"
      return loaded.signer
    } catch {
      return "rejected"
    }
  }

  private async load(
    identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; replicaId: ReplicaId }>,
    target: string,
  ): Promise<CreatedReplicaVaultKey> {
    const parsed = parseRecord(decodeRestrictedJcs(await readRecordBytes(target)))
    if (
      parsed.projectId !== identity.projectId ||
      parsed.projectEpoch !== identity.projectEpoch ||
      parsed.replicaId !== identity.replicaId
    )
      throw new Error("Replica vault key crossed identity")
    const privateDer = Buffer.from(parsed.privateKeyPkcs8Base64url, "base64url")
    if (privateDer.toString("base64url") !== parsed.privateKeyPkcs8Base64url) {
      privateDer.fill(0)
      throw new Error("Replica vault PKCS#8 encoding is noncanonical")
    }
    try {
      const privateKey = createPrivateKey({ key: privateDer, format: "der", type: "pkcs8" })
      const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer
      if (publicDer.byteLength < 32) throw new Error("Replica vault public key is invalid")
      const publicKey = parsePublicKey(encodeBase64url(publicDer.subarray(publicDer.byteLength - 32)))
      const signerPort: ReplicaSignerPort = {
        async sign(digest) {
          if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) {
            throw new TypeError("Replica signer accepts only an exact 32-byte purpose digest")
          }
          return parseSignature(encodeBase64url(signDigest(null, Buffer.from(digest), privateKey)))
        },
      }
      const signer = Object.freeze(signerPort)
      return Object.freeze({ publicKey, signer })
    } finally {
      privateDer.fill(0)
    }
  }

  private async loadPending(
    identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; allocationRequestId: Id128 }>,
    target: string,
  ): Promise<CreatedReplicaVaultKey> {
    const record = await this.readPendingRecord(identity, target)
    const key = keyFromPkcs8(record.privateKeyPkcs8Base64url)
    try {
      return Object.freeze({ publicKey: key.publicKey, signer: signerFromPrivateKey(key.privateKey) })
    } finally {
      key.privateDer.fill(0)
    }
  }

  private async readPendingRecord(
    identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; allocationRequestId: Id128 }>,
    target: string,
  ): Promise<PendingReplicaVaultRecord> {
    const parsed = parsePendingRecord(decodeRestrictedJcs(await readRecordBytes(target)))
    if (
      parsed.projectId !== identity.projectId ||
      parsed.projectEpoch !== identity.projectEpoch ||
      parsed.allocationRequestId !== identity.allocationRequestId
    )
      throw new Error("Pending replica vault key crossed identity")
    return parsed
  }

  private target(identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; replicaId: ReplicaId }>): string {
    const key = structuredDigest("convax.desktop-user-managed-replica-key/1", identity)
    return path.join(this.rootDirectory, `${parseDigest(key)}.key`)
  }

  private pendingTarget(
    identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; allocationRequestId: Id128 }>,
  ): string {
    const key = structuredDigest("convax.desktop-user-managed-pending-replica-key/1", identity)
    return path.join(this.rootDirectory, `${parseDigest(key)}.pending-key`)
  }
}

function parseIdentity(input: {
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly replicaId: ReplicaId
}) {
  return Object.freeze({
    projectId: parseProjectId(input.projectId),
    projectEpoch: parseId128(input.projectEpoch),
    replicaId: parseReplicaId(input.replicaId),
  })
}

function parsePendingIdentity(input: {
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly allocationRequestId: Id128
}) {
  return Object.freeze({
    projectId: parseProjectId(input.projectId),
    projectEpoch: parseId128(input.projectEpoch),
    allocationRequestId: parseId128(input.allocationRequestId),
  })
}

function parseRecord(value: unknown): ReplicaVaultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Replica key record is invalid")
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !==
      ["format", "privateKeyPkcs8Base64url", "projectEpoch", "projectId", "replicaId"].sort().join("\0") ||
    record.format !== "convax.desktop-user-managed-replica-key" ||
    typeof record.privateKeyPkcs8Base64url !== "string" ||
    record.privateKeyPkcs8Base64url.length < 1 ||
    record.privateKeyPkcs8Base64url.length > 512
  )
    throw new Error("Replica key record has unsupported fields")
  return Object.freeze({
    format: record.format,
    projectId: parseProjectId(record.projectId),
    projectEpoch: parseId128(record.projectEpoch),
    replicaId: parseReplicaId(record.replicaId),
    privateKeyPkcs8Base64url: record.privateKeyPkcs8Base64url,
  })
}

function parsePendingRecord(value: unknown): PendingReplicaVaultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Pending replica key record is invalid")
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !==
      ["allocationRequestId", "format", "privateKeyPkcs8Base64url", "projectEpoch", "projectId"].sort().join("\0") ||
    record.format !== "convax.desktop-user-managed-pending-replica-key" ||
    typeof record.privateKeyPkcs8Base64url !== "string" ||
    record.privateKeyPkcs8Base64url.length < 1 ||
    record.privateKeyPkcs8Base64url.length > 512
  ) {
    throw new Error("Pending replica key record has unsupported fields")
  }
  return Object.freeze({
    format: record.format,
    projectId: parseProjectId(record.projectId),
    projectEpoch: parseId128(record.projectEpoch),
    allocationRequestId: parseId128(record.allocationRequestId),
    privateKeyPkcs8Base64url: record.privateKeyPkcs8Base64url,
  })
}

function keyFromPkcs8(value: string) {
  const privateDer = Buffer.from(value, "base64url")
  if (privateDer.toString("base64url") !== value) {
    privateDer.fill(0)
    throw new Error("Replica vault PKCS#8 encoding is noncanonical")
  }
  const privateKey = createPrivateKey({ key: privateDer, format: "der", type: "pkcs8" })
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer
  if (publicDer.byteLength < 32) {
    privateDer.fill(0)
    throw new Error("Replica vault public key is invalid")
  }
  return Object.freeze({
    privateDer,
    privateKey,
    publicKey: parsePublicKey(encodeBase64url(publicDer.subarray(publicDer.byteLength - 32))),
  })
}

function signerFromPrivateKey(privateKey: ReturnType<typeof createPrivateKey>): ReplicaSignerPort {
  return Object.freeze({
    async sign(digest: Uint8Array) {
      if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) {
        throw new TypeError("Replica signer accepts only an exact 32-byte purpose digest")
      }
      return parseSignature(encodeBase64url(signDigest(null, Buffer.from(digest), privateKey)))
    },
  })
}

async function ensureVaultDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Replica signing vault root is untrusted")
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("Replica signing key directory permissions are too broad")
  }
}

async function writeNewRecord(target: string, record: ReplicaVaultRecord | PendingReplicaVaultRecord): Promise<void> {
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
      throw new Error("Replica signing key is not a bounded plain file")
    }
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
      throw new Error("Replica signing key permissions are too broad")
    }
    return new Uint8Array(await handle.readFile())
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directory: string): Promise<void> {
  await syncDirectoryEntry(directory)
}

async function isFile(target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) throw new Error("Replica signing vault entry is a symbolic link")
    if (!stat.isFile()) throw new Error("Replica signing vault entry is not a file")
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST"
}
