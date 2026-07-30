import { describe, expect, test } from "bun:test"
import {
  PLUGIN_API_CATALOG_MAJOR,
  PLUGIN_API_CATALOG_VERSION,
  definePluginApi,
  definePluginApiCatalog,
  definePluginApiDeclaration,
  definePluginApiRelease,
  evaluatePluginApiAvailability,
  getPluginApiDefinition,
  getPluginApiRequirement,
  isPluginApiAvailable,
  isPluginApiCommitPreserving,
  isPluginApiDeclared,
  isPluginApiId,
  parsePluginApiDeclaration,
  parseRuntimePluginApiDeclaration,
  pluginApiCatalog,
  PluginApiUnavailableError,
  requirePluginApi,
  type PluginApiId,
  type PluginApiLiveContext,
} from "./index"

const minimalDefinition = {
  id: "test.operation",
  completion: "cancelable",
  grant: null,
  scope: "plugin",
  sideEffect: "read",
  errors: [],
  docs: {
    summary: "Test operation.",
    description: "A test-only operation.",
    request: "No parameters.",
    response: "An acknowledgement.",
  },
} as const

describe("Plugin API catalog", () => {
  test("has one immutable 1.0.0 contract for every stable id", () => {
    expect(PLUGIN_API_CATALOG_VERSION).toBe("1.0.0")
    expect(PLUGIN_API_CATALOG_MAJOR).toBe(1)
    expect(pluginApiCatalog.apis).toHaveLength(18)
    expect(new Set(pluginApiCatalog.apis.map((definition) => definition.id)).size).toBe(18)
    expect(pluginApiCatalog.apis.every((definition) => definition.since === "1.0.0")).toBe(true)
    expect(pluginApiCatalog.apis.every((definition) => definition.audience.includes("web-plugin"))).toBe(true)
    expect(
      pluginApiCatalog.apis
        .filter((definition) => definition.audience.includes("companion"))
        .map((definition) => definition.id)
        .sort(),
    ).toEqual(
      (
        [
          "projects.list",
          "canvas.catalog.list",
          "canvas.document.get",
          "canvas.nodes.query",
          "canvas.transaction.execute",
          "canvas.events.subscribe",
          "canvas.events.unsubscribe",
        ] as PluginApiId[]
      ).sort(),
    )
    expect(Object.isFrozen(pluginApiCatalog)).toBe(true)
    expect(Object.isFrozen(pluginApiCatalog.apis)).toBe(true)
    expect(isPluginApiId("canvas.inputs.open")).toBe(true)
    expect(isPluginApiId("unknown.api")).toBe(false)
    expect(getPluginApiDefinition("canvas.inputs.open").grant).toBe("canvas.connectedMedia.stream")
    expect(isPluginApiCommitPreserving("canvas.node.state.replace")).toBe(true)
    expect(isPluginApiCommitPreserving("canvas.inputs.close")).toBe(false)
  })

  test("assigns since from the release block and rejects ambiguous catalogs", () => {
    const definition = definePluginApi(minimalDefinition)
    const catalog = definePluginApiCatalog(definePluginApiRelease("2.3.0", [definition]))
    expect(catalog.apis[0].since).toBe("2.3.0")
    expect(catalog.apis[0].audience).toEqual(["web-plugin"])
    expect(() =>
      definePluginApiCatalog(
        definePluginApiRelease("2.3.0", [definition]),
        definePluginApiRelease("2.2.0", [{ ...definition, id: "test.second" }]),
      ),
    ).toThrow("strictly increasing")
    expect(() =>
      definePluginApiCatalog(
        definePluginApiRelease("2.3.0", [definition]),
        definePluginApiRelease("2.4.0", [definition]),
      ),
    ).toThrow("duplicated")
    const patchCatalog = definePluginApiCatalog(
      definePluginApiRelease("2.3.0", [definition]),
      definePluginApiRelease("2.3.1", []),
    )
    expect(patchCatalog.version).toBe("2.3.1")
    expect(patchCatalog.apis[0].since).toBe("2.3.0")
    expect(() => definePluginApiCatalog(definePluginApiRelease("2.3.1", []))).toThrow("at least one API")
  })
})

describe("Plugin API declarations", () => {
  test("validates required and optional sets", () => {
    const declaration = definePluginApiDeclaration({
      major: 1,
      required: ["host.context.get"],
      optional: ["canvas.inputs.list"],
    })
    expect(getPluginApiRequirement(declaration, "host.context.get")).toBe("required")
    expect(getPluginApiRequirement(declaration, "canvas.inputs.list")).toBe("optional")
    expect(getPluginApiRequirement(declaration, "agent.prompt")).toBeUndefined()
    expect(isPluginApiDeclared(declaration, "canvas.inputs.list")).toBe(true)
    expect(isPluginApiDeclared(declaration, "agent.prompt")).toBe(false)
  })

  test("fails closed for unknown, duplicate, overlapping, or wrong-major ids", () => {
    expect(() => parsePluginApiDeclaration({ major: 2, required: [], optional: [] })).toThrow("major must be 1")
    expect(() => parsePluginApiDeclaration({ major: 1, required: ["unknown.api"], optional: [] })).toThrow(
      "unknown Plugin API id",
    )
    expect(() =>
      parsePluginApiDeclaration({
        major: 1,
        required: ["host.context.get", "host.context.get"],
        optional: [],
      }),
    ).toThrow("duplicate")
    expect(() =>
      parsePluginApiDeclaration({
        major: 1,
        required: ["host.context.get"],
        optional: ["host.context.get"],
      }),
    ).toThrow("both required and optional")
    expect(() => parsePluginApiDeclaration({ major: 1, required: [], optional: [], extra: true })).toThrow(
      "unknown field",
    )
  })

  test("runtime parsing preserves valid future ids for negotiation and activation checks", () => {
    const declaration = parseRuntimePluginApiDeclaration({
      major: 1,
      required: ["future.required"],
      optional: ["future.optional"],
    })
    expect(declaration).toEqual({
      major: 1,
      required: ["future.required"],
      optional: ["future.optional"],
    })
    expect(() =>
      parseRuntimePluginApiDeclaration({
        major: 1,
        required: ["Invalid API"],
        optional: [],
      }),
    ).toThrow("invalid Plugin API id")
  })
})

describe("Plugin API availability", () => {
  test("narrows available results and throws structured unavailable results", () => {
    const available = {
      available: true,
      id: "host.context.get",
      since: "1.0.0",
      catalogVersion: "1.0.0",
    } as const
    expect(isPluginApiAvailable(available)).toBe(true)
    expect(requirePluginApi(available)).toBe(available)

    const unavailable = {
      available: false,
      id: "canvas.inputs.open",
      since: "1.0.0",
      reason: "permission-denied",
      recoverable: false,
    } as const
    expect(isPluginApiAvailable(unavailable)).toBe(false)
    expect(() => requirePluginApi(unavailable)).toThrow(PluginApiUnavailableError)
    try {
      requirePluginApi(unavailable)
    } catch (error) {
      expect(error).toBeInstanceOf(PluginApiUnavailableError)
      if (!(error instanceof PluginApiUnavailableError)) throw error
      expect(error.availability).toBe(unavailable)
    }
  })

  test("uses a stable fail-closed reason priority", () => {
    const declaration = definePluginApiDeclaration({
      major: 1,
      required: ["canvas.inputs.open"],
      optional: [],
    })
    const base: PluginApiLiveContext = {
      catalogVersion: "1.0.0",
      catalogMajor: 1,
      audience: "web-plugin",
      grants: ["canvas.connectedMedia.stream"],
      hasContext: true,
      setupComplete: true,
      disabled: false,
      recovering: false,
    }
    const reason = (context: PluginApiLiveContext): string => {
      const availability = evaluatePluginApiAvailability("canvas.inputs.open", declaration, context)
      return availability.available ? "available" : availability.reason
    }

    expect(reason({ ...base, catalogMajor: 2, audience: "agent-skill", grants: [], hasContext: false })).toBe(
      "unsupported-host",
    )
    const undeclared = definePluginApiDeclaration({ major: 1, required: [], optional: [] })
    expect(
      evaluatePluginApiAvailability("canvas.inputs.open", undeclared, {
        ...base,
        audience: "agent-skill",
        grants: [],
        hasContext: false,
      }),
    ).toMatchObject({ available: false, reason: "not-declared" })
    expect(reason({ ...base, audience: "agent-skill", grants: [], hasContext: false })).toBe("wrong-surface")
    expect(
      reason({ ...base, grants: [], hasContext: false, setupComplete: false, disabled: true, recovering: true }),
    ).toBe("permission-denied")
    expect(reason({ ...base, hasContext: false, setupComplete: false, disabled: true, recovering: true })).toBe(
      "missing-context",
    )
    expect(reason({ ...base, setupComplete: false, disabled: true, recovering: true })).toBe("setup-required")
    expect(reason({ ...base, disabled: true, recovering: true })).toBe("disabled")
    expect(reason({ ...base, recovering: true })).toBe("recovering")
    expect(reason(base)).toBe("available")
  })

  test("returns unsupported-host for unknown future optional and required ids", () => {
    const declaration = parseRuntimePluginApiDeclaration({
      major: 1,
      required: ["future.required"],
      optional: ["future.optional"],
    })
    const context: PluginApiLiveContext = {
      catalogVersion: "1.0.0",
      catalogMajor: 1,
      audience: "web-plugin",
      grants: [],
      hasContext: true,
      setupComplete: true,
      disabled: false,
      recovering: false,
    }
    expect(evaluatePluginApiAvailability("future.optional", declaration, context)).toEqual({
      available: false,
      id: "future.optional",
      reason: "unsupported-host",
      recoverable: false,
    })
    expect(evaluatePluginApiAvailability("future.required", declaration, context)).toEqual({
      available: false,
      id: "future.required",
      reason: "unsupported-host",
      recoverable: false,
    })
  })
})
