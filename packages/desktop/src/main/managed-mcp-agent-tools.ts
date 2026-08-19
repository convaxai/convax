import type {
  AgentToolCallContext,
  AgentToolDefinition,
  AgentToolProvider,
  AgentToolScope,
} from "@convax/agent-runtime"

import type { McpToolDefinition } from "./stdio-mcp-client"

export interface ManagedMcpClient {
  callTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  close(force?: boolean): void
  listTools(signal?: AbortSignal): Promise<readonly McpToolDefinition[]>
}

export interface ManagedMcpPrincipalState {
  authorizationContractDigest: string
  enabled: boolean
  principalRevision: number
}

export interface ManagedMcpAgentToolPublication extends ManagedMcpPrincipalState {
  agentToolAllowlist?: readonly string[]
  client: ManagedMcpClient
  serverKey: string
}

export interface ManagedMcpAgentToolRegistryOptions {
  resolvePrincipal?: (serverKey: string) => Promise<ManagedMcpPrincipalState | null>
}

interface CurrentRuntime extends ManagedMcpAgentToolPublication {
  allowed?: ReadonlySet<string>
}

const serverKeyPattern = /^[A-Za-z0-9_-]{1,96}$/u
const digestPattern = /^[a-f0-9]{64}$/u
const toolNamePattern = /^[A-Za-z0-9_.:-]{1,128}$/u
const exposedPattern = /^managed_([A-Za-z0-9_-]{1,96})__(.+)$/u

function assertPublication(publication: ManagedMcpAgentToolPublication) {
  if (!serverKeyPattern.test(publication.serverKey)) throw new Error("Managed MCP server key is invalid")
  if (!digestPattern.test(publication.authorizationContractDigest)) {
    throw new Error("Managed MCP authorization contract digest is invalid")
  }
  if (!Number.isSafeInteger(publication.principalRevision) || publication.principalRevision < 1) {
    throw new Error("Managed MCP principal revision is invalid")
  }
  if (publication.agentToolAllowlist) {
    if (
      publication.agentToolAllowlist.length > 1_000 ||
      publication.agentToolAllowlist.some((name) => !toolNamePattern.test(name)) ||
      new Set(publication.agentToolAllowlist).size !== publication.agentToolAllowlist.length
    ) {
      throw new Error("Managed MCP Agent tool allowlist is invalid")
    }
  }
}

function externalName(serverKey: string, toolName: string) {
  return `managed_${serverKey}__${toolName}`
}

function exposedTool(tool: McpToolDefinition, serverKey: string): AgentToolDefinition {
  return {
    description: tool.description ?? `Managed MCP tool ${tool.name}`,
    inputSchema: structuredClone(tool.inputSchema),
    name: externalName(serverKey, tool.name),
  }
}

/**
 * Desktop-owned managed-stdio runtime projected through Agent Runtime's existing
 * bearer-authenticated loopback server. DSH receives tool schemas and calls,
 * never command, argv, cwd, environment, executable path, or process ownership.
 */
export class ManagedMcpAgentToolRegistry implements AgentToolProvider {
  readonly #resolvePrincipal?: ManagedMcpAgentToolRegistryOptions["resolvePrincipal"]
  readonly #runtimes = new Map<string, CurrentRuntime>()

  constructor(options: ManagedMcpAgentToolRegistryOptions = {}) {
    this.#resolvePrincipal = options.resolvePrincipal
  }

  publish(publication: ManagedMcpAgentToolPublication) {
    assertPublication(publication)
    const current = this.#runtimes.get(publication.serverKey)
    const next: CurrentRuntime = {
      ...publication,
      ...(publication.agentToolAllowlist
        ? { allowed: new Set(publication.agentToolAllowlist), agentToolAllowlist: [...publication.agentToolAllowlist] }
        : {}),
    }
    this.#runtimes.set(publication.serverKey, next)
    if (current && current.client !== publication.client) current.client.close()
  }

  disable(serverKey: string) {
    const current = this.#runtimes.get(serverKey)
    if (!current) return
    this.#runtimes.delete(serverKey)
    current.client.close()
  }

  close() {
    const current = [...this.#runtimes.values()]
    this.#runtimes.clear()
    for (const runtime of current) runtime.client.close(true)
  }

  async listTools(_scope: AgentToolScope): Promise<readonly AgentToolDefinition[]> {
    const tools: AgentToolDefinition[] = []
    for (const runtime of [...this.#runtimes.values()].sort((left, right) =>
      left.serverKey.localeCompare(right.serverKey, "en"),
    )) {
      if (!runtime.enabled) continue
      if (this.#resolvePrincipal) {
        const principal = await this.#resolvePrincipal(runtime.serverKey)
        if (
          !principal ||
          !principal.enabled ||
          principal.principalRevision !== runtime.principalRevision ||
          principal.authorizationContractDigest !== runtime.authorizationContractDigest
        )
          continue
      }
      const current = await runtime.client.listTools()
      for (const tool of current) {
        if (!toolNamePattern.test(tool.name) || (runtime.allowed && !runtime.allowed.has(tool.name))) continue
        tools.push(exposedTool(tool, runtime.serverKey))
      }
    }
    return tools
  }

  async callTool(
    _scope: AgentToolScope,
    name: string,
    input: Record<string, unknown>,
    context?: AgentToolCallContext,
  ): Promise<unknown> {
    const match = name.match(exposedPattern)
    const serverKey = match?.[1]
    const toolName = match?.[2]
    const runtime = serverKey ? this.#runtimes.get(serverKey) : undefined
    if (!runtime || !runtime.enabled) throw new Error("Managed MCP server is disabled or unavailable")
    if (!toolName || !toolNamePattern.test(toolName) || (runtime.allowed && !runtime.allowed.has(toolName))) {
      throw new Error("Managed MCP tool is not authorized")
    }
    if (this.#resolvePrincipal) {
      const principal = await this.#resolvePrincipal(runtime.serverKey)
      if (
        !principal ||
        !principal.enabled ||
        principal.principalRevision !== runtime.principalRevision ||
        principal.authorizationContractDigest !== runtime.authorizationContractDigest
      ) {
        throw new Error("Managed MCP installed principal changed")
      }
    }
    const advertised = await runtime.client.listTools(context?.signal)
    if (!advertised.some((tool) => tool.name === toolName)) {
      throw new Error("Managed MCP tool is no longer advertised")
    }
    return runtime.client.callTool(toolName, input, context?.signal)
  }
}
