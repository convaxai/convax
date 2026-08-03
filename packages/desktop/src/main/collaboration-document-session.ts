import {
  parseId128V2,
  CollaborationKernelV2,
  type CollaborationKernelOptionsV2,
  type CollaborationKernelPortsV2,
  type DigestV2,
  type DocumentOwnerRuntimeV2,
  type DocumentOwnerKindV2,
  type DocumentScopeV2,
  type Id128V2,
  type LocalCommitResultV2,
  type OwnerIntentConstructionContextV2,
  type OwnerValidatedStateV2,
  type PreparedLocalIntentV2,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"

export interface CollaborationDocumentInvalidationV2 {
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
}

export interface MainCollaborationDocumentSessionV2<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  query<T>(project: (state: OwnerValidatedStateV2<K>) => T): Promise<T>
  submit(input: {
    readonly operationId?: Id128V2
    readonly prepare: (input: {
      readonly base: OwnerValidatedStateV2<K>
      readonly context: OwnerIntentConstructionContextV2
      readonly signal?: AbortSignal
    }) => Promise<PreparedLocalIntentV2> | PreparedLocalIntentV2
    readonly historyTransition?: Readonly<{ direction: "undo" | "redo"; cursorToken: Id128V2 }>
    readonly signal?: AbortSignal
  }): Promise<LocalCommitResultV2>
  flush(): Promise<void>
  subscribe(listener: (event: CollaborationDocumentInvalidationV2) => void): () => void
  dispose(): void
}

export interface CreateMainCollaborationDocumentSessionOptionsV2<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly createOperationId: () => Id128V2
  readonly openKernel: (projection: {
    publish(input: CollaborationDocumentInvalidationV2): void
  }) => Promise<CollaborationKernelV2>
}

export interface CreateKernelBackedMainCollaborationDocumentSessionOptionsV2<K extends DocumentOwnerKindV2> {
  readonly authority: VerifiedProtocolAuthorityV2
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntimeV2<K>
  readonly ports: CollaborationKernelPortsV2
  readonly signatureVerifier: CollaborationKernelOptionsV2["signatureVerifier"]
  readonly createOperationId: () => Id128V2
}

/** Production composition path shared by Canvas and ProjectIndex owners. */
export function createKernelBackedMainCollaborationDocumentSessionV2<K extends DocumentOwnerKindV2>(
  options: CreateKernelBackedMainCollaborationDocumentSessionOptionsV2<K>,
): Promise<MainCollaborationDocumentSessionV2<K>> {
  return createMainCollaborationDocumentSessionV2({
    scope: options.scope,
    createOperationId: options.createOperationId,
    openKernel: (projection) => CollaborationKernelV2.open({
      authority: options.authority,
      scope: options.scope,
      owner: options.owner,
      ports: options.ports,
      signatureVerifier: options.signatureVerifier,
      projection,
    }),
  })
}

/**
 * Generic Main-only owner around one selected document-owner Kernel. Canvas and
 * ProjectIndex provide only their reducer/projection closures; this layer owns
 * operation allocation, queue ordering, flush and invalidation fanout.
 */
export async function createMainCollaborationDocumentSessionV2<K extends DocumentOwnerKindV2>(
  options: CreateMainCollaborationDocumentSessionOptionsV2<K>,
): Promise<MainCollaborationDocumentSessionV2<K>> {
  const listeners = new Set<(event: CollaborationDocumentInvalidationV2) => void>()
  let session: MainCollaborationDocumentSessionV2<K> | undefined
  const kernel = await options.openKernel({
    publish(input) {
      const event = Object.freeze({ scope: input.scope, frameDigest: input.frameDigest })
      for (const listener of listeners) {
        try { listener(event) } catch { /* Durable state is unaffected by an observer. */ }
      }
    },
  })
  let disposed = false
  session = Object.freeze({
    scope: options.scope,
    query<T>(project: (state: OwnerValidatedStateV2<K>) => T): Promise<T> {
      requireLive()
      return kernel.queryOwnerState((state) => project(state as OwnerValidatedStateV2<K>))
    },
    submit(input: Parameters<MainCollaborationDocumentSessionV2<K>["submit"]>[0]): Promise<LocalCommitResultV2> {
      requireLive()
      const operationId = parseId128V2(input.operationId ?? options.createOperationId())
      return kernel.commitLocalIntent({
        operationId,
        signal: input.signal,
        historyTransition: input.historyTransition,
        prepare: ({ base, context, signal }) => input.prepare({
          base: base as OwnerValidatedStateV2<K>,
          context,
          signal,
        }),
      })
    },
    flush(): Promise<void> {
      requireLive()
      return kernel.flush()
    },
    subscribe(listener: (event: CollaborationDocumentInvalidationV2) => void): () => void {
      requireLive()
      if (typeof listener !== "function") throw new TypeError("Collaboration invalidation listener is required")
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      listeners.clear()
      kernel.dispose()
    },
  })
  return session

  function requireLive(): void {
    if (disposed || session === undefined) throw new Error("Collaboration document session is disposed")
  }
}
