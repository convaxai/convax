import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  parseId128,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
} from "@convax/collaboration"

import {
  ElectronReplicaSigningVaultV2,
  type ElectronSafeStoragePortV2,
} from "./electron-replica-signing-vault"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("ElectronReplicaSigningVaultV2", () => {
  test("creates one OS-encrypted replica key outside Project bytes and reopens its signer", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-replica-vault-"))
    roots.push(root)
    const directory = path.join(root, "userData", "replica-signing-keys")
    const vault = new ElectronReplicaSigningVaultV2(directory, fakeSafeStorage())
    const identity = {
      projectId: parseProjectId("project"),
      projectEpoch: parseId128(Buffer.alloc(16, 1).toString("base64url")),
      replicaId: parseReplicaId("replica_0000002a"),
    }
    const created = await vault.createReplicaKey(identity)
    const repeated = await vault.createReplicaKey(identity)
    expect(repeated.publicKey).toBe(created.publicKey)
    const signer = await vault.openSigner({ ...identity, expectedPublicKey: created.publicKey })
    expect(typeof signer).not.toBe("string")
    if (typeof signer === "string") throw new Error("unexpected vault state")
    const signature = await signer.sign(new Uint8Array(32).fill(7))
    expect(typeof signature).toBe("string")
    const files = await fs.readdir(directory)
    expect(files).toHaveLength(1)
    const encrypted = await fs.readFile(path.join(directory, files[0]!))
    expect(encrypted.includes(Buffer.from("PRIVATE KEY"))).toBe(false)
    expect(encrypted.includes(Buffer.from(identity.projectId))).toBe(false)
    expect(await vault.openSigner({
      ...identity,
      expectedPublicKey: parsePublicKey(Buffer.alloc(32, 9).toString("base64url")),
    })).toBe("rejected")
  })

  test("fails closed when Electron reports a plaintext storage backend", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-replica-vault-"))
    roots.push(root)
    const vault = new ElectronReplicaSigningVaultV2(path.join(root, "keys"), {
      ...fakeSafeStorage(),
      getSelectedStorageBackend: () => "basic_text",
    })
    const identity = {
      projectId: parseProjectId("project"),
      projectEpoch: parseId128(Buffer.alloc(16, 1).toString("base64url")),
      replicaId: parseReplicaId("replica_0000002a"),
    }
    await expect(vault.createReplicaKey(identity)).rejects.toThrow("unavailable")
  })

  test("durably prepares a reservation-bound key and publishes it only under the assigned replica id", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-replica-vault-"))
    roots.push(root)
    const directory = path.join(root, "keys")
    const storage = fakeSafeStorage()
    const vault = new ElectronReplicaSigningVaultV2(directory, storage)
    const base = {
      projectId: parseProjectId("project-pending"),
      projectEpoch: parseId128(Buffer.alloc(16, 2).toString("base64url")),
      allocationRequestId: parseId128(Buffer.alloc(16, 3).toString("base64url")),
    }
    const prepared = await vault.prepareReplicaKey(base)
    const restarted = new ElectronReplicaSigningVaultV2(directory, storage)
    expect((await restarted.prepareReplicaKey(base)).publicKey).toBe(prepared.publicKey)
    const replicaId = parseReplicaId("replica_0000002b")
    const bound = await restarted.bindPreparedReplicaKey({ ...base, replicaId, expectedPublicKey: prepared.publicKey })
    expect(bound.publicKey).toBe(prepared.publicKey)
    expect(await restarted.openSigner({
      projectId: base.projectId,
      projectEpoch: base.projectEpoch,
      replicaId,
      expectedPublicKey: prepared.publicKey,
    })).not.toBe("missing")
    expect((await fs.readdir(directory)).filter((name) => name.endsWith(".pending-vault"))).toEqual([])
    await expect(restarted.bindPreparedReplicaKey({
      ...base,
      replicaId,
      expectedPublicKey: parsePublicKey(Buffer.alloc(32, 9).toString("base64url")),
    })).rejects.toThrow("crossed")
  })
})

function fakeSafeStorage(): ElectronSafeStoragePortV2 {
  const secret = 0xa5
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString(plainText) {
      return Buffer.from(new TextEncoder().encode(plainText).map((byte) => byte ^ secret))
    },
    decryptString(encrypted) {
      return new TextDecoder().decode(Uint8Array.from(encrypted, (byte) => byte ^ secret))
    },
  }
}
