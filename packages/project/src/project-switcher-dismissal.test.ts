import { describe, expect, mock, test } from "bun:test"
import { bindProjectSwitcherDismissal } from "./project-switcher-dismissal"

class FakeEventSource {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  dispatch(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event)
      else listener.handleEvent(event)
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener)
  }
}

function eventWithTarget(type: string, target: Node, key?: string) {
  return { key, target, type } as unknown as Event
}

function nodeContaining(...targets: Node[]) {
  return {
    contains: (target: Node) => targets.includes(target),
    nodeType: 1,
  } as unknown as Node
}

describe("bindProjectSwitcherDismissal", () => {
  test("dismisses outside pointer, focus, window blur, and Escape interactions", () => {
    const documentSource = new FakeEventSource()
    const windowSource = new FakeEventSource()
    const triggerTarget = nodeContaining()
    const switcherTarget = nodeContaining()
    const trigger = nodeContaining(triggerTarget)
    const switcher = nodeContaining(switcherTarget)
    const outside = nodeContaining()
    const onDismiss = mock(() => undefined)
    const onEscape = mock(() => undefined)
    const unbind = bindProjectSwitcherDismissal({
      document: documentSource as unknown as Document,
      onDismiss,
      onEscape,
      switcher,
      trigger,
      window: windowSource as unknown as Window,
    })

    documentSource.dispatch("pointerdown", eventWithTarget("pointerdown", triggerTarget))
    documentSource.dispatch("focusin", eventWithTarget("focusin", switcherTarget))
    expect(onDismiss).not.toHaveBeenCalled()

    documentSource.dispatch("pointerdown", eventWithTarget("pointerdown", outside))
    documentSource.dispatch("focusin", eventWithTarget("focusin", outside))
    windowSource.dispatch("blur", eventWithTarget("blur", outside))
    documentSource.dispatch("keydown", eventWithTarget("keydown", switcherTarget, "Enter"))
    documentSource.dispatch("keydown", eventWithTarget("keydown", switcherTarget, "Escape"))
    expect(onDismiss).toHaveBeenCalledTimes(3)
    expect(onEscape).toHaveBeenCalledTimes(1)

    unbind()
    documentSource.dispatch("pointerdown", eventWithTarget("pointerdown", outside))
    windowSource.dispatch("blur", eventWithTarget("blur", outside))
    expect(onDismiss).toHaveBeenCalledTimes(3)
  })
})
