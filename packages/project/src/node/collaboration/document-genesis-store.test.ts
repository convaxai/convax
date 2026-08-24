import { describe, expect, mock, test } from "bun:test"
import {
  ordinarySha256,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseProjectId,
  type DecodedCausalEditFrame,
  type DocumentScope,
  type StateVector,
} from "@convax/collaboration"
import {
  stageDurableProjectDocumentGenesis,
  type ProjectDocumentGenesisStorePort,
} from "./document-genesis-store"

const projectId = parseProjectId(`project_${"a".repeat(64)}`)
const projectEpoch = id(1)
const projectIndexScope = Object.freeze({
  projectId,
  projectEpoch,
  docKind: "project-index" as const,
  docId: "project-index" as const,
  shardEpoch: id(2),
})
const canvasScope = Object.freeze({
  projectId,
  projectEpoch,
  docKind: "canvas" as const,
  docId: parseCanvasId(`cv_${"b".repeat(64)}`),
  shardEpoch: id(3),
})

describe("Project durable document genesis barrier", () => {
  test("installs only owner-verified exact bytes and returns the activation identity", async () => {
    const candidate = createCandidate()
    const prepare = mock(async () => ({ status: "verified" as const, candidate }))
    const initialize = mock(async (input: Parameters<
      ProjectDocumentGenesisStorePort["initializeShardWithGenesisProof"]
    >[0]) => Object.freeze({
      ...input.acceptedBase,
      headDigest: digest("head"),
    }))
    const result = await stageDurableProjectDocumentGenesis({
      scope: canvasScope,
      predecessor: predecessor(),
      verifier: { prepare },
      store: { initializeShardWithGenesisProof: initialize },
    })

    expect(result).toEqual({
      scope: canvasScope,
      predecessorFrameDigest: digest("frame"),
      stagedProjectIndexFrontierDigest: digest("stage-frontier"),
      checkpointObjectDigest: digest("checkpoint"),
      checkpointExactBytesSha256: ordinarySha256(candidate.checkpointExactBytes),
      proofCarrierExactBytesSha256: ordinarySha256(candidate.proofCarrierExactBytes),
      fullUpdateDigest: ordinarySha256(candidate.acceptedBase.fullUpdate),
      stateVectorDigest: ordinarySha256(candidate.acceptedBase.stateVector),
      canonicalStateDigest: digest("canonical"),
      durableHeadDigest: digest("head"),
    })
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  test("keeps pending authoring fail-closed without touching persistence", async () => {
    const initialize = mock(async () => { throw new Error("must not write") })
    await expect(stageDurableProjectDocumentGenesis({
      scope: canvasScope,
      predecessor: predecessor(),
      verifier: { async prepare() { return { status: "pending" } } },
      store: { initializeShardWithGenesisProof: initialize },
    })).resolves.toBe("pending")
    expect(initialize).not.toHaveBeenCalled()
  })

  test("rejects a cross-Project predecessor before invoking the owner verifier", async () => {
    const prepare = mock(async () => ({ status: "verified" as const, candidate: createCandidate() }))
    const crossedScope = { ...projectIndexScope, projectId: parseProjectId(`project_${"c".repeat(64)}`) }
    await expect(stageDurableProjectDocumentGenesis({
      scope: canvasScope,
      predecessor: predecessor(crossedScope),
      verifier: { prepare },
      store: { async initializeShardWithGenesisProof() { throw new Error("must not write") } },
    })).rejects.toThrow("same ProjectIndex epoch")
    expect(prepare).not.toHaveBeenCalled()
  })
})

function predecessor(scope: DocumentScope = projectIndexScope) {
  return Object.freeze({
    frame: {
      frameDigest: digest("frame"),
      header: { core: { scope } },
    } as unknown as DecodedCausalEditFrame,
    acceptedFrontierDigest: digest("stage-frontier"),
  })
}

function createCandidate() {
  const acceptedBase = Object.freeze({
    scope: canvasScope,
    frontier: Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) }),
    frontierDigest: digest("frontier"),
    actorHeads: Object.freeze({
      format: "convax.replica-actor-head-set" as const,
      scope: canvasScope,
      heads: Object.freeze([]),
    }),
    fullUpdate: new Uint8Array([1, 2, 3]),
    stateVector: new Uint8Array([4, 5]) as StateVector,
    canonicalStateDigest: digest("canonical"),
    materializationDigest: digest("materialization"),
  })
  return Object.freeze({
    scope: canvasScope,
    checkpointObjectDigest: digest("checkpoint"),
    checkpointExactBytes: new Uint8Array([6, 7]),
    proofCarrierExactBytes: new Uint8Array([8, 9]),
    acceptedBase,
  })
}

function id(byte: number) {
  return parseId128(Buffer.alloc(16, byte).toString("base64url"))
}

function digest(seed: string) {
  return parseDigest(Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64))
}
