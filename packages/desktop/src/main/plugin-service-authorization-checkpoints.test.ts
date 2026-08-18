import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  PluginServiceAuthorizationCheckpointStore,
  pluginServiceAuthorizationCheckpointSchema,
  type PluginServiceAuthorizationCheckpoint,
  type PluginServiceAuthorizationCheckpointBinding,
} from "./plugin-service-authorization-checkpoints"

const roots: string[] = []
const fixedNow = Date.UTC(2026, 6, 20, 0, 0, 0)
const serviceIdentity = "a".repeat(64)
const snapshotDigest = "f".repeat(64)

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-service-checkpoint-test-"))
  roots.push(root)
  return root
}

async function failureOf(operation: Promise<unknown>) {
  const outcome = await operation.then(
    () => null,
    (error: unknown) => error,
  )
  expect(outcome).toBeInstanceOf(Error)
  if (!(outcome instanceof Error)) throw new Error("Expected operation to fail")
  return outcome
}

function binding(
  overrides: Partial<PluginServiceAuthorizationCheckpointBinding> = {},
): PluginServiceAuthorizationCheckpointBinding {
  const pluginId = overrides.pluginId ?? "account-tools"
  return {
    cookieNames: ["session_id", "session_id_secure"],
    cookieOrigin: "https://accounts.example.com",
    pluginId,
    serviceId: overrides.serviceId ?? pluginId,
    serviceIdentity,
    snapshotDigest,
    ...overrides,
  }
}

function checkpoint(
  overrides: Partial<PluginServiceAuthorizationCheckpoint> = {},
): PluginServiceAuthorizationCheckpoint {
  const checkpointBinding = binding(overrides)
  return {
    action: "authorize",
    capturedAt: fixedNow,
    ...checkpointBinding,
    cookies: [
      { name: "session_id_secure", value: "secure-cookie-value" },
      { name: "session_id", value: "session-cookie-value" },
    ],
    schema: pluginServiceAuthorizationCheckpointSchema,
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("Plugin service authorization checkpoint store", () => {
  test("atomically stores only a bounded allowlisted Cookie snapshot in private state", async () => {
    const outer = await temporaryRoot()
    const root = path.join(outer, "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })

    const stored = await store.write(checkpoint())
    const restored = await store.read(binding())
    const summary = await store.inspect({
      pluginId: "account-tools",
      serviceId: "account-tools",
      serviceIdentity,
      snapshotDigest,
    })

    expect(restored).toEqual(stored)
    expect(summary).toEqual({
      action: "authorize",
      capturedAt: fixedNow,
      pluginId: "account-tools",
      serviceId: "account-tools",
      serviceIdentity,
      snapshotDigest,
    })
    expect(JSON.stringify(summary)).not.toContain("cookie-value")
    expect(restored?.cookieNames).toEqual(["session_id", "session_id_secure"])
    expect(restored?.cookies.map(({ name }) => name)).toEqual(["session_id", "session_id_secure"])
    const [rootInfo, fileInfo] = await Promise.all([
      fs.lstat(root),
      fs.lstat(path.join(root, "account-tools--account-tools.json")),
    ])
    if (process.platform !== "win32") {
      expect(rootInfo.mode & 0o777).toBe(0o700)
      expect(fileInfo.mode & 0o777).toBe(0o600)
    }
    expect((await fs.readdir(root)).filter((name) => name.startsWith(".checkpoint-"))).toEqual([])
  })

  test("rejects noncanonical origins, mutable identities, unknown names, duplicate names, and unsafe values", async () => {
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })
    const secret = "must-never-appear-in-an-error"
    const invalid: unknown[] = [
      checkpoint({ cookieOrigin: "https://accounts.example.com/" }),
      checkpoint({ serviceIdentity: "not-an-immutable-sha256" }),
      checkpoint({ snapshotDigest: "not-an-immutable-sha256" }),
      checkpoint({ cookies: [{ name: "not_allowlisted", value: secret }] }),
      checkpoint({
        cookies: [
          { name: "session_id", value: "one" },
          { name: "session_id", value: "two" },
        ],
      }),
      checkpoint({ cookies: [{ name: "session_id", value: `unsafe;${secret}` }] }),
      checkpoint({ cookies: [{ name: "session_id", value: "x".repeat(16 * 1024 + 1) }] }),
      { ...checkpoint(), loginUrl: "https://accounts.example.com/sign-in" },
    ]

    for (const value of invalid) {
      const error = await failureOf(store.write(value))
      expect(String(error)).not.toContain(secret)
    }
    expect(await fs.readdir(root).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" })
  })

  test("never releases a checkpoint to a changed identity, origin, or allowlist", async () => {
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })
    await store.write(checkpoint())

    for (const changed of [
      binding({ serviceIdentity: "b".repeat(64) }),
      binding({ snapshotDigest: "e".repeat(64) }),
      binding({ cookieOrigin: "https://other.example.com" }),
      binding({ cookieNames: ["session_id"] }),
    ]) {
      expect((await failureOf(store.read(changed))).message).toContain("invalid or inaccessible")
    }
    expect(
      (
        await failureOf(
          store.inspect({
            pluginId: "account-tools",
            serviceId: "account-tools",
            serviceIdentity: "b".repeat(64),
            snapshotDigest,
          }),
        )
      ).message,
    ).toContain("invalid or inaccessible")
    expect(await store.read(binding())).not.toBeNull()
  })

  test("drops expired Cookies and removes a checkpoint when none remain", async () => {
    let now = fixedNow
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => now })
    await store.write(
      checkpoint({
        cookies: [
          { expiresAt: fixedNow + 1_000, name: "session_id", value: "short-lived" },
          { expiresAt: fixedNow + 10_000, name: "session_id_secure", value: "longer-lived" },
        ],
      }),
    )

    now = fixedNow + 2_000
    expect((await store.read(binding()))?.cookies).toEqual([
      { expiresAt: fixedNow + 10_000, name: "session_id_secure", value: "longer-lived" },
    ])
    now = fixedNow + 20_000
    expect(await store.read(binding())).toBeNull()
    expect(
      await fs.lstat(path.join(root, "account-tools--account-tools.json")).catch((error: unknown) => error),
    ).toMatchObject({ code: "ENOENT" })
  })

  test("bounds crash recovery even for browser-session Cookies without an expiry", async () => {
    let now = fixedNow
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => now })
    await store.write(checkpoint({ cookies: [{ name: "session_id", value: "session-cookie" }] }))

    now = fixedNow + 15 * 60_000 - 1
    expect(await store.read(binding())).not.toBeNull()
    now += 1
    expect(await store.read(binding())).toBeNull()
    await expect(fs.lstat(path.join(root, "account-tools--account-tools.json"))).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  test("fails closed on permissive files and symlinks without following or overwriting them", async () => {
    const outer = await temporaryRoot()
    const root = path.join(outer, "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })
    await store.write(checkpoint())
    const target = path.join(root, "account-tools--account-tools.json")
    if (process.platform !== "win32") {
      await fs.chmod(target, 0o644)
      expect((await failureOf(store.read(binding()))).message).toContain("invalid or inaccessible")
      await fs.chmod(target, 0o600)
    }

    await fs.rm(target)
    const unrelated = path.join(outer, "unrelated.json")
    await fs.writeFile(unrelated, "unrelated-content", { mode: 0o600 })
    await fs.symlink(unrelated, target)
    expect((await failureOf(store.read(binding()))).message).toContain("invalid or inaccessible")
    expect((await failureOf(store.write(checkpoint()))).message).toContain("invalid or inaccessible")

    await store.remove("account-tools")
    expect(await fs.readFile(unrelated, "utf8")).toBe("unrelated-content")
    expect(await fs.lstat(target).catch((error: unknown) => error)).toMatchObject({ code: "ENOENT" })
  })

  test("reconciles uninstalled, changed, corrupt, and stray checkpoint state", async () => {
    const outer = await temporaryRoot()
    const root = path.join(outer, "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })
    await store.write(checkpoint())
    await store.write(
      checkpoint({
        ...binding({ pluginId: "changed-tools", serviceIdentity: "b".repeat(64) }),
        cookies: [{ name: "session_id", value: "changed-cookie" }],
      }),
    )
    await store.write(
      checkpoint({
        ...binding({ pluginId: "removed-tools", serviceIdentity: "c".repeat(64) }),
        cookies: [{ name: "session_id", value: "removed-cookie" }],
      }),
    )
    await fs.writeFile(path.join(root, "corrupt-tools.json"), "not-json", { mode: 0o600 })
    await fs.writeFile(path.join(root, ".checkpoint-orphan.tmp"), "orphan", { mode: 0o600 })

    const retained = await store.reconcile([
      { pluginId: "account-tools", serviceId: "account-tools", serviceIdentity, snapshotDigest },
      {
        pluginId: "changed-tools",
        serviceId: "changed-tools",
        serviceIdentity: "d".repeat(64),
        snapshotDigest,
      },
      {
        pluginId: "corrupt-tools",
        serviceId: "corrupt-tools",
        serviceIdentity: "e".repeat(64),
        snapshotDigest,
      },
    ])

    expect(await fs.readdir(root)).toEqual(["account-tools--account-tools.json"])
    expect(retained).toEqual([
      {
        action: "authorize",
        capturedAt: fixedNow,
        pluginId: "account-tools",
        serviceId: "account-tools",
        serviceIdentity,
        snapshotDigest,
      },
    ])
    expect(await store.read(binding())).not.toBeNull()
  })

  test("startup sweep removes uninstalled and expired state without starting a sidecar", async () => {
    let now = fixedNow
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => now })
    await store.write(checkpoint())
    await store.write(
      checkpoint({
        ...binding({ pluginId: "removed-tools", serviceIdentity: "b".repeat(64) }),
        cookies: [{ name: "session_id", value: "removed-cookie" }],
      }),
    )

    expect((await store.sweep(["account-tools"])).map(({ pluginId }) => pluginId)).toEqual(["account-tools"])
    expect(await fs.readdir(root)).toEqual(["account-tools--account-tools.json"])

    now = fixedNow + 15 * 60_000
    expect(await store.sweep(["account-tools"])).toEqual([])
    expect(await fs.readdir(root)).toEqual([])
  })

  test("retains an installed service with temporarily unknown identity without widening reads", async () => {
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })
    await store.write(checkpoint())

    expect((await store.reconcile([], ["account-tools"])).map(({ pluginId }) => pluginId)).toEqual(["account-tools"])
    expect(await store.read(binding())).not.toBeNull()
    await expect(store.read(binding({ serviceIdentity: "b".repeat(64) }))).rejects.toThrow("invalid or inaccessible")
    expect(await store.read(binding())).not.toBeNull()
  })

  test("isolates checkpoints for sibling services contributed by one Plugin", async () => {
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })
    const image = checkpoint({
      serviceId: "image-generation",
      cookies: [{ name: "session_id", value: "image-cookie" }],
    })
    const video = checkpoint({
      serviceId: "video-generation",
      cookies: [{ name: "session_id", value: "video-cookie" }],
    })

    await store.write(image)
    await store.write(video)
    expect(await store.read(binding({ serviceId: "image-generation" }))).toEqual(image)
    expect(await store.read(binding({ serviceId: "video-generation" }))).toEqual(video)

    await store.remove({ pluginId: "account-tools", serviceId: "image-generation" })
    expect(await store.read(binding({ serviceId: "image-generation" }))).toBeNull()
    expect(await store.read(binding({ serviceId: "video-generation" }))).toEqual(video)
    expect(await fs.readdir(root)).toEqual(["account-tools--video-generation.json"])
  })

  test("reads and cleans a legacy v2 checkpoint only for the v8-compatible service target", async () => {
    const root = path.join(await temporaryRoot(), "checkpoints")
    await fs.mkdir(root, { mode: 0o700 })
    const { serviceId: _serviceId, ...legacy } = checkpoint()
    await fs.writeFile(
      path.join(root, "account-tools.json"),
      `${JSON.stringify({ ...legacy, schema: "convax.plugin-service-authorization-checkpoint/2" })}\n`,
      { mode: 0o600 },
    )
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })

    expect(await store.read(binding())).toMatchObject({
      pluginId: "account-tools",
      schema: pluginServiceAuthorizationCheckpointSchema,
      serviceId: "account-tools",
    })
    expect(await store.read(binding({ serviceId: "image-generation" }))).toBeNull()

    await store.remove({ pluginId: "account-tools", serviceId: "account-tools" })
    await expect(fs.lstat(path.join(root, "account-tools.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("serializes capture and explicit removal so sign-out cannot be undone by an earlier write", async () => {
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })

    const writing = store.write(checkpoint())
    const removing = store.remove("account-tools")
    await Promise.all([writing, removing])

    expect(await store.read(binding())).toBeNull()
  })

  test("serializes maintenance with another Plugin checkpoint publication", async () => {
    const root = path.join(await temporaryRoot(), "checkpoints")
    const store = new PluginServiceAuthorizationCheckpointStore(root, { now: () => fixedNow })
    const originalRename = fs.rename.bind(fs)
    let releasePublish!: () => void
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    let observePublish!: () => void
    const publishObserved = new Promise<void>((resolve) => {
      observePublish = resolve
    })
    const rename = spyOn(fs, "rename").mockImplementation(async (source, target) => {
      if (String(source).includes(".checkpoint-other-tools--other-tools-")) {
        observePublish()
        await publishGate
      }
      return originalRename(source, target)
    })
    try {
      const other = checkpoint({
        ...binding({ pluginId: "other-tools", serviceIdentity: "b".repeat(64) }),
        cookies: [{ name: "session_id", value: "other-cookie" }],
      })
      const writing = store.write(other)
      await publishObserved
      const sweeping = store.sweep(["other-tools"])
      releasePublish()
      await Promise.all([writing, sweeping])

      expect(await store.read(binding({ pluginId: "other-tools", serviceIdentity: "b".repeat(64) }))).toEqual(other)
      expect((await fs.readdir(root)).filter((name) => name.startsWith(".checkpoint-"))).toEqual([])
    } finally {
      releasePublish()
      rename.mockRestore()
    }
  })

  test("rejects a symlinked private root", async () => {
    const outer = await temporaryRoot()
    const real = path.join(outer, "real")
    const linked = path.join(outer, "linked")
    await fs.mkdir(real, { mode: 0o700 })
    await fs.symlink(real, linked)
    const store = new PluginServiceAuthorizationCheckpointStore(linked, { now: () => fixedNow })

    expect((await failureOf(store.write(checkpoint()))).message).toContain("invalid or inaccessible")
    expect(await fs.readdir(real)).toEqual([])
  })
})
