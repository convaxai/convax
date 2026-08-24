import { comparePortableStamps, compareUtf8 } from "@convax/collaboration"
import { parseProjectEntryId, type ProjectEntryId } from "@convax/project-files/identity"

import {
  projectEntryLocationProjection,
  type ProjectDirectoryId,
  type ProjectEntryLocationClaim,
  type ProjectEntryRecord,
  type ProjectIndexSnapshot,
} from "../collaboration/project-index"

export interface ReachableOrdinaryPathIndex {
  readonly entryIdByPath: ReadonlyMap<string, ProjectEntryId>
  readonly pathByEntryId: ReadonlyMap<string, string>
}

/**
 * Resolves the current materialized path without constructing counterfactual
 * dependency evidence for ordinary reachable path winners. Exceptional conflict,
 * orphan and missing states retain the complete ProjectIndex location projection.
 */
export function projectEntryMaterializedPath(
  snapshot: ProjectIndexSnapshot,
  entry: ProjectEntryRecord,
  ordinaryPaths: ReachableOrdinaryPathIndex,
): string | null {
  if (entry.storageClass === "managed-blob") return null
  const ordinaryPath =
    entry.provenance === "content-conflict-copy" ? undefined : ordinaryPaths.pathByEntryId.get(entry.entryId)
  if (ordinaryPath !== undefined) return ordinaryPath
  const location = projectEntryLocationProjection(snapshot, entry.entryId)
  return location.state === "live-linked" || location.state === "conflict-path" ? location.portablePath : null
}

export function createReachableOrdinaryPathIndex(snapshot: ProjectIndexSnapshot): ReachableOrdinaryPathIndex {
  const tombstoned = new Set([...snapshot.entryTombstones.values()].map((record) => record.entryId))
  const selectedClaims = new Map<ProjectEntryId, ProjectEntryLocationClaim>()
  for (const claim of snapshot.entryLocations.values()) {
    const selected = selectedClaims.get(claim.entryId)
    if (selected === undefined || comparePortableStamps(selected.stamp, claim.stamp) <= 0) {
      selectedClaims.set(claim.entryId, claim)
    }
  }

  const winnersBySlot = new Map<
    string,
    Readonly<{
      entryId: ProjectEntryId
      claim: ProjectEntryLocationClaim
    }>
  >()
  for (const [entryId, claim] of selectedClaims) {
    const entry = snapshot.entries.get(entryId)
    if (!entry || tombstoned.has(entryId) || claim.state !== "linked") continue
    const slot = `${claim.parentDirectoryId}\0${claim.basename}`
    const selected = winnersBySlot.get(slot)
    const byStamp = selected === undefined ? 1 : comparePortableStamps(claim.stamp, selected.claim.stamp)
    if (byStamp > 0 || (byStamp === 0 && selected !== undefined && compareUtf8(entryId, selected.entryId) > 0)) {
      winnersBySlot.set(slot, Object.freeze({ entryId: parseProjectEntryId(entryId), claim }))
    }
  }

  const childrenByParent = new Map<
    ProjectDirectoryId,
    Array<
      Readonly<{
        entryId: ProjectEntryId
        basename: string
      }>
    >
  >()
  for (const winner of winnersBySlot.values()) {
    const children = childrenByParent.get(winner.claim.parentDirectoryId) ?? []
    children.push(Object.freeze({ entryId: winner.entryId, basename: winner.claim.basename }))
    childrenByParent.set(winner.claim.parentDirectoryId, children)
  }

  const entryIdByPath = new Map<string, ProjectEntryId>()
  const pathByEntryId = new Map<string, string>()
  const queue: Array<Readonly<{ directoryId: ProjectDirectoryId; path: string }>> = [
    Object.freeze({ directoryId: snapshot.identity.rootDirectoryId, path: "" }),
  ]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parent = queue[cursor]!
    for (const child of childrenByParent.get(parent.directoryId) ?? []) {
      const entry = snapshot.entries.get(child.entryId)
      if (!entry) continue
      const path = parent.path === "" ? child.basename : `${parent.path}/${child.basename}`
      entryIdByPath.set(path, child.entryId)
      pathByEntryId.set(child.entryId, path)
      if (entry.kind === "directory") {
        queue.push(Object.freeze({ directoryId: child.entryId as ProjectDirectoryId, path }))
      }
    }
  }
  return Object.freeze({ entryIdByPath, pathByEntryId })
}
