import { cn } from "@convax/ui"
import type { CanvasInspectorProjection } from "../inspector"

export interface CanvasInspectorProps {
  className?: string
  projection: CanvasInspectorProjection
}

/** Read-only, control-free rendering of a bounded Canvas-owned Inspector projection. */
export function CanvasInspector({ className, projection }: CanvasInspectorProps) {
  return (
    <section
      aria-label={`${projection.label} inspector`}
      className={cn("convax-canvas-inspector min-w-0 text-sm", className)}
      data-canvas-inspector=""
      data-read-only=""
    >
      <header className="border-b border-border px-4 py-3">
        <div className="truncate font-medium text-foreground">{projection.label}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{projection.nodeKind}</span>
          {projection.status ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{projection.status}</span>
            </>
          ) : null}
        </div>
        {projection.description ? (
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{projection.description}</p>
        ) : null}
      </header>
      {projection.sections.map((section) => (
        <section className="border-b border-border px-4 py-3 last:border-b-0" key={section.id}>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {section.label}
          </h3>
          <dl className="space-y-1.5">
            {section.fields.map((field) => (
              <div className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3" key={field.id}>
                <dt className="truncate text-xs text-muted-foreground">{field.label}</dt>
                <dd className="truncate text-right text-xs text-foreground" title={field.value}>
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </section>
  )
}
