import {
  ProjectCanvasController,
  serializeProjectCanvasDrag,
  PROJECT_CANVAS_DRAG_TYPE,
  type ProjectCanvas,
} from "@convax/project/canvas"
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from "@convax/ui"
import { PanelsTopLeft, Pencil, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

export interface ProjectCanvasSidebarProps {
  activeCanvasId: string | null
  controller: ProjectCanvasController
  navigationBusy?: boolean
  navigationError?: string | null
  onActivate(canvasId: string): Promise<unknown> | unknown
  onClearNavigationError?(): void
  onCreate(): Promise<unknown> | unknown
  onDelete(canvasId: string): Promise<unknown> | unknown
}

export function ProjectCanvasSidebar(props: ProjectCanvasSidebarProps) {
  const snapshot = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot)
  const [editor, setEditor] = useState<{ canvasId: string; name: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ProjectCanvas | null>(null)
  const busy = snapshot.busy || Boolean(props.navigationBusy)
  const error = snapshot.error ?? props.navigationError

  useEffect(() => {
    setEditor(null)
    setPendingDelete(null)
  }, [snapshot.projectId])

  const commitEditor = async () => {
    const current = editor
    setEditor(null)
    if (current?.name.trim()) await props.controller.renameCanvas(current.canvasId, current.name)
  }

  if (snapshot.canvases.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
        <PanelsTopLeft className="size-6 opacity-60" />
        <span>{busy ? "Loading canvases…" : "No canvases yet."}</span>
        {!busy ? (
          <button className="font-medium text-primary hover:underline" disabled={busy} onClick={() => void props.onCreate()} type="button">
            Create a canvas
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div aria-label="Project canvases" className="min-h-0 flex-1 overflow-auto px-2 pb-2" role="listbox">
        {snapshot.canvases.map((canvas) => {
          const active = canvas.id === props.activeCanvasId
          const canDelete = snapshot.canvases.length > 1
          const editing = editor?.canvasId === canvas.id
          const row = (
            <div
              aria-selected={active}
              className={cn(
                "group flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none",
                active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
              data-project-canvas-id={canvas.id}
              draggable={!editing}
              onClick={() => { if (!editing && !busy) void props.onActivate(canvas.id) }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                if (!editing) setEditor({ canvasId: canvas.id, name: canvas.name })
              }}
              onDragStart={(event) => {
                if (!snapshot.projectId) return
                event.dataTransfer.effectAllowed = "copy"
                event.dataTransfer.setData(PROJECT_CANVAS_DRAG_TYPE, serializeProjectCanvasDrag({
                  canvas: { id: canvas.id, name: canvas.name },
                  projectId: snapshot.projectId,
                  version: 1,
                }))
                event.dataTransfer.setData("text/plain", canvas.name)
              }}
              onKeyDown={(event) => {
                if (editing) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  if (!busy) void props.onActivate(canvas.id)
                }
                if (event.key === "F2") setEditor({ canvasId: canvas.id, name: canvas.name })
                if ((event.key === "Delete" || event.key === "Backspace") && canDelete) setPendingDelete(canvas)
              }}
              role="option"
              tabIndex={active || (!props.activeCanvasId && snapshot.canvases[0]?.id === canvas.id) ? 0 : -1}
            >
              <PanelsTopLeft className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              {editing ? (
                <InlineInput
                  label={`Rename ${canvas.name}`}
                  onCancel={() => setEditor(null)}
                  onChange={(name) => setEditor((current) => current ? { ...current, name } : null)}
                  onCommit={commitEditor}
                  value={editor?.name ?? ""}
                />
              ) : <span className="min-w-0 flex-1 truncate">{canvas.name}</span>}
              {!editing ? (
                <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    aria-label={`Rename ${canvas.name}`}
                    className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-background/80 hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation()
                      setEditor({ canvasId: canvas.id, name: canvas.name })
                    }}
                    type="button"
                  ><Pencil className="size-3.5" /></button>
                  <button
                    aria-label={`Delete ${canvas.name}`}
                    className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-35"
                    disabled={!canDelete}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (canDelete) setPendingDelete(canvas)
                    }}
                    type="button"
                  ><Trash2 className="size-3.5" /></button>
                </span>
              ) : null}
            </div>
          )
          return (
            <ContextMenu key={canvas.id}>
              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem disabled={busy} onSelect={() => void props.onActivate(canvas.id)}><PanelsTopLeft />Open canvas</ContextMenuItem>
                <ContextMenuItem onSelect={() => setEditor({ canvasId: canvas.id, name: canvas.name })}><Pencil />Rename</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem className="text-destructive" disabled={!canDelete} onSelect={() => setPendingDelete(canvas)}><Trash2 />Delete canvas</ContextMenuItem>
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
          ><X className="size-3.5" /></button>
        </div>
      ) : null}
      {pendingDelete ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/20 p-5 backdrop-blur-[2px]">
          <div aria-modal="true" className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 shadow-2xl" role="dialog">
            <h2 className="text-sm font-semibold">Delete canvas?</h2>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">“{pendingDelete.name}” and its canvas document will be deleted. Project files are not affected.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setPendingDelete(null)} size="sm" variant="ghost">Cancel</Button>
              <Button
                disabled={busy}
                onClick={() => void Promise.resolve(props.onDelete(pendingDelete.id)).then(() => setPendingDelete(null))}
                size="sm"
                variant="destructive"
              >Delete canvas</Button>
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
  const commit = () => {
    if (committing.current) return
    committing.current = true
    void props.onCommit().finally(() => { committing.current = false })
  }
  return (
    <input
      aria-label={props.label}
      autoFocus
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/25"
      onBlur={commit}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Enter") commit()
        if (event.key === "Escape") props.onCancel()
      }}
      value={props.value}
    />
  )
}
