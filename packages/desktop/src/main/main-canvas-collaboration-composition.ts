import {
  createCanvasReconstructionYDoc,
  createCanvasDocumentOwnerRuntime,
  requiredCanvasBlobDigests,
} from "@convax/canvas/collaboration"
import {
  type CollaborationKernelOptions,
  type DocumentOwnerRuntime,
  type Id128,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import type { ProjectIndexCanvasApplicationPort } from "@convax/project/canvas"
import type { CanvasSubmitDiagnosticsPort } from "@convax/canvas/application"
import type {
  NodeProjectCollaborationRuntimeCoordinator,
  ProjectCollaborationRuntimeLease,
} from "@convax/project/node"

import {
  createCanvasCollaborationSessionOwner,
  type CanvasApplicationCommandAdapter,
  type CanvasCollaborationSessionOwner,
} from "./canvas-collaboration-session-owner"
import type {
  CurrentLocalReplicaAuthoritySource,
  IncomingReplicaAuthoritySource,
} from "./collaboration-authority-ports"
import type { ProjectCollaborationMaterializerRegistry } from "./collaboration-production-runtime"
import {
  createRouteScopedCanvasFactResolver,
  createRouteScopedCanvasIncomingFactResolver,
  type CanvasRouteArtifactAuthority,
  type CanvasRouteExternalFactAuthority,
} from "./canvas-route-external-facts"
import {
  createProductionCanvasRouteRuntimeOpener,
  MainProjectCanvasRouteRuntimeRegistry,
} from "./project-canvas-route-runtime-registry"

export interface MainCanvasCollaborationComposition {
  readonly sessions: CanvasCollaborationSessionOwner
  readonly routes: MainProjectCanvasRouteRuntimeRegistry
  dispose(): Promise<void>
}

export function createMainCanvasOwnerRuntime(
  authority: CurrentProtocolAuthority,
): DocumentOwnerRuntime<"canvas"> {
  return createCanvasDocumentOwnerRuntime(authority)
}

/**
 * Closed Main composition seam. Domain mapping/facts are injected explicitly;
 * Desktop never casts an old reducer command or mints a proof.
 */
export function createMainCanvasCollaborationComposition(input: {
  readonly authority: CurrentProtocolAuthority
  /** Share this runtime with Canvas genesis build/verification when available. */
  readonly canvasOwner?: DocumentOwnerRuntime<"canvas">
  readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinator, "acquire">
  readonly projectIndexes: ProjectIndexCanvasApplicationPort
  readonly materializers: ProjectCollaborationMaterializerRegistry
  readonly localAuthority: (project: ProjectCollaborationRuntimeLease) => CurrentLocalReplicaAuthoritySource
  readonly incomingAuthority: IncomingReplicaAuthoritySource
  readonly signatureVerifier: CollaborationKernelOptions["signatureVerifier"]
  readonly applicationCommands: CanvasApplicationCommandAdapter
  readonly createOperationId: () => Id128
  readonly createSessionId: () => Id128
  readonly createCursorToken: () => Id128
  readonly artifactAuthority?: CanvasRouteArtifactAuthority
  readonly factAuthority?: CanvasRouteExternalFactAuthority
  readonly diagnostics?: CanvasSubmitDiagnosticsPort
}): MainCanvasCollaborationComposition {
  const canvasOwner = input.canvasOwner ?? createMainCanvasOwnerRuntime(input.authority)
  const resolveFacts = createRouteScopedCanvasFactResolver({
    factory: canvasOwner.externalFactPortFactory,
    ...(input.artifactAuthority ? { artifacts: input.artifactAuthority } : {}),
    ...(input.factAuthority ? { facts: input.factAuthority } : {}),
  })
  const routes = new MainProjectCanvasRouteRuntimeRegistry({
    catalogs: input.projectIndexes,
    projects: input.projects,
    runtime: createProductionCanvasRouteRuntimeOpener({
      authority: input.authority,
      localAuthority: input.localAuthority,
      incomingAuthority: input.incomingAuthority,
      materializers: input.materializers,
      signatureVerifier: input.signatureVerifier,
      createOperationId: input.createOperationId,
      describeCanvas({ scope }) {
        return {
          owner: canvasOwner,
          createDocument: createCanvasReconstructionYDoc,
          incomingFacts: createRouteScopedCanvasIncomingFactResolver({ scope, resolve: resolveFacts }),
          requiredBlobDigests: requiredCanvasBlobDigests,
        }
      },
    }),
  })
  const sessions = createCanvasCollaborationSessionOwner({
    createSessionId: input.createSessionId,
    createCursorToken: input.createCursorToken,
    openDocumentSession: (ref) => routes.openDocumentSession(ref),
    resolveFacts: ({ scope, dependencies, signal }) => resolveFacts({ scope, dependencies, signal }),
    applicationCommands: input.applicationCommands,
    diagnostics: input.diagnostics,
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
