import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadCollaborationAuthorityV2,
  nodeCollaborationAuthoritySnapshotSourceV2,
} from "./collaboration-authority-loader";
import { nodeCollaborationAuthoritySnapshotSourceV3 } from "./collaboration-authority-loader-v3";
import { parseDigestV2 } from "@convax/collaboration";

const activeStagedRoot = path.resolve(import.meta.dir, "../..", ".packaging/collaboration-authority");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

describe("Desktop staged collaboration authority loader", () => {
  test("loads validate+select only from the explicit packaged authority root", async () => {
    const stagedRoot = await materializeHistoricalStaging();
    const authority = await loadCollaborationAuthorityV2({ explicitAuthorityRoot: stagedRoot });
    expect(authority.revision).toBe("r5");
    expect(authority.protocolDigest).toBe(parseDigestV2("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5"));
  });

  test("rejects relative roots and tampered injected staged bytes", async () => {
    await expect(loadCollaborationAuthorityV2({ explicitAuthorityRoot: "docs" })).rejects.toThrow("explicit absolute");
    const stagedRoot = await materializeHistoricalStaging();
    const snapshot = await nodeCollaborationAuthoritySnapshotSourceV2.loadSnapshot(stagedRoot);
    const files = snapshot.files.map((file) => ({ path: file.path, bytes: new Uint8Array(file.bytes) }));
    files[0]!.bytes[0] ^= 1;
    await expect(loadCollaborationAuthorityV2({
      explicitAuthorityRoot: stagedRoot,
      source: { loadSnapshot: async () => ({ activePointerBytes: snapshot.activePointerBytes, files }) },
    })).rejects.toMatchObject({ code: "protocol-schema-bundle-unavailable" });
  });
});

async function materializeHistoricalStaging(): Promise<string> {
  const { historicalV2 } = await nodeCollaborationAuthoritySnapshotSourceV3.loadSnapshots(activeStagedRoot);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-v10-authority-"));
  roots.push(root);
  const files = [
    {
      path: "docs/superpowers/specs/collaboration-v10-active-authority.json",
      bytes: historicalV2.activePointerBytes,
    },
    ...historicalV2.files,
  ];
  for (const file of files) {
    const target = path.join(root, ...file.path.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.bytes, { mode: 0o644 });
  }
  return root;
}
