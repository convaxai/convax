export class AgentSendSubmissionTracker {
  #activeToken?: symbol

  begin(): symbol | undefined {
    if (this.#activeToken) return undefined
    const token = Symbol("agent-send-submission")
    this.#activeToken = token
    return token
  }

  end(token: symbol): boolean {
    if (this.#activeToken !== token) return false
    this.#activeToken = undefined
    return true
  }

  invalidate(): void {
    this.#activeToken = undefined
  }

  get submitting(): boolean {
    return this.#activeToken !== undefined
  }
}

export function beginAgentSendSubmission(
  tracker: AgentSendSubmissionTracker,
  onChange: (submitting: boolean) => void,
): symbol | undefined {
  const token = tracker.begin()
  if (token) onChange(true)
  return token
}

export function endAgentSendSubmission(
  tracker: AgentSendSubmissionTracker,
  token: symbol,
  onChange: (submitting: boolean) => void,
): boolean {
  if (!tracker.end(token)) return false
  onChange(false)
  return true
}

function start<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return loader()
  } catch (cause) {
    return Promise.reject(cause)
  }
}

export async function revalidateAgentSendCatalogs<TGeneration, TLlm>(options: {
  loadGeneration?: () => Promise<TGeneration>
  loadLlm: () => Promise<TLlm>
}): Promise<{ generation: TGeneration | undefined; llm: TLlm }> {
  const generation = options.loadGeneration ? start(options.loadGeneration) : Promise.resolve(undefined)
  const llm = start(options.loadLlm)
  const [verifiedGeneration, verifiedLlm] = await Promise.all([generation, llm])
  return { generation: verifiedGeneration, llm: verifiedLlm }
}
