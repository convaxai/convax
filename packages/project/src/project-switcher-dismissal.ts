export function bindProjectSwitcherDismissal(input: {
  document: Document
  onDismiss: () => void
  onEscape: () => void
  switcher: Node
  trigger: Node
  window: Window | null
}) {
  const isInsideSwitcher = (target: EventTarget | null) => {
    const targetNode = target as Node | null
    return targetNode !== null
      && typeof targetNode.nodeType === "number"
      && (input.switcher.contains(targetNode) || input.trigger.contains(targetNode))
  }
  const dismissOnOutsideInteraction = (event: Event) => {
    if (!isInsideSwitcher(event.target)) input.onDismiss()
  }
  const dismissOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") input.onEscape()
  }

  input.document.addEventListener("pointerdown", dismissOnOutsideInteraction, true)
  input.document.addEventListener("focusin", dismissOnOutsideInteraction, true)
  input.document.addEventListener("keydown", dismissOnEscape, true)
  input.window?.addEventListener("blur", input.onDismiss)

  return () => {
    input.document.removeEventListener("pointerdown", dismissOnOutsideInteraction, true)
    input.document.removeEventListener("focusin", dismissOnOutsideInteraction, true)
    input.document.removeEventListener("keydown", dismissOnEscape, true)
    input.window?.removeEventListener("blur", input.onDismiss)
  }
}
