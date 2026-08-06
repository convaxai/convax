import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createWebCryptoEd25519Verifier, parseProjectId } from "@convax/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST } from "@convax/project"
import {
  NodeProjectCollaborationRecoveryService,
  ProjectBlobReplicationStore,
  readProjectNativeStoreManifest,
  readProjectResetRecords,
} from "@convax/project/node"

import { loadHistoricalTestAuthority } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVault, type ElectronSafeStoragePort } from "./electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthority } from "./local-project-owner-authority"
import { LocalProjectResetAuthority } from "./local-project-reset-authority"
import {
  initializeLocalOwnerProjectIndexNativeStore,
  verifyPristineLocalOwnerProjectIndexNativeStore,
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
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: fixture.authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
    const records = await readProjectResetRecords(collaboration)
    expect(records.manifest.state).toBe("reset-published")
    expect(records.manifest.oldProjectEpoch).toBeNull()
    expect(records.manifest.newProjectEpoch).toBe(native.projectIndexScope.projectEpoch)
    expect(records.manifest.newProjectIndexShardEpoch).toBe(native.projectIndexScope.shardEpoch)
    expect(records.manifest.emptyProjectIndexCanonicalStateDigest).toBe(native.emptyProjectIndexCanonicalStateDigest)
    expect(records.confirmation.core.confirmationPrincipal.kind).toBe("local-project-owner")
    expect(records.confirmation.core.ordinaryProjectFilesPreserved).toBeTrue()
    const archive = await onlyMatchingEntry(fixture.projectRoot, ".convax-archive-")
    expect(await fs.readFile(path.join(fixture.projectRoot, archive, "canvases", "catalog.json"))).toEqual(catalogBefore)
    expect(await service.inspectProject("project_test")).toEqual({ status: "current" })
  })

  test("recovers an exact pristine local-owner bootstrap published beside legacy Canvas bytes", async () => {
    const fixture = await createFixture()
    const owner = await fixture.owners.ensureForDurableProject({
      projectId: parseProjectId("project_test"),
      projectRoot: fixture.projectRoot,
    })
    const collaborationDirectory = path.join(fixture.projectRoot, ".convax", "collaboration")
    await initializeLocalOwnerProjectIndexNativeStore({
      authority: fixture.authority,
      collaborationDirectory,
      owner,
      verifyCheckpointSignature: (binding, coreDigest, signature) =>
        fixture.owners.verifyCheckpointSignature(binding, coreDigest, signature),
    })
    await ProjectBlobReplicationStore.open({
      collaborationDirectory,
      projectId: owner.binding.projectId,
      projectEpoch: owner.binding.projectEpoch,
      protocolDigest: fixture.authority.protocolDigest,
    })
    await verifyPristineLocalOwnerProjectIndexNativeStore({
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

  test("resets a retired local protocol tree with a fresh epoch and archives every old byte", async () => {
    const fixture = await createFixture()
    const previous = await fixture.owners.ensureForDurableProject({
      projectId: parseProjectId("project_test"),
      projectRoot: fixture.projectRoot,
    })
    const collaborationDirectory = path.join(fixture.projectRoot, ".convax", "collaboration")
    await initializeLocalOwnerProjectIndexNativeStore({
      authority: fixture.authority,
      collaborationDirectory,
      owner: previous,
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
    const retiredFrame = path.join(frames, `${"c".repeat(64)}.bin`)
    await fs.writeFile(retiredFrame, Buffer.from("CVXCOLL3-retired-frame"))
    await fs.mkdir(path.join(fixture.projectRoot, ".convax", "protocol-v3"))
    await fs.writeFile(path.join(fixture.projectRoot, ".convax", "protocol-v3", "active.jcs"), "retired-active")
    await fs.writeFile(path.join(fixture.projectRoot, ".convax", "local-owner-authority-v3.jcs"), "retired-owner")
    const frameBefore = await fs.readFile(retiredFrame)
    const service = new NodeProjectCollaborationRecoveryService({
      authority: fixture.resets,
      gate: { async runClosed({ operation }) { return operation() } },
      projects: { async resolveProjectRoot() { return fixture.projectRoot } },
    })

    expect(await service.inspectProject("project_test")).toMatchObject({
      status: "unsupported-project-data",
      unsupportedPaths: expect.arrayContaining([".convax/protocol-v3"]),
    })
    const preview = await service.previewReset("project_test")
    expect(await service.confirmReset({ projectId: "project_test", token: preview.token })).toEqual({
      projectId: "project_test",
      status: "published",
    })
    const current = await readProjectNativeStoreManifest(path.join(fixture.projectRoot, ".convax", "collaboration"), {
      protocolDigest: fixture.authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: fixture.authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
    expect(current.projectIndexScope.projectEpoch).not.toBe(previous.binding.projectEpoch)
    const archive = await onlyMatchingEntry(fixture.projectRoot, ".convax-archive-")
    const archivedFrames = path.join(
      fixture.projectRoot,
      archive,
      "collaboration",
      "documents",
      await onlyEntry(path.join(fixture.projectRoot, archive, "collaboration", "documents")),
      "objects",
      "frames",
      path.basename(retiredFrame),
    )
    expect(await fs.readFile(archivedFrames)).toEqual(frameBefore)
    expect(await fs.readFile(path.join(fixture.projectRoot, archive, "protocol-v3", "active.jcs"), "utf8")).toBe(
      "retired-active",
    )
    expect(await service.inspectProject("project_test")).toEqual({ status: "current" })
  })

  test("refuses every local reset when the durable Team record is ambiguous", async () => {
    const fixture = await createFixture({ teamStatus: "rejected" })
    const legacyCatalog = path.join(fixture.projectRoot, ".convax", "canvases", "catalog.json")
    const before = await fs.readFile(legacyCatalog)
    const service = new NodeProjectCollaborationRecoveryService({
      authority: fixture.resets,
      gate: { async runClosed({ operation }) { return operation() } },
      projects: { async resolveProjectRoot() { return fixture.projectRoot } },
    })

    await expect(service.previewReset("project_test")).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(legacyCatalog)).toEqual(before)
  })

  test("refuses local reset when the Project tree retains Team authority evidence", async () => {
    const fixture = await createFixture()
    const teamEvidence = path.join(fixture.projectRoot, ".convax", "team", "membership.jcs")
    await fs.mkdir(path.dirname(teamEvidence))
    await fs.writeFile(teamEvidence, "retained-team-evidence")
    const service = new NodeProjectCollaborationRecoveryService({
      authority: fixture.resets,
      gate: { async runClosed({ operation }) { return operation() } },
      projects: { async resolveProjectRoot() { return fixture.projectRoot } },
    })

    await expect(service.previewReset("project_test")).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(teamEvidence, "utf8")).toBe("retained-team-evidence")
  })

  test("resets arbitrary unsupported local collaboration bytes without decoding them", async () => {
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

    const before = await fs.readFile(path.join(collaboration, "legacy-membership.bin"))
    const preview = await service.previewReset("project_test")
    expect(await service.confirmReset({ projectId: "project_test", token: preview.token })).toEqual({
      projectId: "project_test",
      status: "published",
    })
    const archive = await onlyMatchingEntry(fixture.projectRoot, ".convax-archive-")
    expect(await fs.readFile(path.join(fixture.projectRoot, archive, "collaboration", "legacy-membership.bin")))
      .toEqual(before)
  })

  test("resets a local Project after collaboration frames appear and activates a fresh owner", async () => {
    const fixture = await createFixture()
    const owner = await fixture.owners.ensureForDurableProject({
      projectId: parseProjectId("project_test"),
      projectRoot: fixture.projectRoot,
    })
    const collaborationDirectory = path.join(fixture.projectRoot, ".convax", "collaboration")
    await initializeLocalOwnerProjectIndexNativeStore({
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

    const preview = await service.previewReset("project_test")
    expect(await service.confirmReset({ projectId: "project_test", token: preview.token })).toEqual({
      projectId: "project_test",
      status: "published",
    })
    const current = await readProjectNativeStoreManifest(path.join(fixture.projectRoot, ".convax", "collaboration"), {
      protocolDigest: fixture.authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: fixture.authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
    expect(current.projectIndexScope.projectEpoch).not.toBe(owner.binding.projectEpoch)
    const archive = await onlyMatchingEntry(fixture.projectRoot, ".convax-archive-")
    const archivedFrame = path.join(
      fixture.projectRoot,
      archive,
      "collaboration",
      "documents",
      await onlyEntry(path.join(fixture.projectRoot, archive, "collaboration", "documents")),
      "objects",
      "frames",
      `${"a".repeat(64)}.bin`,
    )
    expect(await fs.readFile(archivedFrame)).toEqual(before)
  })
})

async function onlyEntry(directory: string): Promise<string> {
  const entries = await fs.readdir(directory)
  if (entries.length !== 1 || !entries[0]) throw new Error("expected one entry")
  return entries[0]
}

async function onlyMatchingEntry(directory: string, prefix: string): Promise<string> {
  const entries = (await fs.readdir(directory)).filter((entry) => entry.startsWith(prefix))
  if (entries.length !== 1 || !entries[0]) throw new Error(`expected one ${prefix} entry`)
  return entries[0]
}

async function createFixture(options: { teamStatus?: "missing" | "rejected" } = {}) {
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
  const authority = await loadHistoricalTestAuthority()
  const projectId = parseProjectId("project_test")
  const vault = new ElectronReplicaSigningVault(path.join(userData, "vault"), availableStorage)
  const owners = new NodeDurableLocalProjectOwnerAuthority({
    rootDirectory: path.join(userData, "local-project-owner"),
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
  })
  const teams = {
    async open() {
      return options.teamStatus ?? "missing" as const
    },
  }
  return {
    authority,
    owners,
    projectRoot,
    resets: new LocalProjectResetAuthority({ authority, owners, teams }),
  }
}

const availableStorage: ElectronSafeStoragePort = Object.freeze({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "keychain",
  encryptString: (value: string) => Buffer.from(value, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8"),
})
