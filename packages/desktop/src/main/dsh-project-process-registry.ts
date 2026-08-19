import { resolve } from "node:path"

import type { DshProjectProcess, DshProjectProcessOptions } from "./dsh-project-process"

export interface DshProjectBinding {
  directory: string
  scopeId: string
}

export interface DshProjectProcessRegistryOptions {
  resolveOptions(binding: DshProjectBinding): Promise<Omit<DshProjectProcessOptions, "directory" | "scopeId">>
  start(options: DshProjectProcessOptions): Promise<DshProjectProcess>
}

interface ProjectEntry {
  directory: string
  process: Promise<DshProjectProcess>
}

function projectIdentifier(value: string) {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(normalized)) throw new Error("DSH Project scope id is invalid")
  return normalized
}

/** Main-owned one-process-per-live-Project registry. It never selects an Agent backend. */
export class DshProjectProcessRegistry {
  readonly #entries = new Map<string, ProjectEntry>()
  readonly #resolveOptions: DshProjectProcessRegistryOptions["resolveOptions"]
  readonly #start: DshProjectProcessRegistryOptions["start"]
  #closed = false

  constructor(options: DshProjectProcessRegistryOptions) {
    this.#resolveOptions = options.resolveOptions
    this.#start = options.start
  }

  acquire(binding: DshProjectBinding): Promise<DshProjectProcess> {
    if (this.#closed) return Promise.reject(new Error("DSH Project process registry is closed"))
    const scopeId = projectIdentifier(binding.scopeId)
    const directory = resolve(binding.directory)
    const current = this.#entries.get(scopeId)
    if (current) {
      if (current.directory !== directory) {
        return Promise.reject(new Error(`DSH Project ${scopeId} is already bound to another directory`))
      }
      return current.process
    }

    const process = this.#resolveOptions({ directory, scopeId })
      .then((options) => this.#start({ ...options, directory, scopeId }))
      .catch((error) => {
        if (this.#entries.get(scopeId)?.process === process) this.#entries.delete(scopeId)
        throw error
      })
    this.#entries.set(scopeId, { directory, process })
    return process
  }

  async closeProject(scopeIdInput: string) {
    const scopeId = projectIdentifier(scopeIdInput)
    const entry = this.#entries.get(scopeId)
    if (!entry) return
    this.#entries.delete(scopeId)
    const process = await entry.process.catch(() => undefined)
    await process?.close()
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    const entries = [...this.#entries.values()]
    this.#entries.clear()
    await Promise.all(entries.map(async (entry) => (await entry.process.catch(() => undefined))?.close()))
  }
}
