import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { canonicalJson, sha256Hex } from "@convax/marketplace"
import {
  FileMarketplaceSourceStore,
  MarketplaceSourceSecurityError,
  type AcceptedMarketplaceCatalog,
} from "./marketplace-source-store"

const roots: string[] = []
const sourceA = "a".repeat(64) as ConstructorParameters<typeof FileMarketplaceSourceStore>[0]["sourceKey"]
const sourceB = "b".repeat(64) as ConstructorParameters<typeof FileMarketplaceSourceStore>[0]["sourceKey"]

async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "convax-source-store-"))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((entry) => fs.rm(entry, { force: true, recursive: true })))
})

function catalog(overrides: Partial<AcceptedMarketplaceCatalog> = {}): AcceptedMarketplaceCatalog {
  const {
    items = [
      {
        contractDigest: "a".repeat(64),
        id: "example",
        kind: "plugin",
        version: "1.0.0",
      },
    ],
    revision,
    sequence = 1,
    ...rest
  } = overrides
  return {
    ...rest,
    items,
    revision: revision ?? sha256Hex(canonicalJson(items)),
    sequence,
  }
}

describe("FileMarketplaceSourceStore", () => {
  test("atomically accepts a catalog and its SourceSecurityState as one decision", async () => {
    const directory = await root()
    const store = new FileMarketplaceSourceStore({ root: directory, sourceKey: sourceA })
    await store.accept(catalog())
    const current = await store.readAccepted()
    expect(current?.catalog).toEqual(catalog())
    expect(current?.security).toMatchObject({
      acceptedRevision: catalog().revision,
      highestSequence: 1,
      versionContracts: {
        "plugin\u0000example\u00001.0.0": "a".repeat(64),
      },
    })
  })

  test("rejects rollback and same-version changed bytes while retaining last-known-good", async () => {
    const directory = await root()
    const store = new FileMarketplaceSourceStore({ root: directory, sourceKey: sourceA })
    await store.accept(catalog({ sequence: 7 }))
    await expect(store.accept(catalog({ sequence: 6 }))).rejects.toBeInstanceOf(MarketplaceSourceSecurityError)
    await expect(
      store.accept(
        catalog({
          items: [{ contractDigest: "b".repeat(64), id: "example", kind: "plugin", version: "1.0.0" }],
          sequence: 8,
        }),
      ),
    ).rejects.toThrow("same version changed contract")
    expect((await store.readAccepted())?.catalog.sequence).toBe(7)
  })

  test("does not expose a prepared catalog when interrupted before the combined decision", async () => {
    const directory = await root()
    const stable = new FileMarketplaceSourceStore({ root: directory, sourceKey: sourceA })
    await stable.accept(catalog())
    const interrupted = new FileMarketplaceSourceStore({
      beforeDecision: async () => {
        throw new Error("simulated crash")
      },
      root: directory,
      sourceKey: sourceA,
    })
    await expect(interrupted.accept(catalog({ sequence: 2 }))).rejects.toThrow("simulated crash")
    expect((await stable.readAccepted())?.catalog).toEqual(catalog())
  })

  test("isolates different SourceKeys even under one root", async () => {
    const directory = await root()
    const first = new FileMarketplaceSourceStore({ root: directory, sourceKey: sourceA })
    const second = new FileMarketplaceSourceStore({ root: directory, sourceKey: sourceB })
    await first.accept(catalog({ sequence: 9 }))
    await second.accept(catalog())
    expect((await first.readAccepted())?.catalog.sequence).toBe(9)
    expect((await second.readAccepted())?.catalog.sequence).toBe(1)
  })

  test("fails closed instead of pruning version high-water at its fixed limit", async () => {
    const directory = await root()
    const store = new FileMarketplaceSourceStore({
      limits: { maxCanonicalBytes: 8 * 1024 * 1024, maxVersionContracts: 2 },
      root: directory,
      sourceKey: sourceA,
    })
    await store.accept(
      catalog({
        items: [
          { contractDigest: "a".repeat(64), id: "one", kind: "plugin", version: "1" },
          { contractDigest: "b".repeat(64), id: "two", kind: "skill", version: "1" },
        ],
      }),
    )
    await expect(
      store.accept(
        catalog({
          items: [{ contractDigest: "c".repeat(64), id: "three", kind: "mcp-server", version: "1" }],
          sequence: 2,
        }),
      ),
    ).rejects.toThrow("version-contract limit")
    expect(Object.keys((await store.readAccepted())!.security.versionContracts)).toHaveLength(2)
  })

  test("rejects multiply-linked decisions and symlinked snapshots before reading bytes", async () => {
    const directory = await root()
    const store = new FileMarketplaceSourceStore({ root: directory, sourceKey: sourceA })
    const accepted = await store.accept(catalog())
    const securityDirectory = path.join(directory, "marketplace-source-security")
    const [decisionName] = await fs.readdir(securityDirectory)
    const decision = path.join(securityDirectory, decisionName!)
    const extraLink = path.join(directory, "decision-link")
    await fs.link(decision, extraLink)
    await expect(store.readAccepted()).rejects.toThrow("single-link")
    await fs.rm(extraLink)

    const cacheRoot = path.join(directory, "marketplace-cache")
    const [cacheKey] = await fs.readdir(cacheRoot)
    const snapshot = path.join(cacheRoot, cacheKey!, accepted.security.snapshotFile)
    const retained = path.join(directory, "retained-snapshot")
    await fs.rename(snapshot, retained)
    await fs.symlink(retained, snapshot)
    await expect(store.readAccepted()).rejects.toThrow("single-link")
  })

  test("repairs a missing or corrupt non-authoritative snapshot only from the exact accepted catalog", async () => {
    const directory = await root()
    const store = new FileMarketplaceSourceStore({ root: directory, sourceKey: sourceA })
    const accepted = await store.accept(catalog({ sequence: 7 }))
    const cacheRoot = path.join(directory, "marketplace-cache")
    const [cacheKey] = await fs.readdir(cacheRoot)
    const snapshot = path.join(cacheRoot, cacheKey!, accepted.security.snapshotFile)

    await fs.rm(snapshot)
    await expect(store.readAccepted()).rejects.toThrow()
    const repairedMissing = await store.accept(catalog({ sequence: 7 }))
    expect(repairedMissing.security.revision).toBe(1)
    expect((await store.readAccepted())?.catalog).toEqual(catalog({ sequence: 7 }))

    await fs.writeFile(snapshot, "corrupt")
    await expect(store.readAccepted()).rejects.toThrow("missing or corrupt")
    const repairedCorrupt = await store.accept(catalog({ sequence: 7 }))
    expect(repairedCorrupt.security.revision).toBe(1)
    expect((await store.readAccepted())?.catalog).toEqual(catalog({ sequence: 7 }))

    await fs.rm(snapshot)
    await expect(
      store.accept(
        catalog({
          items: [{ contractDigest: "a".repeat(64), id: "different", kind: "plugin", version: "1.0.0" }],
          sequence: 7,
        }),
      ),
    ).rejects.toThrow("changed at an accepted sequence")
    await expect(store.readAccepted()).rejects.toThrow()
  })
})
