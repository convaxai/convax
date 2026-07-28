import type { ManagedMcpClient, ManagedMcpPrincipalState } from "./managed-mcp-agent-tools"
import type { McpToolDefinition } from "./stdio-mcp-client"

export type ManagedMcpHostAction = "canvas.export" | "canvas.import" | "project.files.read"
export type ManagedMcpHostGrant = "canvas.read" | "canvas.write" | "project.files.read"

export interface ManagedMcpProductActionDeclaration {
  action: ManagedMcpHostAction
  tool: string
}

export interface ManagedMcpProductActionPublication extends ManagedMcpPrincipalState {
  client: ManagedMcpClient
  grants: readonly ManagedMcpHostGrant[]
  productActions: readonly ManagedMcpProductActionDeclaration[]
  serverKey: string
  tools: readonly McpToolDefinition[]
}

export interface ManagedMcpProductActionRegistryOptions {
  handlers: Partial<Record<ManagedMcpHostAction, (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>>
  resolvePrincipal?: (serverKey: string) => Promise<ManagedMcpPrincipalState | null>
}

interface Current extends ManagedMcpProductActionPublication {
  actions: ReadonlyMap<ManagedMcpHostAction, string>
  grantsSet: ReadonlySet<ManagedMcpHostGrant>
  toolsSet: ReadonlySet<string>
}

const requiredGrant: Record<ManagedMcpHostAction, ManagedMcpHostGrant> = {
  "canvas.export": "canvas.read",
  "canvas.import": "canvas.write",
  "project.files.read": "project.files.read",
}
const toolPattern = /^[A-Za-z0-9_.:-]{1,128}$/u

/**
 * Fixed Desktop-main product-action closure. Marketplace metadata may select
 * only a fixed host action and an advertised MCP tool; it cannot define a host
 * method or input schema.
 */
export class ManagedMcpProductActionRegistry {
  readonly #handlers: ManagedMcpProductActionRegistryOptions["handlers"]
  readonly #resolvePrincipal?: ManagedMcpProductActionRegistryOptions["resolvePrincipal"]
  readonly #runtimes = new Map<string, Current>()

  constructor(options: ManagedMcpProductActionRegistryOptions) {
    this.#handlers = options.handlers
    this.#resolvePrincipal = options.resolvePrincipal
  }

  publish(publication: ManagedMcpProductActionPublication) {
    const toolsSet = new Set(publication.tools.map(({ name }) => name))
    const actions = new Map<ManagedMcpHostAction, string>()
    for (const declaration of publication.productActions) {
      if (
        !(declaration.action in requiredGrant) ||
        !toolPattern.test(declaration.tool) ||
        !toolsSet.has(declaration.tool) ||
        actions.has(declaration.action) ||
        !this.#handlers[declaration.action]
      ) {
        throw new Error("Managed MCP product action is not admitted by the fixed Host action closure")
      }
      actions.set(declaration.action, declaration.tool)
    }
    this.#runtimes.set(publication.serverKey, {
      ...publication,
      actions,
      grantsSet: new Set(publication.grants),
      toolsSet,
    })
  }

  disable(serverKey: string) {
    this.#runtimes.delete(serverKey)
  }

  async call(
    serverKey: string,
    action: ManagedMcpHostAction,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const runtime = this.#runtimes.get(serverKey)
    const tool = runtime?.actions.get(action)
    if (!runtime || !runtime.enabled || !tool) throw new Error("Managed MCP product action is unavailable")
    if (!runtime.grantsSet.has(requiredGrant[action])) throw new Error("Managed MCP product action grant is missing")
    if (this.#resolvePrincipal) {
      const principal = await this.#resolvePrincipal(serverKey)
      if (
        !principal ||
        !principal.enabled ||
        principal.principalRevision !== runtime.principalRevision ||
        principal.authorizationContractDigest !== runtime.authorizationContractDigest
      ) {
        throw new Error("Managed MCP installed principal changed")
      }
    }
    const current = await runtime.client.listTools(signal)
    if (!runtime.toolsSet.has(tool) || !current.some(({ name }) => name === tool)) {
      throw new Error("Managed MCP product action tool is no longer advertised")
    }
    const result = await runtime.client.callTool(tool, input, signal)
    return this.#handlers[action]!(result as Record<string, unknown>, signal)
  }
}
