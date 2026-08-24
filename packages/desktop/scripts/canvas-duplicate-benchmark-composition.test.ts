import { expect, test } from "bun:test"
import { validateCanvasYDoc, createCanvasReconstructionYDoc } from "@convax/canvas/collaboration"
import { applyYjsUpdate } from "@convax/collaboration"

import { createVerifiedCanvasBenchmarkComposition } from "./canvas-duplicate-benchmark-composition"

test.skipIf(process.platform === "win32")("composes a verified Canvas base through a real ProjectIndex route stage and activation", async () => {
  const composition = await createVerifiedCanvasBenchmarkComposition({ canvasCount: 8 })
  try {
    expect(composition.acceptedBase.scope).toEqual(composition.scope)
    expect(composition.scopes).toHaveLength(8)
    expect(new Set(composition.scopes.map(({ docId, shardEpoch }) => `${docId}\0${shardEpoch}`)).size).toBe(8)
    expect(composition.acceptedBases.map(({ scope }) => scope)).toEqual(composition.scopes)
    expect(composition.canvasRuntimes).toHaveLength(8)
    const document = createCanvasReconstructionYDoc()
    try {
      applyYjsUpdate(document, composition.acceptedBase.fullUpdate, test)
      const snapshot = validateCanvasYDoc(document, composition.scope)
      expect(snapshot.identity.projectIndexRouteDependencyFrameDigest).not.toBe("0".repeat(64))
      expect(snapshot.nodes.size).toBe(0)
    } finally {
      document.destroy()
    }
  } finally {
    await composition.dispose()
  }
}, 30_000)
