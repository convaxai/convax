import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const fixturePath = fileURLToPath(new URL("./plugin-installation-crash-e2e.fixture.ts", import.meta.url))
const packageRoot = path.resolve(path.dirname(fixturePath), "../..")
const roots: string[] = []
const children = new Set<ChildProcessWithoutNullStreams>()
const childTimeoutMs = 15_000
const maximumChildOutputBytes = 64 * 1024

interface ChildEnvelope {
  readonly point?: string
  readonly type: "fault-ready" | "result"
  readonly value?: unknown
}

function parseEnvelopes(output: string): ChildEnvelope[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChildEnvelope)
}

async function runChild(
  command: string,
  root: string,
  options: { readonly killAt?: string } = {},
): Promise<unknown> {
  const child = spawn(process.execPath, [fixturePath, command, root], {
    cwd: packageRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  children.add(child)
  child.stdin.end()

  let stdout = ""
  let stderr = ""
  let killedAtBoundary = false
  let settled = false

  return await new Promise<unknown>((resolve, reject) => {
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      children.delete(child)
      operation()
    }
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      finish(() => reject(new Error(`Crash E2E child timed out: ${command}\n${stderr}`)))
    }, childTimeoutMs)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > maximumChildOutputBytes) {
        child.kill("SIGKILL")
        finish(() => reject(new Error(`Crash E2E child stdout exceeded its bound: ${command}`)))
        return
      }
      if (options.killAt && !killedAtBoundary) {
        const envelopes = parseEnvelopes(stdout.endsWith("\n") ? stdout : stdout.slice(0, stdout.lastIndexOf("\n") + 1))
        if (envelopes.some((envelope) => envelope.type === "fault-ready" && envelope.point === options.killAt)) {
          killedAtBoundary = true
          child.kill("SIGKILL")
        }
      }
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
      if (Buffer.byteLength(stderr) > maximumChildOutputBytes) {
        child.kill("SIGKILL")
        finish(() => reject(new Error(`Crash E2E child stderr exceeded its bound: ${command}`)))
      }
    })
    child.on("error", (error) => finish(() => reject(error)))
    child.on("close", (code, signal) => {
      finish(() => {
        if (options.killAt) {
          if (!killedAtBoundary) {
            reject(new Error(`Child exited before crash boundary ${options.killAt}: ${command}\n${stderr}`))
            return
          }
          if (signal !== "SIGKILL" && code !== 137) {
            reject(new Error(`Child was not killed at ${options.killAt}: code=${code} signal=${signal}`))
            return
          }
          resolve(undefined)
          return
        }
        if (code !== 0) {
          reject(new Error(`Crash E2E child failed: ${command} (code=${code}, signal=${signal})\n${stderr}`))
          return
        }
        const result = [...parseEnvelopes(stdout)].reverse().find((envelope) => envelope.type === "result")
        if (!result) {
          reject(new Error(`Crash E2E child returned no result: ${command}`))
          return
        }
        resolve(result.value)
      })
    })
  })
}

async function fixture(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL")
  children.clear()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("Plugin installation cross-process crash recovery", () => {
  test.skipIf(process.platform === "win32")(
    "a killed closure publisher cannot redirect current-by-id resolution and its orphan is reclaimable",
    async () => {
      const root = await fixture("convax-plugin-closure-crash-e2e-")
      const initial = (await runChild("runtime:init", root)) as {
        activeSetDigest: string
        plugins: Array<{ identity: { snapshotDigest: string }; plugin: { version: string } }>
        revision: number
      }
      await runChild("runtime:crash-closure", root, { killAt: "closure.renamed-before-pointer" })

      const recovered = (await runChild("runtime:inspect", root)) as {
        active: {
          activeSetDigest: string
          plugins: Array<{ identity: { snapshotDigest: string }; plugin: { version: string } }>
          revision: number
        }
        asset: string
        closureEntries: string[]
        garbage: { installedSnapshotDigests: string[] }
        resolvedIdentity: { snapshotDigest: string }
      }
      expect(recovered.active).toMatchObject({
        activeSetDigest: initial.activeSetDigest,
        revision: 1,
      })
      expect(recovered.active.plugins[0]?.plugin.version).toBe("1.0.0")
      expect(recovered.asset).toBe("snapshot-a")
      expect(recovered.resolvedIdentity.snapshotDigest).toBe(initial.plugins[0]?.identity.snapshotDigest)
      expect(recovered.closureEntries).toHaveLength(2)
      expect(recovered.garbage.installedSnapshotDigests).toHaveLength(1)

      const collected = (await runChild("runtime:collect", root)) as {
        installedSnapshotDigests: string[]
      }
      expect(collected.installedSnapshotDigests).toEqual(recovered.garbage.installedSnapshotDigests)
      const afterCollection = (await runChild("runtime:inspect", root)) as {
        active: { plugins: Array<{ plugin: { version: string } }> }
        asset: string
        closureEntries: string[]
        garbage: { installedSnapshotDigests: string[] }
      }
      expect(afterCollection.active.plugins[0]?.plugin.version).toBe("1.0.0")
      expect(afterCollection.asset).toBe("snapshot-a")
      expect(afterCollection.closureEntries).toEqual([initial.plugins[0]?.identity.snapshotDigest])
      expect(afterCollection.garbage.installedSnapshotDigests).toEqual([])
    },
  )

  test.skipIf(process.platform === "win32")(
    "a killed ActiveSet publisher exposes the old pointer and the unreachable set is reclaimable",
    async () => {
      const root = await fixture("convax-plugin-active-set-crash-e2e-")
      const initial = (await runChild("state:init", root)) as {
        active: { activeSet: { digest: string }; revision: number }
        alpha: { digest: string }
        bravo: { digest: string }
      }
      await runChild("state:crash-active-set", root, { killAt: "active-set.renamed-before-pointer" })

      const recovered = (await runChild("state:inspect", root)) as {
        active: { activeSet: { descriptor: { plugins: Array<{ pluginId: string }> }; digest: string }; revision: number }
        activeSetEntries: string[]
        garbage: { activeSetDigests: string[]; installedSnapshotDigests: string[] }
      }
      expect(recovered.active).toMatchObject({
        activeSet: {
          digest: initial.active.activeSet.digest,
          descriptor: { plugins: [{ pluginId: "alpha" }] },
        },
        revision: 1,
      })
      expect(recovered.activeSetEntries).toHaveLength(2)
      expect(recovered.garbage.activeSetDigests).toHaveLength(1)
      expect(recovered.garbage.installedSnapshotDigests).toEqual([initial.bravo.digest])

      const collected = (await runChild("state:collect", root)) as {
        activeSetDigests: string[]
        installedSnapshotDigests: string[]
      }
      expect(collected).toEqual(recovered.garbage)
      const afterCollection = (await runChild("state:inspect", root)) as {
        active: { activeSet: { digest: string }; revision: number }
        activeSetEntries: string[]
        installedEntries: string[]
      }
      expect(afterCollection.active).toMatchObject({
        activeSet: { digest: initial.active.activeSet.digest },
        revision: 1,
      })
      expect(afterCollection.activeSetEntries).toEqual([`${initial.active.activeSet.digest}.json`])
      expect(afterCollection.installedEntries).toEqual([`${initial.alpha.digest}.json`])
    },
  )

  test.skipIf(process.platform === "win32")(
    "owner pins are old-or-new across kill boundaries and retain an inactive snapshot until explicit release",
    async () => {
      const root = await fixture("convax-plugin-owner-pin-crash-e2e-")
      const initial = (await runChild("state:init", root)) as {
        active: { activeSet: { digest: string }; revision: number }
        alpha: { digest: string }
      }

      await runChild("state:crash-pin-before", root, { killAt: "owner-pins.temp-synced" })
      const beforeRename = (await runChild("state:inspect", root)) as {
        ownerPins: { pins: unknown[]; revision: number }
      }
      expect(beforeRename.ownerPins).toMatchObject({ pins: [], revision: 0 })

      await runChild("state:crash-pin-after", root, { killAt: "owner-pins.renamed" })
      const afterRename = (await runChild("state:inspect", root)) as {
        ownerPins: {
          pins: Array<{
            activeRevision: number
            activeSetDigest: string
            ownerKey: string
            pluginId: string
            snapshotDigest: string
          }>
          revision: number
          schema: string
        }
      }
      expect(afterRename.ownerPins).toEqual({
        pins: [
          {
            activeRevision: 1,
            activeSetDigest: initial.active.activeSet.digest,
            ownerKey: "generation-operation:crash-e2e",
            pluginId: "alpha",
            snapshotDigest: initial.alpha.digest,
          },
        ],
        revision: 1,
        schema: "convax.plugin-snapshot-owner-pins/1",
      })

      await runChild("state:switch-bravo", root)
      const pinned = (await runChild("state:inspect", root)) as {
        garbage: { activeSetDigests: string[]; installedSnapshotDigests: string[] }
      }
      expect(pinned.garbage.activeSetDigests).not.toContain(initial.active.activeSet.digest)
      expect(pinned.garbage.installedSnapshotDigests).not.toContain(initial.alpha.digest)
      expect(await runChild("state:reject-pinned-collection", root)).toEqual({
        rejected: true,
        retained: "alpha",
      })

      const released = (await runChild("state:unpin-and-collect", root)) as {
        candidates: { activeSetDigests: string[]; installedSnapshotDigests: string[] }
        collected: { activeSetDigests: string[]; installedSnapshotDigests: string[] }
      }
      expect(released.candidates.activeSetDigests).toContain(initial.active.activeSet.digest)
      expect(released.candidates.installedSnapshotDigests).toContain(initial.alpha.digest)
      expect(released.collected).toEqual(released.candidates)
      const afterRelease = (await runChild("state:inspect", root)) as {
        installedEntries: string[]
        ownerPins: { pins: unknown[]; revision: number }
      }
      expect(afterRelease.ownerPins).toMatchObject({ pins: [], revision: 2 })
      expect(afterRelease.installedEntries).not.toContain(`${initial.alpha.digest}.json`)
    },
  )
})
