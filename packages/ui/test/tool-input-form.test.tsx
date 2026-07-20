import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  createToolInputDefaultValues,
  reconcileToolInputValues,
  ToolInputForm,
  type ToolInputField,
  validateToolInputValues,
} from "../src/components/tool-input-form"

const fields = [
  {
    choices: [
      { label: "Square", value: "1:1" },
      { label: "Landscape", value: "16:9" },
    ],
    defaultValue: "16:9",
    description: "Output frame shape",
    id: "aspect_ratio",
    kind: "select",
    label: "Aspect ratio",
    required: true,
  },
  {
    id: "negative_prompt",
    kind: "text",
    label: "Negative prompt",
    maxLength: 200,
    minLength: 0,
    required: false,
  },
  {
    id: "steps",
    kind: "integer",
    label: "Steps",
    maximum: 50,
    minimum: 1,
    required: true,
  },
  {
    defaultValue: false,
    id: "loop",
    kind: "boolean",
    label: "Loop",
    required: false,
  },
] as const satisfies readonly ToolInputField[]

describe("ToolInputForm", () => {
  test("renders normalized scalar fields without media-specific knowledge", () => {
    const markup = renderToStaticMarkup(
      <ToolInputForm
        fields={fields}
        layout="inline"
        onValuesChange={mock(() => undefined)}
        values={{ aspect_ratio: "1:1", loop: true, steps: 12 }}
      />,
    )

    expect(markup).toContain('data-tool-input-form="true"')
    expect(markup).toContain('data-tool-input-layout="inline"')
    expect(markup).toContain("Aspect ratio")
    expect(markup).toContain("Square")
    expect(markup).toContain("Negative prompt")
    expect(markup).toContain('maxLength="200"')
    expect(markup).toContain('type="number"')
    expect(markup).toContain('min="1"')
    expect(markup).toContain('max="50"')
    expect(markup).toContain('step="1"')
    expect(markup).toContain("Loop")
    expect(markup).toContain("Yes")
    expect(markup).not.toContain("Output frame shape")
  })

  test("shows field descriptions in the full grid layout", () => {
    const markup = renderToStaticMarkup(<ToolInputForm fields={fields} onValuesChange={() => undefined} values={{}} />)

    expect(markup).toContain('data-tool-input-layout="grid"')
    expect(markup).toContain("Output frame shape")
  })

  test("applies declared defaults and drops values that do not belong to a new schema", () => {
    expect(createToolInputDefaultValues(fields)).toEqual({
      aspect_ratio: "16:9",
      loop: false,
    })
    expect(
      reconcileToolInputValues(fields, {
        aspect_ratio: "4:3",
        loop: true,
        obsolete: "value",
        steps: 20,
      }),
    ).toEqual({ loop: true, steps: 20 })
  })

  test("validates required fields, scalar kinds, enum choices, and numeric bounds", () => {
    expect(
      validateToolInputValues(fields, {
        aspect_ratio: "1:1",
        loop: false,
        steps: 25,
      }),
    ).toEqual({
      input: { aspect_ratio: "1:1", loop: false, steps: 25 },
      invalidFieldIds: [],
      missingRequiredFieldIds: [],
      valid: true,
    })

    expect(
      validateToolInputValues(fields, {
        aspect_ratio: "4:3",
        obsolete: "value",
        steps: 50.5,
      }),
    ).toEqual({
      input: {},
      invalidFieldIds: ["obsolete", "aspect_ratio", "steps"],
      missingRequiredFieldIds: [],
      valid: false,
    })
    expect(validateToolInputValues(fields, createToolInputDefaultValues(fields))).toMatchObject({
      missingRequiredFieldIds: ["steps"],
      valid: false,
    })
  })
})
