import type { ProjectController, ProjectControllerSnapshot, ProjectRecord } from "@convax/project"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectHome } from "./project-home"

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

function controllerFor(
  input: Partial<ProjectControllerSnapshot> = {},
  overrides: Partial<ProjectController> = {},
): ProjectController {
  let current: ProjectControllerSnapshot = {
    activeProjectId: null,
    changingActiveProject: false,
    error: null,
    initialized: true,
    projects: [],
    ...input,
  }
  return {
    activate: mock(async (projectId: string) => {
      current = { ...current, activeProjectId: projectId }
    }),
    clearError: mock(() => {
      current = { ...current, error: null }
    }),
    createProject: mock(async () => false),
    getSnapshot: () => current,
    initialize: mock(async () => undefined),
    openProject: mock(async () => false),
    subscribe: () => () => undefined,
    ...overrides,
  } as unknown as ProjectController
}

describe("ProjectHome", () => {
  test("renders first-run actions without fabricated Project metrics", () => {
    const markup = renderToStaticMarkup(
      <ProjectHome controller={controllerFor()} onEnterProject={async () => true} />,
    )

    expect(markup).toContain('data-project-home="true"')
    expect(markup).toContain("Create a project")
    expect(markup).toContain("Open project")
    expect(markup).not.toContain("canvas count")
    expect(markup).not.toContain("files")
    expect(markup).not.toContain("unreviewed")
  })

  test("renders deterministic recency, a real Continue affordance, and unavailable folders", () => {
    const markup = renderToStaticMarkup(
      <ProjectHome
        controller={controllerFor({
          activeProjectId: "active",
          projects: [
            project("active", { lastOpenedAt: 20, name: "Active study" }),
            project("new", { lastOpenedAt: 90, name: "Newest research" }),
            project("missing", { lastOpenedAt: 50, missing: true, name: "Offline archive" }),
          ],
        })}
        onEnterProject={async () => true}
      />,
    )

    expect(markup).toContain("Continue where you left off")
    expect(markup.indexOf('data-project-id="new"')).toBeLessThan(
      markup.indexOf('data-project-id="missing"'),
    )
    expect(markup.indexOf('data-project-id="missing"')).toBeLessThan(
      markup.indexOf('data-project-id="active"'),
    )
    expect(markup).toContain("Folder unavailable")
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('data-project-list="true"')
    expect(markup).toMatch(/class="[^"]*shadow-\[var\(--ui-shadow-low\)\][^"]*" data-project-list="true"/)
    expect(markup).toMatch(/class="[^"]*shadow-\[var\(--ui-shadow-low\)\][^"]*" data-continue-project="true"/)
    expect(markup).toContain('data-project-row="new"')
    expect(markup).not.toMatch(/class="[^"]*border-border-default[^"]*" data-project-list="true"/)
    expect(markup).not.toMatch(/class="[^"]*border-border-default[^"]*" data-continue-project="true"/)
    expect(markup).not.toContain("grid-cols-3")
    expect(markup).not.toContain("h-32")
  })

  test("keeps restoration failures on Home and offers a retryable error", async () => {
    const window = new Window()
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const reactGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      document: window.document,
      window,
    })
    let root: Root | undefined
    const onEnterProject = mock(async () => false)

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <ProjectHome
            controller={controllerFor({
              projects: [project("research", { name: "Research" })],
            })}
            onEnterProject={onEnterProject}
          />,
        )
      })
      await act(async () =>
        document.querySelector<HTMLButtonElement>('[data-project-id="research"]')?.click(),
      )

      expect(onEnterProject).toHaveBeenCalledWith("research")
      expect(document.querySelector('[data-project-home="true"]')).not.toBeNull()
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not restore")
    } finally {
      if (root) await act(async () => root?.unmount())
      Object.assign(globalThis, {
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
        document: previousDocument,
        window: previousWindow,
      })
    }
  })

  test("reveals real Project management actions without activating the Project", async () => {
    const window = new Window()
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const reactGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      document: window.document,
      window,
    })
    let root: Root | undefined
    const onEnterProject = mock(async () => true)
    const forgetProject = mock(async () => undefined)

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <ProjectHome
            controller={controllerFor(
              { projects: [project("research", { name: "Research" })] },
              { forgetProject },
            )}
            onEnterProject={onEnterProject}
          />,
        )
      })

      const manage = document.querySelector<HTMLButtonElement>(
        '[aria-label="Project actions: Research"]',
      )
      expect(manage?.getAttribute("aria-expanded")).toBe("false")
      await act(async () => manage?.click())

      expect(manage?.getAttribute("aria-expanded")).toBe("true")
      expect(document.querySelector('[data-project-row="research"] [data-slot="disclosure-content"]')?.textContent).toContain(
        "/projects/research",
      )
      expect(onEnterProject).not.toHaveBeenCalled()

      const rename = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Rename",
      )
      await act(async () => rename?.click())
      expect(
        document.querySelector<HTMLInputElement>("#project-home-rename-research")?.value,
      ).toBe("Research")
      await act(async () => manage?.click())
      await act(async () => manage?.click())

      const remove = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Remove from Convax",
      )
      await act(async () => remove?.click())
      expect(document.querySelector('[data-project-row="research"] [data-slot="disclosure-content"]')?.textContent).toContain(
        "The folder and its files stay on disk.",
      )

      const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button.textContent?.trim() === "Remove from Convax" &&
          button.className.includes("bg-destructive"),
      )
      await act(async () => confirm?.click())
      expect(forgetProject).toHaveBeenCalledWith("research")
      expect(onEnterProject).not.toHaveBeenCalled()
    } finally {
      if (root) await act(async () => root?.unmount())
      Object.assign(globalThis, {
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
        document: previousDocument,
        window: previousWindow,
      })
    }
  })
})

afterEach(() => {
  globalThis.document?.body?.replaceChildren()
})
