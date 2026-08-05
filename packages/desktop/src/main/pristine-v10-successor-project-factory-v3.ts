import {
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  type DigestV2,
  type ProjectIdV2,
} from "@convax/collaboration"
import type {
  OpenSuccessorProjectProtocolStateV3,
  PreparedVerifiedV10PromotionV3,
  PromoteVerifiedV10ProjectInputV3,
  SuccessorLocalProjectProvisionResultV3,
  SuccessorLocalProjectProvisionerV3,
} from "@convax/project/node"

import type { MainProjectCollaborationSelectionContextV3 } from "./main-project-collaboration-port-resolver-v3"
import type { MainSuccessorProjectCollaborationFactoryV3 } from "./main-project-collaboration-production-composition-v3"
import type { MainSelectedProjectCollaborationPortsV3 } from "./project-collaboration-composition-v3"

export interface ClaimBoundPristineV10PromotionRuntimeV3 {
  dispose(): Promise<void>
}

export interface PristineV10SuccessorProjectContextV3
  extends Omit<MainProjectCollaborationSelectionContextV3, "provisioner"> {
  /** Project/node owns claim encoding, inspection and the final protocol CAS. */
  readonly provisioner: Pick<
    SuccessorLocalProjectProvisionerV3,
    "prepareVerifiedV10Promotion" | "promoteVerifiedV10"
  >
  /**
   * Opens the temporary genesis writer bound to the exact installed claim.
   * The returned runtime must not contain Team, API, rendezvous or PeerJS ports.
   */
  openClaimBoundPromotion(claimDigest: DigestV2): Promise<ClaimBoundPristineV10PromotionRuntimeV3>
  /** Opens only the already-selected durable V3 local-owner runtime. */
  openSelectedLocal(
    state: Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>,
  ): Promise<MainSelectedProjectCollaborationPortsV3>
}

export interface PristineV10SuccessorProjectContextSourceV3 {
  open(projectId: ProjectIdV2): Promise<PristineV10SuccessorProjectContextV3>
}

/**
 * Narrow production successor factory for pristine, unshared R5 Projects.
 *
 * It deliberately separates claim installation from genesis publication. The
 * only V3 writer that may exist before the protocol pointer CAS is constructed
 * from the exact durable claim digest and is always disposed after the attempt.
 * Shared and non-pristine V10 Projects are rejected by Project/node and remain
 * on the frozen V10 path selected by the outer resolver.
 */
export function createPristineV10SuccessorProjectFactoryV3(input: Readonly<{
  successorProtocolDigest: DigestV2
  contexts: PristineV10SuccessorProjectContextSourceV3
}>): MainSuccessorProjectCollaborationFactoryV3 {
  const successorProtocolDigest = parseDigestV2(input.successorProtocolDigest)
  const contexts = new Map<ProjectIdV2, Promise<PristineV10SuccessorProjectContextV3>>()

  const factory: MainSuccessorProjectCollaborationFactoryV3 = Object.freeze({
    async resolveContext(projectIdInput: ProjectIdV2) {
      const projectId = parseProjectIdV2(projectIdInput)
      const context = await resolve(projectId)
      requireContext(context, projectId)
      return Object.freeze({
        projectId,
        projectEpoch: parseId128V2(context.projectEpoch),
        protocolStore: context.protocolStore,
        provisioner: Object.freeze({
          promoteVerifiedV10: (request: PromoteVerifiedV10ProjectInputV3) =>
            promote(context, request),
        }),
      })
    },
    async openLocal({ context: selected, state }: Readonly<{
      context: MainProjectCollaborationSelectionContextV3
      state: Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>
    }>) {
      const context = await resolve(parseProjectIdV2(selected.projectId))
      requireContext(context, selected.projectId)
      if (state.state.protocolDigest !== successorProtocolDigest) {
        throw new Error("Persisted local protocol does not select the verified successor")
      }
      const ports = await context.openSelectedLocal(state)
      if (ports.projectId !== selected.projectId || ports.protocol !== "v11-r1-local-owner") {
        await Promise.resolve(ports.dispose?.()).catch(() => undefined)
        throw new Error("Selected local ports crossed their Project or protocol binding")
      }
      return ports
    },
  })
  return factory

  function resolve(projectId: ProjectIdV2): Promise<PristineV10SuccessorProjectContextV3> {
    let promised = contexts.get(projectId)
    if (!promised) {
      promised = input.contexts.open(projectId)
      contexts.set(projectId, promised)
      void promised.catch(() => {
        if (contexts.get(projectId) === promised) contexts.delete(projectId)
      })
    }
    return promised
  }

  async function promote(
    context: PristineV10SuccessorProjectContextV3,
    request: PromoteVerifiedV10ProjectInputV3,
  ): Promise<SuccessorLocalProjectProvisionResultV3> {
    requirePromotionRequest(context, request, successorProtocolDigest)
    const prepared: PreparedVerifiedV10PromotionV3 =
      await context.provisioner.prepareVerifiedV10Promotion(request)
    if (prepared.status !== "prepared") return prepared

    const claimDigest = parseDigestV2(prepared.claimDigest)
    const runtime = await context.openClaimBoundPromotion(claimDigest)
    try {
      // This second call is intentional: Project/node reopens the exact installed
      // claim and never repeats or substitutes the V10 inspection result.
      return await context.provisioner.promoteVerifiedV10(request)
    } finally {
      await runtime.dispose()
    }
  }
}

function requireContext(context: PristineV10SuccessorProjectContextV3, projectId: ProjectIdV2): void {
  if (parseProjectIdV2(context.projectId) !== projectId) {
    throw new Error("Successor Project context crossed its Project binding")
  }
  parseId128V2(context.projectEpoch)
}

function requirePromotionRequest(
  context: PristineV10SuccessorProjectContextV3,
  request: PromoteVerifiedV10ProjectInputV3,
  protocolDigest: DigestV2,
): void {
  if (
    parseProjectIdV2(request.projectId) !== context.projectId ||
    parseId128V2(request.projectEpoch) !== context.projectEpoch ||
    parseDigestV2(request.protocolDigest) !== protocolDigest
  ) {
    throw new Error("Promotion request crossed its Project or verified protocol binding")
  }
  parseId128V2(request.promotionId)
}
