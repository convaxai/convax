import { describe, expect, test } from "bun:test"
import {
  encodeRestrictedJcsV2,
  parseUint64V2,
  type DecodedCausalEditFrameV2,
  type DecodedCausalEditFrameV3,
} from "@convax/collaboration"

import { requiredCanvasBlobDigestsV2 } from "./blob-dependencies"
import type { CanvasTypedIntentUnionV2 } from "./types"
import { derivedNodeRefV2 } from "./validation"
import { context, digest, U0 } from "./test-fixtures.test"

describe("Canvas required blob dependency extraction", () => {
  test("admits native V3 frames without a V2 transcode boundary", () => {
    const successorExtractor: (frame: DecodedCausalEditFrameV3) => readonly string[] =
      requiredCanvasBlobDigestsV2
    expect(successorExtractor).toBe(requiredCanvasBlobDigestsV2)
  })

  test("extracts, sorts and deduplicates Host resource content while ignoring opaque Plugin state", () => {
    const operation = context(4, 5, 6)
    const node = derivedNodeRefV2(operation, U0)
    const resource = {
      format: "convax.canvas-resource-ref/2" as const,
      uri: `convax-project://project/epochs/${operation.scope.projectEpoch}/entries/pf_${"1".repeat(64)}?blob=sha256%3A${"a".repeat(64)}`,
      mediaClass: "image" as const,
      mime: "image/png",
      byteLength: parseUint64V2("12"),
      contentDigest: digest(42),
      ownerProofDigest: digest(43),
    }
    const intent: CanvasTypedIntentUnionV2 = {
      format: "convax.typed-intent/2",
      kind: "canvas.nodes.create/2",
      guard: { ordinal: U0, node, expectedAbsent: true },
      body: { node: {
        ordinal: U0, nodeId: node.id, incarnation: node.incarnation, role: "file",
        position: { x: 1, y: 2 }, size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data/2", kind: "resource", title: "A", resource },
        plugin: {
          format: "convax.canvas-plugin-state/2",
          pluginId: "plugin.example",
          snapshotDigest: digest(50),
          pluginStateSchemaDigest: digest(51),
          validationArtifact: { owner: "plugin", format: "convax.plugin-state-schema/1", artifactDigest: digest(51) },
          state: { opaqueResourceLookalike: { ...resource, contentDigest: digest(99) } },
        },
      } },
    }
    expect(requiredCanvasBlobDigestsV2(frame(intent))).toEqual([digest(42)])
  })

  test("rejects another owner, intent-kind substitution and noncanonical exact bytes", () => {
    const operation = context(1, 2, 3)
    const node = derivedNodeRefV2(operation, U0)
    const intent: CanvasTypedIntentUnionV2 = {
      format: "convax.typed-intent/2",
      kind: "canvas.nodes.create/2",
      guard: { ordinal: U0, node, expectedAbsent: true },
      body: { node: {
        ordinal: U0, nodeId: node.id, incarnation: node.incarnation, role: "agent",
        position: { x: 1, y: 2 }, size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data/2", kind: "agent", title: "A", instructions: null }, plugin: null,
      } },
    }
    expect(() => requiredCanvasBlobDigestsV2(frame(intent, { docKind: "project-index" }))).toThrow("another document owner")
    expect(() => requiredCanvasBlobDigestsV2(frame(intent, { intentKind: "canvas.metadata.update/2" }))).toThrow("intent kind")
    const noncanonical = frame(intent)
    ;(noncanonical.sections as { typedIntentJcs: Uint8Array }).typedIntentJcs = new TextEncoder().encode(
      new TextDecoder().decode(noncanonical.sections.typedIntentJcs).replace("{", "{ "),
    )
    expect(() => requiredCanvasBlobDigestsV2(noncanonical)).toThrow("canonical")
  })
})

function frame(
  intent: CanvasTypedIntentUnionV2,
  overrides: { docKind?: "canvas" | "project-index"; intentKind?: string } = {},
): DecodedCausalEditFrameV2 {
  const operation = context(1, 2, 3)
  return {
    header: { core: { scope: { ...operation.scope, docKind: overrides.docKind ?? "canvas" }, intentKind: overrides.intentKind ?? intent.kind } },
    sections: { typedIntentJcs: encodeRestrictedJcsV2(intent) },
  } as unknown as DecodedCausalEditFrameV2
}
