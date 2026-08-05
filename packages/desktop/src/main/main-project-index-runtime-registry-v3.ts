import {
  parseProjectIdV2,
  type CollaborationKernelOptionsV2,
  type DecodedCausalEditFrameV2,
  type DecodedCausalEditFrameV3,
  type DigestV2,
  type DocumentOwnerRuntimeV2,
  type DocumentScopeV2,
  type Id128V2,
  type IncomingOwnerFactResolverPortV3,
  type VerifiedProtocolAuthorityV2,
  type VerifiedProtocolAuthorityV3,
  type YjsDocumentFactoryV2,
} from "@convax/collaboration"
import {
  ProjectIndexFileApplicationV2,
  ProjectIndexCanvasApplicationV2,
  type ProjectIndexBlobPublicationPortV2,
  type ProjectCanvasGenesisStagingPortV2,
  type ProjectIndexCanvasApplicationPortV2,
  type ProjectIndexFactResolutionPortV2,
  type ProjectIndexFileApplicationPortV2,
  type ProjectIndexFileMaterializationProjectionPortV2,
} from "@convax/project/canvas"
import type { ProjectIndexCurrentBlobReferencePortV2 } from "@convax/project"

import {
  createKernelBackedMainCollaborationDocumentSessionV3,
  type MainCollaborationDocumentSessionV3,
} from "./collaboration-document-session"
import type {
  MainCollaborationProductionRuntimeV3,
  MainProjectCollaborationProductionRuntimeV3,
} from "./successor-collaboration-production-runtime"

export type MainProjectIndexScopeV3 = DocumentScopeV2 & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface MainProjectIndexDescriptorV3 {
  readonly owner: DocumentOwnerRuntimeV2<"project-index">
  readonly incomingFacts: IncomingOwnerFactResolverPortV3
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
  readonly requiredBlobDigests: (
    frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3,
  ) => readonly DigestV2[]
  readonly facts: ProjectIndexFactResolutionPortV2
  readonly canvasGenesis: ProjectCanvasGenesisStagingPortV2
  readonly blobs: ProjectIndexBlobPublicationPortV2
  readonly fileMaterialization: Readonly<{
    open(projection: ProjectIndexFileMaterializationProjectionPortV2): Promise<Readonly<{
      reconcile(): Promise<unknown>
    }>>
    subscribeBlobPublished(listener: () => void): () => void
    reportFailure(error: unknown): void
  }>
}

/** One persisted V11 Project owns exactly one ProjectIndex application instance. */
export interface MainProjectIndexRuntimeRegistryV3
  extends
    ProjectIndexCanvasApplicationPortV2,
    ProjectIndexCurrentBlobReferencePortV2,
    ProjectIndexFileApplicationPortV2,
    ProjectIndexFileMaterializationProjectionPortV2
{
  readonly scope: MainProjectIndexScopeV3
  flush(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Real V3 ProjectIndex composition. LocalCommitResultV3 crosses directly from the
 * V3 document session into the Project-owned application; this adapter never
 * decodes, converts or re-signs its frame or receipt.
 */
export async function createMainProjectIndexRuntimeRegistryV3(input: {
  readonly authority: VerifiedProtocolAuthorityV3
  readonly historicalAuthority: VerifiedProtocolAuthorityV2
  readonly runtime: MainProjectCollaborationProductionRuntimeV3
  readonly scope: MainProjectIndexScopeV3
  readonly descriptor: MainProjectIndexDescriptorV3
  readonly signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  readonly createOperationId: () => Id128V2
  readonly createShardEpoch: () => Id128V2
}): Promise<MainProjectIndexRuntimeRegistryV3> {
  const projectId = parseProjectIdV2(input.scope.projectId)
  if (input.scope.docKind !== "project-index" || input.scope.docId !== "project-index") {
    throw new TypeError("V3 ProjectIndex registry requires the exact ProjectIndex scope")
  }
  let documentRuntime: MainCollaborationProductionRuntimeV3<"project-index"> | undefined
  let session: MainCollaborationDocumentSessionV3<"project-index"> | undefined
  let disposeFileMaterialization: (() => void) | undefined
  try {
    const openedDocumentRuntime = await input.runtime.openDocument({
      scope: input.scope,
      owner: input.descriptor.owner,
      incomingFacts: input.descriptor.incomingFacts,
      createDocument: input.descriptor.createDocument,
      requiredBlobDigests: input.descriptor.requiredBlobDigests,
    })
    documentRuntime = openedDocumentRuntime
    const openedSession = await createKernelBackedMainCollaborationDocumentSessionV3({
      authority: input.authority,
      historicalAuthority: input.historicalAuthority,
      scope: input.scope,
      owner: input.descriptor.owner,
      ports: openedDocumentRuntime.ports,
      signatureVerifier: input.signatureVerifier,
      createOperationId: input.createOperationId,
    })
    session = openedSession
    const application = new ProjectIndexCanvasApplicationV2({
      session: openedSession,
      facts: input.descriptor.facts,
      genesis: input.descriptor.canvasGenesis,
      createOperationId: input.createOperationId,
      createShardEpoch: input.createShardEpoch,
    })
    const fileApplication = new ProjectIndexFileApplicationV2({
      session: openedSession,
      facts: input.descriptor.facts,
      blobs: input.descriptor.blobs,
      createOperationId: input.createOperationId,
    })
    const fileMaterializer = await input.descriptor.fileMaterialization.open(fileApplication)
    const scheduleFileMaterialization = () => {
      void fileMaterializer.reconcile().catch((error) => input.descriptor.fileMaterialization.reportFailure(error))
    }
    const unsubscribeSession = openedSession.subscribe(scheduleFileMaterialization)
    const unsubscribeBlobs = input.descriptor.fileMaterialization.subscribeBlobPublished(scheduleFileMaterialization)
    disposeFileMaterialization = () => {
      unsubscribeSession()
      unsubscribeBlobs()
    }
    await fileMaterializer.reconcile()
    let disposed = false
    return Object.freeze({
      scope: input.scope,
      queryCatalog(request: Parameters<ProjectIndexCanvasApplicationPortV2["queryCatalog"]>[0]) {
        requireProject(request.projectId)
        return application.queryCatalog({ projectId })
      },
      submitRouteCommand(request: Parameters<ProjectIndexCanvasApplicationPortV2["submitRouteCommand"]>[0]) {
        requireProject(request.projectId)
        return application.submitRouteCommand({ ...request, projectId })
      },
      queryCurrentBlobDigests(request: Parameters<ProjectIndexCurrentBlobReferencePortV2["queryCurrentBlobDigests"]>[0]) {
        requireProject(request.projectId)
        return application.queryCurrentBlobDigests({ projectId })
      },
      createDirectory(request: Parameters<ProjectIndexFileApplicationPortV2["createDirectory"]>[0]) {
        requireProject(request.projectId)
        return fileApplication.createDirectory({ ...request, projectId })
      },
      publishFile(request: Parameters<ProjectIndexFileApplicationPortV2["publishFile"]>[0]) {
        requireProject(request.projectId)
        return fileApplication.publishFile({ ...request, projectId })
      },
      relocateEntry(request: Parameters<ProjectIndexFileApplicationPortV2["relocateEntry"]>[0]) {
        requireProject(request.projectId)
        return fileApplication.relocateEntry({ ...request, projectId })
      },
      tombstoneEntry(request: Parameters<ProjectIndexFileApplicationPortV2["tombstoneEntry"]>[0]) {
        requireProject(request.projectId)
        return fileApplication.tombstoneEntry({ ...request, projectId })
      },
      queryFileMaterializationPlan(request: Parameters<ProjectIndexFileMaterializationProjectionPortV2["queryFileMaterializationPlan"]>[0]) {
        requireProject(request.projectId)
        return fileApplication.queryFileMaterializationPlan({ projectId })
      },
      flush() {
        requireLive()
        return openedSession.flush()
      },
      async dispose() {
        if (disposed) return
        disposed = true
        disposeFileMaterialization?.()
        openedSession.dispose()
        openedDocumentRuntime.dispose()
        await input.runtime.closeDocument(input.scope)
      },
    })

    function requireLive(): void {
      if (disposed) throw new Error("V3 ProjectIndex registry is disposed")
    }
    function requireProject(value: string): void {
      requireLive()
      if (parseProjectIdV2(value) !== projectId) throw new Error("V3 ProjectIndex registry crossed Project identity")
    }
  } catch (error) {
    disposeFileMaterialization?.()
    session?.dispose()
    documentRuntime?.dispose()
    await input.runtime.closeDocument(input.scope).catch(() => undefined)
    throw error
  }
}
