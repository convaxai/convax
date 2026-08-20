/**
 * One-shot, process-local coverage for a Project filesystem event that was
 * caused by a verified Convax publication. The filesystem remains the source
 * of truth: a covered event is suppressed only when the publisher's exact
 * file identity and bytes still verify when the watcher consumes it.
 */
export interface ProjectFilesystemEventCoverage {
  cover(input: {
    path: string
    projectId: string
    verifyCurrent(): Promise<boolean>
  }): () => void
  consume(input: { path: string; projectId: string }): Promise<boolean>
}

const maximumCoveredProjectFilesystemEvents = 1_000

export class NodeProjectFilesystemEventCoverage implements ProjectFilesystemEventCoverage {
  readonly #entries = new Map<string, { token: symbol; verifyCurrent(): Promise<boolean> }>()

  cover(input: { path: string; projectId: string; verifyCurrent(): Promise<boolean> }): () => void {
    const key = coverageKey(input.projectId, input.path)
    const token = Symbol(key)
    this.#entries.set(key, { token, verifyCurrent: input.verifyCurrent })
    while (this.#entries.size > maximumCoveredProjectFilesystemEvents) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
    return () => {
      if (this.#entries.get(key)?.token === token) this.#entries.delete(key)
    }
  }

  async consume(input: { path: string; projectId: string }): Promise<boolean> {
    const key = coverageKey(input.projectId, input.path)
    const entry = this.#entries.get(key)
    if (!entry) return false
    // A receipt covers exactly one watcher notification. Delete before the
    // asynchronous verification so concurrent notifications fail open.
    this.#entries.delete(key)
    try {
      return await entry.verifyCurrent()
    } catch {
      return false
    }
  }
}

function coverageKey(projectId: string, path: string) {
  return `${projectId}\u0000${path}`
}
