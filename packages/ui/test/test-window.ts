import { Window } from "happy-dom"

export function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    FocusEvent: testWindow.FocusEvent,
    HTMLElement: testWindow.HTMLElement,
    HTMLIFrameElement: testWindow.HTMLIFrameElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    MouseEvent: testWindow.MouseEvent,
    MutationObserver: testWindow.MutationObserver,
    Node: testWindow.Node,
    PointerEvent: testWindow.PointerEvent,
    cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
    document: testWindow.document,
    getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
    navigator: testWindow.navigator,
    requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
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

  return {
    async restore() {
      await testWindow.happyDOM.close()
      for (const [name, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}
