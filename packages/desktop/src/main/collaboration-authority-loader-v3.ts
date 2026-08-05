import { lstat, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import {
  selectInstalledProtocolAuthorityV2,
  selectInstalledProtocolAuthorityV3,
  validateAuthorityReleaseSnapshotV1,
  validateSuccessorAuthorityReleaseSnapshotV1,
  type AuthorityReleaseFileV1,
  type AuthorityReleaseSnapshotV1,
  type SuccessorAuthorityReleaseSnapshotV1,
  type VerifiedProtocolAuthorityV2,
  type VerifiedProtocolAuthorityV3,
} from "@convax/collaboration"

const v10PointerPath = "docs/superpowers/specs/collaboration-v10-active-authority.json"
const v11PointerPath = "docs/superpowers/specs/collaboration-v11-active-authority.json"
const v10Root = "docs/superpowers/specs/authorities/collaboration-v10/r5"
const v11Root = "docs/superpowers/specs/authorities/collaboration-v11/r1"
const maximumFileBytes = 4 * 1024 * 1024
const maximumClosureBytes = 24 * 1024 * 1024

const v10ReleasePaths = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${v10Root}/appendices/canvas-schema.md`,
  `${v10Root}/appendices/collaboration-kernel.md`,
  `${v10Root}/appendices/control-plane.md`,
  `${v10Root}/appendices/project-persistence.md`,
  `${v10Root}/authority.sha256`,
  `${v10Root}/main.md`,
  `${v10Root}/protocol-schema-bundle-v2.json`,
  `${v10Root}/review-evidence.json`,
  `${v10Root}/reviews/canvas-intent-runtime/receipt.json`,
  `${v10Root}/reviews/canvas-intent-runtime/report.md`,
  `${v10Root}/reviews/collaboration-api/receipt.json`,
  `${v10Root}/reviews/collaboration-api/report.md`,
  `${v10Root}/reviews/project-store-reviewer/receipt.json`,
  `${v10Root}/reviews/project-store-reviewer/report.md`,
] as const)

const v11ReleasePaths = Object.freeze([
  "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  `${v11Root}/appendices/canvas-schema.md`,
  `${v11Root}/appendices/collaboration-kernel.md`,
  `${v11Root}/appendices/control-plane.md`,
  `${v11Root}/appendices/project-persistence.md`,
  `${v11Root}/authority.sha256`,
  `${v11Root}/historical-v10-r5-pin.json`,
  `${v11Root}/main.md`,
  `${v11Root}/protocol-schema-bundle-v3.json`,
  `${v11Root}/review-evidence.json`,
  `${v11Root}/reviews/canvas-intent-runtime/receipt.json`,
  `${v11Root}/reviews/canvas-intent-runtime/report.md`,
  `${v11Root}/reviews/collaboration-control-protocol/receipt.json`,
  `${v11Root}/reviews/collaboration-control-protocol/report.md`,
  `${v11Root}/reviews/project-native-store/receipt.json`,
  `${v11Root}/reviews/project-native-store/report.md`,
] as const)

const exactStagedPaths = Object.freeze([...new Set([
  v10PointerPath,
  v11PointerPath,
  ...v10ReleasePaths,
  ...v11ReleasePaths,
])].sort(compareUtf8))
const exactDirectoryPaths = new Set(exactStagedPaths.flatMap((filePath) => {
  const segments = filePath.split("/")
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join("/"))
}))

export interface CollaborationAuthoritySnapshotsV3 {
  readonly historicalV2: AuthorityReleaseSnapshotV1
  readonly successorV3: SuccessorAuthorityReleaseSnapshotV1
}

export interface CollaborationAuthoritySnapshotSourceV3 {
  loadSnapshots(explicitAuthorityRoot: string): Promise<CollaborationAuthoritySnapshotsV3>
}

export interface LoadCollaborationAuthoritiesOptionsV3 {
  /** Absolute packaged/dev staging root; never the repository docs directory. */
  readonly explicitAuthorityRoot: string
  readonly source?: CollaborationAuthoritySnapshotSourceV3
}

export interface LoadedCollaborationAuthoritiesV3 {
  readonly historicalV2: VerifiedProtocolAuthorityV2
  readonly successorV3: VerifiedProtocolAuthorityV3
}

/**
 * Staged-only dual-version loader. It is deliberately not wired into Main's
 * active composition until the V11 pointer promotion commit exists.
 */
export async function loadCollaborationAuthoritiesV3(
  options: LoadCollaborationAuthoritiesOptionsV3,
): Promise<LoadedCollaborationAuthoritiesV3> {
  assertExplicitAuthorityRoot(options.explicitAuthorityRoot)
  const snapshots = await (options.source ?? nodeCollaborationAuthoritySnapshotSourceV3)
    .loadSnapshots(options.explicitAuthorityRoot)
  const historicalRelease = validateAuthorityReleaseSnapshotV1(snapshots.historicalV2)
  const successorRelease = validateSuccessorAuthorityReleaseSnapshotV1(snapshots.successorV3)
  const historicalV2 = selectInstalledProtocolAuthorityV2(historicalRelease)
  const successorV3 = selectInstalledProtocolAuthorityV3(successorRelease, historicalRelease)
  return Object.freeze({ historicalV2, successorV3 })
}

export const nodeCollaborationAuthoritySnapshotSourceV3: CollaborationAuthoritySnapshotSourceV3 = Object.freeze({
  async loadSnapshots(explicitAuthorityRoot: string) {
    assertExplicitAuthorityRoot(explicitAuthorityRoot)
    const root = path.resolve(explicitAuthorityRoot)
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Collaboration authority root must be a real directory")
    }
    const discovered = await readExactRegularTree(root)
    return Object.freeze({
      historicalV2: Object.freeze({
        activePointerBytes: requireStaged(discovered, v10PointerPath),
        files: releaseFiles(discovered, v10ReleasePaths),
      }),
      successorV3: Object.freeze({
        activePointerBytes: requireStaged(discovered, v11PointerPath),
        files: releaseFiles(discovered, v11ReleasePaths),
      }),
    })
  },
})

async function readExactRegularTree(root: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const pending = [root]
  const discovered = new Map<string, Uint8Array>()
  let totalBytes = 0
  while (pending.length > 0) {
    const directory = pending.pop()!
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => compareUtf8(left.name, right.name))
    for (const entry of entries) {
      if (entry.name !== entry.name.normalize("NFC") || entry.name === "." || entry.name === "..") {
        throw new Error("Collaboration authority snapshot contains a path alias")
      }
      const absolute = path.join(directory, entry.name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) throw new Error("Collaboration authority snapshot contains a symlink")
      if (stat.isDirectory()) {
        const relativeDirectory = path.relative(root, absolute).split(path.sep).join("/")
        if (!exactDirectoryPaths.has(relativeDirectory)) {
          throw new Error("Collaboration authority staged snapshot has the wrong directory inventory")
        }
        pending.push(absolute)
        continue
      }
      if (!stat.isFile()) throw new Error("Collaboration authority snapshot contains a non-regular entry")
      if ((stat.mode & 0o7777) !== 0o644) throw new Error("Collaboration authority snapshot file mode must be 0644")
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      if (relative.length === 0 || relative.startsWith("../") || path.posix.normalize(relative) !== relative) {
        throw new Error("Collaboration authority snapshot contains a path alias")
      }
      if (stat.size > maximumFileBytes) throw new Error("Collaboration authority staged file exceeds its size bound")
      const bytes = new Uint8Array(await readFile(absolute))
      if (bytes.byteLength !== stat.size) throw new Error("Collaboration authority staged file changed while reading")
      totalBytes += bytes.byteLength
      if (totalBytes > maximumClosureBytes) throw new Error("Collaboration authority staged closure exceeds its size bound")
      discovered.set(relative, bytes)
    }
  }
  const actualPaths = [...discovered.keys()].sort(compareUtf8)
  if (actualPaths.length !== exactStagedPaths.length
    || actualPaths.some((actual, index) => actual !== exactStagedPaths[index])) {
    throw new Error("Collaboration authority staged snapshot has the wrong exact inventory")
  }
  return discovered
}

function releaseFiles(
  discovered: ReadonlyMap<string, Uint8Array>,
  expectedPaths: readonly string[],
): readonly AuthorityReleaseFileV1[] {
  return Object.freeze(expectedPaths.map((expectedPath) => Object.freeze({
    path: expectedPath,
    bytes: Uint8Array.from(requireStaged(discovered, expectedPath)),
  })))
}

function requireStaged(discovered: ReadonlyMap<string, Uint8Array>, expectedPath: string): Uint8Array {
  const bytes = discovered.get(expectedPath)
  if (bytes === undefined) throw new Error(`Missing staged collaboration authority file: ${expectedPath}`)
  return Uint8Array.from(bytes)
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function assertExplicitAuthorityRoot(explicitAuthorityRoot: string): void {
  if (!path.isAbsolute(explicitAuthorityRoot) || path.normalize(explicitAuthorityRoot) !== explicitAuthorityRoot) {
    throw new Error("Collaboration authority root must be an explicit absolute path without aliases")
  }
}
