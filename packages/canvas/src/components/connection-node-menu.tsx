import { File, Type } from "lucide-react"
import { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } from "../connections"
import type { CanvasConnectionNodeType } from "../editor-context"
import type { CanvasEdge } from "../types"

export function createCanvasCardConnection(
  sourceNodeId: string,
  sourceSide: "left" | "right",
  targetNodeId: string,
): Pick<CanvasEdge, "source" | "sourceHandle" | "target" | "targetHandle"> {
  return sourceSide === "right"
    ? {
        source: sourceNodeId,
        sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
        target: targetNodeId,
        targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
      }
    : {
        source: targetNodeId,
        sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
        target: sourceNodeId,
        targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
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
