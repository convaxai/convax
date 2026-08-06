import { parseProjectId } from "@convax/collaboration"

import type { CanvasCollaborationSessionOwnerV2 } from "./canvas-collaboration-session-owner"
import type { MainProjectIndexRuntimeRegistryV2 } from "./main-project-index-runtime-registry"
import {
  createMainProjectCollaborationCompositionFacadeV3,
  type MainProjectCollaborationCompositionFacadeV3,
} from "./project-collaboration-composition-v3"
import type { MainProjectCanvasRouteRuntimeRegistryV2 } from "./project-canvas-route-runtime-registry"
import { openMainSelectedV10CollaborationPortsV3 } from "./main-selected-v10-collaboration-ports-v3"

/**
 * Production composition boundary for the single current collaboration protocol.
 * Every Project resolves through the same owner ports; there is no protocol
 * selection, promotion bridge, successor runtime, or caller-selected authority.
 */
export function createMainProjectCollaborationProductionCompositionV3(input: Readonly<{
  projectIndexes: MainProjectIndexRuntimeRegistryV2
  canvasSessions: CanvasCollaborationSessionOwnerV2
  canvasRoutes: Pick<MainProjectCanvasRouteRuntimeRegistryV2, "switchProject" | "quiesceProject">
}>): MainProjectCollaborationCompositionFacadeV3 {
  return createMainProjectCollaborationCompositionFacadeV3({
    async resolve(projectIdInput) {
      const projectId = parseProjectId(projectIdInput)
      return Object.freeze({
        status: "ready" as const,
        ports: await openMainSelectedV10CollaborationPortsV3({
          projectId,
          projectIndexes: input.projectIndexes,
          canvasSessions: input.canvasSessions,
          canvasRoutes: input.canvasRoutes,
        }),
      })
    },
  })
}
