import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as ts from "typescript"

import {
  ProjectTeamCollaborationManagerV2,
  type ProjectTeamPeerSessionFactoryV2,
} from "./project-team-collaboration-manager"

const mainPath = fileURLToPath(new URL("./index.ts", import.meta.url))
const mainSource = readFileSync(mainPath, "utf8")

interface TestStatus {
  format: "convax.project-team-collaboration-status/2"
  projectId: string
  state: "local-only" | "starting" | "online" | "offline" | "viewer" | "attention"
  canEdit: boolean
  connectedPeerCount: number
  reason: string | null
}
interface TestService {
  activateLocalProject(projectId: string): Promise<TestStatus>
  activateProject(projectId: string): Promise<TestStatus>
  bootstrapTeam(projectId: string): Promise<{ invitation: null; status: TestStatus }>
  joinTeam(input: { projectId: string; invitation: unknown }): Promise<TestStatus>
  getStatus(projectId: string): TestStatus
  quiesceProject(projectId: string): Promise<void>
  subscribe(listener: (status: TestStatus) => void): () => void
}
interface TestRuntime {
  service: TestService
  dispose(): Promise<void>
}
interface TestActivationRequest {
  projectId: string
  service: Pick<TestService, "activateLocalProject" | "activateProject">
}
interface TestGate {
  service: Pick<TestService, "bootstrapTeam" | "joinTeam" | "getStatus" | "subscribe">
  activateProject(projectId: string): Promise<void>
  quiesceProject(projectId: string): Promise<void>
  dispose(): Promise<void>
}
type TeamRuntimeGateFactory = (input: {
  createRuntime(): TestRuntime
  activateProjectSharing(input: TestActivationRequest): Promise<TestStatus>
}) => TestGate

async function loadTeamRuntimeGateFactory(): Promise<TeamRuntimeGateFactory> {
  const sourceFile = ts.createSourceFile(mainPath, mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "createProjectTeamRuntimeGateV2")
  if (!declaration) throw new Error("Project Team runtime gate factory is missing from Main")
  const source = declaration.getText(sourceFile)
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const directory = await mkdtemp(join(tmpdir(), "convax-project-team-gate-"))
  const modulePath = join(directory, "gate.mjs")
  try {
    await writeFile(modulePath, javascript, "utf8")
    const loaded: unknown = await import(pathToFileURL(modulePath).href)
    if (!isTeamRuntimeGateModule(loaded)) throw new Error("Transpiled Team runtime gate module is invalid")
    return loaded.createProjectTeamRuntimeGateV2
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

function isTeamRuntimeGateModule(value: unknown): value is {
  createProjectTeamRuntimeGateV2: TeamRuntimeGateFactory
} {
  return typeof value === "object" && value !== null &&
    typeof Reflect.get(value, "createProjectTeamRuntimeGateV2") === "function"
}

const createTeamRuntimeGate = await loadTeamRuntimeGateFactory()

function localOnlyStatus(projectId: string): TestStatus {
  return Object.freeze({
    format: "convax.project-team-collaboration-status/2" as const,
    projectId,
    state: "local-only" as const,
    canEdit: false,
    connectedPeerCount: 0,
    reason: null,
  })
}

function onlineStatus(projectId: string): TestStatus {
  return Object.freeze({
    format: "convax.project-team-collaboration-status/2" as const,
    projectId,
    state: "online" as const,
    canEdit: true,
    connectedPeerCount: 1,
    reason: null,
  })
}

/** Activates only Projects with a durable Team binding, exactly like Main's sharing port. */
function sharingActivation(sharedProjects: ReadonlySet<string>) {
  return mock(async ({ projectId, service }: TestActivationRequest) =>
    sharedProjects.has(projectId)
      ? service.activateProject(projectId)
      : service.activateLocalProject(projectId))
}

function createRuntimeHarness(options: { failActivation?: boolean; waitForLocalActivation?: Promise<void> } = {}) {
  let currentStatus = localOnlyStatus("inactive")
  let statusListener: ((status: TestStatus) => void) | undefined
  let staleStatusListener: ((status: TestStatus) => void) | undefined
  let connectivityListener: ((online: boolean) => void) | undefined = (online) => {
    harness.connectivityCalls.push(online)
  }
  const harness = {
    activatedProjects: [] as string[],
    connectivityCalls: [] as boolean[],
    disposeCalls: 0,
    localActivatedProjects: [] as string[],
    quiescedProjects: [] as string[],
    unsubscribeCalls: 0,
    emitConnectivity(online: boolean) { connectivityListener?.(online) },
    emitStaleStatus(status: TestStatus) { staleStatusListener?.(status) },
  }
  const service: TestService = {
    async activateLocalProject(projectId) {
      harness.localActivatedProjects.push(projectId)
      if (options.waitForLocalActivation) await options.waitForLocalActivation
      currentStatus = localOnlyStatus(projectId)
      return currentStatus
    },
    async activateProject(projectId) {
      harness.activatedProjects.push(projectId)
      currentStatus = onlineStatus(projectId)
      statusListener?.(currentStatus)
      if (options.failActivation) throw new Error("rendezvous activation failed")
      return currentStatus
    },
    async bootstrapTeam(projectId) {
      return { invitation: null, status: localOnlyStatus(projectId) }
    },
    async joinTeam({ projectId }) {
      return localOnlyStatus(projectId)
    },
    getStatus() { return currentStatus },
    async quiesceProject(projectId) { harness.quiescedProjects.push(projectId) },
    subscribe(listener) {
      statusListener = listener
      staleStatusListener = listener
      return () => {
        harness.unsubscribeCalls += 1
        statusListener = undefined
      }
    },
  }
  const runtime: TestRuntime = {
    service,
    async dispose() {
      harness.disposeCalls += 1
      connectivityListener = undefined
    },
  }
  return Object.assign(harness, { runtime })
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : ""
}

describe("Desktop Main local-first Team runtime wiring", () => {
  test("startup recovery, node editing, Project switch and reopen construct no Team or network runtime", async () => {
    const teamControlFactory = mock(() => undefined)
    const apiSessionFactory = mock(() => undefined)
    const rendezvousFactory = mock(() => undefined)
    const peerJsFactory = mock(() => undefined)
    const createRuntime = mock(() => {
      teamControlFactory()
      apiSessionFactory()
      rendezvousFactory()
      peerJsFactory()
      throw new Error("network is unavailable")
    })
    const activateProjectSharing = sharingActivation(new Set())
    const gate = createTeamRuntimeGate({ activateProjectSharing, createRuntime })
    const restoreProject = mock(async () => undefined)
    const openProject = mock(async () => undefined)
    const editNode = mock(async () => undefined)
    const closeProject = mock(async () => undefined)

    await gate.activateProject("project-a")
    await restoreProject()
    await openProject()
    await editNode()
    await gate.quiesceProject("project-a")
    await closeProject()
    await gate.activateProject("project-b")
    await openProject()
    await editNode()
    await gate.quiesceProject("project-b")
    await gate.activateProject("project-a")
    await openProject()
    await editNode()

    expect(gate.service.getStatus("project-a")).toEqual(localOnlyStatus("project-a"))
    const staleError = await gate.service.bootstrapTeam("project-b").then(
      () => null,
      (error: unknown) => error,
    )
    expect(staleError).toBeInstanceOf(Error)
    expect(errorMessage(staleError)).toContain("stale")
    expect(gate.service.getStatus("project-a")).toEqual(localOnlyStatus("project-a"))

    expect(restoreProject).toHaveBeenCalledTimes(1)
    expect(openProject).toHaveBeenCalledTimes(3)
    expect(editNode).toHaveBeenCalledTimes(3)
    expect(closeProject).toHaveBeenCalledTimes(1)
    expect(activateProjectSharing).toHaveBeenCalledTimes(3)
    expect(createRuntime).not.toHaveBeenCalled()
    expect(teamControlFactory).not.toHaveBeenCalled()
    expect(apiSessionFactory).not.toHaveBeenCalled()
    expect(rendezvousFactory).not.toHaveBeenCalled()
    expect(peerJsFactory).not.toHaveBeenCalled()
    await gate.dispose()
  })

  test("an unshared Project activation stays local without constructing the network closure", async () => {
    const createRuntime = mock(() => { throw new Error("network is unavailable") })
    const activateProjectSharing = sharingActivation(new Set())
    const gate = createTeamRuntimeGate({ activateProjectSharing, createRuntime })

    await gate.activateProject("project-unshared")

    expect(activateProjectSharing).toHaveBeenCalledTimes(1)
    expect(createRuntime).not.toHaveBeenCalled()
    expect(gate.service.getStatus("project-unshared")).toEqual(localOnlyStatus("project-unshared"))
    await gate.dispose()
  })

  test("leaving a shared Project destroys the runtime, ignores old events and rebuilds only when shared again", async () => {
    const runtimes: ReturnType<typeof createRuntimeHarness>[] = []
    const createRuntime = mock(() => {
      const next = createRuntimeHarness()
      runtimes.push(next)
      return next.runtime
    })
    const activateProjectSharing = sharingActivation(new Set(["project-shared-a", "project-shared-b"]))
    const gate = createTeamRuntimeGate({ activateProjectSharing, createRuntime })
    const forwarded: TestStatus[] = []
    const unsubscribeGate = gate.service.subscribe((status) => forwarded.push(status))

    await gate.activateProject("project-shared-a")
    expect(createRuntime).toHaveBeenCalledTimes(1)
    const first = runtimes[0]
    expect(first.activatedProjects).toEqual(["project-shared-a"])
    first.emitConnectivity(false)
    expect(first.connectivityCalls).toEqual([false])

    await gate.activateProject("project-local")
    expect(first.unsubscribeCalls).toBe(1)
    expect(first.disposeCalls).toBe(1)
    expect(createRuntime).toHaveBeenCalledTimes(1)
    expect(gate.service.getStatus("project-local")).toEqual(localOnlyStatus("project-local"))

    first.emitConnectivity(true)
    expect(first.connectivityCalls).toEqual([false])
    const forwardedAfterDispose = forwarded.length
    first.emitStaleStatus(onlineStatus("project-shared-a"))
    expect(forwarded).toHaveLength(forwardedAfterDispose)

    await gate.quiesceProject("project-local")
    await gate.activateProject("project-local")
    expect(createRuntime).toHaveBeenCalledTimes(1)
    expect(gate.service.getStatus("project-local")).toEqual(localOnlyStatus("project-local"))

    await gate.activateProject("project-shared-b")
    expect(createRuntime).toHaveBeenCalledTimes(2)
    expect(runtimes[1].activatedProjects).toEqual(["project-shared-b"])

    unsubscribeGate()
    await gate.quiesceProject("project-shared-b")
    expect(runtimes[1].disposeCalls).toBe(1)
    await gate.dispose()
  })

  test("a failed Team activation destroys the partial runtime and cannot project an active Team", async () => {
    const failed = createRuntimeHarness({ failActivation: true })
    const createRuntime = mock(() => failed.runtime)
    const activateProjectSharing = sharingActivation(new Set(["project-broken-team"]))
    const gate = createTeamRuntimeGate({ activateProjectSharing, createRuntime })
    const forwarded: TestStatus[] = []
    gate.service.subscribe((status) => forwarded.push(status))

    const activationError = await gate.activateProject("project-broken-team").then(
      () => null,
      (error: unknown) => error,
    )
    expect(activationError).toBeInstanceOf(Error)
    expect(errorMessage(activationError)).toContain("rendezvous activation failed")

    expect(failed.unsubscribeCalls).toBe(1)
    expect(failed.disposeCalls).toBe(1)
    expect(gate.service.getStatus("project-broken-team")).toEqual({
      format: "convax.project-team-collaboration-status/2",
      projectId: "project-broken-team",
      state: "attention",
      canEdit: false,
      connectedPeerCount: 0,
      reason: "service-unavailable",
    })
    const forwardedAfterFailure = forwarded.length
    failed.emitStaleStatus(onlineStatus("project-broken-team"))
    expect(forwarded).toHaveLength(forwardedAfterFailure)
    expect(forwarded.at(-1)?.state).toBe("attention")
    await gate.dispose()
  })

  test("a Project switch prevents a stale activation from restoring cleared runtime state", async () => {
    let releaseLocalActivation: () => void = () => undefined
    const waitForLocalActivation = new Promise<void>((resolve) => { releaseLocalActivation = resolve })
    const runtimes: ReturnType<typeof createRuntimeHarness>[] = []
    const createRuntime = mock(() => {
      const next = createRuntimeHarness(runtimes.length === 0 ? { waitForLocalActivation } : undefined)
      runtimes.push(next)
      return next.runtime
    })
    const activateProjectSharing = sharingActivation(new Set())
    const gate = createTeamRuntimeGate({ activateProjectSharing, createRuntime })

    await gate.activateProject("project-race")
    const staleBootstrap = gate.service.bootstrapTeam("project-race").then(
      () => null,
      (error: unknown) => error,
    )
    expect(createRuntime).toHaveBeenCalledTimes(1)
    expect(runtimes[0].localActivatedProjects).toEqual(["project-race"])

    await gate.activateProject("project-other")
    expect(runtimes[0].disposeCalls).toBe(1)
    releaseLocalActivation()
    const staleError = await staleBootstrap
    expect(staleError).toBeInstanceOf(Error)
    expect(errorMessage(staleError)).toContain("became stale")
    expect(gate.service.getStatus("project-other")).toEqual(localOnlyStatus("project-other"))

    await gate.activateProject("project-race")
    await gate.service.bootstrapTeam("project-race")
    expect(createRuntime).toHaveBeenCalledTimes(2)
    expect(runtimes[1].localActivatedProjects).toEqual(["project-race"])
    await gate.dispose()
  })

  test("switching Projects aborts a real queued network activation before waiting for teardown", async () => {
    let activationStarted!: () => void
    const started = new Promise<void>((resolve) => { activationStarted = resolve })
    let activationAborted = false
    const openExisting: ProjectTeamPeerSessionFactoryV2["openExisting"] = ({ signal }) =>
      new Promise((_, reject) => {
        activationStarted()
        signal.addEventListener("abort", () => {
          activationAborted = true
          reject(signal.reason)
        }, { once: true })
      })
    const factory: ProjectTeamPeerSessionFactoryV2 = {
      openExisting,
      async bootstrapTeam() { throw new Error("bootstrap is not expected") },
      async joinTeam() { throw new Error("join is not expected") },
    }
    const manager = new ProjectTeamCollaborationManagerV2(factory)
    const runtime: TestRuntime = {
      service: {
        activateLocalProject: (projectId) => manager.activateLocalProject(projectId),
        activateProject: (projectId) => manager.activateProject(projectId),
        async bootstrapTeam(projectId) {
          const result = await manager.bootstrapTeam(projectId)
          return { invitation: null, status: result.status }
        },
        joinTeam: ({ projectId }) => manager.activateProject(projectId),
        getStatus: (projectId) => manager.getStatus(projectId),
        quiesceProject: (projectId) => manager.quiesceProject(projectId),
        subscribe: (listener) => manager.subscribe(listener),
      },
      dispose: () => manager.dispose(),
    }
    const gate = createTeamRuntimeGate({
      createRuntime: () => runtime,
      activateProjectSharing: sharingActivation(new Set(["project-shared"])),
    })

    const pendingShared = gate.activateProject("project-shared")
    await started
    await gate.activateProject("project-local")

    expect(activationAborted).toBe(true)
    await expect(pendingShared).rejects.toBeInstanceOf(Error)
    expect(gate.service.getStatus("project-local")).toEqual(localOnlyStatus("project-local"))
    await gate.dispose()
  })

  test("keeps every Team/control constructor inside the lazily created runtime closure", () => {
    const compositionStart = mainSource.indexOf("projectTeamRuntimeGate = createProjectTeamRuntimeGateV2({")
    const runtimeStart = mainSource.indexOf("createRuntime: () => {", compositionStart)
    const compositionEnd = mainSource.indexOf("const petAssetInspector", runtimeStart)
    expect(compositionStart).toBeGreaterThan(0)
    expect(runtimeStart).toBeGreaterThan(compositionStart)
    expect(compositionEnd).toBeGreaterThan(runtimeStart)

    const runtimeSource = mainSource.slice(runtimeStart, compositionEnd)
    for (const constructor of [
      "createDesktopCollaborationControlHttpClientV2({",
      "new ElectronTeamIdentityVaultV1(",
      "new NodeProjectTeamMemberIdentityStoreV1(",
      "new DesktopProjectTeamReplicaProvisionerV2({",
      "new ProductionProjectTeamPeerSessionFactoryV2({",
      "new ProjectTeamCollaborationManagerV2(",
      "net.isOnline()",
      'powerMonitor.on("resume"',
      'powerMonitor.removeListener("resume"',
      'app.removeListener("browser-window-focus"',
    ]) {
      expect(runtimeSource).toContain(constructor)
      expect(mainSource.slice(compositionStart, runtimeStart)).not.toContain(constructor)
    }
    expect(mainSource).toContain("await projectTeamRuntimeGate.activateProject(projectId)")
    expect(mainSource).toContain("publish(localOnlyStatus(projectId))")
    expect(mainSource).toContain("unavailableStatus(projectId)")
  })

  test("Main composes one collaboration runtime and never selects a protocol version", () => {
    expect(mainSource).toContain("createMainProjectCollaborationComposition({")
    expect(mainSource).not.toContain("v10-r5")
    expect(mainSource).not.toContain("v11-r1")
    expect(mainSource).not.toMatch(/selectedProtocol|activeProtocol|MainProjectProtocolSelection/)
  })
})
