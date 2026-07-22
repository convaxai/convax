import { afterEach, describe, expect, mock, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { StdioMcpClient, type StdioMcpClientOptions } from "./stdio-mcp-client"

const clients = new Set<StdioMcpClient>()

function createClient(
  options: Pick<
    StdioMcpClientOptions,
    "maxConcurrentServerRequests" | "requestTimeoutMs" | "serverRequestHandler" | "shutdownGraceMs"
  > & { fixtureArgs?: readonly string[] } = {},
) {
  const { fixtureArgs = [], ...clientOptions } = options
  const client = new StdioMcpClient({
    args: [path.join(import.meta.dir, "stdio-mcp-client.fixture.ts"), ...fixtureArgs],
    command: process.execPath,
    cwd: import.meta.dir,
    env: { PATH: process.env.PATH },
    ...clientOptions,
  })
  clients.add(client)
  return client
}

afterEach(() => {
  for (const client of clients) client.close(true)
  clients.clear()
})

describe("StdioMcpClient", () => {
  test("initializes, discovers tools, and preserves structured MCP content", async () => {
    const client = createClient()

    expect(await client.listTools()).toEqual([
      { description: "Echo input", inputSchema: { type: "object" }, name: "echo" },
      { description: undefined, inputSchema: { type: "object" }, name: "wait" },
    ])
    expect(await client.callTool("echo", { prompt: "你好 🙂" })).toEqual({
      content: [
        { text: '{"prompt":"你好 🙂"}', type: "text" },
        { data: "iVBORw0KGgo=", mimeType: "image/png", type: "image" },
      ],
      structuredContent: { artifacts: [] },
    })
  })

  test("propagates cancellation to an in-flight tool call", async () => {
    const client = createClient()
    const controller = new AbortController()
    const result = client.callTool("wait", {}, controller.signal)

    setTimeout(() => controller.abort("stopped"), 20)
    await expect(result).rejects.toMatchObject({ name: "AbortError" })
  })

  test("does not let one caller cancel shared process initialization", async () => {
    const client = createClient({ fixtureArgs: ["--slow-initialize"] })
    const controller = new AbortController()
    const canceled = client.listTools(controller.signal)
    const concurrent = client.listTools()

    setTimeout(() => controller.abort("caller stopped"), 10)
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" })
    await expect(concurrent).resolves.toHaveLength(2)
  })

  test("rejects an MCP protocol version it does not implement", async () => {
    const client = createClient({ fixtureArgs: ["--protocol-version=2099-01-01"] })
    await expect(client.listTools()).rejects.toThrow("unsupported protocol version")
  })

  for (const invalidResponse of ["null", "array", "string", "number", "boolean"]) {
    test(`fails closed when the sidecar writes a JSON ${invalidResponse} instead of an object`, async () => {
      const client = createClient({ fixtureArgs: [`--invalid-initialize-response=${invalidResponse}`] })
      await expect(client.listTools()).rejects.toThrow("non-object JSON-RPC message")
    })
  }

  test("fails closed when the sidecar writes invalid UTF-8", async () => {
    const client = createClient({ fixtureArgs: ["--invalid-utf8-in-initialize"] })
    await expect(client.listTools()).rejects.toThrow("invalid UTF-8")
  })

  test("does not expose sidecar stderr through a caller-visible exit error", async () => {
    const client = createClient({ fixtureArgs: ["--stderr-secret-and-exit"] })
    let error: Error | undefined
    try {
      await client.listTools()
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught))
    }

    expect(error?.message).toContain("with code 17")
    expect(error?.message).not.toContain("SIDE_CAR_SECRET_MUST_NOT_ESCAPE")
  })

  test("times out an unresponsive MCP request", async () => {
    const client = createClient({ requestTimeoutMs: 20 })
    const result = client.callTool("wait", {})
    await expect(result).rejects.toThrow("timed out")
    await expect(result).rejects.toMatchObject({ name: "Error" })
  })

  test("lets a generation tool outlive the default request timeout until the caller cancels", async () => {
    const client = createClient({ requestTimeoutMs: 20 })
    const controller = new AbortController()
    const result = client.callTool("wait", {}, controller.signal, undefined, false)

    expect(
      await Promise.race([
        result.then(
          () => "settled",
          () => "settled",
        ),
        Bun.sleep(60).then(() => "pending"),
      ]),
    ).toBe("pending")

    controller.abort("stopped")
    await expect(result).rejects.toMatchObject({ name: "AbortError" })
    await expect(client.callTool("echo", { after: "cancel" })).resolves.toMatchObject({
      structuredContent: { artifacts: [] },
    })
  })

  test("rejects server-to-client requests by default and invokes only explicitly allowlisted methods", async () => {
    const rejected = createClient({ fixtureArgs: ["--host-request-method=convax/test"] })
    expect((await rejected.callTool("echo", {})).structuredContent).toMatchObject({
      hostResponses: [{ error: { code: -32601, message: "Method not found" } }],
    })

    const handle = mock(async ({ params }) => ({ accepted: params }))
    const allowed = createClient({
      fixtureArgs: ["--host-request-method=convax/allowed"],
      serverRequestHandler: { handle, methods: ["convax/allowed"] },
    })
    expect((await allowed.callTool("echo", {})).structuredContent).toMatchObject({
      hostResponses: [{ result: { accepted: { index: 0 } } }],
    })
    expect(handle).toHaveBeenCalledTimes(1)

    const unknown = createClient({
      fixtureArgs: ["--host-request-method=convax/unknown"],
      serverRequestHandler: { handle, methods: ["convax/allowed"] },
    })
    expect((await unknown.callTool("echo", {})).structuredContent).toMatchObject({
      hostResponses: [{ error: { code: -32601 } }],
    })
    expect(handle).toHaveBeenCalledTimes(1)
  })

  test("bounds concurrent host requests and caller-visible handler errors", async () => {
    let first = true
    const client = createClient({
      fixtureArgs: ["--host-request-method=convax/allowed", "--host-request-count=2"],
      maxConcurrentServerRequests: 1,
      serverRequestHandler: {
        async handle() {
          if (first) {
            first = false
            await Bun.sleep(20)
          }
          throw new Error("x".repeat(2_000))
        },
        methods: ["convax/allowed"],
      },
    })
    const responses = (await client.callTool("echo", {})).structuredContent?.hostResponses as Array<{
      error: { code: number; message: string }
    }>
    expect(responses.map(({ error }) => error.code).sort((left, right) => left - right)).toEqual([-32603, -32000])
    expect(Buffer.byteLength(responses.find(({ error }) => error.code === -32603)!.error.message)).toBeLessThanOrEqual(
      512,
    )
  })

  test("aborts and closes the optional server request handler with the process lifecycle", async () => {
    let contextSignal: AbortSignal | undefined
    let start!: () => void
    const started = new Promise<void>((resolve) => (start = resolve))
    const close = mock(() => undefined)
    const client = createClient({
      fixtureArgs: ["--host-request-method=convax/allowed"],
      serverRequestHandler: {
        close,
        handle(_request, context) {
          contextSignal = context.signal
          start()
          return new Promise(() => undefined)
        },
        methods: ["convax/allowed"],
      },
    })
    const call = client.callTool("echo", {})
    await started
    client.close()
    expect(contextSignal?.aborted).toBeTrue()
    expect(close).toHaveBeenCalledTimes(1)
    await expect(call).rejects.toThrow("closed")
  })

  test("force-stops a sidecar that ignores graceful termination", async () => {
    let child: ChildProcessWithoutNullStreams | undefined
    const client = new StdioMcpClient({
      args: [path.join(import.meta.dir, "stdio-mcp-client.fixture.ts"), "--ignore-sigterm"],
      command: process.execPath,
      cwd: import.meta.dir,
      env: { PATH: process.env.PATH },
      shutdownGraceMs: 20,
      spawn: ((command, args, options) => {
        child = spawn(command, args ?? [], options ?? {}) as ChildProcessWithoutNullStreams
        return child
      }) as typeof spawn,
    })
    clients.add(client)
    await client.listTools()
    const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()))

    client.close()
    await expect(
      Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]),
    ).resolves.toBeTrue()
  })

  test("immediately force-stops a sidecar without waiting for the shutdown grace period", async () => {
    let child: ChildProcessWithoutNullStreams | undefined
    const client = new StdioMcpClient({
      args: [path.join(import.meta.dir, "stdio-mcp-client.fixture.ts"), "--ignore-sigterm"],
      command: process.execPath,
      cwd: import.meta.dir,
      env: { PATH: process.env.PATH },
      shutdownGraceMs: 60_000,
      spawn: ((command, args, options) => {
        child = spawn(command, args ?? [], options ?? {}) as ChildProcessWithoutNullStreams
        return child
      }) as typeof spawn,
    })
    clients.add(client)
    await client.listTools()
    const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()))

    client.close(true)
    await expect(
      Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]),
    ).resolves.toBeTrue()
  })

  test.skipIf(process.platform === "win32")("kills a detached process group even after its leader exits", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-mcp-descendant-test-"))
    const pidFile = path.join(directory, "pid")
    let descendantPid: number | undefined
    try {
      const client = createClient({
        fixtureArgs: [`--fork-descendant=${pidFile}`],
        shutdownGraceMs: 20,
      })
      await client.listTools()
      for (let attempt = 0; attempt < 100 && descendantPid === undefined; attempt += 1) {
        descendantPid = Number.parseInt(await fs.readFile(pidFile, "utf8").catch(() => ""), 10) || undefined
        if (descendantPid === undefined) await Bun.sleep(5)
      }
      expect(descendantPid).toBeNumber()
      let alive = true
      for (let attempt = 0; attempt < 200 && alive; attempt += 1) {
        try {
          process.kill(descendantPid!, 0)
          await Bun.sleep(5)
        } catch {
          alive = false
        }
      }
      expect(alive).toBeFalse()
    } finally {
      if (descendantPid) {
        try {
          process.kill(descendantPid, "SIGKILL")
        } catch {
          // Already terminated by the client.
        }
      }
      await fs.rm(directory, { force: true, recursive: true })
    }
  })
})
