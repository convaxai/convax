import path from "node:path"

import {
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseProjectIdV2,
  replicaActorHeadSetDigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type ProjectIdV2,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"
import { CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/canvas/collaboration"
import { PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2 } from "@convax/project"
import {
  NodeCollaborationPersistenceV2,
  readProjectNativeStoreManifestV2,
  type NodeAcceptedReplicaHeadV2,
  type NodeSuccessorLocalOwnerAuthorityStoreV3,
  type EmptyProjectDefaultCanvasClaimSourceV3,
  type VerifiedV10EmptyProjectDefaultCanvasV3,
  type VerifiedV10PromotionInspectionPortV3,
  type VerifiedV10PromotionInspectionV3,
} from "@convax/project/node"

import type { NodeDurableTeamAuthorityStoreV1 } from "./durable-team-authority-store"
import type {
  DurableLocalProjectOwnerAuthorityResolverV2,
  NodeDurableLocalProjectOwnerAuthorityV2,
} from "./local-project-owner-authority"
import { verifyPristineLocalOwnerProjectIndexNativeStoreV2 } from "./main-project-index-runtime-registry"

export type { EmptyProjectDefaultCanvasClaimSourceV3 as EmptyV10ProjectDefaultCanvasClaimSourceV3 } from "@convax/project/node"

/** SHA-256 of the sealed R5 authority.sha256 manifest named by the root contract. */
const R5_AUTHORITY_MANIFEST_SHA256 = parseDigestV2(
  "2d4fa5170d6501f7049a1f58fc1c691e210a6db92454da4ebc09dad9ab4596ed",
)

type ProjectIndexScopeV2 = DocumentScopeV2 & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

/**
 * Project owns the precommitted default-Canvas identity and creation claim.
 * Desktop only consumes and cross-checks the exact retry-stable result.
 */
export interface V10PromotionProjectRootSourceV3 {
  resolveProjectRoot(input: Readonly<{ projectId: ProjectIdV2 }>): Promise<string>
}

/**
 * Read-only production verifier for the narrow R5 pristine-local bootstrap.
 *
 * It deliberately does not support a general directory scan. A non-pristine R5
 * Project needs the full R5 route/frame verifier before it can be promoted; this
 * adapter returns invalid instead of treating directory presence as authority.
 */
export class VerifiedV10PromotionInspectionAdapterV3
  implements VerifiedV10PromotionInspectionPortV3
{
  constructor(private readonly options: Readonly<{
    authority: VerifiedProtocolAuthorityV2
    projects: V10PromotionProjectRootSourceV3
    owners: DurableLocalProjectOwnerAuthorityResolverV2 &
      Pick<NodeDurableLocalProjectOwnerAuthorityV2, "verifyCheckpointSignature">
    teamAuthority: Pick<NodeDurableTeamAuthorityStoreV1, "open">
    successorOwner: Pick<NodeSuccessorLocalOwnerAuthorityStoreV3, "open">
    emptyProjectDefaultCanvas: EmptyProjectDefaultCanvasClaimSourceV3
  }>) {}

  async inspect(input: Readonly<{
    projectId: ProjectIdV2
    projectEpoch: Id128V2
  }>): Promise<VerifiedV10PromotionInspectionV3> {
    let projectId: ProjectIdV2
    let projectEpoch: Id128V2
    try {
      projectId = parseProjectIdV2(input.projectId)
      projectEpoch = parseId128V2(input.projectEpoch)
    } catch {
      return invalid()
    }

    try {
      requireR5(this.options.authority)
      const projectRoot = await this.options.projects.resolveProjectRoot({ projectId })
      const collaborationDirectory = canonicalCollaborationDirectory(projectRoot)
      const manifest = await readProjectNativeStoreManifestV2(collaborationDirectory, {
        protocolDigest: this.options.authority.protocolDigest,
        schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
        uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      })
      if (
        manifest.projectIndexScope.projectId !== projectId ||
        manifest.projectIndexScope.projectEpoch !== projectEpoch
      ) return invalid()

      // A durable V10 Team selector dominates all local evidence. A malformed
      // selector is ambiguity, never proof that the Project is unshared.
      const team = await this.options.teamAuthority.open(projectId)
      if (team === "rejected") return ambiguous()
      if (team !== "missing") return shared()

      // A successor handoff/tombstone also dominates V10. Any predecessor record
      // already present means promotion is in progress and must be recovered by
      // the successor store rather than restarted from this inspection.
      const successor = await this.options.successorOwner.open(projectId, projectEpoch)
      if (successor.status === "shared") return shared()
      if (successor.status !== "missing") return ambiguous()

      const owner = await this.options.owners.resolveExact({
        projectId,
        projectEpoch,
        initializationAuthorityDigest: manifest.initializationAuthorityDigest,
      })
      if (owner === "missing" || owner === "rejected") return invalid()

      // This owner operation verifies the exact manifest-bound empty genesis,
      // its checkpoint signature, the installed base/head and the closed native
      // inventory. It rejects every frame, Canvas route and unknown native path.
      await verifyPristineLocalOwnerProjectIndexNativeStoreV2({
        authority: this.options.authority,
        collaborationDirectory,
        owner,
        verifyCheckpointSignature: (binding, coreDigest, signature) =>
          this.options.owners.verifyCheckpointSignature(binding, coreDigest, signature),
      })

      const durableHead = await readExactProjectIndexHead(
        collaborationDirectory,
        owner.binding.actorId,
        manifest.projectIndexScope,
      )
      const defaultCanvas = await this.options.emptyProjectDefaultCanvas.resolve({
        projectId,
        projectEpoch,
        projectIndexScope: manifest.projectIndexScope,
        ownerActorId: owner.binding.actorId,
      })
      const checkedDefaultCanvas = verifyDefaultCanvasClaim(defaultCanvas, projectId, projectEpoch)

      const document = Object.freeze({
        scope: manifest.projectIndexScope,
        ownerSchemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
        sourceHeadDigest: durableHead.headDigest,
        sourceFrontierDigest: durableHead.frontierDigest,
        authorizationProofDigest: manifest.initializationAuthorityDigest,
        durableCheckpointDigest: manifest.emptyProjectIndexCheckpointObjectDigest,
      })
      const verifiedLegacyClosureDigest = ordinarySha256V2(encodeRestrictedJcsV2(Object.freeze({
        format: "convax.verified-pristine-r5-promotion-closure/3",
        r5AuthorityManifestSha256: R5_AUTHORITY_MANIFEST_SHA256,
        protocolDigest: this.options.authority.protocolDigest,
        uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
        nativeManifest: manifest,
        durableHead: Object.freeze({
          headDigest: durableHead.headDigest,
          frontierDigest: durableHead.frontierDigest,
          canonicalStateDigest: durableHead.canonicalStateDigest,
        }),
        defaultCanvas: checkedDefaultCanvas,
      })))

      return Object.freeze({
        status: "verified-unshared",
        r5AuthorityManifestSha256: R5_AUTHORITY_MANIFEST_SHA256,
        verifiedLegacyClosureDigest,
        documents: Object.freeze([document]),
        emptyProjectDefaultCanvas: checkedDefaultCanvas,
      })
    } catch {
      // Native read, signature, manifest, inventory and exact-head failures are
      // invalid V10. Network availability is never consulted by this adapter.
      return invalid()
    }
  }
}

async function readExactProjectIndexHead(
  collaborationDirectory: string,
  localActorId: Parameters<typeof NodeCollaborationPersistenceV2.open>[0]["localActorId"],
  scope: ProjectIndexScopeV2,
): Promise<NodeAcceptedReplicaHeadV2> {
  const persistence = await NodeCollaborationPersistenceV2.open({
    collaborationDirectory,
    localActorId,
    materializer: Object.freeze({
      async inspectFrame() { throw new Error("Pristine ProjectIndex cannot contain a frame") },
      async applyAcceptedFrame() { throw new Error("Pristine ProjectIndex cannot contain a frame") },
      actorHeadsDigest: replicaActorHeadSetDigestV2,
    }),
  })
  try {
    const value = await persistence.loadReplicaHead(scope)
    return requireAcceptedHead(value, scope)
  } finally {
    persistence.dispose()
  }
}

function requireAcceptedHead(value: unknown, scope: ProjectIndexScopeV2): NodeAcceptedReplicaHeadV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("R5 durable head is invalid")
  const head = value as NodeAcceptedReplicaHeadV2
  const actualScope = parseDocumentScopeV2(head.scope)
  if (
    actualScope.docKind !== "project-index" ||
    actualScope.projectId !== scope.projectId ||
    actualScope.projectEpoch !== scope.projectEpoch ||
    actualScope.shardEpoch !== scope.shardEpoch
  ) throw new Error("R5 durable head crossed ProjectIndex scope")
  parseDigestV2(head.headDigest)
  parseDigestV2(head.frontierDigest)
  parseDigestV2(head.canonicalStateDigest)
  return head
}

function verifyDefaultCanvasClaim(
  input: VerifiedV10EmptyProjectDefaultCanvasV3,
  projectId: ProjectIdV2,
  projectEpoch: Id128V2,
): VerifiedV10EmptyProjectDefaultCanvasV3 {
  const scope = parseDocumentScopeV2(input.scope)
  if (
    scope.docKind !== "canvas" ||
    scope.projectId !== projectId ||
    scope.projectEpoch !== projectEpoch ||
    parseDigestV2(input.ownerSchemaDigest) !== CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2
  ) throw new Error("Default Canvas creation claim crossed its frozen Project scope")
  return Object.freeze({
    scope: scope as VerifiedV10EmptyProjectDefaultCanvasV3["scope"],
    ownerSchemaDigest: CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
    creationClaimDigest: parseDigestV2(input.creationClaimDigest),
    stageOperationId: parseId128V2(input.stageOperationId),
  })
}

function canonicalCollaborationDirectory(projectRoot: string): string {
  if (!path.isAbsolute(projectRoot) || path.resolve(projectRoot) !== projectRoot) {
    throw new Error("Project root must be canonical and absolute")
  }
  return path.join(projectRoot, ".convax", "collaboration")
}

function requireR5(authority: VerifiedProtocolAuthorityV2): void {
  if (
    authority.authorityId !== "collaboration-v10" ||
    authority.revision !== "r5" ||
    authority.sequence !== "1"
  ) throw new Error("V10 promotion requires the selected R5 authority")
}

function invalid(): VerifiedV10PromotionInspectionV3 {
  return Object.freeze({ status: "invalid" })
}

function ambiguous(): VerifiedV10PromotionInspectionV3 {
  return Object.freeze({ status: "ambiguous" })
}

function shared(): VerifiedV10PromotionInspectionV3 {
  return Object.freeze({ status: "shared" })
}
