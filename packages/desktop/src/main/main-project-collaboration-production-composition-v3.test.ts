import { expect, mock, test } from "bun:test"
import {
  encodeBase64urlV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
} from "@convax/collaboration"
import type { OpenSuccessorProjectProtocolStateV3 } from "@convax/project/node"

import { createMainProjectCollaborationProductionCompositionV3 } from "./main-project-collaboration-production-composition-v3"
import type { MainProjectCollaborationSelectionContextV3 } from "./main-project-collaboration-port-resolver-v3"
import type { MainSelectedProjectCollaborationPortsV3 } from "./project-collaboration-composition-v3"

const PROJECT = parseProjectIdV2(`project_${"a".repeat(64)}`)
const EPOCH = parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => 1)))
const DIGEST = parseDigestV2("b".repeat(64))

test("production composition exposes only the facade and leaves V10/V3 selection to persisted state", async () => {
  const state = Object.freeze({
    status: "v3-local",
    stateDigest: parseDigestV2("c".repeat(64)),
    state: Object.freeze({ projectId: PROJECT, projectEpoch: EPOCH, protocolDigest: DIGEST }),
  }) as Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>
  const context: MainProjectCollaborationSelectionContextV3 = Object.freeze({
    projectId: PROJECT,
    projectEpoch: EPOCH,
    protocolStore: Object.freeze({
      open: mock(async () => state),
      recoverPromotion: mock(async () => state),
    }),
    provisioner: Object.freeze({ promoteVerifiedV10: mock(async () => Object.freeze({ status: "rejected", reason: "ambiguous" as const })) }),
  })
  const v3 = Object.freeze({
    projectId: PROJECT,
    protocol: "v11-r1-local-owner",
    projectIndexes: Object.freeze({}),
    canvasSessions: Object.freeze({ resumeProject: mock(() => undefined) }),
  }) as unknown as MainSelectedProjectCollaborationPortsV3
  const openLocal = mock(async () => v3)
  const facade = createMainProjectCollaborationProductionCompositionV3({
    successorProtocolDigest: DIGEST,
    createPromotionId: () => EPOCH,
    successor: Object.freeze({ resolveContext: mock(async () => context), openLocal }),
    v10: Object.freeze({
      projectIndexes: Object.freeze({ quiesceProject: mock(async () => undefined) }) as never,
      canvasSessions: Object.freeze({ quiesceProject: mock(async () => undefined) }) as never,
      canvasRoutes: Object.freeze({ switchProject: mock(async () => undefined), quiesceProject: mock(async () => undefined) }),
    }),
  })

  expect(await facade.prepareProject(PROJECT)).toBe("v11-r1-local-owner")
  expect(openLocal).toHaveBeenCalledTimes(1)
  await facade.dispose()
})

test("production composition registers an absent V10 ProjectIndex before retrying successor promotion", async () => {
  const events: string[] = []
  const state = Object.freeze({
    status: "v3-local",
    stateDigest: parseDigestV2("c".repeat(64)),
    state: Object.freeze({ projectId: PROJECT, projectEpoch: EPOCH, protocolDigest: DIGEST }),
  }) as Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>
  const context: MainProjectCollaborationSelectionContextV3 = Object.freeze({
    projectId: PROJECT,
    projectEpoch: EPOCH,
    protocolStore: Object.freeze({
      open: mock(async () => state),
      recoverPromotion: mock(async () => state),
    }),
    provisioner: Object.freeze({
      promoteVerifiedV10: mock(async () => Object.freeze({ status: "rejected", reason: "ambiguous" as const })),
    }),
  })
  let contextAttempts = 0
  const resolveContext = mock(async () => {
    contextAttempts += 1
    events.push(`context:${contextAttempts}`)
    if (contextAttempts === 1) {
      const missing = new Error("Project collaboration store is absent") as NodeJS.ErrnoException
      missing.code = "ENOENT"
      throw missing
    }
    return context
  })
  const v3 = Object.freeze({
    projectId: PROJECT,
    protocol: "v11-r1-local-owner",
    projectIndexes: Object.freeze({}),
    canvasSessions: Object.freeze({ resumeProject: mock(() => undefined) }),
  }) as unknown as MainSelectedProjectCollaborationPortsV3
  const projectIndexes = Object.freeze({
    queryCatalog: mock(async () => {
      events.push("v10:register")
      return Object.freeze({})
    }),
    quiesceProject: mock(async () => {
      events.push("v10:index-quiesce")
    }),
  })
  const canvasSessions = Object.freeze({
    quiesceProject: mock(async () => {
      events.push("v10:canvas-quiesce")
    }),
  })
  const canvasRoutes = Object.freeze({
    switchProject: mock(async () => {
      events.push("v10:switch")
    }),
    quiesceProject: mock(async () => {
      events.push("v10:route-quiesce")
    }),
  })
  const facade = createMainProjectCollaborationProductionCompositionV3({
    successorProtocolDigest: DIGEST,
    createPromotionId: () => EPOCH,
    successor: Object.freeze({ resolveContext, openLocal: mock(async () => v3) }),
    v10: Object.freeze({
      projectIndexes: projectIndexes as never,
      canvasSessions: canvasSessions as never,
      canvasRoutes,
    }),
  })

  expect(await facade.prepareProject(PROJECT)).toBe("v11-r1-local-owner")
  expect(resolveContext).toHaveBeenCalledTimes(2)
  expect(projectIndexes.queryCatalog).toHaveBeenCalledWith({ projectId: PROJECT })
  expect(events.indexOf("v10:register")).toBeGreaterThan(events.indexOf("context:1"))
  expect(events.indexOf("context:2")).toBeGreaterThan(events.indexOf("v10:index-quiesce"))
  await facade.dispose()
})
