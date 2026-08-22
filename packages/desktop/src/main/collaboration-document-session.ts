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
  type CollaborationLatencyDiagnostic,
  type CollaborationLatencyDiagnosticsPort,
  type CollaborationLatencySample,
} from "@convax/collaboration"

export interface CollaborationDocumentInvalidation {
  readonly scope: DocumentScope
  readonly frameDigest: Digest
}

export interface MainCollaborationDocumentSession<K extends DocumentOwnerKind> {
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
  subscribe(listener: (event: CollaborationDocumentInvalidation) => void): () => void
  dispose(): void
}

export interface CreateMainCollaborationDocumentSessionOptions<K extends DocumentOwnerKind> {
  readonly scope: DocumentScope & { readonly docKind: K }
  readonly createOperationId: () => Id128
  readonly openKernel: (projection: {
    publish(input: CollaborationDocumentInvalidation): void
  }) => Promise<CollaborationKernel>
}

export interface CreateKernelBackedMainCollaborationDocumentSessionOptions<K extends DocumentOwnerKind> {
  readonly authority: CurrentProtocolAuthority
  readonly scope: DocumentScope & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntime<K>
  readonly ports: CollaborationKernelPorts
  readonly signatureVerifier: CollaborationKernelOptions["signatureVerifier"]
  readonly createOperationId: () => Id128
  readonly diagnostics?: CollaborationLatencyDiagnosticsPort
}

/** Production composition path shared by Canvas and ProjectIndex owners. */
export function createKernelBackedMainCollaborationDocumentSession<K extends DocumentOwnerKind>(
  options: CreateKernelBackedMainCollaborationDocumentSessionOptions<K>,
): Promise<MainCollaborationDocumentSession<K>> {
  return createMainCollaborationDocumentSession({
    scope: options.scope,
    createOperationId: options.createOperationId,
    openKernel: (projection) => CollaborationKernel.open({
      authority: options.authority,
      scope: options.scope,
      owner: options.owner,
      ports: options.ports,
      signatureVerifier: options.signatureVerifier,
      projection,
      diagnostics: options.diagnostics,
    }),
  })
}

export function createMainCollaborationLatencyDiagnosticsPort(input: {
  readonly sample?: () => CollaborationLatencySample | Promise<CollaborationLatencySample>
  /** Benchmark-only escape from the production slow-command filter. */
  readonly recordAll?: boolean
  readonly slowThresholdMs?: number
  readonly write?: (diagnostic: CollaborationLatencyDiagnostic) => void
}): CollaborationLatencyDiagnosticsPort {
  const threshold = input.slowThresholdMs ?? 500
  const write = input.write ?? ((diagnostic: CollaborationLatencyDiagnostic) => {
    console.warn("[convax:collaboration-latency]", JSON.stringify(diagnostic))
  })
  return Object.freeze({
    shouldSample(diagnostic: CollaborationLatencyDiagnostic) {
      return input.recordAll === true || diagnostic.totalDurationMs > threshold
    },
    ...(input.sample ? { sample: input.sample } : {}),
    record(diagnostic: CollaborationLatencyDiagnostic) {
      try { write(diagnostic) } catch { /* Diagnostics never affect a durable command. */ }
    },
  })
}

/**
 * Generic Main-only owner around one selected document-owner Kernel. Canvas and
 * ProjectIndex provide only their reducer/projection closures; this layer owns
 * operation allocation, queue ordering, flush and invalidation fanout.
 */
export async function createMainCollaborationDocumentSession<K extends DocumentOwnerKind>(
  options: CreateMainCollaborationDocumentSessionOptions<K>,
): Promise<MainCollaborationDocumentSession<K>> {
  const listeners = new Set<(event: CollaborationDocumentInvalidation) => void>()
  const pendingInvalidations: CollaborationDocumentInvalidation[] = []
  let invalidationDelivery: ReturnType<typeof setImmediate> | undefined
  let disposed = false
  let session: MainCollaborationDocumentSession<K> | undefined
  const kernel = await options.openKernel({
    publish(input) {
      const event = Object.freeze({ scope: input.scope, frameDigest: input.frameDigest })
      pendingInvalidations.push(event)
      scheduleInvalidationDelivery()
    },
  })
  session = Object.freeze({
    scope: options.scope,
    query<T>(project: (state: OwnerValidatedState<K>) => T): Promise<T> {
      requireLive()
      return kernel.queryOwnerState((state) => project(state as OwnerValidatedState<K>))
    },
    submit(input: Parameters<MainCollaborationDocumentSession<K>["submit"]>[0]): Promise<LocalCommitResult> {
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
    subscribe(listener: (event: CollaborationDocumentInvalidation) => void): () => void {
      requireLive()
      if (typeof listener !== "function") throw new TypeError("Collaboration invalidation listener is required")
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (invalidationDelivery !== undefined) clearImmediate(invalidationDelivery)
      invalidationDelivery = undefined
      pendingInvalidations.length = 0
      listeners.clear()
      kernel.dispose()
    },
  })
  return session

  function requireLive(): void {
    if (disposed || session === undefined) throw new Error("Collaboration document session is disposed")
  }

  function scheduleInvalidationDelivery(): void {
    if (disposed || invalidationDelivery !== undefined) return
    // A projection invalidation is an observer notification, not part of the
    // durability barrier. Deliver it on the next event-loop turn so listener
    // work cannot enqueue ahead of the submitter's authoritative result.
    invalidationDelivery = setImmediate(() => {
      invalidationDelivery = undefined
      if (disposed) return
      const batch = pendingInvalidations.splice(0)
      for (const event of batch) {
        for (const listener of listeners) {
          try { listener(event) } catch { /* Durable state is unaffected by an observer. */ }
        }
      }
      if (pendingInvalidations.length > 0) scheduleInvalidationDelivery()
    })
  }
}
