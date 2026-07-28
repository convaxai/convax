import { expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { Component, type ErrorInfo, type ReactNode, act, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"

function Passthrough(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

mock.module("@convax/ui", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Tooltip: Passthrough,
  cn: (...values: unknown[]) => values.filter((value) => typeof value === "string").join(" "),
}))

mock.module("@xyflow/react", () => ({
  Handle: Passthrough,
  NodeResizer: () => null,
  NodeToolbar: Passthrough,
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
}))

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    DOMRect: testWindow.DOMRect,
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    MutationObserver: testWindow.MutationObserver,
    Node: testWindow.Node,
    ResizeObserver: testWindow.ResizeObserver,
    document: testWindow.document,
    getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
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
    return this.state.error ? <div data-testid="error">Text editor failed</div> : this.props.children
  }
}

test("mounting the expanded text editor does not feed BubbleMenu option updates back into editor transactions", async () => {
  const restoreWindow = installTestWindow()
  const errors: Error[] = []
  let optionUpdateTransactions = 0
  let root: Root | undefined

  try {
    const [{ ExpandedTextEditorDialog }, { useEditor }, { default: StarterKit }] = await Promise.all([
      import("./builtin-node"),
      import("@tiptap/react"),
      import("@tiptap/starter-kit"),
    ])
    function ExpandedTextEditorHarness() {
      const [rerenderCount, setRerenderCount] = useState(0)
      const editor = useEditor({
        content: "<p>Stable expanded editor</p>",
        extensions: [StarterKit],
        shouldRerenderOnTransaction: true,
      })
      useEffect(() => {
        if (!editor) return
        const countBubbleMenuOptionUpdate = ({
          transaction,
        }: import("@tiptap/core").EditorEvents["transaction"]) => {
          if (transaction.getMeta("convaxTextInlineMenu")?.type === "updateOptions") {
            optionUpdateTransactions += 1
          }
        }
        editor.on("transaction", countBubbleMenuOptionUpdate)
        setRerenderCount(1)
        return () => {
          editor.off("transaction", countBubbleMenuOptionUpdate)
        }
      }, [editor])
      useEffect(() => {
        if (rerenderCount > 0 && rerenderCount < 3) {
          setRerenderCount((count) => count + 1)
        }
      }, [rerenderCount])
      return <ExpandedTextEditorDialog editor={editor} label="Stable expanded editor" onClose={() => {}} />
    }
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => errors.push(error instanceof Error ? error : new Error(String(error))),
    })

    await act(async () => {
      root?.render(
        <TestErrorBoundary onError={(error) => errors.push(error)}>
          <ExpandedTextEditorHarness />
        </TestErrorBoundary>,
      )
    })

    expect(errors).toEqual([])
    expect(optionUpdateTransactions).toBe(0)
    expect(document.querySelector('[data-testid="error"]')).toBeNull()
  } finally {
    if (root) await act(async () => root?.unmount())
    await restoreWindow()
  }
})
