import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  createWebCryptoEd25519VerifierV2,
  parseId128V2,
  parseProjectIdV2,
  parseReplicaIdV2,
} from "@convax/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/project"

import { loadHistoricalTestAuthorityV2 } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVaultV2, type ElectronSafeStoragePortV2 } from "./electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthorityV2 } from "./local-project-owner-authority"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("durable local Project owner authority", () => {
  test("resumes the same claim after a crash and opens the exact OS-vault binding", async () => {
    const fixture = await createFixture()
    let crash = true
    const first = fixture.owner({
      afterClaimFsync: async () => {
        if (crash) { crash = false; throw new Error("crash-after-claim") }
      },
    })
    await expect(first.ensureForDurableProject(fixture.input)).rejects.toThrow("crash-after-claim")

    const accepted = await fixture.owner().ensureForDurableProject(fixture.input)
    const retry = await fixture.owner().ensureForDurableProject(fixture.input)
    expect(retry.binding).toEqual(accepted.binding)
    expect(await retry.signer.sign(Buffer.alloc(32))).toEqual(await accepted.signer.sign(Buffer.alloc(32)))
  })

  test("rejects scope mismatch and tampered immutable binding", async () => {
    const fixture = await createFixture()
    await expect(fixture.owner().ensureForDurableProject({
      ...fixture.input,
      projectRoot: await fs.mkdtemp(path.join(os.tmpdir(), "convax-owner-wrong-root-")),
    })).rejects.toThrow("durable Project binding")

    const accepted = await fixture.owner().ensureForDurableProject(fixture.input)
    const bindingDirectory = path.join(fixture.userData, "owners", "bindings")
    const [name] = await fs.readdir(bindingDirectory)
    const target = path.join(bindingDirectory, name!)
    const bytes = await fs.readFile(target)
    bytes[bytes.length - 1] ^= 1
    await fs.writeFile(target, bytes)
    expect(await fixture.owner().resolveExact({
      projectId: accepted.binding.projectId,
      projectEpoch: accepted.binding.projectEpoch,
      initializationAuthorityDigest: accepted.binding.bindingDigest,
    })).toBe("rejected")
  })

  test("fails closed when Electron has no secure OS vault", async () => {
    const fixture = await createFixture({ safeStorage: unavailableStorage })
    await expect(fixture.owner().ensureForDurableProject(fixture.input)).rejects.toThrow(
      "OS-backed replica signing vault is unavailable",
    )
    expect(await fs.readdir(path.join(fixture.userData, "owners", "bindings"))).toEqual([])
  })
})

async function createFixture(options: { safeStorage?: ElectronSafeStoragePortV2 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-local-owner-"))
  roots.push(root)
  const userData = path.join(root, "user-data")
  const projectRoot = path.join(root, "project")
  await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
  const authority = await loadHistoricalTestAuthorityV2()
  const projectId = parseProjectIdV2("project-local-owner")
  const vault = new ElectronReplicaSigningVaultV2(
    path.join(userData, "vault"),
    options.safeStorage ?? availableStorage,
  )
  let idByte = 1
  let replica = 1
  return {
    userData,
    input: { projectId, projectRoot },
    owner: (faults?: ConstructorParameters<typeof NodeDurableLocalProjectOwnerAuthorityV2>[0]["faults"]) =>
      new NodeDurableLocalProjectOwnerAuthorityV2({
        rootDirectory: path.join(userData, "owners"),
        authority,
        schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
        projects: { async resolveProjectRoot({ projectId: requested }) {
          if (requested !== projectId) throw new Error("unknown Project")
          return projectRoot
        } },
        vault,
        verifier: createWebCryptoEd25519VerifierV2(),
        createId: () => parseId128V2(Buffer.alloc(16, idByte++).toString("base64url")),
        createReplicaId: () => parseReplicaIdV2(`replica_${(replica++).toString(16).padStart(8, "0")}`),
        ...(faults ? { faults } : {}),
      }),
  }
}

const availableStorage: ElectronSafeStoragePortV2 = Object.freeze({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) => Buffer.from(value, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8"),
})

const unavailableStorage: ElectronSafeStoragePortV2 = Object.freeze({
  isEncryptionAvailable: () => false,
  getSelectedStorageBackend: () => "basic_text",
  encryptString: () => { throw new Error("unavailable") },
  decryptString: () => { throw new Error("unavailable") },
})
