import fs from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isTransientDebuggerEvaluationError } from "./debugger-evaluation-error"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const desktopRoot = path.join(repositoryRoot, "packages", "desktop")
// This smoke runs after the complete monorepo test/build workload. Give Electron
// and animation-driven viewport state enough time to quiesce on a saturated CI
// host; every wait below still requires the exact observable state.
const timeoutMs = 45_000
const evaluationTimeoutMs = timeoutMs * 2 + 10_000

const require = createRequire(path.join(desktopRoot, "package.json"))
const electronPackageRoot = path.dirname(require.resolve("electron/package.json"))

async function resolveElectronBinary() {
  const pathFile = path.join(electronPackageRoot, "path.txt")
  const relativeBinary = await fs
    .readFile(pathFile, "utf8")
    .then((value) => value.trim())
    .catch(() => "")
  if (!relativeBinary) {
    throw new Error("Electron runtime is missing; run its install script before the desktop smoke")
  }
  const binary = path.join(electronPackageRoot, "dist", relativeBinary)
  await fs.access(binary).catch(() => {
    throw new Error(`Electron runtime is missing: ${binary}`)
  })
  return binary
}

interface DebugTarget {
  type: string
  url?: string
  webSocketDebuggerUrl?: string
}

function reservePort() {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  })
}

async function waitForTarget(port: number, predicate: (target: DebugTarget) => boolean) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = (await response.json()) as DebugTarget[]
      const target = targets.find(predicate)
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for debugger target on port ${port}${lastError ? `: ${String(lastError)}` : ""}`)
}

async function evaluate(webSocketUrl: string, expression: string) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error("Timed out waiting for debugger evaluation"))
    }, evaluationTimeoutMs)

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { awaitPromise: true, expression, returnByValue: true },
        }),
      )
    })
    socket.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("Debugger WebSocket failed"))
    })
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        error?: { message: string }
        id?: number
        result?: {
          exceptionDetails?: { exception?: { description?: string }; text?: string }
          result?: { value?: unknown }
        }
      }
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      if (message.result?.exceptionDetails) {
        const description =
          message.result.exceptionDetails.exception?.description ??
          message.result.exceptionDetails.text ??
          "Debugger evaluation failed"
        return reject(new Error(`${description}: ${JSON.stringify(message.result.exceptionDetails)}`))
      }
      resolve(message.result?.result?.value)
    })
  })
}

async function sendDebuggerCommand(webSocketUrl: string, method: string, params: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`Timed out waiting for debugger command ${method}`))
    }, evaluationTimeoutMs)

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }))
    })
    socket.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error(`Debugger command ${method} failed`))
    })
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        error?: { message: string }
        id?: number
        result?: unknown
      }
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      resolve(message.result)
    })
  })
}

async function evaluateStable(webSocketUrl: string, expression: string) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      return await evaluate(webSocketUrl, expression)
    } catch (error) {
      if (!isTransientDebuggerEvaluationError(error) || Date.now() >= deadline) {
        throw error
      }
      await Bun.sleep(100)
    }
  }
}

async function collectOutput(stream: ReadableStream<Uint8Array>) {
  let output = ""
  for await (const chunk of stream) output += new TextDecoder().decode(chunk)
  return output
}

const electronBinary = await resolveElectronBinary()
await fs.access(path.join(desktopRoot, "out", "main", "index.js")).catch(() => {
  throw new Error("Desktop output is missing; run `bun --cwd packages/desktop build` before the smoke")
})
const builtRendererUrl = pathToFileURL(path.join(desktopRoot, "out", "renderer", "index.html")).href
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-built-open-project-"))
const projectRoot = path.join(temporaryRoot, "empty-project")
const userDataRoot = path.join(temporaryRoot, "user-data")
await fs.mkdir(projectRoot)
await fs.mkdir(userDataRoot)
await Promise.all([fs.mkdir(path.join(projectRoot, "Generated")), fs.mkdir(path.join(projectRoot, "Notes"))])
await Promise.all([
  fs.writeFile(path.join(projectRoot, "Notes", "generation-smoke.md"), "Before generation\n"),
  fs.writeFile(path.join(projectRoot, "Generated", "generation-race-result.md"), "Generated after the race\n"),
  fs.writeFile(path.join(projectRoot, "Generated", "generation-late-result.md"), "Must not land\n"),
])
// This smoke exercises the built Desktop surface, not the availability or
// throughput of a published GitHub Release. A durable default receipt with no
// installed package is the supported "user removed this default" state, so it
// keeps the run offline while still exercising normal startup reconciliation.
await fs.writeFile(
  path.join(userDataRoot, "default-capabilities.json"),
  `${JSON.stringify({ plugins: ["ffmpeg-tools"], schema: "convax.default-capabilities/1", skills: [] }, null, 2)}\n`,
)
const rendererPortReservation = reservePort()
const inspectorPortReservation = reservePort()
const rendererPort = rendererPortReservation.port
const inspectorPort = inspectorPortReservation.port
rendererPortReservation.stop(true)
inspectorPortReservation.stop(true)
const child = Bun.spawn(
  [electronBinary, `--inspect=${inspectorPort}`, `--remote-debugging-port=${rendererPort}`, desktopRoot],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CONVAX_ALLOW_MULTIPLE_INSTANCES: "1",
      CONVAX_USER_DATA_DIR: userDataRoot,
    },
    stderr: "pipe",
    stdout: "pipe",
  },
)
const stderr = collectOutput(child.stderr)
const stdout = collectOutput(child.stdout)

try {
  const [mainDebugger, rendererDebugger] = await Promise.all([
    waitForTarget(inspectorPort, () => true),
    waitForTarget(rendererPort, (target) => target.type === "page" && target.url === builtRendererUrl),
  ])
  const electronRequireBase = path.join(desktopRoot, "package.json")
  await evaluateStable(
    mainDebugger,
    `(() => {
    const createRequire = process.getBuiltinModule("module").createRequire
    const electron = createRequire(${JSON.stringify(electronRequireBase)})("electron")
    electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(projectRoot)}] })
    electron.ipcMain.removeHandler("agent:skills-list")
    electron.ipcMain.handle("agent:skills-list", () => ({
      catalog: [{
        description: "Convert a brief into connected, reviewable shot cards.",
        id: "canvas-storyboard",
        installed: true,
        name: "Storyboard Builder",
      }],
      skills: [{
        description: "Convert a brief into connected, reviewable shot cards.",
        displayName: "Storyboard Builder",
        location: "/managed/canvas-storyboard/SKILL.md",
        management: { kind: "standalone" },
        managed: true,
        name: "canvas-storyboard",
        source: "managed",
      }],
    }))
    electron.ipcMain.removeHandler("agent:skill-details")
    electron.ipcMain.handle("agent:skill-details", (_event, input) => {
      if (input?.target?.kind !== "installed" || input.target.name !== "canvas-storyboard") {
        throw new Error("The smoke Skill detail target changed unexpectedly")
      }
      const content = [
        "---",
        "name: canvas-storyboard",
        "description: Convert a brief into connected, reviewable shot cards.",
        "---",
        "",
        "# Storyboard Builder",
      ].join("\\n")
      return {
        description: "Convert a brief into connected, reviewable shot cards.",
        files: [{ content, kind: "text", path: "SKILL.md", size: Buffer.byteLength(content) }],
        id: "canvas-storyboard",
        name: "Storyboard Builder",
      }
    })
    // This smoke verifies the built renderer's real composer input, picker
    // geometry, and Canvas/Plugin flows. Keep those assertions independent from
    // the machine's OpenCode session database and startup latency.
    electron.ipcMain.removeHandler("agent:session-list")
    electron.ipcMain.handle("agent:session-list", () => [])
    return true
  })()`,
  )

  const result = await evaluateStable(
    rendererDebugger,
    `(async () => {
    const waitFor = async (read, label) => {
      const deadline = Date.now() + ${timeoutMs}
      while (Date.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("Timed out waiting for " + label)
    }
    const buttonWithText = (text) => [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === text)
    const buttonWithAnyText = (...texts) => texts
      .map((text) => buttonWithText(text))
      .find(Boolean)
    const buttonContainingText = (text) => [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes(text))
    const preloadDeadline = Date.now() + ${timeoutMs}
    while (!window.convax) {
      if (Date.now() >= preloadDeadline) throw new Error("The preload bridge did not become ready")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const initialSurface = await waitFor(
      () => document.querySelector('[data-project-home="true"]') || document.querySelector(".convax-canvas"),
      "Project Home or the restored Canvas",
    )
    const projectAlreadyOpen = initialSurface instanceof Element
      && initialSurface.classList.contains("convax-canvas")
    if (!projectAlreadyOpen && (buttonWithText("Skill & Plugin") || buttonWithText("技能与插件"))) {
      throw new Error("The empty Project surface exposed global capabilities")
    }
    if (!projectAlreadyOpen) {
      const enterProject = await waitFor(
        () => buttonWithAnyText("Continue", "继续", "Open project", "打开项目"),
        "the Project Home enter action",
      )
      enterProject.click()
    }
    const canvasElement = await waitFor(
      () => document.querySelector(".convax-canvas"),
      "the active Canvas",
    ).catch((error) => {
      const home = document.querySelector('[data-project-home="true"]')
      const alert = home?.querySelector('[role="alert"]')?.textContent?.trim()
      const buttons = [...(home?.querySelectorAll("button") ?? [])]
        .map((button) => ({
          disabled: button.disabled,
          text: button.textContent?.trim(),
        }))
      throw new Error(
        String(error)
          + "; Project Home state: "
          + JSON.stringify({ alert, buttons, text: home?.textContent?.trim().slice(0, 500) }),
      )
    })
    await waitFor(() => !document.body.textContent?.includes("Loading canvas"), "Canvas hydration")

    const projects = await window.convax.projects.listProjects()
    const project = projects.projects.find((candidate) => candidate.name === "empty-project")
    if (!project) throw new Error("Open Project did not return a project")
    const projectId = project.id
    const catalog = await window.convax.projects.canvases.getCanvasCatalog({ projectId })
    const selectedCanvasId = catalog.canvases[0]?.id
    if (!selectedCanvasId) throw new Error("Project did not create its default Canvas")
    const initialDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const persistedGenerationRace = JSON.parse(
      sessionStorage.getItem("convax.smoke.generation-race.v1") ?? "null",
    )
    if (!persistedGenerationRace && initialDocument.document?.nodes.length !== 0) {
      throw new Error("A new Canvas was not empty")
    }
    if (persistedGenerationRace && !persistedGenerationRace.remountVerified) {
      const remountedOwner = initialDocument.document?.nodes.find(
        (node) => node.id === "generation-race-owner",
      )
      const remountedRun = remountedOwner?.data.metadata?.convaxGenerationRun
      if (
        remountedRun?.status !== "succeeded"
        || remountedRun.prompt !== "Persist this prompt through a Canvas race"
        || remountedRun.toolId !== "smoke-tools/text.generate"
        || remountedRun.taskId !== "task_built_smoke_123"
      ) {
        throw new Error("Persisted terminal generation state did not hydrate after the real Renderer remount")
      }
      await waitFor(
        () => document.querySelector(
          '[data-canvas-file-generation-activity="succeeded"][data-canvas-generation-run-tool-id="smoke-tools/text.generate"]',
        ),
        "the persisted terminal generation surface after Renderer remount",
      )
      const cleanup = await window.convax.canvas.documents.execute({
        command: {
          nodeIds: [
            "generation-race-owner",
            "generation-race-unrelated",
            "generation-restart-fallback-owner",
          ],
          type: "elements.remove",
        },
        commandId: "smoke-generation-cleanup-after-remount",
        expectedRevision: initialDocument.document.revision,
        ref: { canvasId: selectedCanvasId, scopeId: projectId },
      })
      if (cleanup.document.nodes.some((node) => node.id.startsWith("generation-"))) {
        throw new Error("Generation smoke cleanup after remount was incomplete")
      }
      sessionStorage.setItem(
        "convax.smoke.generation-race.v1",
        JSON.stringify({ ...persistedGenerationRace, remountVerified: true }),
      )
      // The command above proves the authoritative cleanup. Reload once more
      // instead of depending on a renderer projection request during a page
      // navigation boundary.
      location.reload()
      await new Promise(() => {})
    }
    if (persistedGenerationRace?.remountVerified && initialDocument.document?.nodes.length !== 0) {
      throw new Error("Generation smoke cleanup did not survive the second Renderer remount")
    }
    if (!persistedGenerationRace) {
      // Exercise the built Main/IPC/Canvas persistence boundary with the two
      // generation races most likely to regress: an unrelated concurrent edit
      // during a run transition, and a late replacement after target deletion.
    const generationOwner = {
      data: {
        kind: "text",
        label: "Generation race owner",
        metadata: {
          convaxProjectResource: { kind: "project-file", path: "Notes/generation-smoke.md" },
        },
        name: "generation-race-owner.md",
        resourceState: { status: "ready", text: "Before generation" },
      },
      id: "generation-race-owner",
      position: { x: -720, y: 0 },
      type: "file",
    }
    const addedGenerationOwner = await window.convax.canvas.documents.execute({
      command: {
        addedEdges: [],
        addedNodes: [generationOwner],
        removedEdgeIds: [],
        removedNodeIds: [],
        type: "document.patch",
        updatedEdges: [],
        updatedNodes: [],
      },
      commandId: "smoke-generation-owner-add",
      expectedRevision: initialDocument.document?.revision ?? 0,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const persistedGenerationSnapshot = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const persistedGenerationOwner = persistedGenerationSnapshot.document?.nodes.find(
      (node) => node.id === generationOwner.id,
    )
    if (!persistedGenerationOwner) throw new Error("Generation smoke owner was not persisted")
    const generationGuardData = structuredClone(persistedGenerationOwner.data)
    delete generationGuardData.resourceState
    if (generationGuardData.metadata) {
      delete generationGuardData.metadata.convaxGenerationPreference
      delete generationGuardData.metadata.convaxGenerationRun
      if (Object.keys(generationGuardData.metadata).length === 0) delete generationGuardData.metadata
    }
    const generationGuard = { data: generationGuardData, type: persistedGenerationOwner.type }
    const startedGeneration = await window.convax.canvas.documents.execute({
      command: {
        nodeId: generationOwner.id,
        operationId: "operation-built-smoke",
        prompt: "Persist this prompt through a Canvas race",
        toolId: "smoke-tools/text.generate",
        type: "generation.run.start",
      },
      commandId: "smoke-generation-start",
      expectedRevision: persistedGenerationSnapshot.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const concurrentNode = {
      data: {
        kind: "text",
        label: "Concurrent edit",
        metadata: {
          convaxProjectResource: { kind: "project-file", path: "Notes/generation-smoke.md" },
        },
        resourceState: { status: "ready", text: "Unrelated" },
      },
      id: "generation-race-unrelated",
      position: { x: -360, y: 0 },
      type: "file",
    }
    const concurrentRevision = startedGeneration.document.revision
    const [markRunningAttempt, unrelatedEditAttempt] = await Promise.allSettled([
      window.convax.canvas.documents.execute({
        command: {
          nodeId: generationOwner.id,
          operationId: "operation-built-smoke",
          taskId: "task_built_smoke_123",
          type: "generation.run.mark-running",
        },
        commandId: "smoke-generation-running",
        expectedRevision: concurrentRevision,
        ref: { canvasId: selectedCanvasId, scopeId: projectId },
      }),
      window.convax.canvas.documents.execute({
        command: {
          addedEdges: [],
          addedNodes: [concurrentNode],
          removedEdgeIds: [],
          removedNodeIds: [],
          type: "document.patch",
          updatedEdges: [],
          updatedNodes: [],
        },
        commandId: "smoke-generation-unrelated-edit",
        expectedRevision: concurrentRevision,
        ref: { canvasId: selectedCanvasId, scopeId: projectId },
      }),
    ])
    if (markRunningAttempt.status === unrelatedEditAttempt.status) {
      throw new Error("Canvas CAS did not admit exactly one concurrent generation mutation")
    }
    let racedDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    if (!racedDocument.document) throw new Error("Canvas disappeared during generation race")
    if (markRunningAttempt.status === "rejected") {
      await window.convax.canvas.documents.execute({
        command: {
          nodeId: generationOwner.id,
          operationId: "operation-built-smoke",
          taskId: "task_built_smoke_123",
          type: "generation.run.mark-running",
        },
        commandId: "smoke-generation-running-retry",
        expectedRevision: racedDocument.document.revision,
        ref: { canvasId: selectedCanvasId, scopeId: projectId },
      })
    } else {
      await window.convax.canvas.documents.execute({
        command: {
          addedEdges: [],
          addedNodes: [concurrentNode],
          removedEdgeIds: [],
          removedNodeIds: [],
          type: "document.patch",
          updatedEdges: [],
          updatedNodes: [],
        },
        commandId: "smoke-generation-unrelated-edit-retry",
        expectedRevision: racedDocument.document.revision,
        ref: { canvasId: selectedCanvasId, scopeId: projectId },
      })
    }
    racedDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const runningOwner = racedDocument.document?.nodes.find((node) => node.id === generationOwner.id)
    const runningState = runningOwner?.data.metadata?.convaxGenerationRun
    if (
      runningState?.status !== "running"
      || runningState.taskId !== "task_built_smoke_123"
      || !racedDocument.document?.nodes.some((node) => node.id === concurrentNode.id)
    ) {
      throw new Error("Canvas generation race lost the run receipt or unrelated edit")
    }
    const replacedGeneration = await window.convax.canvas.documents.execute({
      command: {
        expectedTarget: generationGuard,
        item: {
          id: "generation-race-result",
          kind: "text",
          metadata: {
            convaxProjectResource: {
              kind: "project-file",
              path: "Generated/generation-race-result.md",
            },
          },
          state: { status: "ready", text: "Generated after the race" },
        },
        operationId: "operation-built-smoke",
        targetNodeId: generationOwner.id,
        type: "resources.replace-generated",
      },
      commandId: "smoke-generation-replace",
      expectedRevision: racedDocument.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const succeededOwner = replacedGeneration.document.nodes.find((node) => node.id === generationOwner.id)
    const succeededRun = succeededOwner?.data.metadata?.convaxGenerationRun
    if (
      succeededRun?.status !== "succeeded"
      || succeededRun.prompt !== "Persist this prompt through a Canvas race"
      || succeededRun.toolId !== "smoke-tools/text.generate"
      || succeededRun.taskId !== "task_built_smoke_123"
    ) {
      throw new Error("Generated replacement did not atomically preserve and succeed the persisted run")
    }

    const lateOwner = {
      ...generationOwner,
      id: "generation-late-owner",
      position: { x: -720, y: 280 },
    }
    const addedLateOwner = await window.convax.canvas.documents.execute({
      command: {
        addedEdges: [],
        addedNodes: [lateOwner],
        removedEdgeIds: [],
        removedNodeIds: [],
        type: "document.patch",
        updatedEdges: [],
        updatedNodes: [],
      },
      commandId: "smoke-generation-late-owner-add",
      expectedRevision: replacedGeneration.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const persistedLateSnapshot = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const persistedLateOwner = persistedLateSnapshot.document?.nodes.find((node) => node.id === lateOwner.id)
    if (!persistedLateOwner) throw new Error("Late-callback owner was not persisted")
    const lateGuardData = structuredClone(persistedLateOwner.data)
    delete lateGuardData.resourceState
    if (lateGuardData.metadata && Object.keys(lateGuardData.metadata).length === 0) delete lateGuardData.metadata
    const lateGuard = { data: lateGuardData, type: persistedLateOwner.type }
    const startedLateRun = await window.convax.canvas.documents.execute({
      command: {
        nodeId: lateOwner.id,
        operationId: "operation-late-smoke",
        prompt: "Must not revive a deleted node",
        toolId: "smoke-tools/text.generate",
        type: "generation.run.start",
      },
      commandId: "smoke-generation-late-start",
      expectedRevision: persistedLateSnapshot.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const deletedLateOwner = await window.convax.canvas.documents.execute({
      command: { nodeIds: [lateOwner.id], type: "elements.remove" },
      commandId: "smoke-generation-late-delete",
      expectedRevision: startedLateRun.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const lateReplacement = await window.convax.canvas.documents.execute({
      command: {
        expectedTarget: lateGuard,
        item: {
          id: "generation-late-result",
          kind: "text",
          metadata: {
            convaxProjectResource: {
              kind: "project-file",
              path: "Generated/generation-late-result.md",
            },
          },
          state: { status: "ready", text: "Must not land" },
        },
        operationId: "operation-late-smoke",
        targetNodeId: lateOwner.id,
        type: "resources.replace-generated",
      },
      commandId: "smoke-generation-late-replace",
      expectedRevision: deletedLateOwner.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    }).then(
      () => ({ rejected: false }),
      () => ({ rejected: true }),
    )
    if (!lateReplacement.rejected) throw new Error("A late generation callback revived a deleted Canvas node")
    const beforeRestartFallback = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const restartFallbackOwner = {
      ...generationOwner,
      id: "generation-restart-fallback-owner",
      position: { x: -360, y: 280 },
    }
    const addedRestartFallback = await window.convax.canvas.documents.execute({
      command: {
        addedEdges: [],
        addedNodes: [restartFallbackOwner],
        removedEdgeIds: [],
        removedNodeIds: [],
        type: "document.patch",
        updatedEdges: [],
        updatedNodes: [],
      },
      commandId: "smoke-generation-restart-fallback-add",
      expectedRevision: beforeRestartFallback.document?.revision ?? 0,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const startedRestartFallback = await window.convax.canvas.documents.execute({
      command: {
        nodeId: restartFallbackOwner.id,
        operationId: "operation-restart-fallback-smoke",
        prompt: "Do not repeat an unbound external call",
        toolId: "legacy-smoke-tools/text.generate",
        type: "generation.run.start",
      },
      commandId: "smoke-generation-restart-fallback-start",
      expectedRevision: addedRestartFallback.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    await window.convax.canvas.documents.execute({
      command: {
        nodeId: restartFallbackOwner.id,
        operationId: "operation-restart-fallback-smoke",
        taskId: "task_restart_fallback_123",
        type: "generation.run.mark-running",
      },
      commandId: "smoke-generation-restart-fallback-running",
      expectedRevision: startedRestartFallback.document.revision,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const reconciledFallback = await window.convax.generation.reconcileCanvas({
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const fallbackDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const fallbackRun = fallbackDocument.document?.nodes.find(
      (node) => node.id === restartFallbackOwner.id,
    )?.data.metadata?.convaxGenerationRun
    if (
      !reconciledFallback.interruptedNodeIds.includes(restartFallbackOwner.id)
      || fallbackRun?.status !== "interrupted"
      || fallbackRun.retrySafety !== "unknown"
    ) {
      throw new Error("Restart reconciliation did not fail closed for an active run without an admitted LRO")
    }
      sessionStorage.setItem("convax.smoke.generation-race.v1", JSON.stringify({
        concurrentConflict: true,
        lateCallbackRejected: lateReplacement.rejected,
        restartFallbackInterrupted: fallbackRun.status === "interrupted",
        status: succeededRun.status,
      }))
      // Direct document commands intentionally do not turn the Renderer into a
      // second operation registry. Reload the real application to prove that
      // the persisted terminal state survives unmount/remount, then continue
      // the pre-existing UI smoke from a fresh authoritative projection.
      location.reload()
      await new Promise(() => {})
    }

    const settingsAction = await waitFor(
      () => document.querySelector('button[aria-label="Open Settings"], button[aria-label="打开设置"]'),
      "the application-titlebar Settings action",
    )
    settingsAction.click()
    const settingsView = await waitFor(
      () => document.querySelector('[data-settings-view="true"]'),
      "the global Settings view",
    )
    const languageSelect = await waitFor(
      () => settingsView.querySelector("#settings-language"),
      "the application language setting",
    )
    languageSelect.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }))
    await waitFor(
      () => document.querySelector('[data-slot="select-content"]'),
      "the application language options",
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const languageSelectFocusTarget = document.activeElement ?? languageSelect
    languageSelectFocusTarget.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }))
    await waitFor(
      () => !document.querySelector('[data-slot="select-content"]'),
      "Escape to close only the application language options",
    )
    if (!document.querySelector('[data-settings-view="true"]')) {
      throw new Error("Escape closed Settings together with the language options")
    }
    languageSelect.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }))
    const chineseLanguageOption = await waitFor(
      () => [...document.querySelectorAll('[role="option"]')]
        .find((option) => option.textContent?.trim() === "简体中文"),
      "the Simplified Chinese language option",
    )
    chineseLanguageOption.click()
    await waitFor(
      () => document.documentElement.lang === "zh-CN" && buttonWithText("技能与插件"),
      "the live Chinese Settings interface",
    )
    buttonWithText("技能与插件").click()
    await waitFor(
      () => document.querySelector('section[aria-label="技能与插件"] [role="tablist"]'),
      "Skill and Plugin management inside Settings",
    )
    const installedSkillCard = await waitFor(
      () => [...document.querySelectorAll("article")]
        .find((article) => article.textContent?.includes("Storyboard Builder")
          && article.textContent?.includes("由 Convax 管理")),
      "the installed Storyboard Skill card",
    )
    const installedSkillVideo = await waitFor(
      () => {
        const video = installedSkillCard.querySelector("video")
        return video && video.readyState >= 2 ? video : null
      },
      "the installed Skill showcase video",
    )
    await waitFor(() => !installedSkillVideo.paused && installedSkillVideo.currentTime > 0, "the in-view Skill video to play")
    const installedSkillDetails = await waitFor(
      () => [...installedSkillCard.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "查看详情"),
      "the installed Skill detail action",
    )
    installedSkillDetails.click()
    const skillDetailDialog = await waitFor(
      () => [...document.querySelectorAll('[role="dialog"]')]
        .find((dialog) => dialog.textContent?.includes("Storyboard Builder")
          && dialog.textContent?.includes("SKILL.md")),
      "the installed Skill detail dialog",
    )
    const detailLayer = skillDetailDialog.parentElement
    if (!detailLayer || Number.parseInt(getComputedStyle(detailLayer).zIndex, 10) <= 100) {
      throw new Error("The Skill detail dialog did not render above Settings")
    }
    const closeSkillDetails = await waitFor(
      () => skillDetailDialog.querySelector('button[aria-label="关闭技能详情"]'),
      "the installed Skill detail close action",
    )
    closeSkillDetails.click()
    await waitFor(() => !document.body.contains(skillDetailDialog), "the installed Skill detail dialog to close")
    if (!document.querySelector('[data-settings-view="true"]')) {
      throw new Error("Closing Skill details also closed Settings")
    }
    const pluginTab = await waitFor(
      () => [...document.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.textContent?.trim() === "插件"),
      "the Plugin management tab",
    )
    pluginTab.click()
    const storedLanguage = JSON.parse(localStorage.getItem("convax.desktop.app-language.v1") ?? "null")
    if (storedLanguage?.language !== "zh-CN") throw new Error("The global language preference was not persisted")
    const backToApp = await waitFor(() => buttonWithText("返回应用"), "the Settings return action")
    backToApp.click()
    await waitFor(() => !document.querySelector('[data-settings-view="true"]'), "Settings to close")

    const savedDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    if (!savedDocument.document) throw new Error("The active Canvas document did not load")
    return {
      activeCanvasId: selectedCanvasId,
      canvasCount: catalog.canvases.length,
      documentId: savedDocument.document.id,
      language: document.documentElement.lang,
      projectId,
      generationRace: persistedGenerationRace,
    }
  })()`,
  )

  const summary = result as {
    activeCanvasId?: string
    canvasCount?: number
    documentId?: string
    language?: string
    projectId?: string
    generationRace?: {
      concurrentConflict?: boolean
      lateCallbackRejected?: boolean
      restartFallbackInterrupted?: boolean
      status?: string
    }
  }
  if (
    summary.activeCanvasId !== "canvas-main" ||
    summary.canvasCount !== 1 ||
    summary.documentId !== "canvas-main" ||
    summary.language !== "zh-CN" ||
    summary.generationRace?.concurrentConflict !== true ||
    summary.generationRace.lateCallbackRejected !== true ||
    summary.generationRace.restartFallbackInterrupted !== true ||
    summary.generationRace.status !== "succeeded"
  ) {
    throw new Error(`Unexpected Open Project result: ${JSON.stringify(summary)}`)
  }

  await evaluateStable(
    rendererDebugger,
    `(async () => {
      const deadline = Date.now() + ${timeoutMs}
      let composer
      let requestedAgent = false
      while (Date.now() < deadline) {
        composer = [...document.querySelectorAll('[contenteditable="true"][aria-label="Message the project agent"]')]
          .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null)
        if (composer) break
        if (!requestedAgent) {
          const openAgent = document.querySelector(
            'button[aria-label^="Open agent"], button[aria-label^="打开 Agent"]',
          )
          if (openAgent) {
            openAgent.click()
            requestedAgent = true
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (!composer) {
        const openAgent = document.querySelector(
          'button[aria-label^="Open agent"], button[aria-label^="打开 Agent"]',
        )
        const disabledComposer = document.querySelector('[aria-label="Message the project agent"]')
        const alerts = [...document.querySelectorAll('[role="alert"]')]
          .map((alert) => alert.textContent?.trim())
          .filter(Boolean)
        throw new Error("The Agent composer is missing: " + JSON.stringify({
          agentStatus: await window.convax.agent.getStatus().catch((cause) => ({ error: String(cause) })),
          alerts,
          bodyText: document.body.innerText.slice(-2_000),
          composerContentEditable: disabledComposer?.getAttribute("contenteditable"),
          openAgentVisible: openAgent instanceof HTMLElement && openAgent.offsetParent !== null,
        }))
      }
      composer.replaceChildren()
      composer.focus()
      const range = document.createRange()
      range.selectNodeContents(composer)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      window.__convaxSmokeComposerInputTrusted = undefined
      composer.addEventListener("input", (event) => {
        window.__convaxSmokeComposerInputTrusted = event.isTrusted
      }, { once: true })
    })()`,
  )
  await sendDebuggerCommand(rendererDebugger, "Input.insertText", { text: "@" })
  const composerPickerGeometry = (await evaluateStable(
    rendererDebugger,
    `(async () => {
      const deadline = Date.now() + ${timeoutMs}
      let picker
      while (Date.now() < deadline) {
        picker = document.querySelector('[data-agent-composer-picker="true"]')
        if (picker) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const composer = [...document.querySelectorAll('[contenteditable="true"][aria-label="Message the project agent"]')]
        .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null)
      if (!composer || !picker) throw new Error("Real @ input did not open the Agent composer picker")
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const composerBounds = composer.getBoundingClientRect()
      const pickerBounds = picker.getBoundingClientRect()
      const pickerStyle = getComputedStyle(picker)
      const offsetParentBounds = picker.offsetParent?.getBoundingClientRect()
      return {
        composerBottom: composerBounds.bottom,
        composerText: composer.textContent,
        composerTop: composerBounds.top,
        gap: composerBounds.top - pickerBounds.bottom,
        pickerBottom: pickerBounds.bottom,
        pickerComputedTop: pickerStyle.top,
        pickerHeight: pickerBounds.height,
        pickerOffsetParent: offsetParentBounds
          ? { left: offsetParentBounds.left, top: offsetParentBounds.top }
          : null,
        pickerTop: pickerBounds.top,
        pickerTransform: pickerStyle.transform,
        trusted: window.__convaxSmokeComposerInputTrusted,
      }
    })()`,
  )) as {
    composerBottom?: number
    composerText?: string | null
    composerTop?: number
    gap?: number
    pickerBottom?: number
    pickerComputedTop?: string
    pickerHeight?: number
    pickerOffsetParent?: { left: number; top: number } | null
    pickerTop?: number
    pickerTransform?: string
    trusted?: boolean
  }
  if (
    composerPickerGeometry.composerText !== "@" ||
    composerPickerGeometry.trusted !== true ||
    !Number.isFinite(composerPickerGeometry.gap) ||
    composerPickerGeometry.gap! < 6 ||
    composerPickerGeometry.gap! > 10
  ) {
    throw new Error(
      `Real Agent composer input produced invalid picker geometry: ${JSON.stringify(composerPickerGeometry)}`,
    )
  }
  const composerPickerTabPoint = (await evaluateStable(
    rendererDebugger,
    `(() => {
      const picker = document.querySelector('[data-agent-composer-picker="true"]')
      const tab = picker && [...picker.querySelectorAll('[role="tab"]')]
        .find((candidate) => candidate.textContent?.trim() === "Canvas")
      if (!tab) throw new Error("The Agent composer Canvas tab is missing")
      const bounds = tab.getBoundingClientRect()
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
    })()`,
  )) as { x: number; y: number }
  await sendDebuggerCommand(rendererDebugger, "Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    x: composerPickerTabPoint.x,
    y: composerPickerTabPoint.y,
  })
  await sendDebuggerCommand(rendererDebugger, "Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: composerPickerTabPoint.x,
    y: composerPickerTabPoint.y,
  })
  const composerPickerInteraction = (await evaluateStable(
    rendererDebugger,
    `(() => {
      const picker = document.querySelector('[data-agent-composer-picker="true"]')
      const tab = picker && [...picker.querySelectorAll('[role="tab"]')]
        .find((candidate) => candidate.textContent?.trim() === "Canvas")
      return { open: Boolean(picker), selected: tab?.getAttribute("aria-selected") === "true" }
    })()`,
  )) as { open?: boolean; selected?: boolean }
  if (!composerPickerInteraction.open || !composerPickerInteraction.selected) {
    throw new Error(
      `The portaled Agent composer picker dismissed its own interaction: ${JSON.stringify(composerPickerInteraction)}`,
    )
  }
  await evaluateStable(
    rendererDebugger,
    `(() => {
      const composer = document.querySelector('[contenteditable="true"][aria-label="Message the project agent"]')
      if (!composer) return
      composer.replaceChildren()
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))
      delete window.__convaxSmokeComposerInputTrusted
    })()`,
  )

  console.log(
    `Desktop Settings, Canvas generation CAS/late-callback/restart races, installed Skill showcase/detail, and Open Project smoke passed (${summary.projectId}, canvas-main)`,
  )
} catch (error) {
  child.kill("SIGKILL")
  const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr])
  if (capturedStdout.trim()) console.error(capturedStdout.trim())
  if (capturedStderr.trim()) console.error(capturedStderr.trim())
  throw error
} finally {
  child.kill("SIGKILL")
  await child.exited
  await fs.rm(temporaryRoot, { force: true, recursive: true })
}
