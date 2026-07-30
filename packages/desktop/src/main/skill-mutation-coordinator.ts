/** Serializes Desktop-owned mutations of the standalone managed Skill store. */
export class DesktopSkillMutationCoordinator {
  #tail: Promise<void> = Promise.resolve()

  async acquire() {
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.#tail
    this.#tail = previous.then(() => next)
    await previous
    return release
  }

  async run<Result>(operation: () => Promise<Result>) {
    const release = await this.acquire()
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
