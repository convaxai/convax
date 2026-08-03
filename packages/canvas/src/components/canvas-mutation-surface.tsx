import { createContext, type ReactNode, useContext, useMemo } from "react"
import {
  CanvasEditorNodeEntryProvider,
  type CanvasEditorController,
  type CanvasNodeEntryPresentation,
} from "../editor-context"

export interface CanvasMutationSurfaceState {
  /** The surface stays mounted but cannot receive pointer or keyboard input. */
  disabled: boolean
  /** Persistent read-only and blocking states hide mutation chrome entirely. */
  visible: boolean
}

const CanvasMutationSurfaceContext = createContext<CanvasMutationSurfaceState | null>(null)

export function CanvasMutationSurfaceProvider(props: CanvasMutationSurfaceState & { children: ReactNode }) {
  const value = useMemo(() => ({ disabled: props.disabled, visible: props.visible }), [props.disabled, props.visible])
  return <CanvasMutationSurfaceContext value={value}>{props.children}</CanvasMutationSurfaceContext>
}

export function CanvasEditorMutationSurfaceProvider(
  props: CanvasMutationSurfaceState & {
    children: ReactNode
    controller: CanvasEditorController
    onAnimationStart: (nodeId: string) => void
    presentation: CanvasNodeEntryPresentation
  },
) {
  return (
    <CanvasEditorNodeEntryProvider
      controller={props.controller}
      onAnimationStart={props.onAnimationStart}
      presentation={props.presentation}
    >
      <CanvasMutationSurfaceProvider disabled={props.disabled} visible={props.visible}>
        {props.children}
      </CanvasMutationSurfaceProvider>
    </CanvasEditorNodeEntryProvider>
  )
}

export function useCanvasMutationSurface(fallbackReadOnly: boolean): CanvasMutationSurfaceState {
  return useContext(CanvasMutationSurfaceContext) ?? { disabled: fallbackReadOnly, visible: !fallbackReadOnly }
}
