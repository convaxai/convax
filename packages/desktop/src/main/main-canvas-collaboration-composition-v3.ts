import {
  createCanvasReconstructionYDocV2,
  requiredCanvasBlobDigestsV2,
} from "@convax/canvas/collaboration"
import type {
  CollaborationKernelOptionsV2,
  DocumentOwnerRuntimeV2,
  Id128V2,
  ProjectIdV2,
  VerifiedProtocolAuthorityV2,
  VerifiedProtocolAuthorityV3,
} from "@convax/collaboration"
import type { ProjectIndexCanvasApplicationPortV2 } from "@convax/project/canvas"
import type { NodeProjectCollaborationRuntimeCoordinatorV2 } from "@convax/project/node"

import {
  createCanvasCollaborationSessionOwnerV2,
  type CanvasApplicationCommandAdapterV2,
  type CanvasCollaborationSessionOwnerV2,
} from "./canvas-collaboration-session-owner"
import { createMainCanvasOwnerRuntimeV2 } from "./main-canvas-collaboration-composition"
import {
  createRouteScopedCanvasFactResolverV2,
  createRouteScopedCanvasIncomingFactResolverV3,
  type CanvasRouteArtifactAuthorityV2,
  type CanvasRouteExternalFactAuthorityV2,
} from "./canvas-route-external-facts"
import { MainProjectCanvasRouteRuntimeRegistryV2 } from "./project-canvas-route-runtime-registry"
import { createProductionCanvasRouteRuntimeOpenerV3 } from "./project-canvas-route-runtime-opener-v3"
import type { MainProjectCollaborationProductionRuntimeV3 } from "./successor-collaboration-production-runtime"

export interface MainCanvasCollaborationCompositionV3 {
  readonly sessions: CanvasCollaborationSessionOwnerV2
  readonly routes: MainProjectCanvasRouteRuntimeRegistryV2
  dispose(): Promise<void>
}

/**
 * V11 local-owner Canvas composition. It deliberately has no Team, Control,
 * rendezvous or PeerJS input; explicit sharing owns that later transition.
 */
export function createMainCanvasCollaborationCompositionV3(input: {
  readonly projectId: ProjectIdV2
  readonly authority: VerifiedProtocolAuthorityV3
  readonly historicalAuthority: VerifiedProtocolAuthorityV2
  readonly runtime: MainProjectCollaborationProductionRuntimeV3
  readonly canvasOwner?: DocumentOwnerRuntimeV2<"canvas">
  readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinatorV2, "acquire">
  readonly projectIndexes: ProjectIndexCanvasApplicationPortV2
  readonly signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  readonly applicationCommands: CanvasApplicationCommandAdapterV2
  readonly createOperationId: () => Id128V2
  readonly createSessionId: () => Id128V2
  readonly createCursorToken: () => Id128V2
  readonly artifactAuthority?: CanvasRouteArtifactAuthorityV2
  readonly factAuthority?: CanvasRouteExternalFactAuthorityV2
}): MainCanvasCollaborationCompositionV3 {
  const canvasOwner = input.canvasOwner ?? createMainCanvasOwnerRuntimeV2(input.historicalAuthority)
  const resolveFacts = createRouteScopedCanvasFactResolverV2({
    factory: canvasOwner.externalFactPortFactory,
    ...(input.artifactAuthority ? { artifacts: input.artifactAuthority } : {}),
    ...(input.factAuthority ? { facts: input.factAuthority } : {}),
  })
  const routes = new MainProjectCanvasRouteRuntimeRegistryV2({
    catalogs: input.projectIndexes,
    projects: input.projects,
    runtime: createProductionCanvasRouteRuntimeOpenerV3({
      projectId: input.projectId,
      authority: input.authority,
      historicalAuthority: input.historicalAuthority,
      runtime: input.runtime,
      signatureVerifier: input.signatureVerifier,
      createOperationId: input.createOperationId,
      describeCanvas({ scope }) {
        return {
          owner: canvasOwner,
          createDocument: createCanvasReconstructionYDocV2,
          incomingFacts: createRouteScopedCanvasIncomingFactResolverV3({ scope, resolve: resolveFacts }),
          requiredBlobDigests: requiredCanvasBlobDigestsV2,
        }
      },
    }),
  })
  const sessions = createCanvasCollaborationSessionOwnerV2({
    createSessionId: input.createSessionId,
    createCursorToken: input.createCursorToken,
    openDocumentSession: (ref) => routes.openDocumentSession(ref),
    resolveFacts: ({ scope, dependencies, signal }) => resolveFacts({ scope, dependencies, signal }),
    applicationCommands: input.applicationCommands,
  })
  let disposed = false
  return Object.freeze({
    sessions,
    routes,
    async dispose() {
      if (disposed) return
      disposed = true
      sessions.dispose()
      await routes.dispose()
    },
  })
}
