import type { ProjectController, ProjectControllerSnapshot, ProjectRecord } from "@convax/project"
import { describe, expect, mock, test } from "bun:test"
import {
  buildProjectHomeModel,
  enterProjectFromHome,
  enterSelectedProjectFromHome,
} from "./project-home-model"

function project(
  id: string,
  lastOpenedAt: number,
  input: Partial<ProjectRecord> = {},
): ProjectRecord {
  return {
    createdAt: 1,
    id,
    lastOpenedAt,
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
  }
}

describe("Project Home model", () => {
  test("orders valid recency newest-first and exposes the active available Project as Continue", () => {
    const model = buildProjectHomeModel(
      snapshot({
        activeProjectId: "older",
        projects: [project("older", 20), project("newest", 80), project("middle", 50)],
      }),
    )

    expect(model.projects.map((item) => item.id)).toEqual(["newest", "middle", "older"])
    expect(model.continueProject?.id).toBe("older")
    expect(model.empty).toBeFalse()
  })

  test("uses stable id ordering for equal and invalid timestamps", () => {
    const model = buildProjectHomeModel(
      snapshot({
        projects: [
          project("invalid-z", Number.NaN),
          project("equal-b", 50),
          project("invalid-a", Number.POSITIVE_INFINITY),
          project("invalid-date", Number.MAX_VALUE),
          project("equal-a", 50),
        ],
      }),
    )

    expect(model.projects.map((item) => item.id)).toEqual([
      "equal-a",
      "equal-b",
      "invalid-a",
      "invalid-date",
      "invalid-z",
    ])
  })

  test("does not offer Continue for a missing active Project", () => {
    const model = buildProjectHomeModel(
      snapshot({
        activeProjectId: "missing",
        projects: [project("missing", 100, { missing: true })],
      }),
    )

    expect(model.continueProject).toBeNull()
    expect(model.projects[0]?.available).toBeFalse()
  })
})

describe("Project Home entry", () => {
  test("activates through ProjectController before asking the coordinator to restore the Project", async () => {
    let activeProjectId: string | null = "first"
    const activate = mock(async (projectId: string) => {
      activeProjectId = projectId
    })
    const controller = {
      activate,
      getSnapshot: () =>
        snapshot({
          activeProjectId,
          projects: [project("first", 1), project("second", 2)],
        }),
    } as unknown as ProjectController
    const onEnterProject = mock(async () => true)

    expect(await enterProjectFromHome(controller, "second", onEnterProject)).toEqual({ status: "entered" })
    expect(activate).toHaveBeenCalledWith("second")
    expect(onEnterProject).toHaveBeenCalledWith("second")
  })

  test("keeps Home recoverable when activation or Canvas restoration fails", async () => {
    const activationFailure = {
      activate: mock(async () => undefined),
      getSnapshot: () =>
        snapshot({
          activeProjectId: "first",
          error: "The Project could not be activated.",
          projects: [project("first", 1), project("second", 2)],
        }),
    } as unknown as ProjectController
    const shouldNotEnter = mock(async () => true)

    expect(await enterProjectFromHome(activationFailure, "second", shouldNotEnter)).toEqual({
      message: "The Project could not be activated.",
      status: "failed",
    })
    expect(shouldNotEnter).not.toHaveBeenCalled()

    const restorationFailure = {
      activate: mock(async () => undefined),
      getSnapshot: () =>
        snapshot({
          activeProjectId: "second",
          projects: [project("second", 2)],
        }),
    } as unknown as ProjectController

    expect(
      await enterProjectFromHome(restorationFailure, "second", async () => false),
    ).toEqual({
      message: "Convax could not restore this Project. Try opening it again.",
      status: "failed",
    })
  })

  test("never activates a missing Project", async () => {
    const activate = mock(async () => undefined)
    const controller = {
      activate,
      getSnapshot: () =>
        snapshot({
          projects: [project("missing", 2, { missing: true })],
        }),
    } as unknown as ProjectController
    const onEnterProject = mock(async () => true)

    expect(await enterProjectFromHome(controller, "missing", onEnterProject)).toEqual({
      message: "Project folder is unavailable: /projects/missing",
      status: "failed",
    })
    expect(activate).not.toHaveBeenCalled()
    expect(onEnterProject).not.toHaveBeenCalled()
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

  test("re-enters an already-active Project selected from the native picker", async () => {
    const onEnterProject = mock(async () => true)
    const controller = {
      getSnapshot: () =>
        snapshot({
          activeProjectId: "first",
          projects: [project("first", 1), project("second", 2)],
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
    expect(onEnterProject).toHaveBeenCalledWith("first")
  })
})
