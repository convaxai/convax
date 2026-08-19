import type { AgentClient, AgentPromptRequest } from "@convax/agent-runtime"
import type { AgentRuntime } from "@convax/agent-runtime"
import { ipcMain, type IpcMainInvokeEvent } from "electron"

import {
  prepareAgentResources,
  type AgentCanvasSnapshotResolver,
  type AgentProjectResolver,
} from "./agent-resource-preparation"
import type { AgentActivityMutationSink } from "./agent-activity-controller"

export type {
  AgentCanvasSnapshot,
  AgentCanvasSnapshotResolver,
  AgentProjectResolver,
} from "./agent-resource-preparation"

type ClientInput<Method extends Exclude<keyof AgentClient, "getStatus">> = Parameters<AgentClient[Method]>[0]

export const agentIpcChannels = {
  abort: "agent:abort",
  createSession: "agent:session-create",
  getSessionState: "agent:session-state",
  getStatus: "agent:status",
  listCapabilities: "agent:capabilities",
  listModels: "agent:models",
  listSessions: "agent:session-list",
  prompt: "agent:prompt",
  rejectQuestion: "agent:question-reject",
  replyPermission: "agent:permission-reply",
  replyQuestion: "agent:question-reply",
} as const

function registerHandler<Input, Result>(
  channel: string,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  handler: (input: Input) => Promise<Result> | Result,
) {
  ipcMain.handle(channel, (event, input: Input) => {
    if (!isTrustedSender(event)) throw new Error("Agent IPC request came from an untrusted renderer")
    return handler(input)
  })
  return () => ipcMain.removeHandler(channel)
}

export function registerAgentIpc(
  runtime: AgentRuntime,
  manager: AgentProjectResolver,
  options: {
    activity?: AgentActivityMutationSink
    canvasSnapshots?: AgentCanvasSnapshotResolver
    isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  },
) {
  const directoryFor = (scopeId: string) => manager.resolveEntryPath({ projectId: scopeId })
  const updateActivity = async (operation: (() => Promise<void>) | undefined) => {
    if (!operation) return
    try {
      await operation()
    } catch {
      console.warn("Agent activity projection update failed")
    }
  }
  const disposers = [
    registerHandler<undefined, Awaited<ReturnType<AgentClient["getStatus"]>>>(
      agentIpcChannels.getStatus,
      options.isTrustedSender,
      () => runtime.getStatus(),
    ),
    registerHandler<ClientInput<"listSessions">, Awaited<ReturnType<AgentClient["listSessions"]>>>(
      agentIpcChannels.listSessions,
      options.isTrustedSender,
      async (input) =>
        runtime.listSessions({
          directory: await directoryFor(input.scopeId),
          limit: input.limit,
          scopeId: input.scopeId,
        }),
    ),
    registerHandler<ClientInput<"createSession">, Awaited<ReturnType<AgentClient["createSession"]>>>(
      agentIpcChannels.createSession,
      options.isTrustedSender,
      async (input) =>
        runtime.createSession({
          directory: await directoryFor(input.scopeId),
          scopeId: input.scopeId,
          title: input.title,
        }),
    ),
    registerHandler<ClientInput<"getSessionState">, Awaited<ReturnType<AgentClient["getSessionState"]>>>(
      agentIpcChannels.getSessionState,
      options.isTrustedSender,
      async (input) =>
        runtime.getSessionState({
          directory: await directoryFor(input.scopeId),
          limit: input.limit,
          scopeId: input.scopeId,
          sessionId: input.sessionId,
        }),
    ),
    registerHandler<AgentPromptRequest, Awaited<ReturnType<AgentClient["prompt"]>>>(
      agentIpcChannels.prompt,
      options.isTrustedSender,
      async (input) => {
        await updateActivity(
          options.activity && (() => options.activity!.promptStarted(input.scopeId, input.sessionId)),
        )
        try {
          const result = await runtime.prompt({
            agent: input.agent,
            directory: await directoryFor(input.scopeId),
            instructions: input.instructions,
            model: input.model,
            resources: await prepareAgentResources(manager, options.canvasSnapshots, input.scopeId, input.resources),
            scopeId: input.scopeId,
            sessionId: input.sessionId,
            text: input.text,
            variant: input.variant,
          })
          await updateActivity(
            options.activity && (() => options.activity!.promptSettled(input.scopeId, input.sessionId)),
          )
          return result
        } catch (error) {
          await updateActivity(
            options.activity &&
              (() => options.activity!.promptSettled(input.scopeId, input.sessionId, { failed: true })),
          )
          throw error
        }
      },
    ),
    registerHandler<ClientInput<"abort">, void>(agentIpcChannels.abort, options.isTrustedSender, async (input) => {
      await runtime.abort({
        directory: await directoryFor(input.scopeId),
        scopeId: input.scopeId,
        sessionId: input.sessionId,
      })
      await updateActivity(options.activity && (() => options.activity!.aborted(input.scopeId, input.sessionId)))
    }),
    registerHandler<ClientInput<"listCapabilities">, Awaited<ReturnType<AgentClient["listCapabilities"]>>>(
      agentIpcChannels.listCapabilities,
      options.isTrustedSender,
      async (input) =>
        runtime.listCapabilities({
          directory: await directoryFor(input.scopeId),
          scopeId: input.scopeId,
        }),
    ),
    registerHandler<ClientInput<"listModels">, Awaited<ReturnType<AgentClient["listModels"]>>>(
      agentIpcChannels.listModels,
      options.isTrustedSender,
      async (input) =>
        runtime.listModels({
          directory: await directoryFor(input.scopeId),
          scopeId: input.scopeId,
        }),
    ),
    registerHandler<ClientInput<"replyPermission">, void>(
      agentIpcChannels.replyPermission,
      options.isTrustedSender,
      async (input) => {
        await runtime.replyPermission({
          directory: await directoryFor(input.scopeId),
          message: input.message,
          reply: input.reply,
          requestId: input.requestId,
          scopeId: input.scopeId,
        })
        await updateActivity(
          options.activity && (() => options.activity!.permissionReplied(input.scopeId, input.requestId)),
        )
      },
    ),
    registerHandler<ClientInput<"replyQuestion">, void>(
      agentIpcChannels.replyQuestion,
      options.isTrustedSender,
      async (input) => {
        await runtime.replyQuestion({
          answers: input.answers,
          directory: await directoryFor(input.scopeId),
          requestId: input.requestId,
          scopeId: input.scopeId,
        })
        await updateActivity(
          options.activity && (() => options.activity!.questionReplied(input.scopeId, input.requestId)),
        )
      },
    ),
    registerHandler<ClientInput<"rejectQuestion">, void>(
      agentIpcChannels.rejectQuestion,
      options.isTrustedSender,
      async (input) => {
        await runtime.rejectQuestion({
          directory: await directoryFor(input.scopeId),
          requestId: input.requestId,
          scopeId: input.scopeId,
        })
        await updateActivity(
          options.activity && (() => options.activity!.questionReplied(input.scopeId, input.requestId)),
        )
      },
    ),
  ]

  return () => disposers.forEach((dispose) => dispose())
}
