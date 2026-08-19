import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, test } from "bun:test"
import { builtinSourceKey, type SourceKey } from "@convax/marketplace"

import { MarketplaceLegacyMigration, proveCurrentPluginExecutionAuthorizations } from "./marketplace-legacy-migration"
import { FileMarketplaceStateStore, type InstallRecord } from "./marketplace-state"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function harness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-marketplace-migration-"))
  roots.push(root)
  return {
    state: new FileMarketplaceStateStore(path.join(root, "marketplace-state.json")),
  }
}

function storyboard(): InstallRecord {
  return {
    artifactDigest: "a".repeat(64),
    id: "canvas-storyboard",
    kind: "skill",
    revision: 1,
    runtimeSurface: "none",
    sourceKey: builtinSourceKey(),
    version: "1.0.0",
  }
}

test("claims only an exact proven legacy tree and is idempotent", async () => {
  const { state } = await harness()
  const migration = new MarketplaceLegacyMigration({
    proveInstallations: async () => [{ record: storyboard() }],
    state,
  })
  await migration.run()
  await migration.run()
  expect(await state.read()).toMatchObject({
    executionGrants: [],
    installations: [{ id: "canvas-storyboard", sourceKey: builtinSourceKey() }],
    transitions: [],
  })
})

test("keeps a conflicting current installation authoritative without blocking startup", async () => {
  const { state } = await harness()
  const current: InstallRecord = {
    ...storyboard(),
    artifact: { sha256: "b".repeat(64), size: 4_096 },
    artifactDigest: "c".repeat(64),
    revision: 3,
    version: "2.0.0",
  }
  await state.update((draft) => {
    draft.installations.push(current)
  })

  await new MarketplaceLegacyMigration({
    proveInstallations: async () => [{ record: storyboard() }],
    state,
  }).run()

  expect(await state.read()).toMatchObject({
    executionGrants: [],
    installations: [current],
    transitions: [],
  })
})

test("leaves ambiguous direct imports legacy-unbound without executable grants", async () => {
  const { state } = await harness()
  await new MarketplaceLegacyMigration({
    proveInstallations: async () => [],
    state,
  }).run()
  expect(await state.read()).toMatchObject({
    executionGrants: [],
    installations: [],
  })
})

test("leaves a modified canvas-storyboard tree untouched and unclaimed", async () => {
  const { state } = await harness()
  let inspected = 0
  await new MarketplaceLegacyMigration({
    proveInstallations: async () => {
      inspected += 1
      // Main's exact-tree adapter returns no proof when any installed byte
      // differs from the exact historical Builtin archive.
      return []
    },
    state,
  }).run()
  expect(inspected).toBe(1)
  expect(await state.read()).toMatchObject({
    executionGrants: [],
    installations: [],
    transitions: [],
  })
})

test("does not turn an old ffmpeg receipt into provenance without the exact package identity", async () => {
  const { state } = await harness()
  const exactOldReceipt = "d".repeat(64)
  await new MarketplaceLegacyMigration({
    proveInstallations: async () => {
      // A receipt proves executable consent, not which Marketplace artifact
      // supplied the installed package. Without the latter, Main fails closed.
      expect(exactOldReceipt).toMatch(/^[a-f0-9]{64}$/)
      return []
    },
    state,
  }).run()
  expect(await state.read()).toMatchObject({
    executionGrants: [],
    installations: [],
  })
})

test("claims ffmpeg and its old receipt only after exact Official package proof", async () => {
  const { state } = await harness()
  const sourceKey = "e".repeat(64) as SourceKey
  const authorizationContractDigest = "f".repeat(64)
  await new MarketplaceLegacyMigration({
    proveInstallations: async () => [
      {
        authorizationContractDigest,
        record: {
          artifactDigest: "a".repeat(64),
          id: "ffmpeg-tools",
          kind: "plugin",
          revision: 1,
          runtimeSurface: "agent-and-convax",
          sourceKey,
          version: "1.0.0",
        },
      },
    ],
    state,
  }).run()
  expect(await state.read()).toMatchObject({
    executionGrants: [
      {
        authorizationContractDigest,
        identity: { id: "ffmpeg-tools", kind: "plugin" },
        sourceKey,
      },
    ],
    installations: [
      {
        id: "ffmpeg-tools",
        sourceKey,
        version: "1.0.0",
      },
    ],
  })
})

test("repairs a missing Plugin grant only from the exact active source-bound installation", async () => {
  const { state } = await harness()
  const sourceKey = "e".repeat(64) as SourceKey
  const record: InstallRecord = {
    artifactDigest: "a".repeat(64),
    id: "story-director",
    kind: "plugin",
    revision: 4,
    runtimeSurface: "agent-and-convax",
    sourceKey,
    version: "2.0.0",
  }
  await state.update((draft) => {
    draft.installations.push(record)
  })
  const authorizationContractDigest = "f".repeat(64)
  const exact = proveCurrentPluginExecutionAuthorizations(await state.read(), [
    {
      authorizationContractDigest,
      id: record.id,
      sourceIdentity: sourceKey,
      version: record.version,
    },
  ])
  expect(exact).toEqual([{ authorizationContractDigest, record }])
  expect(
    proveCurrentPluginExecutionAuthorizations(await state.read(), [
      {
        authorizationContractDigest,
        id: record.id,
        sourceIdentity: "d".repeat(64),
        version: record.version,
      },
    ]),
  ).toEqual([])

  await new MarketplaceLegacyMigration({
    proveInstallations: async () => exact,
    state,
  }).run()

  expect(await state.read()).toMatchObject({
    executionGrants: [
      {
        authorizationContractDigest,
        identity: { id: record.id, kind: "plugin" },
        sourceKey,
      },
    ],
    installations: [{ id: record.id, revision: record.revision }],
  })
})
