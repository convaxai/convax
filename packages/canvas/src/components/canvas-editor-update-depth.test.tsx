import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  act,
  createRef,
  useLayoutEffect,
  useRef,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import type { CanvasEditorController } from "../editor-context"
import type { CanvasEditorHandle } from "./canvas-editor"

let EditorProbe: ComponentType | undefined
let feedbackCommits = 0
let observedEditor: CanvasEditorController | undefined

function Passthrough(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

mock.module("@convax/ui", () => ({
  Button: (props: { children?: ReactNode }) => <button>{props.children}</button>,
  ContextMenu: Passthrough,
  ContextMenuContent: Passthrough,
  ContextMenuItem: Passthrough,
  ContextMenuLabel: Passthrough,
  ContextMenuSeparator: () => null,
  ContextMenuTrigger: Passthrough,
  Input: () => <input />,
  Select: Passthrough,
  SelectContent: Passthrough,
  SelectItem: Passthrough,
  SelectTrigger: Passthrough,
  SelectValue: Passthrough,
  Shortcut: Passthrough,
  Tooltip: Passthrough,
  TooltipProvider: Passthrough,
  cn: (...values: unknown[]) => values.filter((value) => typeof value === "string").join(" "),
}))

mock.module("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  BaseEdge: () => null,
  EdgeLabelRenderer: Passthrough,
  Handle: () => null,
  MiniMap: () => null,
  NodeResizer: () => null,
  NodeToolbar: Passthrough,
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  ReactFlow: (props: { children?: ReactNode }) => (
    <>
      {props.children}
      {EditorProbe ? <EditorProbe /> : null}
    </>
  ),
  ReactFlowProvider: Passthrough,
  SelectionMode: { Partial: "partial" },
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
  useInternalNode: () => undefined,
  useReactFlow: () => ({
    fitView: async () => undefined,
    getNodes: () => [],
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    setCenter: async () => undefined,
    setViewport: async () => undefined,
    zoomIn: async () => undefined,
    zoomOut: async () => undefined,
    zoomTo: async () => undefined,
  }),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

const { createCanvasDocument } = await import("../document")
const { useCanvasEditor } = await import("../editor-context")
const { createCanvasServices } = await import("../services")
const { CanvasEditor } = await import("./canvas-editor")

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

class TestErrorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { error: Error | null }
> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
  }

  render() {
    return this.state.error ? <div data-testid="error">Canvas failed</div> : this.props.children
  }
}

/** Mimics a layout subscriber that commits when the provider refreshes without a semantic state change. */
function IdentityFeedbackProbe() {
  const editor = useCanvasEditor()
  const previousRef = useRef<CanvasEditorController | undefined>(undefined)

  useLayoutEffect(() => {
    const previous = previousRef.current
    previousRef.current = editor
    if (
      previous &&
      previous !== editor &&
      previous.document === editor.document &&
      previous.selection === editor.selection &&
      previous.readOnly === editor.readOnly &&
      previous.hydrating === editor.hydrating
    ) {
      feedbackCommits += 1
      editor.commit((document) => ({
        ...document,
        metadata: { ...document.metadata, title: `${document.metadata.title}.` },
      }))
    }
  }, [editor])

  return null
}

function EditorStateProbe() {
  observedEditor = useCanvasEditor()
  return null
}

test("does not feed a selection-action refresh back into Canvas document updates", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = IdentityFeedbackProbe
  feedbackCommits = 0

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const initialDocument = createCanvasDocument({ title: "Stable" })

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor initialDocument={initialDocument} services={createCanvasServices()} />
        </TestErrorBoundary>,
      )
    })

    expect(errors).toEqual([])
    expect(feedbackCommits).toBe(0)
    expect(document.querySelector('[data-testid="error"]')).toBeNull()
  } finally {
    EditorProbe = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})

test("authoritative reload clears a prior load error and resolves after the writable controller renders", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let root: Root | undefined
  EditorProbe = EditorStateProbe
  observedEditor = undefined

  try {
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })
    const initialDocument = createCanvasDocument({ id: "authoritative-retry", title: "Initial" })
    const authoritativeDocument = {
      ...createCanvasDocument({ id: initialDocument.id, title: "Authoritative" }),
      revision: 1,
    }
    const failure = new Error("First authoritative load failed")
    let loadAttempt = 0
    const load = mock(async () => {
      loadAttempt += 1
      if (loadAttempt === 1) return initialDocument
      if (loadAttempt === 2) throw failure
      return authoritativeDocument
    })
    const save = mock(async (document) => document)
    const editorRef = createRef<CanvasEditorHandle>()

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <CanvasEditor
            initialDocument={initialDocument}
            ref={editorRef}
            services={createCanvasServices({ persistence: { load, save } })}
          />
        </TestErrorBoundary>,
      )
    })
    expect(observedEditor).toMatchObject({ hydrating: false, readOnly: false })

    let rejected: unknown
    await act(async () => {
      try {
        await editorRef.current?.reloadAuthoritative()
      } catch (error) {
        rejected = error
      }
    })
    expect(rejected).toBe(failure)
    expect(observedEditor).toMatchObject({ hydrating: false, readOnly: true })
    expect(container.textContent).toContain(failure.message)

    let revisionAtResolution = -1
    let retry: Promise<void> | undefined
    await act(async () => {
      retry = editorRef.current?.reloadAuthoritative()
      await Promise.resolve()
    })
    await retry
    revisionAtResolution = (observedEditor as CanvasEditorController | undefined)?.document.revision ?? -1

    expect(revisionAtResolution).toBe(1)
    expect(observedEditor).toMatchObject({
      document: { metadata: { title: "Authoritative" }, revision: 1 },
      hydrating: false,
      readOnly: false,
    })
    expect(container.textContent).not.toContain(failure.message)
    expect(save).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  } finally {
    EditorProbe = undefined
    observedEditor = undefined
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
