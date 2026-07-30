import { describe, expect, mock, test } from "bun:test"
import type {
  ProjectLifecycleClient,
  ProjectRecord,
  ProjectSelectionResult,
} from "./contracts"
import { ProjectController } from "./controller"

const projectOne: ProjectRecord = {
  createdAt: 1,
  id: "one",
  lastOpenedAt: 2,
  name: "One",
  rootPath: "/one",
}
const projectTwo: ProjectRecord = {
  createdAt: 1,
  id: "two",
  lastOpenedAt: 1,
  name: "Two",
  rootPath: "/two",
}
const projects: ProjectRecord[] = [projectOne, projectTwo]

function createClient(overrides: Partial<ProjectLifecycleClient> = {}) {
  const client: ProjectLifecycleClient = {
    createProject: mock(async (): Promise<ProjectSelectionResult> => ({ canceled: true, projects })),
    forgetProject: mock(async () => ({ projects, removed: false })),
    listProjects: mock(async () => ({ projects })),
    openProject: mock(async (): Promise<ProjectSelectionResult> => ({ canceled: true, projects })),
    renameProject: mock(async () => ({ project: projectOne, projects })),
    touchProject: mock(async ({ projectId }) => ({
      project: projects.find((project) => project.id === projectId)!,
      projects,
    })),
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
    const touchProject = mock(async () => ({ project: projectTwo, projects }))
    const controller = new ProjectController(createClient({ touchProject }), { beforeActiveProjectChange })
    await controller.initialize()

    await controller.activate("two")

    expect(beforeActiveProjectChange).toHaveBeenCalledWith("one", "two")
    expect(touchProject).toHaveBeenCalledWith({ projectId: "two" })
    expect(controller.getSnapshot().activeProjectId).toBe("two")
    controller.dispose()
  })

  test("treats a false active-project guard as a clean cancellation", async () => {
    const onActiveProjectChangeCanceled = mock(() => undefined)
    const touchProject = mock(async () => ({ project: projectTwo, projects }))
    const controller = new ProjectController(createClient({ touchProject }), {
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
    expect(touchProject).not.toHaveBeenCalled()
    expect(onActiveProjectChangeCanceled).toHaveBeenCalledTimes(1)
  })

  test("fails closed when the selected project recency cannot be persisted", async () => {
    const onActiveProjectChangeCanceled = mock(() => undefined)
    const touchProject = mock(async () => {
      throw new Error("Project registry is read-only")
    })
    const controller = new ProjectController(createClient({ touchProject }), {
      beforeActiveProjectChange: async () => true,
      onActiveProjectChangeCanceled,
    })
    await controller.initialize()

    await controller.activate("two")

    expect(controller.getSnapshot()).toMatchObject({
      activeProjectId: "one",
      changingActiveProject: false,
      error: "Project registry is read-only",
    })
    expect(onActiveProjectChangeCanceled).toHaveBeenCalledTimes(1)
  })

  test("touches an already active project without running a duplicate leave transition", async () => {
    const refreshedProjectOne = { ...projectOne, lastOpenedAt: 4 }
    const refreshed = [refreshedProjectOne, projectTwo]
    const beforeActiveProjectChange = mock(async () => true)
    const touchProject = mock(async () => ({ project: refreshedProjectOne, projects: refreshed }))
    const controller = new ProjectController(createClient({ touchProject }), { beforeActiveProjectChange })
    await controller.initialize()
    const changingStates: boolean[] = []
    const unsubscribe = controller.subscribe(() => {
      changingStates.push(controller.getSnapshot().changingActiveProject)
    })

    await controller.activate("one")

    expect(touchProject).toHaveBeenCalledWith({ projectId: "one" })
    expect(beforeActiveProjectChange).not.toHaveBeenCalled()
    expect(changingStates).toEqual([false])
    expect(controller.getSnapshot()).toMatchObject({
      activeProjectId: "one",
      error: null,
      projects: refreshed,
    })
    unsubscribe()
  })

  test("does not touch the registry when the native project selection is canceled", async () => {
    const touchProject = mock(async () => ({ project: projectOne, projects }))
    const controller = new ProjectController(createClient({ touchProject }))
    await controller.initialize()

    expect(await controller.openProject()).toBe(false)

    expect(touchProject).not.toHaveBeenCalled()
    expect(controller.getSnapshot().activeProjectId).toBe("one")
  })

  test("activates a newly opened project returned by the lifecycle client", async () => {
    const opened: ProjectRecord = { createdAt: 3, id: "three", lastOpenedAt: 3, name: "Three", rootPath: "/three" }
    const openedProjects = [...projects, opened]
    const openProject = mock(async (): Promise<ProjectSelectionResult> => ({
      canceled: false,
      project: opened,
      projects: openedProjects,
    }))
    const touchProject = mock(async () => ({ project: opened, projects: openedProjects }))
    const controller = new ProjectController(createClient({ openProject, touchProject }))
    await controller.initialize()

    expect(await controller.openProject()).toBe(true)

    expect(controller.getSnapshot().activeProjectId).toBe("three")
    expect(controller.getSnapshot().projects).toContainEqual(opened)
    controller.dispose()
  })

  test("trims, creates, and activates a new project only when selection succeeds", async () => {
    const created: ProjectRecord = { createdAt: 3, id: "three", lastOpenedAt: 3, name: "Storyboard", rootPath: "/three" }
    const createdProjects = [...projects, created]
    const createProject = mock(async (): Promise<ProjectSelectionResult> => ({
      canceled: false,
      project: created,
      projects: createdProjects,
    }))
    const touchProject = mock(async () => ({ project: created, projects: createdProjects }))
    const controller = new ProjectController(createClient({ createProject, touchProject }))
    await controller.initialize()

    expect(await controller.createProject("  Storyboard  ")).toBe(true)
    expect(createProject).toHaveBeenCalledWith({ name: "Storyboard" })
    expect(controller.getSnapshot().activeProjectId).toBe("three")
    controller.dispose()
  })

  test("reports a guarded creation as canceled without touching or changing the active project", async () => {
    const created: ProjectRecord = { createdAt: 3, id: "three", lastOpenedAt: 3, name: "Storyboard", rootPath: "/three" }
    const createProject = mock(async (): Promise<ProjectSelectionResult> => ({
      canceled: false,
      project: created,
      projects: [...projects, created],
    }))
    const touchProject = mock(async () => ({ project: created, projects: [...projects, created] }))
    const controller = new ProjectController(createClient({ createProject, touchProject }), {
      beforeActiveProjectChange: async () => false,
    })
    await controller.initialize()

    expect(await controller.createProject("Storyboard")).toBe(false)

    expect(touchProject).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({
      activeProjectId: "one",
      changingActiveProject: false,
      error: null,
    })
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
    const forgetProject = mock(async () => ({ projects: [projectTwo], removed: true }))
    const beforeActiveProjectChange = mock(async () => undefined)
    const controller = new ProjectController(createClient({ forgetProject }), { beforeActiveProjectChange })
    await controller.initialize()

    await controller.forgetProject("one")

    expect(forgetProject).toHaveBeenCalledWith({ projectId: "one" })
    expect(beforeActiveProjectChange).toHaveBeenCalledWith("one", null)
    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().projects).toEqual([projectTwo])
    controller.dispose()
  })
})
