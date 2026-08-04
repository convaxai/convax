import type {
  AtomicControlStateStore,
  AtomicControlStateTransaction,
  ControlClock,
  ControlRandomSource,
} from "./contracts"

function cloneState<State extends object>(value: State | null): State | null {
  return value === null ? null : structuredClone(value)
}

/** Web-standard reference adapter for tests and non-durable embedders. */
export class InMemoryAtomicControlStateStore<State extends object> implements AtomicControlStateStore<State> {
  private readonly partitions = new Map<string, State>()
  private readonly tails = new Map<string, Promise<void>>()

  async transact<T>(
    partitionKey: string,
    operation: (transaction: AtomicControlStateTransaction<State>) => T | Promise<T>,
  ): Promise<T> {
    const previous = this.tails.get(partitionKey) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.tails.set(partitionKey, tail)
    await previous
    try {
      let staged: State | null = cloneState(this.partitions.get(partitionKey) ?? null)
      let written = false
      const result = await operation({
        read: () => cloneState(staged),
        write: (next) => {
          staged = cloneState(next)
          written = true
        },
      })
      if (written && staged !== null) this.partitions.set(partitionKey, staged)
      return result
    } finally {
      release()
      if (this.tails.get(partitionKey) === tail) this.tails.delete(partitionKey)
    }
  }
}

export class SystemControlClock implements ControlClock {
  nowEpochMilliseconds(): number {
    return Date.now()
  }
}

export class WebCryptoControlRandomSource implements ControlRandomSource {
  fill(target: Uint8Array): void {
    crypto.getRandomValues(target)
  }
}
