import type {
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputField,
  GenerationToolInputValue,
} from "../generation-contracts"

const hostReservedGenerationInputFields = new Set([
  "schema",
  "operation_id",
  "output",
  "output_directory",
  "prompt",
  "references",
])
const generationToolInputIdPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const maximumGenerationToolFields = 32
const maximumGenerationToolChoices = 64
const maximumGenerationToolSchemaBytes = 64 * 1024
const maximumGenerationToolStringLength = 4_096
const maximumGenerationToolNumberMagnitude = 1_000_000_000_000
const unsafeDisplayTextCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function displayText(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    unsafeDisplayTextCharacters.test(value)
  ) {
    return undefined
  }
  return value
}

function requireSafeInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside the supported range`)
  }
  return value
}

function optionalSafeInteger(value: unknown, label: string, fallback: number) {
  return value === undefined ? fallback : requireSafeInteger(value, label, 0, maximumGenerationToolStringLength)
}

function optionalFiniteNumber(value: unknown, label: string, fallback: number) {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximumGenerationToolNumberMagnitude) {
    throw new Error(`${label} is outside the supported range`)
  }
  return value
}

function choiceValue(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 256 ||
    unsafeDisplayTextCharacters.test(value)
  ) {
    throw new Error(`${label} must be a bounded non-empty string`)
  }
  return value
}

function choicesFromSchema(schema: Record<string, unknown>, label: string) {
  let choices: Array<{ label: string; value: string }> | undefined
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > maximumGenerationToolChoices) {
      throw new Error(`${label} enum must contain between 1 and ${maximumGenerationToolChoices} values`)
    }
    choices = schema.enum.map((value, index) => {
      const normalized = choiceValue(value, `${label} enum value ${index}`)
      return { label: normalized, value: normalized }
    })
  } else if (schema.oneOf !== undefined) {
    if (
      !Array.isArray(schema.oneOf) ||
      schema.oneOf.length === 0 ||
      schema.oneOf.length > maximumGenerationToolChoices
    ) {
      throw new Error(`${label} oneOf must contain between 1 and ${maximumGenerationToolChoices} choices`)
    }
    choices = schema.oneOf.map((value, index) => {
      if (!isRecord(value) || !("const" in value)) {
        throw new Error(`${label} oneOf choice ${index} must declare a scalar const`)
      }
      const normalized = choiceValue(value.const, `${label} oneOf choice ${index}`)
      return {
        label: displayText(value.title, 120) ?? normalized,
        value: normalized,
      }
    })
  }
  if (choices && new Set(choices.map(({ value }) => value)).size !== choices.length) {
    throw new Error(`${label} contains duplicate choices`)
  }
  return choices
}

function defaultDescription(input: Record<string, unknown>, id: string, required: boolean) {
  return {
    ...(displayText(input.description, 500) ? { description: displayText(input.description, 500) } : {}),
    id,
    label: displayText(input.title, 120) ?? id,
    required,
  }
}

function normalizeProperty(id: string, value: unknown, required: boolean): GenerationToolInputField | undefined {
  if (!isRecord(value)) {
    if (required) throw new Error(`Required generation tool input ${id} must have an object schema`)
    return undefined
  }
  const label = `Generation tool input ${id}`
  const choices = choicesFromSchema(value, label)
  const type = value.type
  if (choices) {
    if (type !== undefined && type !== "string") {
      throw new Error(`${label} select choices must use string values`)
    }
    const minLength = optionalSafeInteger(value.minLength, `${label} minLength`, 0)
    const maxLength = optionalSafeInteger(value.maxLength, `${label} maxLength`, maximumGenerationToolStringLength)
    if (
      minLength > maxLength ||
      choices.some(({ value: choice }) => choice.length < minLength || choice.length > maxLength)
    ) {
      throw new Error(`${label} choices do not satisfy its string range`)
    }
    const defaultValue = value.default === undefined ? undefined : choiceValue(value.default, `${label} default`)
    if (defaultValue !== undefined && !choices.some(({ value: choice }) => choice === defaultValue)) {
      throw new Error(`${label} default is not a declared choice`)
    }
    return {
      ...defaultDescription(value, id, required),
      choices,
      ...(defaultValue === undefined ? {} : { defaultValue }),
      kind: "select",
    }
  }
  if (type === "string") {
    if (value.pattern !== undefined || value.format !== undefined) {
      if (required) throw new Error(`${label} uses unsupported string constraints`)
      return undefined
    }
    const minLength = optionalSafeInteger(value.minLength, `${label} minLength`, 0)
    const maxLength = optionalSafeInteger(value.maxLength, `${label} maxLength`, maximumGenerationToolStringLength)
    if (minLength > maxLength) throw new Error(`${label} has an invalid string range`)
    let defaultValue: string | undefined
    if (value.default !== undefined) {
      if (
        typeof value.default !== "string" ||
        value.default.includes("\0") ||
        value.default.length > maximumGenerationToolStringLength
      ) {
        throw new Error(`${label} default must be a bounded string`)
      }
      defaultValue = value.default
    }
    if (defaultValue !== undefined && (defaultValue.length < minLength || defaultValue.length > maxLength)) {
      throw new Error(`${label} default is outside its string range`)
    }
    return {
      ...defaultDescription(value, id, required),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      kind: "text",
      maxLength,
      minLength,
    }
  }
  if (type === "number" || type === "integer") {
    if (
      value.enum !== undefined ||
      value.oneOf !== undefined ||
      value.exclusiveMinimum !== undefined ||
      value.exclusiveMaximum !== undefined ||
      value.multipleOf !== undefined
    ) {
      if (required) throw new Error(`${label} uses unsupported numeric constraints`)
      return undefined
    }
    const minimum = optionalFiniteNumber(value.minimum, `${label} minimum`, -maximumGenerationToolNumberMagnitude)
    const maximum = optionalFiniteNumber(value.maximum, `${label} maximum`, maximumGenerationToolNumberMagnitude)
    if (minimum > maximum) throw new Error(`${label} has an invalid numeric range`)
    if (type === "integer" && (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum))) {
      throw new Error(`${label} integer range must use safe integers`)
    }
    let defaultValue: number | undefined
    if (value.default !== undefined) {
      if (typeof value.default !== "number" || !Number.isFinite(value.default)) {
        throw new Error(`${label} default must be a number`)
      }
      defaultValue = value.default
      if (
        defaultValue < minimum ||
        defaultValue > maximum ||
        (type === "integer" && !Number.isSafeInteger(defaultValue))
      ) {
        throw new Error(`${label} default is outside its numeric range`)
      }
    }
    return {
      ...defaultDescription(value, id, required),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      kind: type,
      maximum,
      minimum,
    }
  }
  if (type === "boolean") {
    if (value.default !== undefined && typeof value.default !== "boolean") {
      throw new Error(`${label} default must be a boolean`)
    }
    return {
      ...defaultDescription(value, id, required),
      ...(value.default === undefined ? {} : { defaultValue: value.default }),
      kind: "boolean",
    }
  }
  if (required) throw new Error(`Required generation tool input ${id} is not a supported scalar field`)
  return undefined
}

/**
 * Projects a raw MCP inputSchema into a small renderer-safe form. The raw JSON
 * Schema, host paths and fixed generation envelope fields never cross preload.
 */
export function normalizeGenerationToolInputSchema(
  toolId: string,
  inputSchema: Record<string, unknown>,
): GenerationToolDescription {
  const serialized = JSON.stringify(inputSchema)
  if (Buffer.byteLength(serialized, "utf8") > maximumGenerationToolSchemaBytes) {
    throw new Error("Generation tool input schema is too large")
  }
  if (inputSchema.type !== undefined && inputSchema.type !== "object") {
    throw new Error("Generation tool input schema must describe an object")
  }
  if (inputSchema.properties !== undefined && !isRecord(inputSchema.properties)) {
    throw new Error("Generation tool input schema properties must be an object")
  }
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {}
  let required = new Set<string>()
  if (inputSchema.required !== undefined) {
    if (
      !Array.isArray(inputSchema.required) ||
      inputSchema.required.length > maximumGenerationToolFields + hostReservedGenerationInputFields.size ||
      new Set(inputSchema.required).size !== inputSchema.required.length
    ) {
      throw new Error("Generation tool input schema required fields are invalid")
    }
    const fields: string[] = []
    for (const field of inputSchema.required) {
      if (typeof field !== "string") throw new Error("Generation tool input schema required fields are invalid")
      fields.push(field)
    }
    required = new Set(fields)
  }
  const customEntries = Object.entries(properties).filter(([id]) => !hostReservedGenerationInputFields.has(id))
  if (customEntries.length > maximumGenerationToolFields) {
    throw new Error(`Generation tool input schema exposes more than ${maximumGenerationToolFields} custom fields`)
  }
  for (const id of required) {
    if (hostReservedGenerationInputFields.has(id)) continue
    if (!generationToolInputIdPattern.test(id)) {
      throw new Error("Generation tool input schema contains an invalid required field id")
    }
    if (!Object.prototype.hasOwnProperty.call(properties, id)) {
      throw new Error(`Required generation tool input ${id} has no property schema`)
    }
  }
  const fields: GenerationToolInputField[] = []
  for (const [id, schema] of customEntries) {
    if (!generationToolInputIdPattern.test(id) || hostReservedGenerationInputFields.has(id)) {
      throw new Error("Generation tool input schema contains an invalid custom field id")
    }
    const field = normalizeProperty(id, schema, required.has(id))
    if (field) fields.push(field)
  }
  return { fields, toolId }
}

function validateValue(field: GenerationToolInputField, value: unknown): GenerationToolInputValue {
  if (field.kind === "select") {
    if (typeof value !== "string" || !field.choices.some((choice) => choice.value === value)) {
      throw new Error(`Generation tool input ${field.id} must be one of its declared choices`)
    }
    return value
  }
  if (field.kind === "text") {
    if (
      typeof value !== "string" ||
      value.includes("\0") ||
      value.length < field.minLength ||
      value.length > field.maxLength
    ) {
      throw new Error(`Generation tool input ${field.id} is outside its string range`)
    }
    return value
  }
  if (field.kind === "boolean") {
    if (typeof value !== "boolean") throw new Error(`Generation tool input ${field.id} must be a boolean`)
    return value
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < field.minimum ||
    value > field.maximum ||
    (field.kind === "integer" && !Number.isSafeInteger(value))
  ) {
    throw new Error(`Generation tool input ${field.id} is outside its numeric range`)
  }
  return value
}

/** Validate without applying schema defaults: omission remains the host's Auto state. */
export function validateGenerationToolInput(
  description: GenerationToolDescription,
  value: GenerationToolInput | undefined,
): Record<string, GenerationToolInputValue> {
  const input = validateGenerationToolInputShape(value)
  const entries = Object.entries(input)
  const fields = new Map(description.fields.map((field) => [field.id, field]))
  const normalized: Array<[string, GenerationToolInputValue]> = []
  for (const [id, inputValue] of entries) {
    if (hostReservedGenerationInputFields.has(id)) {
      throw new Error(`Generation tool input cannot override host field: ${id}`)
    }
    const field = fields.get(id)
    if (!field) throw new Error(`Generation tool input is not declared by the current MCP tool: ${id}`)
    normalized.push([id, validateValue(field, inputValue)])
  }
  for (const field of description.fields) {
    if (field.required && !Object.prototype.hasOwnProperty.call(input, field.id)) {
      throw new Error(`Generation tool input is required: ${field.id}`)
    }
  }
  return Object.fromEntries(normalized)
}

/** Cheap trust-boundary validation performed before request fingerprinting or tool startup. */
export function validateGenerationToolInputShape(value: unknown): Record<string, GenerationToolInputValue> {
  if (value === undefined) return {}
  if (!isPlainRecord(value)) throw new Error("Generation tool input must be a plain object")
  const entries = Object.entries(value)
  if (entries.length > maximumGenerationToolFields) throw new Error("Generation tool input contains too many fields")
  return Object.fromEntries(
    entries.map(([id, inputValue]) => {
      if (!generationToolInputIdPattern.test(id)) throw new Error("Generation tool input contains an invalid field id")
      if (hostReservedGenerationInputFields.has(id)) {
        throw new Error(`Generation tool input cannot override host field: ${id}`)
      }
      if (typeof inputValue === "string") {
        if (inputValue.length > maximumGenerationToolStringLength || inputValue.includes("\0")) {
          throw new Error(`Generation tool input value is invalid: ${id}`)
        }
      } else if (typeof inputValue === "number") {
        if (!Number.isFinite(inputValue) || Math.abs(inputValue) > maximumGenerationToolNumberMagnitude) {
          throw new Error(`Generation tool input value is invalid: ${id}`)
        }
      } else if (typeof inputValue !== "boolean") {
        throw new Error(`Generation tool input value is invalid: ${id}`)
      }
      return [id, inputValue]
    }),
  )
}
