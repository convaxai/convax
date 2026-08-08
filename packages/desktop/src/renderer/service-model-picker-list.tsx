import { Check, ChevronRight } from "lucide-react"

export interface ServiceModelPickerGroup<Model> {
  readonly id: string
  readonly models: readonly Model[]
  readonly name: string
}

export interface ServiceModelPickerListProps<Model> {
  readonly groups: readonly ServiceModelPickerGroup<Model>[]
  readonly isSelected: (model: Model) => boolean
  readonly modelAriaLabel: (model: Model, group: ServiceModelPickerGroup<Model>) => string
  readonly modelKey: (model: Model) => string
  readonly modelLabel: (model: Model) => string
  readonly onSelect: (model: Model) => void
}

/** Shared Service → Model presentation used by Agent and Canvas model pickers. */
export function ServiceModelPickerList<Model>(props: ServiceModelPickerListProps<Model>) {
  const selectedGroupId = props.groups.find((group) => group.models.some(props.isSelected))?.id

  return (
    <div role="radiogroup">
      {props.groups.map((group) => (
        <details
          className="group/service rounded-xl border border-transparent open:border-border/60 open:bg-muted/25"
          data-service-model-picker-service={group.id}
          key={group.id}
          open={props.groups.length === 1 || selectedGroupId === group.id}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2.5 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/service:rotate-90" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {group.models.length}
            </span>
          </summary>
          <div className="mb-1 ml-4 border-l border-border/70 pl-2">
            {group.models.map((model) => {
              const selected = props.isSelected(model)
              return (
                <button
                  aria-checked={selected}
                  aria-label={props.modelAriaLabel(model, group)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                  key={props.modelKey(model)}
                  onClick={() => props.onSelect(model)}
                  role="radio"
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{props.modelLabel(model)}</span>
                  {selected ? <Check className="size-4 shrink-0" /> : null}
                </button>
              )
            })}
          </div>
        </details>
      ))}
    </div>
  )
}
