import { describe, expect, it, mock } from "bun:test"
import {
  encodeBase64urlV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
} from "@convax/collaboration"

import { createPristineV10SuccessorProjectFactoryV3 } from "./pristine-v10-successor-project-factory-v3"

import type { OpenSuccessorProjectProtocolStateV3 } from "@convax/project/node"
import type { MainSelectedProjectCollaborationPortsV3 } from "./project-collaboration-composition-v3"

const projectId = parseProjectIdV2("project_pristine_v10_factory")
const projectEpoch = id(1)
const promotionId = id(2)
const protocolDigest = parseDigestV2("44".repeat(32))
const claimDigest = parseDigestV2("55".repeat(32))

describe("pristine V10 successor Project factory", () => {
  it("opens one exact-claim genesis writer and disposes it after promotion", async () => {
    const events: string[] = []
    const state = localState()
    const context = {
      projectId,
      projectEpoch,
      protocolStore: { open: mock(), recoverPromotion: mock() },
      provisioner: {
        prepareVerifiedV10Promotion: mock(async () => {
          events.push("prepare")
          return { status: "prepared" as const, claimDigest }
        }),
        promoteVerifiedV10: mock(async () => {
          events.push("promote")
          return { status: "ready" as const, state: state.state, stateDigest: state.stateDigest }
        }),
      },
      openClaimBoundPromotion: mock(async (actual: typeof claimDigest) => {
        expect(actual).toBe(claimDigest)
        events.push("open")
        return { async dispose() { events.push("dispose") } }
      }),
      openSelectedLocal: mock(),
    }
    const factory = createPristineV10SuccessorProjectFactoryV3({
      successorProtocolDigest: protocolDigest,
      contexts: { open: mock(async () => context) },
    })

    const selected = await factory.resolveContext(projectId)
    const result = await selected.provisioner.promoteVerifiedV10({
      projectId,
      projectEpoch,
      protocolDigest,
      promotionId,
    })

    expect(result.status).toBe("ready")
    expect(events).toEqual(["prepare", "open", "promote", "dispose"])
  })

  it("leaves shared or non-pristine V10 on the old path without opening V3", async () => {
    const openClaimBoundPromotion = mock()
    const context = {
      projectId,
      projectEpoch,
      protocolStore: { open: mock(), recoverPromotion: mock() },
      provisioner: {
        prepareVerifiedV10Promotion: mock(async () => ({ status: "rejected" as const, reason: "shared" as const })),
        promoteVerifiedV10: mock(),
      },
      openClaimBoundPromotion,
      openSelectedLocal: mock(),
    }
    const factory = createPristineV10SuccessorProjectFactoryV3({
      successorProtocolDigest: protocolDigest,
      contexts: { open: mock(async () => context) },
    })

    const selected = await factory.resolveContext(projectId)
    await expect(selected.provisioner.promoteVerifiedV10({
      projectId,
      projectEpoch,
      protocolDigest,
      promotionId,
    })).resolves.toEqual({ status: "rejected", reason: "shared" })
    expect(openClaimBoundPromotion).not.toHaveBeenCalled()
    expect(context.provisioner.promoteVerifiedV10).not.toHaveBeenCalled()
  })

  it("disposes a claim-bound writer when genesis promotion fails", async () => {
    const dispose = mock(async () => undefined)
    const context = {
      projectId,
      projectEpoch,
      protocolStore: { open: mock(), recoverPromotion: mock() },
      provisioner: {
        prepareVerifiedV10Promotion: mock(async () => ({ status: "prepared" as const, claimDigest })),
        promoteVerifiedV10: mock(async () => { throw new Error("genesis failed") }),
      },
      openClaimBoundPromotion: mock(async () => ({ dispose })),
      openSelectedLocal: mock(),
    }
    const factory = createPristineV10SuccessorProjectFactoryV3({
      successorProtocolDigest: protocolDigest,
      contexts: { open: mock(async () => context) },
    })
    const selected = await factory.resolveContext(projectId)

    await expect(selected.provisioner.promoteVerifiedV10({
      projectId,
      projectEpoch,
      protocolDigest,
      promotionId,
    })).rejects.toThrow("genesis failed")
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("memoizes context and rejects a local port crossing its Project binding", async () => {
    const wrongPorts = {
      projectId: parseProjectIdV2("project_wrong_factory"),
      protocol: "v11-r1-local-owner" as const,
      projectIndexes: {},
      canvasSessions: {},
      quiesce: mock(),
      dispose: mock(async () => undefined),
    } as unknown as MainSelectedProjectCollaborationPortsV3
    const context = {
      projectId,
      projectEpoch,
      protocolStore: { open: mock(), recoverPromotion: mock() },
      provisioner: { prepareVerifiedV10Promotion: mock(), promoteVerifiedV10: mock() },
      openClaimBoundPromotion: mock(),
      openSelectedLocal: mock(async () => wrongPorts),
    }
    const open = mock(async () => context)
    const factory = createPristineV10SuccessorProjectFactoryV3({
      successorProtocolDigest: protocolDigest,
      contexts: { open },
    })
    const selected = await factory.resolveContext(projectId)

    await expect(factory.openLocal({ context: selected, state: localState() }))
      .rejects.toThrow("crossed their Project")
    expect(open).toHaveBeenCalledTimes(1)
    expect(wrongPorts.dispose).toHaveBeenCalledTimes(1)
  })
})

function localState(): Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }> {
  return {
    status: "v3-local" as const,
    state: {
      format: "convax.project-protocol-state/3" as const,
      projectId,
      projectEpoch,
      protocolMajor: 3 as const,
      protocolDigest,
      authorityId: "collaboration-v11",
      authorityRevision: "r1",
      authoritySequence: "2" as const,
      writerKind: "local-owner" as const,
      ownerBindingCoreDigest: parseDigestV2("66".repeat(32)),
      initialActorId: id(3),
      sharingGeneration: "0" as const,
      origin: {
        kind: "v10-r5-unshared" as const,
        r5AuthorityManifestSha256: parseDigestV2("88".repeat(32)),
        verifiedLegacyClosureDigest: parseDigestV2("99".repeat(32)),
      },
      documents: [],
    },
    stateDigest: parseDigestV2("aa".repeat(32)),
  } as unknown as Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>
}

function id(fill: number) {
  return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => fill)))
}
