import { describe, expect, test } from "bun:test"
import * as publicCollaboration from "./index"

describe("Canvas owner state cache public surface", () => {
  test("keeps validated-snapshot cache helpers package-private", () => {
    expect("encodeValidatedCanvasCanonicalState" in publicCollaboration).toBeFalse()
    expect("CanvasOwnerStateCache" in publicCollaboration).toBeFalse()
    expect("createCanvasMigrationImportYDoc" in publicCollaboration).toBeFalse()
    expect("rebuildImmediatePredecessorCanvasDocument" in publicCollaboration).toBeFalse()
    expect("buildImmediatePredecessorImportedCanvasGenesisProofCarrier" in publicCollaboration).toBeFalse()
  })
})
