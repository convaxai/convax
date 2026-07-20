import { useId } from "react"
import { Input } from "./input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { cn } from "../lib/utils"

export interface ToolInputFieldBase {
  description?: string
  id: string
  label: string
  required: boolean
}

export interface ToolInputSelectField extends ToolInputFieldBase {
  choices: readonly Readonly<{ label: string; value: string }>[]
  defaultValue?: string
  kind: "select"
}

export interface ToolInputTextField extends ToolInputFieldBase {
  defaultValue?: string
  kind: "text"
  maxLength: number
  minLength: number
}

export interface ToolInputNumberField extends ToolInputFieldBase {
  defaultValue?: number
  kind: "number" | "integer"
  maximum: number
  minimum: number
}

export interface ToolInputBooleanField extends ToolInputFieldBase {
  defaultValue?: boolean
  kind: "boolean"
}

export type ToolInputField = ToolInputSelectField | ToolInputTextField | ToolInputNumberField | ToolInputBooleanField

export type ToolInputValue = string | number | boolean
export type ToolInputValues = Readonly<Record<string, ToolInputValue>>

export interface ToolInputValidation {
  input: Record<string, ToolInputValue>
  invalidFieldIds: readonly string[]
  missingRequiredFieldIds: readonly string[]
  valid: boolean
}

export function createToolInputDefaultValues(fields: readonly ToolInputField[]): Record<string, ToolInputValue> {
  return reconcileToolInputValues(fields, {}, true)
}

/**
 * Retains only values accepted by the current declaration. Defaults are useful
 * when a newly described tool is selected; catalog reconciliation can omit them.
 */
export function reconcileToolInputValues(
  fields: readonly ToolInputField[],
  values: ToolInputValues,
  applyDefaults = false,
): Record<string, ToolInputValue> {
  const result: Record<string, ToolInputValue> = {}
  for (const field of fields) {
    const value = values[field.id]
    if (value !== undefined && isToolInputFieldValue(field, value)) {
      result[field.id] = value
      continue
    }
    if (applyDefaults && field.defaultValue !== undefined && isToolInputFieldValue(field, field.defaultValue)) {
      result[field.id] = field.defaultValue
    }
  }
  return result
}

export function validateToolInputValues(
  fields: readonly ToolInputField[],
  values: ToolInputValues,
): ToolInputValidation {
  const input: Record<string, ToolInputValue> = {}
  const invalidFieldIds: string[] = []
  const missingRequiredFieldIds: string[] = []
  const fieldsById = new Map(fields.map((field) => [field.id, field]))

  for (const id of Object.keys(values)) {
    if (!fieldsById.has(id)) invalidFieldIds.push(id)
  }
  for (const field of fields) {
    const value = values[field.id]
    if (value === undefined) {
      if (field.required) missingRequiredFieldIds.push(field.id)
      continue
    }
    if (!isToolInputFieldValue(field, value)) {
      invalidFieldIds.push(field.id)
      continue
    }
    input[field.id] = value
  }

  return {
    input,
    invalidFieldIds,
    missingRequiredFieldIds,
    valid: invalidFieldIds.length === 0 && missingRequiredFieldIds.length === 0,
  }
}

function isToolInputFieldValue(field: ToolInputField, value: ToolInputValue) {
  if (field.kind === "select") {
    return typeof value === "string" && field.choices.some((choice) => choice.value === value)
  }
  if (field.kind === "text") {
    return (
      typeof value === "string" &&
      (field.minLength === undefined || value.length >= field.minLength) &&
      (field.maxLength === undefined || value.length <= field.maxLength)
    )
  }
  if (field.kind === "boolean") return typeof value === "boolean"
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (field.kind !== "integer" || Number.isInteger(value)) &&
    (field.minimum === undefined || value >= field.minimum) &&
    (field.maximum === undefined || value <= field.maximum)
  )
}

export interface ToolInputFormProps {
  className?: string
  disabled?: boolean
  fields: readonly ToolInputField[]
  layout?: "grid" | "inline"
  onValuesChange(values: Record<string, ToolInputValue>): void
  values: ToolInputValues
}

/** Product-neutral, host-rendered controls for a normalized scalar tool schema. */
export function ToolInputForm(props: ToolInputFormProps) {
  const instanceId = useId()
  const layout = props.layout ?? "grid"
  const update = (field: ToolInputField, value: ToolInputValue | undefined) => {
    const next = { ...props.values }
    if (value === undefined) delete next[field.id]
    else next[field.id] = value
    props.onValuesChange(next)
  }

  return (
    <div
      className={cn(
        layout === "inline" ? "flex min-w-0 items-center gap-1.5" : "grid grid-cols-2 gap-2",
        props.className,
      )}
      data-tool-input-form
      data-tool-input-layout={layout}
    >
      {props.fields.map((field) => {
        const id = `${instanceId}-${field.id}`
        const descriptionId = field.description && layout === "grid" ? `${id}-description` : undefined
        return (
          <div
            className={cn(
              layout === "inline" ? "flex shrink-0 items-center gap-1" : "min-w-0 space-y-1",
              layout === "grid" && field.kind === "text" && "col-span-2",
            )}
            key={field.id}
          >
            <label
              className={cn("block text-[11px] font-medium text-muted-foreground", layout === "inline" && "sr-only")}
              htmlFor={id}
            >
              {field.label}
              {field.required ? <span aria-hidden="true"> *</span> : null}
            </label>
            <ToolInputControl
              describedBy={descriptionId}
              disabled={props.disabled === true}
              field={field}
              id={id}
              layout={layout}
              onValueChange={(value) => update(field, value)}
              value={props.values[field.id]}
            />
            {field.description && layout === "grid" ? (
              <div className="text-[10px] leading-4 text-muted-foreground" id={descriptionId}>
                {field.description}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ToolInputControl(props: {
  describedBy?: string
  disabled: boolean
  field: ToolInputField
  id: string
  layout: "grid" | "inline"
  onValueChange(value: ToolInputValue | undefined): void
  value?: ToolInputValue
}) {
  const { field } = props
  if (field.kind === "select") {
    const selectedIndex =
      typeof props.value === "string" ? field.choices.findIndex((choice) => choice.value === props.value) : -1
    const value = selectedIndex >= 0 ? choiceToken(selectedIndex) : ""
    return (
      <Select
        disabled={props.disabled}
        onValueChange={(next) => {
          if (next === optionalToken) props.onValueChange(undefined)
          else props.onValueChange(field.choices[choiceIndex(next)]?.value)
        }}
        value={value}
      >
        <SelectTrigger
          aria-describedby={props.describedBy}
          aria-required={field.required}
          className={cn(
            "h-8",
            props.layout === "inline"
              ? "w-auto min-w-20 max-w-40 rounded-full border-border/60 bg-muted/60 px-2 shadow-none"
              : "w-full",
          )}
          data-canvas-shortcuts="ignore"
          id={props.id}
        >
          <SelectValue placeholder={field.required ? "Select…" : "Auto"}>
            {props.layout === "inline"
              ? `${field.label} · ${
                  selectedIndex >= 0 ? field.choices[selectedIndex]?.label : field.required ? "Select…" : "Auto"
                }`
              : selectedIndex >= 0
                ? field.choices[selectedIndex]?.label
                : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!field.required ? <SelectItem value={optionalToken}>Auto</SelectItem> : null}
          {field.choices.map((choice, index) => (
            <SelectItem key={`${index}:${choice.value}`} value={choiceToken(index)}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.kind === "boolean") {
    const value = typeof props.value === "boolean" ? String(props.value) : ""
    return (
      <Select
        disabled={props.disabled}
        onValueChange={(next) => props.onValueChange(next === optionalToken ? undefined : next === "true")}
        value={value}
      >
        <SelectTrigger
          aria-describedby={props.describedBy}
          aria-required={field.required}
          className={cn(
            "h-8",
            props.layout === "inline"
              ? "w-auto min-w-20 rounded-full border-border/60 bg-muted/60 px-2 shadow-none"
              : "w-full",
          )}
          data-canvas-shortcuts="ignore"
          id={props.id}
        >
          <SelectValue placeholder={field.required ? "Select…" : "Auto"}>
            {props.layout === "inline"
              ? `${field.label} · ${
                  typeof props.value === "boolean" ? (props.value ? "Yes" : "No") : field.required ? "Select…" : "Auto"
                }`
              : typeof props.value === "boolean"
                ? props.value
                  ? "Yes"
                  : "No"
                : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!field.required ? <SelectItem value={optionalToken}>Auto</SelectItem> : null}
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  if (field.kind === "text") {
    const input = (
      <Input
        aria-describedby={props.describedBy}
        aria-required={field.required}
        disabled={props.disabled}
        id={props.id}
        className={
          props.layout === "inline"
            ? "h-7 w-28 border-0 bg-transparent px-1 shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0"
            : undefined
        }
        maxLength={field.maxLength}
        minLength={field.minLength}
        onChange={(event) => {
          const value = event.currentTarget.value
          props.onValueChange(!field.required && value === "" ? undefined : value)
        }}
        placeholder={!field.required ? "Auto" : undefined}
        value={typeof props.value === "string" ? props.value : ""}
      />
    )
    return props.layout === "inline" ? (
      <div className="flex h-8 items-center rounded-full border border-border/60 bg-muted/60 px-2 text-[11px] text-muted-foreground">
        <span className="shrink-0">{field.label} ·</span>
        {input}
      </div>
    ) : (
      input
    )
  }

  const input = (
    <Input
      aria-describedby={props.describedBy}
      aria-required={field.required}
      disabled={props.disabled}
      id={props.id}
      className={
        props.layout === "inline"
          ? "h-7 w-16 border-0 bg-transparent px-1 shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0"
          : undefined
      }
      max={field.maximum}
      min={field.minimum}
      onChange={(event) => {
        const value = event.currentTarget.valueAsNumber
        props.onValueChange(Number.isFinite(value) ? value : undefined)
      }}
      placeholder={!field.required ? "Auto" : undefined}
      step={field.kind === "integer" ? 1 : "any"}
      type="number"
      value={typeof props.value === "number" ? props.value : ""}
    />
  )
  return props.layout === "inline" ? (
    <div className="flex h-8 items-center rounded-full border border-border/60 bg-muted/60 px-2 text-[11px] text-muted-foreground">
      <span className="shrink-0">{field.label} ·</span>
      {input}
    </div>
  ) : (
    input
  )
}

const optionalToken = "optional"
const choiceToken = (index: number) => `choice:${index}`
const choiceIndex = (value: string) => Number.parseInt(value.slice("choice:".length), 10)
