import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  allocateLocalProjectEpoch,
  derivePortableProjectResetExecutionFingerprint,
  executePortableProjectReset,
  inspectPortableProjectCutover,
  planPortableProjectReset,
  PortableProjectResetError,
  runWithProjectClosedExclusiveMutationLease,
  UnsupportedPortableProjectVersion,
  type PortableProjectResetVerifierV1,
} from "./portable-cutover"

const roots: string[] = []
const epoch = "AQEBAQEBAQEBAQEBAQEBAQ"

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("portable collaboration cutover", () => {
  test("detects legacy JSON without hydrating, changing or deleting it", async () => {
    const projectRoot = await createLegacyProject()
    const before = await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"))
    const inspection = await inspectPortableProjectCutover(projectRoot)
    expect(inspection.status).toBe("unsupported-portable-project-version")
    if (inspection.status !== "unsupported-portable-project-version") throw new Error("expected unsupported")
    expect(inspection.error).toBeInstanceOf(UnsupportedPortableProjectVersion)
    expect(inspection.error.legacyPaths).toEqual([
      ".convax/canvases/canvas-main/document.json",
      ".convax/canvases/catalog.json",
    ])
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"))).toEqual(before)
  })

  test("detects unsupported collaboration bytes even without a legacy Canvas JSON catalog", async () => {
    const projectRoot = await createLegacyProject()
    await fs.rm(path.join(projectRoot, ".convax", "canvases"), { recursive: true })
    await fs.mkdir(path.join(projectRoot, ".convax", "collaboration"))
    await fs.writeFile(path.join(projectRoot, ".convax", "collaboration", "legacy-journal.bin"), "legacy")

    const inspection = await inspectPortableProjectCutover(projectRoot)
    expect(inspection.status).toBe("unsupported-portable-project-version")
    if (inspection.status !== "unsupported-portable-project-version") throw new Error("expected unsupported")
    expect(inspection.error.legacyPaths).toEqual([".convax/collaboration"])
    expect(await fs.readFile(path.join(projectRoot, ".convax", "collaboration", "legacy-journal.bin"), "utf8")).toBe(
      "legacy",
    )
  })

  test("planning and missing confirmation perform zero writes", async () => {
    const projectRoot = await createLegacyProject()
    const catalog = path.join(projectRoot, ".convax", "canvases", "catalog.json")
    const before = await fs.readFile(catalog)
    const rootEntriesBefore = await fs.readdir(projectRoot)
    const plan = await planPortableProjectReset(projectRoot)
    expect(await fs.readFile(catalog)).toEqual(before)
    expect(await fs.readdir(projectRoot)).toEqual(rootEntriesBefore)

    await expect(
      executeWithLease(plan, resetInput({ confirmationToken: "reset-host-unconfirmed" as never })),
    ).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" })
    expect(await fs.readFile(catalog)).toEqual(before)
    expect(await fs.readdir(projectRoot)).toEqual(rootEntriesBefore)
  })

  test("creates an exact deletion preview and token without including ordinary Project files", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    expect(plan.preview.map(({ kind, path: entryPath }) => ({ kind, path: entryPath }))).toEqual([
      { kind: "directory", path: ".convax/assets" },
      { kind: "directory", path: ".convax/assets/blobs" },
      { kind: "file", path: `.convax/assets/blobs/${"a".repeat(64)}` },
      { kind: "directory", path: ".convax/canvases" },
      { kind: "directory", path: ".convax/canvases/canvas-main" },
      { kind: "file", path: ".convax/canvases/canvas-main/document.json" },
      { kind: "file", path: ".convax/canvases/catalog.json" },
    ])
    expect(plan.preview.some((entry) => entry.path.includes("Notes"))).toBe(false)
    expect(plan.preview.some((entry) => entry.path.includes("Generated"))).toBe(false)
    expect(plan.preview.some((entry) => entry.path.includes(".convax-conflicts"))).toBe(false)
    for (const entry of plan.preview.filter((candidate) => candidate.kind === "file")) {
      expect(entry.byteLength).toBeGreaterThan(0)
      expect(entry.contentDigest).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(plan.privateDeletionSetDigest).toMatch(/^[0-9a-f]{64}$/)
    await expect(
      executeWithLease(plan, resetInput({ confirmationToken: "reset-host-wrong" as never })),
    ).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" })
    const tampered = { ...plan, preview: [] }
    await expect(executeWithLease(tampered, resetInput({ confirmationToken: plan.token }))).rejects.toMatchObject({
      code: "INVALID_CONFIRMATION",
    })
  })

  test("cannot execute outside an active closed-Project exclusive lease", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    await expect(
      executePortableProjectReset(plan, {
        ...resetInput({ confirmationToken: plan.token }),
        exclusiveLease: {
          format: "convax.host-project-closed-exclusive-mutation-lease/1",
          projectId: plan.projectId,
          projectRoot,
        },
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" })
  })

  test("rejects a stale plan before touching the old .convax tree", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    await fs.writeFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "changed")
    await expect(executeWithLease(plan, resetInput({ confirmationToken: plan.token }))).rejects.toMatchObject({
      code: "STALE_PLAN",
    })
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("changed")
  })

  test("keeps a verified genesis staged when the team service is unavailable", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    const result = await executeWithLease(
      plan,
      resetInput({ confirmationToken: plan.token, verifier: verifier("team-service-unavailable") }),
    )
    expect(result.status).toBe("staged")
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
    expect(await fs.readFile(path.join(projectRoot, "Notes", "keep.md"), "utf8")).toBe("keep")
  })

  test("allows only a verifier-proven non-team Project to allocate and publish a local epoch", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    const localEpoch = allocateLocalProjectEpoch()
    expect(localEpoch).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const localVerifier = verifier("verified")
    expect(
      await executeWithLease(
        plan,
        resetInput({
          confirmationToken: plan.token,
          authorizationKind: "local-project-owner",
          nextProjectEpoch: localEpoch,
          verifier: localVerifier,
        }),
      ),
    ).toEqual({ projectId: plan.projectId, status: "published" })
    await expect(
      fs.access(path.join(projectRoot, ".convax", "collaboration", "team-epoch-rollover-receipt.bin")),
    ).rejects.toThrow()

    const rejectedRoot = await createLegacyProject()
    const rejectedPlan = await planPortableProjectReset(rejectedRoot)
    await expect(
      executeWithLease(
        rejectedPlan,
        resetInput({
          confirmationToken: rejectedPlan.token,
          authorizationKind: "local-project-owner",
          nextProjectEpoch: allocateLocalProjectEpoch(),
          verifier: verifier("rejected"),
        }),
      ),
    ).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(path.join(rejectedRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
  })

  test("never publishes a rejected staged genesis or epoch receipt", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    await expect(
      executeWithLease(plan, resetInput({ confirmationToken: plan.token, verifier: verifier("rejected") })),
    ).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
  })

  test("binds authorization to the exact supplied evidence", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    const exactEvidence = new Uint8Array([7, 8, 9])
    const exactVerifier = verifier("verified")
    exactVerifier.authorizeStagedReset = async (input) => {
      if (input.authorizationEvidence !== exactEvidence) return "rejected"
      await fs.writeFile(
        path.join(input.stagedConvaxDirectory, "collaboration", "team-epoch-rollover-receipt.bin"),
        exactEvidence,
      )
      return "verified"
    }
    await expect(
      executeWithLease(
        plan,
        resetInput({
          authorizationEvidence: new Uint8Array([7, 8, 9]),
          confirmationToken: plan.token,
          verifier: exactVerifier,
        }),
      ),
    ).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
  })

  test("publishes by same-filesystem swap while preserving stable identity and ordinary files", async () => {
    const projectRoot = await createLegacyProject()
    const manifestBefore = await fs.readFile(path.join(projectRoot, ".convax", "project.json"))
    const plan = await planPortableProjectReset(projectRoot)
    expect(await executeWithLease(plan, resetInput({ confirmationToken: plan.token }))).toEqual({
      projectId: "project_test",
      status: "published",
    })
    expect(await fs.readFile(path.join(projectRoot, ".convax", "project.json"))).toEqual(manifestBefore)
    expect(await fs.readFile(path.join(projectRoot, ".convax", "collaboration", "genesis.bin"), "utf8")).toBe("genesis")
    expect(
      await fs.readFile(path.join(projectRoot, ".convax", "collaboration", "team-epoch-rollover-receipt.bin")),
    ).toEqual(Buffer.from([1, 2, 3]))
    await expect(fs.access(path.join(projectRoot, ".convax", "canvases", "catalog.json"))).rejects.toThrow()
    expect(await fs.readFile(path.join(projectRoot, "Notes", "keep.md"), "utf8")).toBe("keep")
    expect(await fs.readFile(path.join(projectRoot, "Generated", "keep.mp4"), "utf8")).toBe("generated")
    expect(await fs.readFile(path.join(projectRoot, ".convax-conflicts", "keep.md"), "utf8")).toBe("conflict")
    expect((await inspectPortableProjectCutover(projectRoot)).status).toBe("current")
  })

  test("binds receipt verification to the exact reset intent and rejects a staging symlink", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    let verifiedIntent: string | undefined
    const verified = verifier("verified")
    verified.authorizeStagedReset = async (input) => {
      verifiedIntent = input.executionFingerprint
      expect(input.originalTreeDigest).toBe(plan.originalTreeDigest)
      expect(input.stagedConvaxDirectory.startsWith(plan.projectRoot)).toBeTrue()
      await fs.writeFile(
        path.join(input.stagedConvaxDirectory, "collaboration", "team-epoch-rollover-receipt.bin"),
        input.authorizationEvidence as Uint8Array,
      )
      return "verified"
    }
    await executeWithLease(plan, resetInput({ confirmationToken: plan.token, verifier: verified }))
    expect(verifiedIntent).toBe(
      derivePortableProjectResetExecutionFingerprint({
        authorizationKind: "team-epoch-rollover",
        confirmationToken: plan.token,
        nextProjectEpoch: epoch,
        originalTreeDigest: plan.originalTreeDigest,
        privateDeletionSetDigest: plan.privateDeletionSetDigest,
        projectId: plan.projectId,
        unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
      }),
    )

    const secondRoot = await createLegacyProject()
    const secondPlan = await planPortableProjectReset(secondRoot)
    const staged = await executeWithLease(
      secondPlan,
      resetInput({ confirmationToken: secondPlan.token, verifier: verifier("team-service-unavailable") }),
    )
    if (staged.status !== "staged") throw new Error("expected staged reset")
    const attackerDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-cutover-stage-link-"))
    roots.push(attackerDirectory)
    await fs.rm(staged.stagedConvaxDirectory, { recursive: true })
    await fs.mkdir(path.join(attackerDirectory, "collaboration"))
    await fs.copyFile(path.join(secondRoot, ".convax", "project.json"), path.join(attackerDirectory, "project.json"))
    await fs.writeFile(path.join(attackerDirectory, "collaboration", "genesis.bin"), "attacker")
    await fs.symlink(attackerDirectory, staged.stagedConvaxDirectory, "dir")
    await expect(
      executeWithLease(secondPlan, resetInput({ confirmationToken: secondPlan.token })),
    ).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" })
    expect(await fs.readFile(path.join(secondRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
    await expect(
      fs.access(path.join(attackerDirectory, "collaboration", "team-epoch-rollover-receipt.bin")),
    ).rejects.toThrow()
  })

  test("cancellation after staging cannot publish", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    const controller = new AbortController()
    const input = resetInput({ confirmationToken: plan.token, signal: controller.signal })
    input.stageGenesis = async ({ stagedConvaxDirectory }) => {
      await fs.mkdir(path.join(stagedConvaxDirectory, "collaboration"))
      await fs.writeFile(path.join(stagedConvaxDirectory, "collaboration", "genesis.bin"), "genesis")
      controller.abort("cancel")
    }
    expect(await executeWithLease(plan, input)).toMatchObject({ reason: "cancelled", status: "staged" })
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
  })

  test("strictly retries an existing stage after genesis publication crashes", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    let attempts = 0
    const input = resetInput({
      confirmationToken: plan.token,
      stageGenesis: async ({ stagedConvaxDirectory }) => {
        attempts += 1
        const collaboration = path.join(stagedConvaxDirectory, "collaboration")
        await fs.mkdir(collaboration, { recursive: true })
        await fs.writeFile(path.join(collaboration, "genesis.bin"), "genesis")
        await fs.writeFile(path.join(collaboration, "manifest-v2.bin"), "manifest")
        if (attempts === 1) throw new Error("crash-after-genesis")
      },
    })

    await expect(executeWithLease(plan, input)).rejects.toThrow("crash-after-genesis")
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
    expect(await executeWithLease(plan, input)).toEqual({ projectId: plan.projectId, status: "published" })
    expect(attempts).toBe(2)
  })

  test("rejects a symlink injected into the staged tree immediately before publication", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    const outside = path.join(projectRoot, "outside.bin")
    await fs.writeFile(outside, "outside")
    let stagedDirectory = ""
    const input = resetInput({
      confirmationToken: plan.token,
      faultHooks: {
        beforePublish: async () => {
          const genesis = path.join(stagedDirectory, "collaboration", "genesis.bin")
          await fs.rm(genesis)
          await fs.symlink(outside, genesis)
        },
      },
    })
    const originalStageGenesis = input.stageGenesis
    input.stageGenesis = async (stageInput) => {
      stagedDirectory = stageInput.stagedConvaxDirectory
      await originalStageGenesis(stageInput)
    }

    await expect(executeWithLease(plan, input)).rejects.toMatchObject({ code: "VERIFICATION_REJECTED" })
    expect(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8")).toBe("catalog")
    expect(await fs.readFile(outside, "utf8")).toBe("outside")
  })

  test("retains both complete trees when post-publication verification fails", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    const rejectedReopen = verifier("verified")
    rejectedReopen.verifyPublishedGenesis = async () => false

    await expect(
      executeWithLease(plan, resetInput({ confirmationToken: plan.token, verifier: rejectedReopen })),
    ).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" })
    expect((await inspectPortableProjectCutover(projectRoot)).status).toBe("recovery-required")
    expect(await fs.readFile(path.join(projectRoot, "Notes", "keep.md"), "utf8")).toBe("keep")
  })

  test("never follows a replacement retirement-tree symlink while deleting approved private bytes", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    await expect(
      executeWithLease(
        plan,
        resetInput({
          confirmationToken: plan.token,
          faultHooks: {
            afterOriginalRenamed: async () => {
              const backupName = (await fs.readdir(projectRoot)).find((name) => name.startsWith(".convax-reset-backup-"))
              if (!backupName) throw new Error("reset backup was not published")
              const backup = path.join(projectRoot, backupName)
              await fs.rename(backup, `${backup}-preserved`)
              await fs.symlink(path.join(projectRoot, "Notes"), backup, "dir")
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" })
    expect((await inspectPortableProjectCutover(projectRoot)).status).toBe("recovery-required")
    expect(await fs.readFile(path.join(projectRoot, "Notes", "keep.md"), "utf8")).toBe("keep")
  })

  test("a crash after the first rename fails closed as recovery-required", async () => {
    const projectRoot = await createLegacyProject()
    const plan = await planPortableProjectReset(projectRoot)
    await expect(
      executeWithLease(
        plan,
        resetInput({
          confirmationToken: plan.token,
          faultHooks: {
            afterOriginalRenamed: async () => {
              throw new Error("injected crash")
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(PortableProjectResetError)
    expect((await inspectPortableProjectCutover(projectRoot)).status).toBe("recovery-required")
    expect(await fs.readFile(path.join(projectRoot, "Notes", "keep.md"), "utf8")).toBe("keep")
  })
})

async function createLegacyProject() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-cutover-"))
  roots.push(projectRoot)
  await fs.mkdir(path.join(projectRoot, ".convax", "canvases", "canvas-main"), { recursive: true })
  await fs.mkdir(path.join(projectRoot, ".convax", "assets", "blobs"), { recursive: true })
  await fs.mkdir(path.join(projectRoot, "Notes"))
  await fs.mkdir(path.join(projectRoot, "Generated"))
  await fs.mkdir(path.join(projectRoot, ".convax-conflicts"))
  await fs.writeFile(
    path.join(projectRoot, ".convax", "project.json"),
    JSON.stringify({ projectId: "project_test", schemaVersion: "convax.project/1" }),
  )
  await fs.writeFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "catalog")
  await fs.writeFile(path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"), "document")
  await fs.writeFile(path.join(projectRoot, ".convax", "assets", "blobs", "a".repeat(64)), "private")
  await fs.writeFile(path.join(projectRoot, "Notes", "keep.md"), "keep")
  await fs.writeFile(path.join(projectRoot, "Generated", "keep.mp4"), "generated")
  await fs.writeFile(path.join(projectRoot, ".convax-conflicts", "keep.md"), "conflict")
  return projectRoot
}

type ResetInputWithoutLease = Omit<Parameters<typeof executePortableProjectReset>[1], "exclusiveLease">

function resetInput(
  overrides: Partial<ResetInputWithoutLease> & {
    confirmationToken: Parameters<typeof executePortableProjectReset>[1]["confirmationToken"]
  },
): ResetInputWithoutLease {
  return {
    authorizationEvidence: overrides.authorizationEvidence ?? new Uint8Array([1, 2, 3]),
    authorizationKind: overrides.authorizationKind ?? "team-epoch-rollover",
    confirmationToken: overrides.confirmationToken,
    faultHooks: overrides.faultHooks,
    nextProjectEpoch: overrides.nextProjectEpoch ?? epoch,
    signal: overrides.signal,
    stageGenesis:
      overrides.stageGenesis ??
      (async ({ stagedConvaxDirectory }) => {
        await fs.mkdir(path.join(stagedConvaxDirectory, "collaboration"))
        await fs.writeFile(path.join(stagedConvaxDirectory, "collaboration", "genesis.bin"), "genesis")
        await fs.writeFile(path.join(stagedConvaxDirectory, "collaboration", "manifest-v2.bin"), "manifest")
      }),
    verifier: overrides.verifier ?? verifier("verified"),
  }
}

function executeWithLease(plan: Parameters<typeof executePortableProjectReset>[0], input: ResetInputWithoutLease) {
  return runWithProjectClosedExclusiveMutationLease(
    { projectId: plan.projectId, projectRoot: plan.projectRoot },
    (exclusiveLease) => executePortableProjectReset(plan, { ...input, exclusiveLease }),
  )
}

function verifier(
  authority: Awaited<ReturnType<PortableProjectResetVerifierV1["authorizeStagedReset"]>>,
): PortableProjectResetVerifierV1 {
  return {
    authorizeStagedReset: async (input) => {
      if (authority !== "verified") return authority
      const evidence = input.authorizationEvidence
      if (!(evidence instanceof Uint8Array) || evidence.byteLength === 0) return "rejected"
      const name =
        input.authorizationKind === "team-epoch-rollover"
          ? "team-epoch-rollover-receipt.bin"
          : "local-project-owner-confirmation.bin"
      await fs.writeFile(path.join(input.stagedConvaxDirectory, "collaboration", name), evidence)
      return "verified"
    },
    verifyStagedGenesis: async () => true,
    verifyPublishedGenesis: async () => true,
  }
}
