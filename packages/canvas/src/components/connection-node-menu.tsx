import { File, Type } from "lucide-react"
import { createPortal } from "react-dom"
import { Position, getBezierPath } from "@xyflow/react"
import type { CanvasConnectionNodeType } from "../editor-context"
import type { CanvasEdge, CanvasPoint } from "../types"

export function createCanvasCardConnection(
  sourceNodeId: string,
  sourceSide: "left" | "right",
  targetNodeId: string,
): Pick<CanvasEdge, "source" | "sourceHandle" | "target" | "targetHandle"> {
  return sourceSide === "right"
    ? {
        source: sourceNodeId,
        sourceHandle: "source-right",
        target: targetNodeId,
        targetHandle: "target-left",
      }
    : {
        source: targetNodeId,
        sourceHandle: "source-right",
        target: sourceNodeId,
        targetHandle: "target-left",
      }
}

export function ConnectionNodeMenu(props: {
  items: readonly CanvasConnectionNodeType[]
  onSelect: (type: string) => void
}) {
  return (
    <div className="convax-connect-menu nodrag nowheel" data-convax-connect-menu="true" role="menu">
      <div className="convax-connect-menu__title">Add and connect</div>
      <div className="convax-connect-menu__items">
        {props.items.map((item) => (
          <button
            key={item.type}
            className="convax-connect-menu__item"
            onClick={() => props.onSelect(item.type)}
            role="menuitem"
            type="button"
          >
            <span className="convax-connect-menu__icon">{item.type === "text" ? <Type /> : <File />}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function PendingConnectionMenu(props: {
  items: readonly CanvasConnectionNodeType[]
  onSelect: (type: string) => void
  side: "left" | "right"
  sourceScreen: CanvasPoint
  targetScreen: CanvasPoint
}) {
  const [path] = getBezierPath({
    sourceX: props.sourceScreen.x,
    sourceY: props.sourceScreen.y,
    sourcePosition: props.side === "right" ? Position.Right : Position.Left,
    targetX: props.targetScreen.x,
    targetY: props.targetScreen.y,
    targetPosition: props.side === "right" ? Position.Left : Position.Right,
  })
  const layer = (
    <div className="convax-pending-connection" data-convax-pending-connection="menu">
      <svg aria-hidden="true" className="convax-pending-connection__svg">
        <path className="convax-pending-connection__line" d={path} />
        <circle
          className="convax-pending-connection__source"
          cx={props.sourceScreen.x}
          cy={props.sourceScreen.y}
          r={16}
        />
        <path
          className="convax-pending-connection__plus"
          d={`M ${props.sourceScreen.x - 6} ${props.sourceScreen.y} H ${props.sourceScreen.x + 6} M ${props.sourceScreen.x} ${props.sourceScreen.y - 6} V ${props.sourceScreen.y + 6}`}
        />
      </svg>
      <div
        className="convax-pending-connection__menu"
        style={{
          left: props.targetScreen.x,
          top: props.targetScreen.y,
          transform: props.side === "right" ? "translate(18px, -50%)" : "translate(calc(-100% - 18px), -50%)",
        }}
      >
        <ConnectionNodeMenu items={props.items} onSelect={props.onSelect} />
      </div>
    </div>
  )
  return typeof document === "undefined" ? layer : createPortal(layer, document.body)
}
