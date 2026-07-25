import { describe, expect, mock, test } from "bun:test"
import type {
  ProjectLifecycleClient,
  ProjectRecord,
  ProjectSelectionResult,
} from "./contracts"
import { ProjectController } from "./controller"

const projects: ProjectRecord[] = [
  { createdAt: 1, id: "one", lastOpenedAt: 2, name: "One", rootPath: "/one" },
  { createdAt: 1, id: "two", lastOpenedAt: 1, name: "Two", rootPath: "/two" },
]

function createClient(overrides: Partial<ProjectLifecycleClient> = {}) {
  const client: ProjectLifecycleClient = {
    createProject: mock(async (): Promise<ProjectSelectionResult> => ({ canceled: true, projects })),
    forgetProject: mock(async () => ({ projects, removed: false })),
    listProjects: mock(async () => ({ projects })),
    openProject: mock(async (): Promise<ProjectSelectionResult> => ({ canceled: true, projects })),
    renameProject: mock(async () => ({ project: projects[0]!, projects })),
    ...overrides,
  }
  return client
}

describe("ProjectController", () => {
  test("initializes only project registry and active-project state", async () => {
    const controller = new ProjectController(createClient())

    await controller.initialize()

    expect(controller.getSnapshot()).toEqual({
      activeProjectId: "one",
      changingActiveProject: false,
      error: null,
      initialized: true,
      projects,
    })
    expect(controller.getSnapshot()).not.toHaveProperty("listings")
    expect(controller.getSnapshot()).not.toHaveProperty("selectedPaths")
    controller.dispose()
  })

  test("guards active project changes without owning capability state", async () => {
    const beforeActiveProjectChange = mock(async () => undefined)
    const controller = new ProjectController(createClient(), { beforeActiveProjectChange })
    await controller.initialize()

    await controller.activate("two")

    expect(beforeActiveProjectChange).toHaveBeenCalledWith("one", "two")
    expect(controller.getSnapshot().activeProjectId).toBe("two")
    controller.dispose()
  })

  test("treats a false active-project guard as a clean cancellation", async () => {
    const onActiveProjectChangeCanceled = mock(() => undefined)
    const controller = new ProjectController(createClient(), {
      beforeActiveProjectChange: async () => false,
      onActiveProjectChangeCanceled,
    })
    await controller.initialize()

    await controller.activate("two")

    expect(controller.getSnapshot()).toMatchObject({
      activeProjectId: "one",
      changingActiveProject: false,
      error: null,
    })
    expect(onActiveProjectChangeCanceled).toHaveBeenCalledTimes(1)
  })

  test("activates a newly opened project returned by the lifecycle client", async () => {
    const opened: ProjectRecord = { createdAt: 3, id: "three", lastOpenedAt: 3, name: "Three", rootPath: "/three" }
    const openProject = mock(async (): Promise<ProjectSelectionResult> => ({
      canceled: false,
      project: opened,
      projects: [...projects, opened],
    }))
    const controller = new ProjectController(createClient({ openProject }))
    await controller.initialize()

    await controller.openProject()

    expect(controller.getSnapshot().activeProjectId).toBe("three")
    expect(controller.getSnapshot().projects).toContainEqual(opened)
    controller.dispose()
  })

  test("trims, creates, and activates a new project only when selection succeeds", async () => {
    const created: ProjectRecord = { createdAt: 3, id: "three", lastOpenedAt: 3, name: "Storyboard", rootPath: "/three" }
    const createProject = mock(async (): Promise<ProjectSelectionResult> => ({
      canceled: false,
      project: created,
      projects: [...projects, created],
    }))
    const controller = new ProjectController(createClient({ createProject }))
    await controller.initialize()

    expect(await controller.createProject("  Storyboard  ")).toBe(true)
    expect(createProject).toHaveBeenCalledWith({ name: "Storyboard" })
    expect(controller.getSnapshot().activeProjectId).toBe("three")
    controller.dispose()
  })

  test("reports a failed creation without closing over the current project", async () => {
    const createProject = mock(async (): Promise<ProjectSelectionResult> => {
      throw new Error("Project already exists: Storyboard")
    })
    const controller = new ProjectController(createClient({ createProject }))
    await controller.initialize()

    expect(await controller.createProject("Storyboard")).toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      activeProjectId: "one",
      error: "Project already exists: Storyboard",
      projects,
    })
    controller.dispose()
  })

  test("selects the next available project after forgetting the active one", async () => {
    const forgetProject = mock(async () => ({ projects: [projects[1]!], removed: true }))
    const beforeActiveProjectChange = mock(async () => undefined)
    const controller = new ProjectController(createClient({ forgetProject }), { beforeActiveProjectChange })
    await controller.initialize()

    await controller.forgetProject("one")

    expect(forgetProject).toHaveBeenCalledWith({ projectId: "one" })
    expect(beforeActiveProjectChange).toHaveBeenCalledWith("one", null)
    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().projects).toEqual([projects[1]])
    controller.dispose()
  })
})
