import { expect, test } from "bun:test"
import type { SourceKey } from "@convax/marketplace"

import { isMarketplacePluginRuntimeAdmitted } from "./marketplace-plugin-runtime-gate"
import type { MarketplaceState } from "./marketplace-state"

const sourceKey = "a".repeat(64) as SourceKey
const digest = "b".repeat(64)

function state(): MarketplaceState {
  return {
    executionGrants: [],
    installations: [],
    provisioningDecisions: [],
    revision: 1,
    runtimePreferences: [],
    schema: "convax.marketplace-state/1",
    transitions: [],
  }
}

test("denies a legacy-unbound Plugin even when an exact old receipt still exists", () => {
  expect(
    isMarketplacePluginRuntimeAdmitted({
      authorizationContractDigest: digest,
      pluginId: "ffmpeg-tools",
      pluginVersion: "1.0.0",
      state: state(),
    }),
  ).toBe(false)
})

test("admits only a source-bound InstallRecord with the exact current receipt", () => {
  const current = state()
  current.installations.push({
    artifactDigest: "c".repeat(64),
    id: "ffmpeg-tools",
    kind: "plugin",
    revision: 1,
    runtimeSurface: "agent-and-convax",
    sourceKey,
    version: "1.0.0",
  })
  current.executionGrants.push({
    authorizationContractDigest: digest,
    identity: { id: "ffmpeg-tools", kind: "plugin" },
    revision: 1,
    sourceKey,
  })
  expect(
    isMarketplacePluginRuntimeAdmitted({
      authorizationContractDigest: digest,
      pluginId: "ffmpeg-tools",
      pluginVersion: "1.0.0",
      state: current,
    }),
  ).toBe(true)
  expect(
    isMarketplacePluginRuntimeAdmitted({
      authorizationContractDigest: "d".repeat(64),
      pluginId: "ffmpeg-tools",
      pluginVersion: "1.0.0",
      state: current,
    }),
  ).toBe(false)
})

test("denies a stale package version and every in-flight lifecycle transition", () => {
  const current = state()
  const installed = {
    artifactDigest: "c".repeat(64),
    id: "ffmpeg-tools",
    kind: "plugin" as const,
    revision: 1,
    runtimeSurface: "agent-and-convax" as const,
    sourceKey,
    version: "1.0.0",
  }
  current.installations.push(installed)
  current.executionGrants.push({
    authorizationContractDigest: digest,
    identity: { id: installed.id, kind: installed.kind },
    revision: 1,
    sourceKey,
  })

  expect(
    isMarketplacePluginRuntimeAdmitted({
      authorizationContractDigest: digest,
      pluginId: installed.id,
      pluginVersion: "0.9.0",
      state: current,
    }),
  ).toBe(false)

  current.transitions.push({
    decision: "pending",
    id: "disable-1",
    identity: { id: installed.id, kind: installed.kind },
    mutation: "disable",
    next: installed,
    owner: "runtime-preference",
    participants: [],
    phase: "prepare",
    previous: installed,
    revision: 1,
  })
  expect(
    isMarketplacePluginRuntimeAdmitted({
      authorizationContractDigest: digest,
      pluginId: installed.id,
      pluginVersion: installed.version,
      state: current,
    }),
  ).toBe(false)
})
