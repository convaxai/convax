import { describe, expect, mock, test } from "bun:test"

import { ManagedMcpProductActionRegistry } from "./managed-mcp-product-actions"

function publication(overrides: Record<string, unknown> = {}) {
  return {
    authorizationContractDigest: "a".repeat(64),
    client: {
      callTool: mock(async () => ({ content: [{ text: "ok", type: "text" }] })),
      close: mock(() => undefined),
      listTools: mock(async () => [{ inputSchema: { type: "object" }, name: "import" }]),
    },
    enabled: true,
    grants: ["canvas.write"],
    principalRevision: 1,
    productActions: [{ action: "canvas.import", tool: "import" }],
    serverKey: "fixture",
    tools: [{ inputSchema: { type: "object" }, name: "import" }],
    ...overrides,
  } as never
}

describe("ManagedMcpProductActionRegistry", () => {
  test("closes one fixed advertised tool over an installed grant and fixed no-op Host action", async () => {
    const handler = mock(async () => ({ accepted: true }))
    const registry = new ManagedMcpProductActionRegistry({ handlers: { "canvas.import": handler } })
    registry.publish(publication())
    await expect(registry.call("fixture", "canvas.import", { nodeId: "n1" })).resolves.toEqual({ accepted: true })
    expect(handler).toHaveBeenCalledWith(
      { content: [{ text: "ok", type: "text" }] },
      undefined,
    )
  })

  test("rejects missing grants, stale principals, and dynamic tools/list expansion", async () => {
    const handlers = { "canvas.import": mock(async () => undefined) }
    const missingGrant = new ManagedMcpProductActionRegistry({ handlers })
    missingGrant.publish(publication({ grants: [] }))
    await expect(missingGrant.call("fixture", "canvas.import", {})).rejects.toThrow("grant")

    const stale = new ManagedMcpProductActionRegistry({
      handlers,
      resolvePrincipal: async () => ({
        authorizationContractDigest: "b".repeat(64),
        enabled: true,
        principalRevision: 2,
      }),
    })
    stale.publish(publication())
    await expect(stale.call("fixture", "canvas.import", {})).rejects.toThrow("principal changed")

    expect(() =>
      missingGrant.publish(
        publication({
          productActions: [{ action: "canvas.import", tool: "appeared-later" }],
          tools: [{ inputSchema: { type: "object" }, name: "import" }],
        }),
      ),
    ).toThrow("fixed Host action closure")
  })
})
