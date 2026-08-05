import {
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseProjectIdV2,
  type ActorIdV2,
  type DocumentScopeV2,
  type Id128V2,
  type ProjectIdV2,
} from "@convax/collaboration"
import { CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/canvas/collaboration"
import { deriveProjectCanvasIdForOperationV2 } from "../../collaboration/project-index"
import type { VerifiedV10EmptyProjectDefaultCanvasV3 } from "./successor-local-project-provisioner"

/**
 * Pure Project-owned precommit. The same verified pristine R5 owner actor and
 * ProjectIndex scope always produce the same stage operation, Canvas scope and
 * creation-claim digest; Desktop supplies no path, nonce or authority choice.
 */
export function deriveEmptyProjectDefaultCanvasClaimV3(input: Readonly<{
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  projectIndexScope: DocumentScopeV2 & { readonly docKind: "project-index"; readonly docId: "project-index" }
  ownerActorId: ActorIdV2
}>): VerifiedV10EmptyProjectDefaultCanvasV3 {
  const projectId = parseProjectIdV2(input.projectId)
  const projectEpoch = parseId128V2(input.projectEpoch)
  const projectIndexScope = parseDocumentScopeV2(input.projectIndexScope)
  const ownerActorId = parseActorIdV2(input.ownerActorId)
  if (projectIndexScope.docKind !== "project-index" || projectIndexScope.docId !== "project-index" ||
    projectIndexScope.projectId !== projectId || projectIndexScope.projectEpoch !== projectEpoch) {
    throw new Error("Default Canvas claim crossed its ProjectIndex scope")
  }
  const seed = Object.freeze({
    format: "convax.empty-project-default-canvas-seed/3",
    projectId,
    projectEpoch,
    projectIndexScope,
    ownerActorId,
  })
  const stageOperationId = idFrom(seed, "stage-operation")
  const shardEpoch = idFrom(seed, "shard-epoch")
  const scope = Object.freeze({
    projectId,
    projectEpoch,
    docKind: "canvas" as const,
    docId: deriveProjectCanvasIdForOperationV2({
      scope: projectIndexScope as typeof input.projectIndexScope,
      actorId: ownerActorId,
      operationId: stageOperationId,
    }),
    shardEpoch,
  })
  const claim = Object.freeze({
    format: "convax.empty-project-default-canvas-creation-claim/3",
    projectIndexScope,
    ownerActorId,
    stageOperationId,
    scope,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  })
  return Object.freeze({
    scope,
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    creationClaimDigest: ordinarySha256V2(encodeRestrictedJcsV2(claim)),
    stageOperationId,
  })
}

export interface EmptyProjectDefaultCanvasClaimSourceV3 {
  resolve(input: Readonly<{
    projectId: ProjectIdV2
    projectEpoch: Id128V2
    projectIndexScope: DocumentScopeV2 & { readonly docKind: "project-index"; readonly docId: "project-index" }
    ownerActorId: ActorIdV2
  }>): Promise<VerifiedV10EmptyProjectDefaultCanvasV3>
}

export function createDeterministicEmptyProjectDefaultCanvasClaimSourceV3(): EmptyProjectDefaultCanvasClaimSourceV3 {
  return Object.freeze({
    async resolve(input: Parameters<EmptyProjectDefaultCanvasClaimSourceV3["resolve"]>[0]) { return deriveEmptyProjectDefaultCanvasClaimV3(input) },
  })
}

function idFrom(seed: unknown, purpose: "stage-operation" | "shard-epoch"): Id128V2 {
  const digest = ordinarySha256V2(encodeRestrictedJcsV2(Object.freeze({
    format: "convax.empty-project-default-canvas-id/3",
    purpose,
    seed,
  })))
  const bytes = Uint8Array.from(digest.slice(0, 32).match(/../gu)!, (pair) => Number.parseInt(pair, 16))
  return parseId128V2(encodeBase64urlV2(bytes))
}
