import { describe, expect, test } from "bun:test"

import {
  assertPluginCapabilityRuntimeTools,
  assertPluginCapabilityValue,
  isPluginCapabilityContractCompatible,
  isPluginCapabilityVersionCompatible,
  parsePluginCapabilityDeclaration,
  renderPluginCapabilityReference,
} from "./capabilities"

const boundedObject = {
  additionalProperties: false,
  properties: {
    text: { maxLength: 128, type: "string" },
  },
  required: ["text"],
  type: "object",
} as const

describe("inter-Plugin capability contracts", () => {
  test("normalizes declarations and uses an explicit bounded SemVer interval", () => {
    const declaration = parsePluginCapabilityDeclaration({
      exports: [
        {
          docs: {
            request: "A bounded text request.",
            response: "A bounded text response.",
            summary: "Transforms text.",
          },
          id: "media.text.transform",
          inputSchema: boundedObject,
          operation: "text.transform",
          outputSchema: boundedObject,
          sideEffect: "execute",
          version: "1.4.0",
        },
      ],
      imports: {
        optional: [],
        required: [
          {
            id: "media.asset.inspect",
            inputSchema: boundedObject,
            outputSchema: boundedObject,
            version: { maximumExclusive: "2.0.0", minimum: "1.2.0" },
          },
        ],
      },
    })

    expect(declaration.exports[0]?.version).toBe("1.4.0")
    expect(isPluginCapabilityVersionCompatible("1.2.0", declaration.imports.required[0]!.version)).toBeTrue()
    expect(isPluginCapabilityVersionCompatible("1.9.9", declaration.imports.required[0]!.version)).toBeTrue()
    expect(isPluginCapabilityVersionCompatible("2.0.0", declaration.imports.required[0]!.version)).toBeFalse()
  })

  test("binds every export to one exact runtime MCP tool with identical closed schemas", () => {
    const declaration = parsePluginCapabilityDeclaration({
      exports: [
        {
          docs: { request: "Request.", response: "Response.", summary: "Summary." },
          id: "media.text.transform",
          inputSchema: boundedObject,
          operation: "text.transform",
          outputSchema: boundedObject,
          sideEffect: "execute",
          version: "1.0.0",
        },
      ],
      imports: { optional: [], required: [] },
    })
    expect(() =>
      assertPluginCapabilityRuntimeTools(declaration.exports, [
        {
          inputSchema: boundedObject,
          name: "text.transform",
          outputSchema: boundedObject,
        },
      ]),
    ).not.toThrow()
    expect(() =>
      assertPluginCapabilityRuntimeTools(declaration.exports, [
        { inputSchema: boundedObject, name: "text.transform" },
      ]),
    ).toThrow("must declare outputSchema")
    expect(() =>
      assertPluginCapabilityRuntimeTools(declaration.exports, [
        {
          inputSchema: {
            additionalProperties: false,
            properties: {},
            required: [],
            type: "object",
          },
          name: "text.transform",
          outputSchema: boundedObject,
        },
      ]),
    ).toThrow("input schema does not match")
  })

  test("requires import and export schemas to match in addition to SemVer", () => {
    const exported = parsePluginCapabilityDeclaration({
      exports: [
        {
          docs: { request: "Request.", response: "Response.", summary: "Summary." },
          id: "media.text.transform",
          inputSchema: boundedObject,
          operation: "text.transform",
          outputSchema: boundedObject,
          sideEffect: "execute",
          version: "1.0.0",
        },
      ],
      imports: { optional: [], required: [] },
    }).exports[0]!
    const imported = parsePluginCapabilityDeclaration({
      exports: [],
      imports: {
        optional: [],
        required: [
          {
            id: "media.text.transform",
            inputSchema: boundedObject,
            outputSchema: boundedObject,
            version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
          },
        ],
      },
    }).imports.required[0]!
    expect(isPluginCapabilityContractCompatible(imported, exported)).toBeTrue()
    expect(
      isPluginCapabilityContractCompatible(
        {
          ...imported,
          outputSchema: {
            additionalProperties: false,
            properties: {},
            required: [],
            type: "object",
          },
        },
        exported,
      ),
    ).toBeFalse()
  })

  test("rejects two exported capabilities sharing one provider MCP operation", () => {
    expect(() =>
      parsePluginCapabilityDeclaration({
        exports: ["one", "two"].map((suffix) => ({
          docs: { request: "Request.", response: "Response.", summary: "Summary." },
          id: `media.text.${suffix}`,
          inputSchema: boundedObject,
          operation: "text.transform",
          outputSchema: boundedObject,
          sideEffect: "execute",
          version: "1.0.0",
        })),
        imports: { optional: [], required: [] },
      }),
    ).toThrow("duplicate provider operation")
  })

  test("rejects unbounded or open object schemas and unknown declaration fields", () => {
    expect(() =>
      parsePluginCapabilityDeclaration({
        exports: [
          {
            docs: { request: "Request.", response: "Response.", summary: "Summary." },
            id: "media.text.transform",
            inputSchema: {
              additionalProperties: false,
              properties: { text: { type: "string" } },
              required: ["text"],
              type: "object",
            },
            operation: "text.transform",
            outputSchema: boundedObject,
            sideEffect: "execute",
            version: "1.0.0",
          },
        ],
        imports: { optional: [], required: [] },
      }),
    ).toThrow("maxLength")

    expect(() =>
      parsePluginCapabilityDeclaration({
        exports: [],
        imports: { optional: [], required: [], surprise: true },
      }),
    ).toThrow("unsupported or missing fields")
  })

  test("validates values recursively and rejects extra properties, unsafe numbers, and cycles", () => {
    expect(() => assertPluginCapabilityValue(boundedObject, { text: "ok" }, "request")).not.toThrow()
    expect(() => assertPluginCapabilityValue(boundedObject, { text: "ok", token: "secret" }, "request")).toThrow(
      "unsupported property",
    )
    expect(() =>
      assertPluginCapabilityValue(
        {
          additionalProperties: false,
          properties: { value: { type: "integer" } },
          required: ["value"],
          type: "object",
        },
        { value: Number.MAX_SAFE_INTEGER + 1 },
        "request",
      ),
    ).toThrow("safe integer")

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() =>
      assertPluginCapabilityValue(
        {
          additionalProperties: false,
          properties: {
            self: {
              additionalProperties: false,
              properties: {},
              required: [],
              type: "object",
            },
          },
          required: ["self"],
          type: "object",
        },
        cyclic,
        "request",
      ),
    ).toThrow("cyclic")
  })

  test("renders deterministic generated Skill reference content from the declaration", () => {
    const declaration = parsePluginCapabilityDeclaration({
      exports: [],
      imports: {
        optional: [
          {
            id: "media.asset.inspect",
            inputSchema: boundedObject,
            outputSchema: boundedObject,
            version: { maximumExclusive: "3.0.0", minimum: "2.1.0" },
          },
        ],
        required: [
          {
            id: "media.timeline.render",
            inputSchema: boundedObject,
            outputSchema: boundedObject,
            version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
          },
        ],
      },
    })
    const rendered = renderPluginCapabilityReference(declaration)
    expect(rendered).toContain("Generated by @convax/plugin-sdk. Do not edit.")
    expect(rendered).toContain("`media.timeline.render` | required | `>=1.0.0 <2.0.0`")
    expect(rendered).toContain("`media.asset.inspect` | optional | `>=2.1.0 <3.0.0`")
    expect(rendered).toContain("`createPluginHostClient` from `@convax/plugin-sdk/client`")
    expect(rendered).toContain("`client.invokeCapability(...)`")
    expect(rendered).toContain("`convax.plugin-capability/3` is Host-internal")
    expect(rendered).toContain('client.invokeCapability("media.timeline.render", input, { signal })')
    expect(rendered).toBe(renderPluginCapabilityReference(declaration))
  })
})
