import { describe, expect, test } from "bun:test"
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

import { ElectronTeamIdentityVault } from "./electron-team-identity-vault"

const id = (byte: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
const projectId = parseProjectId("project-team-vault")
const memberId = parseMemberId(id(2))

describe("ElectronTeamIdentityVault", () => {
  test("keeps member and session keys stable and purpose-separated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const keyRoot = path.join(root, "keys")
    const vault = new ElectronTeamIdentityVault(keyRoot)
    const member = await vault.ensureMemberKey({ projectId, memberId })
    const sameMember = await vault.ensureMemberKey({ projectId, memberId })
    expect(sameMember.publicKey).toBe(member.publicKey)
    await expect(
      vault.openMemberSigner({ projectId, memberId, expectedPublicKey: member.publicKey }),
    ).resolves.toBeObject()

    const sessionIdentity = {
      projectId,
      memberId,
      projectEpoch: id(3),
      replicaId: parseReplicaId("replica_00000001"),
      sessionId: parseSessionId(id(4)),
      expiresAtUnixMs: parseUint64("200"),
    }
    const session = await vault.ensureSessionKey(sessionIdentity)
    expect(session.publicKey).not.toBe(member.publicKey)
    expect((await vault.ensureSessionKey(sessionIdentity)).publicKey).toBe(session.publicKey)
    await expect(vault.openSessionSigner({ ...sessionIdentity, expectedPublicKey: member.publicKey })).resolves.toBe(
      "rejected",
    )
    const restarted = new ElectronTeamIdentityVault(keyRoot)
    expect((await restarted.ensureSessionKey(sessionIdentity)).publicKey).toBe(session.publicKey)

    const entries = await fs.readdir(path.join(root, "keys"))
    expect(entries).toHaveLength(2)
    const stored = await fs.readFile(path.join(keyRoot, entries[0]!), "utf8")
    expect(stored).toContain("convax.desktop-user-managed-team-identity-key")
    expect(stored).toContain("privateKeyPkcs8Base64url")
    if (process.platform !== "win32") {
      expect((await fs.stat(keyRoot)).mode & 0o777).toBe(0o700)
      expect((await fs.stat(path.join(keyRoot, entries[0]!))).mode & 0o777).toBe(0o600)
    }
  })

  test("leaves the retired safe-storage directory and ciphertext unchanged", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const legacyRoot = path.join(root, "team-identity-vault")
    const legacyPath = path.join(legacyRoot, `${"b".repeat(64)}.vault`)
    const legacyCiphertext = Buffer.from("legacy-safe-storage-ciphertext")
    await fs.mkdir(legacyRoot, { recursive: true })
    await fs.writeFile(legacyPath, legacyCiphertext, { mode: 0o600 })
    const vault = new ElectronTeamIdentityVault(path.join(root, "team-identity-keys"))
    await expect(vault.ensureMemberKey({ projectId, memberId })).resolves.toBeObject()
    expect(await fs.readFile(legacyPath)).toEqual(legacyCiphertext)
  })

  test("prunes only expired session keys and explicitly removes a closed session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const vault = new ElectronTeamIdentityVault(path.join(root, "keys"))
    const member = await vault.ensureMemberKey({ projectId, memberId })
    const base = { projectId, memberId, projectEpoch: id(3), replicaId: parseReplicaId("replica_00000001") }
    const expired = { ...base, sessionId: parseSessionId(id(4)), expiresAtUnixMs: parseUint64("100") }
    const active = { ...base, sessionId: parseSessionId(id(5)), expiresAtUnixMs: parseUint64("200") }
    const expiredKey = await vault.ensureSessionKey(expired)
    const activeKey = await vault.ensureSessionKey(active)

    await expect(vault.pruneExpiredSessionKeys({ nowUnixMs: parseUint64("100") })).resolves.toBe(1)
    await expect(vault.openSessionSigner({ ...expired, expectedPublicKey: expiredKey.publicKey })).resolves.toBe(
      "missing",
    )
    await expect(vault.openSessionSigner({ ...active, expectedPublicKey: activeKey.publicKey })).resolves.toBeObject()
    await expect(
      vault.openMemberSigner({ projectId, memberId, expectedPublicKey: member.publicKey }),
    ).resolves.toBeObject()
    await expect(vault.removeSessionKey(active)).resolves.toBe("removed")
    await expect(vault.removeSessionKey(active)).resolves.toBe("missing")
  })

  test("rejects symlink entries and encrypted identity crossover", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-team-vault-"))
    const keyRoot = path.join(root, "keys")
    const vault = new ElectronTeamIdentityVault(keyRoot)
    await vault.ensureMemberKey({ projectId, memberId })
    const memberEntries = new Set(await fs.readdir(keyRoot))
    const base = {
      projectId,
      memberId,
      projectEpoch: id(3),
      replicaId: parseReplicaId("replica_00000001"),
      expiresAtUnixMs: parseUint64("200"),
    }
    const first = { ...base, sessionId: parseSessionId(id(4)) }
    const firstKey = await vault.ensureSessionKey(first)
    const firstEntry = (await fs.readdir(keyRoot)).find((entry) => !memberEntries.has(entry))!
    const beforeSecond = new Set(await fs.readdir(keyRoot))
    const second = { ...base, sessionId: parseSessionId(id(5)) }
    await vault.ensureSessionKey(second)
    const secondEntry = (await fs.readdir(keyRoot)).find((entry) => !beforeSecond.has(entry))!
    await fs.copyFile(path.join(keyRoot, secondEntry), path.join(keyRoot, firstEntry))
    await expect(vault.openSessionSigner({ ...first, expectedPublicKey: firstKey.publicKey })).resolves.toBe("rejected")

    await fs.symlink(path.join(root, "outside"), path.join(keyRoot, `${"f".repeat(64)}.key`))
    await expect(vault.pruneExpiredSessionKeys({ nowUnixMs: parseUint64("300") })).rejects.toThrow("untrusted")
  })
})
