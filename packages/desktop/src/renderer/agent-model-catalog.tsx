import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react"

import type { GenerationModelCatalogController } from "./generation-model-catalog-controller"
import type { ServiceCatalogAgentModelState } from "./service-catalog-controller"

interface AgentModelCatalogContextValue {
  generation: ReturnType<GenerationModelCatalogController["getSnapshot"]>
  generationController: GenerationModelCatalogController
  llm: ServiceCatalogAgentModelState
  refreshLlmModels: () => Promise<ServiceCatalogAgentModelState["catalog"]>
}

const AgentModelCatalogContext = createContext<AgentModelCatalogContextValue | null>(null)

export function AgentModelCatalogProvider(props: {
  children: ReactNode
  generationController: GenerationModelCatalogController
  llm?: ServiceCatalogAgentModelState
  refreshLlmModels: AgentModelCatalogContextValue["refreshLlmModels"]
}) {
  const generation = useSyncExternalStore(
    props.generationController.subscribe,
    props.generationController.getSnapshot,
    props.generationController.getSnapshot,
  )
  const llm = props.llm ?? { loading: false }
  const value = useMemo(
    () => ({
      generation,
      generationController: props.generationController,
      llm,
      refreshLlmModels: props.refreshLlmModels,
    }),
    [generation, llm, props.generationController, props.refreshLlmModels],
  )

  return <AgentModelCatalogContext value={value}>{props.children}</AgentModelCatalogContext>
}

/** Null keeps AgentPanel independently renderable in package-local tests. */
export function useAgentModelCatalog() {
  return useContext(AgentModelCatalogContext)
}
