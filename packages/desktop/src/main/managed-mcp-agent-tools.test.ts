import { describe, expect, mock, test } from "bun:test"

import { ManagedMcpAgentToolRegistry } from "./managed-mcp-agent-tools"

function client(tools = [{ description: "Echo text", inputSchema: { type: "object" }, name: "echo" }]) {
  return {
    callTool: mock(async (name: string, input: Record<string, unknown>) => ({ input, name })),
    close: mock(() => undefined),
    listTools: mock(async () => tools),
  }
}

describe("ManagedMcpAgentToolRegistry", () => {
  test("projects Desktop-owned stdio tools through the existing authenticated Agent loopback provider", async () => {
    const mcp = client()
    const registry = new ManagedMcpAgentToolRegistry()
    registry.publish({
      authorizationContractDigest: "a".repeat(64),
      client: mcp,
      enabled: true,
      principalRevision: 3,
      serverKey: "server_a",
    })
    expect(await registry.listTools({ directory: "/project", scopeId: "project-a" })).toEqual([
      {
        description: "Echo text",
        inputSchema: { type: "object" },
        name: "managed_server_a__echo",
      },
    ])
    await expect(
      registry.callTool(
        { directory: "/project", scopeId: "project-a" },
        "managed_server_a__echo",
        { text: "hello" },
      ),
    ).resolves.toEqual({ input: { text: "hello" }, name: "echo" })
  })

  test("disable immediately rejects new calls and terminates the Desktop-owned process", async () => {
    const mcp = client()
    const registry = new ManagedMcpAgentToolRegistry()
    registry.publish({
      authorizationContractDigest: "a".repeat(64),
      client: mcp,
      enabled: true,
      principalRevision: 1,
      serverKey: "server_a",
    })
    registry.disable("server_a")
    expect(mcp.close).toHaveBeenCalledTimes(1)
    expect(await registry.listTools({ directory: "/project", scopeId: "project-a" })).toEqual([])
    await expect(
      registry.callTool({ directory: "/project", scopeId: "project-a" }, "managed_server_a__echo", {}),
    ).rejects.toThrow("disabled or unavailable")
  })

  test("rechecks the pinned principal immediately before every tool call", async () => {
    const mcp = client()
    let revision = 1
    const registry = new ManagedMcpAgentToolRegistry({
      resolvePrincipal: async () => ({
        authorizationContractDigest: "a".repeat(64),
        enabled: true,
        principalRevision: revision,
      }),
    })
    registry.publish({
      authorizationContractDigest: "a".repeat(64),
      client: mcp,
      enabled: true,
      principalRevision: 1,
      serverKey: "server_a",
    })
    revision = 2
    await expect(
      registry.callTool({ directory: "/project", scopeId: "project-a" }, "managed_server_a__echo", {}),
    ).rejects.toThrow("installed principal changed")
    expect(mcp.callTool).not.toHaveBeenCalled()
  })

  test("does not advertise or start a runtime before the exact installed principal is active", async () => {
    const mcp = client()
    let active = false
    const registry = new ManagedMcpAgentToolRegistry({
      resolvePrincipal: async () =>
        active
          ? {
              authorizationContractDigest: "a".repeat(64),
              enabled: true,
              principalRevision: 1,
            }
          : null,
    })
    registry.publish({
      authorizationContractDigest: "a".repeat(64),
      client: mcp,
      enabled: true,
      principalRevision: 1,
      serverKey: "server_a",
    })
    expect(await registry.listTools({ directory: "/project", scopeId: "project-a" })).toEqual([])
    expect(mcp.listTools).not.toHaveBeenCalled()
    active = true
    expect(await registry.listTools({ directory: "/project", scopeId: "project-a" })).toHaveLength(1)
  })

  test("dynamic tools/list cannot extend a fixed Agent allowlist", async () => {
    const mcp = client([
      { description: "Allowed", inputSchema: { type: "object" }, name: "echo" },
      { description: "Unexpected", inputSchema: { type: "object" }, name: "admin" },
    ])
    const registry = new ManagedMcpAgentToolRegistry()
    registry.publish({
      agentToolAllowlist: ["echo"],
      authorizationContractDigest: "a".repeat(64),
      client: mcp,
      enabled: true,
      principalRevision: 1,
      serverKey: "server_a",
    })
    expect((await registry.listTools({ directory: "/project", scopeId: "project-a" })).map((tool) => tool.name)).toEqual(
      ["managed_server_a__echo"],
    )
    await expect(
      registry.callTool({ directory: "/project", scopeId: "project-a" }, "managed_server_a__admin", {}),
    ).rejects.toThrow("not authorized")
  })

  test("publishing an update drains the old process only after the replacement becomes current", () => {
    const oldClient = client()
    const nextClient = client()
    const registry = new ManagedMcpAgentToolRegistry()
    registry.publish({
      authorizationContractDigest: "a".repeat(64),
      client: oldClient,
      enabled: true,
      principalRevision: 1,
      serverKey: "server_a",
    })
    registry.publish({
      authorizationContractDigest: "b".repeat(64),
      client: nextClient,
      enabled: true,
      principalRevision: 2,
      serverKey: "server_a",
    })
    expect(oldClient.close).toHaveBeenCalledTimes(1)
    expect(nextClient.close).not.toHaveBeenCalled()
  })
})
