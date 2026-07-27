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
