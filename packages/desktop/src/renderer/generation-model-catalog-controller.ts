import type {
  GenerationClient,
  GenerationOutputModality,
  GenerationToolDescription,
  GenerationToolSummary,
} from "../generation-contracts"

export type GenerationCatalogAuthorityVersion = string | number

export interface GenerationModelCatalogScope {
  authorityVersion?: GenerationCatalogAuthorityVersion
  scopeId?: string
}

export interface GenerationModelCatalogSnapshot {
  authorityVersion?: GenerationCatalogAuthorityVersion
  error?: string
  loading: boolean
  ready: boolean
  refreshing: boolean
  scopeId?: string
  tools: readonly GenerationToolSummary[]
}

export interface GenerationToolDescriptionSnapshot {
  description?: GenerationToolDescription
  error?: string
  refreshing: boolean
}

type GenerationCatalogClient = Pick<GenerationClient, "describeTool" | "listTools">

interface DescriptionEntry {
  authorityVersion?: GenerationCatalogAuthorityVersion
  description?: GenerationToolDescription
  error?: string
  request?: {
    epoch: number
    promise: Promise<GenerationToolDescription>
  }
}

interface CatalogRequest {
  epoch: number
  promise: Promise<readonly GenerationToolSummary[]>
}

const emptyTools: readonly GenerationToolSummary[] = Object.freeze([])
const emptyDescriptionSnapshot: GenerationToolDescriptionSnapshot = Object.freeze({
  refreshing: false,
})

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sameAuthorityVersion(
  left: GenerationCatalogAuthorityVersion | undefined,
  right: GenerationCatalogAuthorityVersion | undefined,
) {
  return Object.is(left, right)
}

/**
 * Window-scoped generation discovery cache.
 *
 * Main remains authoritative at execution time. This renderer controller only
 * avoids repeating the same discovery work for every composer and keeps the last
 * ready catalog visible while a changed authority version is revalidated.
 */
export class GenerationModelCatalogController {
  readonly #descriptions = new Map<string, DescriptionEntry>()
  readonly #listeners = new Set<() => void>()
  #authorityVersion?: GenerationCatalogAuthorityVersion
  #catalogError?: string
  #catalogRequest?: CatalogRequest
  #disposed = false
  #epoch = 0
  #ready = false
  #scopeId?: string
  #snapshot: GenerationModelCatalogSnapshot = {
    loading: false,
    ready: false,
    refreshing: false,
    tools: emptyTools,
  }
  #tools: readonly GenerationToolSummary[] = emptyTools
  #toolsByOutput = new Map<GenerationOutputModality, readonly GenerationToolSummary[]>()

  constructor(private readonly client: GenerationCatalogClient) {}

  readonly getSnapshot = () => this.#snapshot

  readonly subscribe = (listener: () => void) => {
    if (this.#disposed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Selects the one Project scope retained by this window cache. Changing only
   * authorityVersion preserves ready values and starts stale-while-revalidate.
   */
  setScope(scope: GenerationModelCatalogScope) {
    if (this.#disposed) return
    const scopeChanged = scope.scopeId !== this.#scopeId
    const authorityChanged = !sameAuthorityVersion(scope.authorityVersion, this.#authorityVersion)
    if (!scopeChanged && !authorityChanged) return

    this.#epoch += 1
    this.#scopeId = scope.scopeId
    this.#authorityVersion = scope.authorityVersion
    this.#catalogError = undefined
    this.#catalogRequest = undefined

    if (scopeChanged) {
      this.#ready = false
      this.#replaceTools(emptyTools)
      this.#descriptions.clear()
    } else {
      for (const entry of this.#descriptions.values()) {
        entry.error = undefined
        entry.request = undefined
      }
    }

    if (!this.#scopeId) {
      this.#publish()
      return
    }
    void this.#refreshCatalog().catch(() => undefined)
  }

  /**
   * Returns the currently cached catalog synchronously. `undefined` distinguishes
   * an unloaded scope from a successfully loaded empty catalog.
   */
  peekTools(output?: GenerationOutputModality): readonly GenerationToolSummary[] | undefined {
    if (!this.#scopeId || !this.#ready) return undefined
    return this.#selectTools(output)
  }

  /**
   * Reuses ready data immediately. The first caller for an unloaded scope awaits
   * the shared discovery request; later callers and remounts do no extra IPC.
   */
  async listTools(output?: GenerationOutputModality): Promise<readonly GenerationToolSummary[]> {
    if (this.#disposed || !this.#scopeId) return emptyTools
    if (this.#catalogRequest?.epoch === this.#epoch) {
      await this.#catalogRequest.promise
      return this.#selectTools(output)
    }
    const cached = this.peekTools(output)
    if (cached) return cached
    await this.#refreshCatalog()
    return this.#selectTools(output)
  }

  /**
   * Forces catalog revalidation while coalescing with an already running request.
   * Ready data remains synchronously available through peekTools/listTools.
   */
  async refresh(): Promise<readonly GenerationToolSummary[]> {
    if (this.#disposed || !this.#scopeId) return emptyTools
    return this.#refreshCatalog()
  }

  peekDescription(toolId: string): GenerationToolDescription | undefined {
    return this.#descriptions.get(toolId)?.description
  }

  getDescriptionSnapshot(toolId: string): GenerationToolDescriptionSnapshot {
    const entry = this.#descriptions.get(toolId)
    if (!entry) return emptyDescriptionSnapshot
    return {
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.error ? { error: entry.error } : {}),
      refreshing: Boolean(entry.request),
    }
  }

  /**
   * Descriptions are cached per current Project scope and tool. An authority
   * change keeps the old projection available through peekDescription while the
   * first consumer single-flights a fresh Main description.
   */
  describeTool(toolId: string): Promise<GenerationToolDescription> {
    if (this.#disposed) return Promise.reject(new Error("Generation model catalog is disposed"))
    const scopeId = this.#scopeId
    if (!scopeId) return Promise.reject(new Error("Open a Project before describing a generation model"))

    let entry = this.#descriptions.get(toolId)
    if (
      entry?.description &&
      sameAuthorityVersion(entry.authorityVersion, this.#authorityVersion)
    ) {
      return Promise.resolve(entry.description)
    }
    if (entry?.request?.epoch === this.#epoch) return entry.request.promise

    if (!entry) {
      entry = {}
      this.#descriptions.set(toolId, entry)
    }
    entry.error = undefined
    const epoch = this.#epoch
    const authorityVersion = this.#authorityVersion
    const request = this.client
      .describeTool({ scopeId, toolId })
      .then((description) => {
        if (this.#isCurrent(epoch, scopeId) && this.#descriptions.get(toolId) === entry) {
          entry.description = description
          entry.authorityVersion = authorityVersion
          entry.error = undefined
        }
        return description
      })
      .catch((error: unknown) => {
        if (this.#isCurrent(epoch, scopeId) && this.#descriptions.get(toolId) === entry) {
          entry.error = errorMessage(error)
        }
        throw error
      })
      .finally(() => {
        if (entry.request?.promise === request) {
          entry.request = undefined
          if (this.#isCurrent(epoch, scopeId) && this.#descriptions.get(toolId) === entry) {
            this.#publish()
          }
        }
      })
    entry.request = { epoch, promise: request }
    this.#publish()
    return request
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#epoch += 1
    this.#catalogRequest = undefined
    this.#descriptions.clear()
    this.#listeners.clear()
  }

  #isCurrent(epoch: number, scopeId: string) {
    return !this.#disposed && epoch === this.#epoch && scopeId === this.#scopeId
  }

  #refreshCatalog(): Promise<readonly GenerationToolSummary[]> {
    const scopeId = this.#scopeId
    if (!scopeId || this.#disposed) return Promise.resolve(emptyTools)
    if (this.#catalogRequest?.epoch === this.#epoch) return this.#catalogRequest.promise

    const epoch = this.#epoch
    this.#catalogError = undefined
    const request = this.client
      .listTools({ scopeId })
      .then((tools) => {
        const readyTools = Object.freeze([...tools])
        if (this.#isCurrent(epoch, scopeId)) {
          this.#replaceTools(readyTools)
          this.#ready = true
          this.#catalogError = undefined
          const availableToolIds = new Set(readyTools.map((tool) => tool.id))
          for (const toolId of this.#descriptions.keys()) {
            if (!availableToolIds.has(toolId)) this.#descriptions.delete(toolId)
          }
        }
        return readyTools
      })
      .catch((error: unknown) => {
        if (this.#isCurrent(epoch, scopeId)) this.#catalogError = errorMessage(error)
        throw error
      })
      .finally(() => {
        if (this.#catalogRequest?.promise === request) {
          this.#catalogRequest = undefined
          if (this.#isCurrent(epoch, scopeId)) this.#publish()
        }
      })
    this.#catalogRequest = { epoch, promise: request }
    this.#publish()
    return request
  }

  #replaceTools(tools: readonly GenerationToolSummary[]) {
    this.#tools = tools
    this.#toolsByOutput = new Map()
  }

  #selectTools(output?: GenerationOutputModality) {
    if (!output) return this.#tools
    const existing = this.#toolsByOutput.get(output)
    if (existing) return existing
    const selected = Object.freeze(this.#tools.filter((tool) => tool.output === output))
    this.#toolsByOutput.set(output, selected)
    return selected
  }

  #publish() {
    this.#snapshot = {
      ...(this.#authorityVersion === undefined ? {} : { authorityVersion: this.#authorityVersion }),
      ...(this.#catalogError ? { error: this.#catalogError } : {}),
      loading: Boolean(this.#catalogRequest) && !this.#ready,
      ready: this.#ready,
      refreshing: Boolean(this.#catalogRequest) && this.#ready,
      ...(this.#scopeId ? { scopeId: this.#scopeId } : {}),
      tools: this.#tools,
    }
    for (const listener of this.#listeners) listener()
  }
}
