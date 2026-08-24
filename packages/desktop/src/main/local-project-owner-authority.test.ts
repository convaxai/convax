import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  createWebCryptoEd25519Verifier,
  encodeRestrictedJcs,
  ordinarySha256,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseValidationArtifactSet,
  structuredDigest,
  type Digest,
} from "@convax/collaboration"
import { IMMEDIATE_PREDECESSOR_PROTOCOL } from "@convax/collaboration/migration"
import { buildCanvasGenesisProofCarrier } from "@convax/canvas/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST } from "@convax/project"

import { loadHistoricalTestAuthority } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"
import {
  NodeDurableLocalProjectOwnerAuthority,
  type DurableLocalProjectOwnerBinding,
} from "./local-project-owner-authority"
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
    const authority = fixture.owner()
    const changes: string[] = []
    authority.subscribeCurrentChange((change) => changes.push(change.bindingDigest))
    const previous = await authority.ensureForDurableProject(fixture.input)
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

    const rotated = await authority.resolveCurrent({
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
    expect(changes).toEqual([current.binding.bindingDigest])
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

  test("inspects missing and corrupt predecessor authority without creating owner storage", async () => {
    const missing = await createFixture()
    const missingBefore = await snapshotTree(missing.userData)
    expect(
      await missing.owner().inspectImmediatePredecessorMigrationAuthority({
        ...missing.input,
        projectEpoch: fixedId(21),
        projectIndexShardEpoch: fixedId(22),
        initializationAuthorityDigest: ordinarySha256(new TextEncoder().encode("missing-predecessor")),
      }),
    ).toBe("missing")
    expect(await snapshotTree(missing.userData)).toEqual(missingBefore)

    const corrupt = await createFixture()
    const target = predecessorBindingTarget(corrupt)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, "not-a-canonical-owner-binding")
    const corruptBefore = await snapshotTree(corrupt.userData)
    expect(
      await corrupt.owner().inspectImmediatePredecessorMigrationAuthority({
        ...corrupt.input,
        projectEpoch: fixedId(23),
        projectIndexShardEpoch: fixedId(24),
        initializationAuthorityDigest: ordinarySha256(new TextEncoder().encode("corrupt-predecessor")),
      }),
    ).toBe("rejected")
    expect(await snapshotTree(corrupt.userData)).toEqual(corruptBefore)
  })

  test("verified predecessor inspection is read-only and does not publish the current binding", async () => {
    const fixture = await createFixture()
    const predecessor = await installImmediatePredecessorOwner(fixture)
    const before = await snapshotTree(fixture.userData)

    const prepared = await fixture.owner().inspectImmediatePredecessorMigrationAuthority({
      ...fixture.input,
      projectEpoch: predecessor.projectEpoch,
      projectIndexShardEpoch: predecessor.projectIndexShardEpoch,
      initializationAuthorityDigest: predecessor.bindingDigest,
    })

    expect(prepared).not.toBe("missing")
    expect(prepared).not.toBe("rejected")
    expect(await snapshotTree(fixture.userData)).toEqual(before)
    expect(await exists(currentBindingTarget(fixture))).toBeFalse()
  })

  test("activation publishes the inspected epoch and shard with a retry-stable closure-bound operation", async () => {
    const fixture = await createFixture()
    const predecessor = await installImmediatePredecessorOwner(fixture)
    const authority = fixture.owner()
    const prepared = await authority.inspectImmediatePredecessorMigrationAuthority({
      ...fixture.input,
      projectEpoch: predecessor.projectEpoch,
      projectIndexShardEpoch: predecessor.projectIndexShardEpoch,
      initializationAuthorityDigest: predecessor.bindingDigest,
    })
    if (prepared === "missing" || prepared === "rejected") throw new Error("predecessor inspection failed")
    const closure = ordinarySha256(new TextEncoder().encode("verified-source-closure-a"))

    const first = await authority.activateImmediatePredecessorMigrationAuthority(prepared, closure)
    const retry = await authority.activateImmediatePredecessorMigrationAuthority(prepared, closure)
    const restartedAuthority = fixture.owner()
    const resumedPreparation = await restartedAuthority.inspectImmediatePredecessorMigrationAuthority({
      ...fixture.input,
      projectEpoch: predecessor.projectEpoch,
      projectIndexShardEpoch: predecessor.projectIndexShardEpoch,
      initializationAuthorityDigest: predecessor.bindingDigest,
    })
    if (resumedPreparation === "missing" || resumedPreparation === "rejected") {
      throw new Error("published current authority did not resume its predecessor migration")
    }
    const resumed = await restartedAuthority.activateImmediatePredecessorMigrationAuthority(
      resumedPreparation,
      closure,
    )

    expect(first.currentOwner.binding.projectEpoch).toBe(predecessor.projectEpoch)
    expect(first.currentOwner.binding.projectIndexShardEpoch).toBe(predecessor.projectIndexShardEpoch)
    expect(first.currentOwner.binding.memberId).toBe(predecessor.memberId)
    expect(first.currentOwner.binding.protocolDigest).toBe(fixture.authority.protocolDigest)
    expect(first.currentOwner.binding.actorId).not.toBe(predecessor.actorId)
    expect(first.currentOwner.binding.replicaId).not.toBe(predecessor.replicaId)
    expect(retry.currentOwner.binding).toEqual(first.currentOwner.binding)
    expect(retry.migrationOperationId).toBe(first.migrationOperationId)
    expect(resumed.currentOwner.binding).toEqual(first.currentOwner.binding)
    expect(resumed.migrationOperationId).toBe(first.migrationOperationId)
    expect(await exists(currentBindingTarget(fixture))).toBeTrue()
    expect(await fs.readFile(predecessorLegacyVaultTarget(fixture, predecessor))).toEqual(
      Buffer.from("legacy-safe-storage-ciphertext"),
    )
    expect(await exists(path.join(
      fixture.userData,
      "owners",
      "retired-bindings",
      `${predecessor.bindingDigest}.jcs`,
    ))).toBeTrue()
  })

  test("rejects foreign predecessor preparations and malformed closure digests before publication", async () => {
    const fixture = await createFixture()
    const predecessor = await installImmediatePredecessorOwner(fixture)
    const authority = fixture.owner()
    const prepared = await authority.inspectImmediatePredecessorMigrationAuthority({
      ...fixture.input,
      projectEpoch: predecessor.projectEpoch,
      projectIndexShardEpoch: predecessor.projectIndexShardEpoch,
      initializationAuthorityDigest: predecessor.bindingDigest,
    })
    if (prepared === "missing" || prepared === "rejected") throw new Error("predecessor inspection failed")

    await expect(
      fixture.owner().activateImmediatePredecessorMigrationAuthority(
        prepared,
        ordinarySha256(new TextEncoder().encode("foreign-source-closure")),
      ),
    ).rejects.toThrow("not owned by this resolver")
    await expect(
      authority.activateImmediatePredecessorMigrationAuthority(prepared, "not-a-digest" as Digest),
    ).rejects.toThrow()
    expect(await exists(currentBindingTarget(fixture))).toBeFalse()
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
    vault,
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

type LocalOwnerFixture = Awaited<ReturnType<typeof createFixture>>

async function installImmediatePredecessorOwner(
  fixture: LocalOwnerFixture,
): Promise<DurableLocalProjectOwnerBinding> {
  const projectEpoch = fixedId(31)
  const projectIndexShardEpoch = fixedId(32)
  const memberId = parseMemberId(fixedId(33))
  const replicaId = parseReplicaId("replica_8295cafe")
  const legacyKeySource = new ElectronReplicaSigningVault(path.join(fixture.userData, "legacy-key-source"))
  const key = await legacyKeySource.createReplicaKey({
    projectId: fixture.input.projectId,
    projectEpoch,
    replicaId,
  })
  const bindingWithoutDigest = Object.freeze({
    format: "convax.desktop-local-project-owner-binding" as const,
    projectId: fixture.input.projectId,
    projectEpoch,
    projectIndexShardEpoch,
    memberId,
    replicaId,
    localConfirmationKeyId: `local-owner-${fixture.input.projectId}`,
    genesisOperationId: fixedId(34),
    genesisCheckpointId: fixedId(35),
    protocolDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest,
    schemaDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest,
    uriProtocolDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.uriProtocolDigest,
    validationArtifactSetDigest: immediatePredecessorValidationArtifactSetDigest(),
    actorId: parseActorId(key.publicKey),
    publicKey: key.publicKey,
  })
  const binding: DurableLocalProjectOwnerBinding = Object.freeze({
    ...bindingWithoutDigest,
    bindingDigest: ordinarySha256(encodeRestrictedJcs(bindingWithoutDigest)),
  })
  const target = predecessorBindingTarget(fixture)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, encodeRestrictedJcs(binding), { mode: 0o600 })
  const legacyVault = predecessorLegacyVaultTarget(fixture, binding)
  await fs.mkdir(path.dirname(legacyVault), { recursive: true })
  await fs.writeFile(legacyVault, Buffer.from("legacy-safe-storage-ciphertext"), { mode: 0o600 })
  return binding
}

function predecessorLegacyVaultTarget(
  fixture: LocalOwnerFixture,
  binding: Pick<DurableLocalProjectOwnerBinding, "projectId" | "projectEpoch" | "replicaId">,
): string {
  const selector = structuredDigest("convax.desktop-replica-vault-native-key", {
    projectId: binding.projectId,
    projectEpoch: binding.projectEpoch,
    replicaId: binding.replicaId,
  })
  return path.join(fixture.userData, "replica-vault", `${selector}.vault`)
}

function immediatePredecessorValidationArtifactSetDigest(): Digest {
  const validationArtifacts = parseValidationArtifactSet({
    format: "convax.validation-artifact-set",
    artifacts: [
      {
        owner: "canvas",
        format: "convax.canvas-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest,
      },
      {
        owner: "control-plane",
        format: "convax.control-plane-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.controlPlaneSchemaDigest,
      },
      {
        owner: "kernel",
        format: "convax.collaboration-kernel-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.collaborationKernelSchemaDigest,
      },
      {
        owner: "project-index",
        format: "convax.project-persistence-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest,
      },
    ],
  })
  return structuredDigest("convax.validation-artifact-set", validationArtifacts)
}

function predecessorBindingTarget(fixture: LocalOwnerFixture): string {
  return path.join(
    fixture.userData,
    "owners",
    "bindings",
    `${ownerSelectorDigest(fixture.input.projectId, IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest)}.jcs`,
  )
}

function currentBindingTarget(fixture: LocalOwnerFixture): string {
  return path.join(
    fixture.userData,
    "owners",
    "bindings",
    `${ownerSelectorDigest(fixture.input.projectId, fixture.authority.protocolDigest)}.jcs`,
  )
}

function ownerSelectorDigest(projectId: string, protocolDigest: Digest): Digest {
  return structuredDigest("convax.desktop-local-project-owner-selector", {
    format: "convax.desktop-local-project-owner-selector",
    projectId,
    protocolDigest,
  })
}

function fixedId(byte: number) {
  return parseId128(Buffer.alloc(16, byte).toString("base64url"))
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function snapshotTree(root: string): Promise<readonly string[]> {
  if (!(await exists(root))) return Object.freeze([])
  const snapshot: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name)
      const relative = path.relative(root, target)
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        snapshot.push(`directory:${relative}`)
        await visit(target)
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        snapshot.push(`file:${relative}:${ordinarySha256(await fs.readFile(target))}`)
      } else {
        snapshot.push(`unsupported:${relative}`)
      }
    }
  }
  await visit(root)
  return Object.freeze(snapshot)
}
