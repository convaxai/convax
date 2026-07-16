import fs from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const desktopRoot = path.join(repositoryRoot, "packages", "desktop")
const timeoutMs = 15_000

const require = createRequire(path.join(desktopRoot, "package.json"))
const electronPackageRoot = path.dirname(require.resolve("electron/package.json"))

async function resolveElectronBinary() {
  const pathFile = path.join(electronPackageRoot, "path.txt")
  const relativeBinary = await fs.readFile(pathFile, "utf8").then((value) => value.trim()).catch(() => "")
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

function randomPort() {
  return 41_000 + Math.floor(Math.random() * 8_000)
}

async function waitForTarget(port: number, predicate: (target: DebugTarget) => boolean) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json() as DebugTarget[]
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
    }, timeoutMs)

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { awaitPromise: true, expression, returnByValue: true },
      }))
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
        return reject(new Error(
          message.result.exceptionDetails.exception?.description
          ?? message.result.exceptionDetails.text
          ?? "Debugger evaluation failed",
        ))
      }
      resolve(message.result?.result?.value)
    })
  })
}

async function evaluateStable(webSocketUrl: string, expression: string) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      return await evaluate(webSocketUrl, expression)
    } catch (error) {
      if (!String(error).includes("Execution context was destroyed") || Date.now() >= deadline) throw error
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

const rendererPort = randomPort()
let inspectorPort = randomPort()
while (inspectorPort === rendererPort) inspectorPort = randomPort()
const child = Bun.spawn([
  electronBinary,
  `--inspect=${inspectorPort}`,
  `--remote-debugging-port=${rendererPort}`,
  desktopRoot,
], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    CONVAX_ALLOW_MULTIPLE_INSTANCES: "1",
    CONVAX_USER_DATA_DIR: userDataRoot,
  },
  stderr: "pipe",
  stdout: "pipe",
})
const stderr = collectOutput(child.stderr)
const stdout = collectOutput(child.stdout)

try {
  const [mainDebugger, rendererDebugger] = await Promise.all([
    waitForTarget(inspectorPort, () => true),
    waitForTarget(rendererPort, (target) => target.type === "page" && target.url === builtRendererUrl),
  ])
  const electronRequireBase = path.join(desktopRoot, "package.json")
  await evaluateStable(mainDebugger, `(() => {
    const createRequire = process.getBuiltinModule("module").createRequire
    const electron = createRequire(${JSON.stringify(electronRequireBase)})("electron")
    electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(projectRoot)}] })
    return true
  })()`)

  const result = await evaluateStable(rendererDebugger, `(async () => {
    const deadline = Date.now() + ${timeoutMs}
    while (!window.convax) {
      if (Date.now() >= deadline) throw new Error("The preload bridge did not become ready")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const selection = await window.convax.projects.openProject()
    if (selection.canceled || !selection.project?.id) throw new Error("Open Project did not return a project")
    const projectId = selection.project.id
    const catalog = await window.convax.projects.canvases.getCanvasCatalog({ projectId })
    const selectedCanvasId = catalog.canvases[0]?.id
    if (!selectedCanvasId) throw new Error("Project did not create its default Canvas")
    const loaded = await window.convax.canvas.documents.load({
      canvasId: selectedCanvasId,
      scopeId: projectId,
    })
    return {
      activeCanvasId: selectedCanvasId,
      canvasCount: catalog.canvases.length,
      documentId: loaded.document?.id,
      projectId,
    }
  })()`)

  const summary = result as {
    activeCanvasId?: string
    canvasCount?: number
    documentId?: string
    projectId?: string
  }
  if (summary.activeCanvasId !== "canvas-main" || summary.canvasCount !== 1 || summary.documentId !== "canvas-main") {
    throw new Error(`Unexpected Open Project result: ${JSON.stringify(summary)}`)
  }
  const persistedDocument = JSON.parse(await fs.readFile(
    path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"),
    "utf8",
  )) as { edges?: unknown[]; id?: string; nodes?: unknown[] }
  if (persistedDocument.id !== "canvas-main" || persistedDocument.nodes?.length !== 0 || persistedDocument.edges?.length !== 0) {
    throw new Error(`Unexpected persisted Canvas: ${JSON.stringify(persistedDocument)}`)
  }
  console.log(`Desktop Open Project smoke passed (${summary.projectId}, canvas-main)`)
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
