import { useEffect, useState } from "react"

const CANVAS_INTERACTIVE_TARGET_SELECTOR =
  "button, a[href], input, textarea, select, audio, video, [contenteditable='true'], [data-canvas-shortcuts='ignore']"

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

export function useSpacePanning() {
  const [spacePanning, setSpacePanning] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isCanvasSpacePanningShortcut(event)) {
        setSpacePanning(false)
        return
      }
      event.preventDefault()
      setSpacePanning(true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      setSpacePanning(false)
    }
    const stopSpacePanning = () => setSpacePanning(false)
    const handleVisibilityChange = () => {
      if (document.hidden) stopSpacePanning()
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", stopSpacePanning)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", stopSpacePanning)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return spacePanning
}
