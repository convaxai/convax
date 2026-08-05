import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createWebCryptoEd25519VerifierV2, parseDigestV2, parseProjectIdV2 } from "@convax/collaboration"
import type { ProjectIndexCurrentBlobReferencePortV2 } from "@convax/project"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/project"
import { readProjectNativeStoreManifestV2 } from "@convax/project/node"

import { loadHistoricalTestAuthorityV2 } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVaultV2 } from "./electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthorityV2 } from "./local-project-owner-authority"
import {
  CollaborationEnrollmentRequiredErrorV2,
  createExistingProjectIndexRegistrationPortV2,
  createLocalProjectOwnerIndexRegistrationPortV2,
  queryMainProjectIndexCurrentBlobDigestsV2,
} from "./main-project-index-runtime-registry"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("existing ProjectIndex registration", () => {
  test("an unregistered Project fails closed instead of minting a local owner", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-unregistered-project-"))
    roots.push(projectRoot)
    await fs.mkdir(path.join(projectRoot, ".convax"))
    const authority = await loadHistoricalTestAuthorityV2()
    const registration = createExistingProjectIndexRegistrationPortV2(authority)

    await expect(
      registration.ensureRegistered({
        projectId: parseProjectIdV2("project-unregistered"),
        projectRoot,
      }),
    ).rejects.toBeInstanceOf(CollaborationEnrollmentRequiredErrorV2)
    expect(await fs.readdir(path.join(projectRoot, ".convax"))).toEqual([])
  })

  test("does not first-register collaboration while legacy Canvas bytes require reset", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-legacy-first-register-"))
    roots.push(projectRoot)
    await fs.mkdir(path.join(projectRoot, ".convax", "canvases"), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, ".convax", "project.json"),
      JSON.stringify({ projectId: "project-legacy-first-register", schemaVersion: "convax.project/1" }),
    )
    await fs.writeFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "legacy")
    const authority = await loadHistoricalTestAuthorityV2()
    let ownerCreated = false
    const registration = createLocalProjectOwnerIndexRegistrationPortV2(authority, {
      async ensureForDurableProject() {
        ownerCreated = true
        throw new Error("must not create owner")
      },
      async resolveExact() {
        return "missing" as const
      },
      async verifyCheckpointSignature() {
        return false
      },
    })

    await expect(
      registration.ensureRegistered({
        projectId: parseProjectIdV2("project-legacy-first-register"),
        projectRoot,
      }),
    ).rejects.toMatchObject({ code: "unsupported-portable-version" })
    expect(ownerCreated).toBeFalse()
    await expect(fs.access(path.join(projectRoot, ".convax", "collaboration"))).rejects.toThrow()
  })

  test("first-registers and exact-retries an empty ProjectIndex from the durable local owner binding", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-first-register-"))
    roots.push(root)
    const projectRoot = path.join(root, "project")
    const userData = path.join(root, "user-data")
    await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
    const authority = await loadHistoricalTestAuthorityV2()
    const projectId = parseProjectIdV2("project-first-register")
    const vault = new ElectronReplicaSigningVaultV2(path.join(userData, "vault"), {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "keychain",
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => value.toString("utf8"),
    })
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
      verifier: createWebCryptoEd25519VerifierV2(),
    })
    const registration = createLocalProjectOwnerIndexRegistrationPortV2(authority, owners)
    const first = await registration.ensureRegistered({ projectId, projectRoot })
    const retry = await registration.ensureRegistered({ projectId, projectRoot })
    expect(retry).toEqual(first)

    const manifest = await readProjectNativeStoreManifestV2(path.join(projectRoot, ".convax", "collaboration"), {
      protocolDigest: authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
      uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
    })
    const localOwner = await owners.resolveExact({
      projectId,
      projectEpoch: manifest.projectIndexScope.projectEpoch,
      initializationAuthorityDigest: manifest.initializationAuthorityDigest,
    })
    expect(localOwner).not.toBe("missing")
    expect(localOwner).not.toBe("rejected")
    if (localOwner === "missing" || localOwner === "rejected") throw new Error("unreachable")
    expect(localOwner.binding.projectIndexShardEpoch).toBe(manifest.projectIndexScope.shardEpoch)
  })
})

describe("ProjectIndex current blob-reference Main bridge", () => {
  const projectId = parseProjectIdV2("project-blob-references")
  const digest = parseDigestV2("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

  test("propagates an unavailable owner query and never guesses from another projection", async () => {
    const application: ProjectIndexCurrentBlobReferencePortV2 = {
      async queryCurrentResources() { return [] },
      async queryCurrentBlobDigests() {
        throw new Error("ProjectIndex session unavailable")
      },
    }
    await expect(queryMainProjectIndexCurrentBlobDigestsV2(application, { projectId })).rejects.toThrow(
      "session unavailable",
    )
  })

  test("rejects malformed collections and digests before native GC can observe them", async () => {
    await expect(
      queryMainProjectIndexCurrentBlobDigestsV2(
        {
          async queryCurrentResources() { return [] },
          async queryCurrentBlobDigests() {
            return [digest] as never
          },
        },
        { projectId },
      ),
    ).rejects.toThrow("malformed")
    await expect(
      queryMainProjectIndexCurrentBlobDigestsV2(
        {
          async queryCurrentResources() { return [] },
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
    const result = await queryMainProjectIndexCurrentBlobDigestsV2(
      {
        async queryCurrentResources() { return [] },
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
