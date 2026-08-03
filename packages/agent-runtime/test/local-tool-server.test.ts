import { describe, expect, test } from "bun:test"
import type { AgentToolScope } from "../src/contracts"
import { AgentLocalToolServer } from "../src/node/local-tool-server"

async function rpc(url: string, headers: Record<string, string>, body: Record<string, unknown>) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { ...headers, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    method: "POST",
  })
  return { response, value: (await response.json()) as Record<string, unknown> }
}

async function readEventStream(
  response: Response,
  onMessage?: (message: Record<string, unknown>) => void,
): Promise<Array<Record<string, unknown>>> {
  if (!response.body) throw new Error("Missing SSE response body")
  const messages: Array<Record<string, unknown>> = []
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    for (;;) {
      const boundary = buffer.indexOf("\n\n")
      if (boundary < 0) break
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      if (!data) continue
      const message = JSON.parse(data) as Record<string, unknown>
      messages.push(message)
      onMessage?.(message)
    }
    if (done) return messages
  }
}

describe("AgentLocalToolServer", () => {
  test("exposes authenticated MCP tools inside one opaque workspace scope", async () => {
    const calls: Array<{ input: Record<string, unknown>; name: string; scope: AgentToolScope }> = []
    const server = new AgentLocalToolServer(
      {
        async callTool(scope, name, input) {
          calls.push({ input, name, scope })
          return { echoed: input.value, scopeId: scope.scopeId }
        },
        listTools: () => [
          {
            description: "Echo a value",
            inputSchema: {
              additionalProperties: false,
              properties: { value: { type: "string" } },
              required: ["value"],
              type: "object",
            },
            name: "echo",
          },
        ],
      },
      "bridge",
    )
    const registration = await server.registerScope({ directory: "/workspace/a", scopeId: "workspace-a" })

    try {
      const unauthorized = await fetch(registration.url, {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      expect(unauthorized.status).toBe(401)

      const initialized = await rpc(registration.url, registration.headers, {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      })
      expect(initialized.response.status).toBe(200)
      expect(initialized.response.headers.get("content-type")).toContain("application/json")
      expect(initialized.value).toMatchObject({
        result: {
          capabilities: { tools: {} },
          protocolVersion: "2025-03-26",
          serverInfo: { name: "bridge" },
        },
      })

      const listed = await rpc(registration.url, registration.headers, {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
      })
      expect(listed.response.headers.get("content-type")).toContain("application/json")
      expect(listed.value).toMatchObject({ result: { tools: [{ name: "echo" }] } })

      const called = await rpc(registration.url, registration.headers, {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { value: "hello" }, name: "echo" },
      })
      expect(called.response.headers.get("content-type")).toContain("application/json")
      const result = called.value.result as { content: Array<{ text: string }> }
      expect(JSON.parse(result.content[0]!.text)).toEqual({ echoed: "hello", scopeId: "workspace-a" })
      expect(calls).toEqual([
        {
          input: { value: "hello" },
          name: "echo",
          scope: { directory: "/workspace/a", scopeId: "workspace-a" },
        },
      ])
    } finally {
      await server.close()
    }
  })

  test("streams progress beyond a client timeout window before the final tool result", async () => {
    let markCallStarted: (() => void) | undefined
    let finishCall: ((value: { generated: boolean }) => void) | undefined
    const callStarted = new Promise<void>((resolve) => {
      markCallStarted = resolve
    })
    const callFinished = new Promise<{ generated: boolean }>((resolve) => {
      finishCall = resolve
    })
    const server = new AgentLocalToolServer(
      {
        async callTool() {
          markCallStarted?.()
          return callFinished
        },
        listTools: () => [{ description: "Wait for generation", inputSchema: {}, name: "generate" }],
      },
      "host",
      { progressHeartbeatMs: 5 },
    )
    const registration = await server.registerScope({ directory: "/workspace/a", scopeId: "workspace-a" })
    const progressToken = "opaque-progress-token"
    const timeoutWindowMs = 40
    const startedAt = Date.now()
    let progressCount = 0
    let markProgressPastTimeout: (() => void) | undefined
    const progressPastTimeout = new Promise<void>((resolve) => {
      markProgressPastTimeout = resolve
    })

    try {
      const response = await fetch(registration.url, {
        body: JSON.stringify({
          id: 71,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            _meta: { progressToken },
            arguments: { prompt: "private prompt" },
            name: "generate",
          },
        }),
        headers: {
          ...registration.headers,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        method: "POST",
      })
      expect(response.headers.get("content-type")).toContain("text/event-stream")
      const messagesPromise = readEventStream(response, (message) => {
        if (message.method !== "notifications/progress") return
        progressCount += 1
        expect(message).toMatchObject({
          jsonrpc: "2.0",
          params: { progressToken },
        })
        expect(JSON.stringify(message)).not.toContain("private prompt")
        expect(JSON.stringify(message)).not.toContain("workspace-a")
        if (progressCount > 1 && Date.now() - startedAt > timeoutWindowMs) markProgressPastTimeout?.()
      })

      await callStarted
      const progressOutcome = await Promise.race([
        progressPastTimeout.then(() => "received" as const),
        Bun.sleep(1_000).then(() => "timed-out" as const),
      ])
      expect(progressOutcome).toBe("received")
      expect(progressCount).toBeGreaterThan(1)
      finishCall?.({ generated: true })

      const messages = await messagesPromise
      expect(messages.at(-1)).toMatchObject({
        id: 71,
        jsonrpc: "2.0",
        result: { content: [{ type: "text" }] },
      })
      const result = messages.at(-1)?.result as { content: Array<{ text: string }> }
      expect(JSON.parse(result.content[0]!.text)).toEqual({ generated: true })
    } finally {
      finishCall?.({ generated: true })
      await server.close()
    }
  })

  test("cancels an SSE tool call and returns the cancellation error on that stream", async () => {
    let markCallStarted: (() => void) | undefined
    let markCallAborted: (() => void) | undefined
    let markProgress: (() => void) | undefined
    const callStarted = new Promise<void>((resolve) => {
      markCallStarted = resolve
    })
    const callAborted = new Promise<void>((resolve) => {
      markCallAborted = resolve
    })
    const progressReceived = new Promise<void>((resolve) => {
      markProgress = resolve
    })
    const server = new AgentLocalToolServer(
      {
        async callTool(_scope, _name, _input, context) {
          if (!context?.signal) throw new Error("Missing host tool AbortSignal")
          markCallStarted?.()
          return new Promise<never>((_resolve, reject) => {
            context.signal?.addEventListener(
              "abort",
              () => {
                markCallAborted?.()
                reject(context.signal?.reason)
              },
              { once: true },
            )
          })
        },
        listTools: () => [{ description: "Wait", inputSchema: {}, name: "wait" }],
      },
      "host",
      { progressHeartbeatMs: 5 },
    )
    const registration = await server.registerScope({ directory: "/workspace/a", scopeId: "workspace-a" })

    try {
      const response = await fetch(registration.url, {
        body: JSON.stringify({
          id: 72,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { _meta: { progressToken: 72 }, name: "wait" },
        }),
        headers: {
          ...registration.headers,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        method: "POST",
      })
      const messagesPromise = readEventStream(response, (message) => {
        if (message.method === "notifications/progress") markProgress?.()
      })
      await Promise.all([callStarted, progressReceived])

      const cancelled = await fetch(registration.url, {
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: 72 },
        }),
        headers: { ...registration.headers, "Content-Type": "application/json" },
        method: "POST",
      })
      expect(cancelled.status).toBe(202)
      await callAborted

      const messages = await messagesPromise
      expect(messages.at(-1)).toEqual({
        error: { code: -32800, message: "Request cancelled" },
        id: 72,
        jsonrpc: "2.0",
      })
    } finally {
      await server.close()
    }
  })

  test("keeps a tool call on JSON without both SSE negotiation and a legal progress token", async () => {
    const server = new AgentLocalToolServer({
      callTool: async () => ({ ok: true }),
      listTools: () => [{ description: "Echo", inputSchema: {}, name: "echo" }],
    })
    const registration = await server.registerScope({ directory: "/workspace/a", scopeId: "workspace-a" })

    try {
      const response = await fetch(registration.url, {
        body: JSON.stringify({
          id: 73,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { _meta: { progressToken: 73 }, name: "echo" },
        }),
        headers: {
          ...registration.headers,
          Accept: "application/json, text/event-stream; q=0",
          "Content-Type": "application/json",
        },
        method: "POST",
      })
      expect(response.headers.get("content-type")).toContain("application/json")
      expect(await response.json()).toMatchObject({ id: 73, result: { content: [{ type: "text" }] } })

      for (const [offset, progressToken] of [1.5, "", "x".repeat(257), Number.MAX_SAFE_INTEGER + 1].entries()) {
        const id = 74 + offset
        const invalidTokenResponse = await fetch(registration.url, {
          body: JSON.stringify({
            id,
            jsonrpc: "2.0",
            method: "tools/call",
            params: { _meta: { progressToken }, name: "echo" },
          }),
          headers: {
            ...registration.headers,
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
          },
          method: "POST",
        })
        expect(invalidTokenResponse.headers.get("content-type")).toContain("application/json")
        expect(await invalidTokenResponse.json()).toMatchObject({
          id,
          result: { content: [{ type: "text" }] },
        })
      }
    } finally {
      await server.close()
    }
  })

  test("rejects an unsafe progress heartbeat interval", () => {
    const provider = {
      callTool: async () => undefined,
      listTools: () => [],
    }
    expect(() => new AgentLocalToolServer(provider, "host", { progressHeartbeatMs: 1.5 })).toThrow(
      "positive safe timer interval",
    )
    expect(() => new AgentLocalToolServer(provider, "host", { progressHeartbeatMs: 2_147_483_648 })).toThrow(
      "positive safe timer interval",
    )
  })

  test("aborts an in-flight tool when its HTTP transport shuts down", async () => {
    let markCallStarted: (() => void) | undefined
    let markCallAborted: (() => void) | undefined
    const callStarted = new Promise<void>((resolve) => {
      markCallStarted = resolve
    })
    const callAborted = new Promise<void>((resolve) => {
      markCallAborted = resolve
    })
    const server = new AgentLocalToolServer({
      async callTool(_scope, _name, _input, context) {
        markCallStarted?.()
        return new Promise<never>((_resolve, reject) => {
          context?.signal?.addEventListener(
            "abort",
            () => {
              markCallAborted?.()
              reject(context.signal?.reason)
            },
            { once: true },
          )
        })
      },
      listTools: () => [{ description: "Wait", inputSchema: {}, name: "wait" }],
    })
    const registration = await server.registerScope({ directory: "/workspace/a", scopeId: "workspace-a" })
    const pendingRequest = fetch(registration.url, {
      body: JSON.stringify({ id: 9, jsonrpc: "2.0", method: "tools/call", params: { name: "wait" } }),
      headers: { ...registration.headers, "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => undefined)

    try {
      await callStarted
      await server.close()
      const outcome = await Promise.race([
        callAborted.then(() => "aborted" as const),
        Bun.sleep(1_000).then(() => "timed-out" as const),
      ])
      expect(outcome).toBe("aborted")
      await pendingRequest
    } finally {
      await server.close()
    }
  })

  test("cancels only the matching scoped JSON-RPC tool request", async () => {
    const started = new Map<string, Promise<void>>()
    const markStarted = new Map<string, () => void>()
    const signals = new Map<string, AbortSignal>()
    for (const scopeId of ["workspace-a", "workspace-b"]) {
      started.set(
        scopeId,
        new Promise<void>((resolve) => {
          markStarted.set(scopeId, resolve)
        }),
      )
    }
    const server = new AgentLocalToolServer({
      async callTool(scope, _name, _input, context) {
        if (!context?.signal) throw new Error("Missing host tool AbortSignal")
        signals.set(scope.scopeId, context.signal)
        markStarted.get(scope.scopeId)?.()
        return new Promise<never>((_resolve, reject) => {
          context.signal?.addEventListener("abort", () => reject(context.signal?.reason), { once: true })
        })
      },
      listTools: () => [{ description: "Wait", inputSchema: {}, name: "wait" }],
    })
    const first = await server.registerScope({ directory: "/workspace/a", scopeId: "workspace-a" })
    const second = await server.registerScope({ directory: "/workspace/b", scopeId: "workspace-b" })
    const call = (registration: typeof first) =>
      fetch(registration.url, {
        body: JSON.stringify({ id: 41, jsonrpc: "2.0", method: "tools/call", params: { name: "wait" } }),
        headers: { ...registration.headers, "Content-Type": "application/json" },
        method: "POST",
      })
    const cancel = (registration: typeof first, requestId: number) =>
      fetch(registration.url, {
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId } }),
        headers: { ...registration.headers, "Content-Type": "application/json" },
        method: "POST",
      })
    const firstCall = call(first)
    const secondCall = call(second)

    try {
      await Promise.all(started.values())

      expect((await cancel(first, 999)).status).toBe(202)
      expect(signals.get("workspace-a")?.aborted).toBe(false)
      expect(signals.get("workspace-b")?.aborted).toBe(false)

      expect((await cancel(first, 41)).status).toBe(202)
      expect(signals.get("workspace-a")?.aborted).toBe(true)
      expect(signals.get("workspace-b")?.aborted).toBe(false)

      expect((await cancel(second, 41)).status).toBe(202)
      expect(signals.get("workspace-b")?.aborted).toBe(true)
      expect((await firstCall).status).toBe(200)
      expect((await secondCall).status).toBe(200)
    } finally {
      await server.close()
    }
  })

  test("closes promptly while an MCP request is still in flight", async () => {
    let markRequestStarted: (() => void) | undefined
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })
    const neverCompletes = new Promise<never>(() => undefined)
    const server = new AgentLocalToolServer({
      callTool: async () => undefined,
      listTools: async () => {
        markRequestStarted?.()
        return neverCompletes
      },
    })
    const registration = await server.registerScope({ directory: "/workspace/a", scopeId: "workspace-a" })
    const pendingRequest = fetch(registration.url, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list", params: {} }),
      headers: { ...registration.headers, "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => undefined)

    await requestStarted
    const result = await Promise.race([
      server.close().then(() => "closed" as const),
      Bun.sleep(1_000).then(() => "timed-out" as const),
    ])
    expect(result).toBe("closed")
    await pendingRequest
  })
})
