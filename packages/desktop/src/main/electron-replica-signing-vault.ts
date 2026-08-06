import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signDigest,
} from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcs,
  encodeBase64url,
  encodeRestrictedJcsText,
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

export interface ElectronSafeStoragePort {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  getSelectedStorageBackend?(): string
}

interface ReplicaVaultPlaintext {
  readonly format: "convax.desktop-replica-vault-key"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly replicaId: ReplicaId
  readonly privateKeyPkcs8Base64url: string
}

interface PendingReplicaVaultPlaintext {
  readonly format: "convax.desktop-pending-replica-vault-key"
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
 * Stores only OS-vault-encrypted PKCS#8 bytes below Electron userData. The Project
 * store receives actor/credential digests, never private key bytes or a key path.
 */
export class ElectronReplicaSigningVault implements OfflineReplicaSigningVault {
  constructor(
    private readonly rootDirectory: string,
    private readonly safeStorage: ElectronSafeStoragePort,
  ) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Replica signing vault root must be absolute")
  }

  async createReplicaKey(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly replicaId: ReplicaId
  }): Promise<CreatedReplicaVaultKey> {
    const identity = parseIdentity(input)
    this.requireSecureBackend()
    await ensureVaultDirectory(this.rootDirectory)
    const target = this.target(identity)
    if (await isFile(target)) return this.load(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      const record: ReplicaVaultPlaintext = Object.freeze({
        format: "convax.desktop-replica-vault-key",
        ...identity,
        privateKeyPkcs8Base64url: privateKeyPkcs8.toString("base64url"),
      })
      const encrypted = this.safeStorage.encryptString(encodeRestrictedJcsText(record))
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
    this.requireSecureBackend()
    await ensureVaultDirectory(this.rootDirectory)
    const target = this.pendingTarget(identity)
    if (await isFile(target)) return this.loadPending(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      await this.writeEncryptedNew(target, Object.freeze({
        format: "convax.desktop-pending-replica-vault-key" as const,
        ...identity,
        privateKeyPkcs8Base64url: privateKeyPkcs8.toString("base64url"),
      }))
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
    this.requireSecureBackend()
    await ensureVaultDirectory(this.rootDirectory)
    const pendingTarget = this.pendingTarget(pendingIdentity)
    const activeTarget = this.target(activeIdentity)
    if (await isFile(activeTarget)) {
      const active = await this.load(activeIdentity, activeTarget)
      if (active.publicKey !== parsePublicKey(input.expectedPublicKey)) throw new Error("Assigned replica key crossed reservation identity")
      await fs.unlink(pendingTarget).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      })
      return active
    }
    if (!await isFile(pendingTarget)) throw new Error("Pending replica key is missing")
    const pendingRecord = await this.readPendingRecord(pendingIdentity, pendingTarget)
    const key = keyFromPkcs8(pendingRecord.privateKeyPkcs8Base64url)
    try {
      if (key.publicKey !== parsePublicKey(input.expectedPublicKey)) throw new Error("Pending replica key mismatches reservation receipt")
      await this.writeEncryptedNew(activeTarget, Object.freeze({
        format: "convax.desktop-replica-vault-key" as const,
        ...activeIdentity,
        privateKeyPkcs8Base64url: pendingRecord.privateKeyPkcs8Base64url,
      }))
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    } finally {
      key.privateDer.fill(0)
    }
    const active = await this.load(activeIdentity, activeTarget)
    if (active.publicKey !== parsePublicKey(input.expectedPublicKey)) throw new Error("Assigned replica key publication mismatches")
    await fs.unlink(pendingTarget)
    await syncDirectory(path.dirname(pendingTarget))
    return active
  }

  async openSigner(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly replicaId: ReplicaId
    readonly expectedPublicKey: PublicKey
  }): Promise<ReplicaSignerPort | "missing" | "unavailable" | "rejected"> {
    const identity = parseIdentity(input)
    if (!this.hasSecureBackend()) return "unavailable"
    const target = this.target(identity)
    if (!await isFile(target)) return "missing"
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
    const encrypted = Buffer.from(await fs.readFile(target))
    let plaintext = ""
    try {
      plaintext = this.safeStorage.decryptString(encrypted)
    } finally {
      encrypted.fill(0)
    }
    const parsed = parsePlaintext(decodeRestrictedJcs(new TextEncoder().encode(plaintext)))
    plaintext = ""
    if (
      parsed.projectId !== identity.projectId ||
      parsed.projectEpoch !== identity.projectEpoch ||
      parsed.replicaId !== identity.replicaId
    ) throw new Error("Replica vault key crossed identity")
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
    try { return Object.freeze({ publicKey: key.publicKey, signer: signerFromPrivateKey(key.privateKey) }) }
    finally { key.privateDer.fill(0) }
  }

  private async readPendingRecord(
    identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; allocationRequestId: Id128 }>,
    target: string,
  ): Promise<PendingReplicaVaultPlaintext> {
    const encrypted = Buffer.from(await fs.readFile(target))
    let plaintext = ""
    try { plaintext = this.safeStorage.decryptString(encrypted) } finally { encrypted.fill(0) }
    const parsed = parsePendingPlaintext(decodeRestrictedJcs(new TextEncoder().encode(plaintext)))
    plaintext = ""
    if (parsed.projectId !== identity.projectId || parsed.projectEpoch !== identity.projectEpoch ||
      parsed.allocationRequestId !== identity.allocationRequestId) throw new Error("Pending replica vault key crossed identity")
    return parsed
  }

  private async writeEncryptedNew(target: string, record: ReplicaVaultPlaintext | PendingReplicaVaultPlaintext): Promise<void> {
    const encrypted = this.safeStorage.encryptString(encodeRestrictedJcsText(record))
    try { await writeNewEncrypted(target, encrypted) } finally { encrypted.fill(0) }
  }

  private target(identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; replicaId: ReplicaId }>): string {
    const key = structuredDigest("convax.desktop-replica-vault-native-key", identity)
    return path.join(this.rootDirectory, `${parseDigest(key)}.vault`)
  }

  private pendingTarget(identity: Readonly<{ projectId: ProjectId; projectEpoch: Id128; allocationRequestId: Id128 }>): string {
    const key = structuredDigest("convax.desktop-pending-replica-vault-native-key", identity)
    return path.join(this.rootDirectory, `${parseDigest(key)}.pending-vault`)
  }

  private hasSecureBackend(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) return false
    return this.safeStorage.getSelectedStorageBackend?.() !== "basic_text"
  }

  private requireSecureBackend(): void {
    if (!this.hasSecureBackend()) throw new Error("OS-backed replica signing vault is unavailable")
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

function parsePlaintext(value: unknown): ReplicaVaultPlaintext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Replica vault plaintext is invalid")
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== ["format", "privateKeyPkcs8Base64url", "projectEpoch", "projectId", "replicaId"].sort().join("\0") ||
    record.format !== "convax.desktop-replica-vault-key" ||
    typeof record.privateKeyPkcs8Base64url !== "string" ||
    record.privateKeyPkcs8Base64url.length < 1 || record.privateKeyPkcs8Base64url.length > 512
  ) throw new Error("Replica vault plaintext has unsupported fields")
  return Object.freeze({
    format: record.format,
    projectId: parseProjectId(record.projectId),
    projectEpoch: parseId128(record.projectEpoch),
    replicaId: parseReplicaId(record.replicaId),
    privateKeyPkcs8Base64url: record.privateKeyPkcs8Base64url,
  })
}

function parsePendingPlaintext(value: unknown): PendingReplicaVaultPlaintext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pending replica vault plaintext is invalid")
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("\0") !== ["allocationRequestId", "format", "privateKeyPkcs8Base64url", "projectEpoch", "projectId"].sort().join("\0") ||
    record.format !== "convax.desktop-pending-replica-vault-key" || typeof record.privateKeyPkcs8Base64url !== "string" ||
    record.privateKeyPkcs8Base64url.length < 1 || record.privateKeyPkcs8Base64url.length > 512) {
    throw new Error("Pending replica vault plaintext has unsupported fields")
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
}

async function writeNewEncrypted(target: string, encrypted: Readonly<Uint8Array>): Promise<void> {
  const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    await handle.writeFile(encrypted)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(path.dirname(target))
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await handle.sync() } finally { await handle.close() }
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
