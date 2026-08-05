import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseId128V2,
  parseProjectIdV2,
} from "@convax/collaboration"
import { deriveProjectCanvasIdForOperationV2 } from "../../collaboration/project-index"
import { deriveEmptyProjectDefaultCanvasClaimV3 } from "./successor-default-canvas-claim"

describe("successor default Canvas claim", () => {
  test("deterministically precommits the exact owner-derived stage identity and scope", () => {
    const projectId = parseProjectIdV2("project_claim_test")
    const projectEpoch = id(1)
    const ownerActorId = parseActorIdV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 2)))
    const projectIndexScope = Object.freeze({
      projectId, projectEpoch, docKind: "project-index" as const,
      docId: "project-index" as const, shardEpoch: id(3),
    })
    const first = deriveEmptyProjectDefaultCanvasClaimV3({ projectId, projectEpoch, projectIndexScope, ownerActorId })
    const second = deriveEmptyProjectDefaultCanvasClaimV3({ projectId, projectEpoch, projectIndexScope, ownerActorId })
    expect(second).toEqual(first)
    expect(first.scope.docId).toBe(deriveProjectCanvasIdForOperationV2({
      scope: projectIndexScope,
      actorId: ownerActorId,
      operationId: first.stageOperationId,
    }))
    const other = deriveEmptyProjectDefaultCanvasClaimV3({
      projectId, projectEpoch, projectIndexScope,
      ownerActorId: parseActorIdV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 4))),
    })
    expect(other.creationClaimDigest).not.toBe(first.creationClaimDigest)
    expect(other.scope.docId).not.toBe(first.scope.docId)
  })
})

function id(value: number) {
  return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => value)))
}

