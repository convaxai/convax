import type { AgentToolProvider, AgentToolScope } from "@convax/agent-runtime"

export function createCompositeAgentToolProvider(providers: readonly AgentToolProvider[]): AgentToolProvider {
  return {
    async listTools(scope) {
      const definitions = (await Promise.all(providers.map((provider) => provider.listTools(scope)))).flat()
      const names = new Set<string>()
      for (const definition of definitions) {
        if (names.has(definition.name)) throw new Error(`Duplicate Agent tool name: ${definition.name}`)
        names.add(definition.name)
      }
      return definitions
    },
    async callTool(scope, name, input) {
      const provider = await providerForTool(providers, scope, name)
      if (!provider) throw new Error(`Unknown Agent tool: ${name}`)
      return provider.callTool(scope, name, input)
    },
  }
}

async function providerForTool(providers: readonly AgentToolProvider[], scope: AgentToolScope, name: string) {
  let match: AgentToolProvider | undefined
  for (const provider of providers) {
    if (!(await provider.listTools(scope)).some((definition) => definition.name === name)) continue
    if (match) throw new Error(`Duplicate Agent tool name: ${name}`)
    match = provider
  }
  return match
}
