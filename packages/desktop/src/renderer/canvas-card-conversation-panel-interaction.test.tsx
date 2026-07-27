import {
  createCanvasDocument,
  createMediaNode,
  createTextNode,
  type CanvasAssistantRequest,
  type CanvasGenerateRequest,
  type CanvasGenerateService,
} from "@convax/canvas"
import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { CanvasCardGenerationPanel } from "./canvas-card-conversation-panel"

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

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test("removes a default generation @ input from the submitted references", async () => {
  const restoreWindow = installTestWindow()
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
      revision: 3,
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
      return { createdNodeIds: [], revision: 4, toolId: generationRequest.toolId!, warnings: [] }
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
        revision: 4,
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

test("shows the first real compatible model without writing a node override", async () => {
  const restoreWindow = installTestWindow()
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
      revision: 1,
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

test("uses a text @ input as prompt context without requiring model reference support", async () => {
  const restoreWindow = installTestWindow()
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
        revision: 1,
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
  const restoreWindow = installTestWindow()
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
      revision: 1,
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
  const restoreWindow = installTestWindow()
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
  const generate = mock(async () => ({ createdNodeIds: [], revision: 1, toolId: "tools/image", warnings: [] }))
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
  const restoreWindow = installTestWindow()
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
    generate: mock(async () => ({ createdNodeIds: [], revision: 1, toolId: "unused", warnings: [] })),
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
  const restoreWindow = installTestWindow()
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
    generate: mock(async () => ({ createdNodeIds: [], revision: 1, toolId: "unused", warnings: [] })),
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
