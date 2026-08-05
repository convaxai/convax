import type { DigestV2, Id128V2, ProjectIdV2 } from "@convax/collaboration"
import type { OpenSuccessorProjectProtocolStateV3 } from "@convax/project/node"

import type { CanvasCollaborationSessionOwnerV2 } from "./canvas-collaboration-session-owner"
import type { MainProjectIndexRuntimeRegistryV2 } from "./main-project-index-runtime-registry"
import {
  createMainProjectCollaborationPortResolverV3,
  type MainProjectCollaborationSelectionContextV3,
} from "./main-project-collaboration-port-resolver-v3"
import {
  createMainProjectCollaborationCompositionFacadeV3,
  type MainProjectCollaborationCompositionFacadeV3,
  type MainSelectedProjectCollaborationPortsV3,
} from "./project-collaboration-composition-v3"
import type { MainProjectCanvasRouteRuntimeRegistryV2 } from "./project-canvas-route-runtime-registry"
import { openMainSelectedV10CollaborationPortsV3 } from "./main-selected-v10-collaboration-ports-v3"

/**
 * Exact successor factory injected by Desktop's native V3 composition. Its
 * implementation owns Project/node stores, the verified promotion inspector,
 * genesis adapter and createMainLocalProjectCollaborationPortsV3 wiring.
 */
export interface MainSuccessorProjectCollaborationFactoryV3 {
  resolveContext(projectId: ProjectIdV2): Promise<MainProjectCollaborationSelectionContextV3>
  openLocal(input: Readonly<{
    context: MainProjectCollaborationSelectionContextV3
    state: Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>
  }>): Promise<MainSelectedProjectCollaborationPortsV3>
}

/**
 * Production dual-version composition boundary. Both protocols feed the same
 * facade; no caller can select a protocol, authority path, digest or fallback.
 */
export function createMainProjectCollaborationProductionCompositionV3(input: Readonly<{
  successorProtocolDigest: DigestV2
  createPromotionId: (input: Readonly<{
    projectId: ProjectIdV2
    projectEpoch: Id128V2
    protocolDigest: DigestV2
  }>) => Id128V2
  successor: MainSuccessorProjectCollaborationFactoryV3
  v10: Readonly<{
    projectIndexes: MainProjectIndexRuntimeRegistryV2
    canvasSessions: CanvasCollaborationSessionOwnerV2
    canvasRoutes: Pick<MainProjectCanvasRouteRuntimeRegistryV2, "switchProject" | "quiesceProject">
  }>
}>): MainProjectCollaborationCompositionFacadeV3 {
  const resolver = createMainProjectCollaborationPortResolverV3({
    successorProtocolDigest: input.successorProtocolDigest,
    createPromotionId: input.createPromotionId,
    resolveContext: async (projectId) => {
      await input.v10.canvasSessions.quiesceProject(projectId)
      await input.v10.canvasRoutes.quiesceProject(projectId)
      await input.v10.projectIndexes.quiesceProject(projectId)
      try {
        return await input.successor.resolveContext(projectId)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        // A brand-new or never-registered local Project has no collaboration
        // directory yet. Publish the existing atomic V10 empty genesis, fully
        // quiesce that temporary writer, then let the successor inspect/promote
        // the now-complete immutable bootstrap.
        const bootstrap = await openMainSelectedV10CollaborationPortsV3({
          projectId,
          projectIndexes: input.v10.projectIndexes,
          canvasSessions: input.v10.canvasSessions,
          canvasRoutes: input.v10.canvasRoutes,
        })
        await bootstrap.quiesce?.()
        return input.successor.resolveContext(projectId)
      }
    },
    openV3Local: (selected) => input.successor.openLocal(selected),
    openV10: ({ projectId }) => openMainSelectedV10CollaborationPortsV3({
      projectId,
      projectIndexes: input.v10.projectIndexes,
      canvasSessions: input.v10.canvasSessions,
      canvasRoutes: input.v10.canvasRoutes,
    }),
  })
  return createMainProjectCollaborationCompositionFacadeV3(resolver)
}
