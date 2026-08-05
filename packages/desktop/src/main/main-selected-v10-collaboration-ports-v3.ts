import { parseProjectIdV2, type ProjectIdV2 } from "@convax/collaboration"

import type { CanvasCollaborationSessionOwnerV2 } from "./canvas-collaboration-session-owner"
import type { MainProjectIndexRuntimeRegistryV2 } from "./main-project-index-runtime-registry"
import type { MainSelectedProjectCollaborationPortsV3 } from "./project-collaboration-composition-v3"
import type { MainProjectCanvasRouteRuntimeRegistryV2 } from "./project-canvas-route-runtime-registry"

/**
 * Adapts the existing frozen V10 owner ports into the protocol-neutral facade.
 * It selects the Project route before publication and never constructs V3 or
 * Team authority. Shared and non-pristine V10 Projects continue through this
 * exact runtime.
 */
export async function openMainSelectedV10CollaborationPortsV3(input: Readonly<{
  projectId: ProjectIdV2
  projectIndexes: MainProjectIndexRuntimeRegistryV2
  canvasSessions: CanvasCollaborationSessionOwnerV2
  canvasRoutes: Pick<MainProjectCanvasRouteRuntimeRegistryV2, "switchProject" | "quiesceProject">
}>): Promise<MainSelectedProjectCollaborationPortsV3> {
  const projectId = parseProjectIdV2(input.projectId)
  await input.canvasRoutes.switchProject(projectId)
  let quiesced = false
  return Object.freeze({
    projectId,
    protocol: "v10-r5",
    projectIndexes: input.projectIndexes,
    canvasSessions: input.canvasSessions,
    async quiesce() {
      if (quiesced) return
      quiesced = true
      await input.canvasSessions.quiesceProject(projectId)
      await input.canvasRoutes.quiesceProject(projectId)
      await input.projectIndexes.quiesceProject(projectId)
    },
  })
}
