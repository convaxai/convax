import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import type { AgentGenerationToolSelection } from "./agent-generation-models"
import type { AgentLlmModelSelection } from "./agent-llm-models"

export const agentGenerationPreferenceStorageKey = "convax.desktop.agent-generation-preference.v1"
export const agentLlmPreferenceStorageKey = "convax.desktop.agent-llm-preference.v1"

export interface AgentGenerationPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface AgentGenerationPreferenceContextValue {
  llmSelection?: AgentLlmModelSelection
  selection?: AgentGenerationToolSelection
  setLlmSelection: (selection?: AgentLlmModelSelection) => void
  setSelection: (selection?: AgentGenerationToolSelection) => void
}

const AgentGenerationPreferenceContext = createContext<AgentGenerationPreferenceContextValue | null>(null)

function isToolId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function isModelIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function isAgentGenerationOutputValue(value: unknown): value is AgentGenerationToolSelection["output"] {
  return value === "image" || value === "video" || value === "audio"
}

export function readAgentGenerationPreference(
  storage: Pick<AgentGenerationPreferenceStorage, "getItem">,
): AgentGenerationToolSelection | undefined {
  try {
    const value = JSON.parse(storage.getItem(agentGenerationPreferenceStorageKey) ?? "null") as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const stored = value as { output?: unknown; toolId?: unknown; version?: unknown }
    if (stored.version !== 1 || !isToolId(stored.toolId) || !isAgentGenerationOutputValue(stored.output)) {
      return undefined
    }
    return { id: stored.toolId, output: stored.output }
  } catch {
    return undefined
  }
}

export function writeAgentGenerationPreference(
  storage: Pick<AgentGenerationPreferenceStorage, "setItem">,
  selection?: AgentGenerationToolSelection,
) {
  try {
    storage.setItem(
      agentGenerationPreferenceStorageKey,
      JSON.stringify(selection ? { output: selection.output, toolId: selection.id, version: 1 } : { version: 1 }),
    )
    return true
  } catch {
    return false
  }
}

export function readAgentLlmPreference(
  storage: Pick<AgentGenerationPreferenceStorage, "getItem">,
): AgentLlmModelSelection | undefined {
  try {
    const value = JSON.parse(storage.getItem(agentLlmPreferenceStorageKey) ?? "null") as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const stored = value as { modelId?: unknown; providerId?: unknown; version?: unknown }
    if (stored.version !== 1 || !isModelIdentifier(stored.providerId) || !isModelIdentifier(stored.modelId)) {
      return undefined
    }
    return { modelId: stored.modelId, providerId: stored.providerId }
  } catch {
    return undefined
  }
}

export function writeAgentLlmPreference(
  storage: Pick<AgentGenerationPreferenceStorage, "setItem">,
  selection?: AgentLlmModelSelection,
) {
  try {
    storage.setItem(
      agentLlmPreferenceStorageKey,
      JSON.stringify(
        selection ? { modelId: selection.modelId, providerId: selection.providerId, version: 1 } : { version: 1 },
      ),
    )
    return true
  } catch {
    return false
  }
}

export function AgentGenerationPreferenceProvider(props: {
  children: ReactNode
  storage: AgentGenerationPreferenceStorage
}) {
  const [selection, setSelectionState] = useState<AgentGenerationToolSelection | undefined>(() =>
    readAgentGenerationPreference(props.storage),
  )
  const [llmSelection, setLlmSelectionState] = useState<AgentLlmModelSelection | undefined>(() =>
    readAgentLlmPreference(props.storage),
  )
  const setSelection = useCallback(
    (next?: AgentGenerationToolSelection) => {
      setSelectionState(next)
      writeAgentGenerationPreference(props.storage, next)
    },
    [props.storage],
  )
  const setLlmSelection = useCallback(
    (next?: AgentLlmModelSelection) => {
      setLlmSelectionState(next)
      writeAgentLlmPreference(props.storage, next)
    },
    [props.storage],
  )
  const value = useMemo(
    () => ({ llmSelection, selection, setLlmSelection, setSelection }),
    [llmSelection, selection, setLlmSelection, setSelection],
  )
  return <AgentGenerationPreferenceContext value={value}>{props.children}</AgentGenerationPreferenceContext>
}

/** Null keeps AgentPanel independently renderable for package-local tests and consumers. */
export function useAgentGenerationPreference() {
  return useContext(AgentGenerationPreferenceContext)
}

/** Read-only view used by card generation so node changes cannot mutate the Agent default. */
export function useAgentGenerationDefault() {
  return useContext(AgentGenerationPreferenceContext)?.selection
}
