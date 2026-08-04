import { describe, expect, test } from "bun:test"
import {
  CANVAS_UNDOABLE_INTENT_KINDS_V2,
  planCanvasHistoryDerivedOrdinalsV2,
  scheduleCanvasHistoryTemplatesV2,
} from "./history-schedule"
import type { CanvasHistoryTemplateV2, PluginRequirementV2 } from "./types"
import { context, digest } from "./test-fixtures.test"
import { derivedNodeRefV2 } from "./validation"
import { parseUint32V2 } from "@convax/collaboration"

const U0 = parseUint32V2("0")
const EXTERNAL = derivedNodeRefV2(context(90, 90, 90), U0)
const PLUGIN: PluginRequirementV2 = {
  pluginId: "plugin",
  snapshotDigest: digest(1),
  pluginStateSchemaDigest: digest(2),
  validationArtifact: { owner: "plugin", format: "convax.plugin-validation-artifact/2", artifactDigest: digest(3) },
}

describe("Canvas semantic-history deterministic schedule", () => {
  test("closes exactly the frozen 14 undoable intent families", () => {
    expect(CANVAS_UNDOABLE_INTENT_KINDS_V2).toHaveLength(14)
    expect(new Set(CANVAS_UNDOABLE_INTENT_KINDS_V2).size).toBe(14)
  })

  test("reproduces Vector F minimum-handle Kahn order and contiguous ordinal plan", () => {
    const templates = [
      group("g/2", { mode: "external", ref: EXTERNAL }, "n/2"),
      group("g/1", { mode: "handle", handle: "n/0" }, "n/1"),
      group("g/0", { mode: "external", ref: EXTERNAL }, "n/0"),
    ] satisfies readonly CanvasHistoryTemplateV2[]
    const bindings = ["n/0", "n/1", "n/2"].map((handle) => ({ handle, ref: null }))

    const scheduled = scheduleCanvasHistoryTemplatesV2(templates, bindings)
    expect(
      scheduled.map((template) => (template.op === "creation-group.restore" ? template.groupHandle : template.op)),
    ).toEqual(["g/0", "g/1", "g/2"])
    expect(planCanvasHistoryDerivedOrdinalsV2(templates, bindings)).toEqual([
      { ordinal: parseUint32V2("0"), kind: "creation-group", handle: "g/0" },
      { ordinal: parseUint32V2("1"), kind: "node", handle: "n/0" },
      { ordinal: parseUint32V2("2"), kind: "creation-group", handle: "g/1" },
      { ordinal: parseUint32V2("3"), kind: "node", handle: "n/1" },
      { ordinal: parseUint32V2("4"), kind: "creation-group", handle: "g/2" },
      { ordinal: parseUint32V2("5"), kind: "node", handle: "n/2" },
    ])
  })

  test("permutations are identical and duplicate producers, late producers and cycles fail before allocation", () => {
    const canonical = [
      group("g/0", { mode: "external", ref: EXTERNAL }, "n/0"),
      group("g/1", { mode: "handle", handle: "n/0" }, "n/1"),
      group("g/2", { mode: "external", ref: EXTERNAL }, "n/2"),
    ] satisfies readonly CanvasHistoryTemplateV2[]
    const bindings = ["n/0", "n/1", "n/2"].map((handle) => ({ handle, ref: null }))
    for (const permutation of permutations(canonical)) {
      expect(scheduleCanvasHistoryTemplatesV2(permutation, bindings).map(groupHandle)).toEqual(["g/0", "g/1", "g/2"])
    }

    expect(() =>
      scheduleCanvasHistoryTemplatesV2([...canonical, { ...canonical[0]!, groupHandle: "g/3" }], bindings),
    ).toThrow("duplicate producer")
    expect(() =>
      scheduleCanvasHistoryTemplatesV2(
        [group("g/0", { mode: "handle", handle: "n/1" }, "n/0"), pending("n/1")],
        [
          { handle: "n/0", ref: null },
          { handle: "n/1", ref: null },
        ],
      ),
    ).toThrow("missing or late producer")
    const cycle = [
      group("g/0", { mode: "handle", handle: "n/1" }, "n/0"),
      group("g/1", { mode: "handle", handle: "n/0" }, "n/1"),
    ] satisfies readonly CanvasHistoryTemplateV2[]
    expect(() => planCanvasHistoryDerivedOrdinalsV2(cycle, bindings.slice(0, 2))).toThrow("dependency cycle")
  })
})

function group(
  groupHandle: string,
  source: Extract<CanvasHistoryTemplateV2, { op: "creation-group.restore" }>["source"],
  handle: string,
): Extract<CanvasHistoryTemplateV2, { op: "creation-group.restore" }> {
  return {
    op: "creation-group.restore",
    groupHandle,
    source,
    sourceDataDigest: digest(4),
    plugin: PLUGIN,
    nodes: [{ handle, snapshot: nodeSnapshot(handle) }],
    edges: [],
  }
}

function pending(node: string): Extract<CanvasHistoryTemplateV2, { op: "pending-generation.restore" }> {
  return {
    op: "pending-generation.restore",
    node,
    edges: [],
    generationId: `g_${"A".repeat(43)}`,
    fallbackTitle: "pending",
    expectedClass: "image",
    position: { x: 0, y: 0 },
    size: { width: 10, height: 10 },
  }
}

function nodeSnapshot(title: string) {
  return {
    role: "agent" as const,
    position: { x: 0, y: 0 },
    size: { width: 10, height: 10 },
    data: { format: "convax.canvas-node-data/2" as const, kind: "agent" as const, title, instructions: null },
    plugin: { format: "convax.canvas-plugin-state/2" as const, ...PLUGIN, state: {} },
    resource: null,
  }
}

function groupHandle(template: CanvasHistoryTemplateV2): string {
  return template.op === "creation-group.restore" ? template.groupHandle : template.op
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [values.slice()]
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
  )
}
