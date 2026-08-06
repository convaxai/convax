import { describe, expect, test } from "bun:test"
import {
  encodeRestrictedJcs,
  parseUint64,
  type DecodedCausalEditFrame,
} from "@convax/collaboration"

import { requiredCanvasBlobDigests } from "./blob-dependencies"
import type { CanvasTypedIntentUnion } from "./types"
import { derivedNodeRef } from "./validation"
import { context, digest, U0 } from "./test-fixtures.test"

describe("Canvas required blob dependency extraction", () => {
  test("extracts, sorts and deduplicates Host resource content while ignoring opaque Plugin state", () => {
    const operation = context(4, 5, 6)
    const node = derivedNodeRef(operation, U0)
    const resource = {
      format: "convax.canvas-resource-ref" as const,
      uri: `convax-project://project/epochs/${operation.scope.projectEpoch}/entries/pf_${"1".repeat(64)}?blob=sha256%3A${"a".repeat(64)}`,
      mediaClass: "image" as const,
      mime: "image/png",
      byteLength: parseUint64("12"),
      contentDigest: digest(42),
      ownerProofDigest: digest(43),
    }
    const intent: CanvasTypedIntentUnion = {
      format: "convax.typed-intent",
      kind: "canvas.agent.create",
      guard: { ordinal: U0, node, expectedAbsent: true },
      body: { node: {
        ordinal: U0, nodeId: node.id, incarnation: node.incarnation, role: "file",
        position: { x: 1, y: 2 }, size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data", kind: "resource", title: "A", resource },
        plugin: {
          format: "convax.canvas-plugin-state",
          pluginId: "plugin.example",
          snapshotDigest: digest(50),
          pluginStateSchemaDigest: digest(51),
          validationArtifact: { owner: "plugin", format: "convax.plugin-state-schema/1", artifactDigest: digest(51) },
          state: { opaqueResourceLookalike: { ...resource, contentDigest: digest(99) } },
        },
      } },
    }
    expect(requiredCanvasBlobDigests(frame(intent))).toEqual([digest(42)])
  })

  test("rejects another owner, intent-kind substitution and noncanonical exact bytes", () => {
    const operation = context(1, 2, 3)
    const node = derivedNodeRef(operation, U0)
    const intent: CanvasTypedIntentUnion = {
      format: "convax.typed-intent",
      kind: "canvas.agent.create",
      guard: { ordinal: U0, node, expectedAbsent: true },
      body: { node: {
        ordinal: U0, nodeId: node.id, incarnation: node.incarnation, role: "agent",
        position: { x: 1, y: 2 }, size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data", kind: "agent", title: "A", instructions: null }, plugin: null,
      } },
    }
    expect(() => requiredCanvasBlobDigests(frame(intent, { docKind: "project-index" }))).toThrow("another document owner")
    expect(() => requiredCanvasBlobDigests(frame(intent, { intentKind: "canvas.metadata.update" }))).toThrow("intent kind")
    const noncanonical = frame(intent)
    ;(noncanonical.sections as { typedIntentJcs: Uint8Array }).typedIntentJcs = new TextEncoder().encode(
      new TextDecoder().decode(noncanonical.sections.typedIntentJcs).replace("{", "{ "),
    )
    expect(() => requiredCanvasBlobDigests(noncanonical)).toThrow("canonical")
  })
})

function frame(
  intent: CanvasTypedIntentUnion,
  overrides: { docKind?: "canvas" | "project-index"; intentKind?: string } = {},
): DecodedCausalEditFrame {
  const operation = context(1, 2, 3)
  return {
    header: { core: { scope: { ...operation.scope, docKind: overrides.docKind ?? "canvas" }, intentKind: overrides.intentKind ?? intent.kind } },
    sections: { typedIntentJcs: encodeRestrictedJcs(intent) },
  } as unknown as DecodedCausalEditFrame
}
