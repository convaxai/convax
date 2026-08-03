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

function controllerHarness(
  input: Partial<ProjectControllerSnapshot> = {},
  overrides: Partial<ProjectController> = {},
) {
  let current: ProjectControllerSnapshot = {
    activeProjectId: null,
    changingActiveProject: false,
    error: null,
    initialized: true,
    projects: [],
    ...input,
    pendingRecoveryProjectId: input.pendingRecoveryProjectId ?? null,
  }
  const controller = {
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

  return {
    controller,
    setSnapshot(next: Partial<ProjectControllerSnapshot>) {
      current = { ...current, ...next }
    },
  }
}

async function withDom(run: (root: Root) => Promise<void>) {
  const window = new Window()
  const globals = {
    Element: window.Element,
    Event: window.Event,
    HTMLInputElement: window.HTMLInputElement,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    InputEvent: window.InputEvent,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    document: window.document,
    window,
  }
  const originalGlobalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)

  try {
    await run(root)
  } finally {
    await act(async () => root.unmount())
    await window.happyDOM.close()
    for (const [name, descriptor] of originalGlobalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

describe("ProjectHome", () => {
  test("renders only first-run onboarding even when Project records are supplied", () => {
    const { controller } = controllerHarness({
      activeProjectId: "existing",
      projects: [
        project("existing", {
          name: "Private roadmap",
          rootPath: "/private/work/private-roadmap",
        }),
      ],
    })
    const markup = renderToStaticMarkup(
      <ProjectHome controller={controller} onEnterProject={async () => true} />,
    )

    expect(markup).toContain('data-project-home="true"')
    expect(markup).toContain('data-project-home-motion="reveal"')
    expect(markup).toContain("Start with a blank canvas")
    expect(markup).toContain("Create project")
    expect(markup).toContain("Open project")
    expect(markup.match(/data-project-action=/g)).toHaveLength(2)
    expect(markup).not.toContain("Continue")
    expect(markup).not.toContain("Recent work")
    expect(markup).not.toContain("Private roadmap")
    expect(markup).not.toContain("/private/work/private-roadmap")
    expect(markup).not.toContain("data-project-list")
    expect(markup).not.toContain("data-project-row")
    expect(markup).not.toContain("data-continue-project")
  })

  test("exposes an explicit reduced-motion state without changing the onboarding content", () => {
    const { controller } = controllerHarness()
    const markup = renderToStaticMarkup(
      <ProjectHome
        controller={controller}
        locale="zh-CN"
        onEnterProject={async () => true}
        reducedMotion
      />,
    )

    expect(markup).toContain('data-project-home-motion="reduce"')
    expect(markup).toContain("从一张空白画布开始")
    expect(markup).toContain("创建项目")
    expect(markup).toContain("打开项目")
  })

  test("creates and enters a Project without initializing or listing the registry", async () => {
    await withDom(async (root) => {
      const harness = controllerHarness()
      const callOrder: string[] = []
      const createProject = mock(async (name: string) => {
        callOrder.push("create")
        harness.setSnapshot({
          activeProjectId: "created",
          projects: [project("created", { name })],
        })
        return true
      })
      const controller = Object.assign(harness.controller, { createProject })
      const onEnterProject = mock(async () => true)
      const onSelectionStart = mock(() => callOrder.push("selection"))

      await act(async () => {
        root.render(
          <ProjectHome
            controller={controller}
            onEnterProject={onEnterProject}
            onSelectionStart={onSelectionStart}
          />,
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-project-action="create"]')?.click()
      })

      const input = document.querySelector<HTMLInputElement>("#project-home-name")
      expect(input).not.toBeNull()
      await act(async () => {
        if (!input) return
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          "Launch plan",
        )
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: "Launch plan",
            inputType: "insertText",
          }),
        )
        input.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(input?.value).toBe("Launch plan")
      expect(
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
          (button) => button.textContent?.trim() === "Create project",
        )?.disabled,
      ).toBeFalse()
      await act(async () => {
        document
          .querySelector<HTMLFormElement>("#project-home-name")
          ?.closest("form")
          ?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
      })

      expect(createProject).toHaveBeenCalledWith("Launch plan")
      expect(onSelectionStart).toHaveBeenCalledTimes(1)
      expect(callOrder).toEqual(["selection", "create"])
      expect(onEnterProject).toHaveBeenCalledWith("created")
      expect(controller.initialize).not.toHaveBeenCalled()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.querySelector("[data-project-list]")).toBeNull()
    })
  })

  test("keeps native open cancellation quiet and reports real open failures", async () => {
    await withDom(async (root) => {
      const canceled = controllerHarness()
      const onEnterProject = mock(async () => true)

      await act(async () => {
        root.render(
          <ProjectHome controller={canceled.controller} onEnterProject={onEnterProject} />,
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-project-action="open"]')?.click()
      })

      expect(canceled.controller.openProject).toHaveBeenCalledTimes(1)
      expect(onEnterProject).not.toHaveBeenCalled()
      expect(document.querySelector('[role="alert"]')).toBeNull()

      const failed = controllerHarness()
      const openProject = mock(async () => {
        failed.setSnapshot({ error: "This folder cannot be opened." })
        return false
      })
      const failedController = Object.assign(failed.controller, { openProject })
      await act(async () => {
        root.render(
          <ProjectHome controller={failedController} onEnterProject={onEnterProject} />,
        )
      })
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-project-action="open"]')?.click()
      })

      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "This folder cannot be opened.",
      )
      expect(onEnterProject).not.toHaveBeenCalled()
    })
  })
})

afterEach(() => {
  globalThis.document?.body?.replaceChildren()
})
