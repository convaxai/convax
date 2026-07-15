import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useInternalNode,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from "@xyflow/react"
import type { CSSProperties } from "react"
import type { CanvasEdge, CanvasNode, CanvasSelection } from "../types"

const METEOR_DURATION_SECONDS = 1

export function CanvasEdgeView(props: EdgeProps<CanvasEdge>) {
  const sourceNode = useInternalNode<CanvasNode>(props.source)
  const targetNode = useInternalNode<CanvasNode>(props.target)
  const sourceBounds = sourceNode
    ? {
        x: sourceNode.internals.positionAbsolute.x,
        y: sourceNode.internals.positionAbsolute.y,
        width: sourceNode.measured.width ?? sourceNode.width ?? 0,
        height: sourceNode.measured.height ?? sourceNode.height ?? 0,
      }
    : undefined
  const targetBounds = targetNode
    ? {
        x: targetNode.internals.positionAbsolute.x,
        y: targetNode.internals.positionAbsolute.y,
        width: targetNode.measured.width ?? targetNode.width ?? 0,
        height: targetNode.measured.height ?? targetNode.height ?? 0,
      }
    : undefined
  const geometry = resolveCanvasEdgeGeometry({
    sourceBounds,
    sourceHandleId: props.sourceHandleId,
    targetBounds,
    targetHandleId: props.targetHandleId,
    fallback: {
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      targetX: props.targetX,
      targetY: props.targetY,
      targetPosition: props.targetPosition,
    },
  })
  const [path, labelX, labelY] = getBezierPath({
    sourceX: geometry.sourceX,
    sourceY: geometry.sourceY,
    sourcePosition: geometry.sourcePosition,
    targetX: geometry.targetX,
    targetY: geometry.targetY,
    targetPosition: geometry.targetPosition,
  })
  const label = typeof props.data?.label === "string" ? props.data.label : undefined
  const phase = getAnimationPhase(props.id)
  const motionStyle = { animationDelay: `${phase}s` } satisfies CSSProperties

  return (
    <>
      <BaseEdge
        id={props.id}
        className="convax-edge__line"
        interactionWidth={24}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        path={path}
        style={props.style}
      />
      {props.animated === false ? null : (
        <g aria-hidden="true" className="convax-edge__motion">
          <path className="convax-edge__meteor-glow" d={path} style={motionStyle} />
          <path className="convax-edge__meteor-tail" d={path} style={motionStyle} />
          <path className="convax-edge__meteor-core" d={path} style={motionStyle} />
        </g>
      )}
      <g aria-hidden="true" className="convax-edge__endpoints">
        <circle
          className="convax-edge__endpoint convax-edge__endpoint--source"
          cx={geometry.sourceX}
          cy={geometry.sourceY}
          r={5}
        />
        <circle
          className="convax-edge__endpoint convax-edge__endpoint--target"
          cx={geometry.targetX}
          cy={geometry.targetY}
          r={5}
        />
      </g>
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="convax-edge__label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export function CanvasConnectionLine(props: ConnectionLineComponentProps<CanvasNode>) {
  const [path] = getBezierPath({
    sourceX: props.fromX,
    sourceY: props.fromY,
    sourcePosition: props.fromPosition,
    targetX: props.toX,
    targetY: props.toY,
    targetPosition: props.toPosition,
  })
  const status = props.connectionStatus ?? "pending"

  return (
    <g className={`convax-connection convax-connection--${status}`}>
      <path className="convax-connection__line" d={path} />
      <path className="convax-connection__flow" d={path} pathLength={100} />
      <circle className="convax-connection__target" cx={props.toX} cy={props.toY} r={5} />
    </g>
  )
}

function getAnimationPhase(id: string) {
  return (
    (-([...id].reduce((value, character) => value + character.charCodeAt(0), 0) % 1000) / 1000) *
    METEOR_DURATION_SECONDS
  )
}

interface CanvasNodeBounds {
  x: number
  y: number
  width: number
  height: number
}

interface CanvasEdgeGeometry {
  sourceX: number
  sourceY: number
  sourcePosition: Position
  targetX: number
  targetY: number
  targetPosition: Position
}

export function shouldAnimateCanvasEdge(edge: CanvasEdge, selection: CanvasSelection) {
  if (edge.animated === false || selection.nodeIds.size !== 1 || selection.edgeIds.has(edge.id)) return false
  const [activeNodeId] = selection.nodeIds
  return activeNodeId === edge.source || activeNodeId === edge.target
}

export function resolveCanvasEdgeGeometry(input: {
  sourceBounds?: CanvasNodeBounds
  sourceHandleId?: string | null
  targetBounds?: CanvasNodeBounds
  targetHandleId?: string | null
  fallback: CanvasEdgeGeometry
}): CanvasEdgeGeometry {
  if (!input.sourceBounds || !input.targetBounds) return input.fallback
  const adaptive = getAdaptiveEdgeGeometry(input.sourceBounds, input.targetBounds)
  if (!input.sourceHandleId && !input.targetHandleId) return adaptive
  const source = getNodeHandleEndpoint(input.sourceBounds, input.sourceHandleId, adaptive.sourcePosition)
  const target = getNodeHandleEndpoint(input.targetBounds, input.targetHandleId, adaptive.targetPosition)
  return {
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: source.position,
    targetX: target.x,
    targetY: target.y,
    targetPosition: target.position,
  }
}

function getNodeHandleEndpoint(bounds: CanvasNodeBounds, handleId: string | null | undefined, fallback: Position) {
  const position = getHandlePosition(handleId, fallback)
  if (position === Position.Left) return { x: bounds.x, y: bounds.y + bounds.height / 2, position }
  if (position === Position.Right) return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2, position }
  if (position === Position.Top) return { x: bounds.x + bounds.width / 2, y: bounds.y, position }
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height, position }
}

function getHandlePosition(handleId: string | null | undefined, fallback: Position) {
  const normalized = handleId?.toLowerCase()
  if (normalized?.includes("left")) return Position.Left
  if (normalized?.includes("right")) return Position.Right
  if (normalized?.includes("top")) return Position.Top
  if (normalized?.includes("bottom")) return Position.Bottom
  return fallback
}

function getAdaptiveEdgeGeometry(
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number },
): CanvasEdgeGeometry {
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  const delta = { x: targetCenter.x - sourceCenter.x, y: targetCenter.y - sourceCenter.y }

  if (Math.abs(delta.x) >= Math.abs(delta.y)) {
    const forward = delta.x >= 0
    return {
      sourceX: forward ? source.x + source.width : source.x,
      sourceY: sourceCenter.y,
      sourcePosition: forward ? Position.Right : Position.Left,
      targetX: forward ? target.x : target.x + target.width,
      targetY: targetCenter.y,
      targetPosition: forward ? Position.Left : Position.Right,
    }
  }

  const forward = delta.y >= 0
  return {
    sourceX: sourceCenter.x,
    sourceY: forward ? source.y + source.height : source.y,
    sourcePosition: forward ? Position.Bottom : Position.Top,
    targetX: targetCenter.x,
    targetY: forward ? target.y : target.y + target.height,
    targetPosition: forward ? Position.Top : Position.Bottom,
  }
}
