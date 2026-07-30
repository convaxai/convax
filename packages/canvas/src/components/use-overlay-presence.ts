import { useEffect, useState } from "react"

export type CanvasOverlayPresencePhase = "enter" | "exit"

export function useCanvasOverlayPresence(open: boolean, exitDuration = 200) {
  const [present, setPresent] = useState(open)
  const [phase, setPhase] = useState<CanvasOverlayPresencePhase>("enter")

  useEffect(() => {
    if (open) {
      setPresent(true)
      setPhase("enter")
      return
    }
    if (!present) return

    setPhase("exit")
    const timeout = window.setTimeout(() => setPresent(false), exitDuration)
    return () => window.clearTimeout(timeout)
  }, [exitDuration, open, present])

  return { phase, present }
}
