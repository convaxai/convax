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
  if (!input.sourceBounds || !input.targetBounds) {
    return {
      ...input.fallback,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
  }
  const source = input.sourceBounds
  const target = input.targetBounds
  return {
    sourceX: source.x + source.width,
    sourceY: source.y + source.height / 2,
    sourcePosition: Position.Right,
    targetX: target.x,
    targetY: target.y + target.height / 2,
    targetPosition: Position.Left,
  }
}
