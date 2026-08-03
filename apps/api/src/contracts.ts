export type Awaitable<T> = T | Promise<T>

/**
 * Deployment-neutral transaction port. It deliberately knows nothing about
 * ProjectIdV2, ProjectEpoch, ReplicaIdV2, wire DTOs or portable digests. The
 * second integration round supplies the exact kernel-branded state shape.
 */
export interface AtomicControlStateTransaction<State extends object> {
  read(): State | null
  write(next: State): void
}

export interface AtomicControlStateStore<State extends object> {
  transact<T>(
    partitionKey: string,
    operation: (transaction: AtomicControlStateTransaction<State>) => Awaitable<T>,
  ): Promise<T>
}

export interface ControlClock {
  nowEpochMilliseconds(): number
}

export interface ControlRandomSource {
  fill(target: Uint8Array): void
}
