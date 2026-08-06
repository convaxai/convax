import {
  buildCanvasGenesisProofCarrierV2,
  installCanvasGenesisProofCarrierVerifierFactoryV2,
  type CanvasGenesisBuildAuthorV2,
  type CanvasGenesisHistoricalAuthorVerifierPortV2,
  type CanvasGenesisProofCarrierVerifierV2,
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
  ProjectDocumentGenesisVerifierPort,
  PrepareProjectDocumentGenesisResult,
} from "@convax/project/node"

export type PrepareCanvasGenesisAuthorResultV2 =
  | Readonly<{ status: "prepared"; author: CanvasGenesisBuildAuthorV2 }>
  | Readonly<{ status: "pending" | "rejected" }>

/** Control/native composition edge. No Project bytes or route DTO enter Canvas. */
export interface CanvasGenesisAuthorProviderPortV2 {
  preflight(input: {
    readonly projectId: import("@convax/collaboration").ProjectId
    readonly projectEpoch: import("@convax/collaboration").Id128
    readonly signal?: AbortSignal
  }): Promise<"ready" | "pending" | "rejected">
  prepareAuthor(input: {
    readonly scope: DocumentScope & { readonly docKind: "canvas" }
    readonly projectIndexRouteDependencyFrameDigest: import("@convax/collaboration").Digest
    readonly signal?: AbortSignal
  }): Promise<PrepareCanvasGenesisAuthorResultV2>
}

export interface CanvasDocumentGenesisAuthorityV2 {
  readonly proofVerifier: CanvasGenesisProofCarrierVerifierV2
  readonly genesisVerifier: ProjectDocumentGenesisVerifierPort<"canvas">
  readonly preflight: CanvasGenesisAuthorProviderPortV2["preflight"]
}

/** One selected Canvas runtime produces both G and the fact verifier that consumes G. */
export function createCanvasDocumentGenesisAuthorityV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly runtime: DocumentOwnerRuntime<"canvas">
  readonly historicalAuthorVerifier: CanvasGenesisHistoricalAuthorVerifierPortV2
  readonly authorProvider: CanvasGenesisAuthorProviderPortV2
}): CanvasDocumentGenesisAuthorityV2 {
  if (typeof input.authorProvider?.preflight !== "function") {
    throw new TypeError("Canvas genesis author preflight is required")
  }
  const factory = installCanvasGenesisProofCarrierVerifierFactoryV2({
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
    genesisVerifier: createCanvasDocumentGenesisVerifierPortV2({
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
export function createCanvasDocumentGenesisVerifierPortV2(input: {
  readonly authority: CurrentProtocolAuthority
  readonly runtime: DocumentOwnerRuntime<"canvas">
  readonly verifier: CanvasGenesisProofCarrierVerifierV2
  readonly authorProvider: CanvasGenesisAuthorProviderPortV2
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
      const built = await buildCanvasGenesisProofCarrierV2({
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
