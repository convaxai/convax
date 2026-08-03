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
  decodeRestrictedJcsV2,
  encodeBase64urlV2,
  encodeRestrictedJcsTextV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  structuredDigestV2,
  type Id128V2,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaIdV2,
  type ReplicaSignerPortV2,
} from "@convax/collaboration"

import type { OfflineReplicaSigningVaultV2 } from "./collaboration-production-runtime"

export interface ElectronSafeStoragePortV2 {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  getSelectedStorageBackend?(): string
}

interface ReplicaVaultPlaintextV2 {
  readonly format: "convax.desktop-replica-vault-key/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly replicaId: ReplicaIdV2
  readonly privateKeyPkcs8Base64url: string
}

interface PendingReplicaVaultPlaintextV2 {
  readonly format: "convax.desktop-pending-replica-vault-key/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly allocationRequestId: Id128V2
  readonly privateKeyPkcs8Base64url: string
}

export interface CreatedReplicaVaultKeyV2 {
  readonly publicKey: PublicKeyV2
  readonly signer: ReplicaSignerPortV2
}

/**
 * Stores only OS-vault-encrypted PKCS#8 bytes below Electron userData. The Project
 * store receives actor/credential digests, never private key bytes or a key path.
 */
export class ElectronReplicaSigningVaultV2 implements OfflineReplicaSigningVaultV2 {
  constructor(
    private readonly rootDirectory: string,
    private readonly safeStorage: ElectronSafeStoragePortV2,
  ) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Replica signing vault root must be absolute")
  }

  async createReplicaKey(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly replicaId: ReplicaIdV2
  }): Promise<CreatedReplicaVaultKeyV2> {
    const identity = parseIdentity(input)
    this.requireSecureBackend()
    await ensureVaultDirectory(this.rootDirectory)
    const target = this.target(identity)
    if (await isFile(target)) return this.load(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      const record: ReplicaVaultPlaintextV2 = Object.freeze({
        format: "convax.desktop-replica-vault-key/2",
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

  /**
   * Reservation assigns replicaId only after the member has signed the requested
   * public key. This request-bound key is therefore durable before allocation and
   * carries no replica identity until bindPreparedReplicaKey verifies the receipt.
   */
  async prepareReplicaKey(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly allocationRequestId: Id128V2
  }): Promise<CreatedReplicaVaultKeyV2> {
    const identity = parsePendingIdentity(input)
    this.requireSecureBackend()
    await ensureVaultDirectory(this.rootDirectory)
    const target = this.pendingTarget(identity)
    if (await isFile(target)) return this.loadPending(identity, target)
    const pair = generateKeyPairSync("ed25519")
    const privateKeyPkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer
    try {
      await this.writeEncryptedNew(target, Object.freeze({
        format: "convax.desktop-pending-replica-vault-key/2" as const,
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
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly allocationRequestId: Id128V2
    readonly replicaId: ReplicaIdV2
    readonly expectedPublicKey: PublicKeyV2
  }): Promise<CreatedReplicaVaultKeyV2> {
    const pendingIdentity = parsePendingIdentity(input)
    const activeIdentity = parseIdentity(input)
    this.requireSecureBackend()
    await ensureVaultDirectory(this.rootDirectory)
    const pendingTarget = this.pendingTarget(pendingIdentity)
    const activeTarget = this.target(activeIdentity)
    if (await isFile(activeTarget)) {
      const active = await this.load(activeIdentity, activeTarget)
      if (active.publicKey !== parsePublicKeyV2(input.expectedPublicKey)) throw new Error("Assigned replica key crossed reservation identity")
      await fs.unlink(pendingTarget).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      })
      return active
    }
    if (!await isFile(pendingTarget)) throw new Error("Pending replica key is missing")
    const pendingRecord = await this.readPendingRecord(pendingIdentity, pendingTarget)
    const key = keyFromPkcs8(pendingRecord.privateKeyPkcs8Base64url)
    try {
      if (key.publicKey !== parsePublicKeyV2(input.expectedPublicKey)) throw new Error("Pending replica key mismatches reservation receipt")
      await this.writeEncryptedNew(activeTarget, Object.freeze({
        format: "convax.desktop-replica-vault-key/2" as const,
        ...activeIdentity,
        privateKeyPkcs8Base64url: pendingRecord.privateKeyPkcs8Base64url,
      }))
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    } finally {
      key.privateDer.fill(0)
    }
    const active = await this.load(activeIdentity, activeTarget)
    if (active.publicKey !== parsePublicKeyV2(input.expectedPublicKey)) throw new Error("Assigned replica key publication mismatches")
    await fs.unlink(pendingTarget)
    await syncDirectory(path.dirname(pendingTarget))
    return active
  }

  async openSigner(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly replicaId: ReplicaIdV2
    readonly expectedPublicKey: PublicKeyV2
  }): Promise<ReplicaSignerPortV2 | "missing" | "unavailable" | "rejected"> {
    const identity = parseIdentity(input)
    if (!this.hasSecureBackend()) return "unavailable"
    const target = this.target(identity)
    if (!await isFile(target)) return "missing"
    try {
      const loaded = await this.load(identity, target)
      if (loaded.publicKey !== parsePublicKeyV2(input.expectedPublicKey)) return "rejected"
      return loaded.signer
    } catch {
      return "rejected"
    }
  }

  private async load(
    identity: Readonly<{ projectId: ProjectIdV2; projectEpoch: Id128V2; replicaId: ReplicaIdV2 }>,
    target: string,
  ): Promise<CreatedReplicaVaultKeyV2> {
    const encrypted = Buffer.from(await fs.readFile(target))
    let plaintext = ""
    try {
      plaintext = this.safeStorage.decryptString(encrypted)
    } finally {
      encrypted.fill(0)
    }
    const parsed = parsePlaintext(decodeRestrictedJcsV2(new TextEncoder().encode(plaintext)))
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
      const publicKey = parsePublicKeyV2(encodeBase64urlV2(publicDer.subarray(publicDer.byteLength - 32)))
      const signerPort: ReplicaSignerPortV2 = {
        async sign(digest) {
          if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) {
            throw new TypeError("Replica signer accepts only an exact 32-byte purpose digest")
          }
          return parseSignatureV2(encodeBase64urlV2(signDigest(null, Buffer.from(digest), privateKey)))
        },
      }
      const signer = Object.freeze(signerPort)
      return Object.freeze({ publicKey, signer })
    } finally {
      privateDer.fill(0)
    }
  }

  private async loadPending(
    identity: Readonly<{ projectId: ProjectIdV2; projectEpoch: Id128V2; allocationRequestId: Id128V2 }>,
    target: string,
  ): Promise<CreatedReplicaVaultKeyV2> {
    const record = await this.readPendingRecord(identity, target)
    const key = keyFromPkcs8(record.privateKeyPkcs8Base64url)
    try { return Object.freeze({ publicKey: key.publicKey, signer: signerFromPrivateKey(key.privateKey) }) }
    finally { key.privateDer.fill(0) }
  }

  private async readPendingRecord(
    identity: Readonly<{ projectId: ProjectIdV2; projectEpoch: Id128V2; allocationRequestId: Id128V2 }>,
    target: string,
  ): Promise<PendingReplicaVaultPlaintextV2> {
    const encrypted = Buffer.from(await fs.readFile(target))
    let plaintext = ""
    try { plaintext = this.safeStorage.decryptString(encrypted) } finally { encrypted.fill(0) }
    const parsed = parsePendingPlaintext(decodeRestrictedJcsV2(new TextEncoder().encode(plaintext)))
    plaintext = ""
    if (parsed.projectId !== identity.projectId || parsed.projectEpoch !== identity.projectEpoch ||
      parsed.allocationRequestId !== identity.allocationRequestId) throw new Error("Pending replica vault key crossed identity")
    return parsed
  }

  private async writeEncryptedNew(target: string, record: ReplicaVaultPlaintextV2 | PendingReplicaVaultPlaintextV2): Promise<void> {
    const encrypted = this.safeStorage.encryptString(encodeRestrictedJcsTextV2(record))
    try { await writeNewEncrypted(target, encrypted) } finally { encrypted.fill(0) }
  }

  private target(identity: Readonly<{ projectId: ProjectIdV2; projectEpoch: Id128V2; replicaId: ReplicaIdV2 }>): string {
    const key = structuredDigestV2("convax.desktop-replica-vault-native-key/2", identity)
    return path.join(this.rootDirectory, `${parseDigestV2(key)}.vault`)
  }

  private pendingTarget(identity: Readonly<{ projectId: ProjectIdV2; projectEpoch: Id128V2; allocationRequestId: Id128V2 }>): string {
    const key = structuredDigestV2("convax.desktop-pending-replica-vault-native-key/2", identity)
    return path.join(this.rootDirectory, `${parseDigestV2(key)}.pending-vault`)
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
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly replicaId: ReplicaIdV2
}) {
  return Object.freeze({
    projectId: parseProjectIdV2(input.projectId),
    projectEpoch: parseId128V2(input.projectEpoch),
    replicaId: parseReplicaIdV2(input.replicaId),
  })
}

function parsePendingIdentity(input: {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly allocationRequestId: Id128V2
}) {
  return Object.freeze({
    projectId: parseProjectIdV2(input.projectId),
    projectEpoch: parseId128V2(input.projectEpoch),
    allocationRequestId: parseId128V2(input.allocationRequestId),
  })
}

function parsePlaintext(value: unknown): ReplicaVaultPlaintextV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Replica vault plaintext is invalid")
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== ["format", "privateKeyPkcs8Base64url", "projectEpoch", "projectId", "replicaId"].sort().join("\0") ||
    record.format !== "convax.desktop-replica-vault-key/2" ||
    typeof record.privateKeyPkcs8Base64url !== "string" ||
    record.privateKeyPkcs8Base64url.length < 1 || record.privateKeyPkcs8Base64url.length > 512
  ) throw new Error("Replica vault plaintext has unsupported fields")
  return Object.freeze({
    format: record.format,
    projectId: parseProjectIdV2(record.projectId),
    projectEpoch: parseId128V2(record.projectEpoch),
    replicaId: parseReplicaIdV2(record.replicaId),
    privateKeyPkcs8Base64url: record.privateKeyPkcs8Base64url,
  })
}

function parsePendingPlaintext(value: unknown): PendingReplicaVaultPlaintextV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pending replica vault plaintext is invalid")
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("\0") !== ["allocationRequestId", "format", "privateKeyPkcs8Base64url", "projectEpoch", "projectId"].sort().join("\0") ||
    record.format !== "convax.desktop-pending-replica-vault-key/2" || typeof record.privateKeyPkcs8Base64url !== "string" ||
    record.privateKeyPkcs8Base64url.length < 1 || record.privateKeyPkcs8Base64url.length > 512) {
    throw new Error("Pending replica vault plaintext has unsupported fields")
  }
  return Object.freeze({
    format: record.format,
    projectId: parseProjectIdV2(record.projectId),
    projectEpoch: parseId128V2(record.projectEpoch),
    allocationRequestId: parseId128V2(record.allocationRequestId),
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
    publicKey: parsePublicKeyV2(encodeBase64urlV2(publicDer.subarray(publicDer.byteLength - 32))),
  })
}

function signerFromPrivateKey(privateKey: ReturnType<typeof createPrivateKey>): ReplicaSignerPortV2 {
  return Object.freeze({
    async sign(digest: Uint8Array) {
      if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) {
        throw new TypeError("Replica signer accepts only an exact 32-byte purpose digest")
      }
      return parseSignatureV2(encodeBase64urlV2(signDigest(null, Buffer.from(digest), privateKey)))
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
