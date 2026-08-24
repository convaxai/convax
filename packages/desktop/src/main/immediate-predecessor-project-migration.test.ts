import { describe, expect, mock, test } from "bun:test"
import {
  encodeBase64url,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
} from "@convax/collaboration"
import type {
  ImmediatePredecessorProjectMigrationAuthorityPort,
} from "@convax/project/node"

import {
  createDesktopImmediatePredecessorProjectMigrationAuthority,
  type DesktopImmediatePredecessorLocalOwnerAuthorityPort,
} from "./immediate-predecessor-project-migration"
import type {
  ActivatedImmediatePredecessorLocalOwnerMigrationAuthority,
  PreparedImmediatePredecessorLocalOwnerMigrationAuthority,
} from "./local-project-owner-authority"

const digest = (seed: string) => parseDigest(seed.repeat(64).slice(0, 64))
const id = (seed: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(seed)))
const actorId = parseActorId(encodeBase64url(new Uint8Array(32).fill(7)))
const projectId = parseProjectId("project-migration")
const replicaId = parseReplicaId("replica_00000007")
const memberId = parseMemberId(id(8))

function predecessorInput(): Parameters<ImmediatePredecessorProjectMigrationAuthorityPort["inspectPredecessor"]>[0] {
  return {
    projectId,
    projectRoot: "/project",
    predecessorManifest: {
      format: "convax.project-native-store-manifest",
      storeIdentity: "convax.project-collaboration-native-store",
      projectIndexScope: {
        projectId,
        projectEpoch: id(1),
        docKind: "project-index",
        docId: "project-index",
        shardEpoch: id(2),
      },
      protocolDigest: digest("1"),
      schemaDigest: digest("2"),
      uriProtocolDigest: digest("3"),
      initializationAuthorityDigest: digest("4"),
      emptyProjectIndexCheckpointObjectDigest: digest("5"),
      emptyProjectIndexFullUpdateDigest: digest("6"),
      emptyProjectIndexStateVectorDigest: digest("7"),
      emptyProjectIndexCanonicalStateDigest: digest("8"),
    },
  }
}

function localPrepared(): PreparedImmediatePredecessorLocalOwnerMigrationAuthority {
  return {
    predecessor: {
      binding: { actorId, replicaId },
    },
    predecessorSignatures: {
      async verify() { return true },
      async verifyCheckpoint() { return true },
    },
  } as unknown as PreparedImmediatePredecessorLocalOwnerMigrationAuthority
}

function localActivated(): ActivatedImmediatePredecessorLocalOwnerMigrationAuthority {
  return {
    currentOwner: {
      binding: {
        actorId,
        memberId,
        replicaId,
        bindingDigest: digest("a"),
      },
    },
    migrationOperationId: id(9),
  } as unknown as ActivatedImmediatePredecessorLocalOwnerMigrationAuthority
}

function localOwnerHarness(result: ReturnType<typeof localPrepared> | "missing" | "rejected" = localPrepared()) {
  const inspect = mock(async () => result)
  const activate = mock(async () => localActivated())
  return {
    inspect,
    activate,
    port: {
      inspectImmediatePredecessorMigrationAuthority: inspect,
      activateImmediatePredecessorMigrationAuthority: activate,
    } as DesktopImmediatePredecessorLocalOwnerAuthorityPort,
  }
}

describe("Desktop immediate-predecessor migration authority", () => {
  test("binds one exact read-only local inspection to activation after closure verification", async () => {
    const local = localOwnerHarness()
    const authority = createDesktopImmediatePredecessorProjectMigrationAuthority({
      teamState: { async resolve() { return "missing" } },
      localOwner: local.port,
    })
    const input = predecessorInput()
    const inspected = await authority.inspectPredecessor(input)

    expect(inspected.status).toBe("verified")
    if (inspected.status !== "verified") throw new Error("expected verified predecessor")
    expect(inspected.mode).toBe("local-project-owner")
    expect(local.inspect).toHaveBeenCalledWith({
      projectId,
      projectRoot: "/project",
      projectEpoch: input.predecessorManifest.projectIndexScope.projectEpoch,
      projectIndexShardEpoch: input.predecessorManifest.projectIndexScope.shardEpoch,
      initializationAuthorityDigest: input.predecessorManifest.initializationAuthorityDigest,
    })
    expect(local.activate).not.toHaveBeenCalled()

    const current = await authority.prepareCurrent({
      ...input,
      sourceClosureDigest: digest("b"),
      predecessor: inspected,
    })
    expect(local.activate).toHaveBeenCalledTimes(1)
    expect(local.activate).toHaveBeenCalledWith(expect.anything(), digest("b"))
    expect(current).toEqual({
      status: "authorized",
      mode: "local-project-owner",
      actorId,
      memberId,
      replicaId,
      authorizationDigest: digest("a"),
      authorityDigest: digest("a"),
      migrationOperationId: id(9),
    })
  })

  test("missing or rejected local predecessor authority never reaches activation", async () => {
    for (const result of ["missing", "rejected"] as const) {
      const local = localOwnerHarness(result)
      const authority = createDesktopImmediatePredecessorProjectMigrationAuthority({
        teamState: { async resolve() { return "missing" } },
        localOwner: local.port,
      })
      expect(await authority.inspectPredecessor(predecessorInput())).toEqual({
        status: result === "missing" ? "unavailable" : "rejected",
      })
      expect(local.activate).not.toHaveBeenCalled()
    }
  })

  test("rejects a forged local preparation and a Team transition before publishing current owner", async () => {
    let teamState: "missing" | "active" = "missing"
    const local = localOwnerHarness()
    const authority = createDesktopImmediatePredecessorProjectMigrationAuthority({
      teamState: { async resolve() { return teamState } },
      localOwner: local.port,
    })
    const input = predecessorInput()
    const inspected = await authority.inspectPredecessor(input)
    if (inspected.status !== "verified") throw new Error("expected verified predecessor")
    const forged = Object.freeze({ ...inspected })
    expect(await authority.prepareCurrent({
      ...input,
      sourceClosureDigest: digest("c"),
      predecessor: forged,
    })).toEqual({ status: "rejected" })

    teamState = "active"
    expect(await authority.prepareCurrent({
      ...input,
      sourceClosureDigest: digest("c"),
      predecessor: inspected,
    })).toEqual({ status: "rejected" })
    expect(local.activate).not.toHaveBeenCalled()
  })

  test("an active Team delegates exclusively to its signer and never falls back to local owner", async () => {
    const local = localOwnerHarness()
    const teamInspected = Object.freeze({
      status: "verified" as const,
      mode: "team-replica" as const,
      predecessorLocalActorId: actorId,
      predecessorReplicaId: replicaId,
      predecessorSignatures: {
        async verify() { return true },
        async verifyCheckpoint() { return true },
      },
    })
    const teamCurrent = Object.freeze({
      status: "authorized" as const,
      mode: "team-replica" as const,
      actorId,
      memberId,
      replicaId,
      authorizationDigest: digest("d"),
      authorityDigest: digest("e"),
      migrationOperationId: id(10),
    })
    const teamAuthority = {
      inspectPredecessor: mock(async () => teamInspected),
      prepareCurrent: mock(async () => teamCurrent),
    } satisfies ImmediatePredecessorProjectMigrationAuthorityPort
    const authority = createDesktopImmediatePredecessorProjectMigrationAuthority({
      teamState: { async resolve() { return "active" } },
      teamAuthority,
      localOwner: local.port,
    })
    const input = predecessorInput()
    const inspected = await authority.inspectPredecessor(input)
    if (inspected.status !== "verified") throw new Error("expected verified Team predecessor")
    const current = await authority.prepareCurrent({
      ...input,
      sourceClosureDigest: digest("f"),
      predecessor: inspected,
    })

    expect(current).toBe(teamCurrent)
    expect(teamAuthority.inspectPredecessor).toHaveBeenCalledTimes(1)
    expect(teamAuthority.prepareCurrent).toHaveBeenCalledTimes(1)
    expect(local.inspect).not.toHaveBeenCalled()
    expect(local.activate).not.toHaveBeenCalled()
  })

  test("rejected or unavailable Team authority cannot downgrade to local owner", async () => {
    for (const state of ["rejected", "active"] as const) {
      const local = localOwnerHarness()
      const authority = createDesktopImmediatePredecessorProjectMigrationAuthority({
        teamState: { async resolve() { return state } },
        localOwner: local.port,
      })
      expect(await authority.inspectPredecessor(predecessorInput())).toEqual({
        status: state === "rejected" ? "rejected" : "unavailable",
      })
      expect(local.inspect).not.toHaveBeenCalled()
      expect(local.activate).not.toHaveBeenCalled()
    }
  })
})
