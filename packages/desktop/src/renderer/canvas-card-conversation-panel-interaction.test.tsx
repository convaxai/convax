import { createCanvasDocument, createMediaNode, createTextNode } from "@convax/canvas/core"
import type {
  CanvasAssistantRequest,
  CanvasGenerateRequest,
  CanvasGenerateService,
  CanvasGenerationToolDescription,
  CanvasGenerationToolSummary,
} from "@convax/canvas"
import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

async function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
    CustomEvent: testWindow.CustomEvent,
    Element: testWindow.Element,
    Event: testWindow.Event,
    FocusEvent: testWindow.FocusEvent,
    getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
    HTMLElement: testWindow.HTMLElement,
    HTMLIFrameElement: testWindow.HTMLIFrameElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    MouseEvent: testWindow.MouseEvent,
    MutationObserver: testWindow.MutationObserver,
    Node: testWindow.Node,
    PointerEvent: testWindow.PointerEvent,
    requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
    document: testWindow.document,
    navigator: testWindow.navigator,
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
  const { CanvasCardGenerationPanel } = await import("./canvas-card-conversation-panel")
  const restoreWindow = async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
  return { CanvasCardGenerationPanel, restoreWindow }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test("removes a default generation @ input from the submitted references", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  let submitted: CanvasGenerateRequest | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const input = createMediaNode({
    id: "input",
    position: { x: -320, y: 0 },
    resource: {
      id: "input-resource",
      kind: "image",
      metadata: {},
      name: "Reference",
      state: { status: "ready", url: "asset://reference" },
    },
  })
  const request: CanvasAssistantRequest = {
    document: {
      ...createCanvasDocument({
        edges: [{ id: "input-edge", source: input.id, target: owner.id }],
        id: "canvas",
        nodes: [owner, input],
      }),
    },
    generation: { initialPrompt: "Create a new scene", output: "image" },
    mentionedNodeIds: [input.id],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async (generationRequest) => {
      submitted = generationRequest
      return { createdNodeIds: [], toolId: generationRequest.toolId!, warnings: [] }
    }),
    listTools: mock(async () => [
      {
        acceptedInputs: ["reference_image"] as const,
        description: "Generate an image",
        id: "tools/image",
        output: "image" as const,
        title: "Image",
      },
    ]),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
      await settle()
    })

    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="Remove Canvas reference: Reference"]')
    expect(remove).not.toBeNull()
    expect(remove?.closest("[data-agent-composer-token]")?.className).toContain(
      "border-primary/20 bg-accent text-accent-foreground",
    )
    await act(async () => remove?.click())
    expect(document.querySelector('button[aria-label="Remove Canvas reference: Reference"]')).toBeNull()

    const addedInput = createMediaNode({
      id: "added-input",
      position: { x: -320, y: 240 },
      resource: {
        id: "added-resource",
        kind: "image",
        metadata: {},
        name: "Added reference",
        state: { status: "ready", url: "asset://added" },
      },
    })
    const updatedRequest: CanvasAssistantRequest = {
      ...request,
      document: {
        ...request.document,
        edges: [...request.document.edges, { id: "added-edge", source: addedInput.id, target: owner.id }],
        nodes: [...request.document.nodes, addedInput],
      },
      mentionedNodeIds: [input.id, addedInput.id],
    }
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          generation={updatedRequest.generation!}
          request={updatedRequest}
          service={service}
        />,
      )
      await settle()
    })
    expect(document.querySelector('button[aria-label="Remove Canvas reference: Reference"]')).toBeNull()
    const removeAdded = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Canvas reference: Added reference"]',
    )
    expect(removeAdded).not.toBeNull()
    await act(async () => removeAdded?.click())

    await act(settle)
    const generate = document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')
    expect(generate?.disabled).toBeFalse()
    await act(async () => {
      generate?.click()
      await settle()
    })
    expect(submitted?.references).toEqual([])
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("isolates a text card's model and tool options while switching image and video output", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  let submitted: CanvasGenerateRequest | undefined
  const onOwnerToolIdChange = mock(() => undefined)
  const owner = createTextNode({
    id: "text-owner",
    label: "Storyboard",
    metadata: {},
    position: { x: 0, y: 0 },
    resourceState: { status: "ready", text: "Opening scene" },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({ id: "canvas", nodes: [owner] }),
    generation: {
      availableOutputs: ["image", "video"],
      initialPrompt: "Animate this scene",
      onOwnerToolIdChange,
      output: "image",
    },
    mentionedNodeIds: [],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const tools = {
    image: [
      {
        acceptedInputs: [] as const,
        description: "First image model",
        id: "tools/image-first",
        output: "image" as const,
        title: "Image first",
      },
      {
        acceptedInputs: [] as const,
        description: "Second image model",
        id: "tools/image-second",
        output: "image" as const,
        title: "Image second",
      },
    ],
    video: [
      {
        acceptedInputs: [] as const,
        description: "First video model",
        id: "tools/video-first",
        output: "video" as const,
        title: "Video first",
      },
      {
        acceptedInputs: [] as const,
        description: "Second video model",
        id: "tools/video-second",
        output: "video" as const,
        title: "Video second",
      },
    ],
  }
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
      required: true,
    },
  ]
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields, toolId })),
    generate: mock(async (generationRequest) => {
      submitted = generationRequest
      return {
        createdNodeIds: ["generated-video"],
        toolId: generationRequest.toolId!,
        warnings: [],
      }
    }),
    listTools: mock(async (query) => (query.output === "video" ? tools.video : tools.image)),
  }
  const tab = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[aria-label="生成类型"] [role="tab"]')].find(
      (candidate) => candidate.textContent?.trim() === label,
    )
  const modelButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')
  const qualityButton = () => {
    const label = [...document.querySelectorAll("label")].find((candidate) =>
      candidate.textContent?.includes("Quality"),
    )
    return label?.htmlFor ? document.getElementById(label.htmlFor) : undefined
  }
  const chooseOption = async (trigger: HTMLElement | null | undefined, label: string) => {
    await act(async () => {
      trigger?.click()
      await settle()
    })
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) =>
      candidate.textContent?.includes(label),
    )
    if (!option) {
      throw new Error(
        `Missing option ${label}: ${[...document.querySelectorAll<HTMLElement>('[role="option"]')]
          .map((candidate) => candidate.textContent)
          .join(" | ")}`,
      )
    }
    await act(async () => {
      option?.click()
      await settle()
    })
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
      await settle()
    })

    expect(modelButton()?.textContent).toContain("Image first")
    await chooseOption(modelButton(), "Image second")
    await chooseOption(qualityButton(), "Final")
    expect(modelButton()?.textContent).toContain("Image second")
    expect(qualityButton()?.textContent).toContain("Final")

    await act(async () => {
      tab("视频")?.click()
      await settle()
    })
    expect(modelButton()?.textContent).toContain("Video first")
    expect(qualityButton()?.textContent).toContain("Draft")
    await chooseOption(modelButton(), "Video second")
    expect(modelButton()?.textContent).toContain("Video second")

    await act(async () => {
      tab("图片")?.click()
      await settle()
    })
    expect(modelButton()?.textContent).toContain("Image second")
    expect(qualityButton()?.textContent).toContain("Final")

    await act(async () => {
      tab("视频")?.click()
      await settle()
    })
    expect(modelButton()?.textContent).toContain("Video second")
    expect(qualityButton()?.textContent).toContain("Draft")

    const generate = document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')
    expect(generate?.disabled).toBeFalse()
    await act(async () => {
      generate?.click()
      await settle()
    })
    expect(submitted).toMatchObject({
      expectedOutputCount: 1,
      output: "video",
      referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
      resultMode: { type: "create-pending-node" },
      toolId: "tools/video-second",
      toolInput: { quality: "draft" },
    })
    expect(submitted?.promptContextNodeIds).toBeUndefined()
    expect(onOwnerToolIdChange).not.toHaveBeenCalled()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("shows the first real compatible model without writing a node override", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  const onOwnerToolIdChange = mock(() => undefined)
  const described: string[] = []
  let root: Root | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({ id: "canvas", nodes: [owner] }),
    generation: { onOwnerToolIdChange, output: "image" },
    mentionedNodeIds: [],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => {
      described.push(toolId)
      return { fields: [], toolId }
    }),
    generate: mock(async (generationRequest) => ({
      createdNodeIds: [],
      toolId: generationRequest.toolId!,
      warnings: [],
    })),
    listTools: mock(async () => [
      {
        acceptedInputs: [] as const,
        description: "First image model",
        id: "tools/first-image",
        output: "image" as const,
        title: "First image",
      },
      {
        acceptedInputs: [] as const,
        description: "Second image model",
        id: "tools/second-image",
        output: "image" as const,
        title: "Second image",
      },
    ]),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
      await settle()
    })

    const model = document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')
    expect(model?.textContent).toContain("First image")
    expect(model?.textContent).not.toContain("Auto")
    expect(document.body.textContent).not.toContain("自动")
    expect(document.body.textContent).not.toContain("跟随 Agent")
    expect(described).toEqual(["tools/first-image"])
    expect(onOwnerToolIdChange).not.toHaveBeenCalled()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("renders the shared cached model without loading and preserves it when background refresh fails", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({ id: "canvas", nodes: [owner] }),
    generation: { initialPrompt: "Create a new scene", output: "image" },
    mentionedNodeIds: [],
    mode: "file",
    ownerNodeId: owner.id,
  }
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
    describeTool,
    generate: mock(async (generationRequest) => ({
      createdNodeIds: [],
      toolId: generationRequest.toolId!,
      warnings: [],
    })),
    getCachedDescription: mock(() => cachedDescription),
    getCachedTools: mock(() => cachedTools),
    listTools,
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
    })

    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "Cached Service · Cached Image",
    )
    expect(document.body.textContent).not.toContain("正在加载模型")
    expect(document.body.textContent).not.toContain("正在加载可用模型")
    expect(document.body.textContent).not.toContain("正在加载模型选项")
    expect(listTools).toHaveBeenCalledWith({ output: "image" }, expect.any(AbortSignal))
    expect(describeTool).toHaveBeenCalledWith("tools/cached-image", expect.any(AbortSignal))
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')?.disabled).toBe(false)

    await act(async () => {
      rejectCatalog(new Error("Background catalog refresh failed"))
      rejectDescription(new Error("Background description refresh failed"))
      await settle()
    })

    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "Cached Service · Cached Image",
    )
    expect(document.body.textContent).not.toContain("Background catalog refresh failed")
    expect(document.body.textContent).not.toContain("Background description refresh failed")
    expect(document.body.textContent).not.toContain("正在加载模型")
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')?.disabled).toBe(false)
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("preserves edits to cached card options while their description refreshes", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({ id: "canvas", nodes: [owner] }),
    generation: { initialPrompt: "Create a new scene", output: "image" },
    mentionedNodeIds: [],
    mode: "file",
    ownerNodeId: owner.id,
  }
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
  let notifyCatalog: () => void = () => undefined
  let catalogVersion = 0
  const service: CanvasGenerateService = {
    describeTool: mock(
      () =>
        new Promise<CanvasGenerationToolDescription>((resolve) => {
          resolveDescription = resolve
        }),
    ),
    generate: mock(async (generationRequest) => ({
      createdNodeIds: [],
      toolId: generationRequest.toolId!,
      warnings: [],
    })),
    getCachedDescription: mock((toolId) => ({ fields, toolId })),
    getCachedTools: mock(() => tools.map((tool) => ({ ...tool }))),
    listTools: mock(async () => tools),
    subscribeCatalog(listener) {
      notifyCatalog = listener
      return () => {
        notifyCatalog = () => undefined
      }
    },
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    const panel = () => (
      <CanvasCardGenerationPanel
        catalogVersion={catalogVersion}
        generation={request.generation!}
        request={request}
        service={service}
      />
    )
    await act(async () => {
      root?.render(panel())
      await settle()
    })
    const currentQualitySelect = () => {
      const qualityLabel = [...document.querySelectorAll("label")].find((label) =>
        label.textContent?.includes("Quality"),
      )
      return qualityLabel?.htmlFor ? document.getElementById(qualityLabel.htmlFor) : undefined
    }
    let qualitySelect = currentQualitySelect()
    expect(qualitySelect?.textContent).toContain("Quality · Draft")

    await act(async () => qualitySelect?.click())
    const finalOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("Final"),
    )
    await act(async () => finalOption?.click())
    expect(qualitySelect?.textContent).toContain("Quality · Final")

    catalogVersion += 1
    await act(async () => {
      root?.render(panel())
      await settle()
    })
    qualitySelect = currentQualitySelect()
    expect(qualitySelect?.isConnected).toBe(true)
    expect(qualitySelect?.textContent).toContain("Quality · Final")

    await act(async () => notifyCatalog())
    qualitySelect = currentQualitySelect()
    expect(qualitySelect?.textContent).toContain("Quality · Final")

    await act(async () => qualitySelect?.click())
    const autoOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === "Auto",
    )
    await act(async () => autoOption?.click())
    expect(currentQualitySelect()?.textContent).toContain("Quality · Auto")

    await act(async () => {
      resolveDescription({ fields, toolId: "tools/cached-image" })
      await settle()
    })

    expect(currentQualitySelect()?.textContent).toContain("Quality · Auto")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("updates a mounted card from the host's shared catalog subscription", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({ id: "canvas", nodes: [owner] }),
    generation: { initialPrompt: "Create a new scene", output: "image" },
    mentionedNodeIds: [],
    mode: "file",
    ownerNodeId: owner.id,
  }
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
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async (generationRequest) => ({
      createdNodeIds: [],
      toolId: generationRequest.toolId!,
      warnings: [],
    })),
    getCachedDescription: mock((toolId) => ({ fields: [], toolId })),
    getCachedTools: mock(() => cachedTools),
    listTools: mock(() => new Promise<readonly CanvasGenerationToolSummary[]>(() => undefined)),
    subscribeCatalog(listener) {
      notifyCatalog = listener
      return () => {
        notifyCatalog = () => undefined
      }
    },
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
      await settle()
    })
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "Shared Service · Initial Image",
    )

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
    await act(async () => {
      notifyCatalog()
      await settle()
    })

    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "Shared Service · Fresh Image",
    )
    expect(document.body.textContent).not.toContain("Shared Service · Initial Image")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("submits the latest card model across delayed preference acknowledgements", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  let submitted: CanvasGenerateRequest | undefined
  const onOwnerToolIdChange = mock(() => undefined)
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const promptContext = createTextNode({
    id: "prompt-context",
    label: "Prompt context",
    metadata: {},
    position: { x: -320, y: 0 },
    resourceState: { status: "ready", text: "Keep the same scene direction" },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({
      edges: [{ id: "prompt-edge", source: promptContext.id, target: owner.id }],
      id: "canvas",
      nodes: [owner, promptContext],
    }),
    generation: {
      initialPrompt: "Create a new scene",
      onOwnerToolIdChange,
      output: "image",
      ownerToolId: "tools/first-image",
    },
    mentionedNodeIds: [promptContext.id],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async (generationRequest) => {
      submitted = generationRequest
      return { createdNodeIds: [], toolId: generationRequest.toolId!, warnings: [] }
    }),
    listTools: mock(async () => [
      {
        acceptedInputs: [] as const,
        description: "First image model",
        id: "tools/first-image",
        output: "image" as const,
        title: "First image",
      },
      {
        acceptedInputs: [] as const,
        description: "Second image model",
        id: "tools/second-image",
        output: "image" as const,
        title: "Second image",
      },
      {
        acceptedInputs: [] as const,
        description: "Third image model",
        id: "tools/third-image",
        output: "image" as const,
        title: "Third image",
      },
      {
        acceptedInputs: [] as const,
        description: "External image model",
        id: "tools/external-image",
        output: "image" as const,
        title: "External image",
      },
    ]),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
      await settle()
    })

    const model = document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')
    expect(model?.textContent).toContain("First image")
    await act(async () => {
      model?.click()
      await settle()
    })
    expect(model?.getAttribute("aria-expanded")).toBe("true")
    const second = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("Second image"),
    )
    expect(second).toBeDefined()
    await act(async () => {
      second?.click()
      await settle()
    })

    expect(onOwnerToolIdChange).toHaveBeenCalledWith("tools/second-image")
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "Second image",
    )
    const generate = document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')
    expect(generate?.disabled).toBeFalse()
    await act(async () => {
      generate?.click()
      await settle()
    })
    expect(submitted?.toolId).toBe("tools/second-image")

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.click()
      await settle()
    })
    const third = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("Third image"),
    )
    await act(async () => {
      third?.click()
      await settle()
    })
    expect(onOwnerToolIdChange).toHaveBeenLastCalledWith("tools/third-image")

    // The earlier second-model persistence may resolve after the user has already
    // chosen the third model. It is an acknowledgement, not an external override.
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          generation={{ ...request.generation!, ownerToolId: "tools/second-image" }}
          request={{
            ...request,
            generation: { ...request.generation!, ownerToolId: "tools/second-image" },
          }}
          service={service}
        />,
      )
      await settle()
    })
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "Third image",
    )
    await act(async () => {
      const latestGenerate = document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')
      expect(latestGenerate?.disabled).toBeFalse()
      latestGenerate?.click()
      await settle()
    })
    expect(submitted?.toolId).toBe("tools/third-image")

    // A value that was never part of this local selection sequence is an external
    // edit/undo and wins immediately over the optimistic choice.
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          generation={{ ...request.generation!, ownerToolId: "tools/external-image" }}
          request={{
            ...request,
            generation: { ...request.generation!, ownerToolId: "tools/external-image" },
          }}
          service={service}
        />,
      )
      await settle()
    })
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "External image",
    )
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("uses a text @ input as prompt context without requiring model reference support", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  const onOpenServices = mock(() => undefined)
  let root: Root | undefined
  let submitted: CanvasGenerateRequest | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const notes = createTextNode({
    id: "notes",
    label: "Scene notes",
    metadata: {},
    position: { x: -320, y: 0 },
    resourceState: { status: "ready", text: "Scene notes" },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({
      edges: [{ id: "notes-edge", source: notes.id, target: owner.id }],
      id: "canvas",
      nodes: [owner, notes],
    }),
    generation: { output: "image" },
    mentionedNodeIds: [notes.id],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async (generationRequest) => {
      submitted = generationRequest
      return {
        createdNodeIds: [],
        toolId: generationRequest.toolId!,
        warnings: [],
      }
    }),
    listTools: mock(async () => [
      {
        acceptedInputs: ["reference_image"] as const,
        description: "Image references only",
        id: "tools/image-only",
        modelName: "Seedream 5",
        output: "image" as const,
        serviceId: "xiaoyunque",
        serviceName: "小云雀",
        title: "Image only",
      },
    ]),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          generation={request.generation!}
          onOpenServices={onOpenServices}
          request={request}
          service={service}
        />,
      )
      await settle()
    })

    const model = document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')
    expect(model?.textContent).toContain("小云雀 · Seedream 5")
    expect(document.body.textContent).not.toContain("当前模型不支持以下 @ 输入")
    expect(document.body.textContent).not.toContain("Auto")
    expect(document.body.textContent).not.toContain("自动")
    const token = document
      .querySelector('button[aria-label="Remove Canvas reference: Scene notes"]')
      ?.closest("[data-agent-composer-token]")
    expect(token?.className).not.toContain("border-amber-500/35 bg-amber-500/10")
    const generate = document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')
    expect(generate?.disabled).toBeFalse()
    const openServices = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "前往 Services",
    )
    expect(openServices).toBeUndefined()
    expect(onOpenServices).not.toHaveBeenCalled()

    await act(async () => {
      generate?.click()
      await settle()
    })
    expect(submitted?.toolId).toBe("tools/image-only")
    expect(submitted?.prompt).toBe("")
    expect(submitted?.promptContextNodeIds).toEqual([notes.id])
    expect(submitted?.references).toEqual([])
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("keeps models visible but blocks a genuinely incompatible media @ input", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const clip = createMediaNode({
    id: "clip",
    label: "Source clip",
    position: { x: -320, y: 0 },
    resource: {
      id: "clip-resource",
      kind: "video",
      metadata: {},
      state: { status: "ready", url: "asset://clip" },
    },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({
      edges: [{ id: "clip-edge", source: clip.id, target: owner.id }],
      id: "canvas",
      nodes: [owner, clip],
    }),
    generation: { initialPrompt: "Create an image", output: "image" },
    mentionedNodeIds: [clip.id],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async (generationRequest) => ({
      createdNodeIds: [],
      toolId: generationRequest.toolId!,
      warnings: [],
    })),
    listTools: mock(async () => [
      {
        acceptedInputs: ["reference_image"] as const,
        description: "Image references only",
        id: "tools/image-only",
        output: "image" as const,
        title: "Image only",
      },
    ]),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
      await settle()
    })

    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain("Image only")
    expect(document.body.textContent).toContain("当前模型不支持以下 @ 输入：Source clip")
    const token = document
      .querySelector('button[aria-label="Remove Canvas reference: Source clip"]')
      ?.closest("[data-agent-composer-token]")
    expect(token?.className).toContain("border-amber-500/35 bg-amber-500/10")
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')?.disabled).toBeTrue()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("blocks an oversized mix of prompt context and media inputs before IPC", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: { id: "owner-resource", kind: "image", metadata: {}, state: { status: "ready", url: "" } },
  })
  const contexts = Array.from({ length: 16 }, (_, index) =>
    createTextNode({
      id: `context-${index}`,
      metadata: {},
      position: { x: -640, y: index * 20 },
      resourceState: { status: "ready", text: `Context ${index}` },
    }),
  )
  const clips = Array.from({ length: 17 }, (_, index) =>
    createMediaNode({
      id: `clip-${index}`,
      position: { x: -320, y: index * 20 },
      resource: {
        id: `clip-resource-${index}`,
        kind: "video",
        metadata: {},
        state: { status: "ready", url: `asset://clip-${index}` },
      },
    }),
  )
  const inputs = [...contexts, ...clips]
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({
      edges: inputs.map((node, index) => ({ id: `input-${index}`, source: node.id, target: owner.id })),
      id: "canvas",
      nodes: [owner, ...inputs],
    }),
    generation: { initialPrompt: "Create an image", output: "image" },
    mentionedNodeIds: inputs.map((node) => node.id),
    mode: "file",
    ownerNodeId: owner.id,
  }
  const generate = mock(async () => ({ createdNodeIds: [], toolId: "tools/image", warnings: [] }))
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate,
    listTools: mock(async () => [
      {
        acceptedInputs: ["reference_video"] as const,
        description: "Video conditioned image",
        id: "tools/image",
        output: "image" as const,
        title: "Image model",
      },
    ]),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<CanvasCardGenerationPanel generation={request.generation!} request={request} service={service} />)
      await settle()
    })
    expect(document.body.textContent).toContain("Choose at most 32 generation inputs.")
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "Image model",
    )
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')?.disabled).toBeTrue()
    expect(generate).not.toHaveBeenCalled()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("opens Services when the card output has no available model", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  const onOpenServices = mock(() => undefined)
  let root: Root | undefined
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: {
      id: "owner-resource",
      kind: "image",
      metadata: {},
      name: "Output",
      state: { status: "ready", url: "asset://output" },
    },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({ id: "canvas", nodes: [owner] }),
    generation: { output: "image" },
    mentionedNodeIds: [],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async () => ({ createdNodeIds: [], toolId: "unused", warnings: [] })),
    listTools: mock(async () => []),
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          generation={request.generation!}
          onOpenServices={onOpenServices}
          request={request}
          service={service}
        />,
      )
      await settle()
    })

    expect(document.body.textContent).toContain("没有可用的生成服务或模型")
    expect(document.querySelector('button[aria-label="Model"]')).toBeNull()
    const openServices = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "前往 Services",
    )
    expect(openServices).toBeDefined()
    await act(async () => openServices?.click())
    expect(onOpenServices).toHaveBeenCalledTimes(1)
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("reloads an open card when a service becomes available or disconnects", async () => {
  const { CanvasCardGenerationPanel, restoreWindow } = await installTestWindow()
  let root: Root | undefined
  let catalogReady = false
  const owner = createMediaNode({
    id: "owner",
    position: { x: 0, y: 0 },
    resource: { id: "owner-resource", kind: "image", metadata: {}, state: { status: "ready", url: "" } },
  })
  const request: CanvasAssistantRequest = {
    document: createCanvasDocument({ id: "canvas", nodes: [owner] }),
    generation: { output: "image" },
    mentionedNodeIds: [],
    mode: "file",
    ownerNodeId: owner.id,
  }
  const listTools = mock(async () =>
    catalogReady
      ? [
          {
            acceptedInputs: [] as const,
            description: "Installed after authorization",
            id: "tools/new-image",
            modelName: "Seedream 5",
            output: "image" as const,
            serviceId: "xiaoyunque",
            serviceName: "小云雀",
            title: "Image model",
          },
        ]
      : [],
  )
  const service: CanvasGenerateService = {
    describeTool: mock(async (toolId) => ({ fields: [], toolId })),
    generate: mock(async () => ({ createdNodeIds: [], toolId: "unused", warnings: [] })),
    listTools,
  }

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          catalogVersion={0}
          generation={request.generation!}
          request={request}
          service={service}
        />,
      )
      await settle()
    })
    expect(document.body.textContent).toContain("没有可用的生成服务或模型")

    catalogReady = true
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          catalogVersion={1}
          generation={request.generation!}
          request={request}
          service={service}
        />,
      )
      await settle()
    })
    expect(listTools).toHaveBeenCalledTimes(2)
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.textContent).toContain(
      "小云雀 · Seedream 5",
    )
    expect(document.body.textContent).not.toContain("没有可用的生成服务或模型")

    catalogReady = false
    await act(async () => {
      root?.render(
        <CanvasCardGenerationPanel
          catalogVersion={2}
          generation={request.generation!}
          request={request}
          service={service}
        />,
      )
      await settle()
    })
    expect(listTools).toHaveBeenCalledTimes(3)
    expect(document.querySelector('button[aria-label="Model"]')).toBeNull()
    expect(document.body.textContent).toContain("没有可用的生成服务或模型")
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
