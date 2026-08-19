import { createServer, type Server } from "node:http"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { DeepSeekHarnessAgentRuntime } from "../src/node/deepseek-harness-agent-runtime"
import { DeepSeekHarnessProjectRuntime } from "../src/node/deepseek-harness-project-runtime"
import {
  MessagePortApiClient,
  serveHostFetchOverMessagePort,
  type HostMessagePort,
} from "../src/node/host-message-port-carrier"

const temporaryPaths: string[] = []
const servers: Server[] = []

async function temporaryDirectory(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryPaths.push(path)
  return path
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

function mockOpenAiServer(beforeResponse?: () => Promise<void>) {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request before responding, like an ordinary HTTP provider.
    }
    await beforeResponse?.()
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "hello from dsh", role: "assistant" }, finish_reason: null, index: 0 }],
        created: 1,
        id: "chatcmpl-test",
        model: "smoke-model",
        object: "chat.completion.chunk",
      })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
        created: 1,
        id: "chatcmpl-test",
        model: "smoke-model",
        object: "chat.completion.chunk",
      })}\n\n`,
    )
    response.end("data: [DONE]\n\n")
  })
  servers.push(server)
  return new Promise<{ server: Server; url: string }>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Mock LLM did not bind a TCP port"))
      resolve({ server, url: `http://127.0.0.1:${address.port}/v1` })
    })
  })
}

function memoryMessagePorts(): [HostMessagePort, HostMessagePort] {
  const listeners: Array<Set<(message: unknown) => void>> = [new Set(), new Set()]
  const closed = [false, false]
  return [0, 1].map((index) => ({
    close() {
      closed[index] = true
      listeners[index]!.clear()
    },
    onMessage(listener: (message: unknown) => void) {
      listeners[index]!.add(listener)
      return () => listeners[index]!.delete(listener)
    },
    postMessage(message: unknown) {
      if (closed[index]) throw new Error("port closed")
      const peer = index === 0 ? 1 : 0
      queueMicrotask(() => {
        if (!closed[peer]) for (const listener of listeners[peer]!) listener(structuredClone(message))
      })
    },
  })) as [HostMessagePort, HostMessagePort]
}

describe("DeepSeekHarnessAgentRuntime", () => {
  test("boots the official plugin tree and persists Project-scoped sessions", async () => {
    const configDirectory = await temporaryDirectory("convax-dsh-config-")
    const projectDirectory = await temporaryDirectory("convax-dsh-project-")
    const runtime = new DeepSeekHarnessAgentRuntime({ configDirectory })
    try {
      await expect(runtime.getStatus()).resolves.toEqual({ state: "ready" })
      const session = await runtime.createSession({
        directory: projectDirectory,
        title: "Harness session",
      })
      await expect(runtime.listSessions({ directory: projectDirectory })).resolves.toEqual([session])
      await expect(
        runtime.getSessionState({ directory: projectDirectory, sessionId: session.id }),
      ).resolves.toMatchObject({
        messages: [],
        pendingPermissions: [],
        pendingQuestions: [],
        session,
        status: { type: "idle" },
      })
    } finally {
      await runtime.dispose()
    }
  })

  test("mounts host tools through the authenticated Project MCP preset", async () => {
    const configDirectory = await temporaryDirectory("convax-dsh-config-")
    const projectDirectory = await temporaryDirectory("convax-dsh-project-")
    const runtime = new DeepSeekHarnessAgentRuntime({
      configDirectory,
      toolProvider: {
        async callTool() {
          return { ok: true }
        },
        listTools() {
          return [{ description: "Ping the Project host", inputSchema: { type: "object" }, name: "project_ping" }]
        },
      },
    })
    try {
      await runtime.createSession({ directory: projectDirectory })
      await expect(runtime.listCapabilities({ directory: projectDirectory, scopeId: "project-one" })).resolves.toEqual({
        skills: [],
        toolIds: ["project_ping"],
      })
    } finally {
      await runtime.dispose()
    }
  })

  test("runs a prompt through DSH and projects the durable assistant message", async () => {
    const configDirectory = await temporaryDirectory("convax-dsh-config-")
    const projectDirectory = await temporaryDirectory("convax-dsh-project-")
    const provider = await mockOpenAiServer()
    const runtime = new DeepSeekHarnessAgentRuntime({
      configDirectory,
      resolveProviders: async () => ({
        smoke: {
          models: { "smoke-model": { name: "Smoke Model" } },
          name: "Smoke",
          options: { apiKey: "test-key", baseURL: provider.url },
        },
      }),
    })
    try {
      const session = await runtime.createSession({ directory: projectDirectory })
      const message = await runtime.prompt({
        directory: projectDirectory,
        scopeId: "project-one",
        sessionId: session.id,
        text: "hello",
      })
      expect(message).toMatchObject({ role: "assistant", sessionId: session.id })
      expect(message.parts).toContainEqual(expect.objectContaining({ text: "hello from dsh", type: "text" }))
      const state = await runtime.getSessionState({ directory: projectDirectory, sessionId: session.id })
      expect(state.messages.map((item) => item.role)).toEqual(["user", "assistant"])
    } finally {
      await runtime.dispose()
    }
  })

  test("carries the official Host ApiProxy unary and event-stream planes without a new Agent DTO", async () => {
    const configDirectory = await temporaryDirectory("convax-dsh-config-")
    const projectDirectory = await temporaryDirectory("convax-dsh-project-")
    const provider = await mockOpenAiServer()
    const runtime = new DeepSeekHarnessAgentRuntime({
      configDirectory,
      resolveProviders: async () => ({
        smoke: {
          models: { "smoke-model": { name: "Smoke Model" } },
          name: "Smoke",
          options: { apiKey: "test-key", baseURL: provider.url },
        },
      }),
    })
    const [parentPort, childPort] = memoryMessagePorts()
    const client = new MessagePortApiClient(parentPort)
    let disposeCarrier = () => {}
    const abort = new AbortController()
    try {
      const host = await runtime.openProjectHost({ directory: projectDirectory, scopeId: "project-one" })
      disposeCarrier = serveHostFetchOverMessagePort(childPort, host)
      let streamOpened!: () => void
      const opened = new Promise<void>((resolve) => {
        streamOpened = resolve
      })
      const events: unknown[] = []
      const consume = (async () => {
        for await (const event of client.events.mux({}, abort.signal, streamOpened)) {
          events.push(event.payload)
          if (event.payload.type === "session/event" && event.payload.event.type === "turn/end") return
        }
      })()
      await opened
      const created = await client.sessions.create({ agentPreset: host.agentPreset, cwd: projectDirectory })
      if (!created.result.ok) throw new Error(created.result.error.message)
      const prompted = await client.sessions.prompt({
        content: [{ text: "hello", type: "text" }],
        mode: "queue",
        sessionId: created.result.value.sessionId,
      })
      if (!prompted.result.ok) throw new Error(prompted.result.error.message)
      await consume
      expect(events).toContainEqual(expect.objectContaining({ type: "session/event" }))
      const listed = await client.sessions.list({})
      expect(listed.result).toEqual(expect.objectContaining({ ok: true }))
    } finally {
      abort.abort()
      client.dispose()
      disposeCarrier()
      await runtime.dispose()
    }
  })

  test("routes ordinary AgentRuntime calls to one isolated DSH Host connection per Project", async () => {
    const root = await temporaryDirectory("convax-dsh-project-router-")
    const projectA = await temporaryDirectory("convax-dsh-project-a-")
    const projectB = await temporaryDirectory("convax-dsh-project-b-")
    let releaseProvider!: () => void
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    let requestEntered!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      requestEntered = resolve
    })
    const provider = await mockOpenAiServer(async () => {
      requestEntered()
      await providerReleased
    })
    const providers = {
      smoke: {
        models: { "smoke-model": { name: "Smoke Model" } },
        name: "Smoke",
        options: { apiKey: "test-key", baseURL: provider.url },
      },
    }
    const children = new Map<
      string,
      { child: DeepSeekHarnessAgentRuntime; client: MessagePortApiClient; disposeCarrier: () => void }
    >()
    const closed: string[] = []
    const closeProject = async (scopeId: string) => {
      const current = children.get(scopeId)
      if (!current) return
      children.delete(scopeId)
      closed.push(scopeId)
      current.client.dispose()
      current.disposeCarrier()
      await current.child.dispose()
    }
    const runtime = new DeepSeekHarnessProjectRuntime({
      closeConnections: async () => {
        await Promise.all([...children.keys()].map(closeProject))
      },
      closeProject,
      configDirectory: join(root, "host"),
      async connectProject({ directory, scopeId }) {
        const child = new DeepSeekHarnessAgentRuntime({
          configDirectory: join(root, "children", scopeId),
          resolveProviders: async () => providers,
        })
        const host = await child.openProjectHost({ directory, scopeId })
        const [parentPort, childPort] = memoryMessagePorts()
        const client = new MessagePortApiClient(parentPort)
        const disposeCarrier = serveHostFetchOverMessagePort(childPort, host)
        children.set(scopeId, { child, client, disposeCarrier })
        return { agentPreset: host.agentPreset, client, close: () => closeProject(scopeId) }
      },
      resolveProviders: async () => providers,
    })
    try {
      const a = await runtime.createSession({ directory: projectA, scopeId: "project-a", title: "A" })
      const b = await runtime.createSession({ directory: projectB, scopeId: "project-b", title: "B" })
      expect(children.size).toBe(2)
      await expect(runtime.listSessions({ directory: projectA, scopeId: "project-a" })).resolves.toEqual([a])
      await expect(runtime.listSessions({ directory: projectB, scopeId: "project-b" })).resolves.toEqual([b])
      await expect(runtime.listSessions({ directory: projectB, scopeId: "project-a" })).rejects.toThrow(
        "changed directory",
      )
      await runtime.closeProject("project-a")
      expect(closed).toEqual(["project-a"])
      expect(children.has("project-b")).toBe(true)

      const next = await runtime.createSession({ directory: projectA, scopeId: "project-a" })
      const prompting = runtime.prompt({
        directory: projectA,
        scopeId: "project-a",
        sessionId: next.id,
        text: "wait for refresh",
      })
      await requestStarted
      let refreshed = false
      const refresh = runtime.refreshConfiguration().then(() => {
        refreshed = true
      })
      await Bun.sleep(20)
      expect(refreshed).toBe(false)
      expect(children.has("project-a")).toBe(true)
      releaseProvider()
      await prompting
      await refresh
      expect(refreshed).toBe(true)
      expect(children.size).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  test("rejects protected Project metadata before resource admission", async () => {
    const configDirectory = await temporaryDirectory("convax-dsh-config-")
    const projectDirectory = await temporaryDirectory("convax-dsh-project-")
    const protectedFile = join(projectDirectory, ".convax", "project.json")
    await mkdir(join(projectDirectory, ".convax"), { recursive: true })
    await writeFile(protectedFile, "{}")
    const runtime = new DeepSeekHarnessAgentRuntime({ configDirectory, protectedPaths: [".convax"] })
    try {
      const session = await runtime.createSession({ directory: projectDirectory })
      await expect(
        runtime.prompt({
          directory: projectDirectory,
          resources: [{ kind: "file", path: protectedFile }],
          scopeId: "project-one",
          sessionId: session.id,
          text: "read this",
        }),
      ).rejects.toThrow("protected by the host")
    } finally {
      await runtime.dispose()
    }
  })
})
