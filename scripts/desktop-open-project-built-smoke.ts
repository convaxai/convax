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
const openAgentPanelSelector =
  '[data-workspace-utility-drawer][data-workspace-utility-state="open"] [data-agent-panel-hosted="true"]'
// The primary renderer evaluation intentionally covers several independent
// CAS/recovery/UI paths. Its outer debugger deadline must not expire before
// the final exact-state wait can report its own bounded failure.
const evaluationTimeoutMs = timeoutMs * 4 + 30_000
const latencyMode = process.env.CONVAX_DESKTOP_SMOKE_LATENCY === "1"
const latencyIterations = Number(process.env.CONVAX_DESKTOP_SMOKE_LATENCY_ITERATIONS ?? "100")
const latencyLimitMs = 500
const latencyRecordOnly = process.env.CONVAX_DESKTOP_SMOKE_LATENCY_RECORD_ONLY === "1"
const latencyQuickCreateOnly = process.env.CONVAX_DESKTOP_SMOKE_LATENCY_QUICK_CREATE_ONLY === "1"
const latencyUndoOnly = process.env.CONVAX_DESKTOP_SMOKE_LATENCY_UNDO_ONLY === "1"
const forwardLatencyDiagnostics = process.env.CONVAX_DESKTOP_SMOKE_FORWARD_LATENCY_DIAGNOSTICS === "1"

const require = createRequire(path.join(desktopRoot, "package.json"))
const electronPackageRoot = path.dirname(require.resolve("electron/package.json"))

async function resolveDesktopMainEntry() {
  const manifestPath = path.join(desktopRoot, "package.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { main?: unknown }
  if (typeof manifest.main !== "string" || !manifest.main.trim()) {
    throw new Error("Desktop package.json must declare a non-empty main entry")
  }
  const mainRoot = path.join(desktopRoot, "out", "main")
  const mainEntry = path.resolve(desktopRoot, manifest.main)
  const relativeEntry = path.relative(mainRoot, mainEntry)
  if (!relativeEntry || relativeEntry.startsWith(`..${path.sep}`) || path.isAbsolute(relativeEntry)) {
    throw new Error("Desktop package.json main must resolve below out/main")
  }
  return mainEntry
}

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

async function evaluate(webSocketUrl: string, expression: string, requestTimeoutMs = evaluationTimeoutMs) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error("Timed out waiting for debugger evaluation"))
    }, requestTimeoutMs)

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

async function waitForRendererReload(webSocketUrl: string, previousTimeOrigin: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const currentTimeOrigin = await evaluate(webSocketUrl, "performance.timeOrigin", 2_000)
      if (typeof currentTimeOrigin === "number" && currentTimeOrigin !== previousTimeOrigin) return
    } catch (error) {
      if (
        !isTransientDebuggerEvaluationError(error) &&
        !String(error).includes("Timed out waiting for debugger evaluation")
      ) {
        throw error
      }
    }
    await Bun.sleep(100)
  }
  throw new Error("Timed out waiting for the Renderer reload")
}

async function collectOutput(stream: ReadableStream<Uint8Array>) {
  let output = ""
  for await (const chunk of stream) output += new TextDecoder().decode(chunk)
  return output
}

const electronBinary = await resolveElectronBinary()
await fs.access(await resolveDesktopMainEntry()).catch(() => {
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
  fs.writeFile(
    path.join(projectRoot, "shortcut-smoke.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  ),
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
// The built smoke owns disposable userData and must not depend on or mutate the
// developer/runner login Keychain. The packaged smoke uses the same isolation.
const child = Bun.spawn(
  [
    electronBinary,
    ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
    `--inspect=${inspectorPort}`,
    `--remote-debugging-port=${rendererPort}`,
    desktopRoot,
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CONVAX_ALLOW_MULTIPLE_INSTANCES: "1",
      ...(latencyMode && forwardLatencyDiagnostics
        ? {
            CONVAX_CANVAS_RESOURCE_LATENCY_RECORD_ALL: "1",
            CONVAX_COLLABORATION_LATENCY_RECORD_ALL: "1",
          }
        : {}),
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
    electron.ipcMain.removeHandler("generation:list-tools")
    electron.ipcMain.handle("generation:list-tools", () => [{
      acceptedInputs: ["text"],
      description: "Built-smoke available image model",
      id: "smoke-tools/generate.image",
      kind: "model",
      modelName: "Smoke Image",
      output: "image",
      pluginId: "smoke-tools",
      pluginName: "Smoke Service",
      title: "Smoke Image",
      toolId: "generate.image",
    }])
    electron.ipcMain.removeHandler("generation:describe-tool")
    electron.ipcMain.handle("generation:describe-tool", (_event, input) => ({
      fields: [],
      toolId: input?.toolId,
    }))
    // This smoke verifies the built renderer's real composer input, picker
    // geometry, and Canvas/Plugin flows. Keep those assertions independent from
    // the machine's OpenCode session database and startup latency.
    electron.ipcMain.removeHandler("agent:session-list")
    electron.ipcMain.handle("agent:session-list", () => [])
    // A fresh userData directory now enters the product Onboarding before
    // Project Home. Keep this smoke independent from a real account or browser
    // session while exercising the same generic Service projection and the
    // explicit "continue with Free" route that production uses.
    let onboardingAuthorized = false
    const onboardingStatus = () => onboardingAuthorized
      ? {
          account: { availability: "available", displayName: "Smoke User" },
          billing: {
            availability: "available",
            checkout: {
              availability: "available",
              plans: [{ billingInterval: "month", key: "pro", name: "Pro" }],
            },
          },
          credential: { configured: true, verification: "verified" },
          credits: { availability: "available", remaining: 40, unit: "credits" },
          plan: { availability: "available", key: "free", name: "Free" },
          schema: "convax.plugin-service-status/2",
          state: "connected",
          usage: { availability: "available", consumed: 0, unit: "credits" },
        }
      : {
          account: { availability: "unavailable" },
          billing: { availability: "unavailable" },
          credential: { configured: false, verification: "unverified" },
          credits: { availability: "unavailable" },
          plan: { availability: "unavailable" },
          schema: "convax.plugin-service-status/2",
          state: "disconnected",
          usage: { availability: "unavailable" },
        }
    electron.ipcMain.removeHandler("plugin-service:list")
    electron.ipcMain.handle("plugin-service:list", () => [{
      actions: ["authorize", "authorization.cancel", "checkout", "sign_out"],
      capabilities: ["text"],
      description: "Built-smoke product account service",
      llmProviderIds: [],
      models: [],
      pluginId: "smoke-account",
      pluginName: "Smoke Account",
      serviceId: "account",
      version: "1.0.0",
    }])
    electron.ipcMain.removeHandler("plugin-service:status")
    electron.ipcMain.handle("plugin-service:status", () => onboardingStatus())
    electron.ipcMain.removeHandler("plugin-service:usage-history")
    electron.ipcMain.handle("plugin-service:usage-history", () => ({
      availability: "unavailable",
      schema: "convax.plugin-service-usage/1",
    }))
    electron.ipcMain.removeHandler("plugin-service:authorize")
    electron.ipcMain.handle("plugin-service:authorize", () => {
      onboardingAuthorized = true
      return onboardingStatus()
    })
    electron.BrowserWindow.getAllWindows()
      .find((window) => !window.isDestroyed())
      ?.webContents.send("plugin-service:changed")
    return true
  })()`,
  )
  let result: unknown
  while (result === undefined) {
    const evaluationResult = await evaluateStable(
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
    let initialSurface = await waitFor(
      () => document.querySelector('[data-convax-onboarding="true"]')
        || document.querySelector('[data-project-home="true"]')
        || document.querySelector(".convax-canvas"),
      "Onboarding, Project Home, or the restored Canvas",
    )
    if (initialSurface.matches('[data-convax-onboarding="true"]')) {
      if (initialSurface.getAttribute("data-convax-onboarding-step") !== "1") {
        throw new Error("Fresh Desktop state did not start at the Account Onboarding step")
      }
      const signIn = await waitFor(
        () => buttonWithAnyText("Sign in", "登录"),
        "the Onboarding account action",
      )
      signIn.click()
      await waitFor(
        () => document.querySelector('[data-convax-onboarding-step="2"]'),
        "the Onboarding Plan step",
      )
      const continueFree = await waitFor(
        () => buttonWithAnyText("Continue with Free plan", "继续使用 Free plan"),
        "the Onboarding Free-plan action",
      )
      continueFree.click()
      initialSurface = await waitFor(
        () => document.querySelector('[data-project-home="true"]'),
        "Project Home after continuing with Free",
      )
    }
    const projectAlreadyOpen = initialSurface instanceof Element
      && initialSurface.classList.contains("convax-canvas")
    if (!projectAlreadyOpen && (buttonWithText("Skill & Plugin") || buttonWithText("技能与插件"))) {
      throw new Error("The empty Project surface exposed global capabilities")
    }
    if (!projectAlreadyOpen) {
      const enterProject = await waitFor(
        () =>
          buttonWithAnyText(
            "Continue",
            "继续",
            "Open project",
            "打开项目",
            "Open existing project",
            "打开已有项目",
          ),
        "the Project Home enter action",
      )
      enterProject.click()
    }
    const projectSurface = await waitFor(
      () => document.querySelector(".convax-canvas")
        || document.querySelector('[data-project-local-authority-recovery="true"]')
        || document.querySelector('[data-project-collaboration-pending="true"]')
        || document.querySelector('[data-project-recovery="true"]')
        || document.querySelector('[data-project-home="true"] [role="alert"]'),
      "the local Project authority state or active Canvas",
    ).catch(async (error) => {
      const projects = await window.convax.projects.listProjects().catch((cause) => ({ error: String(cause) }))
      const projectId = "projects" in projects
        ? projects.projects.find((candidate) => candidate.name === "empty-project")?.id
        : undefined
      const catalogProbe = projectId
        ? await Promise.race([
            window.convax.projects.canvases.getCanvasCatalog({ projectId }).then(
              (value) => ({ status: "resolved", value }),
              (cause) => ({ error: String(cause), status: "rejected" }),
            ),
            new Promise((resolve) => setTimeout(() => resolve({ status: "timed-out" }), 2_000)),
          ])
        : { status: "no-project" }
      throw new Error(String(error) + "; Project open state: " + JSON.stringify({
        body: document.body.textContent?.trim().slice(0, 1_500),
        catalogProbe,
        collaborationPending: Boolean(document.querySelector('[data-project-collaboration-pending="true"]')),
        localAuthorityRecovery: Boolean(document.querySelector('[data-project-local-authority-recovery="true"]')),
        projectLoading: Boolean(document.querySelector('[data-project-loading="true"]')),
        projects,
        resetRecovery: Boolean(document.querySelector('[data-project-reset-recovery="true"]')),
      }))
    })
    if (projectSurface.matches('[data-project-recovery="true"]')) {
      throw new Error("Project open entered recovery: " + projectSurface.textContent?.trim())
    }
    if (projectSurface.matches('[role="alert"]')) {
      throw new Error("Project open failed before Canvas activation: " + projectSurface.textContent?.trim())
    }
    if (projectSurface.matches('[data-project-collaboration-pending="true"]')) {
      throw new Error("Opening a personal Project started the Team collaboration flow")
    }
    if (projectSurface.matches('[data-project-local-authority-recovery="true"]')) {
      const projects = await window.convax.projects.listProjects()
      const project = projects.projects.find((candidate) => candidate.name === "empty-project")
      if (!project) throw new Error("Open Project did not return a personal Project")
      const catalog = await window.convax.projects.canvases.getCanvasCatalog({ projectId: project.id })
      if (catalog.creationAvailability !== "local-authority-unavailable") {
        throw new Error("Personal Project recovery did not report the exact local authority state")
      }
      if (catalog.canvases.length !== 0) {
        throw new Error("Unavailable local authority fabricated a default Canvas")
      }
      const recoveryTitle = projectSurface
        .querySelector("#project-local-authority-recovery-title")
        ?.textContent?.trim()
      if (!recoveryTitle) throw new Error("Personal Project recovery did not explain the unavailable authority")
      return {
        canvasCount: catalog.canvases.length,
        collaborationPending: Boolean(document.querySelector('[data-project-collaboration-pending="true"]')),
        creationAvailability: catalog.creationAvailability,
        localAuthorityRecovery: true,
        projectId: project.id,
        recoveryTitle,
        startupMode: "local-authority-unavailable",
      }
    }
    await waitFor(
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
          + JSON.stringify({
            alert,
            body: document.body.textContent?.trim().slice(0, 1000),
            buttons,
            collaborationPending: Boolean(document.querySelector('[data-project-collaboration-pending="true"]')),
            localAuthorityRecovery: Boolean(document.querySelector('[data-project-local-authority-recovery="true"]')),
            projectLoading: Boolean(document.querySelector('[data-project-loading="true"]')),
            resetRecovery: Boolean(document.querySelector('[data-project-reset-recovery="true"]')),
            text: home?.textContent?.trim().slice(0, 500),
          }),
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
    if (!initialDocument.projection) throw new Error("The default Canvas projection did not load")
    if (${latencyMode}) {
      const iterations = ${latencyIterations}
      const limitMs = ${latencyLimitMs}
      const ref = { canvasId: selectedCanvasId, scopeId: projectId }
      const surface = document.querySelector(".convax-canvas")
      if (!surface) throw new Error("Latency mode requires the mounted Canvas session UI")
      const probeSession = await window.convax.canvas.sessions.open(ref)
      const pendingProbeInvalidations = []
      const unsubscribeProbe = window.convax.canvas.sessions.subscribe((event) => {
        if (
          event.sessionId === probeSession.sessionId
          && event.ref.canvasId === ref.canvasId
          && event.ref.scopeId === ref.scopeId
        ) {
          pendingProbeInvalidations.push({ event, observedAt: performance.now() })
        }
      })
      const percentile = (values, quantile) => {
        const sorted = [...values].sort((left, right) => left - right)
        return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
      }
      const summarizeOperations = (operationNames) => Object.fromEntries(operationNames.map((operation) => {
        const rows = samples.filter((sample) => sample.operation === operation)
        const metrics = Object.fromEntries(["rendererFirstFeedbackMs", "mainCommitMs", "authoritativeReconcileMs", "totalMs"].map(
          (metric) => [metric, { p50: percentile(rows.map((row) => row[metric]), 0.50), p95: percentile(rows.map((row) => row[metric]), 0.95), p99: percentile(rows.map((row) => row[metric]), 0.99) }],
        ))
        return [operation, { count: rows.length, metrics }]
      }))
      const documentState = async () => {
        const projection = await window.convax.canvas.sessions.query({
          ref,
          sessionId: probeSession.sessionId,
        })
        return projection.document
      }
      const waitUntil = async (read, label, timeout = limitMs) => {
        const deadline = performance.now() + timeout
        while (performance.now() <= deadline) {
          const value = await read()
          if (value) return value
          await new Promise((resolve) => requestAnimationFrame(resolve))
        }
        throw new Error("Latency mode exceeded 500ms waiting for " + label)
      }
      const samples = []
      const run = async (operation, expected, invoke) => {
        const before = await documentState()
        const visualBefore = new Set([...surface.querySelectorAll("[data-id]")]
          .map((element) => element.getAttribute("data-id"))
          .filter(Boolean))
        pendingProbeInvalidations.length = 0
        let feedbackAt
        const startedAt = performance.now()
        const observer = new MutationObserver(() => {
          if (feedbackAt === undefined && expected.rendererFeedback(before, document, visualBefore)) feedbackAt = performance.now()
        })
        observer.observe(surface, { attributes: true, childList: true, subtree: true })
        invoke()
        if (expected.rendererFeedback(before, document, visualBefore)) feedbackAt = performance.now()
        let committed
        try {
          const observed = await waitUntil(
            () => pendingProbeInvalidations.shift(),
            operation + " Main commit",
            Math.max(limitMs * 10, 5_000),
          )
          const commitAt = observed.observedAt
          await waitUntil(() => expected.reconciled(before, document), operation + " authoritative reconcile")
          const reconciledAt = performance.now()
          committed = await documentState()
          if (!expected.authoritative(before, committed)) {
            throw new Error(operation + " frame invalidation did not expose the expected authoritative state")
          }
          if (feedbackAt === undefined || (feedbackAt >= commitAt && feedbackAt - startedAt > 50)) {
            throw new Error(operation + " Renderer first-feedback unavailable before a non-immediate Main commit")
          }
          const sample = {
            operation,
            rendererFirstFeedbackMs: feedbackAt - startedAt,
            mainCommitMs: commitAt - startedAt,
            authoritativeReconcileMs: reconciledAt - commitAt,
            totalMs: reconciledAt - startedAt,
          }
          samples.push(sample)
          if (sample.totalMs > limitMs) {
            console.error("[convax:desktop-latency-slow] " + JSON.stringify(sample))
            if (!${latencyRecordOnly}) throw new Error(operation + " exceeded 500ms: " + JSON.stringify(sample))
          }
          return { before, committed }
        } catch (error) {
          const elapsedMs = performance.now() - startedAt
          const failureDocument = await documentState().catch(() => null)
          const failureState = {
            operation,
            authoritativeNodeIds: failureDocument?.nodes.map((node) => node.id) ?? null,
            renderedNodeIds: nodeElements().map((node) => node.getAttribute("data-id")),
            ghostCount: ghostElements(),
          }
          console.error("[convax:desktop-latency-failure-state] " + JSON.stringify(failureState))
          if (elapsedMs > limitMs) {
            console.error("[convax:desktop-latency-slow] " + JSON.stringify({
              operation,
              rendererFirstFeedbackMs: feedbackAt === undefined ? "unavailable" : feedbackAt - startedAt,
              totalMs: elapsedMs,
              error: String(error),
            }))
          }
          throw new Error(String(error) + "; state=" + JSON.stringify(failureState))
        } finally {
          observer.disconnect()
        }
      }
      const click = (element, label) => {
        if (!(element instanceof HTMLElement)) throw new Error("Latency mode could not find " + label)
        element.click()
      }
      const nodeElements = () => [...surface.querySelectorAll(".react-flow__node[data-id]")]
        .filter((node) => !node.getAttribute("data-id")?.startsWith("ghost-"))
      const ghostElements = () => surface.querySelectorAll(
        '[data-canvas-optimistic-ghost="node"], [data-canvas-optimistic-ghost="edge"]',
      ).length
      const hasRenderedEntity = (id) => Boolean(id && surface.querySelector('[data-id="' + CSS.escape(id) + '"]'))
      const hasNewRenderedEntity = (visualBefore, kind) => [...surface.querySelectorAll("[data-id]")].some((element) => {
        const id = element.getAttribute("data-id")
        return Boolean(id && !visualBefore.has(id) && element.classList.contains("react-flow__" + kind))
      })
      const addedEntityId = (before, after, key) => {
        const existing = new Set(before[key].map((entity) => entity.id))
        return after[key].find((entity) => !existing.has(entity.id))?.id
      }
      const invokeQuickCreate = () => {
        click(surface.querySelector('button[aria-label="Add node"]'), "Add node")
        click(surface.querySelector('button[aria-label="Add Text"]'), "Add Text")
      }
      const warmBefore = await documentState()
      pendingProbeInvalidations.length = 0
      invokeQuickCreate()
      await waitUntil(
        () => pendingProbeInvalidations.shift(),
        "quick-create warm-up Main commit",
        Math.max(limitMs * 10, 5_000),
      )
      await waitUntil(() => ghostElements() === 0, "quick-create warm-up reconciliation", 5_000)
      const warmAfter = await documentState()
      if (warmAfter.nodes.length !== warmBefore.nodes.length + 1) {
        throw new Error("Latency warm-up did not commit exactly one text node")
      }
      if (${latencyUndoOnly}) {
        let historyNodeId = addedEntityId(warmBefore, warmAfter, "nodes")
        if (!historyNodeId) throw new Error("Latency undo-only mode lost the visual-history node identity")
        const invokeHistory = (key, shiftKey) => window.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true, cancelable: true, key, metaKey: true, shiftKey,
        }))
        for (let index = 0; index < 2; index += 1) {
          const targetNodeId = historyNodeId
          const undone = await run("undo", {
            rendererFeedback: () => !hasRenderedEntity(targetNodeId),
            authoritative: (before, after) => after.nodes.length === before.nodes.length - 1
              && !after.nodes.some((node) => node.id === targetNodeId),
            reconciled: () => !hasRenderedEntity(targetNodeId) && ghostElements() === 0,
          }, () => invokeHistory("z", false))
          const redone = await run("redo", {
            rendererFeedback: (_before, _document, visualBefore) => hasNewRenderedEntity(visualBefore, "node"),
            authoritative: (before, after) => after.nodes.length === before.nodes.length + 1
              && after.nodes.some((node) => node.id !== targetNodeId),
            reconciled: (before) => nodeElements().length === before.nodes.length + 1 && ghostElements() === 0,
          }, () => invokeHistory("z", true))
          historyNodeId = addedEntityId(undone.committed, redone.committed, "nodes")
          if (!historyNodeId) throw new Error("Latency undo-only mode lost the recreated visual-history identity")
        }
        const summary = summarizeOperations(["undo", "redo"])
        console.log("[convax:desktop-latency-summary] " + JSON.stringify(summary))
        unsubscribeProbe()
        await window.convax.canvas.sessions.close({ ref, sessionId: probeSession.sessionId })
        return { latencyMode: true, latencySummary: summary, projectId }
      }
      for (let index = 0; index < iterations; index += 1) {
        await run("quick-create", {
          rendererFeedback: (_before, _document, visualBefore) => ghostElements() > 0 || hasNewRenderedEntity(visualBefore, "node"),
          authoritative: (before, after) => after.nodes.length === before.nodes.length + 1,
          reconciled: () => ghostElements() === 0,
        }, invokeQuickCreate)
      }
      if (${latencyQuickCreateOnly}) {
        const summary = summarizeOperations(["quick-create"])
        console.log("[convax:desktop-latency-summary] " + JSON.stringify(summary))
        unsubscribeProbe()
        await window.convax.canvas.sessions.close({ ref, sessionId: probeSession.sessionId })
        return { latencyMode: true, latencySummary: summary, projectId }
      }
      const selectLastNode = () => {
        const node = nodeElements().at(-1)
        click(node, "the last Canvas node")
      }
      for (let index = 0; index < iterations; index += 1) {
        selectLastNode()
        await run("duplicate", {
          rendererFeedback: (_before, _document, visualBefore) => ghostElements() > 0 || hasNewRenderedEntity(visualBefore, "node"),
          authoritative: (before, after) => after.nodes.length === before.nodes.length + 1,
          reconciled: () => ghostElements() === 0,
        }, () => click(surface.querySelector('button[aria-label="Duplicate"]'), "Duplicate"))
      }
      const connectOnce = (index) => {
        const nodes = nodeElements()
        const source = nodes[index]
        const target = nodes[index + iterations]
        const sourceHandle = source?.querySelector('[data-handle-id="source-right"]')
        const targetHandle = target?.querySelector('[data-handle-id="target-left"]')
        if (!(sourceHandle instanceof HTMLElement) || !(targetHandle instanceof HTMLElement)) {
          throw new Error("Latency mode could not find public Canvas connection handles")
        }
        const sourceBounds = sourceHandle.getBoundingClientRect()
        const targetBounds = targetHandle.getBoundingClientRect()
        const pointer = (targetElement, type, bounds, buttons) => targetElement.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          buttons,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          pointerId: 1,
          pointerType: "mouse",
        }))
        pointer(sourceHandle, "pointerdown", sourceBounds, 1)
        pointer(targetHandle, "pointermove", targetBounds, 1)
        pointer(targetHandle, "pointerup", targetBounds, 0)
      }
      let historyEdgeId
      for (let index = 0; index < iterations; index += 1) {
        const connected = await run("connect", {
          rendererFeedback: (_before, _document, visualBefore) => ghostElements() > 0 || hasNewRenderedEntity(visualBefore, "edge"),
          authoritative: (before, after) => after.edges.length === before.edges.length + 1,
          reconciled: () => ghostElements() === 0,
        }, () => connectOnce(index))
        historyEdgeId = addedEntityId(connected.before, connected.committed, "edges")
      }
      const invokeHistory = (key, shiftKey) => window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true, cancelable: true, key, metaKey: true, shiftKey,
      }))
      for (let index = 0; index < iterations; index += 1) {
        const targetEdgeId = historyEdgeId
        if (!targetEdgeId) throw new Error("Latency mode lost the visual-history edge identity")
        await run("undo", {
          rendererFeedback: () => !hasRenderedEntity(targetEdgeId),
          authoritative: (before, after) => after.edges.length === before.edges.length - 1
            && !after.edges.some((edge) => edge.id === targetEdgeId),
          reconciled: () => !hasRenderedEntity(targetEdgeId) && ghostElements() === 0,
        }, () => invokeHistory("z", false))
        const redone = await run("redo", {
          rendererFeedback: (_before, _document, visualBefore) => ghostElements() > 0 || hasNewRenderedEntity(visualBefore, "edge"),
          authoritative: (before, after) => after.edges.length === before.edges.length + 1,
          reconciled: () => ghostElements() === 0,
        }, () => invokeHistory("z", true))
        historyEdgeId = addedEntityId(redone.before, redone.committed, "edges")
      }
      const summary = summarizeOperations(["duplicate", "connect", "quick-create", "undo", "redo"])
      console.log("[convax:desktop-latency-summary] " + JSON.stringify(summary))
      unsubscribeProbe()
      await window.convax.canvas.sessions.close({ ref, sessionId: probeSession.sessionId })
      return { latencyMode: true, latencySummary: summary, projectId }
    }
    const offlineBasic = JSON.parse(sessionStorage.getItem("convax.smoke.v11-offline-basic.v1") ?? "null")
    if (selectedCanvasId.startsWith("cv_")) {
      if (!offlineBasic) {
        if (initialDocument.projection.nodes.length !== 0) throw new Error("A new V11 Canvas was not empty")
        const resourceSession = await window.convax.canvas.sessions.open({
          canvasId: selectedCanvasId,
          scopeId: projectId,
        })
        const added = await window.convax.canvas.resources.add({
          anchor: { x: 40, y: 60 },
          canvasId: selectedCanvasId,
          commandId: "smoke-v11-offline-add",
          projectId,
          sessionId: resourceSession.sessionId,
          sources: [
            { kind: "new-text", name: "offline-keep", sourceId: "offline-keep", text: "Keep after restart" },
            { kind: "new-text", name: "offline-delete", sourceId: "offline-delete", text: "Delete before restart" },
          ],
        })
        const [keepNodeId, deletedNodeId] = added.createdNodeIds
        if (!keepNodeId || !deletedNodeId || added.createdNodeIds.length !== 2) {
          throw new Error("Offline resource admission did not create exactly two nodes")
        }
        await window.convax.canvas.documents.execute({
          command: {
            type: "nodes.setGeometry",
            updates: [{ nodeId: keepNodeId, position: { x: 410, y: 230 }, size: { width: 300, height: 190 } }],
          },
          commandId: "smoke-v11-offline-geometry",
          ref: { canvasId: selectedCanvasId, scopeId: projectId },
        })
        await window.convax.canvas.documents.execute({
          command: { nodeIds: [deletedNodeId], type: "elements.remove" },
          commandId: "smoke-v11-offline-delete-one",
          ref: { canvasId: selectedCanvasId, scopeId: projectId },
        })
        sessionStorage.setItem("convax.smoke.v11-offline-basic.v1", JSON.stringify({
          deletedNodeId,
          keepNodeId,
          phase: "mutated",
        }))
        return { reloadTimeOrigin: performance.timeOrigin }
      }
      if (offlineBasic.phase === "mutated") {
        const keep = initialDocument.projection.nodes.find((node) => node.id === offlineBasic.keepNodeId)
        if (
          !keep || keep.position.x !== 410 || keep.position.y !== 230
          || keep.style?.width !== 300 || keep.style?.height !== 190
          || initialDocument.projection.nodes.some((node) => node.id === offlineBasic.deletedNodeId)
        ) {
          throw new Error("Offline Canvas mutation did not survive the Renderer reload")
        }
        await window.convax.canvas.documents.execute({
          command: { nodeIds: [offlineBasic.keepNodeId], type: "elements.remove" },
          commandId: "smoke-v11-offline-delete-remaining",
          ref: { canvasId: selectedCanvasId, scopeId: projectId },
        })
        sessionStorage.setItem("convax.smoke.v11-offline-basic.v1", JSON.stringify({
          ...offlineBasic,
          phase: "deleted",
        }))
        return { reloadTimeOrigin: performance.timeOrigin }
      }
      if (offlineBasic.phase !== "deleted" || initialDocument.projection.nodes.length !== 0) {
        throw new Error("Offline Canvas deletion did not survive the second Renderer reload")
      }
      return {
        activeCanvasId: selectedCanvasId,
        canvasCount: catalog.canvases.length,
        documentId: initialDocument.projection.id,
        offlineMutation: true,
        projectId,
        startupMode: "local-offline",
      }
    }
    const persistedGenerationRace = JSON.parse(
      sessionStorage.getItem("convax.smoke.generation-race.v1") ?? "null",
    )
    if (!persistedGenerationRace && initialDocument.projection.nodes.length !== 0) throw new Error("A new Canvas was not empty")
    if (persistedGenerationRace && !persistedGenerationRace.remountVerified) {
      const remountedOwner = initialDocument.projection.nodes.find(
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
      return { reloadTimeOrigin: performance.timeOrigin }
    }
    if (persistedGenerationRace?.remountVerified && initialDocument.projection.nodes.length !== 0) {
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
    await window.convax.canvas.documents.execute({
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
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const persistedGenerationSnapshot = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const persistedGenerationOwner = persistedGenerationSnapshot.projection.nodes.find(
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
    await window.convax.canvas.documents.execute({
      command: {
        nodeId: generationOwner.id,
        operationId: "operation-built-smoke",
        prompt: "Persist this prompt through a Canvas race",
        toolId: "smoke-tools/text.generate",
        type: "generation.run.start",
      },
      commandId: "smoke-generation-start",
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
    const [markRunningAttempt, unrelatedEditAttempt] = await Promise.allSettled([
      window.convax.canvas.documents.execute({
        command: {
          nodeId: generationOwner.id,
          operationId: "operation-built-smoke",
          taskId: "task_built_smoke_123",
          type: "generation.run.mark-running",
        },
        commandId: "smoke-generation-running",
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
        ref: { canvasId: selectedCanvasId, scopeId: projectId },
      }),
    ])
    if (markRunningAttempt.status !== "fulfilled" || unrelatedEditAttempt.status !== "fulfilled") {
      throw new Error("Independent Canvas intents did not both commit through the candidate/replica boundary")
    }
    const racedDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    if (!racedDocument.projection) throw new Error("Canvas disappeared during generation race")
    const runningOwner = racedDocument.projection.nodes.find((node) => node.id === generationOwner.id)
    const runningState = runningOwner?.data.metadata?.convaxGenerationRun
    if (
      runningState?.status !== "running"
      || runningState.taskId !== "task_built_smoke_123"
      || !racedDocument.projection.nodes.some((node) => node.id === concurrentNode.id)
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
    await window.convax.canvas.documents.execute({
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
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const persistedLateSnapshot = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const persistedLateOwner = persistedLateSnapshot.projection.nodes.find((node) => node.id === lateOwner.id)
    if (!persistedLateOwner) throw new Error("Late-callback owner was not persisted")
    const lateGuardData = structuredClone(persistedLateOwner.data)
    delete lateGuardData.resourceState
    if (lateGuardData.metadata && Object.keys(lateGuardData.metadata).length === 0) delete lateGuardData.metadata
    const lateGuard = { data: lateGuardData, type: persistedLateOwner.type }
    await window.convax.canvas.documents.execute({
      command: {
        nodeId: lateOwner.id,
        operationId: "operation-late-smoke",
        prompt: "Must not revive a deleted node",
        toolId: "smoke-tools/text.generate",
        type: "generation.run.start",
      },
      commandId: "smoke-generation-late-start",
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    await window.convax.canvas.documents.execute({
      command: { nodeIds: [lateOwner.id], type: "elements.remove" },
      commandId: "smoke-generation-late-delete",
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
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    }).then(
      () => ({ rejected: false }),
      () => ({ rejected: true }),
    )
    if (!lateReplacement.rejected) throw new Error("A late generation callback revived a deleted Canvas node")
    const restartFallbackOwner = {
      ...generationOwner,
      id: "generation-restart-fallback-owner",
      position: { x: -360, y: 280 },
    }
    await window.convax.canvas.documents.execute({
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
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    await window.convax.canvas.documents.execute({
      command: {
        nodeId: restartFallbackOwner.id,
        operationId: "operation-restart-fallback-smoke",
        prompt: "Do not repeat an unbound external call",
        toolId: "legacy-smoke-tools/text.generate",
        type: "generation.run.start",
      },
      commandId: "smoke-generation-restart-fallback-start",
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
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const reconciledFallback = await window.convax.generation.reconcileCanvas({
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    const fallbackDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    const fallbackRun = fallbackDocument.projection.nodes.find(
      (node) => node.id === restartFallbackOwner.id,
    )?.data.metadata?.convaxGenerationRun
    if (
      !reconciledFallback.failedNodeIds.includes(restartFallbackOwner.id)
      || fallbackRun?.status !== "failed"
      || "retrySafety" in fallbackRun
    ) {
      throw new Error("Restart reconciliation did not fail closed for an active run without an admitted LRO")
    }
      sessionStorage.setItem("convax.smoke.generation-race.v1", JSON.stringify({
        concurrentIndependentEdits: true,
        lateCallbackRejected: lateReplacement.rejected,
        restartFallbackFailed: fallbackRun.status === "failed",
        status: succeededRun.status,
      }))
      // Direct document commands intentionally do not turn the Renderer into a
      // second operation registry. Reload the real application to prove that
      // the persisted terminal state survives unmount/remount, then continue
      // the pre-existing UI smoke from a fresh authoritative projection.
      return { reloadTimeOrigin: performance.timeOrigin }
    }

    const applicationMenuTrigger = await waitFor(
      () => document.querySelector('button[aria-label="Open application menu"], button[aria-label="打开应用菜单"]'),
      "the bottom-left application menu",
    )
    applicationMenuTrigger.click()
    const settingsAction = await waitFor(
      () => [...document.querySelectorAll('[data-ui-menu-surface] button[role="menuitem"]')]
        .find((button) => {
          const label = button.textContent?.trim() ?? ""
          return label.startsWith("Settings") || label.startsWith("设置")
        }),
      "the application menu Settings action",
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
    const marketplaceSurface = await waitFor(
      () => document.querySelector('[data-marketplace-surface="true"]'),
      "Marketplace management inside Settings",
    )
    for (const label of ["扩展", "已安装", "Marketplace", "导入…"]) {
      if (![...marketplaceSurface.querySelectorAll("button")].some((button) => button.textContent?.trim() === label)) {
        throw new Error("Marketplace management did not expose " + label)
      }
    }
    const storedLanguage = JSON.parse(localStorage.getItem("convax.desktop.app-language.v1") ?? "null")
    if (storedLanguage?.language !== "zh-CN") throw new Error("The global language preference was not persisted")
    const backToApp = await waitFor(() => buttonWithText("返回应用"), "the Settings return action")
    backToApp.click()
    await waitFor(() => !document.querySelector('[data-settings-view="true"]'), "Settings to close")

    const savedDocument = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    if (!savedDocument.projection) throw new Error("The active Canvas document did not load")
    return {
      activeCanvasId: selectedCanvasId,
      canvasCount: catalog.canvases.length,
      documentId: savedDocument.projection.id,
      language: document.documentElement.lang,
      projectId,
      generationRace: persistedGenerationRace,
    }
      })()`,
    )
    if (
      typeof evaluationResult === "object" &&
      evaluationResult !== null &&
      "reloadTimeOrigin" in evaluationResult &&
      typeof evaluationResult.reloadTimeOrigin === "number"
    ) {
      await sendDebuggerCommand(rendererDebugger, "Page.enable", {})
      await sendDebuggerCommand(rendererDebugger, "Page.navigate", { url: builtRendererUrl })
      await waitForRendererReload(rendererDebugger, evaluationResult.reloadTimeOrigin)
      continue
    }
    result = evaluationResult
  }

  const summary = result as {
    activeCanvasId?: string
    canvasCount?: number
    collaborationPending?: boolean
    creationAvailability?: string
    documentId?: string
    localAuthorityRecovery?: boolean
    language?: string
    latencyMode?: boolean
    latencySummary?: unknown
    offlineMutation?: boolean
    projectId?: string
    recoveryTitle?: string
    startupMode?: string
    generationRace?: {
      concurrentIndependentEdits?: boolean
      lateCallbackRejected?: boolean
      restartFallbackFailed?: boolean
      status?: string
    }
  }
  if (summary.latencyMode !== true && summary.activeCanvasId && summary.projectId) {
    // Window-scoped shortcuts are meaningful only for the foreground page.
    // Other local Electron development windows must not make this isolated
    // smoke nondeterministic by taking focus between the main flow and here.
    await sendDebuggerCommand(rendererDebugger, "Page.bringToFront", {})
    const shortcutSmoke = (await evaluateStable(
      rendererDebugger,
      `(async () => {
      const canvasId = ${JSON.stringify(summary.activeCanvasId)}
      const projectId = ${JSON.stringify(summary.projectId)}
      const waitFor = async (read, label) => {
        const deadline = Date.now() + ${timeoutMs}
        while (Date.now() < deadline) {
          const value = await read()
          if (value) return value
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error("Timed out waiting for shortcut smoke " + label)
      }
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const loadDocument = async () => {
        const loaded = await window.convax.canvas.documents.load({ canvasId, scopeId: projectId })
        if (!loaded.projection) throw new Error("Shortcut smoke could not load the active Canvas")
        return loaded.projection
      }
      const dispatchKey = (type, key, modifiers = {}) => {
        const target = document.activeElement instanceof HTMLElement ? document.activeElement : window
        const event = new KeyboardEvent(type, {
          altKey: modifiers.altKey === true,
          bubbles: true,
          cancelable: true,
          code: modifiers.code,
          ctrlKey: modifiers.ctrlKey === true,
          key,
          metaKey: modifiers.metaKey === true,
          shiftKey: modifiers.shiftKey === true,
        })
        target.dispatchEvent(event)
        return event.defaultPrevented
      }
      const primaryModifiers = window.convax.platform === "darwin" ? { metaKey: true } : { ctrlKey: true }
      const pressPrimary = async (key, extra = {}) => {
        const modifiers = { ...primaryModifiers, ...extra }
        const consumed = dispatchKey("keydown", key, modifiers)
        dispatchKey("keyup", key, modifiers)
        await settle()
        return consumed
      }
      const pressControlY = async () => {
        dispatchKey("keydown", "y", { ctrlKey: true })
        dispatchKey("keyup", "y", { ctrlKey: true })
        await settle()
      }
      const pressEscape = async () => {
        dispatchKey("keydown", "Escape")
        dispatchKey("keyup", "Escape")
        await settle()
      }
      const holdExternalDrag = () => {
        let consumed = false
        if (window.convax.platform === "darwin") {
          consumed = dispatchKey("keydown", "Meta", { metaKey: true })
          consumed = dispatchKey("keydown", "Shift", { metaKey: true, shiftKey: true }) || consumed
        } else {
          consumed = dispatchKey("keydown", "Control", { ctrlKey: true })
          consumed = dispatchKey("keydown", "Shift", { ctrlKey: true, shiftKey: true }) || consumed
        }
        if (consumed) throw new Error("External drag shortcut consumed its native modifier event")
      }
      const releaseExternalDrag = () => {
        if (window.convax.platform === "darwin") {
          dispatchKey("keyup", "Shift", { metaKey: true })
          dispatchKey("keyup", "Meta")
        } else {
          dispatchKey("keyup", "Shift", { ctrlKey: true })
          dispatchKey("keyup", "Control")
        }
      }
      const dragState = () => document.querySelector("[data-canvas-selection-drag-state]")?.getAttribute(
        "data-canvas-selection-drag-state",
      )
      const canvas = await waitFor(() => document.querySelector(".convax-canvas"), "Canvas root")
      const baseline = await loadDocument()
      const baselineNodeIds = new Set(baseline.nodes.map((node) => node.id))

      const addNode = await waitFor(
        () => canvas.querySelector('button[aria-label="Add node"]'),
        "Add node action",
      )
      addNode.click()
      const addText = await waitFor(
        () => canvas.querySelector('button[aria-label="Add Text"]'),
        "Add Text action",
      )
      addText.click()
      const createdDocument = await waitFor(async () => {
        const current = await loadDocument()
        return current.nodes.length === baseline.nodes.length + 1 ? current : null
      }, "text-node creation")
      const initialTextNode = createdDocument.nodes.find((node) => !baselineNodeIds.has(node.id))
      if (!initialTextNode) throw new Error("Shortcut smoke did not identify its created text node")
      const initialTextElement = await waitFor(
        () => canvas.querySelector('[data-id="' + CSS.escape(initialTextNode.id) + '"]'),
        "created text node",
      )
      const nodeInput = await waitFor(
        () => initialTextElement.querySelector("[contenteditable]:not([contenteditable='false'])"),
        "created node input",
      )
      window.focus()
      await waitFor(() => document.hasFocus(), "foreground window focus")
      nodeInput.focus()
      await pressPrimary("f")
      await pressPrimary("z")
      const inputIsolatedDocument = await loadDocument()
      if (
        document.querySelector('[aria-label="Search nodes"]')
        || inputIsolatedDocument.nodes.length !== createdDocument.nodes.length
      ) {
        throw new Error("Canvas shortcuts leaked into a focused node input")
      }

      // The isolated smoke can share a developer desktop with other Electron
      // windows. Reassert focus immediately before the application shortcut so
      // a background window cannot turn a synthetic key event into a false
      // shortcut-routing failure.
      window.focus()
      await waitFor(() => document.hasFocus(), "application shortcut window focus")
      nodeInput.focus()
      await pressPrimary("k")
      await waitFor(() => document.querySelector('[data-slot="command-menu"]'), "application command palette")
      await pressEscape()
      await waitFor(() => !document.querySelector('[data-slot="command-menu"]'), "command palette dismissal")

      canvas.focus({ preventScroll: true })
      dispatchKey("keydown", "h")
      dispatchKey("keyup", "h")
      await waitFor(() => canvas.getAttribute("data-canvas-tool") === "hand", "Canvas hand shortcut")
      dispatchKey("keydown", "v")
      dispatchKey("keyup", "v")
      await waitFor(() => canvas.getAttribute("data-canvas-tool") === "select", "Canvas select shortcut")

      if (!(await pressPrimary("0"))) throw new Error("Canvas fit shortcut was not routed")
      if (!(await pressPrimary("="))) throw new Error("Canvas zoom-in shortcut was not routed")
      if (!(await pressPrimary("-"))) throw new Error("Canvas zoom-out shortcut was not routed")
      if (!(await pressPrimary("a"))) throw new Error("Canvas select-all shortcut was not routed")
      if (!dispatchKey("keydown", "Escape")) throw new Error("Canvas clear-selection shortcut was not routed")
      dispatchKey("keyup", "Escape")
      await settle()

      canvas.focus({ preventScroll: true })
      if (!dispatchKey("keydown", "Tab")) throw new Error("Canvas add-node shortcut was not routed")
      dispatchKey("keyup", "Tab")
      await waitFor(
        () => [...canvas.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add Text"),
        "Canvas add-node shortcut",
      )
      if (!dispatchKey("keydown", "Escape")) throw new Error("Canvas add-node dismissal was not routed")
      dispatchKey("keyup", "Escape")
      await settle()

      canvas.focus({ preventScroll: true })
      if (!dispatchKey("keydown", " ", { code: "Space" })) {
        throw new Error("Canvas Space panning shortcut was not routed")
      }
      await waitFor(() => canvas.classList.contains("is-space-panning"), "Canvas Space panning hold")
      dispatchKey("keyup", " ", { code: "Space" })
      await waitFor(() => !canvas.classList.contains("is-space-panning"), "Canvas Space panning release")

      await pressPrimary("f")
      await waitFor(() => document.querySelector('[aria-label="Search nodes"]'), "Canvas search shortcut")
      await pressEscape()
      await waitFor(() => !document.querySelector('[aria-label="Search nodes"]'), "Canvas search dismissal")

      canvas.focus({ preventScroll: true })
      await pressPrimary("z")
      await waitFor(async () => (await loadDocument()).nodes.length === baseline.nodes.length, "Canvas undo")
      canvas.focus({ preventScroll: true })
      await pressPrimary("z", { shiftKey: true })
      await waitFor(
        async () => (await loadDocument()).nodes.length === baseline.nodes.length + 1,
        "Canvas redo",
      )

      const workspace = document.querySelector('[data-workspace-shell="true"]')
      const canvasRegion = canvas.closest(".workspace-canvas-region")
      const workspaceFocusTarget = [...(workspace?.querySelectorAll("button") ?? [])].find(
        (button) => !button.disabled && button.offsetParent !== null && !canvasRegion?.contains(button),
      )
      if (!(workspaceFocusTarget instanceof HTMLElement)) {
        throw new Error("Shortcut smoke could not focus a non-Canvas workspace control")
      }
      workspaceFocusTarget.focus({ preventScroll: true })
      await pressPrimary("z")
      await waitFor(async () => (await loadDocument()).nodes.length === baseline.nodes.length, "workspace undo")
      workspaceFocusTarget.focus({ preventScroll: true })
      await pressControlY()
      const workspaceRedoneDocument = await waitFor(async () => {
        const current = await loadDocument()
        return current.nodes.length === baseline.nodes.length + 1 ? current : null
      }, "workspace redo")
      const textNode = workspaceRedoneDocument.nodes.find((node) => !baselineNodeIds.has(node.id))
      if (!textNode) throw new Error("Workspace redo did not restore the shortcut smoke text node")

      const resourceSession = await window.convax.canvas.sessions.open({ canvasId, scopeId: projectId })
      let imageNodeId
      try {
        const added = await window.convax.canvas.resources.add({
          anchor: { x: 160, y: 160 },
          canvasId,
          commandId: "smoke-shortcuts-add-image",
          projectId,
          sessionId: resourceSession.sessionId,
          sources: [{ kind: "host-file", path: "shortcut-smoke.png", sourceId: "shortcut-smoke-image" }],
        })
        imageNodeId = added.createdNodeIds[0]
      } finally {
        await window.convax.canvas.sessions.close({
          ref: { canvasId, scopeId: projectId },
          sessionId: resourceSession.sessionId,
        })
      }
      if (!imageNodeId) throw new Error("Shortcut smoke image admission did not create a node")
      const imageNode = await waitFor(
        () => canvas.querySelector('[data-id="' + CSS.escape(imageNodeId) + '"]'),
        "shortcut smoke image node",
      )
      imageNode.click()
      await waitFor(() => imageNode.classList.contains("selected"), "image selection")

      canvas.focus({ preventScroll: true })
      if (!(await pressPrimary("d"))) throw new Error("Canvas duplicate shortcut was not routed")
      const duplicatedDocument = await waitFor(async () => {
        const current = await loadDocument()
        return current.nodes.length === workspaceRedoneDocument.nodes.length + 2 ? current : null
      }, "Canvas duplicate shortcut")
      const duplicateNode = duplicatedDocument.nodes.find(
        (node) => node.id !== textNode.id && node.id !== imageNodeId && !baselineNodeIds.has(node.id),
      )
      if (!duplicateNode) throw new Error("Canvas duplicate shortcut did not create a node")
      const duplicateElement = await waitFor(
        () => canvas.querySelector('[data-id="' + CSS.escape(duplicateNode.id) + '"]'),
        "duplicated Canvas node",
      )
      duplicateElement.click()
      if (!dispatchKey("keydown", "Delete")) throw new Error("Canvas delete shortcut was not routed")
      dispatchKey("keyup", "Delete")
      await waitFor(async () => !(await loadDocument()).nodes.some((node) => node.id === duplicateNode.id), "Canvas delete")

      canvas.focus({ preventScroll: true })
      if (!dispatchKey("keydown", "f", { altKey: true, shiftKey: true })) {
        throw new Error("Canvas layout shortcut was not routed")
      }
      dispatchKey("keyup", "f", { altKey: true, shiftKey: true })
      await settle()
      if (!(await pressPrimary("g"))) throw new Error("Canvas group shortcut was not routed")
      if (!(await pressPrimary("g", { shiftKey: true }))) throw new Error("Canvas ungroup shortcut was not routed")
      imageNode.click()
      canvas.focus({ preventScroll: true })
      if (!(await pressPrimary("Enter"))) throw new Error("Canvas generate shortcut was not routed")
      await settle()
      const generationClose = document.querySelector('button[aria-label="Close generation composer"]')
      if (generationClose instanceof HTMLElement) {
        generationClose.click()
        await settle()
      }

      canvas.focus({ preventScroll: true })
      holdExternalDrag()
      await waitFor(() => dragState() === "ready", "external drag key hold")
      releaseExternalDrag()
      await waitFor(() => !dragState(), "external drag keyup release")

      canvas.focus({ preventScroll: true })
      holdExternalDrag()
      const dragSurface = await waitFor(
        () => document.querySelector('[data-canvas-selection-drag-state="ready"]'),
        "external dragstart surface",
      )
      dragSurface.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }))
      await waitFor(() => !dragState(), "external dragstart consumption")
      releaseExternalDrag()

      canvas.focus({ preventScroll: true })
      holdExternalDrag()
      await waitFor(() => dragState() === "ready", "external drag missed-keyup setup")
      holdExternalDrag()
      await waitFor(() => dragState() === "ready", "external drag fresh-keydown recovery")
      releaseExternalDrag()
      await waitFor(() => !dragState(), "external drag recovered hold release")

      canvas.focus({ preventScroll: true })
      holdExternalDrag()
      await waitFor(() => dragState() === "ready", "external drag unrelated-key setup")
      dispatchKey("keydown", "x", {
        ...(window.convax.platform === "darwin" ? { metaKey: true } : { ctrlKey: true }),
        shiftKey: true,
      })
      await waitFor(() => !dragState(), "external drag unrelated-key release")
      releaseExternalDrag()

      canvas.focus({ preventScroll: true })
      holdExternalDrag()
      await waitFor(() => dragState() === "ready", "external drag blur setup")
      window.dispatchEvent(new Event("blur"))
      await waitFor(() => !dragState(), "external drag window-blur release")
      window.dispatchEvent(new Event("focus"))
      releaseExternalDrag()

      let composer
      let requestedAgent = false
      const composerDeadline = Date.now() + ${timeoutMs}
      while (!composer) {
        const agentPanel = [...document.querySelectorAll(${JSON.stringify(openAgentPanelSelector)})]
          .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null)
        composer = agentPanel?.querySelector('[contenteditable="true"][aria-label="Message the project agent"]')
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
        if (Date.now() >= composerDeadline) break
      }
      composer = await waitFor(() => composer, "conversation composer")
      canvas.focus({ preventScroll: true })
      holdExternalDrag()
      await waitFor(() => dragState() === "ready", "external drag focus-change setup")
      composer.focus()
      // CDP can update activeElement while the hidden smoke BrowserWindow is
      // not OS-focused without emitting Chromium's ordinary focus event path.
      // Replay that event explicitly so this verifies the production focus
      // transition instead of depending on smoke-window activation timing.
      composer.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: canvas }))
      await waitFor(() => !dragState(), "external drag focus-scope release")
      releaseExternalDrag()

      const conversationDocument = await loadDocument()
      composer.focus()
      await pressPrimary("f")
      await pressPrimary("z")
      holdExternalDrag()
      await settle()
      releaseExternalDrag()
      const isolatedConversationDocument = await loadDocument()
      if (
        document.querySelector('[aria-label="Search nodes"]')
        || dragState()
        || isolatedConversationDocument.nodes.length !== conversationDocument.nodes.length
      ) {
        throw new Error("Canvas or workspace shortcuts leaked into the conversation scope")
      }

      composer.focus()
      await pressPrimary("k")
      await waitFor(() => document.querySelector('[data-slot="command-menu"]'), "conversation command palette")
      await pressEscape()
      await waitFor(() => !document.querySelector('[data-slot="command-menu"]'), "conversation palette dismissal")

      composer.focus()
      await pressPrimary(",")
      const settings = await waitFor(
        () => document.querySelector('[data-settings-view="true"]'),
        "application settings shortcut",
      )
      const settingsFocusTarget = settings.querySelector("button, input, select, textarea")
      if (!(settingsFocusTarget instanceof HTMLElement)) {
        throw new Error("Shortcut smoke could not focus the Settings surface")
      }
      settingsFocusTarget.focus()
      await pressEscape()
      await waitFor(() => !document.querySelector('[data-settings-view="true"]'), "application settings Escape")

      await window.convax.canvas.documents.execute({
        command: { nodeIds: [textNode.id, imageNodeId], type: "elements.remove" },
        commandId: "smoke-shortcuts-cleanup",
        ref: { canvasId, scopeId: projectId },
      })
      await waitFor(async () => {
        const current = await loadDocument()
        return !current.nodes.some((node) => node.id === textNode.id || node.id === imageNodeId)
      }, "shortcut smoke cleanup")

      return {
        features: [
          "application.open-settings",
          "application.close-settings",
          "application.command-palette",
          "workspace.canvas.undo",
          "workspace.canvas.redo",
          "canvas.undo",
          "canvas.redo",
          "canvas.search",
          "canvas.fit-view",
          "canvas.zoom-in",
          "canvas.zoom-out",
          "canvas.select-all",
          "canvas.clear-selection",
          "canvas.group",
          "canvas.ungroup",
          "canvas.duplicate",
          "canvas.generate",
          "canvas.layout",
          "canvas.delete",
          "canvas.add-node",
          "canvas.space-pan",
          "canvas.drag-media-to-other-apps",
          "canvas.local.hand",
          "canvas.local.select",
          "scope.node-input-isolation",
          "scope.conversation-isolation",
          "release.keyup",
          "release.missed-keyup-fresh-keydown",
          "release.unrelated-key",
          "release.window-blur",
          "release.focus-scope-change",
          "native.dragstart-consumed",
        ],
      }
    })()`,
    )) as { features?: string[] }
    const expectedShortcutFeatures = [
      "application.open-settings",
      "application.close-settings",
      "application.command-palette",
      "workspace.canvas.undo",
      "workspace.canvas.redo",
      "canvas.undo",
      "canvas.redo",
      "canvas.search",
      "canvas.fit-view",
      "canvas.zoom-in",
      "canvas.zoom-out",
      "canvas.select-all",
      "canvas.clear-selection",
      "canvas.group",
      "canvas.ungroup",
      "canvas.duplicate",
      "canvas.generate",
      "canvas.layout",
      "canvas.delete",
      "canvas.add-node",
      "canvas.space-pan",
      "canvas.drag-media-to-other-apps",
      "canvas.local.hand",
      "canvas.local.select",
      "scope.node-input-isolation",
      "scope.conversation-isolation",
      "release.keyup",
      "release.missed-keyup-fresh-keydown",
      "release.unrelated-key",
      "release.window-blur",
      "release.focus-scope-change",
      "native.dragstart-consumed",
    ]
    if (JSON.stringify(shortcutSmoke.features) !== JSON.stringify(expectedShortcutFeatures)) {
      throw new Error(`Unexpected shortcut smoke coverage: ${JSON.stringify(shortcutSmoke)}`)
    }
    console.log(`Desktop scoped shortcut smoke passed (${shortcutSmoke.features.length} core paths)`)
  }
  if (summary.latencyMode === true) {
    if (!summary.projectId || !summary.latencySummary) {
      throw new Error(`Unexpected latency result: ${JSON.stringify(summary)}`)
    }
    console.log(`[convax:desktop-latency-summary] ${JSON.stringify(summary.latencySummary)}`)
    console.log(`Desktop mounted-session latency smoke passed (${summary.projectId})`)
  } else if (summary.startupMode === "local-authority-unavailable") {
    if (
      !summary.projectId ||
      summary.canvasCount !== 0 ||
      summary.collaborationPending !== false ||
      summary.creationAvailability !== "local-authority-unavailable" ||
      summary.localAuthorityRecovery !== true ||
      !summary.recoveryTitle
    ) {
      throw new Error(`Unexpected personal Project startup result: ${JSON.stringify(summary)}`)
    }
    console.log(
      `Desktop opened a personal local-first Project without starting Team collaboration; the current protocol runtime correctly reported unavailable local editing authority (${summary.projectId})`,
    )
  } else if (summary.startupMode === "local-offline") {
    if (
      !summary.projectId ||
      !summary.activeCanvasId?.startsWith("cv_") ||
      summary.canvasCount !== 1 ||
      summary.documentId !== summary.activeCanvasId ||
      summary.offlineMutation !== true
    ) {
      throw new Error(`Unexpected offline Project result: ${JSON.stringify(summary)}`)
    }
    console.log(
      `Desktop opened a local-owner Project and preserved add/update/delete operations across Renderer reloads (${summary.projectId})`,
    )
  } else {
    if (
      summary.activeCanvasId !== "canvas-main" ||
      summary.canvasCount !== 1 ||
      summary.documentId !== "canvas-main" ||
      summary.language !== "zh-CN" ||
      summary.generationRace?.concurrentIndependentEdits !== true ||
      summary.generationRace.lateCallbackRejected !== true ||
      summary.generationRace.restartFallbackFailed !== true ||
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
        const agentPanel = [...document.querySelectorAll(${JSON.stringify(openAgentPanelSelector)})]
          .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null)
        composer = agentPanel?.querySelector('[contenteditable="true"][aria-label="Message the project agent"]')
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
        const agentPanels = [...document.querySelectorAll('[data-agent-panel-hosted="true"]')]
        const alerts = [...document.querySelectorAll('[role="alert"]')]
          .map((alert) => alert.textContent?.trim())
          .filter(Boolean)
        throw new Error("The standalone Agent composer is missing after opening its panel: " + JSON.stringify({
          agentStatus: await window.convax.agent.getStatus().catch((cause) => ({ error: String(cause) })),
          alerts,
          bodyText: document.body.innerText.slice(-2_000),
          composerContentEditable: disabledComposer?.getAttribute("contenteditable"),
          openAgentVisible: openAgent instanceof HTMLElement && openAgent.offsetParent !== null,
          panels: agentPanels.map((panel) => ({
            text: panel.textContent?.slice(-500),
            visible: panel instanceof HTMLElement && panel.offsetParent !== null,
          })),
          systemStatus: await window.convax.systemStatus.getSnapshot().catch((cause) => ({ error: String(cause) })),
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
        window.__convaxSmokeComposerInputData = event.data
        window.__convaxSmokeComposerInputType = event.inputType
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
      const agentPanel = [...document.querySelectorAll(${JSON.stringify(openAgentPanelSelector)})]
        .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null)
      const composer = agentPanel?.querySelector('[contenteditable="true"][aria-label="Message the project agent"]')
      if (!composer || !picker) {
        const selection = window.getSelection()
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
        throw new Error("Real @ input did not open the Agent composer picker: " + JSON.stringify({
          composerHtml: composer?.innerHTML,
          composerText: composer?.textContent,
          rangeCollapsed: range?.collapsed,
          rangeContainerData:
            range?.startContainer instanceof Text ? range.startContainer.data : undefined,
          rangeContainerName: range?.startContainer.nodeName,
          rangeContainerType: range?.startContainer.nodeType,
          rangeOffset: range?.startOffset,
          selectionAnchorName: selection?.anchorNode?.nodeName,
          selectionAnchorOffset: selection?.anchorOffset,
          inputData: window.__convaxSmokeComposerInputData,
          inputType: window.__convaxSmokeComposerInputType,
          trusted: window.__convaxSmokeComposerInputTrusted,
        }))
      }
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
        inputData: window.__convaxSmokeComposerInputData,
        inputType: window.__convaxSmokeComposerInputType,
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
      `(async () => {
      const deadline = Date.now() + ${timeoutMs}
      let picker
      let tab
      while (Date.now() < deadline) {
        picker = document.querySelector('[data-agent-composer-picker="true"]')
        tab = picker && [...picker.querySelectorAll('[role="tab"]')]
          .find((candidate) => candidate.textContent?.trim() === "Canvas")
        if (tab) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (!tab) {
        const composer = document.querySelector(
          '[contenteditable="true"][aria-label="Message the project agent"]',
        )
        throw new Error("The Agent composer Canvas tab is missing: " + JSON.stringify({
          composerExpanded: composer?.getAttribute("aria-expanded"),
          composerText: composer?.textContent,
          pickerHtml: picker?.innerHTML,
        }))
      }
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
      const agentPanel = [...document.querySelectorAll(${JSON.stringify(openAgentPanelSelector)})]
        .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null)
      const composer = agentPanel?.querySelector('[contenteditable="true"][aria-label="Message the project agent"]')
      if (!composer) return
      composer.replaceChildren()
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))
      delete window.__convaxSmokeComposerInputData
      delete window.__convaxSmokeComposerInputType
      delete window.__convaxSmokeComposerInputTrusted
    })()`,
    )

    const agentGenerationModel = (await evaluateStable(
      rendererDebugger,
      `(async () => {
      const deadline = Date.now() + ${timeoutMs}
      const waitFor = async (read, label) => {
        while (Date.now() < deadline) {
          const value = read()
          if (value) return value
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw new Error("Timed out waiting for " + label)
      }
      const agentPanel = await waitFor(
        () => [...document.querySelectorAll(${JSON.stringify(openAgentPanelSelector)})]
          .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null),
        "the hosted workspace Agent panel",
      )
      const modelButton = await waitFor(
        () => agentPanel.querySelector('button[aria-label^="Select Agent models,"]'),
        "the standalone Agent model selector",
      )
      modelButton.click()
      const picker = await waitFor(
        () => agentPanel.querySelector('[data-agent-generation-model-picker]'),
        "the standalone Agent model picker",
      )
      const initialText = picker.textContent ?? ""
      if (initialText.includes("Auto") || initialText.includes("自动")) {
        throw new Error("The standalone Agent model picker exposed an Auto option")
      }
      const imageTab = await waitFor(
        () => [...picker.querySelectorAll('[role="tab"]')]
          .find((candidate) => candidate.textContent?.trim() === "Image"),
        "the Image model tab",
      )
      imageTab.click()
      const selectedModel = await waitFor(
        () => [...agentPanel.querySelectorAll('[data-agent-generation-model-picker] [role="radio"]')]
          .find((candidate) => candidate.getAttribute("aria-label") === "Smoke Image by Smoke Service"
            && candidate.getAttribute("aria-checked") === "true"),
        "the first available concrete generation model to become selected",
      )
      const selectedLabel = modelButton.getAttribute("aria-label")
      if (selectedLabel?.includes("Auto") || selectedLabel?.includes("自动")) {
        throw new Error("The standalone Agent model selector retained an Auto label")
      }
      modelButton.click()
      return {
        model: selectedModel.getAttribute("aria-label"),
        pickerHadAuto: initialText.includes("Auto") || initialText.includes("自动"),
        selector: selectedLabel,
      }
    })()`,
    )) as { model?: string | null; pickerHadAuto?: boolean; selector?: string | null }
    if (
      agentGenerationModel.model !== "Smoke Image by Smoke Service" ||
      agentGenerationModel.pickerHadAuto !== false ||
      agentGenerationModel.selector !== "Select Agent models, Smoke Service · Smoke Image"
    ) {
      throw new Error(`Unexpected standalone Agent model selection: ${JSON.stringify(agentGenerationModel)}`)
    }

    console.log(
      `Desktop workspace, diagnostics, standalone Agent model, Canvas generation CAS/late-callback/restart races, Marketplace Settings, and Open Project smoke passed (${summary.projectId}, canvas-main)`,
    )
  }
} catch (error) {
  child.kill("SIGKILL")
  const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr])
  if (capturedStdout.trim()) console.error(capturedStdout.trim())
  if (capturedStderr.trim()) console.error(capturedStderr.trim())
  throw error
} finally {
  child.kill("SIGKILL")
  await child.exited
  if (forwardLatencyDiagnostics) {
    const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr])
    const diagnostics = `${capturedStdout}\n${capturedStderr}`
      .split(/\r?\n/u)
      .filter((line) => /\[convax:[^\]]*latency[^\]]*\]/u.test(line))
    if (diagnostics.length > 0) console.log(diagnostics.join("\n"))
  }
  await fs.rm(temporaryRoot, { force: true, recursive: true })
}
