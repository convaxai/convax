import fs from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const desktopRoot = path.join(repositoryRoot, "packages", "desktop")
const timeoutMs = 25_000
const evaluationTimeoutMs = timeoutMs + 10_000

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
    }, evaluationTimeoutMs)

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
    const waitFor = async (read, label) => {
      while (Date.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("Timed out waiting for " + label)
    }
    const buttonWithText = (text) => [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === text)
    const buttonContainingText = (text) => [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes(text))
    while (!window.convax) {
      if (Date.now() >= deadline) throw new Error("The preload bridge did not become ready")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await waitFor(() => buttonWithText("Open project"), "the empty Project surface")
    if (buttonWithText("Skill & Plugin") || buttonWithText("技能与插件")) {
      throw new Error("The empty Project surface exposed global capabilities")
    }
    const initialPlugins = await window.convax.plugins.listPlugins()
    const catalogPlugin = initialPlugins.catalog.find((plugin) => plugin.id === "storyai-3d-director-desk")
    if (!catalogPlugin || catalogPlugin.installed) throw new Error("The built-in Plugin catalog is invalid")

    const openProject = await waitFor(() => buttonWithText("Open project"), "the Open project action")
    openProject.click()
    const canvasElement = await waitFor(() => document.querySelector(".convax-canvas"), "the active Canvas")
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
    if (initialDocument.document?.nodes.length !== 0) throw new Error("A new Canvas was not empty")

    const applicationMenu = await waitFor(
      () => document.querySelector('button[aria-label="Open application menu"], button[aria-label="打开应用菜单"]'),
      "the local workspace application menu",
    )
    applicationMenu.click()
    const settingsAction = await waitFor(
      () => buttonContainingText("Settings") || buttonContainingText("设置"),
      "the Settings action",
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
    languageSelect.click()
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
    languageSelect.click()
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
    const storedLanguage = JSON.parse(localStorage.getItem("convax.desktop.app-language.v1") ?? "null")
    if (storedLanguage?.language !== "zh-CN") throw new Error("The global language preference was not persisted")
    const backToApp = await waitFor(() => buttonWithText("返回应用"), "the Settings return action")
    backToApp.click()
    await waitFor(() => !document.querySelector('[data-settings-view="true"]'), "Settings to close")

    await window.convax.plugins.installCatalogPlugin({ id: catalogPlugin.id })

    const canvasPane = await waitFor(
      () => document.querySelector(".convax-canvas .react-flow__pane"),
      "the Canvas pane",
    )
    const paneBounds = canvasPane.getBoundingClientRect()
    canvasPane.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: paneBounds.left + paneBounds.width / 2,
      clientY: paneBounds.top + paneBounds.height / 2,
    }))
    await waitFor(
      () => document.querySelector('[data-slot="context-menu-content"]'),
      "the Canvas context menu",
    )
    const addPlugin = await waitFor(
      () => [...document.querySelectorAll('[data-slot="context-menu-item"]')]
        .find((item) => item.textContent?.trim() === "Add 3D Director Desk"),
      "the installed Plugin in the Canvas context menu",
    ).catch(() => {
      const items = [...document.querySelectorAll('[data-slot="context-menu-item"]')]
        .map((item) => item.textContent?.trim())
      throw new Error("The Canvas context menu did not expose the installed Plugin: " + JSON.stringify(items))
    })
    addPlugin.click()
    const pluginFrame = await waitFor(
      () => document.querySelector('iframe[title="3D Director Desk plugin"]'),
      "the sandboxed Plugin frame",
    )

    const savedDocument = await waitFor(async () => {
      const loaded = await window.convax.canvas.documents.load({
        canvasId: selectedCanvasId,
        scopeId: projectId,
      })
      const pluginNode = loaded.document?.nodes.find(
        (node) => node.data.kind === "plugin.storyai-3d-director-desk",
      )
      const pluginState = pluginNode?.data.metadata?.convaxPluginState
      return pluginState?.schemaVersion === 1 && pluginState.directorProject?.version === 1
        ? loaded.document
        : null
    }, "the connected 3D Director Desk state")
    const pluginState = savedDocument.nodes[0]?.data.metadata?.convaxPluginState
    return {
      activeCanvasId: selectedCanvasId,
      canvasCount: catalog.canvases.length,
      documentId: savedDocument.id,
      frameSandbox: pluginFrame.getAttribute("sandbox"),
      frameUrl: pluginFrame.getAttribute("src"),
      language: document.documentElement.lang,
      pluginNodeKind: savedDocument.nodes[0]?.data.kind,
      pluginStateVersion: pluginState?.schemaVersion,
      projectId,
    }
  })()`)

  const summary = result as {
    activeCanvasId?: string
    canvasCount?: number
    documentId?: string
    frameSandbox?: string | null
    frameUrl?: string | null
    language?: string
    pluginNodeKind?: string
    pluginStateVersion?: number
    projectId?: string
  }
  if (summary.activeCanvasId !== "canvas-main"
    || summary.canvasCount !== 1
    || summary.documentId !== "canvas-main"
    || summary.frameSandbox !== "allow-scripts"
    || !summary.frameUrl?.startsWith("convax-plugin://storyai-3d-director-desk/")
    || summary.language !== "zh-CN"
    || summary.pluginNodeKind !== "plugin.storyai-3d-director-desk"
    || summary.pluginStateVersion !== 1) {
    throw new Error(`Unexpected Open Project result: ${JSON.stringify(summary)}`)
  }
  const persistedDocument = JSON.parse(await fs.readFile(
    path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"),
    "utf8",
  )) as {
    edges?: unknown[]
    id?: string
    nodes?: Array<{
      data?: {
        kind?: string
        metadata?: { convaxPluginState?: { directorProject?: { version?: number }; schemaVersion?: number } }
      }
    }>
  }
  if (persistedDocument.id !== "canvas-main"
    || persistedDocument.nodes?.length !== 1
    || persistedDocument.nodes[0]?.data?.kind !== "plugin.storyai-3d-director-desk"
    || persistedDocument.nodes[0]?.data?.metadata?.convaxPluginState?.schemaVersion !== 1
    || persistedDocument.nodes[0]?.data?.metadata?.convaxPluginState?.directorProject?.version !== 1
    || persistedDocument.edges?.length !== 0) {
    throw new Error(`Unexpected persisted Canvas: ${JSON.stringify(persistedDocument)}`)
  }
  console.log(`Desktop Settings, Open Project, and Plugin smoke passed (${summary.projectId}, canvas-main)`)
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
