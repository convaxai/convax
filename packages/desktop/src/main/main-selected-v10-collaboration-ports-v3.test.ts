import { expect, mock, test } from "bun:test"
import { parseProjectId } from "@convax/collaboration"

import { openMainSelectedV10CollaborationPortsV3 } from "./main-selected-v10-collaboration-ports-v3"

const PROJECT = parseProjectId(`project_${"a".repeat(64)}`)

test("V10 selected ports switch before publication and quiesce every V10 owner exactly once", async () => {
  const calls: string[] = []
  const switchProject = mock(async () => { calls.push("switch") })
  const quiesceSessions = mock(async () => { calls.push("sessions") })
  const quiesceRoutes = mock(async () => { calls.push("routes") })
  const quiesceIndexes = mock(async () => { calls.push("indexes") })
  const ports = await openMainSelectedV10CollaborationPortsV3({
    projectId: PROJECT,
    projectIndexes: Object.freeze({ quiesceProject: quiesceIndexes }) as never,
    canvasSessions: Object.freeze({ quiesceProject: quiesceSessions }) as never,
    canvasRoutes: Object.freeze({ switchProject, quiesceProject: quiesceRoutes }),
  })

  expect(ports.projectId).toBe(PROJECT)
  expect(ports.protocol).toBe("v10-r5")
  expect(calls).toEqual(["switch"])
  await ports.quiesce?.()
  await ports.quiesce?.()
  expect(calls).toEqual(["switch", "sessions", "routes", "indexes"])
})
