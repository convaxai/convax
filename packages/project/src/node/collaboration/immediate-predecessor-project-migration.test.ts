import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseDigest } from "@convax/collaboration"

import { createImmediatePredecessorProjectMigrationPort } from "./immediate-predecessor-project-migration"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

describe("immediate predecessor Project migration open gate", () => {
  test("treats exact collaboration absence as fresh current without creating private bytes", async () => {
    const createdRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-fresh-migration-gate-"))
    roots.push(createdRoot)
    const projectRoot = await fs.realpath(createdRoot)
    let closedCalls = 0
    const port = createImmediatePredecessorProjectMigrationPort({
      authority: {
        inspectPredecessor: async () => { throw new Error("fresh Project must not inspect migration authority") },
        prepareCurrent: async () => { throw new Error("fresh Project must not issue migration authority") },
      },
      currentStore: neverUsedCurrentStore(),
      runtime: {
        async runClosed(input) {
          closedCalls += 1
          return input.operation()
        },
      },
    })
    await expect(port.ensureCurrent({ projectId: "project-fresh", projectRoot })).resolves.toEqual({ status: "current" })
    await expect(port.ensureCurrent({ projectId: "project-fresh", projectRoot })).resolves.toEqual({ status: "current" })
    expect(closedCalls).toBe(1)
    expect(await fs.readdir(projectRoot)).toEqual([])
  })
})

function neverUsedCurrentStore() {
  const unused = async () => { throw new Error("fresh Project must not touch current migration store") }
  return {
    authority: {
      protocolDigest: parseDigest("1".repeat(64)),
      schemaDigest: parseDigest("2".repeat(64)),
      uriProtocolDigest: parseDigest("3".repeat(64)),
      canvasSchemaDigest: parseDigest("4".repeat(64)),
    },
    materializer: {
      inspectFrame: unused,
      applyAcceptedFrame: unused,
      actorHeadsDigest: () => parseDigest("5".repeat(64)),
    },
    buildProjectIndexGenesis: unused,
    buildCanvasGenesis: unused,
    verifyCurrentStore: unused,
  } as never
}
