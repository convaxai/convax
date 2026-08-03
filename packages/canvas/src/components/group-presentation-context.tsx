import { createContext, type ReactNode, useContext } from "react"
import type { CanvasGroupSummary } from "../group-focus"

export interface CanvasGroupPresentationController {
  dropTargetId: string | null
  focus: (groupId: string) => void
  focusedGroupId: string | null
  summaries: ReadonlyMap<string, CanvasGroupSummary>
}

const CanvasGroupPresentationContext = createContext<CanvasGroupPresentationController | null>(null)

export function CanvasGroupPresentationProvider(props: {
  children: ReactNode
  controller: CanvasGroupPresentationController
}) {
  return (
    <CanvasGroupPresentationContext value={props.controller}>
      {props.children}
    </CanvasGroupPresentationContext>
  )
}

export function useCanvasGroupPresentation() {
  const controller = useContext(CanvasGroupPresentationContext)
  if (controller) return controller
  throw new Error("CanvasGroupPresentationProvider is missing")
}
