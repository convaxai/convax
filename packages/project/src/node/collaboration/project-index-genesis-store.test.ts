import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  causalFrontierDigest,
  canonicalStateDigest,
  encodeBase64url,
  encodeFullUpdate,
  encodeRestrictedJcs,
  encodeStateVector,
  ownerCanonicalizerDescriptorDigest,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseReplicaId,
  parseSignature,
  replicaActorHeadSetDigest,
  replicaCheckpointCoreDigest,
  stateVectorDigest,
  yjsUpdateDigest,
  type DocumentScope,
  type ReplicaCheckpoint,
} from "@convax/collaboration"
import * as Y from "yjs"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  createProjectIndexReconstructionYDocV2,
  createProjectIndexYDocV2,
  encodeProjectCanonicalStateV2,
  projectIndexOwnerCanonicalizerDescriptorV2,
  validateProjectIndexYDocV2,
  type ProjectEntryRecordV2,
} from "../../collaboration/project-index"
import {
  NodeCollaborationPersistenceV2,
  type NodeReplicaHeadMaterializerV2,
} from "./persistence-store"
import {
  decodeProjectNativeStoreManifest,
  encodeProjectNativeStoreManifest,
  initializeUnteamedProjectIndexNativeStore,
  readProjectNativeStoreManifest,
  resolveCurrentProjectIndexScope,
  verifyEmptyProjectIndexGenesis,
} from "./project-index-genesis-store"

const roots: string[] = []
const projectId = "project-a" as never
const projectEpoch = id(1)
const shardEpoch = id(2)
const scope = {
  projectId,
  projectEpoch,
  docKind: "project-index" as const,
  docId: "project-index" as const,
  shardEpoch,
}
const authority = {
  protocolDigest: parseDigest("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5"),
  schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  uriProtocolDigest: parseDigest("9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38"),
}
const localActor = actor(7)
const durabilityTest = test.skipIf(process.platform === "win32")

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

describe("ProjectIndex native genesis store", () => {
  durabilityTest("publishes a new unteamed Project atomically and reopens the exact installed base", async () => {
    const fixture = await createFixture()
    const first = await initializeUnteamedProjectIndexNativeStore(fixture.input)
    expect(first.scope).toEqual(scope)
    expect(await resolveCurrentProjectIndexScope(fixture.target, authority)).toEqual(scope)
    expect((await readProjectNativeStoreManifest(fixture.target, authority)).initializationAuthorityDigest)
      .toBe(digest("enrollment"))

    const retry = await initializeUnteamedProjectIndexNativeStore(fixture.input)
    expect(retry.canonicalStateDigest).toBe(first.canonicalStateDigest)
    const store = await NodeCollaborationPersistenceV2.open({
      collaborationDirectory: fixture.target,
      localActorId: localActor,
      materializer,
    })
    try {
      const restarted = await store.loadInstalledBase(scope)
      expect(restarted.fullUpdate).toEqual(first.fullUpdate)
      expect(validateProjectIndexYDocV2(reconstruct(restarted.fullUpdate), scope).entries.size).toBe(1)
    } finally {
      store.dispose()
    }
  })

  durabilityTest("rejects unknown manifest fields, checksum tampering and stale live authority", async () => {
    const fixture = await createFixture()
    const exact = encodeProjectNativeStoreManifest(fixture.genesis.manifest)
    const payloadLength = Buffer.from(exact).readUInt32BE(8)
    const payload = JSON.parse(new TextDecoder().decode(exact.slice(12, 12 + payloadLength)))
    expect(() => encodeProjectNativeStoreManifest({ ...payload, revision: 1 })).toThrow("schema")
    const tampered = Uint8Array.from(exact)
    tampered[tampered.length - 1] ^= 1
    expect(() => decodeProjectNativeStoreManifest(tampered)).toThrow("checksum")

    await initializeUnteamedProjectIndexNativeStore(fixture.input)
    await expect(readProjectNativeStoreManifest(fixture.target, {
      ...authority, protocolDigest: digest("old-protocol"),
    })).rejects.toThrow("authority is not current")
  })

  durabilityTest("resumes the same staged genesis after crashes but rejects another epoch as equivocation", async () => {
    const fixture = await createFixture()
    let failManifest = true
    await expect(initializeUnteamedProjectIndexNativeStore({
      ...fixture.input,
      faults: { async afterManifestFsync() { if (failManifest) { failManifest = false; throw new Error("crash-manifest") } } },
    })).rejects.toThrow("crash-manifest")
    expect(await fs.lstat(`${fixture.target}.staging`)).toBeTruthy()
    await initializeUnteamedProjectIndexNativeStore(fixture.input)

    const another = await createFixture({ projectEpoch: id(9), target: fixture.target })
    await expect(initializeUnteamedProjectIndexNativeStore(another.input)).rejects.toThrow("equivocation")
  })

  durabilityTest("resumes after durable genesis and detects an altered installed base on restart", async () => {
    const fixture = await createFixture()
    let failGenesis = true
    await expect(initializeUnteamedProjectIndexNativeStore({
      ...fixture.input,
      faults: { async afterGenesisFsync() { if (failGenesis) { failGenesis = false; throw new Error("crash-genesis") } } },
    })).rejects.toThrow("crash-genesis")
    await initializeUnteamedProjectIndexNativeStore(fixture.input)

    const baseFile = await findFirst(fixture.target, (value) => value.includes("/journals/bases/") && value.endsWith(".bin"))
    const bytes = await fs.readFile(baseFile)
    bytes[bytes.length - 1] ^= 1
    await fs.writeFile(baseFile, bytes)
    await expect(initializeUnteamedProjectIndexNativeStore(fixture.input)).rejects.toThrow()
  })

  test("reconstruction factory binds only the owner root and validation rejects an unknown root", () => {
    const reconstructed = createProjectIndexReconstructionYDocV2()
    expect(reconstructed.gc).toBe(false)
    Y.applyUpdate(reconstructed, encodeFullUpdate(genesisDocument()))
    expect(validateProjectIndexYDocV2(reconstructed, scope).entries.size).toBe(1)
    reconstructed.getMap("rogue")
    expect(() => validateProjectIndexYDocV2(reconstructed, scope)).toThrow("exactly convax.project-index.v2")
  })
})

async function createFixture(overrides: { projectEpoch?: ReturnType<typeof id>; target?: string } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-index-genesis-"))
  roots.push(root)
  const privateDirectory = path.join(root, ".convax")
  await fs.mkdir(privateDirectory)
  const target = overrides.target ?? path.join(privateDirectory, "collaboration")
  const candidate = genesisDocument(overrides.projectEpoch)
  const candidateScope = {
    ...scope,
    projectEpoch: overrides.projectEpoch ?? projectEpoch,
  } as DocumentScope
  const checkpoint = checkpointFor(candidate, candidateScope)
  const genesis = await verifyEmptyProjectIndexGenesis({
    scope: candidateScope,
    document: candidate,
    checkpointExactBytes: encodeRestrictedJcs(checkpoint),
    initializationAuthorityDigest: digest("enrollment"),
    verifier: { async verify() { return true } },
  })
  return {
    root,
    target,
    genesis,
    input: {
      collaborationDirectory: target,
      localActorId: localActor,
      materializer,
      genesis,
    },
  }
}

function genesisDocument(epoch = projectEpoch) {
  const rootDirectoryId = `pd_${"a".repeat(64)}` as const
  const rootEntry: ProjectEntryRecordV2 = {
    format: "convax.project-entry/2",
    entryId: rootDirectoryId,
    kind: "directory",
    storageClass: null,
    contentPolicy: "none",
    provenance: "project-root",
    conflictSource: null,
    createdByActorId: localActor,
    createdByOperationId: id(3),
    createdStamp: {
      format: "convax.portable-stamp/2",
      lamport: "0" as never,
      actorId: localActor,
      operationId: id(3),
      writeOrdinal: "0" as never,
    },
  }
  return createProjectIndexYDocV2({
    format: "convax.project-index-identity/2",
    schema: "convax.project-index.v2",
    projectId: projectId as never,
    projectEpoch: epoch,
    shardEpoch,
    rootDirectoryId,
    protocolDigest: authority.protocolDigest,
    schemaDigest: authority.schemaDigest,
    uriProtocolDigest: authority.uriProtocolDigest,
  }, rootEntry)
}

function checkpointFor(candidate: Y.Doc, candidateScope: DocumentScope): ReplicaCheckpoint {
  const fullUpdate = encodeFullUpdate(candidate)
  const stateVector = encodeStateVector(candidate)
  const canonical = encodeProjectCanonicalStateV2(candidate)
  const frontier = { format: "convax.causal-frontier/2" as const, heads: [] }
  const actorHeads = { format: "convax.replica-actor-head-set/2" as const, scope: candidateScope, heads: [] }
  const core = {
    format: "convax.replica-checkpoint-core/2" as const,
    scope: candidateScope,
    checkpointId: id(4),
    authorMemberId: parseMemberId(encodeBase64url(Buffer.alloc(16, 5))),
    authorReplicaId: parseReplicaId("replica_0000002a"),
    authorActorId: localActor,
    authorAuthorizationDigest: digest("authorization"),
    directParentCheckpointDigests: [],
    baseFrontierDigest: causalFrontierDigest(frontier),
    computedFrontierDigest: causalFrontierDigest(frontier),
    actorHeadBoundaryDigest: replicaActorHeadSetDigest(actorHeads),
    stateVectorDigest: stateVectorDigest(stateVector),
    canonicalStateDigest: canonicalStateDigest(authority.schemaDigest, canonical),
    fullUpdateDigest: yjsUpdateDigest(fullUpdate),
    fullUpdateByteLength: String(fullUpdate.byteLength) as never,
    protocolDigest: authority.protocolDigest,
    schemaDigest: authority.schemaDigest,
    canonicalizerDigest: ownerCanonicalizerDescriptorDigest(
      projectIndexOwnerCanonicalizerDescriptorV2(authority.schemaDigest),
    ),
    validationArtifactSetDigest: digest("artifacts"),
  }
  return {
    format: "convax.replica-checkpoint/2",
    core,
    coreDigest: replicaCheckpointCoreDigest(core),
    replicaSignature: parseSignature(encodeBase64url(Uint8Array.from(
      { length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0,
    ))),
  }
}

const materializer: NodeReplicaHeadMaterializerV2 = {
  async inspectFrame() { throw new Error("unused") },
  async applyAcceptedFrame() { throw new Error("unused") },
  actorHeadsDigest: replicaActorHeadSetDigest,
}

function reconstruct(fullUpdate: Uint8Array) {
  const result = createProjectIndexReconstructionYDocV2()
  Y.applyUpdate(result, fullUpdate)
  return result
}

async function findFirst(root: string, predicate: (value: string) => boolean): Promise<string> {
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()!
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(target)
      else if (predicate(target)) return target
    }
  }
  throw new Error("file not found")
}

function id(byte: number) {
  return parseId128(Buffer.alloc(16, byte).toString("base64url"))
}

function actor(byte: number) {
  return parseActorId(Buffer.alloc(32, byte).toString("base64url"))
}

function digest(seed: string) {
  return parseDigest(Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64))
}
