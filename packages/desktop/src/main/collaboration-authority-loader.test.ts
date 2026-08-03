import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  loadCollaborationAuthorityV2,
  nodeCollaborationAuthoritySnapshotSourceV2,
} from "./collaboration-authority-loader";
import { parseDigestV2 } from "@convax/collaboration";

const stagedRoot = path.resolve(import.meta.dir, "../..", ".packaging/collaboration-authority");

describe("Desktop staged collaboration authority loader", () => {
  test("loads validate+select only from the explicit packaged authority root", async () => {
    const authority = await loadCollaborationAuthorityV2({ explicitAuthorityRoot: stagedRoot });
    expect(authority.revision).toBe("r5");
    expect(authority.protocolDigest).toBe(parseDigestV2("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5"));
  });

  test("rejects relative roots and tampered injected staged bytes", async () => {
    await expect(loadCollaborationAuthorityV2({ explicitAuthorityRoot: "docs" })).rejects.toThrow("explicit absolute");
    const snapshot = await nodeCollaborationAuthoritySnapshotSourceV2.loadSnapshot(stagedRoot);
    const files = snapshot.files.map((file) => ({ path: file.path, bytes: new Uint8Array(file.bytes) }));
    files[0]!.bytes[0] ^= 1;
    await expect(loadCollaborationAuthorityV2({
      explicitAuthorityRoot: stagedRoot,
      source: { loadSnapshot: async () => ({ activePointerBytes: snapshot.activePointerBytes, files }) },
    })).rejects.toMatchObject({ code: "protocol-schema-bundle-unavailable" });
  });
});
