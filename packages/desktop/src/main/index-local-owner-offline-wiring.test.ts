import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as ts from "typescript"

const mainPath = fileURLToPath(new URL("./index.ts", import.meta.url))
const mainSource = readFileSync(mainPath, "utf8")

type TestProtocol = "v10-r5" | "v11-r1-local-owner" | "v11-r1-team-replica"
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
  activateProject(projectId: string, protocol: TestProtocol): Promise<void>
  quiesceProject(projectId: string): Promise<void>
  dispose(): Promise<void>
}
type ProtocolGateFactory = (input: {
  createRuntime(): TestRuntime
  activateV10Project(input: TestActivationRequest): Promise<TestStatus>
}) => TestGate

async function loadProtocolGateFactory(): Promise<ProtocolGateFactory> {
  const sourceFile = ts.createSourceFile(mainPath, mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "createProtocolGatedProjectTeamRuntimeV2")
  if (!declaration) throw new Error("Protocol-gated Project Team runtime factory is missing from Main")
  const source = declaration.getText(sourceFile)
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const directory = await mkdtemp(join(tmpdir(), "convax-project-team-gate-"))
  const modulePath = join(directory, "gate.mjs")
  try {
    await writeFile(modulePath, javascript, "utf8")
    const loaded: unknown = await import(pathToFileURL(modulePath).href)
    if (!isProtocolGateModule(loaded)) throw new Error("Transpiled protocol gate module is invalid")
    return loaded.createProtocolGatedProjectTeamRuntimeV2
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

function isProtocolGateModule(value: unknown): value is {
  createProtocolGatedProjectTeamRuntimeV2: ProtocolGateFactory
} {
  return typeof value === "object" && value !== null &&
    typeof Reflect.get(value, "createProtocolGatedProjectTeamRuntimeV2") === "function"
}

const createProtocolGate = await loadProtocolGateFactory()

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

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : ""
}

describe("Desktop Main V11 local-owner offline wiring", () => {
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
    const activateV10Project = mock(async () => localOnlyStatus("unexpected-v10"))
    const gate = createProtocolGate({ activateV10Project, createRuntime })
    const restoreProject = mock(async () => undefined)
    const openProject = mock(async () => undefined)
    const editNode = mock(async () => undefined)
    const closeProject = mock(async () => undefined)

    await gate.activateProject("project-a", "v11-r1-local-owner")
    await restoreProject()
    await openProject()
    await editNode()
    await gate.quiesceProject("project-a")
    await closeProject()
    await gate.activateProject("project-b", "v11-r1-local-owner")
    await openProject()
    await editNode()
    await gate.quiesceProject("project-b")
    await gate.activateProject("project-a", "v11-r1-local-owner")
    await openProject()
    await editNode()

    expect(gate.service.getStatus("project-a")).toEqual({
      format: "convax.project-team-collaboration-status/2",
      projectId: "project-a",
      state: "attention",
      canEdit: false,
      connectedPeerCount: 0,
      reason: "service-unavailable",
    })
    const bootstrapError = await gate.service.bootstrapTeam("project-a").then(
      () => null,
      (error: unknown) => error,
    )
    const joinError = await gate.service.joinTeam({ projectId: "project-a", invitation: {} }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(bootstrapError).toBeInstanceOf(Error)
    expect(errorMessage(bootstrapError)).toContain("Sharing and collaboration are unavailable")
    expect(joinError).toBeInstanceOf(Error)
    expect(errorMessage(joinError)).toContain("Sharing and collaboration are unavailable")

    expect(restoreProject).toHaveBeenCalledTimes(1)
    expect(openProject).toHaveBeenCalledTimes(3)
    expect(editNode).toHaveBeenCalledTimes(3)
    expect(closeProject).toHaveBeenCalledTimes(1)
    expect(activateV10Project).not.toHaveBeenCalled()
    expect(createRuntime).not.toHaveBeenCalled()
    expect(teamControlFactory).not.toHaveBeenCalled()
    expect(apiSessionFactory).not.toHaveBeenCalled()
    expect(rendezvousFactory).not.toHaveBeenCalled()
    expect(peerJsFactory).not.toHaveBeenCalled()
    await gate.dispose()
  })

  test("an unshared V10 selector read remains local without constructing the legacy network closure", async () => {
    const createRuntime = mock(() => { throw new Error("network is unavailable") })
    const activateV10Project = mock(async ({ projectId, service }: TestActivationRequest) =>
      service.activateLocalProject(projectId))
    const gate = createProtocolGate({ activateV10Project, createRuntime })

    await gate.activateProject("project-v10-local", "v10-r5")

    expect(activateV10Project).toHaveBeenCalledTimes(1)
    expect(createRuntime).not.toHaveBeenCalled()
    expect(gate.service.getStatus("project-v10-local")).toEqual(localOnlyStatus("project-v10-local"))
    await gate.dispose()
  })

  test("only durable or explicit V10 sharing demand constructs one runtime and Project switch quiesces it", async () => {
    let listener: ((status: TestStatus) => void) | undefined
    const service = {
      activateLocalProject: mock(async (projectId: string) => localOnlyStatus(projectId)),
      activateProject: mock(async (projectId: string) => localOnlyStatus(projectId)),
      bootstrapTeam: mock(async (projectId: string) => ({ invitation: null, status: localOnlyStatus(projectId) })),
      joinTeam: mock(async ({ projectId }: { projectId: string }) => localOnlyStatus(projectId)),
      getStatus: mock((projectId: string) => localOnlyStatus(projectId)),
      quiesceProject: mock(async () => undefined),
      subscribe: mock((next: (status: TestStatus) => void) => {
        listener = next
        return () => { listener = undefined }
      }),
    }
    const dispose = mock(async () => undefined)
    const createRuntime = mock(() => ({ dispose, service }))
    const activateV10Project = mock(async ({ projectId, service: activation }: TestActivationRequest) =>
      activation.activateProject(projectId))
    const gate = createProtocolGate({ activateV10Project, createRuntime })

    await gate.activateProject("project-shared", "v10-r5")
    expect(createRuntime).toHaveBeenCalledTimes(1)
    expect(service.activateProject).toHaveBeenCalledWith("project-shared")

    await gate.activateProject("project-local", "v11-r1-local-owner")
    expect(service.quiesceProject).toHaveBeenCalledWith("project-shared")
    expect(createRuntime).toHaveBeenCalledTimes(1)
    await gate.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(listener).toBeUndefined()
  })

  test("keeps every Team/control constructor inside the protocol-gated createRuntime closure", () => {
    const compositionStart = mainSource.indexOf("projectTeamRuntimeGate = createProtocolGatedProjectTeamRuntimeV2({")
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
    ]) {
      expect(runtimeSource).toContain(constructor)
      expect(mainSource.slice(compositionStart, runtimeStart)).not.toContain(constructor)
    }
    expect(mainSource).toContain("await projectTeamRuntimeGate.activateProject(projectId, selectedProtocol)")
    expect(mainSource).toContain('if (protocol !== "v10-r5")')
    expect(mainSource).toContain('unavailableStatus(projectId)')
  })
})
