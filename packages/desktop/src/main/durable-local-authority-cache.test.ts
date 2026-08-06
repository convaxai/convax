import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseUint64,
  type PublicKey,
} from "@convax/collaboration"

import {
  NodeDurableLocalReplicaAuthorityCacheV2,
  createLocalReplicaEnrollmentVerifierFactoryV2,
  enrollNewLocalProjectReplicaV2,
  type LocalReplicaEnrollmentCandidateV2,
  type VerifiedLocalReplicaEnrollmentV2,
} from "./durable-local-authority-cache"
import {
  ElectronReplicaSigningVaultV2,
  type ElectronSafeStoragePortV2,
} from "./electron-replica-signing-vault"

const roots: string[] = []
const protocolDigest = parseDigest("a".repeat(64))
const canvasSchemaDigest = parseDigest("b".repeat(64))
const projectId = parseProjectId("project-a")
const projectEpoch = id(1)
const actorId = parseActorId(encodeBase64url(new Uint8Array(32).fill(2)))
const replicaId = parseReplicaId("replica_00000001")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("durable verified local authority cache", () => {
  test("publishes one canonical current pointer and reopens request-bound offline authority", async () => {
    const root = await temporaryRoot()
    const cache = new NodeDurableLocalReplicaAuthorityCacheV2(path.join(root, "authority"), protocolDigest)
    const enrollment = await verifiedEnrollment(parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3))))
    await cache.install(enrollment)
    await cache.install(enrollment)

    const reopened = new NodeDurableLocalReplicaAuthorityCacheV2(path.join(root, "authority"), protocolDigest)
    const resolved = await reopened.resolveCurrent(request())
    expect(resolved).not.toBe("pending")
    expect(resolved).not.toBe("rejected")
    if (typeof resolved === "string") throw new Error("authority unexpectedly unavailable")
    expect(resolved.signerAuthority.actorId).toBe(actorId)
    expect(resolved.operationId).toBe(request().operationId)
    expect(await reopened.resolveLocalProjectActor({ projectId, projectEpoch })).toEqual({ actorId, replicaId })
    expect(await fs.readdir(path.join(root, "authority", "records"))).toHaveLength(1)
    expect(await fs.readdir(path.join(root, "authority", "current"))).toHaveLength(1)
    expect(await fs.readdir(path.join(root, "authority", "project-bindings"))).toHaveLength(1)
  })

  test("rejects membership rollback and same-sequence equivocation", async () => {
    const root = await temporaryRoot()
    const cache = new NodeDurableLocalReplicaAuthorityCacheV2(path.join(root, "authority"), protocolDigest)
    const publicKey = parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3)))
    await cache.install(await verifiedEnrollment(publicKey, "2", "c"))
    await expect(cache.install(await verifiedEnrollment(publicKey, "1", "d"))).rejects.toThrow("rollback")
    await expect(cache.install(await verifiedEnrollment(publicKey, "2", "d"))).rejects.toThrow("equivocation")
  })

  test("fails closed when pointer bytes gain whitespace or a noncanonical key order", async () => {
    const root = await temporaryRoot()
    const authorityRoot = path.join(root, "authority")
    const cache = new NodeDurableLocalReplicaAuthorityCacheV2(authorityRoot, protocolDigest)
    await cache.install(await verifiedEnrollment(parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3)))))
    const pointerName = (await fs.readdir(path.join(authorityRoot, "current")))[0]!
    const pointerPath = path.join(authorityRoot, "current", pointerName)
    const canonical = await fs.readFile(pointerPath, "utf8")
    await fs.writeFile(pointerPath, `${canonical} `)
    expect(await cache.resolveCurrent(request())).toBe("rejected")

    const parsed = JSON.parse(canonical) as Record<string, unknown>
    await fs.writeFile(pointerPath, JSON.stringify({ recordDigest: parsed.recordDigest, ...parsed }))
    expect(await cache.resolveCurrent(request())).toBe("rejected")
  })

  test("fails closed when the Project/epoch local actor binding is noncanonical", async () => {
    const root = await temporaryRoot()
    const authorityRoot = path.join(root, "authority")
    const cache = new NodeDurableLocalReplicaAuthorityCacheV2(authorityRoot, protocolDigest)
    await cache.install(await verifiedEnrollment(parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3)))))
    const bindingName = (await fs.readdir(path.join(authorityRoot, "project-bindings")))[0]!
    const bindingPath = path.join(authorityRoot, "project-bindings", bindingName)
    await fs.appendFile(bindingPath, " ")
    expect(await cache.resolveLocalProjectActor({ projectId, projectEpoch })).toBe("rejected")
  })

  test("new Project enrollment exposes no edit authority until key, ProjectIndex base, and cache pointer complete", async () => {
    const root = await temporaryRoot()
    const vault = new ElectronReplicaSigningVaultV2(path.join(root, "vault"), fakeSafeStorage())
    const cache = new NodeDurableLocalReplicaAuthorityCacheV2(path.join(root, "authority"), protocolDigest)
    const events: string[] = []
    let failProjectIndex = true
    const projectIndex = {
      async installProjectIndexBase() {
        events.push("project-index")
        if (failProjectIndex) throw new Error("injected ProjectIndex crash")
      },
    }
    const prepareEnrollment = async (publicKey: PublicKey) => {
      events.push("verified-enrollment")
      return verifiedEnrollment(publicKey)
    }

    await expect(enrollNewLocalProjectReplicaV2({
      identity: { projectId, projectEpoch, replicaId }, vault, prepareEnrollment, projectIndex, cache,
    })).rejects.toThrow("injected")
    expect(await cache.resolveCurrent(request())).toBe("pending")
    expect(await fs.readdir(path.join(root, "vault"))).toHaveLength(1)

    failProjectIndex = false
    const completed = await enrollNewLocalProjectReplicaV2({
      identity: { projectId, projectEpoch, replicaId }, vault, prepareEnrollment, projectIndex, cache,
    })
    expect(completed).not.toBe("rejected")
    expect(await cache.resolveCurrent(request())).not.toBe("pending")
    expect(events).toEqual([
      "verified-enrollment", "project-index",
      "verified-enrollment", "project-index",
    ])
  })

  test("a crash after ProjectIndex install but before pointer publication remains read-only and exact-retryable", async () => {
    const root = await temporaryRoot()
    const vault = new ElectronReplicaSigningVaultV2(path.join(root, "vault"), fakeSafeStorage())
    const durable = new NodeDurableLocalReplicaAuthorityCacheV2(path.join(root, "authority"), protocolDigest)
    let failPointer = true
    const cache = {
      resolveCurrent: (input: Parameters<typeof durable.resolveCurrent>[0]) => durable.resolveCurrent(input),
      async install(enrollment: VerifiedLocalReplicaEnrollmentV2) {
        if (failPointer) throw new Error("injected pointer crash")
        return durable.install(enrollment)
      },
    }
    let projectIndexInstalls = 0
    const projectIndex = { async installProjectIndexBase() { projectIndexInstalls += 1 } }
    const prepareEnrollment = (publicKey: PublicKey) => verifiedEnrollment(publicKey)

    await expect(enrollNewLocalProjectReplicaV2({
      identity: { projectId, projectEpoch, replicaId }, vault, prepareEnrollment, projectIndex, cache,
    })).rejects.toThrow("pointer")
    expect(await durable.resolveCurrent(request())).toBe("pending")
    failPointer = false
    await enrollNewLocalProjectReplicaV2({
      identity: { projectId, projectEpoch, replicaId }, vault, prepareEnrollment, projectIndex, cache,
    })
    expect(projectIndexInstalls).toBe(2)
    expect(await durable.resolveCurrent(request())).not.toBe("pending")
  })
})

async function verifiedEnrollment(
  publicKey: PublicKey,
  membershipSequence = "1",
  evidenceDigit = "c",
): Promise<VerifiedLocalReplicaEnrollmentV2> {
  const factory = createLocalReplicaEnrollmentVerifierFactoryV2({ verifyCurrent: async () => true })
  const membership = parseDigest("1".repeat(64))
  const credential = parseDigest("2".repeat(64))
  const edit = parseDigest("3".repeat(64))
  const candidate: LocalReplicaEnrollmentCandidateV2 = {
    projectId,
    projectEpoch,
    actorId,
    membershipSequence: parseUint64(membershipSequence),
    controlEvidenceDigest: parseDigest(evidenceDigit.repeat(64)),
    protocolDigest,
    replicaSigningPublicKey: publicKey,
    signerAuthority: {
      memberId: parseMemberId(id(4)),
      replicaId,
      actorId,
      memberAuthorizationEpoch: id(5),
      replicaAuthorizationEpoch: id(6),
      membershipSnapshotDigest: membership,
      replicaActorCredentialCoreDigest: credential,
      replicaEditAuthorizationCoreDigest: edit,
    },
    dependencies: Object.freeze([
      { kind: "membership-snapshot", digest: membership },
      { kind: "replica-actor-credential", digest: credential },
      { kind: "replica-edit-authorization", digest: edit },
    ]),
    validationArtifacts: {
      format: "convax.validation-artifact-set/2",
      artifacts: [{ owner: "canvas", format: "convax.canvas-protocol-schema/2", artifactDigest: canvasSchemaDigest }],
    },
    authorizationEvidence: Object.freeze({ source: "test-control-verifier" }),
  }
  const result = await factory.verify(candidate)
  if (result === "rejected") throw new Error("test enrollment rejected")
  return result
}

function request() {
  return {
    scope: {
      projectId,
      projectEpoch,
      docKind: "canvas" as const,
      docId: parseCanvasId(`cv_${"4".repeat(64)}`),
      shardEpoch: id(7),
    },
    actorId,
    operationId: id(8),
    baseFrontierDigest: parseDigest("5".repeat(64)),
    ownerSchemaDigest: canvasSchemaDigest,
  }
}

function id(byte: number) {
  return parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
}

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-local-authority-"))
  roots.push(root)
  return root
}

function fakeSafeStorage(): ElectronSafeStoragePortV2 {
  const secret = 0xa5
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString(plainText) { return Buffer.from(new TextEncoder().encode(plainText).map((byte) => byte ^ secret)) },
    decryptString(encrypted) { return new TextDecoder().decode(Uint8Array.from(encrypted, (byte) => byte ^ secret)) },
  }
}
