import type { CanvasDocumentRef } from "@convax/canvas/application"
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
  type ProjectIdV2,
  type VerifiedProtocolAuthorityV2,
  type VerifiedProtocolAuthorityV3,
  type YjsDocumentFactoryV2,
} from "@convax/collaboration"

import { createKernelBackedMainCollaborationDocumentSessionV3 } from "./collaboration-document-session"
import type {
  CanvasRouteRuntimeOpenerV2,
  CanvasRouteRuntimeHandleV3,
} from "./project-canvas-route-runtime-registry"
import type { MainProjectCollaborationProductionRuntimeV3 } from "./successor-collaboration-production-runtime"

export interface OpenProjectCanvasDocumentV3 {
  readonly owner: DocumentOwnerRuntimeV2<"canvas">
  readonly incomingFacts: IncomingOwnerFactResolverPortV3
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
  readonly requiredBlobDigests: (
    frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3,
  ) => readonly DigestV2[]
  readonly prepareShard?: () => Promise<void>
}

/** Exact route scopes enter one already-selected local-owner V3 Project runtime. */
export function createProductionCanvasRouteRuntimeOpenerV3(input: {
  readonly projectId: ProjectIdV2
  readonly authority: VerifiedProtocolAuthorityV3
  readonly historicalAuthority: VerifiedProtocolAuthorityV2
  readonly runtime: MainProjectCollaborationProductionRuntimeV3
  readonly signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  readonly createOperationId: () => Id128V2
  readonly describeCanvas: (input: {
    readonly ref: CanvasDocumentRef
    readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
  }) => OpenProjectCanvasDocumentV3
}): CanvasRouteRuntimeOpenerV2 {
  const projectId = parseProjectIdV2(input.projectId)
  return Object.freeze({
    async open(
      { ref, scope, project }: Parameters<CanvasRouteRuntimeOpenerV2["open"]>[0],
    ): Promise<CanvasRouteRuntimeHandleV3> {
      if (parseProjectIdV2(scope.projectId) !== projectId || parseProjectIdV2(ref.scopeId) !== projectId) {
        throw new Error("V3 Canvas route opener crossed Project identity")
      }
      if (parseProjectIdV2(project.projectId) !== projectId) {
        throw new Error("V3 Canvas route opener received another Project lease")
      }
      const descriptor = input.describeCanvas({ ref, scope })
      const runtime = await input.runtime.openDocument({
        scope,
        owner: descriptor.owner,
        incomingFacts: descriptor.incomingFacts,
        createDocument: descriptor.createDocument,
        requiredBlobDigests: descriptor.requiredBlobDigests,
        ...(descriptor.prepareShard ? { prepareShard: descriptor.prepareShard } : {}),
      })
      try {
        const session = await createKernelBackedMainCollaborationDocumentSessionV3({
          authority: input.authority,
          historicalAuthority: input.historicalAuthority,
          scope,
          owner: descriptor.owner,
          ports: runtime.ports,
          signatureVerifier: input.signatureVerifier,
          createOperationId: input.createOperationId,
        })
        let disposed = false
        return Object.freeze({
          protocol: "v3" as const,
          session,
          dispose() {
            if (disposed) return
            disposed = true
            session.dispose()
            runtime.dispose()
            void input.runtime.closeDocument(scope)
          },
        })
      } catch (error) {
        runtime.dispose()
        await input.runtime.closeDocument(scope).catch(() => undefined)
        throw error
      }
    },
  })
}
