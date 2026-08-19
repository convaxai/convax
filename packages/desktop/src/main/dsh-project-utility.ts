import { isAbsolute } from "node:path"

import {
  DeepSeekHarnessAgentRuntime,
  type AgentRemoteMcpServerConfig,
  type DeepSeekHarnessProviderConfig,
} from "@convax/agent-runtime/node/deepseek-harness-agent-runtime"
import { serveHostFetchOverMessagePort } from "@convax/agent-runtime/node/host-message-port-carrier"

import { asHostMessagePort } from "./dsh-message-port"

const { parentPort } = process

interface ProjectUtilityInit {
  approvalRequiredToolPrefixes?: readonly string[]
  configDirectory: string
  directory: string
  mcpServers?: Readonly<Record<string, AgentRemoteMcpServerConfig>>
  moduleDirectory: string
  persona?: string
  providers?: Readonly<Record<string, DeepSeekHarnessProviderConfig>>
  skillDirectories?: readonly string[]
  scopeId: string
  type: "dsh/init"
}

function projectUtilityInit(value: unknown): value is ProjectUtilityInit {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const input = value as Partial<ProjectUtilityInit>
  return (
    input.type === "dsh/init" &&
    typeof input.scopeId === "string" &&
    input.scopeId.length > 0 &&
    typeof input.configDirectory === "string" &&
    isAbsolute(input.configDirectory) &&
    typeof input.directory === "string" &&
    isAbsolute(input.directory) &&
    typeof input.moduleDirectory === "string" &&
    isAbsolute(input.moduleDirectory)
  )
}

function errorReport(error: unknown, seen = new Set<unknown>()): string {
  if (seen.has(error)) return "[circular error]"
  seen.add(error)
  if (!(error instanceof Error)) return String(error)
  const nested = error instanceof AggregateError ? error.errors.map((item) => errorReport(item, seen)) : []
  if (error.cause !== undefined) nested.push(errorReport(error.cause, seen))
  return `${error.stack ?? error.message}${nested.length > 0 ? `\nCaused by:\n${nested.join("\n")}` : ""}`
}

let runtime: DeepSeekHarnessAgentRuntime | undefined
let disposeCarrier: (() => void) | undefined
let stopping: Promise<void> | undefined

async function stop() {
  stopping ??= (async () => {
    disposeCarrier?.()
    disposeCarrier = undefined
    await runtime?.dispose()
    runtime = undefined
    parentPort.postMessage({ type: "dsh/stopped" })
  })()
  return stopping
}

parentPort.on("message", (event) => {
  const message = event.data
  if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "dsh/shutdown") {
    void stop().then(
      () => process.exit(0),
      () => process.exit(1),
    )
    return
  }
  if (runtime || !projectUtilityInit(message) || event.ports.length !== 1) {
    parentPort.postMessage({ message: "Invalid or duplicate DSH utility initialization", type: "dsh/fatal" })
    return
  }
  void (async () => {
    runtime = new DeepSeekHarnessAgentRuntime({
      approvalRequiredToolPrefixes: message.approvalRequiredToolPrefixes,
      configDirectory: message.configDirectory,
      moduleDirectory: message.moduleDirectory,
      persona: message.persona,
      resolveMcpServers: async () => message.mcpServers ?? {},
      resolveProviders: async () => message.providers ?? {},
      skillDirectories: message.skillDirectories,
    })
    const host = await runtime.openProjectHost({ directory: message.directory, scopeId: message.scopeId })
    disposeCarrier = serveHostFetchOverMessagePort(asHostMessagePort(event.ports[0]!), host)
    parentPort.postMessage({ agentPreset: host.agentPreset, pid: process.pid, type: "dsh/ready" })
  })().catch(async (error) => {
    parentPort.postMessage({
      message: errorReport(error),
      type: "dsh/fatal",
    })
    await stop().catch(() => undefined)
  })
})

process.once("SIGTERM", () => void stop().finally(() => process.exit(0)))
