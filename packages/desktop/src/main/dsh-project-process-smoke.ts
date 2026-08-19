import { createServer } from "node:http"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { AgentLocalToolServer } from "@convax/agent-runtime/node/local-tool-server"
import { app } from "electron"

import { DshProjectProcess } from "./dsh-project-process"

type ProjectKey = "project-a" | "project-b"

interface ProjectFixture {
  child?: DshProjectProcess
  configDirectory: string
  directory: string
  key: ProjectKey
  persona: string
  sessionId?: string
  skill: string
  tool: string
}

function rpcBody(id: number, method: string) {
  return JSON.stringify({ id, jsonrpc: "2.0", method, params: {} })
}

async function run() {
  const dshRoot = app.isPackaged
    ? join(process.resourcesPath, "dsh-runtime")
    : join(app.getAppPath(), "../..", ".packaging", "runtime", "dsh")
  const dshRuntime = {
    moduleDirectory: join(dshRoot, "node_modules"),
    utilityEntry: join(dshRoot, "dsh-project-utility.js"),
  }
  const root = await mkdtemp(join(tmpdir(), "convax-dsh-project-isolation-"))
  const fixtures: ProjectFixture[] = (["project-a", "project-b"] as const).map((key) => ({
    configDirectory: join(root, key, "dsh"),
    directory: join(root, key, "workspace"),
    key,
    persona: `PERSONA_${key.toUpperCase().replace("-", "_")}`,
    skill: `${key}-skill`,
    tool: `${key.replace("-", "_")}_ping`,
  }))
  const providerRequests = new Map<ProjectKey, unknown[]>()
  const toolCalls: Array<{ directory: string; name: string; scopeId: string }> = []
  const toolServer = new AgentLocalToolServer(
    {
      async callTool(scope, name) {
        toolCalls.push({ directory: scope.directory, name, scopeId: scope.scopeId })
        return { project: scope.scopeId }
      },
      listTools(scope) {
        const fixture = fixtures.find((item) => item.key === scope.scopeId)
        if (!fixture) throw new Error(`Unknown smoke scope: ${scope.scopeId}`)
        return [
          {
            description: `Project-isolated tool for ${fixture.key}`,
            inputSchema: { additionalProperties: false, properties: {}, type: "object" },
            name: fixture.tool,
          },
        ]
      },
    },
    "convax-project-isolation",
  )
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
    const serialized = JSON.stringify(body)
    const fixture = fixtures.find((item) => serialized.includes(item.persona))
    if (!fixture) {
      response.writeHead(400, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: "Missing isolated Project persona" } }))
      return
    }
    providerRequests.set(fixture.key, [...(providerRequests.get(fixture.key) ?? []), body])
    const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : []
    const hasToolResult = messages.some((message) => message.role === "tool")
    if (!hasToolResult) {
      const tools = Array.isArray(body.tools) ? (body.tools as Array<Record<string, unknown>>) : []
      const tool = tools.find((candidate) => JSON.stringify(candidate).includes(fixture.tool)) as
        | {
            function?: { name?: string }
          }
        | undefined
      if (!tool?.function?.name) {
        console.error("DSH_POC_TOOLS", fixture.key, JSON.stringify(tools))
        response.writeHead(400, { "content-type": "application/json" })
        response.end(
          JSON.stringify({ error: { message: `Provider did not receive ${fixture.tool}: ${JSON.stringify(tools)}` } }),
        )
        return
      }
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    function: { arguments: "{}", name: tool.function.name },
                    id: `call-${fixture.key}`,
                    index: 0,
                    type: "function",
                  },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          created: 1,
          id: `chatcmpl-${fixture.key}-tool`,
          model: "smoke-model",
          object: "chat.completion.chunk",
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }],
          created: 1,
          id: `chatcmpl-${fixture.key}-tool`,
          model: "smoke-model",
          object: "chat.completion.chunk",
        })}\n\n`,
      )
    } else {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(
        `data: ${JSON.stringify({
          choices: [
            { delta: { content: `${fixture.key}-complete`, role: "assistant" }, finish_reason: null, index: 0 },
          ],
          created: 1,
          id: `chatcmpl-${fixture.key}-complete`,
          model: "smoke-model",
          object: "chat.completion.chunk",
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          created: 1,
          id: `chatcmpl-${fixture.key}-complete`,
          model: "smoke-model",
          object: "chat.completion.chunk",
        })}\n\n`,
      )
    }
    response.end("data: [DONE]\n\n")
  })
  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject)
    provider.listen(0, "127.0.0.1", resolve)
  })
  const address = provider.address()
  if (!address || typeof address === "string") throw new Error("Mock provider failed to bind")
  const aborts = new Map<ProjectKey, AbortController>()
  try {
    await Promise.all(
      fixtures.map(async (fixture) => {
        await mkdir(fixture.directory, { recursive: true })
        const skillDirectory = join(fixture.configDirectory, "skills", "user", fixture.skill)
        await mkdir(skillDirectory, { recursive: true })
        await writeFile(
          join(skillDirectory, "SKILL.md"),
          `---\nname: ${fixture.skill}\ndescription: Skill only for ${fixture.key}\n---\n\nUse ${fixture.key}.\n`,
        )
        const registration = await toolServer.registerScope({ directory: fixture.directory, scopeId: fixture.key })
        fixture.child = await DshProjectProcess.start({
          approvalRequiredToolPrefixes: ["mcp__host__"],
          configDirectory: fixture.configDirectory,
          directory: fixture.directory,
          mcpServers: {
            host: {
              headers: registration.headers,
              networkBoundary: "host-authenticated-loopback",
              oauth: false,
              type: "remote",
              url: registration.url,
            },
          },
          moduleDirectory: dshRuntime.moduleDirectory,
          persona: fixture.persona,
          providers: {
            smoke: {
              models: { "smoke-model": { name: "Smoke Model" } },
              name: "Smoke",
              options: { apiKey: `key-${fixture.key}`, baseURL: `http://127.0.0.1:${address.port}/v1` },
            },
          },
          scopeId: fixture.key,
          utilityEntry: dshRuntime.utilityEntry,
        })
        const created = await fixture.child.client.sessions.create({
          agentPreset: fixture.child.agentPreset,
          cwd: fixture.directory,
        })
        if (!created.result.ok) throw new Error(created.result.error.message)
        fixture.sessionId = String(created.result.value.sessionId)
        const skills = await fixture.child.client.skills.list({ sessionId: created.result.value.sessionId })
        const skillText = JSON.stringify(skills)
        if (
          !skillText.includes(fixture.skill) ||
          fixtures.some((other) => other !== fixture && skillText.includes(other.skill))
        ) {
          throw new Error(`Skill projection leaked for ${fixture.key}: ${skillText}`)
        }
      }),
    )

    const approvalCount = new Map<ProjectKey, number>()
    const eventSessions = new Map<ProjectKey, Set<string>>()
    await Promise.all(
      fixtures.map(async (fixture) => {
        const child = fixture.child!
        const abort = new AbortController()
        aborts.set(fixture.key, abort)
        const sessions = new Set<string>()
        eventSessions.set(fixture.key, sessions)
        let opened!: () => void
        const streamOpen = new Promise<void>((resolve) => {
          opened = resolve
        })
        let ended!: () => void
        const turnEnded = new Promise<void>((resolve) => {
          ended = resolve
        })
        const consume = (async () => {
          for await (const envelope of child.client.events.mux({}, abort.signal, opened)) {
            const event = envelope.payload
            if ("sessionId" in event) sessions.add(String(event.sessionId))
            if (event.type === "approval/requested") {
              const response = {
                result: {
                  ok: true,
                  value: { approvalId: event.approvalId, outcome: "allowed-once", sessionId: event.sessionId },
                },
                rpcId: envelope.rpcId,
                type: "client-response",
              } as const
              const receipt = await child.client.respond(response)
              if (!receipt.accepted) throw new Error(`Approval response was rejected for ${fixture.key}`)
              approvalCount.set(fixture.key, (approvalCount.get(fixture.key) ?? 0) + 1)
            }
            if (event.type === "session/event" && event.event.type === "turn/end") {
              ended()
              return
            }
          }
        })()
        await streamOpen
        const prompted = await child.client.sessions.prompt({
          content: [{ text: `Run the only Project tool for ${fixture.key}`, type: "text" }],
          mode: "queue",
          sessionId: fixture.sessionId! as never,
        })
        if (!prompted.result.ok) throw new Error(prompted.result.error.message)
        await turnEnded
        await consume
        abort.abort()
        const history = await child.client.sessions.history({ sessionId: fixture.sessionId! as never })
        if (!history.result.ok || !JSON.stringify(history.result.value).includes(`${fixture.key}-complete`)) {
          throw new Error(`Prompt did not complete inside ${fixture.key}: ${JSON.stringify(history)}`)
        }
      }),
    )

    for (const fixture of fixtures) {
      const requests = JSON.stringify(providerRequests.get(fixture.key) ?? [])
      const other = fixtures.find((candidate) => candidate !== fixture)!
      if (!requests.includes(fixture.persona) || requests.includes(other.persona))
        throw new Error(`Persona leaked for ${fixture.key}`)
      if (!requests.includes(fixture.tool) || requests.includes(other.tool))
        throw new Error(`Tool projection leaked for ${fixture.key}`)
      if (approvalCount.get(fixture.key) !== 1)
        throw new Error(`Full four-quadrant approval flow did not run for ${fixture.key}`)
      if (
        !eventSessions.get(fixture.key)?.has(fixture.sessionId!) ||
        eventSessions.get(fixture.key)?.has(other.sessionId!)
      ) {
        throw new Error(`Event stream leaked across ${fixture.key}`)
      }
      if (
        !toolCalls.some(
          (call) => call.directory === fixture.directory && call.scopeId === fixture.key && call.name === fixture.tool,
        )
      ) {
        throw new Error(`Project MCP tool was not scoped to ${fixture.key}`)
      }
    }

    await Promise.all(
      fixtures.map(async (fixture) => {
        await fixture.child!.close()
        fixture.child = undefined
        const registration = await toolServer.registerScope({ directory: fixture.directory, scopeId: fixture.key })
        fixture.child = await DshProjectProcess.start({
          approvalRequiredToolPrefixes: ["mcp__host__"],
          configDirectory: fixture.configDirectory,
          directory: fixture.directory,
          mcpServers: { host: { headers: registration.headers, oauth: false, type: "remote", url: registration.url } },
          moduleDirectory: dshRuntime.moduleDirectory,
          persona: fixture.persona,
          providers: {
            smoke: {
              models: { "smoke-model": {} },
              name: "Smoke",
              options: { apiKey: `key-${fixture.key}`, baseURL: `http://127.0.0.1:${address.port}/v1` },
            },
          },
          scopeId: fixture.key,
          utilityEntry: dshRuntime.utilityEntry,
        })
      }),
    )
    for (const fixture of fixtures) {
      const other = fixtures.find((candidate) => candidate !== fixture)!
      const listed = await fixture.child!.client.sessions.list({})
      const listText = JSON.stringify(listed)
      if (!listText.includes(fixture.sessionId!) || listText.includes(other.sessionId!)) {
        throw new Error(`Session persistence leaked across ${fixture.key}`)
      }
      const crossHistory = await fixture.child!.client.sessions.history({ sessionId: other.sessionId! as never })
      if (crossHistory.result.ok) throw new Error(`Cross-Project history was readable from ${fixture.key}`)
      const persisted = await readdir(join(fixture.configDirectory, "sessions"), { recursive: true })
      if (!persisted.some((name) => name.endsWith("session.jsonl.zstd"))) {
        throw new Error(`Session persistence missing for ${fixture.key}`)
      }
    }

    const tokenIsolation = await Promise.all(
      fixtures.map(async (fixture, index) => {
        const registration = await toolServer.registerScope({ directory: fixture.directory, scopeId: fixture.key })
        const response = await fetch(registration.url, {
          body: rpcBody(index + 1, "tools/list"),
          headers: { ...registration.headers, "content-type": "application/json" },
          method: "POST",
        })
        const text = await response.text()
        const other = fixtures.find((candidate) => candidate !== fixture)!
        return response.ok && text.includes(fixture.tool) && !text.includes(other.tool)
      }),
    )
    if (tokenIsolation.some((isolated) => !isolated)) throw new Error("MCP scope token isolation failed")

    console.log(
      JSON.stringify({
        approvals: Object.fromEntries(approvalCount),
        packaged: app.isPackaged,
        projects: fixtures.map((fixture) => ({
          cwd: fixture.directory,
          sessionId: fixture.sessionId,
          skill: fixture.skill,
          tool: fixture.tool,
        })),
        quadrants: ["client-request", "server-response", "server-request", "client-response"],
        type: "DSH_PROJECT_ISOLATION_POC_OK",
      }),
    )
  } finally {
    for (const abort of aborts.values()) abort.abort()
    await Promise.all(fixtures.map(async (fixture) => fixture.child?.close().catch(() => undefined)))
    await toolServer.close()
    provider.closeAllConnections()
    provider.close()
    await rm(root, { force: true, recursive: true })
  }
}

void app
  .whenReady()
  .then(run)
  .then(
    () => app.quit(),
    (error) => {
      console.error(error)
      app.exit(1)
    },
  )
