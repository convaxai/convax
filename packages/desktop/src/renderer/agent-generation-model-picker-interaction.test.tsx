import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { AgentGenerationModelPicker } from "./agent-generation-model-picker"

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    Node: testWindow.Node,
    ResizeObserver: testWindow.ResizeObserver,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })

  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

test("opens Services from the no-model state", async () => {
  const restoreWindow = installTestWindow()
  const onOpenServices = mock(() => undefined)
  let root: Root | undefined
  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <AgentGenerationModelPicker
          activeTab="llm"
          llmCatalog={{ providers: [] }}
          loading={false}
          onClose={mock(() => undefined)}
          onLlmSelect={mock(() => undefined)}
          onOpenServices={onOpenServices}
          onSelect={mock(() => undefined)}
          onTabChange={mock(() => undefined)}
          onToolInputChange={mock(() => undefined)}
          toolInput={{}}
          tools={[]}
        />,
      )
    })

    const openServices = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Open Services",
    )
    expect(openServices).toBeDefined()
    await act(async () => openServices?.click())
    expect(onOpenServices).toHaveBeenCalledTimes(1)
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("opens Services from an empty media-service tab", async () => {
  const restoreWindow = installTestWindow()
  const onOpenServices = mock(() => undefined)
  let root: Root | undefined
  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <AgentGenerationModelPicker
          activeTab="image"
          loading={false}
          onClose={mock(() => undefined)}
          onLlmSelect={mock(() => undefined)}
          onOpenServices={onOpenServices}
          onSelect={mock(() => undefined)}
          onTabChange={mock(() => undefined)}
          onToolInputChange={mock(() => undefined)}
          toolInput={{}}
          tools={[]}
        />,
      )
    })

    expect(document.body.textContent).toContain("No available image generation service provides a model.")
    const openServices = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Open Services",
    )
    expect(openServices).toBeDefined()
    await act(async () => openServices?.click())
    expect(onOpenServices).toHaveBeenCalledTimes(1)
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("selects the first real media model when a media tab is opened", async () => {
  const restoreWindow = installTestWindow()
  const onSelect = mock(() => undefined)
  let root: Root | undefined
  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <AgentGenerationModelPicker
          activeTab="image"
          loading={false}
          onClose={mock(() => undefined)}
          onLlmSelect={mock(() => undefined)}
          onOpenServices={mock(() => undefined)}
          onSelect={onSelect}
          onTabChange={mock(() => undefined)}
          onToolInputChange={mock(() => undefined)}
          toolInput={{}}
          tools={[
            {
              acceptedInputs: [],
              description: "First model",
              id: "plugin.example:image.first",
              kind: "model",
              modelName: "First image",
              output: "image",
              pluginId: "plugin.example",
              pluginName: "Example service",
              serviceId: "plugin-example",
              title: "First image",
              toolId: "image.first",
            },
            {
              acceptedInputs: [],
              description: "Second model",
              id: "plugin.example:image.second",
              kind: "model",
              modelName: "Second image",
              output: "image",
              pluginId: "plugin.example",
              pluginName: "Example service",
              serviceId: "plugin-example",
              title: "Second image",
              toolId: "image.second",
            },
          ]}
        />,
      )
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("Auto")
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith({ id: "plugin.example:image.first", output: "image" })
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("opens a service before selecting one of its concrete media models", async () => {
  const restoreWindow = installTestWindow()
  const onSelect = mock(() => undefined)
  const onClose = mock(() => undefined)
  let root: Root | undefined
  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <AgentGenerationModelPicker
          activeTab="image"
          loading={false}
          onClose={onClose}
          onLlmSelect={mock(() => undefined)}
          onOpenServices={mock(() => undefined)}
          onSelect={onSelect}
          onTabChange={mock(() => undefined)}
          onToolInputChange={mock(() => undefined)}
          selected={{ id: "first/image.generate", output: "image" }}
          toolInput={{}}
          tools={[
            {
              acceptedInputs: [],
              description: "First model",
              id: "first/image.generate",
              kind: "model",
              modelName: "First image",
              output: "image",
              pluginId: "first",
              pluginName: "First service",
              serviceId: "first",
              title: "First image",
              toolId: "image.generate",
            },
            {
              acceptedInputs: [],
              description: "Second model",
              id: "second/image.generate#model-selection-sha256:abc",
              kind: "model",
              modelName: "Second image",
              output: "image",
              pluginId: "second",
              pluginName: "Second service",
              serviceId: "second",
              title: "Second image",
              toolId: "image.generate",
            },
          ]}
        />,
      )
    })

    const secondService = [...document.querySelectorAll<HTMLDetailsElement>("details")].find((details) =>
      details.querySelector("summary")?.textContent?.includes("Second service"),
    )
    expect(secondService).not.toBeNull()
    expect(secondService?.open).toBeFalse()
    await act(async () => secondService?.querySelector<HTMLElement>("summary")?.click())
    expect(secondService?.open).toBeTrue()
    const second = document.querySelector<HTMLButtonElement>('button[aria-label="Second image by Second service"]')
    expect(second).not.toBeNull()
    await act(async () => second?.click())
    expect(onSelect).toHaveBeenLastCalledWith({
      id: "second/image.generate#model-selection-sha256:abc",
      output: "image",
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("closes after selecting a concrete LLM model", async () => {
  const restoreWindow = installTestWindow()
  const onClose = mock(() => undefined)
  const onLlmSelect = mock(() => undefined)
  let root: Root | undefined
  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <AgentGenerationModelPicker
          activeTab="llm"
          llmCatalog={{
            providers: [
              {
                connected: true,
                models: [{ default: true, modelId: "main", modelName: "Main model" }],
                providerId: "example",
                providerName: "Example service",
              },
            ],
          }}
          loading={false}
          onClose={onClose}
          onLlmSelect={onLlmSelect}
          onOpenServices={mock(() => undefined)}
          onSelect={mock(() => undefined)}
          onTabChange={mock(() => undefined)}
          onToolInputChange={mock(() => undefined)}
          toolInput={{}}
          tools={[]}
        />,
      )
    })

    const model = document.querySelector<HTMLButtonElement>('button[aria-label="Main model by Example service"]')
    expect(model).not.toBeNull()
    await act(async () => model?.click())
    expect(onLlmSelect).toHaveBeenCalledWith({ modelId: "main", providerId: "example" })
    expect(onClose).toHaveBeenCalledTimes(1)
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("reports its portaled surface so tab pointer events stay inside the shared picker", async () => {
  const restoreWindow = installTestWindow()
  const onElementChange = mock((_element: HTMLDivElement | null) => undefined)
  const onTabChange = mock((_tab: "audio" | "image" | "llm" | "video") => undefined)
  let root: Root | undefined
  try {
    const container = document.createElement("div")
    const anchor = document.createElement("button")
    document.body.append(container, anchor)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <AgentGenerationModelPicker
          activeTab="llm"
          anchorElement={anchor}
          llmCatalog={{ providers: [] }}
          loading={false}
          onClose={mock(() => undefined)}
          onElementChange={onElementChange}
          onLlmSelect={mock(() => undefined)}
          onOpenServices={mock(() => undefined)}
          onSelect={mock(() => undefined)}
          onTabChange={onTabChange}
          onToolInputChange={mock(() => undefined)}
          toolInput={{}}
          tools={[]}
        />,
      )
    })

    const picker = document.querySelector<HTMLDivElement>("[data-agent-generation-model-picker]")
    const imageTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent === "Image",
    )
    expect(picker?.parentElement).toBe(document.body)
    expect(onElementChange).toHaveBeenCalledWith(picker)
    await act(async () => {
      imageTab?.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
      imageTab?.click()
    })
    expect(onTabChange).toHaveBeenCalledWith("image")
  } finally {
    if (root) await act(async () => root?.unmount())
    expect(onElementChange).toHaveBeenLastCalledWith(null)
    await restoreWindow()
  }
})
