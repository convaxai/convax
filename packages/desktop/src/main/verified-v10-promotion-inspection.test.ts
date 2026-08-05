import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  createWebCryptoEd25519VerifierV2,
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseId128V2,
  parseProjectIdV2,
} from "@convax/collaboration"
import { CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/canvas/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/project"
import type { EmptyProjectDefaultCanvasClaimSourceV3 } from "@convax/project/node"

import { loadHistoricalTestAuthorityV2 } from "./collaboration-authority.test-support"
import { ElectronReplicaSigningVaultV2 } from "./electron-replica-signing-vault"
import { NodeDurableLocalProjectOwnerAuthorityV2 } from "./local-project-owner-authority"
import { createLocalProjectOwnerIndexRegistrationPortV2 } from "./main-project-index-runtime-registry"
import {
  VerifiedV10PromotionInspectionAdapterV3,
} from "./verified-v10-promotion-inspection"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("verified V10 promotion inspection", () => {
  test("verifies the exact pristine local R5 closure and returns one retry-stable default Canvas claim", async () => {
    const fixture = await createFixture()
    const first = await fixture.inspector.inspect(fixture.identity)
    const second = await fixture.inspector.inspect(fixture.identity)

    expect(second).toEqual(first)
    expect(first.status).toBe("verified-unshared")
    if (first.status !== "verified-unshared") throw new Error("expected verified local Project")
    expect(first.documents).toHaveLength(1)
    expect(first.documents[0]?.scope.docKind).toBe("project-index")
    expect(first.documents[0]?.sourceFrontierDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(first.documents[0]?.sourceHeadDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(first.emptyProjectDefaultCanvas?.scope.docKind).toBe("canvas")
    expect(first.emptyProjectDefaultCanvas?.ownerSchemaDigest).toBe(CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2)
  })

  test("classifies durable Team authority and successor tombstones before exposing local bytes", async () => {
    const team = await createFixture({ team: "present" })
    expect(await team.inspector.inspect(team.identity)).toEqual({ status: "shared" })

    const tombstone = await createFixture({ successor: "shared" })
    expect(await tombstone.inspector.inspect(tombstone.identity)).toEqual({ status: "shared" })

    const partial = await createFixture({ successor: "unshared" })
    expect(await partial.inspector.inspect(partial.identity)).toEqual({ status: "ambiguous" })
  })

  test("fails closed for epoch mismatch, malformed Team selectors and non-pristine native inventory", async () => {
    const epoch = await createFixture()
    expect(await epoch.inspector.inspect({ ...epoch.identity, projectEpoch: id(99) })).toEqual({ status: "invalid" })

    const malformedTeam = await createFixture({ team: "rejected" })
    expect(await malformedTeam.inspector.inspect(malformedTeam.identity)).toEqual({ status: "ambiguous" })

    const dirty = await createFixture()
    await fs.writeFile(path.join(dirty.collaborationDirectory, "unexpected.bin"), "not authority")
    expect(await dirty.inspector.inspect(dirty.identity)).toEqual({ status: "invalid" })
  })

  test("rejects a Project-owner claim that crosses Project or Canvas schema", async () => {
    const fixture = await createFixture({ crossedDefaultCanvas: true })
    expect(await fixture.inspector.inspect(fixture.identity)).toEqual({ status: "invalid" })
  })
})

async function createFixture(options: {
  team?: "missing" | "present" | "rejected"
  successor?: "missing" | "shared" | "unshared" | "recovery-required"
  crossedDefaultCanvas?: boolean
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-v10-promotion-inspection-"))
  roots.push(root)
  const projectRoot = path.join(root, "project")
  const userData = path.join(root, "user-data")
  await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
  const authority = await loadHistoricalTestAuthorityV2()
  const projectId = parseProjectIdV2("project-v10-promotion")
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
    createId: (() => {
      const ids = [id(1), id(2), id(3), id(4), id(5)]
      return () => ids.shift() ?? id(6)
    })(),
    createReplicaId: () => "replica_00000001" as never,
  })
  const registration = createLocalProjectOwnerIndexRegistrationPortV2(authority, owners)
  const projectIndexScope = await registration.ensureRegistered({ projectId, projectRoot })
  const defaultCanvas: EmptyProjectDefaultCanvasClaimSourceV3 = Object.freeze({
    async resolve(input: Parameters<EmptyProjectDefaultCanvasClaimSourceV3["resolve"]>[0]) {
      const seed = Object.freeze({
        format: "convax.empty-r5-default-canvas-claim-seed/3",
        projectId: input.projectId,
        projectEpoch: input.projectEpoch,
        projectIndexScope: input.projectIndexScope,
      })
      const digest = ordinarySha256V2(encodeRestrictedJcsV2(seed))
      return Object.freeze({
        scope: Object.freeze({
          projectId: options.crossedDefaultCanvas ? parseProjectIdV2("project-crossed") : input.projectId,
          projectEpoch: input.projectEpoch,
          docKind: "canvas" as const,
          docId: `cv_${digest}` as never,
          shardEpoch: parseId128V2(encodeBase64urlV2(Buffer.from(digest.slice(0, 32), "hex"))),
        }),
        ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
        creationClaimDigest: ordinarySha256V2(encodeRestrictedJcsV2(Object.freeze({ ...seed, canvasDigest: digest }))),
        stageOperationId: id(7),
      })
    },
  })
  const inspector = new VerifiedV10PromotionInspectionAdapterV3({
    authority,
    projects: { async resolveProjectRoot() { return projectRoot } },
    owners,
    teamAuthority: {
      async open() {
        if (options.team === "rejected") return "rejected"
        if (options.team === "present") return {} as never
        return "missing"
      },
    },
    successorOwner: {
      async open() {
        const status = options.successor ?? "missing"
        if (status === "shared") return { status, sharingGeneration: "1", receiptDigest: "a".repeat(64) } as never
        if (status === "unshared") return { status, authority: {} } as never
        return { status } as never
      },
    },
    emptyProjectDefaultCanvas: defaultCanvas,
  })
  return {
    inspector,
    identity: { projectId, projectEpoch: projectIndexScope.projectEpoch },
    collaborationDirectory: path.join(projectRoot, ".convax", "collaboration"),
  }
}

function id(byte: number) {
  return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => byte)))
}
