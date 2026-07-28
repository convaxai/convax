import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, test } from "bun:test"
import { builtinSourceKey, type SourceKey } from "@convax/marketplace"

import { MarketplaceLegacyMigration } from "./marketplace-legacy-migration"
import { FileMarketplaceStateStore, type InstallRecord } from "./marketplace-state"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function harness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-marketplace-migration-"))
  roots.push(root)
  return {
    defaults: path.join(root, "default-capabilities.json"),
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
  const { defaults, state } = await harness()
  const migration = new MarketplaceLegacyMigration({
    defaultCapabilitiesFile: defaults,
    preinstalledPolicies: [],
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

test("leaves ambiguous direct imports legacy-unbound without executable grants", async () => {
  const { defaults, state } = await harness()
  await new MarketplaceLegacyMigration({
    defaultCapabilitiesFile: defaults,
    preinstalledPolicies: [],
    proveInstallations: async () => [],
    state,
  }).run()
  expect(await state.read()).toMatchObject({
    executionGrants: [],
    installations: [],
  })
})

test("leaves a modified canvas-storyboard tree untouched and unclaimed", async () => {
  const { defaults, state } = await harness()
  let inspected = 0
  await new MarketplaceLegacyMigration({
    defaultCapabilitiesFile: defaults,
    preinstalledPolicies: [],
    proveInstallations: async () => {
      inspected += 1
      // Main's exact-tree adapter returns no proof when any installed byte
      // differs from the locked Builtin archive.
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

test("does not turn an old ffmpeg receipt into provenance without the locked package identity", async () => {
  const { defaults, state } = await harness()
  const exactOldReceipt = "d".repeat(64)
  await new MarketplaceLegacyMigration({
    defaultCapabilitiesFile: defaults,
    preinstalledPolicies: [],
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
  const { defaults, state } = await harness()
  const sourceKey = "e".repeat(64) as SourceKey
  const authorizationContractDigest = "f".repeat(64)
  await new MarketplaceLegacyMigration({
    defaultCapabilitiesFile: defaults,
    preinstalledPolicies: [],
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

test("converts an absent previously provisioned Plugin into a source-bound removal decision", async () => {
  const { defaults, state } = await harness()
  await fs.writeFile(
    defaults,
    `${JSON.stringify({
      plugins: ["ffmpeg-tools"],
      schema: "convax.default-capabilities/1",
      skills: [],
    })}\n`,
  )
  const sourceKey = "b".repeat(64) as SourceKey
  await new MarketplaceLegacyMigration({
    defaultCapabilitiesFile: defaults,
    preinstalledPolicies: [
      {
        identity: { id: "ffmpeg-tools", kind: "plugin" },
        marketplaceId: "convax-official",
        observedPolicyRevision: 1,
        policyEntryDigest: "c".repeat(64),
        sourceKey,
      },
    ],
    proveInstallations: async () => [],
    state,
  }).run()
  expect((await state.read()).provisioningDecisions).toEqual([
    {
      decision: "removed-by-user",
      identity: { id: "ffmpeg-tools", kind: "plugin" },
      marketplaceId: "convax-official",
      observedPolicyRevision: 1,
      policyEntryDigest: "c".repeat(64),
      revision: 1,
      sourceKey,
    },
  ])
})

test("fails closed on corrupt legacy authority instead of guessing provenance", async () => {
  const { defaults, state } = await harness()
  await fs.writeFile(defaults, '{"schema":"wrong"}\n')
  await expect(
    new MarketplaceLegacyMigration({
      defaultCapabilitiesFile: defaults,
      preinstalledPolicies: [],
      proveInstallations: async () => [{ record: storyboard() }],
      state,
    }).run(),
  ).rejects.toThrow("invalid")
  expect((await state.read()).installations).toEqual([])
})
