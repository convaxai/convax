import fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const desktopRoot = path.join(repositoryRoot, "packages", "desktop")
const timeoutMs = 60_000
const evaluationTimeoutMs = 180_000
const externalProbeUrl = "https://example.com/__convax_offline_restart_smoke__"

class SmokeDefect extends Error {
  override readonly name = "SmokeDefect"
}

class ProductDefect extends Error {
  override readonly name = "ProductDefect"
}

interface DebugTarget {
  type: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface ElectronInstance {
  child: Bun.Subprocess
  inspectorPort: number
  label: string
  mainDebugger: string
  mainPid: number
  rendererDebugger: string
  rendererPort: number
  stderr: Promise<string>
  stdout: Promise<string>
}

interface RestartOracle {
  canvasId: string
  deletedNodeId: string
  keepNodeId: string
  projectId: string
}

interface RendererPhaseInput {
  expected?: RestartOracle
  phase: "mutate" | "verify-and-delete" | "verify-empty"
  projectName: string
  projectRoot: string
  timeoutMs: number
}

function reservePort() {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  })
}

async function resolveDesktopMainEntry() {
  const manifestPath = path.join(desktopRoot, "package.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { main?: unknown }
  if (typeof manifest.main !== "string" || !manifest.main.trim()) {
    throw new SmokeDefect("Desktop package.json must declare a non-empty main entry")
  }
  const mainRoot = path.join(desktopRoot, "out", "main")
  const mainEntry = path.resolve(desktopRoot, manifest.main)
  const relativeEntry = path.relative(mainRoot, mainEntry)
  if (!relativeEntry || relativeEntry.startsWith(".." + path.sep) || path.isAbsolute(relativeEntry)) {
    throw new SmokeDefect("Desktop package.json main must resolve below out/main")
  }
  return mainEntry
}

async function resolveElectronBinary() {
  const require = createRequire(path.join(desktopRoot, "package.json"))
  const electronPackageRoot = path.dirname(require.resolve("electron/package.json"))
  const relativeBinary = await fs
    .readFile(path.join(electronPackageRoot, "path.txt"), "utf8")
    .then((value) => value.trim())
    .catch(() => "")
  if (!relativeBinary) {
    throw new SmokeDefect("Electron runtime is missing; run its install script before the desktop smoke")
  }
  const binary = path.join(electronPackageRoot, "dist", relativeBinary)
  await fs.access(binary).catch(() => {
    throw new SmokeDefect("Electron runtime is missing: " + binary)
  })
  return binary
}

async function collectOutput(stream: ReadableStream<Uint8Array>) {
  let output = ""
  for await (const chunk of stream) output += new TextDecoder().decode(chunk)
  return output
}

async function waitForTarget(port: number, predicate: (target: DebugTarget) => boolean, child: Bun.Subprocess) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new ProductDefect("Electron exited before its debugger target became ready")
    }
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list")
      const targets = (await response.json()) as DebugTarget[]
      const target = targets.find(predicate)
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new SmokeDefect(
    "Timed out waiting for debugger target on port " + port + (lastError ? ": " + String(lastError) : ""),
  )
}

async function evaluate(webSocketUrl: string, expression: string, requestTimeoutMs = evaluationTimeoutMs) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new SmokeDefect("Timed out waiting for debugger evaluation"))
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
      reject(new SmokeDefect("Debugger WebSocket failed"))
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
      if (message.error) return reject(new SmokeDefect(message.error.message))
      if (message.result?.exceptionDetails) {
        const description =
          message.result.exceptionDetails.exception?.description ??
          message.result.exceptionDetails.text ??
          "Debugger evaluation failed"
        return reject(new Error(description))
      }
      resolve(message.result?.result?.value)
    })
  })
}

function configureMain(input: { electronRequireBase: string; projectRoot: string }) {
  const createRequire = process.getBuiltinModule("module").createRequire
  const electron = createRequire(input.electronRequireBase)("electron")
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.projectRoot] })
  return { pid: process.pid, userData: electron.app.getPath("userData") }
}

async function mainOfflineProbe(url: string) {
  try {
    await fetch(url)
    return { failed: false }
  } catch (error) {
    return {
      code: error && typeof error === "object" && "code" in error ? String(error.code) : null,
      failed: true,
      message: String(error),
    }
  }
}

async function rendererOfflineProbe(url: string) {
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ failed: false, timedOut: true }), 10_000)
  })
  const request = fetch(url).then(
    () => ({ failed: false, timedOut: false }),
    (error) => ({ failed: true, message: String(error), timedOut: false }),
  )
  return Promise.race([request, timeout])
}

async function verifyRendererExternalNetworkBlocked(webSocketUrl: string, probeUrl: string) {
  const probePattern = probeUrl.replaceAll("\\", "\\\\").replaceAll("*", "\\*").replaceAll("?", "\\?")
  return new Promise<{
    failed?: boolean
    failureInjected: boolean
    message?: string
    probeUrl: string
    requestObserved: boolean
    timedOut?: boolean
  }>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const pending = new Map<
      number,
      {
        reject: (error: Error) => void
        resolve: (result: unknown) => void
      }
    >()
    let commandId = 0
    let evaluation: { failed?: boolean; message?: string; timedOut?: boolean } | undefined
    let failureInjected = false
    const logEntries: string[] = []
    let networkFailure: { blockedReason?: string; errorText?: string } | undefined
    let networkRequestId: string | undefined
    let networkRequestObserved = false
    let pageLoadGeneration = 0
    const pageLoadWaiters: Array<{ after: number; resolve: () => void }> = []
    let requestObserved = false
    let restoringControls = false
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) {
        reject(error)
        return
      }
      resolve({ ...evaluation, failureInjected, probeUrl, requestObserved })
    }
    const maybeFinish = () => {
      if (!evaluation || !failureInjected || restoringControls) return
      restoringControls = true
      void (async () => {
        await sendCommand("Fetch.disable")
        await sendCommand("Page.setBypassCSP", { enabled: false })
        await sendCommand("Network.setCacheDisabled", { cacheDisabled: false })
        await reloadPage()
        finish()
      })().catch((error) => finish(error instanceof Error ? error : new SmokeDefect(String(error))))
    }
    const sendCommand = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<unknown>((resolveCommand, rejectCommand) => {
        const id = ++commandId
        pending.set(id, { reject: rejectCommand, resolve: resolveCommand })
        socket.send(JSON.stringify({ id, method, params }))
      })
    const reloadPage = async () => {
      const after = pageLoadGeneration
      const loaded = new Promise<void>((resolveLoad) => {
        pageLoadWaiters.push({ after, resolve: resolveLoad })
      })
      await sendCommand("Page.reload", { ignoreCache: true })
      await loaded
    }
    const timer = setTimeout(() => {
      finish(
        new SmokeDefect(
          "Timed out injecting the Renderer external-network failure: " +
            JSON.stringify({
              evaluation,
              failureInjected,
              logEntries,
              networkFailure,
              networkRequestObserved,
              probePattern,
              probeUrl,
              requestObserved,
            }),
        ),
      )
    }, 30_000)

    socket.addEventListener("error", () => {
      finish(new SmokeDefect("Renderer network-control debugger WebSocket failed"))
    })
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        error?: { message?: string }
        id?: number
        method?: string
        params?: {
          blockedReason?: string
          entry?: { level?: string; source?: string; text?: string; url?: string }
          errorText?: string
          request?: { url?: string }
          requestId?: string
        }
        result?: unknown
      }
      if (typeof message.id === "number") {
        const command = pending.get(message.id)
        if (!command) return
        pending.delete(message.id)
        if (message.error) {
          command.reject(new SmokeDefect(message.error.message ?? "Debugger command failed"))
        } else {
          command.resolve(message.result)
        }
        return
      }
      if (message.method === "Page.loadEventFired") {
        pageLoadGeneration += 1
        for (let index = pageLoadWaiters.length - 1; index >= 0; index -= 1) {
          const waiter = pageLoadWaiters[index]
          if (waiter && pageLoadGeneration > waiter.after) {
            pageLoadWaiters.splice(index, 1)
            waiter.resolve()
          }
        }
        return
      }
      if (message.method === "Log.entryAdded" && message.params?.entry) {
        logEntries.push(JSON.stringify(message.params.entry))
        return
      }
      if (
        message.method === "Network.requestWillBeSent" &&
        message.params?.request?.url === probeUrl &&
        typeof message.params.requestId === "string"
      ) {
        networkRequestId = message.params.requestId
        networkRequestObserved = true
        return
      }
      if (
        message.method === "Network.loadingFailed" &&
        typeof message.params?.requestId === "string" &&
        message.params.requestId === networkRequestId
      ) {
        networkFailure = {
          blockedReason: message.params.blockedReason,
          errorText: message.params.errorText,
        }
        return
      }
      if (
        message.method !== "Fetch.requestPaused" ||
        message.params?.request?.url !== probeUrl ||
        typeof message.params.requestId !== "string"
      ) {
        return
      }
      requestObserved = true
      void sendCommand("Fetch.failRequest", {
        errorReason: "InternetDisconnected",
        requestId: message.params.requestId,
      }).then(
        () => {
          failureInjected = true
          maybeFinish()
        },
        (error) => finish(error instanceof Error ? error : new SmokeDefect(String(error))),
      )
    })
    socket.addEventListener("open", () => {
      void (async () => {
        await sendCommand("Runtime.evaluate", {
          awaitPromise: true,
          expression:
            "document.readyState === 'complete' ? true : new Promise((resolve) => addEventListener('load', () => resolve(true), { once: true }))",
          returnByValue: true,
        })
        await sendCommand("Page.enable")
        await sendCommand("Log.enable")
        await sendCommand("Network.enable")
        await sendCommand("Network.setCacheDisabled", { cacheDisabled: true })
        await sendCommand("Network.clearBrowserCache")
        await sendCommand("Page.setBypassCSP", { enabled: true })
        await reloadPage()
        await sendCommand("Fetch.enable", {
          patterns: [{ requestStage: "Request", urlPattern: probePattern }],
        })
        const evaluated = (await sendCommand("Runtime.evaluate", {
          awaitPromise: true,
          expression: "(" + rendererOfflineProbe.toString() + ")(" + JSON.stringify(probeUrl) + ")",
          returnByValue: true,
        })) as {
          exceptionDetails?: { text?: string }
          result?: { value?: unknown }
        }
        if (evaluated.exceptionDetails) {
          throw new SmokeDefect(evaluated.exceptionDetails.text ?? "Renderer offline probe evaluation failed")
        }
        evaluation = evaluated.result?.value as {
          failed?: boolean
          message?: string
          timedOut?: boolean
        }
        maybeFinish()
      })().catch((error) => finish(error instanceof Error ? error : new SmokeDefect(String(error))))
    })
  })
}

async function rendererPhase(input: RendererPhaseInput) {
  const waitFor = async <T>(read: () => T | Promise<T>, label: string): Promise<NonNullable<T>> => {
    const deadline = Date.now() + input.timeoutMs
    while (Date.now() < deadline) {
      const value = await read()
      if (value) return value as NonNullable<T>
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error("Timed out waiting for " + label)
  }
  const buttonWithText = (text: string) =>
    [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)
  const buttonWithAnyText = (...texts: string[]) => texts.map(buttonWithText).find(Boolean)

  await waitFor(() => window.convax, "the preload bridge")
  sessionStorage.clear()
  localStorage.clear()

  const initialSurface = await waitFor(
    () => document.querySelector('[data-project-home="true"]') || document.querySelector(".convax-canvas"),
    "Project Home or the restored Canvas",
  )
  const projectAlreadyOpen = initialSurface instanceof Element && initialSurface.classList.contains("convax-canvas")
  if (!projectAlreadyOpen) {
    const enterProject = await waitFor(
      () => buttonWithAnyText("Continue", "继续", "Open project", "打开项目"),
      "the Project Home enter action",
    )
    enterProject.click()
  }

  const projectSurface = await waitFor(
    () =>
      document.querySelector(".convax-canvas") ||
      document.querySelector('[data-project-local-authority-recovery="true"]') ||
      document.querySelector('[data-project-collaboration-pending="true"]'),
    "the local Project authority state or active Canvas",
  )
  if (projectSurface.matches('[data-project-collaboration-pending="true"]')) {
    throw new Error("Opening the offline Project started Team collaboration")
  }
  if (projectSurface.matches('[data-project-local-authority-recovery="true"]')) {
    throw new Error("The selected local-owner protocol did not provide offline mutation authority")
  }
  await waitFor(() => document.querySelector(".convax-canvas"), "the active Canvas")
  await waitFor(() => !document.body.textContent?.includes("Loading canvas"), "Canvas hydration")

  const projects = await window.convax.projects.listProjects()
  const project = projects.projects.find((candidate) => candidate.name === input.projectName)
  if (!project) throw new Error("Open Project did not return the expected Project")
  if (project.rootPath !== input.projectRoot) {
    throw new Error("Open Project changed the bound Project root: " + project.rootPath)
  }
  if (input.expected && project.id !== input.expected.projectId) {
    throw new Error("Restart changed the Project identity")
  }

  const team = await window.convax.projects.collaboration.getStatus({ projectId: project.id })
  if (
    team.projectId !== project.id ||
    team.state !== "local-only" ||
    team.connectedPeerCount !== 0 ||
    team.canEdit !== false ||
    team.reason !== null
  ) {
    throw new Error("Offline local Project unexpectedly activated Team or PeerJS: " + JSON.stringify(team))
  }

  const catalog = await window.convax.projects.canvases.getCanvasCatalog({ projectId: project.id })
  if (catalog.canvases.length !== 1) {
    throw new Error("Offline Project did not expose exactly one Canvas: " + JSON.stringify(catalog))
  }
  const canvasId = catalog.canvases[0]?.id
  if (!canvasId || !canvasId.startsWith("cv_")) {
    throw new Error("Offline Project did not select the V11 local-owner Canvas")
  }
  if (input.expected && canvasId !== input.expected.canvasId) {
    throw new Error("Restart changed the Canvas identity")
  }

  const load = async () => {
    const result = await window.convax.canvas.documents.load({ canvasId, scopeId: project.id })
    if (!result.projection) throw new Error("The authoritative Canvas projection did not load")
    if (result.projection.id !== canvasId) throw new Error("The Canvas projection crossed identity")
    return result.projection
  }

  if (input.phase === "mutate") {
    const initial = await load()
    if (initial.nodes.length !== 0) throw new Error("A new offline Canvas was not empty")
    const resourceSession = await window.convax.canvas.sessions.open({
      canvasId,
      scopeId: project.id,
    })
    const added = await window.convax.canvas.resources.add({
      anchor: { x: 40, y: 60 },
      canvasId,
      commandId: "offline-restart-add-two",
      projectId: project.id,
      sessionId: resourceSession.sessionId,
      sources: [
        {
          kind: "new-text",
          name: "offline-restart-keep",
          sourceId: "offline-restart-keep",
          text: "Keep after restart",
        },
        {
          kind: "new-text",
          name: "offline-restart-delete",
          sourceId: "offline-restart-delete",
          text: "Delete before restart",
        },
      ],
    })
    const [keepNodeId, deletedNodeId] = added.createdNodeIds
    if (!keepNodeId || !deletedNodeId || keepNodeId === deletedNodeId || added.createdNodeIds.length !== 2) {
      throw new Error("Offline resource admission did not create exactly two distinct nodes")
    }
    await window.convax.canvas.documents.execute({
      command: {
        type: "nodes.setGeometry",
        updates: [{ nodeId: keepNodeId, position: { x: 410, y: 230 }, size: { width: 300, height: 190 } }],
      },
      commandId: "offline-restart-set-a-geometry",
      ref: { canvasId, scopeId: project.id },
    })
    await window.convax.canvas.documents.execute({
      command: { nodeIds: [deletedNodeId], type: "elements.remove" },
      commandId: "offline-restart-delete-b",
      ref: { canvasId, scopeId: project.id },
    })
    const committed = await load()
    const keep = committed.nodes.find((node) => node.id === keepNodeId)
    if (
      committed.nodes.length !== 1 ||
      !keep ||
      keep.position.x !== 410 ||
      keep.position.y !== 230 ||
      keep.style?.width !== 300 ||
      keep.style?.height !== 190 ||
      committed.nodes.some((node) => node.id === deletedNodeId)
    ) {
      throw new Error("The first process did not durably project the exact A geometry and B deletion")
    }
    return { canvasId, deletedNodeId, keepNodeId, projectId: project.id, team }
  }

  if (!input.expected) throw new Error("Restart verification is missing its outer-process oracle")
  const restarted = await load()
  if (input.phase === "verify-and-delete") {
    const keep = restarted.nodes.find((node) => node.id === input.expected!.keepNodeId)
    if (
      restarted.nodes.length !== 1 ||
      !keep ||
      keep.position.x !== 410 ||
      keep.position.y !== 230 ||
      keep.style?.width !== 300 ||
      keep.style?.height !== 190 ||
      restarted.nodes.some((node) => node.id === input.expected!.deletedNodeId)
    ) {
      throw new Error("Product defect: A geometry or B deletion did not survive the full Electron restart")
    }
    await window.convax.canvas.documents.execute({
      command: { nodeIds: [input.expected.keepNodeId], type: "elements.remove" },
      commandId: "offline-restart-delete-a",
      ref: { canvasId, scopeId: project.id },
    })
    const deleted = await load()
    if (deleted.nodes.length !== 0) {
      throw new Error("Deleting A did not leave the authoritative Canvas empty")
    }
    return { canvasId, deletedA: true, projectId: project.id, team }
  }

  if (
    restarted.nodes.length !== 0 ||
    restarted.nodes.some((node) => node.id === input.expected!.keepNodeId || node.id === input.expected!.deletedNodeId)
  ) {
    throw new Error("Product defect: the empty Canvas did not survive the third full Electron start")
  }
  return { canvasId, empty: true, projectId: project.id, team }
}

async function waitForEndpointClosed(port: number, label: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await fetch("http://127.0.0.1:" + port + "/json/list")
    } catch {
      return
    }
    await Bun.sleep(50)
  }
  throw new SmokeDefect(label + " debugger endpoint remained alive after the Electron process exited")
}

async function printInstanceOutput(instance: ElectronInstance) {
  const [stdout, stderr] = await Promise.all([instance.stdout, instance.stderr])
  if (stdout.trim()) console.error("[" + instance.label + " stdout]\n" + stdout.trim())
  if (stderr.trim()) console.error("[" + instance.label + " stderr]\n" + stderr.trim())
}

async function hardTerminateElectron(instance: ElectronInstance) {
  if (instance.child.exitCode !== null) {
    await printInstanceOutput(instance)
    throw new ProductDefect(instance.label + " Electron process exited before the smoke terminated it")
  }
  instance.child.kill("SIGKILL")
  let exited = false
  await Promise.race([
    instance.child.exited.then(() => {
      exited = true
    }),
    Bun.sleep(10_000),
  ])
  if (!exited) throw new SmokeDefect(instance.label + " Electron process ignored SIGKILL")
  await Promise.all([
    waitForEndpointClosed(instance.inspectorPort, instance.label + " Main"),
    waitForEndpointClosed(instance.rendererPort, instance.label + " Renderer"),
  ])
  await Promise.all([instance.stdout, instance.stderr])
}

async function eraseBrowserStorage(userDataRoot: string) {
  for (const name of ["Local Storage", "Session Storage"]) {
    const target = path.join(userDataRoot, name)
    await fs.rm(target, { force: true, recursive: true })
    const stillExists = await fs.access(target).then(
      () => true,
      () => false,
    )
    if (stillExists) throw new SmokeDefect("Failed to remove browser state before restart: " + target)
  }
}

async function runProductPhase(instance: ElectronInstance, input: RendererPhaseInput) {
  try {
    return await evaluate(
      instance.rendererDebugger,
      "(" + rendererPhase.toString() + ")(" + JSON.stringify(input) + ")",
    )
  } catch (error) {
    if (error instanceof SmokeDefect) throw error
    throw new ProductDefect(instance.label + " acceptance failed: " + String(error))
  }
}

function networkGuardSource() {
  return [
    '"use strict";',
    'const fs = require("node:fs");',
    'const net = require("node:net");',
    'const tls = require("node:tls");',
    "const logPath = process.env.CONVAX_OFFLINE_SMOKE_NETWORK_LOG;",
    "function record(kind) {",
    '  if (logPath) fs.appendFileSync(logPath, Date.now() + "\\t" + process.pid + "\\t" + kind + "\\n");',
    "}",
    "function blocked(kind) {",
    "  record(kind);",
    '  const error = new Error("CONVAX_OFFLINE_SMOKE_NETWORK_BLOCKED:" + kind);',
    '  error.code = "ENETUNREACH";',
    "  throw error;",
    "}",
    "function hostFrom(args) {",
    "  const first = args[0];",
    '  if (first && typeof first === "object") return first.host || first.hostname;',
    '  return typeof args[1] === "string" ? args[1] : undefined;',
    "}",
    "function loopback(args) {",
    "  const host = hostFrom(args);",
    '  return host === undefined || host === "127.0.0.1" || host === "localhost" || host === "::1";',
    "}",
    "const originalNetConnect = net.connect;",
    'net.connect = function (...args) { return loopback(args) ? Reflect.apply(originalNetConnect, this, args) : blocked("net.connect"); };',
    "net.createConnection = net.connect;",
    "const originalSocketConnect = net.Socket.prototype.connect;",
    "net.Socket.prototype.connect = function (...args) {",
    '  return loopback(args) ? Reflect.apply(originalSocketConnect, this, args) : blocked("socket.connect");',
    "};",
    "const originalTlsConnect = tls.connect;",
    'tls.connect = function (...args) { return loopback(args) ? Reflect.apply(originalTlsConnect, this, args) : blocked("tls.connect"); };',
    'globalThis.fetch = async function () { blocked("fetch"); };',
    'if (typeof globalThis.WebSocket === "function") {',
    '  globalThis.WebSocket = class OfflineSmokeBlockedWebSocket { constructor() { blocked("websocket"); } };',
    "}",
    'record("hook-loaded");',
    "",
  ].join("\n")
}

const electronBinary = await resolveElectronBinary()
await fs.access(await resolveDesktopMainEntry()).catch(() => {
  throw new SmokeDefect("Desktop output is missing; run bun --cwd packages/desktop build before the smoke")
})

const builtRendererUrl = pathToFileURL(path.join(desktopRoot, "out", "renderer", "index.html")).href
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-offline-process-restart-"))
const projectRootCandidate = path.join(temporaryRoot, "offline-restart-project")
const userDataRoot = path.join(temporaryRoot, "user-data")
const networkGuardPath = path.join(temporaryRoot, "offline-network-guard.cjs")
const networkLogPath = path.join(temporaryRoot, "offline-network.log")
await Promise.all([
  fs.mkdir(projectRootCandidate),
  fs.mkdir(userDataRoot),
  fs.writeFile(networkGuardPath, networkGuardSource()),
])
const projectRoot = await fs.realpath(projectRootCandidate)
await fs.writeFile(
  path.join(userDataRoot, "default-capabilities.json"),
  JSON.stringify({ plugins: ["ffmpeg-tools"], schema: "convax.default-capabilities/1", skills: [] }, null, 2) + "\n",
)

const offlineProxy = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket) {
      socket.end()
    },
  },
})

async function launchElectron(label: string): Promise<ElectronInstance> {
  const rendererPortReservation = reservePort()
  const inspectorPortReservation = reservePort()
  const rendererPort = rendererPortReservation.port
  const inspectorPort = inspectorPortReservation.port
  rendererPortReservation.stop(true)
  inspectorPortReservation.stop(true)

  const environment: Record<string, string | undefined> = { ...process.env }
  delete environment.ELECTRON_RENDERER_URL
  environment.ALL_PROXY = "http://127.0.0.1:" + offlineProxy.port
  environment.HTTPS_PROXY = environment.ALL_PROXY
  environment.HTTP_PROXY = environment.ALL_PROXY
  environment.NO_PROXY = "127.0.0.1,localhost,::1"
  environment.CONVAX_ALLOW_MULTIPLE_INSTANCES = "1"
  environment.CONVAX_USER_DATA_DIR = userDataRoot
  environment.CONVAX_OFFLINE_SMOKE_NETWORK_LOG = networkLogPath
  environment.CONVAX_COLLABORATION_CONTROL_RUNTIME = JSON.stringify({
    format: "convax.desktop-collaboration-control-runtime/1",
    keys: [
      {
        purpose: "membership",
        publicKey: Buffer.alloc(32, 1).toString("base64url"),
        serviceKeyId: "offline-membership",
      },
      {
        purpose: "rendezvous",
        publicKey: Buffer.alloc(32, 2).toString("base64url"),
        serviceKeyId: "offline-rendezvous",
      },
    ],
    serviceBaseUrl: "https://control.offline.invalid",
    trustBundleDigest: "a".repeat(64),
  })
  environment.NODE_OPTIONS = "--require=" + networkGuardPath

  const child = Bun.spawn(
    [
      electronBinary,
      ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "--proxy-bypass-list=<-loopback>",
      "--proxy-server=http://127.0.0.1:" + offlineProxy.port,
      "--remote-debugging-address=127.0.0.1",
      "--inspect=" + inspectorPort,
      "--remote-debugging-port=" + rendererPort,
      desktopRoot,
    ],
    {
      cwd: repositoryRoot,
      env: environment,
      stderr: "pipe",
      stdout: "pipe",
    },
  )
  const stdout = collectOutput(child.stdout)
  const stderr = collectOutput(child.stderr)

  try {
    const [mainDebugger, rendererDebugger] = await Promise.all([
      waitForTarget(inspectorPort, () => true, child),
      waitForTarget(rendererPort, (target) => target.type === "page" && target.url === builtRendererUrl, child),
    ])
    const mainInfo = (await evaluate(
      mainDebugger,
      "(" +
        configureMain.toString() +
        ")(" +
        JSON.stringify({
          electronRequireBase: path.join(desktopRoot, "package.json"),
          projectRoot,
        }) +
        ")",
    )) as { pid?: number; userData?: string }
    if (mainInfo.pid !== child.pid) {
      throw new SmokeDefect(label + " debugger PID did not match the spawned Electron Main PID")
    }
    if (mainInfo.userData !== userDataRoot) {
      throw new SmokeDefect(label + " did not use the requested persistent userData root")
    }
    const networkLog = await fs.readFile(networkLogPath, "utf8").catch(() => "")
    if (!networkLog.includes("\t" + mainInfo.pid + "\thook-loaded\n")) {
      throw new SmokeDefect(label + " Main process did not load the offline network guard before startup")
    }

    const probeUrl = new URL(externalProbeUrl)
    probeUrl.searchParams.set("launch", label)
    probeUrl.searchParams.set("pid", String(mainInfo.pid))
    probeUrl.searchParams.set("nonce", randomUUID())
    const launchProbeUrl = probeUrl.href

    const mainOffline = (await evaluate(
      mainDebugger,
      "(" + mainOfflineProbe.toString() + ")(" + JSON.stringify(launchProbeUrl) + ")",
      15_000,
    )) as {
      failed?: boolean
      message?: string
    }
    if (mainOffline.failed !== true || !mainOffline.message?.includes("CONVAX_OFFLINE_SMOKE_NETWORK_BLOCKED")) {
      throw new SmokeDefect(label + " Main external-network control did not fail through the offline guard")
    }

    const rendererOffline = await verifyRendererExternalNetworkBlocked(rendererDebugger, launchProbeUrl)
    if (
      rendererOffline.failed !== true ||
      rendererOffline.timedOut ||
      !rendererOffline.requestObserved ||
      !rendererOffline.failureInjected
    ) {
      throw new SmokeDefect(
        label +
          " Renderer external-network control did not observe and reject the exact request: " +
          JSON.stringify(rendererOffline),
      )
    }

    return {
      child,
      inspectorPort,
      label,
      mainDebugger,
      mainPid: mainInfo.pid,
      rendererDebugger,
      rendererPort,
      stderr,
      stdout,
    }
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited.catch(() => undefined)
    const failed: ElectronInstance = {
      child,
      inspectorPort,
      label,
      mainDebugger: "",
      mainPid: child.pid,
      rendererDebugger: "",
      rendererPort,
      stderr,
      stdout,
    }
    await printInstanceOutput(failed)
    throw error
  }
}

let completed = false
let current: ElectronInstance | undefined
try {
  current = await launchElectron("first launch")
  const firstPid = current.mainPid
  const first = (await runProductPhase(current, {
    phase: "mutate",
    projectName: path.basename(projectRoot),
    projectRoot,
    timeoutMs,
  })) as RestartOracle & { team?: unknown }
  if (!first.projectId || !first.canvasId || !first.keepNodeId || !first.deletedNodeId) {
    throw new SmokeDefect("The first phase returned an incomplete outer-process restart oracle")
  }
  await hardTerminateElectron(current)
  current = undefined
  await eraseBrowserStorage(userDataRoot)

  current = await launchElectron("second launch")
  const secondPid = current.mainPid
  await runProductPhase(current, {
    expected: first,
    phase: "verify-and-delete",
    projectName: path.basename(projectRoot),
    projectRoot,
    timeoutMs,
  })
  await hardTerminateElectron(current)
  current = undefined
  await eraseBrowserStorage(userDataRoot)

  current = await launchElectron("third launch")
  const thirdPid = current.mainPid
  await runProductPhase(current, {
    expected: first,
    phase: "verify-empty",
    projectName: path.basename(projectRoot),
    projectRoot,
    timeoutMs,
  })
  if (new Set([firstPid, secondPid, thirdPid]).size !== 3) {
    throw new SmokeDefect("The three acceptance phases did not run in three distinct Electron Main processes")
  }
  await hardTerminateElectron(current)
  current = undefined

  console.log(
    "Desktop offline whole-process restart smoke passed: same userData/Project/Canvas, exact A geometry, " +
      "B deletion, final empty Canvas, three distinct Main PIDs, local-only Team state, zero peers, " +
      "and rejected Main/Renderer external network (" +
      first.projectId +
      ", " +
      first.canvasId +
      "; PIDs: first=" +
      firstPid +
      ", second=" +
      secondPid +
      ", third=" +
      thirdPid +
      ")",
  )
  completed = true
} catch (error) {
  const classification = error instanceof ProductDefect ? "product-defect" : "smoke-defect"
  console.error("[" + classification + "] " + String(error))
  console.error("Offline restart evidence was preserved at " + temporaryRoot)
  throw error
} finally {
  if (current) {
    if (current.child.exitCode === null) current.child.kill("SIGKILL")
    await current.child.exited.catch(() => undefined)
  }
  offlineProxy.stop(true)
  if (completed) await fs.rm(temporaryRoot, { force: true, recursive: true })
}
