import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeBase64url,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSessionId,
  parseUint64,
} from "@convax/collaboration"

import type { ElectronSafeStoragePort } from "./electron-replica-signing-vault"
import { ElectronTeamIdentityVault } from "./electron-team-identity-vault"

const id = (byte: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
const projectId = parseProjectId("project-team-vault")
const memberId = parseMemberId(id(2))

describe("ElectronTeamIdentityVault", () => {
  test("keeps member and session keys stable and purpose-separated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const storage = fakeSafeStorage()
    const vault = new ElectronTeamIdentityVault(path.join(root, "keys"), storage)
    const member = await vault.ensureMemberKey({ projectId, memberId })
    const sameMember = await vault.ensureMemberKey({ projectId, memberId })
    expect(sameMember.publicKey).toBe(member.publicKey)
    await expect(vault.openMemberSigner({ projectId, memberId, expectedPublicKey: member.publicKey })).resolves.toBeObject()

    const sessionIdentity = {
      projectId, memberId, projectEpoch: id(3), replicaId: parseReplicaId("replica_00000001"), sessionId: parseSessionId(id(4)),
      expiresAtUnixMs: parseUint64("200"),
    }
    const session = await vault.ensureSessionKey(sessionIdentity)
    expect(session.publicKey).not.toBe(member.publicKey)
    expect((await vault.ensureSessionKey(sessionIdentity)).publicKey).toBe(session.publicKey)
    await expect(vault.openSessionSigner({ ...sessionIdentity, expectedPublicKey: member.publicKey })).resolves.toBe("rejected")
    const restarted = new ElectronTeamIdentityVault(path.join(root, "keys"), storage)
    expect((await restarted.ensureSessionKey(sessionIdentity)).publicKey).toBe(session.publicKey)

    const entries = await fs.readdir(path.join(root, "keys"))
    expect(entries).toHaveLength(2)
    expect(await fs.readFile(path.join(root, "keys", entries[0]!), "utf8")).not.toContain("privateKeyPkcs8")
  })

  test("fails closed without an OS-backed encryption backend", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const vault = new ElectronTeamIdentityVault(path.join(root, "keys"), {
      ...fakeSafeStorage(),
      isEncryptionAvailable: () => false,
    })
    await expect(vault.ensureMemberKey({ projectId, memberId })).rejects.toThrow("OS-backed")
  })

  test("prunes only expired session keys and explicitly removes a closed session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const vault = new ElectronTeamIdentityVault(path.join(root, "keys"), fakeSafeStorage())
    const member = await vault.ensureMemberKey({ projectId, memberId })
    const base = { projectId, memberId, projectEpoch: id(3), replicaId: parseReplicaId("replica_00000001") }
    const expired = { ...base, sessionId: parseSessionId(id(4)), expiresAtUnixMs: parseUint64("100") }
    const active = { ...base, sessionId: parseSessionId(id(5)), expiresAtUnixMs: parseUint64("200") }
    const expiredKey = await vault.ensureSessionKey(expired)
    const activeKey = await vault.ensureSessionKey(active)

    await expect(vault.pruneExpiredSessionKeys({ nowUnixMs: parseUint64("100") })).resolves.toBe(1)
    await expect(vault.openSessionSigner({ ...expired, expectedPublicKey: expiredKey.publicKey })).resolves.toBe("missing")
    await expect(vault.openSessionSigner({ ...active, expectedPublicKey: activeKey.publicKey })).resolves.toBeObject()
    await expect(vault.openMemberSigner({ projectId, memberId, expectedPublicKey: member.publicKey })).resolves.toBeObject()
    await expect(vault.removeSessionKey(active)).resolves.toBe("removed")
    await expect(vault.removeSessionKey(active)).resolves.toBe("missing")
  })

  test("rejects symlink entries and encrypted identity crossover", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const keyRoot = path.join(root, "keys")
    const vault = new ElectronTeamIdentityVault(keyRoot, fakeSafeStorage())
    await vault.ensureMemberKey({ projectId, memberId })
    const memberEntries = new Set(await fs.readdir(keyRoot))
    const base = { projectId, memberId, projectEpoch: id(3), replicaId: parseReplicaId("replica_00000001"), expiresAtUnixMs: parseUint64("200") }
    const first = { ...base, sessionId: parseSessionId(id(4)) }
    const firstKey = await vault.ensureSessionKey(first)
    const firstEntry = (await fs.readdir(keyRoot)).find((entry) => !memberEntries.has(entry))!
    const beforeSecond = new Set(await fs.readdir(keyRoot))
    const second = { ...base, sessionId: parseSessionId(id(5)) }
    await vault.ensureSessionKey(second)
    const secondEntry = (await fs.readdir(keyRoot)).find((entry) => !beforeSecond.has(entry))!
    await fs.copyFile(path.join(keyRoot, secondEntry), path.join(keyRoot, firstEntry))
    await expect(vault.openSessionSigner({ ...first, expectedPublicKey: firstKey.publicKey })).resolves.toBe("rejected")

    await fs.symlink(path.join(root, "outside"), path.join(keyRoot, `${"f".repeat(64)}.vault`))
    await expect(vault.pruneExpiredSessionKeys({ nowUnixMs: parseUint64("300") })).rejects.toThrow("untrusted")
  })

  test("fails closed for Electron basic_text storage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const vault = new ElectronTeamIdentityVault(path.join(root, "keys"), {
      ...fakeSafeStorage(),
      getSelectedStorageBackend: () => "basic_text",
    })
    await expect(vault.ensureMemberKey({ projectId, memberId })).rejects.toThrow("OS-backed")
  })
})

function fakeSafeStorage(): ElectronSafeStoragePort {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString(value) {
      const bytes = Buffer.from(value)
      return Buffer.from(bytes.map((byte, index) => byte ^ key[index % key.length]!))
    },
    decryptString(value) {
      return Buffer.from(value.map((byte, index) => byte ^ key[index % key.length]!)).toString("utf8")
    },
  }
}
