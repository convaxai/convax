import { Position, getBezierPath, useInternalNode, useViewport, type Viewport } from "@xyflow/react"
import { createPortal } from "react-dom"
import { useCanvasOverlayRoot, type CanvasConnectionNodeType } from "../editor-context"
import type { CanvasNode, CanvasPoint } from "../types"
import { resolveCanvasCardHandlePoint } from "./card-connection-geometry"
import { ConnectionNodeMenu } from "./connection-node-menu"

export function PendingConnectionMenu(props: {
  items: readonly CanvasConnectionNodeType[]
  onSelect: (type: string) => void
  side: "left" | "right"
  sourceNodeId: string
  targetPosition: CanvasPoint
}) {
  const overlayRoot = useCanvasOverlayRoot()
  const sourceNode = useInternalNode<CanvasNode>(props.sourceNodeId)
  const viewport = useViewport()
  if (!sourceNode) return null

  const { sourcePoint, sourceScale, targetPoint } = resolvePendingConnectionOverlayGeometry({
    side: props.side,
    sourceBounds: {
      height: sourceNode.measured.height ?? sourceNode.height ?? 0,
      width: sourceNode.measured.width ?? sourceNode.width ?? 0,
      x: sourceNode.internals.positionAbsolute.x,
      y: sourceNode.internals.positionAbsolute.y,
    },
    targetPosition: props.targetPosition,
    viewport,
  })
  const [path] = getBezierPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition: props.side === "right" ? Position.Right : Position.Left,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition: props.side === "right" ? Position.Left : Position.Right,
  })
  const layer = (
    <div className="convax-pending-connection" data-convax-pending-connection="menu">
      <svg aria-hidden="true" className="convax-pending-connection__svg">
        <path className="convax-pending-connection__line" d={path} />
        <g transform={`translate(${sourcePoint.x} ${sourcePoint.y}) scale(${sourceScale})`}>
          <circle className="convax-pending-connection__source" cx={0} cy={0} r={16} />
          <path className="convax-pending-connection__plus" d="M -6 0 H 6 M 0 -6 V 6" />
        </g>
      </svg>
      <div
        className="convax-pending-connection__menu"
        style={{
          left: targetPoint.x,
          top: targetPoint.y,
          transform: props.side === "right" ? "translate(18px, -50%)" : "translate(calc(-100% - 18px), -50%)",
        }}
      >
        <ConnectionNodeMenu items={props.items} onSelect={props.onSelect} />
      </div>
    </div>
  )
  return overlayRoot ? createPortal(layer, overlayRoot) : layer
}

export function projectCanvasPointToOverlay(point: CanvasPoint, viewport: Viewport): CanvasPoint {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  }
}

export function resolvePendingConnectionOverlayGeometry(input: {
  side: "left" | "right"
  sourceBounds: { height: number; width: number; x: number; y: number }
  targetPosition: CanvasPoint
  viewport: Viewport
}): { sourcePoint: CanvasPoint; sourceScale: number; targetPoint: CanvasPoint } {
  return {
    sourcePoint: projectCanvasPointToOverlay(
      resolveCanvasCardHandlePoint(input.sourceBounds, input.side),
      input.viewport,
    ),
    sourceScale: input.viewport.zoom,
    targetPoint: projectCanvasPointToOverlay(input.targetPosition, input.viewport),
  }
}
