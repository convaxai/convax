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
    packages: [
      {
        id: "automation-tools",
        kind: "plugin" as const,
        marketplaceId: "convax-official",
        purposes: ["default-install"],
        targets: ["darwin-arm64"],
      },
    ],
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
          purposes: ["default-install"],
          targets: ["darwin-arm64"],
          version: "1.0.0",
        },
      ],
      policyDigest: canonicalProductPolicyDigest(policy),
    },
    schema: "convax.marketplace-product-lock/3",
  }
}

function recoveryLock(): MarketplaceProductLock {
  const lock = validLock()
  const retired = {
    artifact: { sha256: "c".repeat(64), size: 2_048 },
    hostApiMajor: 2,
    snapshotDigest: "d".repeat(64),
    sourceKey: "e".repeat(64),
    version: "1.0.0",
  }
  lock.policy.packages.push({
    id: "legacy-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    purposes: ["retired-recovery"],
    retired: { ...retired, artifact: { ...retired.artifact } },
    targets: [],
    version: "2.0.0",
  })
  lock.resolved.packages.push({
    artifact: artifact("plugin-legacy-tools-2.0.0.zip", "plugin-legacy-tools-v2.0.0"),
    companions: [],
    id: "legacy-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    ownedSkills: [],
    purposes: ["retired-recovery"],
    retired,
    targets: [],
    version: "2.0.0",
  })
  lock.resolved.policyDigest = canonicalProductPolicyDigest(lock.policy)
  return lock
}

function standaloneSkillLock(): MarketplaceProductLock {
  const lock = validLock()
  lock.policy.packages.push({
    id: "writing-workflow",
    kind: "skill",
    marketplaceId: "convax-official",
    purposes: ["default-install"],
    targets: [],
  })
  lock.resolved.packages.push({
    artifact: artifact("skill-writing-workflow-v0.2.0.zip", "skill-writing-workflow-v0.2.0"),
    id: "writing-workflow",
    kind: "skill",
    marketplaceId: "convax-official",
    purposes: ["default-install"],
    targets: [],
    version: "0.2.0",
  })
  lock.resolved.policyDigest = canonicalProductPolicyDigest(lock.policy)
  return lock
}

describe("Marketplace product lock", () => {
  test("accepts the exact v3 Builtin and Official package closure", () => {
    expect(parseMarketplaceProductLock(validLock())).toEqual(validLock())
  })

  test("accepts one bounded recovery artifact only when it closes the exact retired binding", () => {
    expect(parseMarketplaceProductLock(recoveryLock())).toEqual(recoveryLock())

    const changedSnapshot = recoveryLock()
    const changedSnapshotPackage = changedSnapshot.resolved.packages[1]
    if (changedSnapshotPackage.kind !== "plugin" || !("retired" in changedSnapshotPackage)) {
      throw new Error("expected retired Plugin closure")
    }
    changedSnapshotPackage.retired.snapshotDigest = "e".repeat(64)
    expect(() => parseMarketplaceProductLock(changedSnapshot)).toThrow("retired does not match")

    const changedMajor = recoveryLock()
    const changedMajorPackage = changedMajor.resolved.packages[1]
    if (changedMajorPackage.kind !== "plugin" || !("retired" in changedMajorPackage)) {
      throw new Error("expected retired Plugin closure")
    }
    changedMajorPackage.retired.hostApiMajor = 1
    expect(() => parseMarketplaceProductLock(changedMajor)).toThrow("retired does not match")
  })

  test("accepts a portable standalone Skill with no Plugin closure fields", () => {
    expect(parseMarketplaceProductLock(standaloneSkillLock())).toEqual(standaloneSkillLock())
  })

  test("keeps one closure per identity and rejects incomplete retired byte identities", () => {
    const ambiguous = recoveryLock()
    ambiguous.policy.packages.push(structuredClone(ambiguous.policy.packages[1]))
    ambiguous.resolved.packages.push(structuredClone(ambiguous.resolved.packages[1]))
    ambiguous.resolved.policyDigest = canonicalProductPolicyDigest(ambiguous.policy)
    expect(() => parseMarketplaceProductLock(ambiguous)).toThrow("identities must be unique")

    const invalidArchive = recoveryLock()
    const invalidPolicy = invalidArchive.policy.packages[1]
    if (invalidPolicy.kind !== "plugin" || !("retired" in invalidPolicy)) {
      throw new Error("expected retired Plugin policy")
    }
    invalidPolicy.retired.artifact.sha256 = "not-a-digest"
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
    lock.policy.packages[0].targets.push("linux-x64")
    lock.resolved.packages[0].targets.push("linux-x64")
    lock.resolved.policyDigest = canonicalProductPolicyDigest(lock.policy)
    expect(() => parseMarketplaceProductLock(lock)).toThrow("companions must exactly close")
  })

  test("rejects the removed setup field and the obsolete v2 schema", () => {
    const lock = validLock()
    const setup = {
      ...lock,
      policy: {
        ...lock.policy,
        packages: lock.policy.packages.map((entry, index) => (index === 0 ? { ...entry, setup: "automatic" } : entry)),
      },
    }
    expect(() => parseMarketplaceProductLock(setup)).toThrow("unsupported or missing fields")

    const v2 = { ...validLock(), schema: "convax.marketplace-product-lock/2" }
    expect(() => parseMarketplaceProductLock(v2)).toThrow("unsupported Marketplace product lock schema")
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
    const lockedPlugin = lock.resolved.packages[0]
    if (lockedPlugin.kind !== "plugin") throw new Error("expected Plugin closure")
    lockedPlugin.companions = []
    expect(() => parseMarketplaceProductLock(lock)).toThrow("companions must exactly close")
    const duplicateSkill = validLock()
    const duplicateSkillPlugin = duplicateSkill.resolved.packages[0]
    if (duplicateSkillPlugin.kind !== "plugin") throw new Error("expected Plugin closure")
    duplicateSkillPlugin.ownedSkills.push(duplicateSkillPlugin.ownedSkills[0])
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
