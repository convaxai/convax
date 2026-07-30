#!/usr/bin/env convax-bun
import fs from "node:fs"

interface JsonRpcMessage {
  id?: number | string
  jsonrpc?: string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

const operation = argument("--operation=") ?? "media.transform"
const nestedCapability = argument("--nested-capability=")
const journalPath = argument("--journal=")
const exitOnceFlag = argument("--exit-once-flag=")
const activeCalls = new Map<number, AbortController>()
const hostRequests = new Map<number, (message: JsonRpcMessage) => void>()
let buffer = ""
let nextHostRequestId = 10_000
let outputTail = Promise.resolve()

function argument(prefix: string) {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function record(event: string, fields: Record<string, unknown> = {}) {
  if (!journalPath) return
  fs.appendFileSync(journalPath, `${JSON.stringify({ event, operation, pid: process.pid, ...fields })}\n`)
}

function write(value: unknown) {
  const line = `${JSON.stringify(value)}\n`
  outputTail = outputTail.then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (process.stdout.write(line)) {
          resolve()
          return
        }
        const onDrain = () => {
          cleanup()
          resolve()
        }
        const onError = (error: Error) => {
          cleanup()
          reject(error)
        }
        const cleanup = () => {
          process.stdout.off("drain", onDrain)
          process.stdout.off("error", onError)
        }
        process.stdout.once("drain", onDrain)
        process.stdout.once("error", onError)
      }),
  )
  return outputTail
}

function requestHost(method: string, params: Record<string, unknown>) {
  const id = nextHostRequestId++
  return new Promise<JsonRpcMessage>((resolve) => {
    hostRequests.set(id, resolve)
    void write({ id, jsonrpc: "2.0", method, params })
  })
}

function authority(params: Record<string, unknown>) {
  const metadata = params._meta
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Missing invocation metadata")
  }
  const call = (metadata as Record<string, unknown>).convaxPluginCapability
  if (!call || typeof call !== "object" || Array.isArray(call)) throw new Error("Missing invocation authority")
  const value = call as Record<string, unknown>
  if (typeof value.authorityToken !== "string" || typeof value.operationId !== "string") {
    throw new Error("Invalid invocation authority")
  }
  return {
    authorityToken: value.authorityToken,
    operationId: value.operationId,
    schema: "convax.plugin-capability-authority/1",
  }
}

async function waitUntilCanceled(signal: AbortSignal) {
  if (signal.aborted) return
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
}

async function handleRequest(message: JsonRpcMessage) {
  if (message.method === undefined && typeof message.id === "number") {
    const resolve = hostRequests.get(message.id)
    if (resolve) {
      hostRequests.delete(message.id)
      resolve(message)
    }
    return
  }
  if (message.method === "notifications/initialized") return
  if (message.method === "notifications/cancelled") {
    const requestId = message.params?.requestId
    if (typeof requestId === "number") {
      record("cancel", { requestId })
      activeCalls.get(requestId)?.abort("Host canceled Plugin call")
    }
    return
  }
  if (message.id === undefined) return
  if (message.method === "initialize") {
    record("initialize")
    await write({
      id: message.id,
      jsonrpc: "2.0",
      result: {
        capabilities: { tools: {} },
        protocolVersion: "2025-03-26",
        serverInfo: { name: "p2p-e2e", version: "1.0.0" },
      },
    })
    return
  }
  if (message.method === "tools/list") {
    record("tools-list")
    const schema = {
      additionalProperties: false,
      properties: { text: { maxLength: 128, type: "string" } },
      required: ["text"],
      type: "object",
    }
    await write({
      id: message.id,
      jsonrpc: "2.0",
      result: { tools: [{ inputSchema: schema, name: operation, outputSchema: schema }] },
    })
    return
  }
  if (message.method !== "tools/call" || typeof message.id !== "number") {
    await write({ error: { code: -32601, message: "Method not found" }, id: message.id, jsonrpc: "2.0" })
    return
  }

  const controller = new AbortController()
  activeCalls.set(message.id, controller)
  const params = message.params ?? {}
  const input =
    params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {}
  record("call-start", { requestId: message.id, text: input.text })
  try {
    if (input.text === "wait") {
      await waitUntilCanceled(controller.signal)
      record("call-canceled", { requestId: message.id })
      return
    }
    if (input.text === "exit-once" && exitOnceFlag && !fs.existsSync(exitOnceFlag)) {
      fs.writeFileSync(exitOnceFlag, "exited")
      record("call-exit", { requestId: message.id })
      await outputTail
      process.exit(23)
    }
    let result: unknown = input
    if (nestedCapability) {
      const invocation = authority(params)
      const projects = await requestHost("convax/plugin-capability/projects.list", {
        _meta: { convaxPluginCapability: invocation },
      })
      if (projects.error) throw new Error("Reverse Host request failed")
      const nested = await requestHost("convax/plugin-capability/invoke", {
        _meta: { convaxPluginCapability: invocation },
        capabilityId: nestedCapability,
        input,
        parentOperationId: invocation.operationId,
        requestId: "stdio-nested-child",
      })
      if (nested.error) throw new Error("Nested Plugin request failed")
      result = nested.result
    }
    await write({
      id: message.id,
      jsonrpc: "2.0",
      result: { content: [], structuredContent: result },
    })
    record("call-complete", { requestId: message.id })
  } finally {
    activeCalls.delete(message.id)
  }
}

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  buffer += chunk
  while (true) {
    const newline = buffer.indexOf("\n")
    if (newline < 0) return
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      const message = JSON.parse(line) as JsonRpcMessage
      void handleRequest(message).catch(async (error) => {
        const text = error instanceof Error ? error.message : String(error)
        record("handler-error", { message: text })
        if (message.id !== undefined) {
          await write({
            error: { code: -32603, message: text.slice(0, 256) },
            id: message.id,
            jsonrpc: "2.0",
          })
        }
      })
    }
  }
})
