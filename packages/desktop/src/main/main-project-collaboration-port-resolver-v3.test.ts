import { describe, expect, mock, test } from "bun:test"
import {
  encodeBase64urlV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
} from "@convax/collaboration"
import type {
  OpenSuccessorProjectProtocolStateV3,
  SuccessorLocalProjectProvisionResultV3,
} from "@convax/project/node"

import {
  createMainProjectCollaborationPortResolverV3,
  type MainProjectCollaborationSelectionContextV3,
} from "./main-project-collaboration-port-resolver-v3"
import type { MainSelectedProjectCollaborationPortsV3 } from "./project-collaboration-composition-v3"

const PROJECT = parseProjectIdV2(`project_${"a".repeat(64)}`)
const PROJECT_EPOCH = id(1)
const PROTOCOL_DIGEST = parseDigestV2("b".repeat(64))
const STATE_DIGEST = parseDigestV2("c".repeat(64))

describe("per-Project V3 collaboration port resolver", () => {
  test("opens V3 only from the exact persisted local state", async () => {
    const fixture = createFixture({ opened: v3Local() })

    const resolved = await fixture.resolver.resolve(PROJECT)

    expect(resolved).toEqual({ status: "ready", ports: fixture.v3Ports })
    expect(fixture.openV3Local).toHaveBeenCalledTimes(1)
    expect(fixture.promoteVerifiedV10).not.toHaveBeenCalled()
    expect(fixture.openV10).not.toHaveBeenCalled()
  })

  test("promotes an unselected verified V10 Project and reopens the exact installed state", async () => {
    const fixture = createFixture({
      opened: Object.freeze({ status: "not-installed" }),
      promotion: readyPromotion(),
      reopened: v3Local(),
    })

    const resolved = await fixture.resolver.resolve(PROJECT)

    expect(resolved).toEqual({ status: "ready", ports: fixture.v3Ports })
    expect(fixture.promoteVerifiedV10).toHaveBeenCalledWith({
      projectId: PROJECT,
      projectEpoch: PROJECT_EPOCH,
      protocolDigest: PROTOCOL_DIGEST,
      promotionId: id(9),
    })
    expect(fixture.openV10).not.toHaveBeenCalled()
  })

  test.each(["shared", "invalid-v10"] as const)(
    "keeps %s Projects on the frozen V10 runtime",
    async (reason) => {
      const fixture = createFixture({
        opened: Object.freeze({ status: "not-installed" }),
        promotion: Object.freeze({ status: "rejected", reason }),
      })

      const resolved = await fixture.resolver.resolve(PROJECT)

      expect(resolved).toEqual({ status: "ready", ports: fixture.v10Ports })
      expect(fixture.openV10).toHaveBeenCalledTimes(1)
      expect(fixture.openV3Local).not.toHaveBeenCalled()
    },
  )

  test("lets a concurrently installed durable V3 selector dominate a rejected V10 promotion", async () => {
    const fixture = createFixture({
      opened: Object.freeze({ status: "not-installed" }),
      promotion: Object.freeze({ status: "rejected", reason: "invalid-v10" }),
      reopened: v3Local(),
    })

    const resolved = await fixture.resolver.resolve(PROJECT)

    expect(resolved).toEqual({ status: "ready", ports: fixture.v3Ports })
    expect(fixture.openV3Local).toHaveBeenCalledTimes(1)
    expect(fixture.openV10).not.toHaveBeenCalled()
  })

  test.each(["ambiguous", "promotion-recovery-required"] as const)(
    "fails closed on %s promotion evidence without opening either writer",
    async (reason) => {
      const fixture = createFixture({
        opened: Object.freeze({ status: "not-installed" }),
        promotion: Object.freeze({ status: "rejected", reason }),
      })

      await expect(fixture.resolver.resolve(PROJECT)).resolves.toEqual({
        status: "unavailable",
        reason: "promotion-ambiguous",
      })
      expect(fixture.openV10).not.toHaveBeenCalled()
      expect(fixture.openV3Local).not.toHaveBeenCalled()
    },
  )

  test("recovers an interrupted promotion before selecting V3", async () => {
    const fixture = createFixture({
      opened: Object.freeze({
        status: "promotion-recovery-required",
        claim: Object.freeze({ marker: "claim" }),
      }) as unknown as OpenSuccessorProjectProtocolStateV3,
      recovered: v3Local(),
    })

    const resolved = await fixture.resolver.resolve(PROJECT)

    expect(resolved).toEqual({ status: "ready", ports: fixture.v3Ports })
    expect(fixture.recoverPromotion).toHaveBeenCalledTimes(1)
    expect(fixture.promoteVerifiedV10).not.toHaveBeenCalled()
  })

  test("rejects a V3 port factory that returns another protocol", async () => {
    const fixture = createFixture({ opened: v3Local(), v3Ports: ports("v10-r5") })

    await expect(fixture.resolver.resolve(PROJECT)).rejects.toThrow("Project or protocol binding")
  })

  test("rejects a persisted V3 state bound to another verified protocol digest", async () => {
    const crossed = v3Local()
    const fixture = createFixture({
      opened: Object.freeze({
        ...crossed,
        state: Object.freeze({ ...crossed.state, protocolDigest: parseDigestV2("d".repeat(64)) }),
      }) as Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>,
    })

    await expect(fixture.resolver.resolve(PROJECT)).resolves.toEqual({
      status: "unavailable",
      reason: "evidence-corrupt",
    })
    expect(fixture.openV3Local).not.toHaveBeenCalled()
    expect(fixture.openV10).not.toHaveBeenCalled()
  })
})

function createFixture(options: {
  opened: OpenSuccessorProjectProtocolStateV3
  reopened?: OpenSuccessorProjectProtocolStateV3
  recovered?: OpenSuccessorProjectProtocolStateV3
  promotion?: SuccessorLocalProjectProvisionResultV3
  v3Ports?: MainSelectedProjectCollaborationPortsV3
}) {
  let opens = 0
  const open = mock(async () => {
    opens += 1
    return opens === 1 ? options.opened : (options.reopened ?? options.opened)
  })
  const recoverPromotion = mock(async () => options.recovered ?? options.opened)
  const promoteVerifiedV10 = mock(async () => options.promotion ?? Object.freeze({
    status: "rejected",
    reason: "invalid-v10",
  } as const))
  const context: MainProjectCollaborationSelectionContextV3 = Object.freeze({
    projectId: PROJECT,
    projectEpoch: PROJECT_EPOCH,
    protocolStore: Object.freeze({ open, recoverPromotion }),
    provisioner: Object.freeze({ promoteVerifiedV10 }),
  })
  const v10Ports = ports("v10-r5")
  const v3Ports = options.v3Ports ?? ports("v11-r1-local-owner")
  const openV10 = mock(async () => v10Ports)
  const openV3Local = mock(async () => v3Ports)
  return {
    resolver: createMainProjectCollaborationPortResolverV3({
      resolveContext: mock(async () => context),
      successorProtocolDigest: PROTOCOL_DIGEST,
      createPromotionId: () => id(9),
      openV10,
      openV3Local,
    }),
    v10Ports,
    v3Ports,
    openV10,
    openV3Local,
    promoteVerifiedV10,
    recoverPromotion,
  }
}

function ports(protocol: MainSelectedProjectCollaborationPortsV3["protocol"]): MainSelectedProjectCollaborationPortsV3 {
  return Object.freeze({
    projectId: PROJECT,
    protocol,
    projectIndexes: Object.freeze({}),
    canvasSessions: Object.freeze({}),
  }) as unknown as MainSelectedProjectCollaborationPortsV3
}

function v3Local(): Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }> {
  return Object.freeze({
    status: "v3-local",
    stateDigest: STATE_DIGEST,
    state: Object.freeze({
      projectId: PROJECT,
      projectEpoch: PROJECT_EPOCH,
      protocolDigest: PROTOCOL_DIGEST,
    }),
  }) as Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>
}

function readyPromotion(): Extract<SuccessorLocalProjectProvisionResultV3, { status: "ready" }> {
  const local = v3Local()
  return Object.freeze({ status: "ready", state: local.state, stateDigest: local.stateDigest })
}

function id(byte: number) {
  return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => byte)))
}
