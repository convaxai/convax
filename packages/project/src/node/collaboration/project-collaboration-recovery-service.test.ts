import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { NodeProjectCollaborationRecoveryService } from "./project-collaboration-recovery-service"

const roots: string[] = []
const projectId = "project-recovery"
const durabilityTest = test.skipIf(process.platform === "win32")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("NodeProjectCollaborationRecoveryService", () => {
  test("projects an unsupported inspection and a cloneable private-deletion preview", async () => {
    const root = await createLegacyProject()
    const service = createService(root)

    expect(await service.inspectProject(projectId)).toEqual({
      unsupportedPaths: [".convax/canvases/catalog.json"],
      status: "unsupported-project-data",
    })
    const preview = await service.previewReset(projectId)
    expect(preview.projectId).toBe(projectId)
    expect(preview.token).toStartWith("reset-host-")
    expect(preview.preview).toEqual([
      { kind: "directory", path: ".convax/canvases" },
      { kind: "file", path: ".convax/canvases/catalog.json" },
    ])
    expect(preview.preview.some((entry) => "byteLength" in entry || "contentDigest" in entry)).toBe(false)
  })

  durabilityTest("re-plans under the Project close gate and publishes only verifier-approved genesis", async () => {
    const root = await createLegacyProject()
    let gateEntered = false
    let authorityPreparedInsideGate = false
    const service = createService(root, {
      gate: {
        async runClosed({ operation }) {
          gateEntered = true
          try {
            return await operation()
          } finally {
            gateEntered = false
          }
        },
      },
      onPrepare: () => {
        authorityPreparedInsideGate = gateEntered
      },
    })
    const preview = await service.previewReset(projectId)

    expect(await service.confirmReset({ projectId, token: preview.token })).toEqual({
      projectId,
      status: "published",
    })
    expect(authorityPreparedInsideGate).toBe(true)
    expect(await fs.readFile(path.join(root, "keep.md"), "utf8")).toBe("keep")
    await expect(fs.access(path.join(root, ".convax", "canvases", "catalog.json"))).rejects.toThrow()
    expect(await fs.readFile(path.join(root, ".convax", "collaboration", "manifest-v2.bin"), "utf8")).toBe("manifest")
  })

  test("rejects a stale confirmation before asking the authority to stage genesis", async () => {
    const root = await createLegacyProject()
    let prepared = false
    const service = createService(root, { onPrepare: () => (prepared = true) })
    const preview = await service.previewReset(projectId)
    await fs.writeFile(path.join(root, ".convax", "canvases", "catalog.json"), "changed")

    await expect(service.confirmReset({ projectId, token: preview.token })).rejects.toMatchObject({
      code: "INVALID_CONFIRMATION",
    })
    expect(prepared).toBe(false)
    expect(await fs.readFile(path.join(root, ".convax", "canvases", "catalog.json"), "utf8")).toBe("changed")
  })

  test("checks reset authority before exposing a destructive preview", async () => {
    const root = await createLegacyProject()
    const service = createService(root, { resetUnavailable: true })

    await expect(service.previewReset(projectId)).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(path.join(root, ".convax", "canvases", "catalog.json"), "utf8")).toBe("legacy")
  })
})

function createService(
  root: string,
  overrides: {
    gate?: ConstructorParameters<typeof NodeProjectCollaborationRecoveryService>[0]["gate"]
    onPrepare?(): void
    resetUnavailable?: boolean
  } = {},
) {
  return new NodeProjectCollaborationRecoveryService({
    projects: {
      resolveProjectRoot: async (requested) => (requested === projectId ? root : Promise.reject(new Error("unknown"))),
    },
    gate:
      overrides.gate ??
      ({
        runClosed: async ({ operation }) => operation(),
      } satisfies ConstructorParameters<typeof NodeProjectCollaborationRecoveryService>[0]["gate"]),
    authority: {
      async inspectReset() {
        return overrides.resetUnavailable
          ? { reason: "team-epoch-rollover-required" as const, status: "unavailable" as const }
          : { status: "eligible" as const }
      },
      async prepareReset() {
        overrides.onPrepare?.()
        return {
          authorizationEvidence: Uint8Array.of(1),
          authorizationKind: "local-project-owner" as const,
          nextProjectEpoch: "AQEBAQEBAQEBAQEBAQEBAQ",
          async stageGenesis({ stagedConvaxDirectory }) {
            const collaboration = path.join(stagedConvaxDirectory, "collaboration")
            await fs.mkdir(collaboration)
            await fs.writeFile(path.join(collaboration, "manifest-v2.bin"), "manifest")
          },
          verifier: {
            authorizeStagedReset: async () => "verified" as const,
            verifyPublishedGenesis: async () => true,
            verifyStagedGenesis: async () => true,
          },
        }
      },
    },
  })
}

async function createLegacyProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-recovery-"))
  roots.push(root)
  await fs.mkdir(path.join(root, ".convax", "canvases"), { recursive: true })
  await fs.writeFile(
    path.join(root, ".convax", "project.json"),
    JSON.stringify({ projectId, schemaVersion: "convax.project/1" }),
  )
  await fs.writeFile(path.join(root, ".convax", "canvases", "catalog.json"), "legacy")
  await fs.writeFile(path.join(root, "keep.md"), "keep")
  return root
}
