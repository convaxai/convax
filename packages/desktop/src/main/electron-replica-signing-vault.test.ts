import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseId128, parseProjectId, parsePublicKey, parseReplicaId } from "@convax/collaboration"

import { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("ElectronReplicaSigningVault", () => {
  test("creates one user-managed replica key outside Project bytes and reopens its signer", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-replica-vault-"))
    roots.push(root)
    const directory = path.join(root, "userData", "replica-signing-keys")
    const vault = new ElectronReplicaSigningVault(directory)
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
    const keyPath = path.join(directory, files[0]!)
    const stored = JSON.parse(await fs.readFile(keyPath, "utf8")) as Record<string, unknown>
    expect(stored).toMatchObject({
      format: "convax.desktop-user-managed-replica-key",
      projectId: identity.projectId,
      projectEpoch: identity.projectEpoch,
      replicaId: identity.replicaId,
    })
    expect(typeof stored.privateKeyPkcs8Base64url).toBe("string")
    if (process.platform !== "win32") {
      expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
      expect((await fs.stat(keyPath)).mode & 0o777).toBe(0o600)
    }
    expect(
      await vault.openSigner({
        ...identity,
        expectedPublicKey: parsePublicKey(Buffer.alloc(32, 9).toString("base64url")),
      }),
    ).toBe("rejected")
  })

  test("does not read, migrate, modify, or delete a legacy vault ciphertext", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-replica-vault-"))
    roots.push(root)
    const directory = path.join(root, "keys")
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const legacyPath = path.join(directory, `${"a".repeat(64)}.vault`)
    const legacyCiphertext = Buffer.from("legacy-safe-storage-ciphertext")
    await fs.writeFile(legacyPath, legacyCiphertext, { mode: 0o600 })
    const vault = new ElectronReplicaSigningVault(directory)
    const identity = {
      projectId: parseProjectId("project"),
      projectEpoch: parseId128(Buffer.alloc(16, 1).toString("base64url")),
      replicaId: parseReplicaId("replica_0000002a"),
    }
    await expect(vault.createReplicaKey(identity)).resolves.toBeObject()
    expect(await fs.readFile(legacyPath)).toEqual(legacyCiphertext)
    expect((await fs.readdir(directory)).filter((entry) => entry.endsWith(".key"))).toHaveLength(1)
  })

  test("durably prepares a reservation-bound key and publishes it only under the assigned replica id", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-replica-vault-"))
    roots.push(root)
    const directory = path.join(root, "keys")
    const vault = new ElectronReplicaSigningVault(directory)
    const base = {
      projectId: parseProjectId("project-pending"),
      projectEpoch: parseId128(Buffer.alloc(16, 2).toString("base64url")),
      allocationRequestId: parseId128(Buffer.alloc(16, 3).toString("base64url")),
    }
    const prepared = await vault.prepareReplicaKey(base)
    const restarted = new ElectronReplicaSigningVault(directory)
    expect((await restarted.prepareReplicaKey(base)).publicKey).toBe(prepared.publicKey)
    const replicaId = parseReplicaId("replica_0000002b")
    const bound = await restarted.bindPreparedReplicaKey({ ...base, replicaId, expectedPublicKey: prepared.publicKey })
    expect(bound.publicKey).toBe(prepared.publicKey)
    expect(
      await restarted.openSigner({
        projectId: base.projectId,
        projectEpoch: base.projectEpoch,
        replicaId,
        expectedPublicKey: prepared.publicKey,
      }),
    ).not.toBe("missing")
    expect((await fs.readdir(directory)).filter((name) => name.endsWith(".pending-key"))).toEqual([])
    await expect(
      restarted.bindPreparedReplicaKey({
        ...base,
        replicaId,
        expectedPublicKey: parsePublicKey(Buffer.alloc(32, 9).toString("base64url")),
      }),
    ).rejects.toThrow("crossed")
  })
})
