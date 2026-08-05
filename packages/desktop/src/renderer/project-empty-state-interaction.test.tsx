import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { ProjectCollaborationPendingState } from "./project-empty-state"

async function withDom(run: (root: Root, clipboardWrite: ReturnType<typeof mock>) => Promise<void>) {
  const window = new Window()
  const clipboardWrite = mock(async () => undefined)
  const globals = {
    Element: window.Element,
    Event: window.Event,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    InputEvent: window.InputEvent,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    document: window.document,
    navigator: { clipboard: { writeText: clipboardWrite } },
    window,
  }
  const original = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await run(root, clipboardWrite)
  } finally {
    await act(async () => root.unmount())
    await window.happyDOM.close()
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label)
}

describe("ProjectCollaborationPendingState interactions", () => {
  test("keeps a fresh invitation visible until the creator explicitly continues", async () => {
    await withDom(async (root, clipboardWrite) => {
      const share = JSON.stringify({ invitationToken: "AAAAAAAAAAAAAAAAAAAAAA", projectId: "project-one" })
      const onCreateTeam = mock(async () => ({ invitation: share }))
      const onReady = mock(async () => undefined)
      await act(async () => {
        root.render(
          <ProjectCollaborationPendingState
            onCreateTeam={onCreateTeam}
            onJoinTeam={async () => undefined}
            onReady={onReady}
            projectId="project-one"
          />,
        )
      })

      await act(async () => button("Start sharing and enable collaboration")?.click())
      expect(onCreateTeam).toHaveBeenCalledWith("project-one")
      expect(onReady).not.toHaveBeenCalled()
      expect(document.querySelector<HTMLTextAreaElement>("#project-created-team-invitation")?.value).toBe(share)

      await act(async () => button("Copy invitation")?.click())
      expect(clipboardWrite).toHaveBeenCalledWith(share)
      expect(button("Copied")).toBeDefined()

      await act(async () => button("Continue to Project")?.click())
      expect(onReady).toHaveBeenCalledWith("project-one")
    })
  })

  test("submits the exact pasted carrier and enters only after join succeeds", async () => {
    await withDom(async (root) => {
      const onJoinTeam = mock(async () => undefined)
      const onReady = mock(async () => undefined)
      await act(async () => {
        root.render(
          <ProjectCollaborationPendingState
            onCreateTeam={async () => ({ invitation: null })}
            onJoinTeam={onJoinTeam}
            onReady={onReady}
            projectId="project-one"
          />,
        )
      })

      await act(async () => button("Join collaboration with an invitation")?.click())
      const input = document.querySelector<HTMLInputElement>("#project-team-invitation")!
      await act(async () => {
        input.value = "  complete-carrier  "
        input.dispatchEvent(new InputEvent("input", { bubbles: true }))
      })
      await act(async () => button("Verify and join")?.click())
      expect(onJoinTeam).toHaveBeenCalledWith({ invitation: "complete-carrier", projectId: "project-one" })
      expect(onReady).toHaveBeenCalledWith("project-one")
    })
  })
})
