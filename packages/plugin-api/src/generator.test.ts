import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pluginApiCatalog } from "./catalog"
import { PLUGIN_API_CATALOG_ARTIFACT_SCHEMA } from "./catalog-artifact"
import {
  appendPluginApiHistory,
  checkPluginApiCompatibility,
  generatePluginApiArtifacts,
  parsePluginApiCatalogArtifact,
  renderPluginApiJson,
  renderPluginApiMarkdown,
  snapshotPluginApiCatalog,
  type PluginApiCatalogSnapshot,
  type PluginApiDefinitionSnapshot,
} from "./generator"

function versioned(version: `${number}.${number}.${number}`): PluginApiCatalogSnapshot {
  return { ...snapshotPluginApiCatalog(pluginApiCatalog), version }
}

describe("Plugin API compatibility", () => {
  test("requires minor for additions and major for breaking changes", () => {
    const previous = versioned("1.0.0")
    const added: PluginApiDefinitionSnapshot = {
      id: "test.added",
      since: "1.0.1",
      audience: ["web-plugin"],
      completion: "cancelable",
      grant: null,
      scope: "plugin",
      sideEffect: "read",
      errors: [],
      docs: {
        summary: "Added.",
        description: "Added API.",
        request: "None.",
        response: "None.",
      },
      contract: snapshotPluginApiCatalog(pluginApiCatalog).apis[0].contract,
    }
    expect(checkPluginApiCompatibility(previous, { ...versioned("1.0.1"), apis: [...previous.apis, added] })).toEqual([
      expect.objectContaining({ kind: "api-added", apiId: "test.added" }),
    ])
    expect(
      checkPluginApiCompatibility(previous, {
        ...versioned("1.1.0"),
        apis: [...previous.apis, { ...added, since: "1.1.0" }],
      }),
    ).toEqual([])

    const removed = { ...versioned("1.1.0"), apis: previous.apis.slice(1) }
    expect(checkPluginApiCompatibility(previous, removed)).toEqual([expect.objectContaining({ kind: "api-removed" })])
    expect(checkPluginApiCompatibility(previous, { ...removed, version: "2.0.0" })).toEqual([])

    const changed = {
      ...versioned("1.1.0"),
      apis: previous.apis.map((definition, index) =>
        index === 0 ? { ...definition, grant: "changed.grant" } : definition,
      ),
    }
    expect(checkPluginApiCompatibility(previous, changed)).toEqual([expect.objectContaining({ kind: "api-changed" })])
    expect(checkPluginApiCompatibility(previous, { ...changed, version: "2.0.0" })).toEqual([])

    const documentationPatch = {
      ...versioned("1.0.1"),
      apis: previous.apis.map((definition, index) =>
        index === 0 ? { ...definition, docs: { ...definition.docs, summary: "Corrected documentation." } } : definition,
      ),
    }
    expect(checkPluginApiCompatibility(previous, documentationPatch)).toEqual([])

    const rewrittenSince = {
      ...versioned("2.0.0"),
      apis: previous.apis.map((definition, index) =>
        index === 0 ? { ...definition, since: "2.0.0" as const } : definition,
      ),
    }
    expect(checkPluginApiCompatibility(previous, rewrittenSince)).toEqual([
      expect.objectContaining({ kind: "api-changed", message: expect.stringContaining("since is immutable") }),
    ])
  })

  test("treats nested schema bounds and enums as breaking ABI", () => {
    const previous = versioned("1.0.0")
    const changed = structuredClone(previous) as any
    changed.version = "1.0.1"
    const image = changed.apis.find(({ id }: { id: string }) => id === "canvas.resource.image.create")!
    const request = image.contract.request.schema
    if (!("properties" in request) || !("maxLength" in request.properties.dataUrl)) {
      throw new Error("expected image request string schema")
    }
    request.properties.dataUrl.maxLength -= 1
    expect(checkPluginApiCompatibility(previous, changed)).toEqual([
      expect.objectContaining({ kind: "api-changed", apiId: "canvas.resource.image.create" }),
    ])

    const enumChanged = structuredClone(previous) as any
    enumChanged.version = "1.0.1"
    const generation = enumChanged.apis.find(({ id }: { id: string }) => id === "generation.execute")!
    const generationRequest = generation.contract.request.schema
    if (!("properties" in generationRequest) || !("enum" in generationRequest.properties.resultMode)) {
      throw new Error("expected generation resultMode enum schema")
    }
    generationRequest.properties.resultMode.enum = ["return"]
    expect(checkPluginApiCompatibility(previous, enumChanged)).toEqual([
      expect.objectContaining({ kind: "api-changed", apiId: "generation.execute" }),
    ])
  })
})

describe("Plugin API generation", () => {
  test("renders stable sorted JSON and complete Markdown fields", () => {
    const json = renderPluginApiJson()
    expect(json).toBe(renderPluginApiJson())
    expect(parsePluginApiCatalogArtifact(JSON.parse(json)).schema).toBe(PLUGIN_API_CATALOG_ARTIFACT_SCHEMA)
    expect(json.indexOf('"id": "agent.prompt"')).toBeLessThan(json.indexOf('"id": "host.context.get"'))
    const markdown = renderPluginApiMarkdown()
    expect(markdown).toContain("| API | Since | Audience | Grant | Scope | Side effect | Completion | Errors |")
    expect(markdown).toContain("`canvas.inputs.open`")
    expect(markdown).toContain("`resource-unavailable`")
    expect(markdown).toContain("Request schema: closed object: `ref (required)`, `projection (optional)`")
    expect(markdown).toContain(
      "Response schema: closed object: `document (required)`, `projection (required)`, `ref (required)`, `storageVersion (required)`",
    )
    expect(markdown).toContain("#### Request contract")
    expect(markdown).toContain('"maxLength": 25165824')
    expect(markdown).toContain('"enum": [')
    expect(markdown).toContain("Completion: commit-preserving")
    const tampered = JSON.parse(json)
    tampered.apis[0].contract.digest = `sha256:${"0".repeat(64)}`
    expect(() => parsePluginApiCatalogArtifact(tampered)).toThrow("digest does not match")

    const retired = JSON.parse(json)
    retired.schema = "convax.plugin-api-catalog/1"
    expect(() => parsePluginApiCatalogArtifact(retired)).toThrow("is not a Plugin API catalog snapshot")

    const extended = JSON.parse(json)
    extended.v1 = { copiedConsumerSchema: true }
    expect(() => parsePluginApiCatalogArtifact(extended)).toThrow("unknown field: v1")

    const futureDialect = JSON.parse(json)
    futureDialect.apis[0].contract.dialect = "convax.plugin-api-wire-schema/999"
    expect(() => parsePluginApiCatalogArtifact(futureDialect)).toThrow("dialect is invalid")

    const nonFiniteConst = JSON.parse(json)
    const state = nonFiniteConst.apis.find(({ id }: { id: string }) => id === "canvas.node.state.replace")
    state.contract.result.schema.properties.updated.const = Number.NaN
    expect(() => parsePluginApiCatalogArtifact(nonFiniteConst)).toThrow("const is invalid")

    const nonFiniteMinimum = JSON.parse(json)
    const image = nonFiniteMinimum.apis.find(({ id }: { id: string }) => id === "canvas.resource.image.create")
    image.contract.result.schema.properties.revision.minimum = Number.POSITIVE_INFINITY
    expect(() => parsePluginApiCatalogArtifact(nonFiniteMinimum)).toThrow("number contract is invalid")
  })

  test("--check reports drift without creating or changing files", async () => {
    const root = mkdtempSync(join(tmpdir(), "convax-plugin-api-generator-"))
    const historyDirectory = join(root, "history")
    const outputDirectory = join(root, "generated")
    try {
      await appendPluginApiHistory(historyDirectory)
      const missing = await generatePluginApiArtifacts({ historyDirectory, outputDirectory, check: true })
      expect(missing.changed).toHaveLength(2)
      expect(existsSync(outputDirectory)).toBe(false)

      await generatePluginApiArtifacts({ historyDirectory, outputDirectory })
      const path = join(outputDirectory, "plugin-api.md")
      writeFileSync(path, "stale\n")
      const before = readFileSync(path, "utf8")
      const drift = await generatePluginApiArtifacts({ historyDirectory, outputDirectory, check: true })
      expect(drift.changed).toEqual([path])
      expect(readFileSync(path, "utf8")).toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("rejects mutation of the append-only current history snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "convax-plugin-api-history-"))
    const historyDirectory = join(root, "history")
    try {
      const path = await appendPluginApiHistory(historyDirectory)
      const history = JSON.parse(readFileSync(path, "utf8"))
      history.apis[0].docs.summary = "Mutated in place."
      writeFileSync(path, JSON.stringify(history))
      try {
        await generatePluginApiArtifacts({
          historyDirectory,
          outputDirectory: join(root, "generated"),
          check: true,
        })
        throw new Error("expected immutable history rejection")
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError)
        expect(error instanceof Error ? error.message : "").toContain("differs from its immutable history snapshot")
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
