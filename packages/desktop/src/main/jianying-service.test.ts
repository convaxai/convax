import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  createJianyingNativeAdapter,
  jianyingDraftLockValidationFailure,
  JianyingIntegrationService,
  MacOSJianyingNativeAdapter,
  UnsupportedJianyingNativeAdapter,
  combineObservations,
  parseJianyingProcessIds,
  runJianyingCommand,
  type JianyingActiveDraft,
  type JianyingCommandRunner,
  type JianyingDraftObservation,
  type JianyingMaterialImportTransport,
  type JianyingNativeAdapter,
  type StagedMediaBatch,
} from "./jianying-service"

const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-jianying-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

const activeDraft = (name = "Current"): JianyingActiveDraft => ({
  draftName: name,
  draftPath: "/drafts/" + name,
  lockPath: "/drafts/" + name + "/.locked",
  pid: 42,
})

const activeObservation = (name = "Current"): JianyingDraftObservation => ({
  draft: activeDraft(name),
  processIds: [42],
  status: "active",
})

function stagedBatch(directory = "/persistent/import"): StagedMediaBatch {
  return {
    directory,
    items: [
      {
        mimeType: "image/png",
        name: "frame.png",
        path: path.join(directory, "frame.png"),
        sha256: "abc",
        size: 3,
      },
    ],
  }
}

function dispatchResult(input: { target: "current" | "new" }) {
  return {
    createdDraft: input.target === "new",
    draft: activeDraft(input.target === "new" ? "Created" : "Current"),
    importStatus: "dispatched" as const,
  }
}

async function createDraftDirectory(root: string, name: string): Promise<JianyingActiveDraft> {
  const draftPath = path.join(root, name)
  await fs.mkdir(draftPath, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(draftPath, ".locked"), ""),
    fs.writeFile(path.join(draftPath, "draft_info.json"), "{}"),
  ])
  return {
    draftName: name,
    draftPath: await fs.realpath(draftPath),
    lockPath: await fs.realpath(path.join(draftPath, ".locked")),
    pid: 42,
  }
}

describe("JianYing active draft detection", () => {
  test("selects only the outer application process", () => {
    expect(
      parseJianyingProcessIds(`
      42 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS
      43 /Applications/VideoFusion-macOS.app/Contents/Frameworks/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS
      44 /Applications/VideoFusion-macOS.app/Contents/Frameworks/VideoFusion-macOS Helper.app/Contents/MacOS/VideoFusion-macOS Helper
    `),
    ).toEqual([42])
  })

  test("requires matching stable draft identities", () => {
    expect(combineObservations(activeObservation(), activeObservation())).toEqual(activeObservation())
    expect(combineObservations(activeObservation("First"), activeObservation("Second"))).toMatchObject({
      status: "ambiguous",
    })
    expect(combineObservations({ processIds: [42], status: "no_active_draft" }, activeObservation())).toMatchObject({
      status: "ambiguous",
    })
  })

  test("marks a terminated command as outcome-unknown instead of a safe retry", async () => {
    if (process.platform === "win32") return
    const result = await runJianyingCommand("/bin/sleep", ["1"], 1)
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain("JIANYING_COMMAND_OUTCOME_UNKNOWN")
  })

  test("explains macOS Movies-folder denial instead of hiding the packaged-app permission failure", () => {
    const error = Object.assign(new Error("operation not permitted"), { code: "EPERM" })

    expect(jianyingDraftLockValidationFailure(4495, error)).toBe(
      "Could not validate a JianYing draft lock held by process 4495: macOS denied Convax access to the Movies folder (EPERM). Allow Convax in System Settings > Privacy & Security > Media & Apple Music, then retry.",
    )
  })

  test("keeps unexpected native validation error codes without exposing the draft path", () => {
    const error = Object.assign(new Error("/private/draft/path"), { code: "EIO" })

    expect(jianyingDraftLockValidationFailure(42, error)).toBe(
      "Could not validate a JianYing draft lock held by process 42 (EIO)",
    )
  })
})

describe("MacOSJianyingNativeAdapter", () => {
  test("retries a draft lock that is recreated during inspection", async () => {
    const root = await temporaryRoot()
    const draftPath = path.join(root, "Current")
    const lockPath = path.join(draftPath, ".locked")
    await fs.mkdir(draftPath)
    await fs.writeFile(path.join(draftPath, "draft_info.json"), "{}")
    const commandRunner: JianyingCommandRunner = async (executable) =>
      executable === "/bin/ps"
        ? {
            exitCode: 0,
            stderr: "",
            stdout: "4495 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS\n",
          }
        : { exitCode: 0, stderr: "", stdout: `p4495\nn${lockPath}\n` }
    let recreated = false
    const adapter = new MacOSJianyingNativeAdapter({
      commandRunner,
      platform: "darwin",
      sleep: async (milliseconds) => {
        if (milliseconds !== 50 || recreated) return
        recreated = true
        await fs.writeFile(lockPath, "")
      },
      transport: {
        createDraft: async () => undefined,
        dispatchMaterialImport: async () => ({ deepLinkDispatched: true }),
      },
    })

    const observation = await adapter.inspect()
    expect(observation).toEqual({
      draft: {
        draftName: "Current",
        draftPath: await fs.realpath(draftPath),
        lockPath: await fs.realpath(lockPath),
        pid: 4495,
      },
      processIds: [4495],
      status: "active",
    })
  })

  test("ignores a vanished stale lock when the process also exposes a valid draft lock", async () => {
    const root = await temporaryRoot()
    const active = await createDraftDirectory(root, "Current")
    const staleLockPath = path.join(root, "Previous", ".locked")
    const commandRunner: JianyingCommandRunner = async (executable) =>
      executable === "/bin/ps"
        ? {
            exitCode: 0,
            stderr: "",
            stdout: "4495 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS\n",
          }
        : { exitCode: 0, stderr: "", stdout: `p4495\nn${staleLockPath}\nn${active.lockPath}\n` }
    const adapter = new MacOSJianyingNativeAdapter({
      commandRunner,
      platform: "darwin",
      sleep: async () => undefined,
      transport: {
        createDraft: async () => undefined,
        dispatchMaterialImport: async () => ({ deepLinkDispatched: true }),
      },
    })

    await expect(adapter.inspect()).resolves.toEqual({
      draft: { ...active, pid: 4495 },
      processIds: [4495],
      status: "active",
    })
  })

  test("keeps a vanished-only draft lock unavailable", async () => {
    const root = await temporaryRoot()
    const missingLockPath = path.join(root, "Current", ".locked")
    const commandRunner: JianyingCommandRunner = async (executable) =>
      executable === "/bin/ps"
        ? {
            exitCode: 0,
            stderr: "",
            stdout: "4495 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS\n",
          }
        : { exitCode: 0, stderr: "", stdout: `p4495\nn${missingLockPath}\n` }
    const adapter = new MacOSJianyingNativeAdapter({
      commandRunner,
      platform: "darwin",
      sleep: async () => undefined,
      transport: {
        createDraft: async () => undefined,
        dispatchMaterialImport: async () => ({ deepLinkDispatched: true }),
      },
    })

    await expect(adapter.inspect()).resolves.toMatchObject({
      reason: expect.stringContaining("changed its active draft lock"),
      status: "unavailable",
    })
  })

  test("propagates cancellation while a vanished draft lock is being retried", async () => {
    const root = await temporaryRoot()
    const missingLockPath = path.join(root, "Current", ".locked")
    const controller = new AbortController()
    const commandRunner: JianyingCommandRunner = async (executable) =>
      executable === "/bin/ps"
        ? {
            exitCode: 0,
            stderr: "",
            stdout: "4495 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS\n",
          }
        : { exitCode: 0, stderr: "", stdout: `p4495\nn${missingLockPath}\n` }
    const adapter = new MacOSJianyingNativeAdapter({
      commandRunner,
      platform: "darwin",
      sleep: async (milliseconds) => {
        if (milliseconds === 50) controller.abort(new DOMException("Canceled", "AbortError"))
      },
      transport: {
        createDraft: async () => undefined,
        dispatchMaterialImport: async () => ({ deepLinkDispatched: true }),
      },
    })

    await expect(adapter.inspect(controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })

  test("does not hide an uncertain process behind another process's valid draft lock", async () => {
    const root = await temporaryRoot()
    const active = await createDraftDirectory(root, "Current")
    const missingLockPath = path.join(root, "Other", ".locked")
    const commandRunner: JianyingCommandRunner = async (executable, args) => {
      if (executable === "/bin/ps") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: [
            "4495 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS",
            "4496 /Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS",
          ].join("\n"),
        }
      }
      const pid = args.at(-1)
      return {
        exitCode: 0,
        stderr: "",
        stdout: pid === "4495" ? `p4495\nn${active.lockPath}\n` : `p4496\nn${missingLockPath}\n`,
      }
    }
    const adapter = new MacOSJianyingNativeAdapter({
      commandRunner,
      platform: "darwin",
      sleep: async () => undefined,
      transport: {
        createDraft: async () => undefined,
        dispatchMaterialImport: async () => ({ deepLinkDispatched: true }),
      },
    })

    await expect(adapter.inspect()).resolves.toMatchObject({
      reason: expect.stringContaining("process 4496 changed its active draft lock"),
      status: "unavailable",
    })
  })

  test("dispatches current-draft media with its MIME type and rechecks the same draft", async () => {
    const dispatchMaterialImport = mock<JianyingMaterialImportTransport["dispatchMaterialImport"]>(async () => ({
      deepLinkDispatched: true,
    }))
    const adapter = new MacOSJianyingNativeAdapter({
      platform: "darwin",
      sleep: async () => undefined,
      transport: {
        createDraft: async () => {
          throw new Error("current-draft import must not create a draft")
        },
        dispatchMaterialImport,
      },
    })
    adapter.inspect = async () => activeObservation()

    await expect(
      adapter.dispatchImport({
        batch: stagedBatch(),
        expected: activeObservation(),
        target: "current",
      }),
    ).resolves.toEqual({
      createdDraft: false,
      draft: activeDraft(),
      importStatus: "dispatched",
    })
    expect(dispatchMaterialImport).toHaveBeenCalledTimes(1)
    expect(dispatchMaterialImport.mock.calls[0]?.[0]).toEqual({
      media: [
        {
          mediaType: "image",
          mimeType: "image/png",
          name: "frame.png",
          path: "/persistent/import/frame.png",
        },
      ],
      target: "current",
    })
  })

  test("force-creates and proves a new draft before dispatching media to it", async () => {
    const root = await temporaryRoot()
    const drafts = path.join(root, "drafts")
    let created: JianyingActiveDraft | undefined
    const events: string[] = []
    const adapter = new MacOSJianyingNativeAdapter({
      platform: "darwin",
      sleep: async () => undefined,
      transport: {
        createDraft: async () => {
          events.push("create")
          created = await createDraftDirectory(drafts, "Created")
        },
        dispatchMaterialImport: async (input) => {
          events.push("import")
          expect(input.target).toBe("current")
          expect(created).toBeDefined()
        },
      },
    })
    adapter.inspect = async () => ({ draft: created!, processIds: [42], status: "active" })

    const result = await adapter.dispatchImport({
      batch: stagedBatch(),
      expected: { processIds: [42], status: "no_active_draft" },
      target: "new",
    })
    if (!created) throw new Error("Expected the transport to create a draft")
    expect(result).toEqual({
      createdDraft: true,
      draft: created,
      importStatus: "dispatched",
    })
    expect(events).toEqual(["create", "import"])
  })

  test("does not mistake a pre-existing draft for a newly created one", async () => {
    const root = await temporaryRoot()
    const drafts = path.join(root, "drafts")
    const preExisting = await createDraftDirectory(drafts, "Old")
    const adapter = new MacOSJianyingNativeAdapter({
      platform: "darwin",
      sleep: async () => undefined,
      transport: {
        createDraft: async () => undefined,
        dispatchMaterialImport: async () => {
          throw new Error("media must not be sent to an unproven draft")
        },
      },
    })
    adapter.inspect = async () => ({ draft: preExisting, processIds: [42], status: "active" })

    await expect(
      adapter.dispatchImport({
        batch: stagedBatch(),
        expected: { processIds: [42], status: "no_active_draft" },
        target: "new",
      }),
    ).rejects.toThrow("not proven to be newly created")
  })

  test("keeps active-to-new export as an explicit WIP without creating a blank draft", async () => {
    const createDraft = mock<JianyingMaterialImportTransport["createDraft"]>(async () => undefined)
    const dispatchMaterialImport = mock<JianyingMaterialImportTransport["dispatchMaterialImport"]>(
      async () => undefined,
    )
    const adapter = new MacOSJianyingNativeAdapter({
      platform: "darwin",
      transport: { createDraft, dispatchMaterialImport },
    })

    await expect(
      adapter.dispatchImport({
        batch: stagedBatch(),
        expected: activeObservation(),
        target: "new",
      }),
    ).rejects.toThrow("still WIP")
    expect(createDraft).not.toHaveBeenCalled()
    expect(dispatchMaterialImport).not.toHaveBeenCalled()
  })

  test("fails closed if current draft identity changes after dispatch", async () => {
    const adapter = new MacOSJianyingNativeAdapter({
      platform: "darwin",
      sleep: async () => undefined,
      transport: {
        createDraft: async () => undefined,
        dispatchMaterialImport: async () => undefined,
      },
    })
    adapter.inspect = async () => activeObservation("Other")

    await expect(
      adapter.dispatchImport({
        batch: stagedBatch(),
        expected: activeObservation(),
        target: "current",
      }),
    ).rejects.toThrow("active JianYing draft changed")
  })

  test("keeps non-macOS support as an explicit WIP without touching transport", async () => {
    const dispatchMaterialImport = mock<JianyingMaterialImportTransport["dispatchMaterialImport"]>(
      async () => undefined,
    )
    const createDraft = mock<JianyingMaterialImportTransport["createDraft"]>(async () => undefined)
    const adapter = createJianyingNativeAdapter({
      platform: "win32",
      transport: { createDraft, dispatchMaterialImport },
    })
    expect(adapter).toBeInstanceOf(UnsupportedJianyingNativeAdapter)
    await expect(adapter.inspect()).resolves.toMatchObject({ status: "unsupported" })
    await expect(
      adapter.dispatchImport({
        batch: stagedBatch(),
        expected: { processIds: [], status: "not_running" },
        target: "new",
      }),
    ).rejects.toThrow("only on macOS")
    expect(dispatchMaterialImport).not.toHaveBeenCalled()
    expect(createDraft).not.toHaveBeenCalled()
  })
})

describe("JianyingIntegrationService", () => {
  test("binds current-draft export to a one-use token and persistent staged media", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "frame.png")
    await fs.writeFile(source, "image-content")
    const canonicalRoot = await fs.realpath(root)
    const dispatched: Array<{ names: string[]; target: string }> = []
    const native: JianyingNativeAdapter = {
      dispatchImport: async (input) => {
        dispatched.push({ names: input.batch.items.map((item) => item.name), target: input.target })
        expect(await fs.readFile(input.batch.items[0]!.path, "utf8")).toBe("image-content")
        expect(input.batch.items[0]!.mimeType).toBe("image/png")
        expect(input.batch.directory.startsWith(path.join(canonicalRoot, "staging"))).toBe(true)
        return dispatchResult(input)
      },
      inspect: async () => activeObservation(),
    }
    const service = new JianyingIntegrationService(native, path.join(root, "staging"))
    const status = await service.getDraftStatus()
    expect(status).toMatchObject({ draftName: "Current", status: "active" })

    await expect(
      service.exportMedia([{ mimeType: "image/png", path: source }], {
        draftToken: status.draftToken!,
        kind: "current",
      }),
    ).resolves.toEqual({
      createdDraft: false,
      draftName: "Current",
      importedMediaCount: 1,
      importStatus: "dispatched",
    })
    expect(dispatched).toHaveLength(1)
    await expect(
      service.exportMedia([{ mimeType: "image/png", path: source }], {
        draftToken: status.draftToken!,
        kind: "current",
      }),
    ).rejects.toThrow("expired")
  })

  test("uses one new-draft dispatch only when toolbar has no active draft", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "clip.mp4")
    await fs.writeFile(source, "video-content")
    const noActive: JianyingDraftObservation = { processIds: [42], status: "no_active_draft" }
    const targets: string[] = []
    const native: JianyingNativeAdapter = {
      dispatchImport: async (input) => {
        targets.push(input.target)
        return dispatchResult(input)
      },
      inspect: async () => noActive,
    }
    const service = new JianyingIntegrationService(native, path.join(root, "staging"))

    await expect(
      service.exportMedia([{ mimeType: "video/mp4", path: source }], { kind: "current-or-new" }),
    ).resolves.toMatchObject({
      createdDraft: true,
      draftName: "Created",
      importStatus: "dispatched",
    })
    expect(targets).toEqual(["new"])
  })

  test("rejects active-to-new before staging or re-inspecting media", async () => {
    const root = await temporaryRoot()
    const staging = path.join(root, "staging")
    const inspect = mock<JianyingNativeAdapter["inspect"]>(async () => activeObservation())
    const dispatchImport = mock<JianyingNativeAdapter["dispatchImport"]>(async (input) => dispatchResult(input))
    const service = new JianyingIntegrationService({ dispatchImport, inspect }, staging)
    const status = await service.getDraftStatus()

    await expect(
      service.exportMedia([{ mimeType: "video/mp4", path: path.join(root, "missing.mp4") }], {
        draftToken: status.draftToken!,
        kind: "new",
      }),
    ).rejects.toThrow("still WIP")
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(dispatchImport).not.toHaveBeenCalled()
    await expect(fs.stat(staging)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("fails closed when observed draft changes while media is staged", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "frame.png")
    await fs.writeFile(source, "image-content")
    const observations = [activeObservation("First"), activeObservation("Second")]
    const dispatchImport = mock<JianyingNativeAdapter["dispatchImport"]>(async (input) => dispatchResult(input))
    const native: JianyingNativeAdapter = {
      dispatchImport,
      inspect: async () => observations.shift() ?? activeObservation("Second"),
    }
    const service = new JianyingIntegrationService(native, path.join(root, "staging"))
    const status = await service.getDraftStatus()

    await expect(
      service.exportMedia([{ mimeType: "image/png", path: source }], {
        draftToken: status.draftToken!,
        kind: "current",
      }),
    ).rejects.toThrow("changed before export")
    expect(dispatchImport).not.toHaveBeenCalled()
  })

  test("cancels a queued export without starting another native dispatch", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "frame.png")
    await fs.writeFile(source, "image-content")
    let releaseDispatch!: () => void
    let markDispatchStarted!: () => void
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve
    })
    const holdDispatch = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    let dispatches = 0
    const native: JianyingNativeAdapter = {
      dispatchImport: async (input) => {
        dispatches += 1
        markDispatchStarted()
        await holdDispatch
        return dispatchResult(input)
      },
      inspect: async () => activeObservation(),
    }
    const service = new JianyingIntegrationService(native, path.join(root, "staging"))
    const first = service.exportMedia([{ mimeType: "image/png", path: source }], { kind: "current-or-new" })
    await dispatchStarted
    const controller = new AbortController()
    const canceled = service.exportMedia(
      [{ mimeType: "image/png", path: source }],
      { kind: "current-or-new" },
      controller.signal,
    )
    controller.abort(new DOMException("Selection changed", "AbortError"))
    releaseDispatch()

    await expect(first).resolves.toMatchObject({ importedMediaCount: 1 })
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" })
    expect(dispatches).toBe(1)
  })

  test("does not turn a post-dispatch cancel into an automatic retry", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "frame.png")
    await fs.writeFile(source, "image-content")
    const controller = new AbortController()
    const native: JianyingNativeAdapter = {
      dispatchImport: async (input) => {
        controller.abort(new DOMException("Selection changed", "AbortError"))
        return dispatchResult(input)
      },
      inspect: async () => activeObservation(),
    }
    const service = new JianyingIntegrationService(native, path.join(root, "staging"))

    await expect(
      service.exportMedia([{ mimeType: "image/png", path: source }], { kind: "current-or-new" }, controller.signal),
    ).resolves.toMatchObject({ importStatus: "dispatched" })
  })

  test("rejects a symlinked persistent staging root", async () => {
    if (process.platform === "win32") return
    const root = await temporaryRoot()
    const source = path.join(root, "frame.png")
    const outside = path.join(root, "outside")
    const staging = path.join(root, "staging")
    await fs.writeFile(source, "image-content")
    await fs.mkdir(outside)
    await fs.symlink(outside, staging)
    const native: JianyingNativeAdapter = {
      dispatchImport: async (input) => dispatchResult(input),
      inspect: async () => activeObservation(),
    }
    const service = new JianyingIntegrationService(native, staging)

    await expect(
      service.exportMedia([{ mimeType: "image/png", path: source }], { kind: "current-or-new" }),
    ).rejects.toThrow("staging root must be a real directory")
  })

  test("fails closed when staging root is replaced after publication", async () => {
    if (process.platform === "win32") return
    const root = await temporaryRoot()
    const source = path.join(root, "frame.png")
    const staging = path.join(root, "staging")
    const movedStaging = path.join(root, "staging-original")
    const outside = path.join(root, "outside")
    await fs.writeFile(source, "image-content")
    await fs.mkdir(outside)
    let inspections = 0
    const dispatchImport = mock<JianyingNativeAdapter["dispatchImport"]>(async (input) => dispatchResult(input))
    const native: JianyingNativeAdapter = {
      dispatchImport,
      inspect: async () => {
        inspections += 1
        if (inspections === 2) {
          await fs.rename(staging, movedStaging)
          await fs.symlink(outside, staging)
        }
        return activeObservation()
      },
    }
    const service = new JianyingIntegrationService(native, staging)

    await expect(
      service.exportMedia([{ mimeType: "image/png", path: source }], { kind: "current-or-new" }),
    ).rejects.toThrow("staging root")
    expect(dispatchImport).not.toHaveBeenCalled()
  })

  test("fails closed when a published batch is replaced before dispatch", async () => {
    if (process.platform === "win32") return
    const root = await temporaryRoot()
    const source = path.join(root, "frame.png")
    const staging = path.join(root, "staging")
    const movedBatch = path.join(root, "batch-original")
    await fs.writeFile(source, "image-content")
    let inspections = 0
    const dispatchImport = mock<JianyingNativeAdapter["dispatchImport"]>(async (input) => dispatchResult(input))
    const native: JianyingNativeAdapter = {
      dispatchImport,
      inspect: async () => {
        inspections += 1
        if (inspections === 2) {
          const entry = (await fs.readdir(staging)).find((name) => name.startsWith("batch-"))
          if (!entry) throw new Error("Expected a published batch")
          const batch = path.join(staging, entry)
          await fs.rename(batch, movedBatch)
          await fs.symlink(movedBatch, batch)
        }
        return activeObservation()
      },
    }
    const service = new JianyingIntegrationService(native, staging)

    await expect(
      service.exportMedia([{ mimeType: "image/png", path: source }], { kind: "current-or-new" }),
    ).rejects.toThrow("import batch")
    expect(dispatchImport).not.toHaveBeenCalled()
  })
})
