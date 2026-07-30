import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from "@convax/ui"
import { MoreHorizontal, PanelsTopLeft, Pencil, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { ProjectCanvas } from "./contracts"
import { ProjectCanvasController } from "./controller"
import { PROJECT_CANVAS_DRAG_TYPE, serializeProjectCanvasDrag } from "./drag"

export interface ProjectCanvasSidebarProps {
  activeCanvasId: string | null
  controller: ProjectCanvasController
  navigationBusy?: boolean
  navigationError?: string | null
  onActivate(canvasId: string): Promise<unknown> | unknown
  onClearNavigationError?(): void
  onCreate(): Promise<unknown> | unknown
  onDelete(canvasId: string): Promise<unknown> | unknown
  query?: string
}

export function ProjectCanvasSidebar(props: ProjectCanvasSidebarProps) {
  const snapshot = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
    props.controller.getSnapshot,
  )
  const [editor, setEditor] = useState<{ canvasId: string; name: string; projectId: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ canvas: ProjectCanvas; projectId: string } | null>(null)
  const busy = snapshot.busy || Boolean(props.navigationBusy)
  const error = snapshot.error ?? props.navigationError
  const normalizedQuery = props.query?.trim().toLocaleLowerCase() ?? ""
  const visibleCanvases = normalizedQuery
    ? snapshot.canvases.filter((canvas) => canvas.name.toLocaleLowerCase().includes(normalizedQuery))
    : snapshot.canvases

  useEffect(() => {
    setEditor(null)
    setPendingDelete(null)
  }, [snapshot.projectId])

  useEffect(() => {
    if (!pendingDelete) return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setPendingDelete(null)
    }
    document.addEventListener("keydown", dismissOnEscape)
    return () => document.removeEventListener("keydown", dismissOnEscape)
  }, [pendingDelete])

  const commitEditor = async () => {
    const current = editor
    setEditor(null)
    if (
      current?.name.trim() &&
      current.projectId === snapshot.projectId &&
      snapshot.canvases.some((canvas) => canvas.id === current.canvasId)
    ) {
      await props.controller.renameCanvas(current.canvasId, current.name)
    }
  }
  const beginRename = (canvas: ProjectCanvas) => {
    if (!snapshot.projectId) return
    setEditor({ canvasId: canvas.id, name: canvas.name, projectId: snapshot.projectId })
  }
  const beginDelete = (canvas: ProjectCanvas) => {
    if (!snapshot.projectId) return
    setPendingDelete({ canvas, projectId: snapshot.projectId })
  }

  if (snapshot.canvases.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
        <PanelsTopLeft className="size-6 opacity-60" />
        <span>{busy ? "Loading canvases…" : "No canvases yet."}</span>
        {!busy ? (
          <button
            className="font-medium text-primary hover:underline"
            disabled={busy}
            onClick={() => void props.onCreate()}
            type="button"
          >
            Create a canvas
          </button>
        ) : null}
      </div>
    )
  }

  if (visibleCanvases.length === 0) {
    return (
      <div
        className="grid min-h-0 flex-1 place-items-center px-5 text-center text-xs text-muted-foreground"
        role="status"
      >
        No matching canvases.
      </div>
    )
  }

  return (
    <>
      <div
        aria-label="Project canvases"
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-2"
        role="listbox"
      >
        {visibleCanvases.map((canvas) => {
          const active = canvas.id === props.activeCanvasId
          const canDelete = snapshot.canvases.length > 1
          const editing = editor?.canvasId === canvas.id
          const row = (
            <div
              aria-selected={active}
              className={cn(
                "group my-0.5 flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-[13px] outline-none transition-transform duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-focus-ring/40 motion-reduce:transition-none",
                active
                  ? "bg-interactive-selected font-medium text-text-primary"
                  : "text-text-secondary hover:bg-interactive-hover hover:text-text-primary active:bg-interactive-pressed",
              )}
              data-project-canvas-id={canvas.id}
              draggable={!editing}
              onClick={() => {
                if (!editing && !busy) void props.onActivate(canvas.id)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                if (!editing) beginRename(canvas)
              }}
              onDragStart={(event) => {
                if (!snapshot.projectId) return
                event.dataTransfer.effectAllowed = "copy"
                event.dataTransfer.setData(
                  PROJECT_CANVAS_DRAG_TYPE,
                  serializeProjectCanvasDrag({
                    canvas: { id: canvas.id, name: canvas.name },
                    projectId: snapshot.projectId,
                    version: 1,
                  }),
                )
                event.dataTransfer.setData("text/plain", canvas.name)
              }}
              onKeyDown={(event) => {
                if (editing) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  if (!busy) void props.onActivate(canvas.id)
                }
                if (event.key === "F2") beginRename(canvas)
                if ((event.key === "Delete" || event.key === "Backspace") && canDelete) beginDelete(canvas)
              }}
              role="option"
              tabIndex={active || (!props.activeCanvasId && visibleCanvases[0]?.id === canvas.id) ? 0 : -1}
            >
              <PanelsTopLeft className={cn("size-4 shrink-0", active ? "text-brand" : "text-text-tertiary")} />
              {editing ? (
                <InlineInput
                  label={`Rename ${canvas.name}`}
                  onCancel={() => setEditor(null)}
                  onChange={(name) => setEditor((current) => (current ? { ...current, name } : null))}
                  onCommit={commitEditor}
                  value={editor?.name ?? ""}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{canvas.name}</span>
              )}
              {!editing ? (
                <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                  <button
                    aria-label={`More actions for ${canvas.name}`}
                    className="grid size-7 place-items-center rounded-md text-text-tertiary outline-none transition-transform duration-100 hover:bg-interactive-hover hover:text-text-primary active:scale-95 active:bg-interactive-pressed focus-visible:ring-2 focus-visible:ring-focus-ring/40 motion-reduce:transition-none"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const row = event.currentTarget.closest<HTMLElement>("[data-project-canvas-id]")
                      const bounds = event.currentTarget.getBoundingClientRect()
                      row?.dispatchEvent(
                        new MouseEvent("contextmenu", {
                          bubbles: true,
                          button: 2,
                          clientX: bounds.right,
                          clientY: bounds.bottom + 4,
                        }),
                      )
                    }}
                    type="button"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </span>
              ) : null}
            </div>
          )
          return (
            <ContextMenu key={canvas.id}>
              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
              <ContextMenuContent className="min-w-40">
                <ContextMenuItem onSelect={() => beginRename(canvas)}>
                  <Pencil />
                  Rename
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-destructive"
                  disabled={!canDelete}
                  onSelect={() => beginDelete(canvas)}
                >
                  <Trash2 />
                  Delete canvas
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      {error ? (
        <div className="absolute inset-x-3 bottom-11 z-30 flex items-start gap-2 rounded-lg border border-destructive/25 bg-popover p-2.5 text-xs shadow-lg">
          <span className="min-w-0 flex-1">{error}</span>
          <button
            aria-label="Dismiss project canvas error"
            onClick={() => {
              props.controller.clearError()
              props.onClearNavigationError?.()
            }}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {pendingDelete ? (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-foreground/20 p-5 backdrop-blur-[2px]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null)
          }}
        >
          <div
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 shadow-2xl"
            role="dialog"
          >
            <h2 className="text-sm font-semibold">Delete canvas?</h2>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              “{pendingDelete.canvas.name}” and its canvas document will be deleted. Project files are not affected.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setPendingDelete(null)} size="sm" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (pendingDelete.projectId !== snapshot.projectId) return setPendingDelete(null)
                  void Promise.resolve(props.onDelete(pendingDelete.canvas.id)).then(() => setPendingDelete(null))
                }}
                size="sm"
                variant="destructive"
              >
                Delete canvas
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function InlineInput(props: {
  label: string
  onCancel: () => void
  onChange: (value: string) => void
  onCommit: () => Promise<void>
  value: string
}) {
  const committing = useRef(false)
  const canceled = useRef(false)
  const commit = () => {
    if (canceled.current || committing.current) return
    committing.current = true
    void props.onCommit().finally(() => {
      committing.current = false
    })
  }
  return (
    <input
      aria-label={props.label}
      autoFocus
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/25"
      onBlur={commit}
      onInput={(event) => props.onChange(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Enter") {
          event.preventDefault()
          commit()
        }
        if (event.key === "Escape") {
          event.preventDefault()
          canceled.current = true
          props.onCancel()
        }
      }}
      value={props.value}
    />
  )
}
