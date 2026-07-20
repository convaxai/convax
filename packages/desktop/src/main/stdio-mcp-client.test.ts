import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { StdioMcpClient } from "./stdio-mcp-client"

const clients = new Set<StdioMcpClient>()

function createClient(options: { fixtureArgs?: readonly string[]; requestTimeoutMs?: number; shutdownGraceMs?: number } = {}) {
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
    expect(await client.callTool("echo", { prompt: "hello" })).toEqual({
      content: [
        { text: '{"prompt":"hello"}', type: "text" },
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
