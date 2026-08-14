const CANVAS_INTERACTIVE_TARGET_SELECTOR =
  "button, a[href], input, textarea, select, audio, video, [contenteditable]:not([contenteditable='false']), [data-canvas-shortcuts='ignore']"

export function isCanvasSpacePanningShortcut(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "repeat" | "shiftKey" | "target">,
) {
  if (
    event.code !== "Space" ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    typeof HTMLElement === "undefined" ||
    !(event.target instanceof HTMLElement)
  ) {
    return false
  }
  return Boolean(event.target.closest(".convax-canvas")) && !event.target.closest(CANVAS_INTERACTIVE_TARGET_SELECTOR)
}
