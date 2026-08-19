import {
  type AgentRemoteMcpServerConfig,
  type DeepSeekHarnessProviderConfig,
} from "@convax/agent-runtime/node/deepseek-harness-agent-runtime"
import { MessagePortApiClient } from "@convax/agent-runtime/node/host-message-port-carrier"
import { MessageChannelMain, utilityProcess, type UtilityProcess } from "electron"

import { asHostMessagePort } from "./dsh-message-port"

export interface DshProjectProcessOptions {
  approvalRequiredToolPrefixes?: readonly string[]
  configDirectory: string
  directory: string
  mcpServers?: Readonly<Record<string, AgentRemoteMcpServerConfig>>
  moduleDirectory: string
  persona?: string
  providers?: Readonly<Record<string, DeepSeekHarnessProviderConfig>>
  skillDirectories?: readonly string[]
  scopeId: string
  startupTimeoutMs?: number
  utilityEntry: string
}

export class DshProjectProcess {
  private constructor(
    readonly agentPreset: string,
    readonly client: MessagePortApiClient,
    private readonly child: UtilityProcess,
  ) {}

  static async start(options: DshProjectProcessOptions) {
    const child = utilityProcess.fork(options.utilityEntry, [], {
      serviceName: `Convax DSH ${options.scopeId}`,
      stdio: "pipe",
    })
    const channel = new MessageChannelMain()
    const client = new MessagePortApiClient(asHostMessagePort(channel.port1))
    try {
      const ready = await new Promise<{ agentPreset: string }>((resolve, reject) => {
        let stderr = ""
        let settled = false
        const finish = (operation: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          child.off("exit", onExit)
          operation()
        }
        child.stderr?.setEncoding("utf8")
        child.stderr?.on("data", (chunk: string) => {
          stderr = `${stderr}${chunk}`.slice(-16_384)
        })
        const onExit = (code: number) =>
          finish(() =>
            reject(new Error(`DSH utility exited before ready (${code})${stderr.trim() ? `\n${stderr.trim()}` : ""}`)),
          )
        const timeout = setTimeout(
          () => finish(() => reject(new Error("DSH utility did not become ready before the startup deadline"))),
          options.startupTimeoutMs ?? 15_000,
        )
        child.once("exit", onExit)
        child.on("message", (message: unknown) => {
          if (typeof message !== "object" || message === null) return
          const value = message as { agentPreset?: unknown; message?: unknown; type?: unknown }
          if (value.type === "dsh/fatal")
            finish(() =>
              reject(
                new Error(
                  `${String(value.message ?? "DSH utility failed")}${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
                ),
              ),
            )
          if (value.type === "dsh/ready" && typeof value.agentPreset === "string") {
            finish(() => resolve({ agentPreset: value.agentPreset as string }))
          }
        })
        child.postMessage(
          {
            approvalRequiredToolPrefixes: options.approvalRequiredToolPrefixes,
            configDirectory: options.configDirectory,
            directory: options.directory,
            mcpServers: options.mcpServers,
            moduleDirectory: options.moduleDirectory,
            persona: options.persona,
            providers: options.providers,
            skillDirectories: options.skillDirectories,
            scopeId: options.scopeId,
            type: "dsh/init",
          },
          [channel.port2],
        )
      })
      return new DshProjectProcess(ready.agentPreset, client, child)
    } catch (error) {
      client.dispose(error)
      child.kill()
      throw error
    }
  }

  async close(timeoutMs = 5_000) {
    this.client.dispose()
    if (this.child.pid === undefined) return
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()))
    this.child.postMessage({ type: "dsh/shutdown" })
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs))
    if ((await Promise.race([exited.then(() => "exit" as const), timeout])) === "timeout") this.child.kill()
    await exited
  }
}
