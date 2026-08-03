import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ActorIdV2, ReplicaActorHeadSetV2 } from "@convax/collaboration"
import type { NodeReplicaHeadMaterializerV2 } from "./persistence-store"
import {
  NodeProjectCollaborationRuntimeCoordinatorV2,
  ProjectCollaborationRuntimeCoordinatorErrorV2,
  type ProjectCollaborationRuntimeLeaseV2,
} from "./project-collaboration-runtime-coordinator"

const roots: string[] = []
const localActorId = Buffer.alloc(32, 7).toString("base64url") as ActorIdV2
const otherActorId = Buffer.alloc(32, 8).toString("base64url") as ActorIdV2

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("NodeProjectCollaborationRuntimeCoordinatorV2", () => {
  test("shares one Project-owned writer and closes it before reset mutation", async () => {
    const projectRoot = await createProjectRoot()
    const leases: ProjectCollaborationRuntimeLeaseV2[] = []
    const coordinator = createCoordinator(projectRoot, async () => {
      for (const lease of leases.splice(0)) lease.release()
    })

    const first = await coordinator.acquire("project-a")
    const second = await coordinator.acquire("project-a")
    leases.push(first, second)
    expect(first.persistence).toBe(second.persistence)
    expect(first.collaborationDirectory).toBe(path.join(projectRoot, ".convax", "collaboration"))

    let resetRan = false
    const result = await coordinator.runClosed({
      operation: async () => {
        resetRan = true
        return "published" as const
      },
      projectId: "project-a",
      projectRoot,
    })
    expect(result).toBe("published")
    expect(resetRan).toBe(true)

    const reopened = await coordinator.acquire("project-a")
    expect(reopened.persistence).not.toBe(first.persistence)
    reopened.release()
    await coordinator.dispose()
  })

  test("opens two Projects with independently resolved local actors", async () => {
    const firstRoot = await createProjectRoot()
    const secondRoot = await createProjectRoot()
    const rootsByProject = new Map([["project-a", firstRoot], ["project-b", secondRoot]])
    const actorsByProject = new Map([["project-a", localActorId], ["project-b", otherActorId]])
    const coordinator = new NodeProjectCollaborationRuntimeCoordinatorV2({
      identity: {
        async resolveLocalActorId({ projectId }) { return actorsByProject.get(projectId)! },
      },
      materializer: inertMaterializer(),
      projects: {
        async resolveProjectRoot({ projectId }) { return rootsByProject.get(projectId)! },
      },
      quiescence: { async quiesceProject() {} },
    })

    const first = await coordinator.acquire("project-a")
    const second = await coordinator.acquire("project-b")
    expect(first.localActorId).toBe(localActorId)
    expect(second.localActorId).toBe(otherActorId)
    expect(first.persistence).not.toBe(second.persistence)
    first.release()
    second.release()
    await coordinator.dispose()
  })

  test("reset closes the old actor-bound writer and reopens with the new epoch actor", async () => {
    const projectRoot = await createProjectRoot()
    let actorId = localActorId
    const leases: ProjectCollaborationRuntimeLeaseV2[] = []
    const coordinator = new NodeProjectCollaborationRuntimeCoordinatorV2({
      identity: { async resolveLocalActorId() { return actorId } },
      materializer: inertMaterializer(),
      projects: { async resolveProjectRoot() { return projectRoot } },
      quiescence: { async quiesceProject() { for (const lease of leases.splice(0)) lease.release() } },
    })
    const old = await coordinator.acquire("project-a")
    leases.push(old)
    await coordinator.runClosed({
      projectId: "project-a",
      projectRoot,
      async operation() { actorId = otherActorId },
    })

    const reopened = await coordinator.acquire("project-a")
    expect(reopened.localActorId).toBe(otherActorId)
    expect(reopened.persistence).not.toBe(old.persistence)
    reopened.release()
    await coordinator.dispose()
  })

  test("fails closed if the local actor binding drifts without a close/reset barrier", async () => {
    const projectRoot = await createProjectRoot()
    let actorId = localActorId
    const coordinator = new NodeProjectCollaborationRuntimeCoordinatorV2({
      identity: { async resolveLocalActorId() { return actorId } },
      materializer: inertMaterializer(),
      projects: { async resolveProjectRoot() { return projectRoot } },
      quiescence: { async quiesceProject() {} },
    })
    const lease = await coordinator.acquire("project-a")
    lease.release()
    actorId = otherActorId
    await expect(coordinator.acquire("project-a")).rejects.toMatchObject({ code: "project-binding-changed" })
    await coordinator.dispose()
  })

  test("fails closed when host quiescence leaves a collaboration session active", async () => {
    const projectRoot = await createProjectRoot()
    const coordinator = createCoordinator(projectRoot, async () => undefined)
    const lease = await coordinator.acquire("project-a")
    let resetRan = false

    await expect(
      coordinator.runClosed({
        operation: async () => {
          resetRan = true
        },
        projectId: "project-a",
        projectRoot,
      }),
    ).rejects.toMatchObject({ code: "project-sessions-still-active" })
    expect(resetRan).toBe(false)

    lease.release()
    await coordinator.dispose()
  })

  test("serializes acquisition behind an active Project close gate", async () => {
    const projectRoot = await createProjectRoot()
    const coordinator = createCoordinator(projectRoot, async () => undefined)
    let finishReset!: () => void
    const resetBarrier = new Promise<void>((resolve) => {
      finishReset = resolve
    })
    const reset = coordinator.runClosed({
      operation: () => resetBarrier,
      projectId: "project-a",
      projectRoot,
    })
    await Promise.resolve()

    let acquired = false
    const pendingLease = coordinator.acquire("project-a").then((lease) => {
      acquired = true
      return lease
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(acquired).toBe(false)

    finishReset()
    await reset
    const lease = await pendingLease
    expect(acquired).toBe(true)
    lease.release()
    await coordinator.dispose()
  })

  test("rejects a stale reset root before host quiescence", async () => {
    const projectRoot = await createProjectRoot()
    let quiesced = false
    const coordinator = createCoordinator(projectRoot, async () => {
      quiesced = true
    })

    await expect(
      coordinator.runClosed({
        operation: async () => undefined,
        projectId: "project-a",
        projectRoot: path.join(projectRoot, "stale"),
      }),
    ).rejects.toBeInstanceOf(ProjectCollaborationRuntimeCoordinatorErrorV2)
    expect(quiesced).toBe(false)
    await coordinator.dispose()
  })

  test("a released lease closes its writer after shutdown starts", async () => {
    const projectRoot = await createProjectRoot()
    const coordinator = createCoordinator(projectRoot, async () => undefined)
    const lease = await coordinator.acquire("project-a")
    await expect(coordinator.dispose()).rejects.toBeInstanceOf(AggregateError)
    expect(() => coordinator.acquire("project-a")).toThrow(
      expect.objectContaining({ code: "runtime-disposed" }),
    )
    lease.release()
  })
})

async function createProjectRoot(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-runtime-"))
  roots.push(projectRoot)
  await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
  return fs.realpath(projectRoot)
}

function createCoordinator(projectRoot: string, quiesceProject: () => Promise<void>) {
  return new NodeProjectCollaborationRuntimeCoordinatorV2({
    identity: { async resolveLocalActorId() { return localActorId } },
    materializer: inertMaterializer(),
    projects: {
      async resolveProjectRoot(input) {
        if (input.projectId !== "project-a") throw new Error("unknown Project")
        return projectRoot
      },
    },
    quiescence: {
      async quiesceProject() {
        await quiesceProject()
      },
    },
  })
}

function inertMaterializer(): NodeReplicaHeadMaterializerV2 {
  return {
    actorHeadsDigest(_actorHeads: ReplicaActorHeadSetV2) {
      return "0".repeat(64) as ReturnType<NodeReplicaHeadMaterializerV2["actorHeadsDigest"]>
    },
    async applyAcceptedFrame() {
      throw new Error("not used")
    },
    async inspectFrame() {
      throw new Error("not used")
    },
  }
}
