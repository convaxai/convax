import {
  createCanvasReconstructionYDocV2,
  requiredCanvasBlobDigestsV2,
  selectedCanvasDocumentOwnerArtifactDefinitionV2,
} from "@convax/canvas/collaboration"
import {
  createSelectedDocumentOwnerArtifactFactoryV2,
  type CollaborationKernelOptionsV2,
  type DocumentOwnerRuntimeV2,
  type Id128V2,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"
import type { ProjectIndexCanvasApplicationPortV2 } from "@convax/project/canvas"
import type { NodeProjectCollaborationRuntimeCoordinatorV2 } from "@convax/project/node"

import {
  createCanvasCollaborationSessionOwnerV2,
  type CanvasApplicationCommandAdapterV2,
  type CanvasCollaborationSessionOwnerV2,
} from "./canvas-collaboration-session-owner"
import type {
  CurrentLocalReplicaAuthoritySourceV2,
  IncomingReplicaAuthoritySourceV2,
} from "./collaboration-authority-ports"
import type { ProjectCollaborationMaterializerRegistryV2 } from "./collaboration-production-runtime"
import {
  createRouteScopedCanvasFactResolverV2,
  createRouteScopedCanvasIncomingFactResolverV2,
  type CanvasRouteArtifactAuthorityV2,
  type CanvasRouteExternalFactAuthorityV2,
} from "./canvas-route-external-facts"
import {
  createProductionCanvasRouteRuntimeOpenerV2,
  MainProjectCanvasRouteRuntimeRegistryV2,
} from "./project-canvas-route-runtime-registry"

export interface MainCanvasCollaborationCompositionV2 {
  readonly sessions: CanvasCollaborationSessionOwnerV2
  readonly routes: MainProjectCanvasRouteRuntimeRegistryV2
  dispose(): Promise<void>
}

export function createMainCanvasOwnerRuntimeV2(
  authority: VerifiedProtocolAuthorityV2,
): DocumentOwnerRuntimeV2<"canvas"> {
  const selected = createSelectedDocumentOwnerArtifactFactoryV2(authority, "canvas")
    .createRuntime(selectedCanvasDocumentOwnerArtifactDefinitionV2)
  if ("status" in selected) throw new Error(`Canvas owner runtime is ${selected.code}`)
  return selected
}

/**
 * Closed Main composition seam. Domain mapping/facts are injected explicitly;
 * Desktop never casts an old reducer command or mints a proof.
 */
export function createMainCanvasCollaborationCompositionV2(input: {
  readonly authority: VerifiedProtocolAuthorityV2
  /** Share this runtime with Canvas genesis build/verification when available. */
  readonly canvasOwner?: DocumentOwnerRuntimeV2<"canvas">
  readonly projects: Pick<NodeProjectCollaborationRuntimeCoordinatorV2, "acquire">
  readonly projectIndexes: ProjectIndexCanvasApplicationPortV2
  readonly materializers: ProjectCollaborationMaterializerRegistryV2
  readonly localAuthority: CurrentLocalReplicaAuthoritySourceV2
  readonly incomingAuthority: IncomingReplicaAuthoritySourceV2
  readonly signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  readonly applicationCommands: CanvasApplicationCommandAdapterV2
  readonly createOperationId: () => Id128V2
  readonly createSessionId: () => Id128V2
  readonly createCursorToken: () => Id128V2
  readonly artifactAuthority?: CanvasRouteArtifactAuthorityV2
  readonly factAuthority?: CanvasRouteExternalFactAuthorityV2
}): MainCanvasCollaborationCompositionV2 {
  const canvasOwner = input.canvasOwner ?? createMainCanvasOwnerRuntimeV2(input.authority)
  const resolveFacts = createRouteScopedCanvasFactResolverV2({
    factory: canvasOwner.externalFactPortFactory,
    ...(input.artifactAuthority ? { artifacts: input.artifactAuthority } : {}),
    ...(input.factAuthority ? { facts: input.factAuthority } : {}),
  })
  const routes = new MainProjectCanvasRouteRuntimeRegistryV2({
    catalogs: input.projectIndexes,
    projects: input.projects,
    runtime: createProductionCanvasRouteRuntimeOpenerV2({
      authority: input.authority,
      localAuthority: input.localAuthority,
      incomingAuthority: input.incomingAuthority,
      materializers: input.materializers,
      signatureVerifier: input.signatureVerifier,
      createOperationId: input.createOperationId,
      describeCanvas({ scope }) {
        return {
          owner: canvasOwner,
          createDocument: createCanvasReconstructionYDocV2,
          incomingFacts: createRouteScopedCanvasIncomingFactResolverV2({ scope, resolve: resolveFacts }),
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
