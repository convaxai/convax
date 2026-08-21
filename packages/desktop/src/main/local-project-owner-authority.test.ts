import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  createWebCryptoEd25519Verifier,
  ordinarySha256,
  parseCanvasId,
  parseId128,
  parseProjectId,
  parseReplicaId,
} from "@convax/collaboration"
import { buildCanvasGenesisProofCarrier } from "@convax/canvas/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST } from "@convax/project"

import { loadHistoricalTestAuthority } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthority } from "./local-project-owner-authority"
import { createMainCanvasOwnerRuntime } from "./main-canvas-collaboration-composition"
import { createCanvasDocumentGenesisAuthority } from "./canvas-document-genesis"
import { createLocalProjectOwnerCanvasGenesisAuthority } from "./local-project-owner-canvas-genesis"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("durable local Project owner authority", () => {
  test("resumes the same claim after a crash and opens the exact user-managed binding", async () => {
    const fixture = await createFixture()
    let crash = true
    const first = fixture.owner({
      afterClaimFsync: async () => {
        if (crash) {
          crash = false
          throw new Error("crash-after-claim")
        }
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
    await expect(
      fixture.owner().ensureForDurableProject({
        ...fixture.input,
        projectRoot: await fs.mkdtemp(path.join(os.tmpdir(), "convax-owner-wrong-root-")),
      }),
    ).rejects.toThrow("durable Project binding")

    const accepted = await fixture.owner().ensureForDurableProject(fixture.input)
    const bindingDirectory = path.join(fixture.userData, "owners", "bindings")
    const [name] = await fs.readdir(bindingDirectory)
    const target = path.join(bindingDirectory, name!)
    const bytes = await fs.readFile(target)
    bytes[bytes.length - 1] ^= 1
    await fs.writeFile(target, bytes)
    expect(
      await fixture.owner().resolveCurrent({
        projectId: accepted.binding.projectId,
        projectEpoch: accepted.binding.projectEpoch,
      }),
    ).toBe("rejected")
  })

  test("rotates a missing local key without changing the Project epoch or historical binding", async () => {
    const fixture = await createFixture()
    const previous = await fixture.owner().ensureForDurableProject(fixture.input)
    const message = Buffer.alloc(32, 19)
    const previousSignature = await previous.signer.sign(message)
    const [keyEntry] = await fs.readdir(fixture.keyRoot)
    await fs.unlink(path.join(fixture.keyRoot, keyEntry!))

    const legacyRoot = path.join(fixture.userData, "replica-vault")
    const legacyPath = path.join(legacyRoot, `${"c".repeat(64)}.vault`)
    const legacyCiphertext = Buffer.from("legacy-safe-storage-ciphertext")
    await fs.mkdir(legacyRoot, { recursive: true })
    await fs.writeFile(legacyPath, legacyCiphertext, { mode: 0o600 })
    await fs.rm(path.join(fixture.userData, "owners", "rotation-claims"), { recursive: true })
    await fs.rm(path.join(fixture.userData, "owners", "rotation-bindings"), { recursive: true })

    const rotated = await fixture.owner().resolveCurrent({
      projectId: previous.binding.projectId,
      projectEpoch: previous.binding.projectEpoch,
    })
    expect(rotated).not.toBe("missing")
    expect(rotated).not.toBe("rejected")
    if (rotated === "missing" || rotated === "rejected") throw new Error("rotation did not produce a current owner")
    const current = rotated
    expect(current.binding.projectId).toBe(previous.binding.projectId)
    expect(current.binding.projectEpoch).toBe(previous.binding.projectEpoch)
    expect(current.binding.projectIndexShardEpoch).toBe(previous.binding.projectIndexShardEpoch)
    expect(current.binding.memberId).toBe(previous.binding.memberId)
    expect(current.binding.genesisOperationId).toBe(previous.binding.genesisOperationId)
    expect(current.binding.genesisCheckpointId).toBe(previous.binding.genesisCheckpointId)
    expect(current.binding.replicaId).not.toBe(previous.binding.replicaId)
    expect(current.binding.actorId).not.toBe(previous.binding.actorId)
    expect(current.binding.bindingDigest).not.toBe(previous.binding.bindingDigest)
    await expect(
      fixture.owner().resolveBindingExact({
        projectId: previous.binding.projectId,
        projectEpoch: previous.binding.projectEpoch,
        ownerBindingDigest: previous.binding.bindingDigest,
      }),
    ).resolves.toMatchObject({ binding: previous.binding })
    expect(await fixture.owner().verifySignature(previous.binding, message, previousSignature)).toBeTrue()
    expect(await fs.readFile(legacyPath)).toEqual(legacyCiphertext)
    expect((await fixture.owner().ensureForDurableProject(fixture.input)).binding).toEqual(current.binding)
  })

  test("retries key rotation exactly after crashes around current-binding publication", async () => {
    for (const faultName of ["afterRetiredBindingFsync", "afterCurrentBindingFsync"] as const) {
      const fixture = await createFixture()
      const previous = await fixture.owner().ensureForDurableProject(fixture.input)
      const [keyEntry] = await fs.readdir(fixture.keyRoot)
      await fs.unlink(path.join(fixture.keyRoot, keyEntry!))
      let crash = true
      await expect(
        fixture
          .owner({
            [faultName]: async () => {
              if (crash) {
                crash = false
                throw new Error(`crash-${faultName}`)
              }
            },
          })
          .ensureForDurableProject(fixture.input),
      ).rejects.toThrow(`crash-${faultName}`)

      const recovered = await fixture.owner().ensureForDurableProject(fixture.input)
      expect(recovered.binding.projectEpoch).toBe(previous.binding.projectEpoch)
      expect(recovered.binding.replicaId).not.toBe(previous.binding.replicaId)
      expect(
        await fixture.owner().resolveBindingExact({
          projectId: previous.binding.projectId,
          projectEpoch: previous.binding.projectEpoch,
          ownerBindingDigest: previous.binding.bindingDigest,
        }),
      ).not.toBe("missing")
    }
  })

  test("keeps a reset binding inert until activation and then retires the prior binding", async () => {
    const fixture = await createFixture()
    const authority = fixture.owner()
    const previous = await authority.ensureForDurableProject(fixture.input)
    const prepared = await authority.prepareResetForDurableProject({
      ...fixture.input,
      resetId: `reset-host-${"a".repeat(64)}`,
    })

    expect(prepared.owner.binding.projectEpoch).not.toBe(previous.binding.projectEpoch)
    expect(
      await authority.resolveCurrent({
        projectId: prepared.owner.binding.projectId,
        projectEpoch: prepared.owner.binding.projectEpoch,
      }),
    ).toBe("rejected")
    const message = Buffer.alloc(32, 7)
    const signature = await prepared.owner.signer.sign(message)
    expect(await authority.verifyPreparedSignature(prepared, message, signature)).toBeTrue()

    await authority.activatePreparedReset(prepared)
    await expect(
      authority.resolveCurrent({
        projectId: prepared.owner.binding.projectId,
        projectEpoch: prepared.owner.binding.projectEpoch,
      }),
    ).resolves.toMatchObject({ binding: prepared.owner.binding })
    expect(
      await authority.resolveCurrent({
        projectId: previous.binding.projectId,
        projectEpoch: previous.binding.projectEpoch,
      }),
    ).toBe("rejected")
    await expect(
      authority.resolveBindingExact({
        projectId: previous.binding.projectId,
        projectEpoch: previous.binding.projectEpoch,
        ownerBindingDigest: previous.binding.bindingDigest,
      }),
    ).resolves.toMatchObject({ binding: previous.binding })
    expect(await fs.readdir(path.join(fixture.userData, "owners", "retired-bindings"))).toEqual([
      `${previous.binding.bindingDigest}.jcs`,
    ])
    expect((await authority.ensureForDurableProject(fixture.input)).binding).toEqual(prepared.owner.binding)
  })

  test("builds and verifies Canvas genesis directly from the unshared local owner", async () => {
    const fixture = await createFixture()
    const ownerAuthority = fixture.owner()
    const owner = await ownerAuthority.ensureForDurableProject(fixture.input)
    const provider = createLocalProjectOwnerCanvasGenesisAuthority({
      authority: fixture.authority,
      async resolveOwner({ projectId, projectEpoch }) {
        return ownerAuthority.resolveCurrent({
          projectId,
          projectEpoch,
        })
      },
    })
    const runtime = createMainCanvasOwnerRuntime(fixture.authority)
    const genesis = createCanvasDocumentGenesisAuthority({
      authority: fixture.authority,
      runtime,
      historicalAuthorVerifier: provider.historicalAuthorVerifier,
      authorProvider: provider.authorProvider,
    })
    const scope = Object.freeze({
      projectId: owner.binding.projectId,
      projectEpoch: owner.binding.projectEpoch,
      docKind: "canvas" as const,
      docId: parseCanvasId(`cv_${ordinarySha256(new TextEncoder().encode("local-canvas"))}`),
      shardEpoch: parseId128(Buffer.alloc(16, 44).toString("base64url")),
    })
    expect(
      await provider.authorProvider.preflight({
        projectId: scope.projectId,
        projectEpoch: scope.projectEpoch,
      }),
    ).toBe("ready")
    const prepared = await provider.authorProvider.prepareAuthor({
      scope,
      projectIndexRouteDependencyFrameDigest: ordinarySha256(new TextEncoder().encode("route")),
    })
    if (prepared.status !== "prepared") throw new Error("local Canvas author was not prepared")
    const built = await buildCanvasGenesisProofCarrier({
      authority: fixture.authority,
      runtime,
      verifier: genesis.proofVerifier,
      scope,
      projectIndexRouteDependencyFrameDigest: ordinarySha256(new TextEncoder().encode("route")),
      author: prepared.author,
    })
    expect(built.status).toBe("built")
    if (built.status === "built") expect(genesis.proofVerifier(built.proofCarrierExactBytes).status).toBe("validated")
  })
})

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-local-owner-"))
  roots.push(root)
  const userData = path.join(root, "user-data")
  const projectRoot = path.join(root, "project")
  await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
  const authority = await loadHistoricalTestAuthority()
  const projectId = parseProjectId("project-local-owner")
  const keyRoot = path.join(userData, "replica-keys")
  const vault = new ElectronReplicaSigningVault(keyRoot)
  let idByte = 1
  let replica = 1
  return {
    authority,
    userData,
    keyRoot,
    input: { projectId, projectRoot },
    owner: (faults?: ConstructorParameters<typeof NodeDurableLocalProjectOwnerAuthority>[0]["faults"]) =>
      new NodeDurableLocalProjectOwnerAuthority({
        rootDirectory: path.join(userData, "owners"),
        authority,
        schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
        projects: {
          async resolveProjectRoot({ projectId: requested }) {
            if (requested !== projectId) throw new Error("unknown Project")
            return projectRoot
          },
        },
        vault,
        verifier: createWebCryptoEd25519Verifier(),
        createId: () => parseId128(Buffer.alloc(16, idByte++).toString("base64url")),
        createReplicaId: () => parseReplicaId(`replica_${(replica++).toString(16).padStart(8, "0")}`),
        ...(faults ? { faults } : {}),
      }),
  }
}
