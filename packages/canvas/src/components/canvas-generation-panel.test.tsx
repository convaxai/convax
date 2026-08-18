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
      toolId: "tool.image",
      warnings: [],
    })),
    listTools,
  }
}

describe("CanvasGenerationPanel", () => {
  test("maps the Canvas submitting state to the shared generation beam primitives", async () => {
    const canvas = createCanvasDocument({ id: "canvas-generation-motion" })
    const service = createService(mock(async () => []))
    const container = render(
      <CanvasGenerationPanel
        document={canvas}
        generateService={service}
        onSubmit={() => undefined}
        reducedMotion
        selectedNodeIds={[]}
      />,
    )

    await flushEffects()
    expect(container.querySelector(".convax-generation-panel")).not.toBeNull()
    const idleSurface = container.querySelector<HTMLElement>('[data-slot="beam-surface"]')
    const idleSubmit = container.querySelector<HTMLButtonElement>('button[aria-label="Run generation"]')
    expect(idleSurface?.getAttribute("data-ui-beam")).toBe("idle")
    expect(idleSurface?.getAttribute("data-ui-beam-motion")).toBe("reduce")
    expect(idleSurface?.getAttribute("data-ui-beam-tone")).toBe("spectrum")
    expect(idleSurface?.className).toContain("rounded-xl")
    expect(idleSubmit?.dataset.slot).toBe("beam-button")
    expect(idleSubmit?.getAttribute("data-ui-beam")).toBe("idle")

    await act(async () => {
      root?.render(
        <CanvasGenerationPanel
          document={canvas}
          generateService={service}
          onSubmit={() => undefined}
          reducedMotion
          selectedNodeIds={[]}
          submitting
        />,
      )
    })

    const activeSurface = container.querySelector<HTMLElement>('[data-slot="beam-surface"]')
    const activeSubmit = container.querySelector<HTMLButtonElement>('button[aria-label="Run generation"]')
    expect(activeSurface?.getAttribute("data-ui-beam")).toBe("rotate")
    expect(activeSubmit?.getAttribute("data-ui-beam")).toBe("pulse-inner")
    expect(activeSubmit?.getAttribute("data-ui-beam-motion")).toBe("reduce")
    expect(activeSubmit?.disabled).toBe(true)
    expect(activeSubmit?.querySelector('[data-slot="loading-spinner"]')).not.toBeNull()
  })

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

  test("renders cached tools and descriptions without loading while refreshing them in the background", async () => {
    const cachedTools: readonly CanvasGenerationToolSummary[] = [
      {
        acceptedInputs: [],
        description: "Cached image model",
        id: "tools/cached-image",
        modelName: "Cached Image",
        output: "image",
        serviceId: "cached-service",
        serviceName: "Cached Service",
        title: "Image model",
      },
    ]
    const cachedDescription: CanvasGenerationToolDescription = {
      fields: [],
      toolId: "tools/cached-image",
    }
    let rejectCatalog!: (reason?: unknown) => void
    let rejectDescription!: (reason?: unknown) => void
    const listTools = mock(
      () =>
        new Promise<readonly CanvasGenerationToolSummary[]>((_resolve, reject) => {
          rejectCatalog = reject
        }),
    )
    const describeTool = mock(
      () =>
        new Promise<CanvasGenerationToolDescription>((_resolve, reject) => {
          rejectDescription = reject
        }),
    )
    const service: CanvasGenerateService = {
      ...createService(listTools),
      describeTool,
      getCachedDescription: mock(() => cachedDescription),
      getCachedTools: mock(() => cachedTools),
    }
    const container = render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-cached-generation" })}
        generateService={service}
        initialPrompt="Create a cover"
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />,
    )

    await flushEffects()
    expect(container.textContent).toContain("Cached Service · Cached Image")
    expect(container.textContent).not.toContain("Loading generation tools")
    expect(container.textContent).not.toContain("Loading generation options")
    expect(listTools).toHaveBeenCalledWith({}, expect.any(AbortSignal))
    expect(describeTool).toHaveBeenCalledWith("tools/cached-image", expect.any(AbortSignal))
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Run generation"]')?.disabled).toBe(false)

    await act(async () => {
      rejectCatalog(new Error("Background catalog refresh failed"))
      rejectDescription(new Error("Background description refresh failed"))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain("Cached Service · Cached Image")
    expect(container.textContent).not.toContain("Background catalog refresh failed")
    expect(container.textContent).not.toContain("Background description refresh failed")
    expect(container.textContent).not.toContain("Loading generation tools")
    expect(container.textContent).not.toContain("Loading generation options")
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Run generation"]')?.disabled).toBe(false)
  })

  test("preserves edits made to cached options while their description refreshes", async () => {
    const tools: readonly CanvasGenerationToolSummary[] = [
      {
        acceptedInputs: [],
        description: "Cached image model",
        id: "tools/cached-image",
        modelName: "Cached Image",
        output: "image",
        serviceId: "cached-service",
        serviceName: "Cached Service",
        title: "Image model",
      },
    ]
    const fields: CanvasGenerationToolDescription["fields"] = [
      {
        choices: [
          { label: "Draft", value: "draft" },
          { label: "Final", value: "final" },
        ],
        defaultValue: "draft",
        id: "quality",
        kind: "select",
        label: "Quality",
        required: false,
      },
    ]
    let resolveDescription!: (value: CanvasGenerationToolDescription) => void
    let catalogVersion = 0
    const service: CanvasGenerateService = {
      ...createService(mock(async () => tools)),
      get catalogVersion() {
        return catalogVersion
      },
      describeTool: mock(
        () =>
          new Promise<CanvasGenerationToolDescription>((resolve) => {
            resolveDescription = resolve
          }),
      ),
      getCachedDescription: mock((toolId) => ({ fields, toolId })),
      getCachedTools: mock(() => tools),
    }
    const panel = () => (
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-cached-options" })}
        generateService={service}
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />
    )
    const container = render(panel())

    await flushEffects()
    const currentQualitySelect = () => {
      const qualityLabel = [...container.querySelectorAll("label")].find((label) =>
        label.textContent?.includes("Quality"),
      )
      return qualityLabel?.htmlFor ? document.getElementById(qualityLabel.htmlFor) : undefined
    }
    let qualitySelect = currentQualitySelect()
    expect(qualitySelect?.textContent).toContain("Draft")

    await act(async () => qualitySelect?.click())
    const finalOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("Final"),
    )
    await act(async () => finalOption?.click())
    expect(qualitySelect?.textContent).toContain("Final")

    catalogVersion += 1
    await act(async () => root?.render(panel()))
    await flushEffects()
    qualitySelect = currentQualitySelect()
    expect(qualitySelect?.isConnected).toBe(true)
    expect(qualitySelect?.textContent).toContain("Final")

    await act(async () => qualitySelect?.click())
    const autoOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === "Auto",
    )
    await act(async () => autoOption?.click())
    expect(currentQualitySelect()?.textContent).toContain("Auto")

    await act(async () => {
      resolveDescription({ fields, toolId: "tools/cached-image" })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(currentQualitySelect()?.textContent).toContain("Auto")
  })

  test("replaces a cached model when background catalog revalidation succeeds", async () => {
    const cachedTools: readonly CanvasGenerationToolSummary[] = [
      {
        acceptedInputs: [],
        description: "Cached image model",
        id: "tools/cached-image",
        modelName: "Cached Image",
        output: "image",
        serviceId: "cached-service",
        serviceName: "Cached Service",
        title: "Image model",
      },
    ]
    let resolveCatalog!: (tools: readonly CanvasGenerationToolSummary[]) => void
    const listTools = mock(
      () =>
        new Promise<readonly CanvasGenerationToolSummary[]>((resolve) => {
          resolveCatalog = resolve
        }),
    )
    const service: CanvasGenerateService = {
      ...createService(listTools),
      getCachedDescription: mock((toolId) => ({ fields: [], toolId })),
      getCachedTools: mock(() => cachedTools),
    }
    const container = render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-refreshed-generation" })}
        generateService={service}
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />,
    )

    await flushEffects()
    expect(container.textContent).toContain("Cached Service · Cached Image")
    expect(container.textContent).not.toContain("Loading generation tools")

    await act(async () => {
      resolveCatalog([
        {
          acceptedInputs: [],
          description: "Refreshed image model",
          id: "tools/refreshed-image",
          modelName: "Refreshed Image",
          output: "image",
          serviceId: "refreshed-service",
          serviceName: "Refreshed Service",
          title: "Image model",
        },
      ])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain("Refreshed Service · Refreshed Image")
    expect(container.textContent).not.toContain("Cached Service · Cached Image")
    expect(container.textContent).not.toContain("Loading generation tools")
  })

  test("updates a mounted composer from the host's shared catalog subscription", async () => {
    let cachedTools: readonly CanvasGenerationToolSummary[] = [
      {
        acceptedInputs: [],
        description: "Initial image model",
        id: "tools/initial-image",
        modelName: "Initial Image",
        output: "image",
        serviceId: "shared-service",
        serviceName: "Shared Service",
        title: "Image model",
      },
    ]
    let notifyCatalog: () => void = () => undefined
    const service: CanvasGenerateService = {
      ...createService(() => new Promise(() => undefined)),
      getCachedDescription: mock((toolId) => ({ fields: [], toolId })),
      getCachedTools: mock(() => cachedTools),
      subscribeCatalog(listener) {
        notifyCatalog = listener
        return () => {
          notifyCatalog = () => undefined
        }
      },
    }
    const container = render(
      <CanvasGenerationPanel
        document={createCanvasDocument({ id: "canvas-shared-subscription" })}
        generateService={service}
        onSubmit={() => undefined}
        selectedNodeIds={[]}
      />,
    )

    await flushEffects()
    expect(container.textContent).toContain("Shared Service · Initial Image")
    cachedTools = [
      {
        acceptedInputs: [],
        description: "Fresh image model",
        id: "tools/fresh-image",
        modelName: "Fresh Image",
        output: "image",
        serviceId: "shared-service",
        serviceName: "Shared Service",
        title: "Image model",
      },
    ]
    await act(async () => notifyCatalog())
    await flushEffects()

    expect(container.textContent).toContain("Shared Service · Fresh Image")
    expect(container.textContent).not.toContain("Shared Service · Initial Image")
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

    const submission = onSubmit.mock.calls[0]?.[0]
    expect(submission).toMatchObject({
      documentId: "canvas-a",
      prompt: "Create a cover",
      promptContextNodeIds: [],
      scopeId: "project-a",
      tool: { id: "tool.image" },
    })
    expect(submission).not.toHaveProperty("expectedRevision")
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
