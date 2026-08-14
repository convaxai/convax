import { expect, mock, test } from "bun:test"
import { Window as HappyWindow } from "happy-dom"

import { ScopedShortcutService, type ShortcutChord } from "./scoped-shortcut-service"

type HappyDomWindow = InstanceType<typeof HappyWindow>
type HappyDomEventTarget = Pick<HappyDomWindow["document"]["body"], "dispatchEvent">

function setup() {
  const window = new HappyWindow()
  const document = window.document
  const previousElement = globalThis.Element
  Object.defineProperty(globalThis, "Element", { configurable: true, value: window.Element, writable: true })
  const service = new ScopedShortcutService({
    document: document as unknown as Document,
    window: window as unknown as globalThis.Window,
  })
  const cleanup = () => {
    service.dispose()
    Object.defineProperty(globalThis, "Element", { configurable: true, value: previousElement, writable: true })
    window.close()
  }
  return { cleanup, document, service, window }
}

function press(
  window: HappyDomWindow,
  target: HappyDomEventTarget,
  chord: ShortcutChord,
  options: { repeat?: boolean } = {},
) {
  const event = new window.KeyboardEvent("keydown", {
    altKey: chord.alt,
    bubbles: true,
    cancelable: true,
    ctrlKey: chord.ctrl,
    key: chord.key,
    metaKey: chord.meta,
    repeat: options.repeat,
    shiftKey: chord.shift,
  })
  target.dispatchEvent(event)
  return event
}

test("routes the same chord to the deepest focused scope and keeps application shortcuts as fallback", async () => {
  const { cleanup, document, service, window } = setup()
  const app = document.createElement("main")
  const workspace = document.createElement("section")
  const canvas = document.createElement("div")
  const conversation = document.createElement("aside")
  const appButton = document.createElement("button")
  const workspaceButton = document.createElement("button")
  const canvasButton = document.createElement("button")
  const conversationButton = document.createElement("button")
  canvas.append(canvasButton)
  conversation.append(conversationButton)
  workspace.append(workspaceButton, canvas, conversation)
  app.append(appButton, workspace)
  document.body.append(app)

  service.registerScope({ element: app as unknown as HTMLElement, id: "application", kind: "application" })
  service.registerScope({ element: workspace as unknown as HTMLElement, id: "workspace" })
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  service.registerScope({ element: conversation as unknown as HTMLElement, id: "conversation" })
  const application = mock(() => undefined)
  const workspaceAction = mock(() => undefined)
  const canvasAction = mock(() => undefined)
  const conversationAction = mock(() => undefined)
  const chord = [{ key: "k", meta: true }] as const
  service.registerFeature({
    allowInEditable: true,
    chords: chord,
    id: "app.commands",
    onTrigger: application,
    scopeId: "application",
  })
  service.registerFeature({ chords: chord, id: "workspace.commands", onTrigger: workspaceAction, scopeId: "workspace" })
  service.registerFeature({ chords: chord, id: "canvas.commands", onTrigger: canvasAction, scopeId: "canvas" })
  service.registerFeature({
    chords: chord,
    id: "conversation.commands",
    onTrigger: conversationAction,
    scopeId: "conversation",
  })

  canvasButton.focus()
  await Promise.resolve()
  press(window, canvasButton, chord[0])
  conversationButton.focus()
  await Promise.resolve()
  press(window, conversationButton, chord[0])
  workspaceButton.focus()
  await Promise.resolve()
  press(window, workspaceButton, chord[0])
  appButton.focus()
  await Promise.resolve()
  press(window, appButton, chord[0])

  expect(canvasAction).toHaveBeenCalledTimes(1)
  expect(conversationAction).toHaveBeenCalledTimes(1)
  expect(workspaceAction).toHaveBeenCalledTimes(1)
  expect(application).toHaveBeenCalledTimes(1)
  cleanup()
})

test("selects one deterministic winner for conflicting features and falls back after disposal", async () => {
  const { cleanup, document, service, window } = setup()
  const scope = document.createElement("div")
  const target = document.createElement("button")
  scope.append(target)
  document.body.append(scope)
  service.registerScope({ element: scope as unknown as HTMLElement, id: "canvas" })
  const first = mock(() => undefined)
  const second = mock(() => undefined)
  const highPriority = mock(() => undefined)
  const chord = [{ key: "f", meta: true }] as const
  const firstHandle = service.registerFeature({ chords: chord, id: "first", onTrigger: first, scopeId: "canvas" })
  service.registerFeature({ chords: chord, id: "second", onTrigger: second, scopeId: "canvas" })
  const highHandle = service.registerFeature({
    chords: chord,
    id: "high",
    onTrigger: highPriority,
    priority: 10,
    scopeId: "canvas",
  })
  target.focus()
  await Promise.resolve()

  press(window, target, chord[0])
  highHandle.dispose()
  press(window, target, chord[0])
  firstHandle.dispose()
  press(window, target, chord[0])

  expect(highPriority).toHaveBeenCalledTimes(1)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  cleanup()
})

test("releases held shortcuts on keyup, focus scope change, blur, visibility loss, and disposal", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const canvasButton = document.createElement("button")
  const conversation = document.createElement("div")
  const conversationButton = document.createElement("button")
  canvas.append(canvasButton)
  conversation.append(conversationButton)
  document.body.append(canvas, conversation)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  service.registerScope({ element: conversation as unknown as HTMLElement, id: "conversation" })
  const trigger = mock(() => undefined)
  const release = mock(() => undefined)
  const handle = service.registerFeature({
    chords: [
      { key: "Meta", meta: true, shift: true },
      { key: "Shift", meta: true, shift: true },
    ],
    id: "canvas.drag-out",
    onRelease: release,
    onTrigger: trigger,
    scopeId: "canvas",
    trigger: "hold",
  })
  canvasButton.focus()
  await Promise.resolve()

  press(window, canvasButton, { key: "Shift", meta: true, shift: true })
  window.dispatchEvent(new window.KeyboardEvent("keyup", { key: "Shift", metaKey: true, shiftKey: false }))
  press(window, canvasButton, { key: "Shift", meta: true, shift: true })
  conversationButton.focus()
  await Promise.resolve()
  canvasButton.focus()
  await Promise.resolve()
  press(window, canvasButton, { key: "Meta", meta: true, shift: true })
  window.dispatchEvent(new window.Event("blur"))
  canvasButton.focus()
  await Promise.resolve()
  press(window, canvasButton, { key: "Meta", meta: true, shift: true })
  Object.defineProperty(document, "hidden", { configurable: true, value: true })
  document.dispatchEvent(new window.Event("visibilitychange"))
  Object.defineProperty(document, "hidden", { configurable: true, value: false })
  canvasButton.focus()
  await Promise.resolve()
  press(window, canvasButton, { key: "Meta", meta: true, shift: true })
  handle.dispose()

  expect(trigger).toHaveBeenCalledTimes(5)
  expect(release).toHaveBeenCalledTimes(5)
  cleanup()
})

test("observes a held native-drag chord without consuming its modifier event", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const target = document.createElement("button")
  canvas.append(target)
  document.body.append(canvas)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  const trigger = mock(() => undefined)
  const release = mock(() => undefined)
  const bubbled = mock(() => undefined)
  document.body.addEventListener("keydown", bubbled)
  service.registerFeature({
    chords: [
      { key: "Meta", meta: true, shift: true },
      { key: "Shift", meta: true, shift: true },
    ],
    consume: false,
    id: "canvas.drag-out",
    onRelease: release,
    onTrigger: trigger,
    scopeId: "canvas",
    trigger: "hold",
  })
  target.focus()
  await Promise.resolve()

  const event = press(window, target, { key: "Shift", meta: true, shift: true })
  window.dispatchEvent(new window.KeyboardEvent("keyup", { key: "Shift", metaKey: true, shiftKey: false }))

  expect(event.defaultPrevented).toBeFalse()
  expect(bubbled).toHaveBeenCalledTimes(1)
  expect(trigger).toHaveBeenCalledTimes(1)
  expect(release).toHaveBeenCalledTimes(1)
  cleanup()
})

test("does not release a held shortcut for descendant blur inside the same focus scope", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const first = document.createElement("button")
  const second = document.createElement("button")
  canvas.append(first, second)
  document.body.append(canvas)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  const release = mock(() => undefined)
  service.registerFeature({
    chords: [{ key: "Shift", meta: true, shift: true }],
    consume: false,
    id: "canvas.drag-out",
    onRelease: release,
    onTrigger: () => undefined,
    scopeId: "canvas",
    trigger: "hold",
  })
  first.focus()
  await Promise.resolve()
  press(window, first, { key: "Shift", meta: true, shift: true })

  second.focus()
  await Promise.resolve()
  expect(release).not.toHaveBeenCalled()

  window.dispatchEvent(new window.Event("blur"))
  expect(release).toHaveBeenCalledTimes(1)
  cleanup()
})

test("keeps a held shortcut across a transient body focus gap but releases a sustained exit", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const first = document.createElement("button")
  const second = document.createElement("button")
  canvas.append(first, second)
  document.body.append(canvas)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  const release = mock(() => undefined)
  service.registerFeature({
    chords: [{ key: "Shift", meta: true, shift: true }],
    consume: false,
    id: "canvas.drag-out",
    onRelease: release,
    onTrigger: () => undefined,
    scopeId: "canvas",
    trigger: "hold",
  })
  first.focus()
  await Promise.resolve()
  press(window, first, { key: "Shift", meta: true, shift: true })

  first.blur()
  expect(document.activeElement).toBe(document.body)
  window.queueMicrotask(() => second.focus())
  await Promise.resolve()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  expect(release).not.toHaveBeenCalled()

  second.blur()
  expect(document.activeElement).toBe(document.body)
  await Promise.resolve()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  expect(release).toHaveBeenCalledTimes(1)
  cleanup()
})

test("restarts a held feature from a fresh keydown when the operating system swallowed keyup", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const target = document.createElement("button")
  canvas.append(target)
  document.body.append(canvas)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  const trigger = mock(() => undefined)
  const release = mock(() => undefined)
  service.registerFeature({
    chords: [
      { key: "Meta", meta: true, shift: true },
      { key: "Shift", meta: true, shift: true },
    ],
    consume: false,
    id: "canvas.drag-out",
    onRelease: release,
    onTrigger: trigger,
    scopeId: "canvas",
    trigger: "hold",
  })
  target.focus()
  await Promise.resolve()

  press(window, target, { key: "Shift", meta: true, shift: true })
  press(window, target, { key: "Shift", meta: true, shift: true })
  press(window, target, { key: "Shift", meta: true, shift: true }, { repeat: true })

  expect(trigger).toHaveBeenCalledTimes(2)
  expect(release).toHaveBeenCalledTimes(1)
  cleanup()
})

test("does not leak a focus scope shortcut into editable descendants without an explicit opt-in", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const input = document.createElement("input")
  canvas.append(input)
  document.body.append(canvas)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  const blocked = mock(() => undefined)
  const allowed = mock(() => undefined)
  service.registerFeature({
    chords: [{ key: "z", meta: true }],
    id: "canvas.undo",
    onTrigger: blocked,
    scopeId: "canvas",
  })
  service.registerFeature({
    allowInEditable: true,
    chords: [{ key: "k", meta: true }],
    id: "canvas.palette",
    onTrigger: allowed,
    scopeId: "canvas",
  })
  input.focus()
  await Promise.resolve()

  press(window, input, { key: "z", meta: true })
  press(window, input, { key: "k", meta: true })

  expect(blocked).not.toHaveBeenCalled()
  expect(allowed).toHaveBeenCalledTimes(1)
  cleanup()
})
