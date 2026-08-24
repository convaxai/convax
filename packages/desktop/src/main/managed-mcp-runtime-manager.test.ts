import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, test } from "bun:test"

import { ManagedMcpAgentToolRegistry } from "./managed-mcp-agent-tools"
import {
  createManagedMcpLaunchTemplateFromVerifiedExtension,
  ManagedMcpRuntimeManager,
} from "./managed-mcp-runtime-manager"

const roots: string[] = []

async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "convax-managed-mcp-"))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((entry) => fs.rm(entry, { force: true, recursive: true })))
})

async function fixture(
  directory: string,
  options: { failToolsList?: boolean; pidFile?: string; stallToolsList?: boolean } = {},
) {
  const file = path.join(directory, "fixture-mcp")
  const content = `#!/bin/sh
${options.pidFile ? `printf '%s' "$$" > '${options.pidFile}'` : ""}
while IFS= read -r line; do
  id=$(printf '%s' "$line" | /usr/bin/sed -n 's/.*"id":\\([0-9][0-9]*\\).*/\\1/p')
  case "$line" in
    *'"method":"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}}\\n' "$id" ;;
    *'"method":"tools/list"'*) ${
      options.stallToolsList
        ? ":"
        : options.failToolsList
          ? `printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"broken update"}}\\n' "$id"`
          : `printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"echo","description":"Echo","inputSchema":{"type":"object"}}]}}\\n' "$id"`
    } ;;
    *'"method":"tools/call"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"ok"}]}}\\n' "$id" ;;
  esac
done
`
  await fs.writeFile(file, content, { mode: 0o700 })
  return {
    path: file,
    sha256: createHash("sha256").update(content).digest("hex"),
    size: Buffer.byteLength(content),
  }
}

const launch = () => createManagedMcpLaunchTemplateFromVerifiedExtension({ command: "fixture-mcp" })

test("launches an exact private snapshot and completes a real stdio tool call", async () => {
  if (process.platform === "win32") return
  const directory = await root()
  const executable = await fixture(directory)
  const agentTools = new ManagedMcpAgentToolRegistry()
  const manager = new ManagedMcpRuntimeManager({ agentTools, root: path.join(directory, "runtime") })
  try {
    await manager.publish({
      agentToolAllowlist: ["echo"],
      authorizationContractDigest: "a".repeat(64),
      enabled: true,
      executable,
      launch: launch(),
      principalRevision: 1,
      serverKey: "fixture",
    })
    expect((await agentTools.listTools({ directory, scopeId: "project" })).map((tool) => tool.name)).toEqual([
      "managed_fixture__echo",
    ])
    await expect(
      agentTools.callTool({ directory, scopeId: "project" }, "managed_fixture__echo", {}),
    ).resolves.toEqual({
      content: [{ text: "ok", type: "text" }],
      isError: undefined,
      structuredContent: undefined,
    })
    expect(await fs.realpath(executable.path)).not.toContain(path.join(directory, "runtime"))
  } finally {
    await manager.close()
  }
})

test("fails closed on executable drift before process start", async () => {
  const directory = await root()
  const executable = await fixture(directory)
  await fs.appendFile(executable.path, "\n# changed")
  const manager = new ManagedMcpRuntimeManager({
    agentTools: new ManagedMcpAgentToolRegistry(),
    platform: "linux",
    root: path.join(directory, "runtime"),
  })
  await expect(
    manager.publish({
      authorizationContractDigest: "a".repeat(64),
      enabled: true,
      executable,
      launch: launch(),
      principalRevision: 1,
      serverKey: "fixture",
    }),
  ).rejects.toThrow("changed")
  await manager.close()
})

test("rejects path commands, dynamic environment, and unsupported process-tree ownership", async () => {
  const directory = await root()
  const executable = await fixture(directory)
  const manager = new ManagedMcpRuntimeManager({
    agentTools: new ManagedMcpAgentToolRegistry(),
    platform: "win32",
    root: path.join(directory, "runtime"),
  })
  expect(() => createManagedMcpLaunchTemplateFromVerifiedExtension({ command: "../fixture-mcp" })).toThrow(
    "bare command",
  )
  await expect(
    manager.publish({
      authorizationContractDigest: "a".repeat(64),
      enabled: true,
      env: { TOKEN: "secret" },
      executable,
      launch: launch(),
      principalRevision: 1,
      serverKey: "fixture",
    } as never),
  ).rejects.toThrow("environment")
  await manager.close()
})

test("keeps the old runtime live when an update fails initialize or tools/list", async () => {
  if (process.platform === "win32") return
  const directory = await root()
  const oldExecutable = await fixture(path.join(directory, "old").replace(/\/old$/u, ""))
  const replacementDirectory = await fs.mkdtemp(path.join(directory, "replacement-"))
  const brokenExecutable = await fixture(replacementDirectory, { failToolsList: true })
  const agentTools = new ManagedMcpAgentToolRegistry()
  const manager = new ManagedMcpRuntimeManager({ agentTools, root: path.join(directory, "runtime") })
  try {
    await manager.publish({
      authorizationContractDigest: "a".repeat(64),
      enabled: true,
      executable: oldExecutable,
      launch: launch(),
      principalRevision: 1,
      serverKey: "fixture",
    })
    await expect(
      manager.publish({
        authorizationContractDigest: "b".repeat(64),
        enabled: true,
        executable: brokenExecutable,
        launch: launch(),
        principalRevision: 2,
        serverKey: "fixture",
      }),
    ).rejects.toThrow("broken update")
    await expect(
      agentTools.callTool({ directory, scopeId: "project" }, "managed_fixture__echo", {}),
    ).resolves.toMatchObject({ content: [{ text: "ok", type: "text" }] })
  } finally {
    await manager.close()
  }
})

test("cancellation during candidate handshake preserves the current runtime and removes the candidate", async () => {
  if (process.platform === "win32") return
  const directory = await root()
  const oldDirectory = await fs.mkdtemp(path.join(directory, "old-"))
  const stalledDirectory = await fs.mkdtemp(path.join(directory, "stalled-"))
  const oldExecutable = await fixture(oldDirectory)
  const stalledExecutable = await fixture(stalledDirectory, { stallToolsList: true })
  const runtimeRoot = path.join(directory, "runtime")
  const agentTools = new ManagedMcpAgentToolRegistry()
  const manager = new ManagedMcpRuntimeManager({ agentTools, root: runtimeRoot })
  try {
    await manager.publish({
      authorizationContractDigest: "a".repeat(64),
      enabled: true,
      executable: oldExecutable,
      launch: launch(),
      principalRevision: 1,
      serverKey: "fixture",
    })
    const controller = new AbortController()
    const update = manager.publish(
      {
        authorizationContractDigest: "b".repeat(64),
        enabled: true,
        executable: stalledExecutable,
        launch: launch(),
        principalRevision: 2,
        serverKey: "fixture",
      },
      controller.signal,
    )
    controller.abort("cancel update")
    await expect(update).rejects.toMatchObject({ name: "AbortError" })
    await expect(
      agentTools.callTool({ directory, scopeId: "project" }, "managed_fixture__echo", {}),
    ).resolves.toMatchObject({ content: [{ text: "ok", type: "text" }] })
    expect((await fs.readdir(path.join(runtimeRoot, "fixture"))).length).toBe(1)
  } finally {
    await manager.close()
  }
})

test("awaited disable terminates the real process before removing its launch snapshot", async () => {
  if (process.platform === "win32") return
  const directory = await root()
  const pidFile = path.join(directory, "pid")
  const executable = await fixture(directory, { pidFile })
  const manager = new ManagedMcpRuntimeManager({
    agentTools: new ManagedMcpAgentToolRegistry(),
    root: path.join(directory, "runtime"),
  })
  await manager.publish({
    authorizationContractDigest: "a".repeat(64),
    enabled: true,
    executable,
    launch: launch(),
    principalRevision: 1,
    serverKey: "fixture",
  })
  const pid = Number(await fs.readFile(pidFile, "utf8"))
  process.kill(pid, 0)
  await manager.disable("fixture")
  expect(() => process.kill(pid, 0)).toThrow()
  await manager.close()
})

test("restarts an installed runtime from the same immutable publication", async () => {
  if (process.platform === "win32") return
  const directory = await root()
  const executable = await fixture(directory)
  const publication = {
    authorizationContractDigest: "a".repeat(64),
    enabled: true,
    executable,
    launch: launch(),
    principalRevision: 1,
    serverKey: "fixture",
  } as const
  const firstTools = new ManagedMcpAgentToolRegistry()
  const first = new ManagedMcpRuntimeManager({ agentTools: firstTools, root: path.join(directory, "runtime-a") })
  await first.publish(publication)
  await first.close()
  const restartedTools = new ManagedMcpAgentToolRegistry()
  const restarted = new ManagedMcpRuntimeManager({
    agentTools: restartedTools,
    root: path.join(directory, "runtime-b"),
  })
  try {
    await restarted.publish(publication)
    await expect(
      restartedTools.callTool({ directory, scopeId: "project" }, "managed_fixture__echo", {}),
    ).resolves.toMatchObject({ content: [{ text: "ok", type: "text" }] })
  } finally {
    await restarted.close()
  }
})
