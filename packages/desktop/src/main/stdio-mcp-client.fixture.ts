interface JsonRpcRequest {
  error?: { code?: number; message?: string }
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

let buffer = ""
const slowInitialize = process.argv.includes("--slow-initialize")
const ignoreSigterm = process.argv.includes("--ignore-sigterm")
const invalidInitializeResponse = process.argv
  .find((argument) => argument.startsWith("--invalid-initialize-response="))
  ?.slice("--invalid-initialize-response=".length)
const stderrSecretAndExit = process.argv.includes("--stderr-secret-and-exit")
const invalidUtf8Initialize = process.argv.includes("--invalid-utf8-in-initialize")
const generationTaskId = process.argv
  .find((argument) => argument.startsWith("--generation-task-id="))
  ?.slice("--generation-task-id=".length)
const generationRecovery = process.argv.includes("--generation-recovery")
const forkDescendantFile = process.argv
  .find((argument) => argument.startsWith("--fork-descendant="))
  ?.slice("--fork-descendant=".length)
let descendantStarted = false
const hostRequestMethod = process.argv
  .find((argument) => argument.startsWith("--host-request-method="))
  ?.slice("--host-request-method=".length)
const hostRequestCount = Number.parseInt(
  process.argv
    .find((argument) => argument.startsWith("--host-request-count="))
    ?.slice("--host-request-count=".length) ?? "1",
  10,
)
let nextHostRequestId = 10_000
const pendingHostRequests = new Map<
  number,
  { resolve: (response: { error?: JsonRpcRequest["error"]; result?: unknown }) => void }
>()
const protocolVersion =
  process.argv.find((argument) => argument.startsWith("--protocol-version="))?.slice("--protocol-version=".length) ??
  "2025-03-26"

if (ignoreSigterm) {
  process.on("SIGTERM", () => undefined)
  setInterval(() => undefined, 1_000)
}

function send(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function requestHost(method: string, params: unknown) {
  const id = nextHostRequestId++
  return new Promise<{ error?: JsonRpcRequest["error"]; result?: unknown }>((resolve) => {
    pendingHostRequests.set(id, { resolve })
    send({ id, jsonrpc: "2.0", method, params })
  })
}

async function handle(request: JsonRpcRequest) {
  if (request.method === undefined && typeof request.id === "number") {
    const pending = pendingHostRequests.get(request.id)
    if (pending) {
      pendingHostRequests.delete(request.id)
      pending.resolve({
        ...(request.error ? { error: request.error } : {}),
        ...(request.result === undefined ? {} : { result: request.result }),
      })
    }
    return
  }
  if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return
  if (request.id === undefined) return
  if (request.method === "initialize") {
    if (stderrSecretAndExit) {
      process.stderr.write("SIDE_CAR_SECRET_MUST_NOT_ESCAPE", () => process.exit(17))
      return
    }
    if (invalidInitializeResponse) {
      const invalidValues: Record<string, unknown> = {
        array: [],
        boolean: true,
        null: null,
        number: 42,
        string: "not a JSON-RPC object",
      }
      send(invalidValues[invalidInitializeResponse])
      return
    }
    if (invalidUtf8Initialize) {
      process.stdout.write(
        Buffer.concat([
          Buffer.from(
            `{"id":${JSON.stringify(request.id)},"jsonrpc":"2.0","result":{"capabilities":{"tools":{}},"protocolVersion":"${protocolVersion}","serverInfo":{"name":"`,
          ),
          Buffer.from([0xc3, 0x28]),
          Buffer.from('","version":"1.0.0"}}}\n'),
        ]),
      )
      return
    }
    const respond = () =>
      send({
        id: request.id,
        jsonrpc: "2.0",
        result: {
          capabilities: {
            ...(generationRecovery
              ? {
                  experimental: {
                    "convax/generation-recovery": {
                      binding: "fixture-binding",
                      mode: "operation-exactly-once",
                      schema: "convax.generation-recovery/1",
                    },
                  },
                }
              : {}),
            tools: {},
          },
          protocolVersion,
          serverInfo: { name: "fixture", version: "1.0.0" },
        },
      })
    if (slowInitialize) setTimeout(respond, 60)
    else respond()
    return
  }
  if (request.method === "tools/list") {
    send({
      id: request.id,
      jsonrpc: "2.0",
      result: {
        tools: [
          { description: "Echo input", inputSchema: { type: "object" }, name: "echo" },
          { inputSchema: { type: "object" }, name: "wait" },
        ],
      },
    })
    if (forkDescendantFile && !descendantStarted) {
      descendantStarted = true
      const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
        stdio: "ignore",
      })
      fs.writeFileSync(forkDescendantFile, String(descendant.pid))
      setImmediate(() => process.exit(0))
    }
    return
  }
  if (request.method === "tools/call") {
    if (request.params?.name === "wait") return
    const meta = request.params?._meta
    const progressToken =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>).progressToken
        : undefined
    if (generationTaskId && typeof progressToken === "string") {
      send({
        jsonrpc: "2.0",
        method: "notifications/convax/generation-lifecycle",
        params: {
          event: "submitted",
          progressToken,
          schema: "convax.generation-lifecycle/1",
          taskId: generationTaskId,
        },
      })
    }
    const hostResponses = hostRequestMethod
      ? await Promise.all(
          Array.from(
            { length: Number.isSafeInteger(hostRequestCount) && hostRequestCount > 0 ? hostRequestCount : 1 },
            (_, index) => requestHost(hostRequestMethod, { index }),
          ),
        )
      : undefined
    send({
      id: request.id,
      jsonrpc: "2.0",
      result: {
        content: [
          { text: JSON.stringify(request.params?.arguments ?? null), type: "text" },
          { data: "iVBORw0KGgo=", mimeType: "image/png", type: "image" },
        ],
        structuredContent: {
          artifacts: [],
          requestMeta: request.params?._meta,
          ...(hostResponses === undefined ? {} : { hostResponses }),
        },
      },
    })
    return
  }
  if (generationRecovery && request.method?.startsWith("convax/generation/")) {
    if (request.method === "convax/generation/operation/acknowledge") {
      send({
        id: request.id,
        jsonrpc: "2.0",
        result: { acknowledged: true, schema: "convax.generation-recovery-acknowledgement/1" },
      })
      return
    }
    send({
      id: request.id,
      jsonrpc: "2.0",
      result: {
        schema: "convax.generation-recovery-snapshot/1",
        status: "running",
        taskId: "fixture_task",
      },
    })
    return
  }
  send({ error: { code: -32601, message: "Method not found" }, id: request.id, jsonrpc: "2.0" })
}

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  buffer += chunk
  while (true) {
    const newline = buffer.indexOf("\n")
    if (newline < 0) return
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) void handle(JSON.parse(line) as JsonRpcRequest)
  }
})
import { spawn } from "node:child_process"
import fs from "node:fs"
