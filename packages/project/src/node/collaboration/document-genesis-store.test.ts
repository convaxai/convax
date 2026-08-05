import { describe, expect, mock, test } from "bun:test"
import {
  ordinarySha256V2,
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  type DecodedCausalEditFrameV2,
  type DocumentScopeV2,
  type StateVectorV2,
} from "@convax/collaboration"
import {
  stageDurableProjectDocumentGenesisV2,
  type ProjectDocumentGenesisStorePortV2,
} from "./document-genesis-store"

const projectId = parseProjectIdV2(`project_${"a".repeat(64)}`)
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
  docId: parseCanvasIdV2(`cv_${"b".repeat(64)}`),
  shardEpoch: id(3),
})

describe("Project durable document genesis barrier", () => {
  test("installs only owner-verified exact bytes and returns the activation identity", async () => {
    const candidate = createCandidate()
    const prepare = mock(async () => ({ status: "verified" as const, candidate }))
    const initialize = mock(async (input: Parameters<
      ProjectDocumentGenesisStorePortV2["initializeShardWithGenesisProof"]
    >[0]) => Object.freeze({
      ...input.acceptedBase,
      headDigest: digest("head"),
    }))
    const result = await stageDurableProjectDocumentGenesisV2({
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
      checkpointExactBytesSha256: ordinarySha256V2(candidate.checkpointExactBytes),
      proofCarrierExactBytesSha256: ordinarySha256V2(candidate.proofCarrierExactBytes),
      fullUpdateDigest: ordinarySha256V2(candidate.acceptedBase.fullUpdate),
      stateVectorDigest: ordinarySha256V2(candidate.acceptedBase.stateVector),
      canonicalStateDigest: digest("canonical"),
      durableHeadDigest: digest("head"),
    })
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  test("keeps pending authoring fail-closed without touching persistence", async () => {
    const initialize = mock(async () => { throw new Error("must not write") })
    await expect(stageDurableProjectDocumentGenesisV2({
      scope: canvasScope,
      predecessor: predecessor(),
      verifier: { async prepare() { return { status: "pending" } } },
      store: { initializeShardWithGenesisProof: initialize },
    })).resolves.toBe("pending")
    expect(initialize).not.toHaveBeenCalled()
  })

  test("rejects a cross-Project predecessor before invoking the owner verifier", async () => {
    const prepare = mock(async () => ({ status: "verified" as const, candidate: createCandidate() }))
    const crossedScope = { ...projectIndexScope, projectId: parseProjectIdV2(`project_${"c".repeat(64)}`) }
    await expect(stageDurableProjectDocumentGenesisV2({
      scope: canvasScope,
      predecessor: predecessor(crossedScope),
      verifier: { prepare },
      store: { async initializeShardWithGenesisProof() { throw new Error("must not write") } },
    })).rejects.toThrow("same ProjectIndex epoch")
    expect(prepare).not.toHaveBeenCalled()
  })
})

function predecessor(scope: DocumentScopeV2 = projectIndexScope) {
  return Object.freeze({
    frame: {
      frameDigest: digest("frame"),
      header: { core: { scope } },
    } as unknown as DecodedCausalEditFrameV2,
    acceptedFrontierDigest: digest("stage-frontier"),
  })
}

function createCandidate() {
  const acceptedBase = Object.freeze({
    scope: canvasScope,
    frontier: Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) }),
    frontierDigest: digest("frontier"),
    actorHeads: Object.freeze({
      format: "convax.replica-actor-head-set/2" as const,
      scope: canvasScope,
      heads: Object.freeze([]),
    }),
    fullUpdate: new Uint8Array([1, 2, 3]),
    stateVector: new Uint8Array([4, 5]) as StateVectorV2,
    canonicalStateDigest: digest("canonical"),
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
  return parseId128V2(Buffer.alloc(16, byte).toString("base64url"))
}

function digest(seed: string) {
  return parseDigestV2(Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64))
}
