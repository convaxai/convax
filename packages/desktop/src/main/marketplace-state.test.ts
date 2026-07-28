import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  capabilityTransitionParticipantDigest,
  CapabilityMutationCoordinator,
  FileMarketplaceStateStore,
  MarketplaceStateConflictError,
  projectInstalledCapability,
  type InstallRecord,
  type MarketplaceState,
} from "./marketplace-state"

const roots: string[] = []
const sourceA = "a".repeat(64) as InstallRecord["sourceKey"]
const sourceB = "b".repeat(64) as InstallRecord["sourceKey"]

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "convax-marketplace-state-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function install(overrides: Partial<InstallRecord> = {}): InstallRecord {
  return {
    artifactDigest: "a".repeat(64),
    id: "example",
    kind: "mcp-server",
    revision: 1,
    runtimeSurface: "agent",
    sourceKey: sourceA,
    version: "1.0.0",
    ...overrides,
  }
}

describe("InstalledCapability projection", () => {
  test("keeps a user's disabled preference primary when the grant later becomes invalid", () => {
    const record = install()
    expect(
      projectInstalledCapability({
        executionGrant: {
          authorizationContractDigest: "b".repeat(64),
          identity: { id: record.id, kind: record.kind },
          revision: 1,
          sourceKey: record.sourceKey,
        },
        grantValid: false,
        installRecord: record,
        runtimePreference: {
          desired: "disabled",
          identity: { id: record.id, kind: record.kind },
          revision: 3,
          sourceKey: record.sourceKey,
        },
      }),
    ).toMatchObject({
      attention: "setup-required-before-enable",
      state: "disabled",
    })
  })

  test("maps static capabilities to ready without inventing a runtime preference", () => {
    expect(
      projectInstalledCapability({
        installRecord: install({ kind: "skill", runtimeSurface: "none" }),
      }),
    ).toMatchObject({ state: "ready" })
  })

  test("requires setup for every runtime surface, including anonymous HTTP", () => {
    expect(projectInstalledCapability({ installRecord: install() })).toMatchObject({ state: "setup-required" })
  })
})

describe("FileMarketplaceStateStore", () => {
  test("commits installation, grant, preference and transition records with revision CAS", async () => {
    const root = await temporaryRoot()
    const store = new FileMarketplaceStateStore(join(root, "index-v1.json"))
    const first = await store.read()
    const record = install()
    const next = await store.compareAndSwap(first.revision, (draft) => {
      draft.installations.push(record)
      draft.executionGrants.push({
        authorizationContractDigest: "b".repeat(64),
        identity: { id: record.id, kind: record.kind },
        revision: 1,
        sourceKey: record.sourceKey,
      })
      draft.runtimePreferences.push({
        desired: "enabled",
        identity: { id: record.id, kind: record.kind },
        revision: 1,
        sourceKey: record.sourceKey,
      })
      draft.transitions.push({
        decision: "next",
        id: "transition-1",
        identity: { id: record.id, kind: record.kind },
        mutation: "setup",
        next: record,
        owner: "execution-grant",
        participants: [{
          digest: capabilityTransitionParticipantDigest({
            next: null,
            participant: "execution-grant",
            previous: null,
          }),
          next: null,
          participant: "execution-grant",
          previous: null,
          state: "published",
        }],
        phase: "decide",
        previous: record,
        revision: 1,
      })
    })

    expect(next.revision).toBe(1)
    await expect(store.compareAndSwap(first.revision, () => undefined)).rejects.toBeInstanceOf(
      MarketplaceStateConflictError,
    )
    expect(JSON.parse(await readFile(join(root, "index-v1.json"), "utf8"))).toMatchObject({
      revision: 1,
      schema: "convax.marketplace-state/1",
    })
  })

  test("fails closed on corrupt authority instead of resetting it", async () => {
    const root = await temporaryRoot()
    const file = join(root, "index-v1.json")
    await writeFile(file, "{\"schema\":\"wrong\"}", { mode: 0o600 })
    await expect(new FileMarketplaceStateStore(file).read()).rejects.toThrow("Marketplace state is invalid")
    expect(await readFile(file, "utf8")).toBe("{\"schema\":\"wrong\"}")
  })

  test("rejects cross-source replacement for the same installed identity", async () => {
    const root = await temporaryRoot()
    const store = new FileMarketplaceStateStore(join(root, "index-v1.json"))
    const first = await store.read()
    await store.compareAndSwap(first.revision, (draft) => {
      draft.installations.push(install())
    })
    const current = await store.read()
    await expect(
      store.compareAndSwap(current.revision, (draft) => {
        draft.installations = [install({ sourceKey: sourceB, version: "2.0.0" })]
      }),
    ).rejects.toThrow("Installed capability cannot change Marketplace source")
  })

  test("preserves unknown bytes when schema validation fails", async () => {
    const root = await temporaryRoot()
    const file = join(root, "index-v1.json")
    const invalid = {
      executionGrants: [],
      installations: [],
      provisioningDecisions: [],
      revision: 0,
      runtimePreferences: [],
      schema: "convax.marketplace-state/1",
      transitions: [],
      unexpected: true,
    }
    await writeFile(file, JSON.stringify(invalid), { mode: 0o600 })
    await expect(new FileMarketplaceStateStore(file).read()).rejects.toThrow("Marketplace state is invalid")
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(invalid)
  })

  test("rejects non-canonical SourceKeys and fixed collection overflows", async () => {
    const root = await temporaryRoot()
    const store = new FileMarketplaceStateStore(join(root, "index-v1.json"))
    await expect(
      store.compareAndSwap(0, (draft) => {
        draft.installations.push(install({ sourceKey: "source-a" as never }))
      }),
    ).rejects.toThrow("Marketplace state is invalid")
    await expect(
      store.compareAndSwap(0, (draft) => {
        draft.transitions = Array.from({ length: 4_097 }, (_, index) => ({
          decision: "pending" as const,
          id: `transition-${index}`,
          identity: { id: `item-${index}`, kind: "skill" as const },
          mutation: "install" as const,
          next: install({ id: `item-${index}`, kind: "skill" }),
          owner: "managed-skill" as const,
          participants: [{
            digest: capabilityTransitionParticipantDigest({
              next: install({ id: `item-${index}`, kind: "skill" }),
              participant: "install-record",
              previous: null,
            }),
            next: install({ id: `item-${index}`, kind: "skill" }),
            participant: "install-record" as const,
            previous: null,
            state: "pending" as const,
          }],
          phase: "prepare" as const,
          previous: null,
          revision: 1,
        }))
      }),
    ).rejects.toThrow("Marketplace state is invalid")
    expect((await store.read()).revision).toBe(0)
  })

  test("rejects zero record revisions and duplicate provisioning decisions", async () => {
    const directory = await temporaryRoot()
    const file = join(directory, "state.json")
    const store = new FileMarketplaceStateStore(file)
    await store.compareAndSwap(0, (draft) => {
      draft.installations.push(install())
    })
    const state = JSON.parse(await readFile(file, "utf8"))
    state.installations[0].revision = 0
    await writeFile(file, JSON.stringify(state))
    await expect(store.read()).rejects.toThrow("invalid")

    state.installations[0].revision = 1
    const decision = {
      decision: "removed-by-user",
      identity: { id: "example", kind: "plugin" },
      marketplaceId: "convax-official",
      observedPolicyRevision: 1,
      policyEntryDigest: "b".repeat(64),
      revision: 1,
      sourceKey: sourceA,
    }
    state.provisioningDecisions = [decision, { ...decision, revision: 2 }]
    await writeFile(file, JSON.stringify(state))
    await expect(store.read()).rejects.toThrow("repeats ProvisioningDecision")
  })

  test("rejects transition participant payload or digest tampering", async () => {
    const directory = await temporaryRoot()
    const file = join(directory, "state.json")
    const store = new FileMarketplaceStateStore(file)
    const next = install({ kind: "skill", runtimeSurface: "none" })
    await store.update((draft) => {
      draft.transitions.push({
        decision: "pending",
        id: "tamper-transition",
        identity: { id: next.id, kind: next.kind },
        mutation: "install",
        next,
        owner: "managed-skill",
        participants: [{
          digest: capabilityTransitionParticipantDigest({
            next,
            participant: "install-record",
            previous: null,
          }),
          next,
          participant: "install-record",
          previous: null,
          state: "pending",
        }],
        phase: "prepare",
        previous: null,
        revision: 1,
      })
    })
    const persisted = JSON.parse(await readFile(file, "utf8"))
    persisted.transitions[0].participants[0].next.version = "9.9.9"
    await writeFile(file, JSON.stringify(persisted))
    await expect(store.read()).rejects.toThrow("invalid")

    persisted.transitions[0].participants[0].next.version = next.version
    persisted.transitions[0].participants[0].digest = "f".repeat(64)
    await writeFile(file, JSON.stringify(persisted))
    await expect(store.read()).rejects.toThrow("invalid")
  })

  test("rejects orphaned or cross-source runtime authority after install mutation", async () => {
    const root = await temporaryRoot()
    const store = new FileMarketplaceStateStore(join(root, "index-v1.json"))
    await expect(
      store.compareAndSwap(0, (draft) => {
        draft.executionGrants.push({
          authorizationContractDigest: "c".repeat(64),
          identity: { id: "missing", kind: "mcp-server" },
          revision: 1,
          sourceKey: sourceA,
        })
      }),
    ).rejects.toThrow("does not match")

    await store.compareAndSwap(0, (draft) => {
      draft.installations.push(install())
      draft.runtimePreferences.push({
        desired: "enabled",
        identity: { id: "example", kind: "mcp-server" },
        revision: 1,
        sourceKey: sourceA,
      })
    })
    await expect(
      store.compareAndSwap(1, (draft) => {
        draft.installations = []
      }),
    ).rejects.toThrow("does not match")
  })

  test("rejects an oversized authority before parsing and preserves its bytes", async () => {
    const root = await temporaryRoot()
    const file = join(root, "index-v1.json")
    const bytes = Buffer.alloc(32 * 1024 * 1024 + 1, 0x20)
    await writeFile(file, bytes, { mode: 0o600 })
    await expect(new FileMarketplaceStateStore(file).read()).rejects.toThrow("bounded single-link")
    expect((await readFile(file)).byteLength).toBe(bytes.byteLength)
  })

  test("rejects symlinked and multiply-linked authority files before reading", async () => {
    const root = await temporaryRoot()
    const authority = join(root, "authority.json")
    const linked = join(root, "linked.json")
    const symbolic = join(root, "symbolic.json")
    await writeFile(
      authority,
      JSON.stringify({
        executionGrants: [],
        installations: [],
        provisioningDecisions: [],
        revision: 0,
        runtimePreferences: [],
        schema: "convax.marketplace-state/1",
        transitions: [],
      }),
    )
    await link(authority, linked)
    await expect(new FileMarketplaceStateStore(authority).read()).rejects.toThrow("single-link")
    await rm(linked)
    await symlink(authority, symbolic)
    await expect(new FileMarketplaceStateStore(symbolic).read()).rejects.toThrow("single-link")
  })
})

describe("CapabilityMutationCoordinator", () => {
  test("serializes the same identity and overlapping Skill namespaces", async () => {
    const coordinator = new CapabilityMutationCoordinator()
    const phases: string[] = []
    let entered!: () => void
    const firstEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = coordinator.withMutation(
      {
        affectedSkillNames: ["shared-skill"],
        identity: { id: "plugin-a", kind: "plugin" },
        mutation: "install",
      },
      async () => {
        phases.push("first:start")
        entered()
        await blocked
        phases.push("first:end")
      },
    )
    const second = coordinator.withMutation(
      {
        affectedSkillNames: ["shared-skill"],
        identity: { id: "plugin-b", kind: "plugin" },
        mutation: "install",
      },
      async () => {
        phases.push("second")
      },
    )

    await firstEntered
    expect(phases).toEqual(["first:start"])
    release()
    await Promise.all([first, second])
    expect(phases).toEqual(["first:start", "first:end", "second"])
  })

  test("allows disjoint participant namespaces to run concurrently", async () => {
    const coordinator = new CapabilityMutationCoordinator()
    const entered = new Set<string>()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = (id: string, skill: string) =>
      coordinator.withMutation(
        {
          affectedSkillNames: [skill],
          identity: { id, kind: "plugin" },
          mutation: "update",
        },
        async () => {
          entered.add(id)
          await blocked
        },
      )
    const first = run("a", "a-skill")
    const second = run("b", "b-skill")
    await Promise.resolve()
    await Promise.resolve()
    expect(entered).toEqual(new Set(["a", "b"]))
    release()
    await Promise.all([first, second])
  })
})

test("empty state shape remains explicit and serializable", () => {
  const state: MarketplaceState = {
    executionGrants: [],
    installations: [],
    provisioningDecisions: [],
    revision: 0,
    runtimePreferences: [],
    schema: "convax.marketplace-state/1",
    transitions: [],
  }
  expect(structuredClone(state)).toEqual(state)
})
