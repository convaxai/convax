import { StrictMode, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import type { PetOverlayClient, PetRendererSnapshot } from "../../pet-contracts"
import { PetView } from "./pet-view"
import "./styles.css"

declare global {
  interface Window {
    convaxPet: PetOverlayClient
  }
}

function PetApplication() {
  const [snapshot, setSnapshot] = useState<PetRendererSnapshot>()
  const [expanded, setExpanded] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)

  useEffect(() => window.convaxPet.onSnapshot(setSnapshot), [])
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  const client = useMemo<PetOverlayClient>(
    () => ({
      drag: (input) => window.convaxPet.drag(input),
      navigate: (input) => window.convaxPet.navigate(input),
      onSnapshot: (listener) => window.convaxPet.onSnapshot(listener),
      setExpanded: async (input) => {
        await window.convaxPet.setExpanded(input)
        setExpanded(input.expanded)
      },
    }),
    [],
  )
  if (!snapshot) return null
  return <PetView client={client} expanded={expanded} reducedMotion={reducedMotion} snapshot={snapshot} />
}

const container = document.getElementById("app")
if (!container) throw new Error("Missing pet renderer root")
createRoot(container).render(
  <StrictMode>
    <PetApplication />
  </StrictMode>,
)
