import type { CanvasFolderBrowseEntry, CanvasFolderBrowseListing } from "./services"
import type { CanvasNode } from "./types"

export const canvasFolderFocusEntryKey = "convax.folder-focus-entry"
export const canvasFolderFocusEntrySchema = "convax.folder-focus-entry/1"
export const canvasFolderFocusEntryLimit = 200

export interface CanvasFolderFocusEntry {
  entryId: string
  kind: CanvasFolderBrowseEntry["kind"]
  ownerNodeId: string
}

const focusCardSize = { height: 160, width: 240 }
const focusCardGap = { x: 48, y: 48 }
const focusColumnCount = 4

export function getCanvasFolderFocusEntry(node: CanvasNode | undefined): CanvasFolderFocusEntry | null {
  const value = node?.data[canvasFolderFocusEntryKey]
  if (!value || typeof value !== "object") return null
  const entryId = Reflect.get(value, "entryId")
  const kind = Reflect.get(value, "kind")
  const ownerNodeId = Reflect.get(value, "ownerNodeId")
  if (
    Reflect.get(value, "schema") !== canvasFolderFocusEntrySchema ||
    typeof entryId !== "string" ||
    !entryId ||
    (kind !== "file" && kind !== "folder") ||
    typeof ownerNodeId !== "string" ||
    !ownerNodeId
  ) {
    return null
  }
  return { entryId, kind, ownerNodeId }
}

export function isCanvasFolderFocusNode(node: CanvasNode | undefined) {
  return getCanvasFolderFocusEntry(node) !== null
}

function focusNodeId(ownerNodeId: string, index: number, reserved: Set<string>) {
  const base = `canvas-folder-focus:${ownerNodeId}:${index}`
  let id = base
  let suffix = 0
  while (reserved.has(id)) {
    suffix += 1
    id = `${base}:${suffix}`
  }
  reserved.add(id)
  return id
}

function boundedLabel(label: string) {
  const value = Array.from(label.trim()).slice(0, 160).join("")
  return value || "Untitled"
}

export function createCanvasFolderFocusNodes(input: {
  listing: CanvasFolderBrowseListing
  ownerNodeId: string
  reservedNodeIds?: Iterable<string>
}): CanvasNode[] {
  const reserved = new Set(input.reservedNodeIds)
  return input.listing.entries.slice(0, canvasFolderFocusEntryLimit).map((entry, index) => {
    const column = index % focusColumnCount
    const row = Math.floor(index / focusColumnCount)
    const label = boundedLabel(entry.label)
    return {
      connectable: false,
      data: {
        [canvasFolderFocusEntryKey]: {
          entryId: entry.id,
          kind: entry.kind,
          ownerNodeId: input.ownerNodeId,
          schema: canvasFolderFocusEntrySchema,
        },
        kind: entry.kind === "folder" ? "folder" : "file",
        label,
        metadata: {},
        name: label,
        resourceState: { status: "ready" },
      },
      deletable: false,
      draggable: false,
      focusable: true,
      id: focusNodeId(input.ownerNodeId, index, reserved),
      position: {
        x: column * (focusCardSize.width + focusCardGap.x),
        y: row * (focusCardSize.height + focusCardGap.y),
      },
      selectable: false,
      style: focusCardSize,
      type: "file",
    }
  })
}
