import {
  parseId128,
  CollaborationKernel,
  type CollaborationKernelOptions,
  type CollaborationKernelPorts,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentOwnerKind,
  type DocumentScope,
  type Id128,
  type LocalCommitResult,
  type OwnerIntentConstructionContext,
  type OwnerValidatedState,
  type PreparedLocalIntent,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"

export interface CollaborationDocumentInvalidationV2 {
  readonly scope: DocumentScope
  readonly frameDigest: Digest
}

export interface MainCollaborationDocumentSessionV2<K extends DocumentOwnerKind> {
  readonly scope: DocumentScope & { readonly docKind: K }
  query<T>(project: (state: OwnerValidatedState<K>) => T): Promise<T>
  submit(input: {
    readonly operationId?: Id128
    readonly prepare: (input: {
      readonly base: OwnerValidatedState<K>
      readonly context: OwnerIntentConstructionContext
      readonly signal?: AbortSignal
    }) => Promise<PreparedLocalIntent> | PreparedLocalIntent
    readonly historyTransition?: Readonly<{ direction: "undo" | "redo"; cursorToken: Id128 }>
    readonly signal?: AbortSignal
  }): Promise<LocalCommitResult>
  flush(): Promise<void>
  subscribe(listener: (event: CollaborationDocumentInvalidationV2) => void): () => void
  dispose(): void
}

export interface CreateMainCollaborationDocumentSessionOptionsV2<K extends DocumentOwnerKind> {
  readonly scope: DocumentScope & { readonly docKind: K }
  readonly createOperationId: () => Id128
  readonly openKernel: (projection: {
    publish(input: CollaborationDocumentInvalidationV2): void
  }) => Promise<CollaborationKernel>
}

export interface CreateKernelBackedMainCollaborationDocumentSessionOptionsV2<K extends DocumentOwnerKind> {
  readonly authority: CurrentProtocolAuthority
  readonly scope: DocumentScope & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntime<K>
  readonly ports: CollaborationKernelPorts
  readonly signatureVerifier: CollaborationKernelOptions["signatureVerifier"]
  readonly createOperationId: () => Id128
}

/** Production composition path shared by Canvas and ProjectIndex owners. */
export function createKernelBackedMainCollaborationDocumentSessionV2<K extends DocumentOwnerKind>(
  options: CreateKernelBackedMainCollaborationDocumentSessionOptionsV2<K>,
): Promise<MainCollaborationDocumentSessionV2<K>> {
  return createMainCollaborationDocumentSessionV2({
    scope: options.scope,
    createOperationId: options.createOperationId,
    openKernel: (projection) => CollaborationKernel.open({
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
export async function createMainCollaborationDocumentSessionV2<K extends DocumentOwnerKind>(
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
    query<T>(project: (state: OwnerValidatedState<K>) => T): Promise<T> {
      requireLive()
      return kernel.queryOwnerState((state) => project(state as OwnerValidatedState<K>))
    },
    submit(input: Parameters<MainCollaborationDocumentSessionV2<K>["submit"]>[0]): Promise<LocalCommitResult> {
      requireLive()
      const operationId = parseId128(input.operationId ?? options.createOperationId())
      return kernel.commitLocalIntent({
        operationId,
        signal: input.signal,
        historyTransition: input.historyTransition,
        prepare: ({ base, context, signal }) => input.prepare({
          base: base as OwnerValidatedState<K>,
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
