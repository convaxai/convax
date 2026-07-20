interface JsonRpcRequest {
  id?: number
  method?: string
  params?: Record<string, unknown>
}

let buffer = ""
const slowInitialize = process.argv.includes("--slow-initialize")
const ignoreSigterm = process.argv.includes("--ignore-sigterm")
const invalidInitializeResponse = process.argv
  .find((argument) => argument.startsWith("--invalid-initialize-response="))
  ?.slice("--invalid-initialize-response=".length)
const stderrSecretAndExit = process.argv.includes("--stderr-secret-and-exit")
const forkDescendantFile = process.argv
  .find((argument) => argument.startsWith("--fork-descendant="))
  ?.slice("--fork-descendant=".length)
let descendantStarted = false
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

function handle(request: JsonRpcRequest) {
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
    const respond = () =>
      send({
        id: request.id,
        jsonrpc: "2.0",
        result: {
          capabilities: { tools: {} },
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
      const descendant = spawn(
        process.execPath,
        ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
        { stdio: "ignore" },
      )
      fs.writeFileSync(forkDescendantFile, String(descendant.pid))
      setImmediate(() => process.exit(0))
    }
    return
  }
  if (request.method === "tools/call") {
    if (request.params?.name === "wait") return
    send({
      id: request.id,
      jsonrpc: "2.0",
      result: {
        content: [
          { text: JSON.stringify(request.params?.arguments ?? null), type: "text" },
          { data: "iVBORw0KGgo=", mimeType: "image/png", type: "image" },
        ],
        structuredContent: { artifacts: [] },
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
    if (line) handle(JSON.parse(line) as JsonRpcRequest)
  }
})
import { spawn } from "node:child_process"
import fs from "node:fs"
