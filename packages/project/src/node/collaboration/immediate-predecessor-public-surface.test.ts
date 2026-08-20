import { describe, expect, test } from "bun:test"

import * as nodeCollaboration from "./index"

describe("immediate predecessor Project migration public surface", () => {
  test("exports only the Project-owned coordinator and keeps raw decoders and writers private", () => {
    expect("createImmediatePredecessorProjectMigrationPort" in nodeCollaboration).toBeTrue()
    expect("decodeImmediatePredecessorProjectNativeStoreManifest" in nodeCollaboration).toBeFalse()
    expect("readImmediatePredecessorProjectNativeStoreManifest" in nodeCollaboration).toBeFalse()
    expect("initializeImmediatePredecessorImportedProjectIndexNativeStoreInPlace" in nodeCollaboration).toBeFalse()
    expect("verifyImmediatePredecessorImportedProjectIndexGenesis" in nodeCollaboration).toBeFalse()
    expect("migrateImmediatePredecessorCollaborationStore" in nodeCollaboration).toBeFalse()
    expect("openImmediatePredecessorCollaborationStoreReadOnly" in nodeCollaboration).toBeFalse()
  })
})
