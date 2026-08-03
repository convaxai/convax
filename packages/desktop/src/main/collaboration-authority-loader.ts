import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  selectInstalledProtocolAuthorityV2,
  validateAuthorityReleaseSnapshotV1,
  type AuthorityReleaseFileV1,
  type AuthorityReleaseSnapshotV1,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration";

const activePointerPath = "docs/superpowers/specs/collaboration-v10-active-authority.json";
const exactSnapshotFileCount = 15;
const maximumSnapshotBytes = 24 * 1024 * 1024;

export interface CollaborationAuthoritySnapshotSourceV2 {
  loadSnapshot(explicitAuthorityRoot: string): Promise<AuthorityReleaseSnapshotV1>;
}

export interface LoadCollaborationAuthorityOptionsV2 {
  /** Absolute packaged/dev staging root; never the repository docs directory. */
  explicitAuthorityRoot: string;
  source?: CollaborationAuthoritySnapshotSourceV2;
}

export async function loadCollaborationAuthorityV2(
  options: LoadCollaborationAuthorityOptionsV2,
): Promise<VerifiedProtocolAuthorityV2> {
  if (!path.isAbsolute(options.explicitAuthorityRoot)) {
    throw new Error("Collaboration authority root must be an explicit absolute path");
  }
  const snapshot = await (options.source ?? nodeCollaborationAuthoritySnapshotSourceV2)
    .loadSnapshot(options.explicitAuthorityRoot);
  return selectInstalledProtocolAuthorityV2(validateAuthorityReleaseSnapshotV1(snapshot));
}

export const nodeCollaborationAuthoritySnapshotSourceV2: CollaborationAuthoritySnapshotSourceV2 = Object.freeze({
  async loadSnapshot(explicitAuthorityRoot: string) {
    const root = path.resolve(explicitAuthorityRoot);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Collaboration authority root must be a real directory");
    }
    const discovered = await readRegularTree(root);
    const pointer = discovered.find((file) => file.path === activePointerPath);
    const files = discovered.filter((file) => file.path !== activePointerPath);
    if (!pointer || files.length !== exactSnapshotFileCount) {
      throw new Error("Collaboration authority staged snapshot has the wrong file closure");
    }
    return Object.freeze({ activePointerBytes: pointer.bytes, files: Object.freeze(files) });
  },
});

async function readRegularTree(root: string): Promise<readonly AuthorityReleaseFileV1[]> {
  const pending = [root];
  const files: AuthorityReleaseFileV1[] = [];
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error("Collaboration authority snapshot contains a symlink");
      if (stat.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!stat.isFile()) throw new Error("Collaboration authority snapshot contains a non-regular entry");
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const bytes = new Uint8Array(await readFile(absolute));
      totalBytes += bytes.byteLength;
      if (files.length >= exactSnapshotFileCount + 1 || totalBytes > maximumSnapshotBytes) {
        throw new Error("Collaboration authority staged snapshot exceeds its bounded closure");
      }
      files.push(Object.freeze({ path: relative, bytes }));
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze(files);
}
