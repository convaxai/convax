import { afterEach, describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { type ReactNode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createCanvasDocument, createTextNode } from "../document"
import type { CanvasGenerateService, CanvasGenerationToolDescription, CanvasGenerationToolSummary } from "../services"

const testWindow = new Window({ url: "https://convax.test/" })
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
  CustomEvent: testWindow.CustomEvent,
  Element: testWindow.Element,
  Event: testWindow.Event,
  FocusEvent: testWindow.FocusEvent,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
  HTMLElement: testWindow.HTMLElement,
  HTMLIFrameElement: testWindow.HTMLIFrameElement,
  HTMLInputElement: testWindow.HTMLInputElement,
  InputEvent: testWindow.InputEvent,
  KeyboardEvent: testWindow.KeyboardEvent,
  MouseEvent: testWindow.MouseEvent,
  MutationObserver: testWindow.MutationObserver,
  Node: testWindow.Node,
  PointerEvent: testWindow.PointerEvent,
  requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
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

const { CanvasGenerationPanel } = await import("./canvas-generation-panel")

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

async function flushEffects() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve()
  })
}

function createService(listTools: CanvasGenerateService["listTools"]): CanvasGenerateService {
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
  test("shows flat service and model names and submits the selected concrete model", async () => {
    const onSubmit = mock(() => undefined)
    const service = createService(
      mock(async () => [
        {
          acceptedInputs: [],
          description: "Creates an image with Image 2",
          id: "nexus/image.image-2",
          modelName: "Image 2",
          output: "image" as const,
          serviceId: "nexus-service",
          serviceName: "Nexus",
          title: "Nexus · OpenRouter Image",
        },
        {
          acceptedInputs: [],
          description: "Creates an image with Gemini",
          id: "nexus/image.gemini",
          modelName: "Gemini 2.5 Flash Image",
          output: "image" as const,
          serviceId: "nexus-service",
          serviceName: "Nexus",
          title: "Nexus · OpenRouter Image",
        },
      ]),
    )
    const container = render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-flat-models" })}
        generateService={service}
        initialPrompt="Create an image"
        onSubmit={onSubmit}
        selectedNodeIds={[]}
      />,
    )

    await flushEffects()
    const toolSelect = container.querySelector<HTMLButtonElement>('button[aria-label="Generation tool"]')
    expect(toolSelect?.textContent).toContain("Nexus · Image 2")
    expect(toolSelect?.textContent).not.toContain("Nexus · OpenRouter Image")

    await act(async () => toolSelect?.click())
    await flushEffects()
    expect(toolSelect?.getAttribute("aria-expanded")).toBe("true")
    const modelOptions = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(modelOptions.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Nexus · Image 2"),
      expect.stringContaining("Nexus · Gemini 2.5 Flash Image"),
    ])

    await act(async () => modelOptions[1]?.click())
    await flushEffects()
    expect(toolSelect?.textContent).toContain("Nexus · Gemini 2.5 Flash Image")

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: expect.objectContaining({ id: "nexus/image.gemini" }),
      }),
    )
  })

  test("renders the selected tool's live model field and submits the chosen value", async () => {
    const onSubmit = mock(() => undefined)
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
    service.describeTool = mock(async (toolId) => ({
      fields: [
        {
          choices: [
            { label: "Image Alpha", value: "provider/image-alpha" },
            { label: "Image Beta", value: "provider/image-beta" },
          ],
          defaultValue: "provider/image-beta",
          id: "model",
          kind: "select" as const,
          label: "Model",
          required: true,
        },
      ],
      toolId,
    }))
    const container = render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-model" })}
        generateService={service}
        initialPrompt="Create an image"
        onSubmit={onSubmit}
        selectedNodeIds={[]}
      />,
    )

    await flushEffects()
    expect(service.describeTool).toHaveBeenCalledWith("tool.image", expect.any(AbortSignal))
    const modelLabel = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Model"))
    expect(modelLabel).toBeDefined()
    const modelSelect = modelLabel?.htmlFor ? document.getElementById(modelLabel.htmlFor) : null
    expect(modelSelect?.getAttribute("role")).toBe("combobox")
    expect(modelSelect?.textContent).toContain("Image Beta")
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Run generation"]')?.disabled).toBe(false)

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolInput: { model: "provider/image-beta" },
      }),
    )
  })

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
        promptContextNodeIds: [],
        scopeId: "project-a",
        tool: expect.objectContaining({ id: "tool.image" }),
      }),
    )
    await act(async () => root?.unmount())
    root = undefined
    expect(acceptedOperationSignal?.aborted).toBe(false)
  })

  test("submits a selected text node as complete prompt context with an empty typed prompt", async () => {
    const onSubmit = mock(() => undefined)
    const brief = createTextNode({
      id: "brief",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "A complete cinematic prompt" },
    })
    const document = createCanvasDocument({ id: "canvas-text", nodes: [brief] })
    const service = createService(
      mock(async () => [
        {
          acceptedInputs: [],
          description: "Creates an image from a prompt",
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
        onSubmit={onSubmit}
        selectedNodeIds={[brief.id]}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const submit = container.querySelector<HTMLButtonElement>('button[aria-label="Run generation"]')
    expect(submit?.disabled).toBe(false)
    expect(container.textContent).toContain("1 text prompt context")

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "",
        promptContextNodeIds: [brief.id],
        references: [],
      }),
    )
  })

  test("keeps generation disabled when both the typed prompt and text context are empty", async () => {
    const onSubmit = mock(() => undefined)
    const service = createService(
      mock(async () => [
        {
          acceptedInputs: [],
          description: "Creates an image from a prompt",
          id: "tool.image",
          output: "image" as const,
          title: "Image",
        },
      ]),
    )
    const container = render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-empty" })}
        generateService={service}
        onSubmit={onSubmit}
        selectedNodeIds={[]}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const submit = container.querySelector<HTMLButtonElement>('button[aria-label="Run generation"]')
    expect(submit?.disabled).toBe(true)
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test("offers host-owned Services navigation when no available model is returned", async () => {
    const onOpenServices = mock(() => undefined)
    const container = render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-no-models" })}
        generateService={createService(mock(async () => []))}
        onOpenServices={onOpenServices}
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain("No available generation service provides a model.")
    expect(container.textContent).not.toContain("Install a Tool Plugin")
    const servicesButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Go to Services",
    )
    expect(servicesButton).toBeDefined()
    await act(async () => servicesButton?.click())
    expect(onOpenServices).toHaveBeenCalledTimes(1)
  })

  test("reloads an initially empty catalog when the host availability version settles", async () => {
    let catalogVersion = 0
    let ready = false
    const listTools = mock(async () =>
      ready
        ? [
            {
              acceptedInputs: [] as const,
              description: "Connected image model",
              id: "tools/connected-image",
              modelName: "Connected Image",
              output: "image" as const,
              serviceId: "connected-service",
              serviceName: "Connected Service",
              title: "Image model",
            },
          ]
        : [],
    )
    const service: CanvasGenerateService = {
      ...createService(listTools),
      get catalogVersion() {
        return catalogVersion
      },
    }
    const panel = () => (
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-catalog-settles" })}
        generateService={service}
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />
    )
    const container = render(panel())
    await flushEffects()
    expect(container.textContent).toContain("No available generation service provides a model.")

    ready = true
    catalogVersion += 1
    await act(async () => root?.render(panel()))
    await flushEffects()

    expect(listTools).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("Connected Service · Connected Image")
    expect(container.textContent).not.toContain("No available generation service provides a model.")
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

  test("aborts live tool description when the composer unmounts", async () => {
    let descriptionSignal: AbortSignal | undefined
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
    service.describeTool = mock(
      (_toolId, signal) =>
        new Promise<CanvasGenerationToolDescription>(() => {
          descriptionSignal = signal
        }),
    )
    render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-description" })}
        generateService={service}
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />,
    )

    await flushEffects()
    expect(descriptionSignal?.aborted).toBe(false)
    await act(async () => root?.unmount())
    root = undefined
    expect(descriptionSignal?.aborted).toBe(true)
  })
})
