import type {
  CollaborationKernelOptionsV2,
  Id128V2,
  ProjectIdV2,
  VerifiedProtocolAuthorityV2,
  VerifiedProtocolAuthorityV3,
} from "@convax/collaboration"
import type { NodeProjectCollaborationRuntimeCoordinatorV2 } from "@convax/project/node"

import type { CanvasApplicationCommandAdapterV2 } from "./canvas-collaboration-session-owner"
import {
  createMainCanvasCollaborationCompositionV3,
  type MainCanvasCollaborationCompositionV3,
} from "./main-canvas-collaboration-composition-v3"
import {
  createMainProjectIndexRuntimeRegistryV3,
  type MainProjectIndexDescriptorV3,
  type MainProjectIndexRuntimeRegistryV3,
  type MainProjectIndexScopeV3,
} from "./main-project-index-runtime-registry-v3"
import type { MainSelectedProjectCollaborationPortsV3 } from "./project-collaboration-composition-v3"
import type { MainProjectCollaborationProductionRuntimeV3 } from "./successor-collaboration-production-runtime"

/**
 * Resolver-ready V11 local ports. This is the only composition in this module
 * and intentionally has no Team/control-plane transport dependencies.
 */
export async function createMainLocalProjectCollaborationPortsV3(input: {
  readonly projectId: ProjectIdV2
  readonly authority: VerifiedProtocolAuthorityV3
  readonly historicalAuthority: VerifiedProtocolAuthorityV2
  readonly runtime: MainProjectCollaborationProductionRuntimeV3
  readonly projectIndexScope: MainProjectIndexScopeV3
  readonly projectIndex: MainProjectIndexDescriptorV3
  readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinatorV2, "acquire">
  readonly signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  readonly applicationCommands: CanvasApplicationCommandAdapterV2
  readonly createOperationId: () => Id128V2
  readonly createShardEpoch: () => Id128V2
  readonly createSessionId: () => Id128V2
  readonly createCursorToken: () => Id128V2
}): Promise<MainSelectedProjectCollaborationPortsV3> {
  let projectIndexes: MainProjectIndexRuntimeRegistryV3 | undefined
  let canvas: MainCanvasCollaborationCompositionV3 | undefined
  try {
    projectIndexes = await createMainProjectIndexRuntimeRegistryV3({
      authority: input.authority,
      historicalAuthority: input.historicalAuthority,
      runtime: input.runtime,
      scope: input.projectIndexScope,
      descriptor: input.projectIndex,
      signatureVerifier: input.signatureVerifier,
      createOperationId: input.createOperationId,
      createShardEpoch: input.createShardEpoch,
    })
    canvas = createMainCanvasCollaborationCompositionV3({
      projectId: input.projectId,
      authority: input.authority,
      historicalAuthority: input.historicalAuthority,
      runtime: input.runtime,
      projects: input.projects,
      projectIndexes,
      signatureVerifier: input.signatureVerifier,
      applicationCommands: input.applicationCommands,
      createOperationId: input.createOperationId,
      createSessionId: input.createSessionId,
      createCursorToken: input.createCursorToken,
    })
    await canvas.routes.switchProject(input.projectId)
    const selectedProjectIndexes = projectIndexes
    const selectedCanvas = canvas
    let disposed = false
    return Object.freeze({
      projectId: input.projectId,
      protocol: "v11-r1-local-owner" as const,
      projectIndexes: selectedProjectIndexes,
      canvasSessions: selectedCanvas.sessions,
      async quiesce() {
        if (disposed) return
        await selectedProjectIndexes.flush()
        await selectedCanvas.sessions.quiesceProject(input.projectId)
        await selectedCanvas.routes.quiesceProject(input.projectId)
      },
      async dispose() {
        if (disposed) return
        disposed = true
        await selectedCanvas.dispose()
        await selectedProjectIndexes.dispose()
        await input.runtime.dispose()
      },
    })
  } catch (error) {
    await canvas?.dispose().catch(() => undefined)
    await projectIndexes?.dispose().catch(() => undefined)
    await input.runtime.dispose().catch(() => undefined)
    throw error
  }
}
