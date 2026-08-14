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
    code: chord.code,
    key: chord.key ?? "",
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
    kind: "command",
    onTrigger: application,
    scopeId: "application",
  })
  service.registerFeature({
    chords: chord,
    id: "workspace.commands",
    kind: "command",
    onTrigger: workspaceAction,
    scopeId: "workspace",
  })
  service.registerFeature({
    chords: chord,
    id: "canvas.commands",
    kind: "command",
    onTrigger: canvasAction,
    scopeId: "canvas",
  })
  service.registerFeature({
    chords: chord,
    id: "conversation.commands",
    kind: "command",
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
  const firstHandle = service.registerFeature({
    chords: chord,
    id: "first",
    kind: "command",
    onTrigger: first,
    scopeId: "canvas",
  })
  service.registerFeature({
    chords: chord,
    id: "second",
    kind: "command",
    onTrigger: second,
    scopeId: "canvas",
  })
  const highHandle = service.registerFeature({
    chords: chord,
    id: "high",
    kind: "command",
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

test("CommandShortcut contract consumes one keydown and invokes one command", async () => {
  const { cleanup, document, service, window } = setup()
  const scope = document.createElement("div")
  const target = document.createElement("button")
  scope.append(target)
  document.body.append(scope)
  service.registerScope({ element: scope as unknown as HTMLElement, id: "canvas" })
  const trigger = mock(() => undefined)
  const bubbled = mock(() => undefined)
  document.body.addEventListener("keydown", bubbled)
  service.registerFeature({
    chords: [{ key: "d", meta: true }],
    id: "canvas.duplicate",
    kind: "command",
    onTrigger: trigger,
    scopeId: "canvas",
  })
  target.focus()
  await Promise.resolve()

  const event = press(window, target, { key: "d", meta: true })

  expect(event.defaultPrevented).toBeTrue()
  expect(bubbled).not.toHaveBeenCalled()
  expect(trigger).toHaveBeenCalledTimes(1)
  cleanup()
})

test("HoldShortcut contract consumes keydown and owns held-state release", async () => {
  const { cleanup, document, service, window } = setup()
  const scope = document.createElement("div")
  const target = document.createElement("button")
  scope.append(target)
  document.body.append(scope)
  service.registerScope({ element: scope as unknown as HTMLElement, id: "canvas" })
  const hold = mock(() => undefined)
  const release = mock(() => undefined)
  const bubbled = mock(() => undefined)
  document.body.addEventListener("keydown", bubbled)
  service.registerFeature({
    chords: [{ code: "Space" }],
    id: "canvas.space-pan",
    kind: "hold",
    onHold: hold,
    onRelease: release,
    scopeId: "canvas",
  })
  target.focus()
  await Promise.resolve()

  const event = press(window, target, { code: "Space" })
  window.dispatchEvent(new window.KeyboardEvent("keyup", { code: "Space", key: " " }))

  expect(event.defaultPrevented).toBeTrue()
  expect(bubbled).not.toHaveBeenCalled()
  expect(hold).toHaveBeenCalledTimes(1)
  expect(release).toHaveBeenCalledTimes(1)
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
    kind: "gesture-modifier",
    onActivate: trigger,
    onRelease: release,
    scopeId: "canvas",
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

test("GestureModifier contract observes and releases without consuming the native event", async () => {
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
    id: "canvas.drag-out",
    kind: "gesture-modifier",
    onActivate: trigger,
    onRelease: release,
    scopeId: "canvas",
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
    id: "canvas.drag-out",
    kind: "gesture-modifier",
    onActivate: () => undefined,
    onRelease: release,
    scopeId: "canvas",
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
    id: "canvas.drag-out",
    kind: "gesture-modifier",
    onActivate: () => undefined,
    onRelease: release,
    scopeId: "canvas",
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
    id: "canvas.drag-out",
    kind: "gesture-modifier",
    onActivate: trigger,
    onRelease: release,
    scopeId: "canvas",
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
    kind: "command",
    onTrigger: blocked,
    scopeId: "canvas",
  })
  service.registerFeature({
    allowInEditable: true,
    chords: [{ key: "k", meta: true }],
    id: "canvas.palette",
    kind: "command",
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

test("routes matching descendants to the highest-priority logical scope on the same root", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const editor = document.createElement("div")
  editor.contentEditable = "plaintext-only"
  editor.dataset.canvasShortcuts = "ignore"
  canvas.append(editor)
  document.body.append(canvas)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  service.registerScope({
    element: canvas as unknown as HTMLElement,
    id: "interaction",
    matchesTarget: (target) => Boolean(target.closest("[data-canvas-shortcuts='ignore']")),
    priority: 100,
  })
  service.registerScope({
    element: canvas as unknown as HTMLElement,
    id: "node-input",
    matchesTarget: (target) => Boolean(target.closest("[contenteditable]")),
    priority: 200,
  })
  const canvasAction = mock(() => undefined)
  const interactionAction = mock(() => undefined)
  const nodeInputAction = mock(() => undefined)
  for (const [id, onTrigger] of [
    ["canvas", canvasAction],
    ["interaction", interactionAction],
    ["node-input", nodeInputAction],
  ] as const) {
    service.registerFeature({
      allowInEditable: true,
      chords: [{ key: "k", meta: true }],
      id,
      kind: "command",
      onTrigger,
      scopeId: id,
    })
  }

  editor.focus()
  await Promise.resolve()
  press(window, editor, { key: "k", meta: true })

  expect(nodeInputAction).toHaveBeenCalledTimes(1)
  expect(interactionAction).not.toHaveBeenCalled()
  expect(canvasAction).not.toHaveBeenCalled()
  cleanup()
})

test("keeps application fallback in body portals without treating body itself as stable focus", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const canvasButton = document.createElement("button")
  const portalButton = document.createElement("button")
  canvas.append(canvasButton)
  document.body.append(canvas, portalButton)
  service.registerScope({ element: document.body as unknown as HTMLElement, id: "application", kind: "application" })
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  const application = mock(() => undefined)
  const release = mock(() => undefined)
  service.registerFeature({
    allowInEditable: true,
    chords: [{ key: "k", meta: true }],
    id: "commands",
    kind: "command",
    onTrigger: application,
    scopeId: "application",
  })
  service.registerFeature({
    chords: [{ key: "Shift", meta: true, shift: true }],
    id: "drag",
    kind: "gesture-modifier",
    onActivate: () => undefined,
    onRelease: release,
    scopeId: "canvas",
  })

  portalButton.focus()
  await Promise.resolve()
  press(window, portalButton, { key: "k", meta: true })
  expect(application).toHaveBeenCalledTimes(1)

  canvasButton.focus()
  await Promise.resolve()
  press(window, canvasButton, { key: "Shift", meta: true, shift: true })
  canvasButton.blur()
  await Promise.resolve()
  expect(document.activeElement).toBe(document.body)
  expect(release).not.toHaveBeenCalled()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  expect(release).toHaveBeenCalledTimes(1)
  cleanup()
})

test("releases a code-based hold on its own keyup and clears a hold whose trigger throws", async () => {
  const { cleanup, document, service, window } = setup()
  const canvas = document.createElement("div")
  const target = document.createElement("button")
  canvas.append(target)
  document.body.append(canvas)
  service.registerScope({ element: canvas as unknown as HTMLElement, id: "canvas" })
  const release = mock(() => undefined)
  service.registerFeature({
    chords: [{ code: "Space" }],
    id: "space",
    kind: "hold",
    onHold: () => undefined,
    onRelease: release,
    scopeId: "canvas",
  })
  target.focus()
  await Promise.resolve()
  press(window, target, { code: "Space" })
  window.dispatchEvent(new window.KeyboardEvent("keyup", { code: "Space", key: " " }))
  expect(release).toHaveBeenCalledTimes(1)

  service.registerFeature({
    chords: [{ key: "x" }],
    id: "throwing-hold",
    kind: "hold",
    onHold: () => {
      throw new Error("boom")
    },
    onRelease: release,
    scopeId: "canvas",
  })
  let thrown: unknown
  window.addEventListener("error", (event) => {
    event.preventDefault()
    thrown = (event as unknown as ErrorEvent).error
  })
  press(window, target, { key: "x" })
  expect(thrown).toBeInstanceOf(Error)
  expect((thrown as Error).message).toBe("boom")
  expect(release).toHaveBeenCalledTimes(2)
  cleanup()
})

test("skips a disabled winner and routes the next registered conflict", async () => {
  const { cleanup, document, service, window } = setup()
  const scope = document.createElement("div")
  const target = document.createElement("button")
  scope.append(target)
  document.body.append(scope)
  service.registerScope({ element: scope as unknown as HTMLElement, id: "canvas" })
  const disabled = mock(() => undefined)
  const fallback = mock(() => undefined)
  service.registerFeature({
    chords: [{ key: "d", meta: true }],
    id: "disabled",
    isEnabled: () => false,
    kind: "command",
    onTrigger: disabled,
    priority: 10,
    scopeId: "canvas",
  })
  service.registerFeature({
    chords: [{ key: "d", meta: true }],
    id: "fallback",
    kind: "command",
    onTrigger: fallback,
    scopeId: "canvas",
  })
  target.focus()
  await Promise.resolve()

  press(window, target, { key: "d", meta: true })

  expect(disabled).not.toHaveBeenCalled()
  expect(fallback).toHaveBeenCalledTimes(1)
  cleanup()
})
