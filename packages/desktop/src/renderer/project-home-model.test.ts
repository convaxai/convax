import type { ProjectController, ProjectControllerSnapshot, ProjectRecord } from "@convax/project"
import { describe, expect, mock, test } from "bun:test"
import {
  enterSelectedProjectFromHome,
  recoveryErrorAfterProjectSelection,
  resolveProjectBootstrapView,
  resolveProjectStartup,
} from "./project-home-model"

function project(id: string, input: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    createdAt: 1,
    id,
    lastOpenedAt: 1,
    name: id,
    rootPath: `/projects/${id}`,
    ...input,
  }
}

function snapshot(input: Partial<ProjectControllerSnapshot> = {}): ProjectControllerSnapshot {
  return {
    activeProjectId: null,
    changingActiveProject: false,
    error: null,
    initialized: true,
    projects: [],
    ...input,
    pendingRecoveryProjectId: input.pendingRecoveryProjectId ?? null,
  }
}

describe("Project startup routing", () => {
  test("waits for the Project registry without flashing first-run onboarding", () => {
    expect(resolveProjectStartup(snapshot({ initialized: false }))).toEqual({ kind: "loading" })
  })

  test("shows onboarding only for a successfully loaded empty registry", () => {
    expect(resolveProjectStartup(snapshot())).toEqual({ kind: "onboarding" })
  })

  test("restores the active available Project selected by ProjectController", () => {
    expect(
      resolveProjectStartup(
        snapshot({
          activeProjectId: "selected",
          projects: [project("newest"), project("selected")],
        }),
      ),
    ).toEqual({
      kind: "restore",
      projectId: "selected",
      projectName: "selected",
    })
  })

  test("falls back to the first available Project while skipping missing entries", () => {
    expect(
      resolveProjectStartup(
        snapshot({
          projects: [
            project("missing", { missing: true }),
            project("available", { name: "Available" }),
          ],
        }),
      ),
    ).toEqual({
      kind: "restore",
      projectId: "available",
      projectName: "Available",
    })
  })

  test("keeps registry failures and all-missing Projects out of first-run onboarding", () => {
    expect(
      resolveProjectStartup(snapshot({ error: "Registry could not be read." })),
    ).toEqual({ kind: "recovery", reason: "registry-error" })
    expect(
      resolveProjectStartup(
        snapshot({ projects: [project("missing", { missing: true })] }),
      ),
    ).toEqual({ kind: "recovery", reason: "projects-unavailable" })
  })

  test("keeps an explicit reset candidate out of automatic workspace restore", () => {
    const legacy = project("legacy", {
      recovery: {
        legacyPaths: [".convax/canvases/catalog.json"],
        status: "unsupported-portable-project-version",
      },
    })
    expect(
      resolveProjectStartup(snapshot({
        pendingRecoveryProjectId: legacy.id,
        projects: [legacy],
      })),
    ).toEqual({ kind: "recovery", reason: "projects-unavailable" })
  })

  test("does not turn a runtime Project action error into startup recovery", () => {
    expect(
      resolveProjectStartup(
        snapshot({
          activeProjectId: "selected",
          error: "Rename failed.",
          projects: [project("selected", { name: "Selected" })],
        }),
      ),
    ).toEqual({
      kind: "restore",
      projectId: "selected",
      projectName: "Selected",
    })
  })

  test("keeps a failed first activation recoverable after its binding was registered", () => {
    expect(
      resolveProjectStartup(
        snapshot({
          error: "Project registry is read-only.",
          projects: [project("registered")],
        }),
      ),
    ).toEqual({ kind: "recovery", reason: "registry-error" })
  })

  test("promotes an explicit workspace-entry failure above a restore spinner", () => {
    expect(
      resolveProjectBootstrapView({
        entryFailure: "Canvas reconciliation failed.",
        route: {
          kind: "restore",
          projectId: "selected",
          projectName: "Selected",
        },
      }),
    ).toEqual({
      error: "Canvas reconciliation failed.",
      kind: "recovery",
    })
  })

  test("keeps first-run onboarding exclusive to the empty registry route", () => {
    expect(
      resolveProjectBootstrapView({
        recoveryError: "A stale recovery error",
        route: { kind: "onboarding" },
      }),
    ).toEqual({ kind: "onboarding" })
  })
})

describe("Project onboarding entry", () => {
  test("keeps the prior recovery actionable when the native picker is canceled", () => {
    expect(
      recoveryErrorAfterProjectSelection(
        { status: "canceled" },
        "The previous Project did not finish opening.",
      ),
    ).toBe("The previous Project did not finish opening.")
    expect(
      recoveryErrorAfterProjectSelection(
        { message: "The selected folder is unavailable.", status: "failed" },
        "Previous failure",
      ),
    ).toBe("The selected folder is unavailable.")
    expect(recoveryErrorAfterProjectSelection({ status: "entered" }, "Previous failure")).toBeNull()
  })

  test("preserves native open/create cancellation without reporting an error", async () => {
    const controller = {
      getSnapshot: () => snapshot(),
      openProject: mock(async () => false),
    } as unknown as ProjectController

    expect(
      await enterSelectedProjectFromHome(
        controller,
        () => controller.openProject(),
        async () => true,
      ),
    ).toEqual({ status: "canceled" })
  })

  test("enters the Project selected by the native picker", async () => {
    const onEnterProject = mock(async () => true)
    const controller = {
      getSnapshot: () =>
        snapshot({
          activeProjectId: "selected",
          projects: [project("selected")],
        }),
      openProject: mock(async () => true),
    } as unknown as ProjectController

    expect(
      await enterSelectedProjectFromHome(
        controller,
        () => controller.openProject(),
        onEnterProject,
      ),
    ).toEqual({ status: "entered" })
    expect(onEnterProject).toHaveBeenCalledWith("selected")
  })

  test("keeps onboarding recoverable when workspace restoration fails", async () => {
    const controller = {
      getSnapshot: () =>
        snapshot({
          activeProjectId: "selected",
          projects: [project("selected")],
        }),
    } as unknown as ProjectController

    expect(
      await enterSelectedProjectFromHome(controller, async () => true, async () => false),
    ).toEqual({
      message: "Convax could not restore this Project. Try opening it again.",
      status: "failed",
    })
  })
})
