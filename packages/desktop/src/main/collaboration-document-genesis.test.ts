import { describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  installCanvasGenesisProofCarrierVerifierFactoryV2,
  selectedCanvasDocumentOwnerArtifactDefinitionV2,
  type CanvasGenesisBuildAuthorV2,
} from "@convax/canvas/collaboration"
import {
  createSelectedDocumentOwnerArtifactFactory,
  encodeBase64url,
  ordinarySha256,
  parseActorId,
  parseCanvasId,
  parseId128,
  parseProjectId,
  parseMemberId,
  parseReplicaId,
  parseSignature,
  replicaActorHeadSetDigest,
  type DecodedCausalEditFrame,
  type DocumentScope,
  type StateVector,
} from "@convax/collaboration"
import {
  NodeCollaborationPersistenceV2,
  stageDurableProjectDocumentGenesis,
  type ProjectDocumentGenesisStorePort,
  type ProjectDocumentGenesisVerifierPort,
} from "@convax/project/node"

import { createCanvasDocumentGenesisVerifierPortV2 } from "./canvas-document-genesis"
import { loadHistoricalTestAuthorityV2 } from "./collaboration-authority.test-support"

const bytes = new TextEncoder()
const projectEpoch = id(1)
const canvasScope = Object.freeze({
  projectId: parseProjectId("project"),
  projectEpoch,
  docKind: "canvas" as const,
  docId: parseCanvasId(`cv_${"c".repeat(64)}`),
  shardEpoch: id(2),
})
const projectIndexScope: DocumentScope = Object.freeze({
  projectId: canvasScope.projectId,
  projectEpoch,
  docKind: "project-index",
  docId: "project-index",
  shardEpoch: id(3),
}) as DocumentScope
const predecessor = Object.freeze({
  frame: {
    frameDigest: digest("stage-frame"),
    header: { core: { scope: projectIndexScope } },
  } as unknown as DecodedCausalEditFrame,
  acceptedFrontierDigest: digest("stage-frontier"),
})

describe("Desktop wiring to the Project-owned document genesis barrier", () => {
  test("stages the exact Canvas CVXCGP02 candidate through the real Node sole-writer barrier", async () => {
    const authority = await loadHistoricalTestAuthorityV2()
    const runtimeResult = createSelectedDocumentOwnerArtifactFactory(authority, "canvas")
      .createRuntime(selectedCanvasDocumentOwnerArtifactDefinitionV2)
    if ("status" in runtimeResult) throw new Error(runtimeResult.code)
    const author = canvasGenesisAuthor(authority)
    const factory = installCanvasGenesisProofCarrierVerifierFactoryV2({
      authority,
      historicalAuthorVerifier: {
        verifyHistoricalAuthor: () => ({
          status: "verified",
          authorActorId: author.authorActorId,
          authorReplicaId: author.authorReplicaId,
          authorCredentialCoreDigest: author.checkpointAuthorCredentialCoreDigest,
        }),
      },
    })
    const verifierResult = factory.createVerifier(runtimeResult)
    if (verifierResult.status !== "created") throw new Error(verifierResult.code)
    const adapter = createCanvasDocumentGenesisVerifierPortV2({
      authority,
      runtime: runtimeResult,
      verifier: verifierResult.verifier,
      authorProvider: {
        preflight: async () => "ready",
        prepareAuthor: async () => ({ status: "prepared", author }),
      },
    })
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-canvas-genesis-chain-"))
    const collaborationDirectory = path.join(root, ".convax", "collaboration")
    await fs.mkdir(collaborationDirectory, { recursive: true })
    const store = await NodeCollaborationPersistenceV2.open({
      collaborationDirectory,
      localActorId: author.authorActorId,
      materializer: {
        inspectFrame: async () => { throw new Error("genesis must not inspect a causal frame") },
        applyAcceptedFrame: async () => { throw new Error("genesis must not apply a causal frame") },
        actorHeadsDigest: replicaActorHeadSetDigest,
      },
    })
    try {
      const result = await stageDurableProjectDocumentGenesis({
        scope: canvasScope,
        predecessor,
        verifier: adapter,
        store,
      })
      expect(typeof result).not.toBe("string")
      if (typeof result === "string") return
      expect(result.predecessorFrameDigest).toBe(predecessor.frame.frameDigest)
      const retained = await store.readGenesisProof(canvasScope, result.checkpointObjectDigest)
      expect(new TextDecoder().decode(retained.slice(0, 8))).toBe("CVXCGP02")
      expect(await store.loadReplicaHead(canvasScope)).toMatchObject({ headDigest: result.durableHeadDigest })
    } finally {
      store.dispose()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("copies verified bytes and returns only the sole-writer durable identity", async () => {
    const checkpoint = bytes.encode("checkpoint-wrapper")
    const carrier = bytes.encode("CVXCGP02-carrier")
    const acceptedBase = base(canvasScope)
    let installedCheckpoint: Uint8Array | undefined
    let installedCarrier: Uint8Array | undefined
    const store: ProjectDocumentGenesisStorePort = {
      async initializeShardWithGenesisProof(input) {
        installedCheckpoint = input.checkpointExactBytes as Uint8Array
        installedCarrier = input.proofCarrierExactBytes as Uint8Array
        return { ...input.acceptedBase, headDigest: digest("durable-head") }
      },
    }
    const verifier: ProjectDocumentGenesisVerifierPort<"canvas"> = {
      async prepare() {
        return {
          status: "verified",
          candidate: {
            scope: canvasScope,
            checkpointObjectDigest: digest("G"),
            checkpointExactBytes: checkpoint,
            proofCarrierExactBytes: carrier,
            acceptedBase,
          },
        }
      },
    }
    const result = await stageDurableProjectDocumentGenesis({ scope: canvasScope, predecessor, verifier, store })
    expect(result).not.toBe("pending")
    expect(result).not.toBe("rejected")
    if (typeof result === "string") throw new Error("unexpected result")
    expect(result).toMatchObject({
      predecessorFrameDigest: predecessor.frame.frameDigest,
      stagedProjectIndexFrontierDigest: predecessor.acceptedFrontierDigest,
      checkpointObjectDigest: digest("G"),
      checkpointExactBytesSha256: ordinarySha256(checkpoint),
      proofCarrierExactBytesSha256: ordinarySha256(carrier),
      durableHeadDigest: digest("durable-head"),
    })
    expect(installedCheckpoint).not.toBe(checkpoint)
    expect(installedCarrier).not.toBe(carrier)
  })

  test("propagates owner pending without touching durability", async () => {
    const initializeShardWithGenesisProof = mock(async () => { throw new Error("must not run") })
    const result = await stageDurableProjectDocumentGenesis({
      scope: canvasScope,
      predecessor,
      verifier: { prepare: async () => ({ status: "pending" }) },
      store: { initializeShardWithGenesisProof },
    })
    expect(result).toBe("pending")
    expect(initializeShardWithGenesisProof).not.toHaveBeenCalled()
  })

  test("rejects a cross-Project predecessor before invoking the owner", async () => {
    const prepare = mock(async () => ({ status: "rejected" as const }))
    const wrong = {
      ...predecessor,
      frame: {
        ...predecessor.frame,
        header: { core: { scope: { ...projectIndexScope, projectId: parseProjectId("other") } } },
      } as unknown as DecodedCausalEditFrame,
    }
    await expect(stageDurableProjectDocumentGenesis({
      scope: canvasScope,
      predecessor: wrong,
      verifier: { prepare },
      store: { initializeShardWithGenesisProof: async () => { throw new Error("must not run") } },
    })).rejects.toThrow("same ProjectIndex epoch")
    expect(prepare).not.toHaveBeenCalled()
  })
})

function canvasGenesisAuthor(authority: import("@convax/collaboration").CurrentProtocolAuthority): CanvasGenesisBuildAuthorV2 {
  const byName = new Map(authority.protocolSchemaBundle.core.artifacts.map((artifact) => [artifact.name, artifact]))
  const artifact = (
    owner: import("@convax/collaboration").ValidationArtifactOwner,
    name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence",
  ) => {
    const selected = byName.get(name)!
    return Object.freeze({
      artifact: Object.freeze({ owner, format: selected.format, artifactDigest: selected.artifactDigest }),
      exactBytes: bytes.encode(`selected:${name}:${selected.artifactDigest}`),
    })
  }
  return Object.freeze({
    checkpointId: id(11),
    authorMemberId: parseMemberId(encodedIdentity(12, 16)),
    authorReplicaId: parseReplicaId("replica_00000001"),
    authorActorId: parseActorId(encodedIdentity(13, 32)),
    authorAuthorizationDigest: digest("authorization"),
    checkpointAuthorCredentialCoreDigest: digest("credential-core"),
    checkpointAuthorCredentialExactBytes: bytes.encode("credential"),
    checkpointAuthorMembershipSnapshotCoreDigest: digest("membership-core"),
    checkpointAuthorMembershipSnapshotExactBytes: bytes.encode("membership"),
    checkpointAuthorReservationReceiptCoreDigest: digest("reservation-core"),
    checkpointAuthorReservationReceiptExactBytes: bytes.encode("reservation"),
    serviceTrustBundleCoreDigest: digest("trust-core"),
    serviceTrustBundleExactBytes: bytes.encode("trust"),
    validationArtifacts: Object.freeze([
      artifact("canvas", "canvas-schema"),
      artifact("control-plane", "control-plane"),
      artifact("kernel", "collaboration-kernel"),
      artifact("project-index", "project-persistence"),
    ]),
    signCheckpointCoreDigest: async () => parseSignature(encodeBase64url(Uint8Array.from(
      { length: 64 }, (_, index) => index === 0 || index === 32 ? 2 : 0,
    ))),
  })
}

function encodedIdentity(seed: number, length: number): string {
  return encodeBase64url(Uint8Array.from({ length }, (_, index) => (seed * 17 + index * 29) & 0xff))
}

function base(scope: DocumentScope) {
  const frontier = Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) })
  return Object.freeze({
    scope,
    frontier,
    frontierDigest: digest("empty-frontier"),
    actorHeads: Object.freeze({ format: "convax.replica-actor-head-set/2" as const, scope, heads: Object.freeze([]) }),
    fullUpdate: bytes.encode("full-update"),
    stateVector: bytes.encode("state-vector") as StateVector,
    canonicalStateDigest: digest("canonical"),
  })
}

function digest(value: string) {
  return ordinarySha256(bytes.encode(value))
}

function id(value: number) {
  return parseId128(Buffer.alloc(16, value).toString("base64url"))
}
