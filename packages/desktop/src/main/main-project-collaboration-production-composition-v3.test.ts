import { expect, mock, test } from "bun:test"
import { parseProjectIdV2 } from "@convax/collaboration"

import { createMainProjectCollaborationProductionCompositionV3 } from "./main-project-collaboration-production-composition-v3"

const PROJECT = parseProjectIdV2(`project_${"a".repeat(64)}`)

function composition() {
  const events: string[] = []
  const projectIndexes = Object.freeze({
    queryCatalog: mock(async () => {
      events.push("index:query")
      return Object.freeze({})
    }),
    quiesceProject: mock(async () => {
      events.push("index:quiesce")
    }),
  })
  const canvasSessions = Object.freeze({
    resumeProject: mock(() => {
      events.push("canvas:resume")
    }),
    quiesceProject: mock(async () => {
      events.push("canvas:quiesce")
    }),
  })
  const canvasRoutes = Object.freeze({
    switchProject: mock(async () => {
      events.push("route:switch")
    }),
    quiesceProject: mock(async () => {
      events.push("route:quiesce")
    }),
  })
  const facade = createMainProjectCollaborationProductionCompositionV3({
    projectIndexes: projectIndexes as never,
    canvasSessions: canvasSessions as never,
    canvasRoutes,
  })
  return { canvasRoutes, canvasSessions, events, facade, projectIndexes }
}

test("production composition resolves every Project through the one current runtime", async () => {
  const { canvasRoutes, events, facade } = composition()

  expect(await facade.prepareProject(PROJECT)).toBe("v10-r5")
  expect(canvasRoutes.switchProject).toHaveBeenCalledWith(PROJECT)
  expect(events).toEqual(["route:switch", "canvas:resume"])
  await facade.dispose()
})

test("production composition quiesces the current runtime without a protocol transition", async () => {
  const { canvasRoutes, events, facade, projectIndexes } = composition()

  await facade.prepareProject(PROJECT)
  await facade.quiesceProject(PROJECT)

  expect(projectIndexes.quiesceProject).toHaveBeenCalledTimes(1)
  expect(canvasRoutes.quiesceProject).toHaveBeenCalledTimes(1)
  expect(events.at(-1)).toBe("index:quiesce")
  await facade.dispose()
})
