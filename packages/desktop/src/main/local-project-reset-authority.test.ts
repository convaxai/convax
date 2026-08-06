import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createWebCryptoEd25519Verifier, parseProjectId } from "@convax/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/project"
import {
  NodeProjectCollaborationRecoveryService,
  ProjectBlobReplicationStoreV2,
  readProjectNativeStoreManifest,
  readProjectResetRecordsV2,
} from "@convax/project/node"

import { loadHistoricalTestAuthorityV2 } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVaultV2, type ElectronSafeStoragePortV2 } from "./electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthorityV2 } from "./local-project-owner-authority"
import { LocalProjectResetAuthorityV2 } from "./local-project-reset-authority"
import {
  initializeLocalOwnerProjectIndexNativeStoreV2,
  verifyPristineLocalOwnerProjectIndexNativeStoreV2,
} from "./main-project-index-runtime-registry"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("local Project reset authority", () => {
  test("publishes an exact signed unteamed reset and preserves ordinary Project files", async () => {
    const fixture = await createFixture()
    const service = new NodeProjectCollaborationRecoveryService({
      authority: fixture.resets,
      gate: {
        async runClosed({ operation }) {
          return operation()
        },
      },
      projects: {
        async resolveProjectRoot(projectId) {
          if (projectId !== "project_test") throw new Error("unknown Project")
          return fixture.projectRoot
        },
      },
    })
    const legacyCatalog = path.join(fixture.projectRoot, ".convax", "canvases", "catalog.json")
    const catalogBefore = await fs.readFile(legacyCatalog)
    expect(await service.inspectProject("project_test")).toMatchObject({
      status: "unsupported-project-data",
    })
    expect(await fs.readFile(legacyCatalog)).toEqual(catalogBefore)
    const preview = await service.previewReset("project_test")
    expect(preview.ordinaryProjectFilesPreserved).toBeTrue()
    expect(preview.preview.some((entry) => entry.path.includes("Notes"))).toBeFalse()
    expect(preview.preview.map((entry) => entry.path)).toContain(".convax/canvases/catalog.json")
    const result = await service.confirmReset({ projectId: "project_test", token: preview.token })
    expect(result).toEqual({ projectId: "project_test", status: "published" })
    expect(await fs.readFile(path.join(fixture.projectRoot, "Notes", "keep.md"), "utf8")).toBe("keep")
    await expect(fs.access(path.join(fixture.projectRoot, ".convax", "canvases"))).rejects.toThrow()

    const collaboration = path.join(fixture.projectRoot, ".convax", "collaboration")
    const native = await readProjectNativeStoreManifest(collaboration, {
      protocolDigest: fixture.authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
      uriProtocolDigest: fixture.authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
    const records = await readProjectResetRecordsV2(collaboration)
    expect(records.manifest.state).toBe("reset-published")
    expect(records.manifest.oldProjectEpoch).toBeNull()
    expect(records.manifest.newProjectEpoch).toBe(native.projectIndexScope.projectEpoch)
    expect(records.manifest.newProjectIndexShardEpoch).toBe(native.projectIndexScope.shardEpoch)
    expect(records.manifest.emptyProjectIndexCanonicalStateDigest).toBe(native.emptyProjectIndexCanonicalStateDigest)
    expect(records.confirmation.core.confirmationPrincipal.kind).toBe("local-project-owner")
    expect(records.confirmation.core.ordinaryProjectFilesPreserved).toBeTrue()
    expect(await service.inspectProject("project_test")).toEqual({ status: "current" })
  })

  test("recovers an exact pristine local-owner bootstrap published beside legacy Canvas bytes", async () => {
    const fixture = await createFixture()
    const owner = await fixture.owners.ensureForDurableProject({
      projectId: parseProjectId("project_test"),
      projectRoot: fixture.projectRoot,
    })
    const collaborationDirectory = path.join(fixture.projectRoot, ".convax", "collaboration")
    await initializeLocalOwnerProjectIndexNativeStoreV2({
      authority: fixture.authority,
      collaborationDirectory,
      owner,
      verifyCheckpointSignature: (binding, coreDigest, signature) =>
        fixture.owners.verifyCheckpointSignature(binding, coreDigest, signature),
    })
    await ProjectBlobReplicationStoreV2.open({
      collaborationDirectory,
      projectId: owner.binding.projectId,
      projectEpoch: owner.binding.projectEpoch,
      protocolDigest: fixture.authority.protocolDigest,
    })
    await verifyPristineLocalOwnerProjectIndexNativeStoreV2({
      authority: fixture.authority,
      collaborationDirectory,
      owner,
      verifyCheckpointSignature: (binding, coreDigest, signature) =>
        fixture.owners.verifyCheckpointSignature(binding, coreDigest, signature),
    })
    const service = new NodeProjectCollaborationRecoveryService({
      authority: fixture.resets,
      gate: {
        async runClosed({ operation }) {
          return operation()
        },
      },
      projects: {
        async resolveProjectRoot() {
          return fixture.projectRoot
        },
      },
    })

    const preview = await service.previewReset("project_test")
    expect(preview.preview.map((entry) => entry.path)).toContain(".convax/collaboration/manifest-v2.bin")
    expect(await service.confirmReset({ projectId: "project_test", token: preview.token })).toEqual({
      projectId: "project_test",
      status: "published",
    })
    expect(await fs.readFile(path.join(fixture.projectRoot, "Notes", "keep.md"), "utf8")).toBe("keep")
  })

  test("refuses local authority during preview when collaboration state is not the exact pristine bootstrap", async () => {
    const fixture = await createFixture()
    const collaboration = path.join(fixture.projectRoot, ".convax", "collaboration")
    await fs.mkdir(collaboration)
    await fs.writeFile(path.join(collaboration, "legacy-membership.bin"), "team-evidence")
    const service = new NodeProjectCollaborationRecoveryService({
      authority: fixture.resets,
      gate: {
        async runClosed({ operation }) {
          return operation()
        },
      },
      projects: {
        async resolveProjectRoot() {
          return fixture.projectRoot
        },
      },
    })

    await expect(service.previewReset("project_test")).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readdir(collaboration)).toEqual(["legacy-membership.bin"])
  })

  test("rejects a formerly pristine bootstrap after any collaboration state appears", async () => {
    const fixture = await createFixture()
    const owner = await fixture.owners.ensureForDurableProject({
      projectId: parseProjectId("project_test"),
      projectRoot: fixture.projectRoot,
    })
    const collaborationDirectory = path.join(fixture.projectRoot, ".convax", "collaboration")
    await initializeLocalOwnerProjectIndexNativeStoreV2({
      authority: fixture.authority,
      collaborationDirectory,
      owner,
      verifyCheckpointSignature: (binding, coreDigest, signature) =>
        fixture.owners.verifyCheckpointSignature(binding, coreDigest, signature),
    })
    const frames = path.join(
      collaborationDirectory,
      "documents",
      await onlyEntry(path.join(collaborationDirectory, "documents")),
      "objects",
      "frames",
    )
    await fs.writeFile(path.join(frames, `${"a".repeat(64)}.bin`), "accepted-state")
    const before = await fs.readFile(path.join(frames, `${"a".repeat(64)}.bin`))
    const service = new NodeProjectCollaborationRecoveryService({
      authority: fixture.resets,
      gate: {
        async runClosed({ operation }) {
          return operation()
        },
      },
      projects: {
        async resolveProjectRoot() {
          return fixture.projectRoot
        },
      },
    })

    await expect(service.previewReset("project_test")).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(path.join(frames, `${"a".repeat(64)}.bin`))).toEqual(before)
  })
})

async function onlyEntry(directory: string): Promise<string> {
  const entries = await fs.readdir(directory)
  if (entries.length !== 1 || !entries[0]) throw new Error("expected one entry")
  return entries[0]
}

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-local-reset-"))
  roots.push(root)
  const projectRoot = path.join(root, "project")
  const userData = path.join(root, "user-data")
  await fs.mkdir(path.join(projectRoot, ".convax", "canvases", "canvas-main"), { recursive: true })
  await fs.mkdir(path.join(projectRoot, "Notes"))
  await fs.writeFile(
    path.join(projectRoot, ".convax", "project.json"),
    JSON.stringify({ projectId: "project_test", schemaVersion: "convax.project/1" }),
  )
  await fs.writeFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "catalog")
  await fs.writeFile(path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"), "document")
  await fs.writeFile(path.join(projectRoot, "Notes", "keep.md"), "keep")
  const authority = await loadHistoricalTestAuthorityV2()
  const projectId = parseProjectId("project_test")
  const vault = new ElectronReplicaSigningVaultV2(path.join(userData, "vault"), availableStorage)
  const owners = new NodeDurableLocalProjectOwnerAuthorityV2({
    rootDirectory: path.join(userData, "local-project-owner"),
    authority,
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    projects: {
      async resolveProjectRoot({ projectId: requested }) {
        if (requested !== projectId) throw new Error("unknown Project")
        return projectRoot
      },
    },
    vault,
    verifier: createWebCryptoEd25519Verifier(),
  })
  return {
    authority,
    owners,
    projectRoot,
    resets: new LocalProjectResetAuthorityV2({ authority, owners }),
  }
}

const availableStorage: ElectronSafeStoragePortV2 = Object.freeze({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) => Buffer.from(value, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8"),
})
