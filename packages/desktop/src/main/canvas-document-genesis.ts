import {
  buildCanvasGenesisProofCarrier,
  createCanvasReconstructionYDoc,
  installCanvasGenesisProofCarrierVerifierFactory,
  requiredCanvasBlobDigests,
  type CanvasGenesisBuildAuthor,
  type CanvasGenesisHistoricalAuthorVerifierPort,
  type CanvasGenesisProofCarrierVerifier,
} from "@convax/canvas/collaboration"
import {
  assertDocumentOwnerRuntime,
  parseDigest,
  parseDocumentScope,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import type {
  NodeReplicaHeadMaterializer,
  ProjectDocumentGenesisVerifierPort,
  PrepareProjectDocumentGenesisResult,
} from "@convax/project/node"
import {
  createAcceptedCausalClosureIndex,
  createProductionNodeReplicaHeadMaterializer,
} from "./collaboration-exact-base"

export type PrepareCanvasGenesisAuthorResult =
  | Readonly<{ status: "prepared"; author: CanvasGenesisBuildAuthor }>
  | Readonly<{ status: "pending" | "rejected" }>

/** Control/native composition edge. No Project bytes or route DTO enter Canvas. */
export interface CanvasGenesisAuthorProviderPort {
  preflight(input: {
    readonly projectId: import("@convax/collaboration").ProjectId
    readonly projectEpoch: import("@convax/collaboration").Id128
    readonly signal?: AbortSignal
  }): Promise<"ready" | "pending" | "rejected">
  prepareAuthor(input: {
    readonly scope: DocumentScope & { readonly docKind: "canvas" }
    readonly projectIndexRouteDependencyFrameDigest: import("@convax/collaboration").Digest
    readonly signal?: AbortSignal
  }): Promise<PrepareCanvasGenesisAuthorResult>
}

export interface CanvasDocumentGenesisAuthority {
  readonly proofVerifier: CanvasGenesisProofCarrierVerifier
  readonly genesisVerifier: ProjectDocumentGenesisVerifierPort<"canvas">
  readonly preflight: CanvasGenesisAuthorProviderPort["preflight"]
}

/**
 * Exact Canvas materializer used only while its genesis shard crosses the
 * Project persistence barrier. The normal route runtime replaces this bounded
 * registration after ProjectIndex publishes the live route.
 */
export function createCanvasGenesisNodeReplicaHeadMaterializer(input: {
  readonly authority: CurrentProtocolAuthority
  readonly runtime: DocumentOwnerRuntime<"canvas">
  readonly scope: DocumentScope & { readonly docKind: "canvas" }
}): NodeReplicaHeadMaterializer {
  return createProductionNodeReplicaHeadMaterializer({
    authority: input.authority,
    owner: input.runtime,
    causalClosure: createAcceptedCausalClosureIndex({ authority: input.authority, scope: input.scope }),
    createDocument: createCanvasReconstructionYDoc,
    requiredBlobDigests: requiredCanvasBlobDigests,
  })
}

/** One selected Canvas runtime produces both G and the fact verifier that consumes G. */
export function createCanvasDocumentGenesisAuthority(input: {
  readonly authority: CurrentProtocolAuthority
  readonly runtime: DocumentOwnerRuntime<"canvas">
  readonly historicalAuthorVerifier: CanvasGenesisHistoricalAuthorVerifierPort
  readonly authorProvider: CanvasGenesisAuthorProviderPort
}): CanvasDocumentGenesisAuthority {
  if (typeof input.authorProvider?.preflight !== "function") {
    throw new TypeError("Canvas genesis author preflight is required")
  }
  const factory = installCanvasGenesisProofCarrierVerifierFactory({
    authority: input.authority,
    historicalAuthorVerifier: input.historicalAuthorVerifier,
  })
  const created = factory.createVerifier(input.runtime)
  if (created.status !== "created") {
    throw new Error(`Canvas genesis proof verifier is ${created.code}`)
  }
  return Object.freeze({
    proofVerifier: created.verifier,
    preflight: input.authorProvider.preflight.bind(input.authorProvider),
    genesisVerifier: createCanvasDocumentGenesisVerifierPort({
      authority: input.authority,
      runtime: input.runtime,
      verifier: created.verifier,
      authorProvider: input.authorProvider,
    }),
  })
}

/**
 * Binds the exact Canvas verifier/build capability to the generic Project-owned
 * durability coordinator. The accepted ProjectIndex frame digest remains an
 * opaque Canvas genesis predecessor witness.
 */
export function createCanvasDocumentGenesisVerifierPort(input: {
  readonly authority: CurrentProtocolAuthority
  readonly runtime: DocumentOwnerRuntime<"canvas">
  readonly verifier: CanvasGenesisProofCarrierVerifier
  readonly authorProvider: CanvasGenesisAuthorProviderPort
}): ProjectDocumentGenesisVerifierPort<"canvas"> {
  assertDocumentOwnerRuntime(input.runtime, input.authority)
  if (typeof input.verifier !== "function" || typeof input.authorProvider?.prepareAuthor !== "function") {
    throw new TypeError("Canvas document-genesis composition is invalid")
  }
  return Object.freeze({
    async prepare(
      request: Parameters<ProjectDocumentGenesisVerifierPort<"canvas">["prepare"]>[0],
    ): Promise<PrepareProjectDocumentGenesisResult<"canvas">> {
      assertNotAborted(request.signal)
      const scope = parseDocumentScope(request.scope) as DocumentScope & { readonly docKind: "canvas" }
      if (scope.docKind !== "canvas") return Object.freeze({ status: "rejected" })
      const predecessorFrameDigest = parseDigest(request.predecessor.frame.frameDigest)
      const preparedAuthor = await input.authorProvider.prepareAuthor({
        scope,
        projectIndexRouteDependencyFrameDigest: predecessorFrameDigest,
        signal: request.signal,
      })
      assertNotAborted(request.signal)
      if (preparedAuthor.status !== "prepared") return Object.freeze({ status: preparedAuthor.status })
      const built = await buildCanvasGenesisProofCarrier({
        authority: input.authority,
        runtime: input.runtime,
        verifier: input.verifier,
        scope,
        projectIndexRouteDependencyFrameDigest: predecessorFrameDigest,
        author: preparedAuthor.author,
      })
      assertNotAborted(request.signal)
      if (built.status !== "built") return Object.freeze({ status: built.status })
      if (
        built.validatedIdentity.identity.projectIndexRouteDependencyFrameDigest !== predecessorFrameDigest ||
        built.validatedIdentity.checkpointObjectDigest !== built.checkpointObjectDigest
      ) return Object.freeze({ status: "rejected" })
      return Object.freeze({
        status: "verified",
        candidate: Object.freeze({
          scope,
          checkpointObjectDigest: built.checkpointObjectDigest,
          checkpointExactBytes: new Uint8Array(built.checkpointExactBytes),
          proofCarrierExactBytes: new Uint8Array(built.proofCarrierExactBytes),
          acceptedBase: Object.freeze({
            ...built.acceptedBase,
            scope,
            fullUpdate: new Uint8Array(built.acceptedBase.fullUpdate),
            stateVector: new Uint8Array(built.acceptedBase.stateVector) as typeof built.acceptedBase.stateVector,
          }),
        }),
      })
    },
  })
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Canvas genesis was canceled", "AbortError")
}
