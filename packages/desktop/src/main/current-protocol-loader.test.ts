import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { encodeCurrentProtocolDescriptor, parseDigestV2 } from "@convax/collaboration";

import { loadCurrentCollaborationProtocol, nodeCurrentProtocolDescriptorSource } from "./current-protocol-loader";

const stagedRoot = path.resolve(import.meta.dir, "../..", ".packaging/collaboration-protocol");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

describe("Desktop staged current protocol loader", () => {
  test("installs the current protocol only from the explicit packaged root", async () => {
    const root = await materializeStaging(encodeCurrentProtocolDescriptor());

    const authority = await loadCurrentCollaborationProtocol({ explicitProtocolRoot: root });

    expect(authority.protocolDigest).toBe(
      parseDigestV2("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5"),
    );
  });

  test("stages exactly one descriptor file for packaging", async () => {
    const entries = await fs.readdir(stagedRoot, { recursive: true, withFileTypes: true });

    expect(entries.filter((entry) => entry.isFile()).map((entry) => entry.name)).toEqual(["current.json"]);
    expect([...(await nodeCurrentProtocolDescriptorSource.loadDescriptorBytes(stagedRoot))]).toEqual([
      ...encodeCurrentProtocolDescriptor(),
    ]);
  });

  test("rejects relative roots and drifted staged bytes", async () => {
    await expect(loadCurrentCollaborationProtocol({ explicitProtocolRoot: "docs" })).rejects.toThrow(
      "explicit absolute",
    );

    const drifted = encodeCurrentProtocolDescriptor();
    drifted[5] ^= 1;
    const root = await materializeStaging(drifted);

    await expect(loadCurrentCollaborationProtocol({ explicitProtocolRoot: root })).rejects.toMatchObject({
      code: "protocol-schema-bundle-unavailable",
    });
  });
});

async function materializeStaging(bytes: Uint8Array): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-current-protocol-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "current.json"), bytes, { mode: 0o644 });
  return root;
}
