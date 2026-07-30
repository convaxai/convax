import { Check, Pencil, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export interface CanvasTitlebarTitleProps {
  disabled?: boolean
  name: string
  onRename(name: string): Promise<unknown> | unknown
}

export function CanvasTitlebarTitle({ disabled = false, name, onRename }: CanvasTitlebarTitleProps) {
  const [draft, setDraft] = useState(name)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(name)
  }, [editing, name])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const cancel = () => {
    setDraft(name)
    setEditing(false)
  }
  const commit = async () => {
    const nextName = draft.trim()
    if (!nextName || nextName === name) {
      cancel()
      return
    }
    setEditing(false)
    await onRename(nextName)
  }

  return editing ? (
    <form
      aria-label="Rename Canvas"
      className="app-titlebar-no-drag flex min-w-0 items-center gap-0.5"
      onSubmit={(event) => {
        event.preventDefault()
        void commit()
      }}
    >
      <input
        aria-label="Canvas name"
        className="h-7 min-w-28 max-w-72 rounded-md border border-border bg-surface-inset px-2 text-center text-xs font-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50"
        disabled={disabled}
        maxLength={120}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          cancel()
        }}
        ref={inputRef}
        value={draft}
      />
      <button
        aria-label="Save Canvas name"
        className="grid size-7 place-items-center rounded-md text-text-tertiary outline-none transition-[background-color,color,transform] duration-100 hover:bg-interactive-hover hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring/50 motion-reduce:transition-none"
        disabled={disabled || !draft.trim()}
        type="submit"
      >
        <Check aria-hidden className="size-3.5" />
      </button>
      <button
        aria-label="Cancel Canvas rename"
        className="grid size-7 place-items-center rounded-md text-text-tertiary outline-none transition-[background-color,color,transform] duration-100 hover:bg-interactive-hover hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring/50 motion-reduce:transition-none"
        onClick={cancel}
        type="button"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </form>
  ) : (
    <div className="app-titlebar-no-drag group flex min-w-0 items-center justify-center gap-0.5">
      <span className="min-w-0 truncate px-1 text-xs font-medium text-text-secondary" title={name}>
        {name}
      </span>
      <button
        aria-label={`Rename ${name}`}
        className="grid size-7 shrink-0 place-items-center rounded-md text-text-disabled opacity-70 outline-none transition-[background-color,color,opacity,transform] duration-100 hover:bg-interactive-hover hover:text-text-primary hover:opacity-100 active:scale-[0.96] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus-ring/50 motion-reduce:transition-none"
        disabled={disabled}
        onClick={() => setEditing(true)}
        title={`Rename ${name}`}
        type="button"
      >
        <Pencil aria-hidden className="size-3" />
      </button>
    </div>
  )
}
