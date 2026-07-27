import { afterEach, describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { type ReactNode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createCanvasDocument } from "../document"
import type { CanvasGenerateService, CanvasGenerationToolSummary } from "../services"
import { CanvasGenerationPanel } from "./canvas-generation-panel"

const testWindow = new Window({ url: "https://convax.test/" })
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  Element: testWindow.Element,
  Event: testWindow.Event,
  HTMLElement: testWindow.HTMLElement,
  HTMLInputElement: testWindow.HTMLInputElement,
  InputEvent: testWindow.InputEvent,
  Node: testWindow.Node,
  document: testWindow.document,
  navigator: testWindow.navigator,
  window: testWindow,
})) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
})

let root: Root | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function render(element: ReactNode) {
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(element))
  return container
}

function createService(
  listTools: CanvasGenerateService["listTools"],
): CanvasGenerateService {
  return {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async () => ({
      createdNodeIds: [],
      revision: 1,
      toolId: "tool.image",
      warnings: [],
    })),
    listTools,
  }
}

describe("CanvasGenerationPanel", () => {
  test("submits a bounded Canvas scope snapshot through the external operation owner", async () => {
    let acceptedOperationSignal: AbortSignal | undefined
    const onSubmit = mock(() => {
      acceptedOperationSignal = new AbortController().signal
    })
    const document = createCanvasDocument({ id: "canvas-a" })
    const service = createService(
      mock(async () => [
        {
          acceptedInputs: [],
          description: "Creates an image",
          id: "tool.image",
          output: "image" as const,
          title: "Image",
        },
      ]),
    )
    const container = render(
      <CanvasGenerationPanel
        document={document}
        generateService={service}
        initialPrompt="Create a cover"
        onSubmit={onSubmit}
        scopeId="project-a"
        selectedNodeIds={[]}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const input = container.querySelector<HTMLInputElement>("input")
    expect(input).not.toBeNull()
    expect(input?.disabled).toBe(false)
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "canvas-a",
        expectedRevision: document.revision,
        prompt: "Create a cover",
        scopeId: "project-a",
        tool: expect.objectContaining({ id: "tool.image" }),
      }),
    )
    await act(async () => root?.unmount())
    root = undefined
    expect(acceptedOperationSignal?.aborted).toBe(false)
  })

  test("aborts catalog discovery, but does not own or cancel submitted operations", async () => {
    let catalogSignal: AbortSignal | undefined
    const service = createService(
      mock(
        (_query, signal) =>
          new Promise<readonly CanvasGenerationToolSummary[]>(() => {
            catalogSignal = signal
          }),
      ),
    )
    render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-a" })}
        generateService={service}
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />,
    )
    expect(catalogSignal?.aborted).toBe(false)

    await act(async () => root?.unmount())
    root = undefined
    expect(catalogSignal?.aborted).toBe(true)
    expect(service.generate).not.toHaveBeenCalled()
  })
})
