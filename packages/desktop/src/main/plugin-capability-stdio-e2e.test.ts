/* oxlint-disable typescript-eslint/await-thenable -- Bun's async matchers are thenable at runtime. */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { parsePluginCapabilityDeclaration, type PluginCapabilityDeclaration } from "@convax/plugin-sdk"
import { PluginCapabilityBrokerMainService } from "./plugin-capability-broker-service"
import { GenerationPluginRuntime } from "./generation-plugin-runtime"
import { PluginInstallationRuntime, type PluginInstallationCandidate } from "./plugin-installation-runtime"
import { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import { StdioMcpClient } from "./stdio-mcp-client"

const roots: string[] = []
const fixturePath = path.join(import.meta.dir, "plugin-capability-stdio-e2e.fixture.ts")
const schema = {
  additionalProperties: false,
  properties: { text: { maxLength: 128, type: "string" } },
  required: ["text"],
  type: "object",
} as const

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function declaration(input: {
  exports?: readonly string[]
  optional?: readonly string[]
  required?: readonly string[]
}): PluginCapabilityDeclaration {
  return parsePluginCapabilityDeclaration({
    exports: (input.exports ?? []).map((id) => ({
      docs: { request: "Text.", response: "Text.", summary: `Provides ${id}.` },
      id,
      inputSchema: schema,
      operation: id,
      outputSchema: schema,
      sideEffect: "execute",
      version: "1.0.0",
    })),
    imports: {
      optional: (input.optional ?? []).map((id) => ({
        id,
        inputSchema: schema,
        outputSchema: schema,
        version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
      })),
      required: (input.required ?? []).map((id) => ({
        id,
        inputSchema: schema,
        outputSchema: schema,
        version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
      })),
    },
  })
}

async function candidate(input: {
  args?: readonly string[]
  capabilities: PluginCapabilityDeclaration
  id: string
  projectsRead?: boolean
}): Promise<PluginInstallationCandidate> {
  const bytes = await fs.readFile(fixturePath)
  const executable = input.capabilities.exports.length > 0
  const manifest = {
    capabilities: input.projectsRead ? ["projects.read"] : [],
    contributes: {
      capabilities: input.capabilities,
      ...(executable ? {} : { canvas: { renderer: { create: true } } }),
    },
    description: `${input.id} real stdio fixture`,
    hostApi: {
      major: 1,
      optional: [],
      required: input.projectsRead ? ["projects.list"] : executable ? [] : ["host.context.get"],
    },
    id: input.id,
    name: input.id,
    ...(executable ? {} : { entry: "index.html" }),
    ...(executable
      ? {
          runtime: {
            ...(input.args ? { args: [...input.args] } : {}),
            command: `${input.id}-sidecar`,
            type: "mcp-stdio",
          },
        }
      : {}),
    schema: "convax.plugin/8",
    version: "1.0.0",
  }
  return {
    artifact: { sha256: sha256(`${input.id}:archive`), size: 1_024 },
    ...(executable
      ? {
          companion: {
            bytes,
            entryPath: `bin/${input.id}.ts`,
            mode: "convax-bun" as const,
            target: "darwin-arm64",
          },
          executionAuthorization: { companion: true },
        }
      : {}),
    files: {
      ...(executable ? {} : { "index.html": `<h1>${input.id}</h1>` }),
      "manifest.json": JSON.stringify(manifest),
    },
    sourceIdentity: sha256(`${input.id}:source`),
  }
}

async function journal(pathname: string) {
  try {
    return (await fs.readFile(pathname, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; operation: string; pid: number; requestId?: number })
  } catch {
    return []
  }
}

async function waitForJournal(pathname: string, predicate: (entries: Awaited<ReturnType<typeof journal>>) => boolean) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const entries = await journal(pathname)
    if (predicate(entries)) return entries
    await Bun.sleep(2)
  }
  throw new Error("Timed out waiting for sidecar journal")
}

async function waitForWorkingDirectory(setup: { readonly workingDirectory?: string }) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (setup.workingDirectory) return setup.workingDirectory
    await Bun.sleep(2)
  }
  throw new Error("Timed out waiting for sidecar process creation")
}

async function fixture(
  specs: readonly {
    args?: readonly string[]
    capabilities: PluginCapabilityDeclaration
    id: string
    projectsRead?: boolean
  }[],
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-p2p-stdio-"))
  roots.push(root)
  const installations = new PluginInstallationRuntime(path.join(root, "installations"))
  let revision = 0
  for (const spec of specs) {
    const published = await installations.publish(revision, await candidate(spec))
    revision = published.revision
  }
  const principals = new InstalledPluginPrincipalResolver(installations)
  let projectReads = 0
  let workingDirectory: string | undefined
  const sidecars = new GenerationPluginRuntime({
    bunRuntime: { command: process.execPath },
    canvasCapabilities: {
      async connect(request) {
        return {
          close() {},
          async execute(call, context) {
            if (call.method !== "projects.list") throw new Error("Unexpected reverse Host API call")
            await request.invocationLease?.assertActive(request.invocationLease.claims)
            if (context.signal?.aborted) throw new Error("Reverse Host API call was aborted")
            projectReads += 1
            return {
              projects: [
                {
                  createdAt: 1,
                  id: "project-one",
                  lastOpenedAt: 1,
                  missing: false,
                  name: "One",
                },
              ],
            }
          },
          supports(method) {
            return method === "projects.list"
          },
        }
      },
      principals,
    },
    createClient(options) {
      workingDirectory = options.cwd
      return new StdioMcpClient(options)
    },
    environment: {},
    platform: "darwin",
    pluginRuntimeState: async () => "enabled",
    plugins: installations,
  })
  const service = new PluginCapabilityBrokerMainService({
    installations,
    limits: { maximumInFlight: 4, maximumInFlightPerCaller: 2 },
    principals,
    sidecars,
  })
  return {
    installations,
    principals,
    get projectReads() {
      return projectReads
    },
    root,
    service,
    sidecars,
    get workingDirectory() {
      return workingDirectory
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("Plugin capability real stdio composition", () => {
  test("uses one gateway child for tools/list, invoke, reverse Host API, and nested Plugin invoke", async () => {
    const setup = await fixture([
      {
        args: ["--operation=media.child", "--journal=events.jsonl"],
        capabilities: declaration({ exports: ["media.child"] }),
        id: "child",
      },
      {
        args: ["--operation=media.gateway", "--nested-capability=media.child", "--journal=events.jsonl"],
        capabilities: declaration({ exports: ["media.gateway"], optional: ["media.child"] }),
        id: "gateway",
        projectsRead: true,
      },
      {
        capabilities: declaration({ required: ["media.gateway"] }),
        id: "caller",
      },
    ])
    const principal = await setup.principals.issue("caller", "web")
    await expect(setup.service.getAvailability(principal, "media.gateway")).resolves.toEqual({
      available: true,
      capabilityId: "media.gateway",
      requirement: "required",
      version: "1.0.0",
    })
    const result = await setup.service.invoke(principal, {
      capabilityId: "media.gateway",
      input: { text: "real stdio" },
      requestId: "real-stdio-nested",
    })
    expect(result).toEqual({ text: "real stdio" })
    expect(setup.projectReads).toBe(1)

    const log = path.join(await waitForWorkingDirectory(setup), "events.jsonl")
    const entries = await waitForJournal(
      log,
      (current) =>
        current.some(({ event, operation }) => event === "call-complete" && operation === "media.gateway") &&
        current.some(({ event, operation }) => event === "call-complete" && operation === "media.child"),
    )
    const gateway = entries.filter((entry) => entry.operation === "media.gateway")
    const child = entries.filter((entry) => entry.operation === "media.child")
    expect(new Set(gateway.map(({ pid }) => pid)).size).toBe(1)
    expect(new Set(child.map(({ pid }) => pid)).size).toBe(1)
    expect(gateway.some(({ event }) => event === "tools-list")).toBeTrue()
    expect(gateway.some(({ event }) => event === "call-complete")).toBeTrue()
    expect(child.some(({ event }) => event === "call-complete")).toBeTrue()
    expect(gateway[0]?.pid).not.toBe(child[0]?.pid)
    await setup.sidecars.disposeAndWait()
  })

  test("delivers JSON-RPC cancellation, frees capacity, and keeps the process usable", async () => {
    const setup = await fixture([
      {
        args: ["--operation=media.transform", "--journal=events.jsonl"],
        capabilities: declaration({ exports: ["media.transform"] }),
        id: "provider",
      },
      {
        capabilities: declaration({ required: ["media.transform"] }),
        id: "caller",
      },
    ])
    const principal = await setup.principals.issue("caller", "web")
    const controller = new AbortController()
    const pending = setup.service.invoke(
      principal,
      {
        capabilityId: "media.transform",
        input: { text: "wait" },
        requestId: "stdio-cancel",
      },
      controller.signal,
    )
    const log = path.join(await waitForWorkingDirectory(setup), "events.jsonl")
    const started = await waitForJournal(log, (entries) => entries.some(({ event }) => event === "call-start"))
    const pid = started.find(({ event }) => event === "call-start")!.pid
    controller.abort("cancel real stdio call")
    await expect(pending).rejects.toMatchObject({ code: "aborted" })
    const canceled = await waitForJournal(log, (entries) => entries.some(({ event }) => event === "cancel"))
    const startId = canceled.find(({ event }) => event === "call-start")!.requestId
    expect(canceled.find(({ event }) => event === "cancel")?.requestId).toBe(startId)

    await expect(
      setup.service.invoke(principal, {
        capabilityId: "media.transform",
        input: { text: "after cancel" },
        requestId: "stdio-after-cancel",
      }),
    ).resolves.toEqual({ text: "after cancel" })
    const completed = await waitForJournal(log, (entries) => entries.some(({ event }) => event === "call-complete"))
    expect([...completed].reverse().find(({ event }) => event === "call-complete")?.pid).toBe(pid)
    await setup.sidecars.disposeAndWait()
  })

  test("never replays a crashed call and starts a new process only for a new request", async () => {
    const setup = await fixture([
      {
        args: ["--operation=media.transform", "--journal=events.jsonl", "--exit-once-flag=exit-once"],
        capabilities: declaration({ exports: ["media.transform"] }),
        id: "provider",
      },
      {
        capabilities: declaration({ required: ["media.transform"] }),
        id: "caller",
      },
    ])
    const principal = await setup.principals.issue("caller", "web")
    await expect(
      setup.service.invoke(principal, {
        capabilityId: "media.transform",
        input: { text: "exit-once" },
        requestId: "stdio-exit-once",
      }),
    ).rejects.toMatchObject({ code: "provider-failed" })
    await expect(
      setup.service.invoke(principal, {
        capabilityId: "media.transform",
        input: { text: "probe after exit" },
        requestId: "stdio-probe-after-exit",
      }),
    ).rejects.toMatchObject({ code: "unavailable" })
    await expect(
      setup.service.invoke(principal, {
        capabilityId: "media.transform",
        input: { text: "new request" },
        requestId: "stdio-new-after-exit",
      }),
    ).resolves.toEqual({ text: "new request" })

    const log = path.join(await waitForWorkingDirectory(setup), "events.jsonl")
    const entries = await journal(log)
    expect(entries.filter(({ event }) => event === "call-exit")).toHaveLength(1)
    expect(entries.filter(({ event }) => event === "call-start")).toHaveLength(2)
    expect(new Set(entries.filter(({ event }) => event === "initialize").map(({ pid }) => pid)).size).toBe(2)
    await setup.sidecars.disposeAndWait()
  })
})
