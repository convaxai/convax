import { describe, expect, test } from "bun:test"
import { link, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  canonicalProductPolicyDigest,
  parseMarketplaceProductLock,
  readMarketplaceProductLock,
  type MarketplaceProductLock,
  type MarketplaceProductPolicy,
} from "./marketplace-product-lock"

function artifact(name: string, tag: string) {
  return {
    name,
    sha256: "a".repeat(64),
    size: 12,
    url: `https://github.com/convaxai/convax-plugins/releases/download/${tag}/${name}`,
  }
}

function validLock(): MarketplaceProductLock {
  const officialRevision = "b".repeat(64)
  const metadataTag = `registry-v2-${officialRevision}`
  const pluginTag = "plugin-automation-tools-v1.0.0"
  const policy: MarketplaceProductPolicy = {
    builtin: {
      marketplaceId: "convax-builtin",
      repository: "convaxai/convax-plugins",
    },
    official: {
      descriptorUrl: "https://convaxai.github.io/convax-plugins/marketplace.json",
      marketplaceId: "convax-official",
      repository: "convaxai/convax-plugins",
    },
    preinstalledPackages: [
      {
        id: "automation-tools",
        kind: "plugin" as const,
        marketplaceId: "convax-official",
        setup: "automatic" as const,
        targets: ["darwin-arm64"],
      },
    ],
    recoveryArtifacts: [],
    revision: 2,
  }
  return {
    policy,
    resolved: {
      builtinBundle: artifact("convax-builtin-v1.zip", "builtin-v1"),
      builtinReservations: [{ id: "canvas-storyboard", kind: "skill" }],
      official: {
        descriptor: artifact("marketplace.json", metadataTag),
        registry: artifact("registry-v2.json", metadataTag),
        revision: officialRevision,
        showcase: artifact("showcase-v2.json", metadataTag),
      },
      packages: [
        {
          artifact: artifact("plugin-automation-tools-v1.zip", pluginTag),
          companions: [
            {
              ...artifact("plugin-automation-tools-v1-darwin-arm64", pluginTag),
              arch: "arm64",
              platform: "darwin",
            },
          ],
          id: "automation-tools",
          kind: "plugin",
          marketplaceId: "convax-official",
          ownedSkills: [artifact("skill-automation-workflow-v1.zip", "skill-automation-workflow-v1.0.0")],
          setup: "explicit",
          version: "1.0.0",
        },
      ],
      policyDigest: canonicalProductPolicyDigest(policy),
      recoveryArtifacts: [],
    },
    schema: "convax.marketplace-product-lock/2",
  }
}

function recoveryLock(): MarketplaceProductLock {
  const lock = validLock()
  const retired = {
    artifact: { sha256: "c".repeat(64), size: 2_048 },
    hostApiMajor: 2,
    snapshotDigest: "d".repeat(64),
    version: "1.0.0",
  }
  lock.policy.recoveryArtifacts.push({
    id: "legacy-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    retired: { ...retired, artifact: { ...retired.artifact } },
    targets: [],
    version: "2.0.0",
  })
  lock.resolved.recoveryArtifacts.push({
    artifact: artifact("plugin-legacy-tools-2.0.0.zip", "plugin-legacy-tools-v2.0.0"),
    companions: [],
    id: "legacy-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    ownedSkills: [],
    retired,
    setup: "explicit",
    version: "2.0.0",
  })
  lock.resolved.policyDigest = canonicalProductPolicyDigest(lock.policy)
  return lock
}

describe("Marketplace product lock", () => {
  test("accepts the exact v2 Builtin and Official policy closure", () => {
    expect(parseMarketplaceProductLock(validLock())).toEqual(validLock())
  })

  test("accepts one bounded recovery artifact only when it closes the exact retired binding", () => {
    expect(parseMarketplaceProductLock(recoveryLock())).toEqual(recoveryLock())

    const changedSnapshot = recoveryLock()
    changedSnapshot.resolved.recoveryArtifacts[0]!.retired.snapshotDigest = "e".repeat(64)
    expect(() => parseMarketplaceProductLock(changedSnapshot)).toThrow("retired does not match")

    const changedMajor = recoveryLock()
    changedMajor.resolved.recoveryArtifacts[0]!.retired.hostApiMajor = 1
    expect(() => parseMarketplaceProductLock(changedMajor)).toThrow("retired does not match")
  })

  test("keeps recovery artifacts disjoint from automatic preinstall and rejects incomplete byte identities", () => {
    const preinstallAlias = recoveryLock()
    preinstallAlias.policy.recoveryArtifacts[0]!.id = "automation-tools"
    preinstallAlias.resolved.policyDigest = canonicalProductPolicyDigest(preinstallAlias.policy)
    expect(() => parseMarketplaceProductLock(preinstallAlias)).toThrow("disjoint")

    const ambiguous = recoveryLock()
    ambiguous.policy.recoveryArtifacts.push(structuredClone(ambiguous.policy.recoveryArtifacts[0]!))
    ambiguous.resolved.recoveryArtifacts.push(structuredClone(ambiguous.resolved.recoveryArtifacts[0]!))
    ambiguous.resolved.policyDigest = canonicalProductPolicyDigest(ambiguous.policy)
    expect(() => parseMarketplaceProductLock(ambiguous)).toThrow("identities must be unique")

    const invalidArchive = recoveryLock()
    invalidArchive.policy.recoveryArtifacts[0]!.retired.artifact.sha256 = "not-a-digest"
    invalidArchive.resolved.policyDigest = canonicalProductPolicyDigest(invalidArchive.policy)
    expect(() => parseMarketplaceProductLock(invalidArchive)).toThrow("exact retired Plugin")
  })

  test("rejects a policy edit until resolved is explicitly refreshed", () => {
    const lock = validLock()
    lock.policy.revision += 1
    expect(() => parseMarketplaceProductLock(lock)).toThrow("policyDigest")
  })

  test("rejects a declared target without an exact resolved companion", () => {
    const lock = validLock()
    lock.policy.preinstalledPackages[0]!.targets.push("linux-x64" as never)
    lock.resolved.policyDigest = canonicalProductPolicyDigest(lock.policy)
    expect(() => parseMarketplaceProductLock(lock)).toThrow("policy targets")
  })

  test("rejects weakening the product-locked automatic setup policy back to an interactive grant", () => {
    const lock = validLock()
    lock.policy.preinstalledPackages[0]!.setup = "explicit" as never
    lock.resolved.policyDigest = canonicalProductPolicyDigest(lock.policy)
    expect(() => parseMarketplaceProductLock(lock)).toThrow("preinstalledPackages")
  })

  test("rejects mutable URLs and malformed immutable byte identities", () => {
    const lock = validLock()
    lock.resolved.official.registry.url = "https://convaxai.github.io/convax-plugins/latest.json"
    lock.resolved.official.registry.sha256 = "not-a-digest"
    expect(() => parseMarketplaceProductLock(lock)).toThrow("immutable")
    const nonDefaultPort = validLock()
    nonDefaultPort.resolved.official.registry.url = nonDefaultPort.resolved.official.registry.url.replace(
      "github.com/",
      "github.com:8443/",
    )
    expect(() => parseMarketplaceProductLock(nonDefaultPort)).toThrow("immutable")
  })

  test("rejects a missing target companion or duplicate owned closure", () => {
    const lock = validLock()
    lock.resolved.packages[0]!.companions = []
    expect(() => parseMarketplaceProductLock(lock)).toThrow("policy targets")
    const duplicateSkill = validLock()
    duplicateSkill.resolved.packages[0]!.ownedSkills.push(duplicateSkill.resolved.packages[0]!.ownedSkills[0]!)
    expect(() => parseMarketplaceProductLock(duplicateSkill)).toThrow("ownedSkills must be unique")
  })

  test("reads the tracked authority through a bounded single-link no-follow handle", async () => {
    const root = await mkdtemp(join(tmpdir(), "convax-marketplace-lock-"))
    try {
      const stableRoot = await realpath(root)
      const lockPath = join(stableRoot, "marketplaces.lock.json")
      const secondPath = join(stableRoot, "second-name.json")
      await writeFile(lockPath, `${JSON.stringify(validLock())}\n`)
      await expect(readMarketplaceProductLock(lockPath)).resolves.toEqual(validLock())
      await link(lockPath, secondPath)
      await expect(readMarketplaceProductLock(lockPath)).rejects.toThrow("single-link")
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
