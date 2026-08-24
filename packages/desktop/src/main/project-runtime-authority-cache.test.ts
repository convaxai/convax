import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  CURRENT_PROTOCOL_IDENTITIES,
  ordinarySha256,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseProjectId,
  parseReplicaId,
  type DocumentScope,
} from "@convax/collaboration"
import {
  NodeProjectCollaborationRuntimeCoordinator,
  type ProjectCollaborationRuntimeLease,
} from "@convax/project/node"

import {
  createProjectRuntimeAuthorityIdentityPort,
  ProjectRuntimeAuthorityCache,
} from "./project-runtime-authority-cache"

const encoder = new TextEncoder()
const digest = (value: string) => ordinarySha256(encoder.encode(value))
const id = (value: number) => parseId128(Buffer.alloc(16, value).toString("base64url"))
const projectId = parseProjectId("project")
const projectRoot = path.resolve("project")
const projectEpoch = id(1)
const actorId = parseActorId(Buffer.alloc(32, 2).toString("base64url"))
const protocolDigest = parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest)
const signer = Object.freeze({ async sign() { throw new Error("not used") } })
const owner = Object.freeze({
  binding: Object.freeze({
    projectId,
    projectEpoch,
    replicaId: parseReplicaId("replica_0000002a"),
    actorId,
    bindingDigest: digest("owner-binding"),
    protocolDigest,
  }),
  validationArtifacts: Object.freeze({ format: "convax.validation-artifact-set" as const, artifacts: Object.freeze([]) }),
  signer,
})

describe("ProjectRuntimeAuthorityCache", () => {
  test("shares one runtime-seeded owner across ProjectIndex and Canvas while rechecking Team current", async () => {
    let teamReads = 0
    let teamAuthorityCalls = 0
    let staticAuthorityReads = 0
    const cache = new ProjectRuntimeAuthorityCache({
      protocolDigest,
      team: { async resolveCurrent() { teamAuthorityCalls += 1; return "pending" } },
      localOwnerChanges: noOwnerChanges(),
      async teamState() { teamReads += 1; return "missing" },
    })
    let rootReads = 0
    const coordinator = new NodeProjectCollaborationRuntimeCoordinator({
      identity: createProjectRuntimeAuthorityIdentityPort({
        cache,
        async resolve() {
          // This is the production seam that reads manifest, binding and PKCS#8 signer.
          staticAuthorityReads += 1
          return { projectId, projectEpoch, localActorId: actorId, localOwner: owner }
        },
      }),
      materializer: {} as ConstructorParameters<typeof NodeProjectCollaborationRuntimeCoordinator>[0]["materializer"],
      projects: {
        async resolveProjectRoot() {
          rootReads += 1
          return projectRoot
        },
      },
      quiescence: { async quiesceProject() {} },
      writerFactory: {
        async open() {
          return { dispose() {} } as unknown as ProjectCollaborationRuntimeLease["persistence"]
        },
      },
    })
    const projectIndexLease = await coordinator.acquire(projectId)
    const canvasLease = await coordinator.acquire(projectId)

    const projectIndex = await cache.authorityFor(projectIndexLease).resolveCurrent(request(projectIndexScope()))
    const canvas = await cache.authorityFor(canvasLease).resolveCurrent(request(canvasScope()))

    expect(projectIndex).not.toBe("rejected")
    expect(canvas).not.toBe("rejected")
    if (typeof projectIndex === "string" || typeof canvas === "string") throw new Error("local owner was not selected")
    expect(projectIndex.signer).toBe(signer)
    expect(canvas.signer).toBe(signer)
    expect(rootReads).toBe(1)
    expect(staticAuthorityReads).toBe(1)
    expect(teamReads).toBe(2)
    expect(teamAuthorityCalls).toBe(0)
    projectIndexLease.release()
    canvasLease.release()
    await coordinator.dispose()
  })

  test("sticky-revokes local authority after a Team transition", async () => {
    let state: "missing" | "active" = "missing"
    let teamReads = 0
    let teamAuthorityCalls = 0
    const cache = new ProjectRuntimeAuthorityCache({
      protocolDigest,
      team: { async resolveCurrent() { teamAuthorityCalls += 1; return "pending" } },
      localOwnerChanges: noOwnerChanges(),
      async teamState() { teamReads += 1; return state },
    })
    const runtimeIdentity = Object.freeze({})
    await seedCache(cache, runtimeIdentity)
    const lease = fakeLease(runtimeIdentity)
    const authority = cache.authorityFor(lease)

    expect(await authority.resolveCurrent(request(canvasScope()))).not.toBe("rejected")
    state = "active"
    expect(await authority.resolveCurrent(request(canvasScope()))).toBe("pending")
    state = "missing"
    expect(await authority.resolveCurrent(request(canvasScope()))).toBe("rejected")
    expect(teamReads).toBe(3)
    expect(teamAuthorityCalls).toBe(1)
    await expect(seedCache(cache, runtimeIdentity)).rejects.toThrow("already seeded")
  })

  test("owner rotation and runtime release reject the old lease until a new runtime is seeded", async () => {
    let teamReads = 0
    let publishOwnerChange!: (change: { readonly projectId: typeof projectId }) => void
    const cache = new ProjectRuntimeAuthorityCache({
      protocolDigest,
      team: { async resolveCurrent() { return "pending" } },
      localOwnerChanges: {
        subscribeCurrentChange(listener) {
          publishOwnerChange = listener
          return () => undefined
        },
      },
      async teamState() { teamReads += 1; return "missing" },
    })
    const oldIdentity = Object.freeze({})
    await seedCache(cache, oldIdentity)
    const oldLease = fakeLease(oldIdentity)
    const oldAuthority = cache.authorityFor(oldLease)

    publishOwnerChange({ projectId })
    expect(await oldAuthority.resolveCurrent(request(canvasScope()))).toBe("rejected")
    cache.release({ projectId, projectRoot, runtimeIdentity: oldIdentity })
    expect(await oldAuthority.resolveCurrent(request(canvasScope()))).toBe("rejected")

    const newIdentity = Object.freeze({})
    await seedCache(cache, newIdentity)
    expect(await cache.authorityFor(fakeLease(newIdentity)).resolveCurrent(request(canvasScope()))).not.toBe("rejected")
    expect(teamReads).toBe(2)
  })

  test("rejects an owner change that races between static resolution and cache seed", async () => {
    let publishOwnerChange!: (change: { readonly projectId: typeof projectId }) => void
    let finishResolution!: () => void
    const resolutionBarrier = new Promise<void>((resolve) => { finishResolution = resolve })
    const cache = new ProjectRuntimeAuthorityCache({
      protocolDigest,
      team: { async resolveCurrent() { return "pending" } },
      localOwnerChanges: {
        subscribeCurrentChange(listener) {
          publishOwnerChange = listener
          return () => undefined
        },
      },
      async teamState() { return "missing" },
    })
    const identity = createProjectRuntimeAuthorityIdentityPort({
      cache,
      async resolve() {
        await resolutionBarrier
        return { projectId, projectEpoch, localActorId: actorId, localOwner: owner }
      },
    })
    const runtimeIdentity = Object.freeze({})
    const opening = identity.resolveLocalActorId({ projectId, projectRoot, runtimeIdentity })

    publishOwnerChange({ projectId })
    finishResolution()
    await expect(opening).rejects.toThrow("changed while its identity was opening")
    expect(await cache.authorityFor(fakeLease(runtimeIdentity)).resolveCurrent(request(canvasScope()))).toBe("rejected")

    const nextIdentity = Object.freeze({})
    await expect(identity.resolveLocalActorId({
      projectId,
      projectRoot,
      runtimeIdentity: nextIdentity,
    })).resolves.toBe(actorId)
    expect(await cache.authorityFor(fakeLease(nextIdentity)).resolveCurrent(request(canvasScope()))).not.toBe("rejected")
  })

  test("revokes a crossed release identity before rejecting the adapter bug", async () => {
    const cache = new ProjectRuntimeAuthorityCache({
      protocolDigest,
      team: { async resolveCurrent() { return "pending" } },
      localOwnerChanges: noOwnerChanges(),
      async teamState() { return "missing" },
    })
    const runtimeIdentity = Object.freeze({})
    await seedCache(cache, runtimeIdentity)
    const authority = cache.authorityFor(fakeLease(runtimeIdentity))

    expect(() => cache.release({ projectId, projectRoot: "/other", runtimeIdentity })).toThrow("crossed")
    expect(await authority.resolveCurrent(request(canvasScope()))).toBe("rejected")
  })
})

function noOwnerChanges() {
  return Object.freeze({
    subscribeCurrentChange() {
      return () => undefined
    },
  })
}

async function seedCache(cache: ProjectRuntimeAuthorityCache, runtimeIdentity: object): Promise<void> {
  const identity = createProjectRuntimeAuthorityIdentityPort({
    cache,
    async resolve() {
      return { projectId, projectEpoch, localActorId: actorId, localOwner: owner }
    },
  })
  await identity.resolveLocalActorId({ projectId, projectRoot, runtimeIdentity })
}

function fakeLease(runtimeIdentity: object): ProjectCollaborationRuntimeLease {
  return {
    projectId,
    projectRoot,
    collaborationDirectory: path.join(projectRoot, ".convax", "collaboration"),
    localActorId: actorId,
    persistence: undefined as unknown as ProjectCollaborationRuntimeLease["persistence"],
    runtimeIdentity,
    assertLive() {},
    release() {},
  }
}

function request(scope: DocumentScope) {
  return Object.freeze({
    scope,
    actorId,
    operationId: id(4),
    baseFrontierDigest: digest("frontier"),
    ownerSchemaDigest: digest("owner-schema"),
  })
}

function projectIndexScope(): DocumentScope {
  return Object.freeze({
    projectId,
    projectEpoch,
    docKind: "project-index" as const,
    docId: "project-index" as const,
    shardEpoch: id(2),
  })
}

function canvasScope(): DocumentScope {
  return Object.freeze({
    projectId,
    projectEpoch,
    docKind: "canvas" as const,
    docId: parseCanvasId(`cv_${"a".repeat(64)}`),
    shardEpoch: id(3),
  })
}
