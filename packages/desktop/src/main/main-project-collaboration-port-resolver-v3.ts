import {
  parseId128V2,
  parseDigestV2,
  parseProjectIdV2,
  type DigestV2,
  type Id128V2,
  type ProjectIdV2,
} from "@convax/collaboration"
import type {
  NodeSuccessorProjectProtocolStateStoreV3,
  OpenSuccessorProjectProtocolStateV3,
  SuccessorLocalProjectProvisionerV3,
} from "@convax/project/node"

import type {
  MainProjectCollaborationPortResolverV3,
  MainProjectCollaborationResolutionV3,
  MainSelectedProjectCollaborationPortsV3,
} from "./project-collaboration-composition-v3"

export interface MainProjectCollaborationSelectionContextV3 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly protocolStore: Pick<NodeSuccessorProjectProtocolStateStoreV3, "open" | "recoverPromotion">
  readonly provisioner: Pick<SuccessorLocalProjectProvisionerV3, "promoteVerifiedV10">
}

export interface MainProjectCollaborationPortResolverDependenciesV3 {
  /**
   * Resolves only Project-owned native state. This factory must not consult
   * network, Team availability or directory presence to choose a protocol.
   */
  resolveContext(projectId: ProjectIdV2): Promise<MainProjectCollaborationSelectionContextV3>
  /** Digest from the already-verified, selected V11 authority. */
  readonly successorProtocolDigest: DigestV2
  readonly createPromotionId: () => Id128V2
  /** Opens the already-verified frozen V10 runtime, including shared/non-pristine Projects. */
  openV10(context: MainProjectCollaborationSelectionContextV3): Promise<MainSelectedProjectCollaborationPortsV3>
  /** Opens the V11 local-owner runtime selected by the exact persisted state. */
  openV3Local(input: Readonly<{
    context: MainProjectCollaborationSelectionContextV3
    state: Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>
  }>): Promise<MainSelectedProjectCollaborationPortsV3>
}

/**
 * Closed per-Project protocol selector for Desktop Main.
 *
 * The Project-owned active protocol pointer is the only V3 selector. An absent
 * pointer may trigger the narrow verified-R5 promotion attempt; it never makes
 * successor owner files, Team/network availability or a directory scan active.
 */
export function createMainProjectCollaborationPortResolverV3(
  dependencies: MainProjectCollaborationPortResolverDependenciesV3,
): MainProjectCollaborationPortResolverV3 {
  return Object.freeze({
    async resolve(projectIdInput: ProjectIdV2): Promise<MainProjectCollaborationResolutionV3> {
      const projectId = parseProjectIdV2(projectIdInput)
      const context = await dependencies.resolveContext(projectId)
      requireContext(context, projectId)

      let opened = await context.protocolStore.open(projectId)
      if (opened.status === "promotion-recovery-required") {
        opened = await context.protocolStore.recoverPromotion()
      }

      switch (opened.status) {
        case "v3-local":
          if (opened.state.protocolDigest !== parseDigestV2(dependencies.successorProtocolDigest)) {
            return unavailable("evidence-corrupt")
          }
          return ready(await openV3Local(dependencies, context, opened), projectId, "v11-r1-local-owner")
        case "recovery-required":
        case "promotion-recovery-required":
          return unavailable("promotion-ambiguous")
        case "not-installed":
          return resolveUnselectedV10(dependencies, context)
      }
    },
  })
}

async function resolveUnselectedV10(
  dependencies: MainProjectCollaborationPortResolverDependenciesV3,
  context: MainProjectCollaborationSelectionContextV3,
): Promise<MainProjectCollaborationResolutionV3> {
  const promotion = await context.provisioner.promoteVerifiedV10({
    projectId: context.projectId,
    projectEpoch: context.projectEpoch,
    // The provisioner binds this value into the promotion bridge. The concrete
    // factory must close it over the verified V11 authority rather than accept it
    // from Renderer, IPC or a Project directory.
    protocolDigest: parseDigestV2(dependencies.successorProtocolDigest),
    promotionId: parseId128V2(dependencies.createPromotionId()),
  })

  if (promotion.status === "ready") {
    const reopened = await context.protocolStore.open(context.projectId)
    if (reopened.status !== "v3-local" || reopened.stateDigest !== promotion.stateDigest) {
      return unavailable("evidence-corrupt")
    }
    if (reopened.state.protocolDigest !== parseDigestV2(dependencies.successorProtocolDigest)) {
      return unavailable("evidence-corrupt")
    }
    return ready(await openV3Local(dependencies, context, reopened), context.projectId, "v11-r1-local-owner")
  }

  switch (promotion.reason) {
    case "shared":
    case "invalid-v10":
      // "invalid-v10" includes non-pristine V10, which the narrow promoter is
      // intentionally unable to upgrade. The frozen V10 runtime still performs
      // its own complete verification and remains the only legal reader/writer.
      return resolveV10AfterRejectedPromotion(dependencies, context)
    case "ambiguous":
    case "promotion-recovery-required":
      return unavailable("promotion-ambiguous")
  }
}

async function resolveV10AfterRejectedPromotion(
  dependencies: MainProjectCollaborationPortResolverDependenciesV3,
  context: MainProjectCollaborationSelectionContextV3,
): Promise<MainProjectCollaborationResolutionV3> {
  // Close the promotion/open race before V10 acquires its writer. A concurrent
  // durable V3 selector always dominates the earlier V10 inspection result.
  const selected = await context.protocolStore.open(context.projectId)
  if (selected.status === "v3-local") {
    if (selected.state.protocolDigest !== parseDigestV2(dependencies.successorProtocolDigest)) {
      return unavailable("evidence-corrupt")
    }
    return ready(await openV3Local(dependencies, context, selected), context.projectId, "v11-r1-local-owner")
  }
  if (selected.status !== "not-installed") return unavailable("promotion-ambiguous")
  return ready(await dependencies.openV10(context), context.projectId, "v10-r5")
}

async function openV3Local(
  dependencies: MainProjectCollaborationPortResolverDependenciesV3,
  context: MainProjectCollaborationSelectionContextV3,
  state: Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>,
) {
  if (state.state.projectId !== context.projectId || state.state.projectEpoch !== context.projectEpoch) {
    throw new Error("Persisted V3 selection crossed its Project binding")
  }
  return dependencies.openV3Local({ context, state })
}

function requireContext(context: MainProjectCollaborationSelectionContextV3, projectId: ProjectIdV2): void {
  if (parseProjectIdV2(context.projectId) !== projectId) throw new Error("Protocol context crossed its Project binding")
  parseId128V2(context.projectEpoch)
}

function ready(
  ports: MainSelectedProjectCollaborationPortsV3,
  projectId: ProjectIdV2,
  protocol: MainSelectedProjectCollaborationPortsV3["protocol"],
): MainProjectCollaborationResolutionV3 {
  if (ports.projectId !== projectId || ports.protocol !== protocol) {
    throw new Error("Selected collaboration ports crossed their Project or protocol binding")
  }
  return Object.freeze({ status: "ready", ports })
}

function unavailable(
  reason: Extract<MainProjectCollaborationResolutionV3, { status: "unavailable" }>["reason"],
): MainProjectCollaborationResolutionV3 {
  return Object.freeze({ status: "unavailable", reason })
}
