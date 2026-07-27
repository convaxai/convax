export function bindCanvasSearchDismissal(input: {
  document: Document
  onDismiss: () => void
  panel: Element
  window: Window
}) {
  const closeOnOutsidePointerDown = (event: PointerEvent) => {
    if (event.target && input.panel.contains(event.target as Node)) return
    event.preventDefault()
    event.stopPropagation()
    input.onDismiss()
  }
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") input.onDismiss()
  }

  input.document.addEventListener("pointerdown", closeOnOutsidePointerDown, true)
  input.window.addEventListener("keydown", closeOnEscape)

  return () => {
    input.document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true)
    input.window.removeEventListener("keydown", closeOnEscape)
  }
}
