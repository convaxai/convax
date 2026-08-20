import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  createWebCryptoEd25519Verifier,
  encodeBase64url,
  ordinarySha256,
  parseDigest,
  parseId128,
  parseProjectId,
  type Digest,
} from "@convax/collaboration"
import type { ProjectIndexCurrentBlobReferencePort } from "@convax/project"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST } from "@convax/project"
import { NodeProjectManager, ProjectBlobReplicationStore, readProjectNativeStoreManifest } from "@convax/project/node"

import { loadHistoricalTestAuthority } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthority } from "./local-project-owner-authority"
import {
  CollaborationEnrollmentRequiredError,
  createExistingProjectIndexRegistrationPort,
  createLocalProjectOwnerIndexRegistrationPort,
  createMainProjectIndexFileMaterializationScheduler,
  createMainProjectIndexBlobPublicationPort,
  MainProjectIndexRuntimeRegistry,
  queryMainProjectIndexCurrentBlobDigests,
} from "./main-project-index-runtime-registry"

const roots: string[] = []
const nativeDurabilityTest = test.skipIf(process.platform === "win32")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("existing ProjectIndex registration", () => {
  test("an unregistered Project fails closed instead of minting a local owner", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-unregistered-project-"))
    roots.push(projectRoot)
    await fs.mkdir(path.join(projectRoot, ".convax"))
    const authority = await loadHistoricalTestAuthority()
    const registration = createExistingProjectIndexRegistrationPort(authority)

    await expect(
      registration.ensureRegistered({
        projectId: parseProjectId("project-unregistered"),
        projectRoot,
      }),
    ).rejects.toBeInstanceOf(CollaborationEnrollmentRequiredError)
    expect(await fs.readdir(path.join(projectRoot, ".convax"))).toEqual([])
  })

  test("delegates unsupported collaboration gating to Project before local-owner first registration", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-legacy-first-register-"))
    roots.push(projectRoot)
    await fs.mkdir(path.join(projectRoot, ".convax", "canvases"), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, ".convax", "project.json"),
      JSON.stringify({ projectId: "project-legacy-first-register", schemaVersion: "convax.project/1" }),
    )
    await fs.writeFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "legacy")
    const authority = await loadHistoricalTestAuthority()
    let ownerCreated = false
    let projectGateCalled = false
    const unsupported = Object.assign(new Error("unsupported project data"), {
      code: "unsupported-project-data",
    })
    const registration = createLocalProjectOwnerIndexRegistrationPort(
      authority,
      {
        async ensureForDurableProject() {
          ownerCreated = true
          throw new Error("must not create owner")
        },
        async resolveCurrent() {
          return "missing" as const
        },
        async resolveBindingExact() {
          return "missing" as const
        },
        async verifyCheckpointSignature() {
          return false
        },
      },
      {
        async ensureRegisteredProjectPrivateStorage() {
          projectGateCalled = true
          throw unsupported
        },
      },
    )

    await expect(
      registration.ensureRegistered({
        projectId: parseProjectId("project-legacy-first-register"),
        projectRoot,
      }),
    ).rejects.toMatchObject({ code: "unsupported-project-data" })
    expect(ownerCreated).toBeFalse()
    expect(projectGateCalled).toBeTrue()
    await expect(fs.access(path.join(projectRoot, ".convax", "collaboration"))).rejects.toThrow()
  })

  test("runs the Project predecessor gate before the current-only portable-data check", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-predecessor-first-register-"))
    roots.push(projectRoot)
    const retiredCanvasRoot = path.join(projectRoot, ".convax", "canvases")
    await fs.mkdir(retiredCanvasRoot, { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, ".convax", "project.json"),
      JSON.stringify({ projectId: "project-predecessor-first-register", schemaVersion: "convax.project/1" }),
    )
    await fs.writeFile(path.join(retiredCanvasRoot, "catalog.json"), "sealed predecessor")
    const authority = await loadHistoricalTestAuthority()
    const reachedOwner = new Error("reached local owner after migration")
    let projectGateCalled = false
    let ownerCreated = false
    const registration = createLocalProjectOwnerIndexRegistrationPort(
      authority,
      {
        async ensureForDurableProject() {
          ownerCreated = true
          throw reachedOwner
        },
        async resolveCurrent() {
          return "missing" as const
        },
        async resolveBindingExact() {
          return "missing" as const
        },
        async verifyCheckpointSignature() {
          return false
        },
      },
      {
        async ensureRegisteredProjectPrivateStorage() {
          projectGateCalled = true
          await fs.rm(retiredCanvasRoot, { recursive: true })
        },
      },
    )

    await expect(
      registration.ensureRegistered({
        projectId: parseProjectId("project-predecessor-first-register"),
        projectRoot,
      }),
    ).rejects.toBe(reachedOwner)
    expect(projectGateCalled).toBeTrue()
    expect(ownerCreated).toBeTrue()
    await expect(fs.access(retiredCanvasRoot)).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, ".convax", "collaboration"))).rejects.toThrow()
  })

  test("first-registers and exact-retries an empty ProjectIndex from the durable local owner binding", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-first-register-"))
    roots.push(root)
    const projectRoot = path.join(root, "project")
    const userData = path.join(root, "user-data")
    await fs.mkdir(projectRoot, { recursive: true })
    const authority = await loadHistoricalTestAuthority()
    const projects = new NodeProjectManager({ registryFile: path.join(userData, "projects.json") })
    const projectId = parseProjectId((await projects.addProject(projectRoot)).id)
    await fs.rm(path.join(projectRoot, ".convax"), { force: true, recursive: true })
    const vault = new ElectronReplicaSigningVault(path.join(userData, "keys"))
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
    const registration = createLocalProjectOwnerIndexRegistrationPort(authority, owners, projects)
    const first = await registration.ensureRegistered({ projectId, projectRoot })
    const retry = await registration.ensureRegistered({ projectId, projectRoot })
    expect(retry).toEqual(first)

    const manifest = await readProjectNativeStoreManifest(path.join(projectRoot, ".convax", "collaboration"), {
      protocolDigest: authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
    const localOwner = await owners.resolveCurrent({
      projectId,
      projectEpoch: manifest.projectIndexScope.projectEpoch,
    })
    expect(localOwner).not.toBe("missing")
    expect(localOwner).not.toBe("rejected")
    if (localOwner === "missing" || localOwner === "rejected") throw new Error("unreachable")
    expect(localOwner.binding.projectIndexShardEpoch).toBe(manifest.projectIndexScope.shardEpoch)
    expect(JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "project.json"), "utf8"))).toEqual({
      projectId,
      schemaVersion: "convax.project/1",
    })
  })
})

describe("ProjectIndex current blob-reference Main bridge", () => {
  const projectId = parseProjectId("project-blob-references")
  const digest = parseDigest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

  test("propagates an unavailable owner query and never guesses from another projection", async () => {
    const application: ProjectIndexCurrentBlobReferencePort = {
      async queryCurrentResources() {
        return []
      },
      async queryCurrentBlobDigests() {
        throw new Error("ProjectIndex session unavailable")
      },
    }
    await expect(queryMainProjectIndexCurrentBlobDigests(application, { projectId })).rejects.toThrow(
      "session unavailable",
    )
  })

  test("rejects malformed collections and digests before native GC can observe them", async () => {
    await expect(
      queryMainProjectIndexCurrentBlobDigests(
        {
          async queryCurrentResources() {
            return []
          },
          async queryCurrentBlobDigests() {
            return [digest] as never
          },
        },
        { projectId },
      ),
    ).rejects.toThrow("malformed")
    await expect(
      queryMainProjectIndexCurrentBlobDigests(
        {
          async queryCurrentResources() {
            return []
          },
          async queryCurrentBlobDigests() {
            return new Set(["not-a-digest"]) as never
          },
        },
        { projectId },
      ),
    ).rejects.toThrow()
  })

  test("returns a validated defensive set from the Project-owned query", async () => {
    const ownerValues = new Set([digest])
    const result = await queryMainProjectIndexCurrentBlobDigests(
      {
        async queryCurrentResources() {
          return []
        },
        async queryCurrentBlobDigests() {
          return ownerValues as never
        },
      },
      { projectId },
    )
    expect(result).toEqual(ownerValues)
    expect(result).not.toBe(ownerValues)
  })
})

describe("ProjectIndex file materialization scheduling", () => {
  const projectId = parseProjectId("project-materialization-scheduler")
  const firstFrame = parseDigest("1".repeat(64))
  const secondFrame = parseDigest("2".repeat(64))
  const pendingBlob = parseDigest("3".repeat(64))
  const unrelatedBlob = parseDigest("4".repeat(64))

  test("skips the full Project plan only when every accepted frame has exact verified coverage", async () => {
    const consumed: Digest[] = []
    let reconciles = 0
    const scheduler = createMainProjectIndexFileMaterializationScheduler({
      projectId,
      materializer: {
        async consumeAcceptedFrameCoverage(frameDigest) { consumed.push(frameDigest); return true },
        needsPublishedBlob() { return false },
        async reconcile() { reconciles += 1; return {} as never },
      },
      scheduleTask: () => () => undefined,
    })

    scheduler.acceptedFrame(firstFrame)
    scheduler.acceptedFrame(secondFrame)
    await scheduler.flush()
    expect(consumed).toEqual([firstFrame, secondFrame])
    expect(reconciles).toBe(0)
    scheduler.dispose()
  })

  test("coalesces uncovered frames and only relevant pending blob publication into one fail-open reconcile", async () => {
    const consumed: Digest[] = []
    let reconciles = 0
    const scheduler = createMainProjectIndexFileMaterializationScheduler({
      projectId,
      materializer: {
        async consumeAcceptedFrameCoverage(frameDigest) {
          consumed.push(frameDigest)
          return frameDigest === firstFrame
        },
        needsPublishedBlob(digest) { return digest === pendingBlob },
        async reconcile() { reconciles += 1; return {} as never },
      },
      scheduleTask: () => () => undefined,
    })

    scheduler.publishedBlob(unrelatedBlob)
    scheduler.acceptedFrame(firstFrame)
    scheduler.acceptedFrame(secondFrame)
    scheduler.publishedBlob(pendingBlob)
    await scheduler.flush()
    expect(consumed).toEqual([firstFrame, secondFrame])
    expect(reconciles).toBe(1)
    scheduler.dispose()
  })
})

describe("ProjectIndex blob-publication Main bridge", () => {
  const projectId = parseProjectId("project-stream-publication")
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(7)))

  test("keeps repeated exact publication on the byte fast path while managed admission remains streamed", async () => {
    const exactBytes = new TextEncoder().encode("already materialized")
    const reference = resourceReference(exactBytes, projectId, projectEpoch)
    let byteCalls = 0
    let streamCalls = 0
    let streamedAdmission: unknown
    const blobs = {
      async admitVerifiedBytes(receivedReference, receivedBytes) {
        byteCalls += 1
        expect(receivedReference).toBe(reference)
        expect(receivedBytes).toBe(exactBytes)
        return {} as never
      },
      async admitVerifiedStream(receivedReference, admission) {
        streamCalls += 1
        expect(receivedReference).toBe(reference)
        streamedAdmission = admission
        return {} as never
      },
    } satisfies Pick<ProjectBlobReplicationStore, "admitVerifiedBytes" | "admitVerifiedStream">
    const port = createMainProjectIndexBlobPublicationPort({ blobs })

    await port.publish({ reference, exactBytes })
    await port.publish({ reference, exactBytes })

    expect(byteCalls).toBe(2)
    expect(streamCalls).toBe(0)

    const admission = Object.freeze({
      blob: reference.blob,
      async readChunks() {},
    })
    await port.admitManaged({ reference, admission })

    expect(byteCalls).toBe(2)
    expect(streamCalls).toBe(1)
    expect(streamedAdmission).toBe(admission)
  })

  nativeDurabilityTest("rejects an exact byte digest mismatch without publishing a durable blob", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-main-blob-stream-"))
    roots.push(root)
    const collaborationDirectory = path.join(root, ".convax", "collaboration")
    await fs.mkdir(collaborationDirectory, { recursive: true })
    const authority = await loadHistoricalTestAuthority()
    const blobs = await ProjectBlobReplicationStore.open({
      collaborationDirectory,
      projectId,
      projectEpoch,
      protocolDigest: authority.protocolDigest,
    })
    const reference = resourceReference(new TextEncoder().encode("expected"), projectId, projectEpoch)
    const published: string[] = []
    const unsubscribe = blobs.subscribePublished((digest) => published.push(digest))
    try {
      await expect(
        createMainProjectIndexBlobPublicationPort({ blobs }).publish({
          reference,
          exactBytes: new TextEncoder().encode("tampered"),
        }),
      ).rejects.toThrow("match")
      expect(published).toEqual([])
      expect(
        await blobs.queryHave([{ blobSha256: reference.blob.digest, byteLength: reference.blob.byteLength }]),
      ).toEqual([])
    } finally {
      unsubscribe()
    }
  })
})

function resourceReference(
  bytes: Uint8Array,
  projectId: ReturnType<typeof parseProjectId>,
  projectEpoch: ReturnType<typeof parseId128>,
): Parameters<ProjectBlobReplicationStore["admitVerifiedStream"]>[0] {
  const digest = ordinarySha256(bytes)
  const entryFileId = `pf_${"b".repeat(64)}` as const
  return Object.freeze({
    format: "convax.project-resource-reference",
    projectId,
    projectEpoch,
    entryFileId,
    familyPrimaryFileId: entryFileId,
    versionId: `pv_${digest}` as never,
    canonicalUri: `convax-project://${projectId}/epochs/${projectEpoch}/entries/${entryFileId}?blob=sha256%3A${digest}`,
    blob: Object.freeze({
      format: "convax.blob-ref",
      algorithm: "sha256",
      digest,
      byteLength: String(bytes.byteLength) as never,
      mime: "application/octet-stream",
    }),
    versionRecordDigest: ordinarySha256(new TextEncoder().encode(`version:${digest}`)),
  })
}

describe("ProjectIndex exact file materialization Main bridge", () => {
  test("forwards only the requested portable paths to the live file application", async () => {
    const projectId = parseProjectId("project-exact-materialization")
    const queryFileMaterializationEntries = mock(async (input: { projectId: string; paths: readonly string[] }) =>
      Object.freeze({ projectId: input.projectId, entries: Object.freeze([]) }))
    const registry = Object.create(MainProjectIndexRuntimeRegistry.prototype) as MainProjectIndexRuntimeRegistry
    Object.defineProperty(registry, "open", {
      value: mock(async () => ({ fileApplication: { queryFileMaterializationEntries } })),
    })

    await expect(registry.queryFileMaterializationEntries({
      projectId,
      paths: ["Notes/a.md", "Assets/hero.png"],
    })).resolves.toEqual({ projectId, entries: [] })
    expect(queryFileMaterializationEntries).toHaveBeenCalledWith({
      projectId,
      paths: ["Notes/a.md", "Assets/hero.png"],
    })
  })
})

describe("ProjectIndex exact current-resource Main bridge", () => {
  test("forwards only the requested proof targets to the live ProjectIndex application", async () => {
    const projectId = parseProjectId("project-exact-current-resources")
    const targets = [{ uri: "convax-project://resource", ownerProofDigest: parseDigest("b".repeat(64)) }]
    const queryCurrentResourcesExact = mock(async () => [])
    const registry = Object.create(MainProjectIndexRuntimeRegistry.prototype) as MainProjectIndexRuntimeRegistry
    Object.defineProperty(registry, "open", {
      value: mock(async () => ({ application: { queryCurrentResourcesExact } })),
    })

    await expect(registry.queryCurrentResourcesExact({ projectId, targets })).resolves.toEqual([])
    expect(queryCurrentResourcesExact).toHaveBeenCalledWith({ projectId, targets })
  })

  test("forwards only requested reference proofs without materializing resource paths", async () => {
    const projectId = parseProjectId("project-exact-current-resource-references")
    const targets = [{ uri: "convax-project://resource", ownerProofDigest: parseDigest("c".repeat(64)) }]
    const queryCurrentResourceReferencesExact = mock(async () => [])
    const registry = Object.create(MainProjectIndexRuntimeRegistry.prototype) as MainProjectIndexRuntimeRegistry
    Object.defineProperty(registry, "open", {
      value: mock(async () => ({ application: { queryCurrentResourceReferencesExact } })),
    })

    await expect(registry.queryCurrentResourceReferencesExact({ projectId, targets })).resolves.toEqual([])
    expect(queryCurrentResourceReferencesExact).toHaveBeenCalledWith({ projectId, targets })
  })
})
