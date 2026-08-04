import type {
  ProjectCollaborationRecoveryClient,
  ProjectRecoveryStatusV1,
  ProjectResetPreviewV1,
} from "@convax/project"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ProjectResetRecoveryState } from "./project-reset-recovery"

const deletionDigest = "a".repeat(64)
const inventoryDigest = "b".repeat(64)
const token = "reset-host-preview" as const
const preview: ProjectResetPreviewV1 = {
  format: "convax.project-reset-preview/1",
  ordinaryProjectFilesPreserved: true,
  preview: [
    { kind: "directory", path: ".convax/canvases" },
    { kind: "file", path: ".convax/canvases/catalog.json" },
  ],
  privateDeletionSetDigest: deletionDigest,
  projectId: "project-legacy",
  token,
  unsupportedInventoryDigest: inventoryDigest,
}

function recoveryClient(overrides: Partial<ProjectCollaborationRecoveryClient> = {}) {
  return {
    confirmReset: mock(async () => ({ projectId: "project-legacy", status: "published" as const })),
    inspectProject: mock(async () => ({
      legacyPaths: [".convax/canvases/catalog.json"],
      status: "unsupported-portable-project-version" as const,
    })),
    previewReset: mock(async () => preview),
    ...overrides,
  } satisfies ProjectCollaborationRecoveryClient
}

async function withDom(run: (root: Root) => Promise<void>) {
  const window = new Window()
  const globals = {
    Element: window.Element,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
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

async function renderRecovery(root: Root, client: ProjectCollaborationRecoveryClient, input: {
  onCancel?: () => void
  onPublished?: (projectId: string) => Promise<void> | void
  onUnavailable?: (error?: string) => void
} = {}) {
  await act(async () => {
    root.render(
      <ProjectResetRecoveryState
        client={client}
        onCancel={input.onCancel ?? (() => undefined)}
        onPublished={input.onPublished ?? (() => undefined)}
        onUnavailable={input.onUnavailable ?? (() => undefined)}
        project={{ id: "project-legacy", name: "Legacy storyboard" }}
      />,
    )
  })
  await act(async () => await Promise.resolve())
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label)
}

describe("ProjectResetRecoveryState", () => {
  test("stays absent unless inspection confirms an eligible legacy Project", async () => {
    await withDom(async (root) => {
      const current = recoveryClient({
        inspectProject: mock(async (): Promise<ProjectRecoveryStatusV1> => ({ status: "current" })),
      })
      const onUnavailable = mock(() => undefined)
      await renderRecovery(root, current, { onUnavailable })

      expect(document.querySelector("[data-project-reset-recovery]")).toBeNull()
      expect(current.previewReset).not.toHaveBeenCalled()
      expect(onUnavailable).toHaveBeenCalledWith()
    })
  })

  test("shows the exact private deletion set, both digests, and preserved ordinary files", async () => {
    await withDom(async (root) => {
      const client = recoveryClient()
      await renderRecovery(root, client)

      expect(client.inspectProject).toHaveBeenCalledWith("project-legacy")
      expect(client.previewReset).toHaveBeenCalledWith("project-legacy")
      expect(document.querySelector("[data-project-reset-deletion-set]")?.textContent).toContain(
        ".convax/canvases/catalog.json",
      )
      expect(document.querySelector("[data-project-reset-deletion-digest]")?.textContent).toContain(deletionDigest)
      expect(document.querySelector("[data-project-reset-inventory-digest]")?.textContent).toContain(inventoryDigest)
      expect(document.querySelector("[data-project-reset-preserves-files]")?.textContent).toContain(
        "Ordinary Project files are preserved",
      )
      expect(document.activeElement?.textContent).toBe("Cancel")
    })
  })

  test("requires two explicit steps and submits only the opaque preview token", async () => {
    await withDom(async (root) => {
      const client = recoveryClient()
      const onPublished = mock(async () => undefined)
      await renderRecovery(root, client, { onPublished })

      await act(async () => button("Continue")?.click())
      expect(client.confirmReset).not.toHaveBeenCalled()
      expect(button("Delete legacy data and reset")).toBeTruthy()
      expect(document.activeElement?.textContent).toBe("Cancel")

      await act(async () => button("Delete legacy data and reset")?.click())
      expect(client.confirmReset).toHaveBeenCalledTimes(1)
      expect(client.confirmReset).toHaveBeenCalledWith({ projectId: "project-legacy", token })
      expect(onPublished).toHaveBeenCalledWith("project-legacy")
    })
  })

  test("keeps Cancel non-destructive at both confirmation levels", async () => {
    await withDom(async (root) => {
      const onCancel = mock(() => undefined)
      const client = recoveryClient()
      await renderRecovery(root, client, { onCancel })

      await act(async () => button("Continue")?.click())
      await act(async () => button("Cancel")?.click())

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(client.confirmReset).not.toHaveBeenCalled()
    })
  })

  test("makes stale, rejected, and staged outcomes terminal without a retry action", async () => {
    for (const confirmReset of [
      mock(async () => Promise.reject(new Error("Project reset preview is stale"))),
      mock(async () => ({ reason: "team-service-unavailable" as const, status: "staged" as const })),
    ]) {
      await withDom(async (root) => {
        const client = recoveryClient({ confirmReset })
        await renderRecovery(root, client)
        await act(async () => button("Continue")?.click())
        await act(async () => button("Delete legacy data and reset")?.click())

        expect(document.querySelector("[data-project-reset-error]")).toBeTruthy()
        expect(document.body.textContent).toContain("Convax will not retry automatically")
        expect(button("Continue")).toBeUndefined()
        expect(button("Delete legacy data and reset")).toBeUndefined()
        expect([...document.querySelectorAll("button")]).toHaveLength(1)
        expect(confirmReset).toHaveBeenCalledTimes(1)
      })
    }
  })
})

afterEach(() => {
  globalThis.document?.body?.replaceChildren()
})
