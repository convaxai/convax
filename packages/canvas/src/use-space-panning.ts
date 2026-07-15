import { useEffect, useState } from "react"

function isInteractiveCanvasTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest(
      "button, a[href], input, textarea, select, audio, video, [contenteditable='true'], [data-canvas-shortcuts='ignore']",
    ))
}

export function useSpacePanning() {
  const [spacePanning, setSpacePanning] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isInteractiveCanvasTarget(event.target)) return
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
