import { describe, expect, test } from "bun:test"
import {
  assertPortablePluginStateValueV1,
  canonicalPortablePluginStateSchemaBytesV1,
  parsePortablePluginStateSchemaV1,
  pluginStateSchemaDigestInputV1,
} from "./index"

const textDecoder = new TextDecoder()

describe("portable Plugin state schema", () => {
  test("normalizes the closed bounded dialect to one canonical byte representation", () => {
    const schema = parsePortablePluginStateSchemaV1({
      type: "object",
      maxProperties: "3",
      required: ["title", "count"],
      properties: {
        title: { type: "string", maxUtf8Bytes: "32", enum: ["二", "one"] },
        count: { type: "integer", minimum: "-2", maximum: "10" },
        tags: { type: "array", maxItems: "4", items: { type: "string", maxUtf8Bytes: "8" } },
      },
      additionalProperties: false,
    })

    expect(schema).toEqual({
      type: "object",
      maxProperties: "3",
      required: ["count", "title"],
      properties: {
        count: { type: "integer", minimum: "-2", maximum: "10" },
        tags: { type: "array", maxItems: "4", items: { type: "string", maxUtf8Bytes: "8" } },
        title: { type: "string", maxUtf8Bytes: "32", enum: ["one", "二"] },
      },
      additionalProperties: false,
    })
    expect(textDecoder.decode(pluginStateSchemaDigestInputV1(schema))).toStartWith("convax.plugin-state-schema/1\0{")
    expect(canonicalPortablePluginStateSchemaBytesV1(schema)).toEqual(
      canonicalPortablePluginStateSchemaBytesV1(structuredClone(schema)),
    )
  })

  test("validates state without defaults, coercion, unknown fields, or unsafe numbers", () => {
    const schema = parsePortablePluginStateSchemaV1({
      type: "object",
      maxProperties: "2",
      required: ["enabled"],
      properties: {
        enabled: { type: "boolean" },
        count: { type: "integer", minimum: "0", maximum: "3" },
      },
      additionalProperties: false,
    })
    expect(() => assertPortablePluginStateValueV1(schema, { enabled: true, count: 2 })).not.toThrow()
    expect(() => assertPortablePluginStateValueV1(schema, { count: 2 })).toThrow("required")
    expect(() => assertPortablePluginStateValueV1(schema, { enabled: true, future: 1 })).toThrow("unsupported")
    expect(() => assertPortablePluginStateValueV1(schema, { enabled: true, count: 4 })).toThrow("outside bounds")
    expect(() => assertPortablePluginStateValueV1(schema, { enabled: true, count: 1.5 })).toThrow("safe integer")
  })

  test("rejects executable/open schema features, aliases, cycles, and bound overflow", () => {
    expect(() => parsePortablePluginStateSchemaV1({ type: "string", maxUtf8Bytes: "01" })).toThrow("canonical")
    expect(() =>
      parsePortablePluginStateSchemaV1({
        type: "object",
        maxProperties: "1",
        required: [],
        properties: {},
        additionalProperties: true,
      }),
    ).toThrow("reject additional")
    expect(() => parsePortablePluginStateSchemaV1({ type: "number" })).toThrow("unsupported")
    expect(() => parsePortablePluginStateSchemaV1({ type: "string", maxUtf8Bytes: "1", default: "x" })).toThrow(
      "unsupported",
    )
    const cyclic: Record<string, unknown> = { type: "array", maxItems: "1" }
    cyclic.items = cyclic
    expect(() => parsePortablePluginStateSchemaV1(cyclic)).toThrow("cyclic")
  })
})
