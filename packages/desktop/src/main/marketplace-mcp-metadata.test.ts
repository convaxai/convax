import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, test } from "bun:test"
import {
  canonicalJson,
  identityKeyForMcpServer,
  sha256Hex,
  versionKeyForMcpServer,
  type SourceKey,
  type SourceQualifiedItem,
} from "@convax/marketplace"

import { MarketplaceMcpMetadataStore, marketplaceMcpServerKey } from "./marketplace-mcp-metadata"

const roots: string[] = []
const sourceKey = "a".repeat(64) as SourceKey

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "convax-mcp-metadata-"))
  roots.push(value)
  return value
}

test("maps long shared-prefix server ids to distinct bounded stable keys", () => {
  const prefix = "io.example/".padEnd(190, "a")
  const first = marketplaceMcpServerKey(`${prefix}x`)
  const second = marketplaceMcpServerKey(`${prefix}y`)
  expect(first).toMatch(/^mcp_[a-f0-9]{64}$/)
  expect(second).toMatch(/^mcp_[a-f0-9]{64}$/)
  expect(first).not.toBe(second)
  expect(first.length).toBeLessThanOrEqual(96)
})

function common(delivery: SourceQualifiedItem["delivery"]): SourceQualifiedItem {
  return {
    catalogRevision: "b".repeat(64),
    catalogSequence: 1,
    compatibility: { convax: "*" },
    delivery,
    id: "io.example/server",
    kind: "mcp-server",
    marketplaceId: "convax-local",
    official: false,
    presentation: { name: "Example" },
    runtimeSurface: "agent",
    sourceKey,
    sourceKind: "local",
    sourceOrder: 0,
    version: "1.0.0",
  }
}

function managed(): SourceQualifiedItem {
  const serverJson = {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    description: "Example",
    name: "io.example/server",
    packages: [],
    version: "1.0.0",
  }
  const extension = {
    schema: "convax.mcp-server-extension/1" as const,
    runtime: {
      argv: [],
      command: "example-mcp",
      compatibility: { targets: [`${process.platform}-${process.arch}`] },
      kind: "managed-stdio" as const,
    },
  }
  return common({
    companions: [],
    extension,
    extensionSha256: sha256Hex(`${canonicalJson(extension)}\n`),
    kind: "mcp-managed-stdio",
    serverJson,
    serverJsonSha256: sha256Hex(`${canonicalJson(serverJson)}\n`),
  })
}

function http(version = "1.0.0", endpoint = "https://mcp.example.com/api"): SourceQualifiedItem {
  const serverJson = {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    description: "Example",
    name: "io.example/server",
    remotes: [{ type: "streamable-http", url: endpoint }],
    version,
  }
  return {
    ...common({
      kind: "mcp-http",
      runtime: { endpoint, transport: "streamable-http" },
      serverJson,
      serverJsonSha256: sha256Hex(`${canonicalJson(serverJson)}\n`),
    }),
    version,
  }
}

function store(rootPath: string) {
  const publications: unknown[] = []
  let refreshes = 0
  const metadata = new MarketplaceMcpMetadataStore({
    companionRoot: path.join(rootPath, "companions"),
    file: path.join(rootPath, "metadata.json"),
    refreshAgentConfiguration: async () => {
      refreshes += 1
    },
    runtimes: {
      disable: async () => undefined,
      publish: async (publication: unknown) => {
        publications.push(publication)
      },
    } as never,
  })
  return { metadata, publications, refreshes: () => refreshes }
}

test("persists HTTP metadata canonically and performs hard refresh only after the owner commit", async () => {
  const directory = await root()
  const first = store(directory)
  await first.metadata.install(http())
  expect(first.refreshes()).toBe(0)
  expect((await first.metadata.read()).records[0]).toMatchObject({
    id: "io.example/server",
    metadata: { mode: "http" },
    version: "1.0.0",
  })
  const record = (await first.metadata.read()).records[0]!
  const grant = await first.metadata.setup(record)
  if (!grant) throw new Error("HTTP setup unexpectedly canceled")
  expect(grant.authorizationContractDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(await first.metadata.verifyAuthorization(record, grant.authorizationContractDigest)).toBe(true)
  expect(first.publications).toEqual([])
  await first.metadata.activate(record, grant.authorizationContractDigest)
  expect(first.publications).toEqual([])
  await first.metadata.hardRefresh()
  expect(first.refreshes()).toBe(1)
  await expect(store(directory).metadata.read()).resolves.toMatchObject({ revision: 1 })
})

test("keeps the current HTTP principal while a durable update candidate is inert", async () => {
  const directory = await root()
  const first = store(directory)
  const current = await first.metadata.install(http())
  const currentGrant = await first.metadata.setup(current)
  if (!currentGrant) throw new Error("Current HTTP setup unexpectedly canceled")

  const candidate = await first.metadata.prepareCandidate(http("2.0.0", "https://mcp.example.com/v2"))
  expect((await first.metadata.read()).records[0]?.version).toBe("1.0.0")
  const candidateGrant = await first.metadata.setup(candidate)
  if (!candidateGrant) throw new Error("Candidate HTTP setup unexpectedly canceled")
  expect(candidateGrant.authorizationContractDigest).not.toBe(currentGrant.authorizationContractDigest)
  expect(first.publications).toEqual([])

  const restarted = store(directory)
  await restarted.metadata.commitCandidate(candidate.id)
  expect((await restarted.metadata.read()).records[0]).toMatchObject({
    metadata: { endpoint: "https://mcp.example.com/v2", mode: "http" },
    version: "2.0.0",
  })
})

test("discarding a failed MCP candidate preserves the exact current record", async () => {
  const directory = await root()
  const first = store(directory)
  const current = await first.metadata.install(http())
  await first.metadata.prepareCandidate(http("2.0.0", "https://mcp.example.com/v2"))
  await expect(first.metadata.prepareCandidate(http("3.0.0", "https://mcp.example.com/v3"))).rejects.toThrow(
    "recovery is required",
  )
  await first.metadata.discardCandidate(current.id)
  expect((await store(directory).metadata.read()).records).toEqual([current])
})

test("keeps Local managed stdio inert until add-target and snapshots the exact selected executable", async () => {
  const directory = await root()
  const first = store(directory)
  const installed = await first.metadata.install(managed())
  expect(installed.metadata).toMatchObject({ executable: null, mode: "managed-stdio" })
  await expect(first.metadata.setup(installed, async () => null)).resolves.toBeNull()
  expect(first.publications).toEqual([])

  const selected = path.join(directory, "example-mcp")
  await fs.writeFile(selected, "#!/bin/sh\nexit 0\n", { mode: 0o700 })
  const grant = await first.metadata.setup(installed, async () => selected)
  expect(grant?.authorizationContractDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(first.publications).toHaveLength(0)
  const record = (await store(directory).metadata.read()).records[0]!
  expect(record.metadata).toMatchObject({
    executable: {
      path: path.join(
        directory,
        "companions",
        identityKeyForMcpServer("io.example/server"),
        versionKeyForMcpServer("io.example/server", "1.0.0"),
        "example-mcp",
      ),
    },
    mode: "managed-stdio",
  })
  await expect(first.metadata.verifyAuthorization(record, grant!.authorizationContractDigest)).resolves.toBe(true)
  await first.metadata.activate(record, grant!.authorizationContractDigest)
  expect(first.publications).toHaveLength(1)
  await fs.appendFile(selected, "# source changed after setup\n")
  await expect(first.metadata.verifyAuthorization(record, grant!.authorizationContractDigest)).resolves.toBe(true)
})

test("rejects a mismatched add-target basename and tampered raw id/version path authority", async () => {
  const directory = await root()
  const first = store(directory)
  const installed = await first.metadata.install(managed())
  const selected = path.join(directory, "wrong-name")
  await fs.writeFile(selected, "#!/bin/sh\n", { mode: 0o700 })
  await expect(first.metadata.setup(installed, async () => selected)).rejects.toThrow("declared command")

  const file = path.join(directory, "metadata.json")
  const state = JSON.parse(await fs.readFile(file, "utf8"))
  state.records[0].version = "../CON"
  state.records[0].metadata.executable = {
    path: path.join(directory, "companions", "io.example/server", "../CON", "example-mcp"),
    sha256: "c".repeat(64),
    size: 1,
  }
  await fs.writeFile(file, JSON.stringify(state))
  await expect(first.metadata.read()).rejects.toThrow("executable binding is invalid")
})
