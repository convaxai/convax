import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const desktopRoot = path.join(repositoryRoot, "packages", "desktop")
const panoramaFixturePath = path.join(
  repositoryRoot,
  "scripts",
  "fixtures",
  "panorama",
  "red-walk-highwoods-1280x640.jpg",
)
const panoramaFixtureSha256 = "1b35db0f48d6ba207b3d94ec012fee0d277106472396754790a2152225ad25fc"
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
const panoramaFixture = await fs.readFile(panoramaFixturePath)
if (panoramaFixture.byteLength < 100_000 || panoramaFixture.byteLength > 16 * 1024 * 1024
  || panoramaFixture[0] !== 0xff || panoramaFixture[1] !== 0xd8 || panoramaFixture[2] !== 0xff) {
  throw new Error(`Panorama smoke fixture is not the expected photographic JPEG: ${panoramaFixturePath}`)
}
const panoramaFixtureHash = createHash("sha256").update(panoramaFixture).digest("hex")
if (panoramaFixtureHash !== panoramaFixtureSha256) {
  throw new Error(`Panorama smoke fixture checksum changed: ${panoramaFixtureHash}`)
}
const panoramaFixtureDataUrl = `data:image/jpeg;base64,${panoramaFixture.toString("base64")}`

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

  const panoramaSeed = await evaluateStable(rendererDebugger, `(async () => {
    const deadline = Date.now() + ${timeoutMs}
    const waitFor = async (read, label) => {
      while (Date.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("Timed out waiting for " + label)
    }
    const projectId = ${JSON.stringify(summary.projectId)}
    const selectedCanvasId = ${JSON.stringify(summary.activeCanvasId)}
    if (!projectId || !selectedCanvasId) throw new Error("Panorama smoke lost the active scope")

    const plugins = await window.convax.plugins.listPlugins()
    const panorama = plugins.catalog.find((plugin) => plugin.id === "panorama-viewer")
    if (!panorama) throw new Error("Panorama Viewer is missing from the built-in catalog")
    if (!panorama.installed) await window.convax.plugins.installCatalogPlugin({ id: panorama.id })
    await waitFor(async () => {
      const current = await window.convax.plugins.listPlugins()
      return current.installed.some((plugin) => plugin.id === panorama.id)
    }, "Panorama Viewer installation")

    const canvasPane = await waitFor(
      () => document.querySelector(".convax-canvas .react-flow__pane"),
      "the Canvas pane for Panorama Viewer",
    )
    const paneBounds = canvasPane.getBoundingClientRect()
    canvasPane.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: paneBounds.left + paneBounds.width * 0.72,
      clientY: paneBounds.top + paneBounds.height * 0.58,
    }))
    await waitFor(
      () => document.querySelector('[data-slot="context-menu-content"]'),
      "the Panorama Canvas context menu",
    )
    const addPanorama = await waitFor(
      () => [...document.querySelectorAll('[data-slot="context-menu-item"]')]
        .find((item) => item.textContent?.includes("Panorama Viewer")),
      "Panorama Viewer in the Canvas context menu",
    )
    addPanorama.click()
    await waitFor(
      () => document.querySelector('iframe[title="Panorama Viewer plugin"]'),
      "the Panorama Viewer frame",
    )

    const snapshot = await waitFor(async () => {
      const loaded = await window.convax.canvas.documents.load({
        canvasId: selectedCanvasId,
        scopeId: projectId,
      })
      const pluginNode = loaded.document?.nodes.find(
        (node) => node.data.kind === "plugin.panorama-viewer",
      )
      return pluginNode ? { loaded, pluginNode } : null
    }, "the persisted Panorama Viewer node")
    const sourceNodeId = "smoke-panorama-source"
    const edgeId = "smoke-panorama-edge"
    const dataUrl = ${JSON.stringify(panoramaFixtureDataUrl)}
    const sourceImage = new Image()
    await new Promise((resolve, reject) => {
      sourceImage.addEventListener("load", resolve, { once: true })
      sourceImage.addEventListener("error", () => reject(new Error("Could not decode the real Panorama smoke JPEG")), {
        once: true,
      })
      sourceImage.src = dataUrl
    })
    if (sourceImage.naturalWidth !== 1280 || sourceImage.naturalHeight !== 640) {
      throw new Error(
        "Unexpected real Panorama smoke dimensions: "
        + String(sourceImage.naturalWidth) + "x" + String(sourceImage.naturalHeight),
      )
    }
    const current = snapshot.loaded.document
    if (!current) throw new Error("Canvas document disappeared before Panorama seeding")
    await window.convax.canvas.documents.save({
      document: {
        ...current,
        revision: current.revision + 1,
        nodes: [
          ...current.nodes,
          {
            data: {
              fit: "contain",
              height: sourceImage.naturalHeight,
              kind: "image",
              label: "Real CC0 360° Panorama · Highwoods, Bexhill",
              mimeType: "image/jpeg",
              name: "red-walk-highwoods-1280x640.jpg",
              url: dataUrl,
              width: sourceImage.naturalWidth,
            },
            id: sourceNodeId,
            position: {
              x: snapshot.pluginNode.position.x - 420,
              y: snapshot.pluginNode.position.y,
            },
            style: { height: 180, width: 320 },
            type: "file",
          },
        ],
        edges: [
          ...current.edges,
          {
            id: edgeId,
            source: sourceNodeId,
            sourceHandle: "source-right",
            target: snapshot.pluginNode.id,
            targetHandle: "target-left",
            type: "canvas",
          },
        ],
      },
      expectedStorageVersion: snapshot.loaded.storageVersion,
      ref: { canvasId: selectedCanvasId, scopeId: projectId },
    })
    return {
      panoramaNodeId: snapshot.pluginNode.id,
      projectId,
      selectedCanvasId,
      sourceNodeId,
    }
  })()`)
  const seed = panoramaSeed as {
    panoramaNodeId?: string
    projectId?: string
    selectedCanvasId?: string
    sourceNodeId?: string
  }
  if (!seed.panoramaNodeId || !seed.projectId || !seed.selectedCanvasId || !seed.sourceNodeId) {
    throw new Error(`Unexpected Panorama seed result: ${JSON.stringify(seed)}`)
  }

  await evaluateStable(rendererDebugger, `(() => {
    window.setTimeout(() => window.location.reload(), 0)
    return true
  })()`)
  await Bun.sleep(300)
  const reloadedRendererDebugger = await waitForTarget(
    rendererPort,
    (target) => target.type === "page" && target.url === builtRendererUrl,
  )
  const panoramaResult = await evaluateStable(reloadedRendererDebugger, `(async () => {
    const deadline = Date.now() + ${timeoutMs}
    const waitFor = async (read, label) => {
      while (Date.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("Timed out waiting for " + label)
    }
    while (!window.convax) {
      if (Date.now() >= deadline) throw new Error("The preload bridge did not recover after reload")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const projectId = ${JSON.stringify(seed.projectId)}
    const selectedCanvasId = ${JSON.stringify(seed.selectedCanvasId)}
    const sourceNodeId = ${JSON.stringify(seed.sourceNodeId)}
    const pluginFrame = await waitFor(
      () => document.querySelector('iframe[title="Panorama Viewer plugin"][src^="convax-plugin://panorama-viewer/"]'),
      "the reloaded Panorama Viewer frame",
    )
    const saved = await waitFor(async () => {
      const loaded = await window.convax.canvas.documents.load({
        canvasId: selectedCanvasId,
        scopeId: projectId,
      })
      const node = loaded.document?.nodes.find(
        (candidate) => candidate.data.kind === "plugin.panorama-viewer",
      )
      const state = node?.data.metadata?.convaxPluginState
      return state?.schemaVersion === 1 && state.selectedSourceNodeId === sourceNodeId
        ? { node, state }
        : null
    }, "Panorama image decode, WebGL upload, and state writeback")
    return {
      frameAllow: pluginFrame.getAttribute("allow"),
      frameAllowFullscreen: pluginFrame.hasAttribute("allowfullscreen"),
      frameSandbox: pluginFrame.getAttribute("sandbox"),
      frameUrl: pluginFrame.getAttribute("src"),
      panoramaNodeId: saved.node.id,
      selectedSourceNodeId: saved.state.selectedSourceNodeId,
      stateSchemaVersion: saved.state.schemaVersion,
    }
  })()`)
  const panoramaSummary = panoramaResult as {
    frameAllow?: string | null
    frameAllowFullscreen?: boolean
    frameSandbox?: string | null
    frameUrl?: string | null
    panoramaNodeId?: string
    selectedSourceNodeId?: string
    stateSchemaVersion?: number
  }
  if (panoramaSummary.frameSandbox !== "allow-scripts"
    || !panoramaSummary.frameAllow?.includes("fullscreen *")
    || panoramaSummary.frameAllowFullscreen !== true
    || !panoramaSummary.frameUrl?.startsWith("convax-plugin://panorama-viewer/")
    || panoramaSummary.panoramaNodeId !== seed.panoramaNodeId
    || panoramaSummary.selectedSourceNodeId !== seed.sourceNodeId
    || panoramaSummary.stateSchemaVersion !== 1) {
    throw new Error(`Unexpected Panorama Viewer result: ${JSON.stringify(panoramaSummary)}`)
  }
  const panoramaDocument = JSON.parse(await fs.readFile(
    path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"),
    "utf8",
  )) as {
    edges?: Array<{ id?: string; source?: string; target?: string }>
    nodes?: Array<{
      data?: {
        kind?: string
        metadata?: { convaxPluginState?: { schemaVersion?: number; selectedSourceNodeId?: string } }
      }
      id?: string
    }>
  }
  const persistedPanorama = panoramaDocument.nodes?.find((node) => node.id === seed.panoramaNodeId)
  if (persistedPanorama?.data?.kind !== "plugin.panorama-viewer"
    || persistedPanorama.data.metadata?.convaxPluginState?.schemaVersion !== 1
    || persistedPanorama.data.metadata?.convaxPluginState?.selectedSourceNodeId !== seed.sourceNodeId
    || !panoramaDocument.edges?.some((edge) => edge.id === "smoke-panorama-edge"
      && edge.source === seed.sourceNodeId
      && edge.target === seed.panoramaNodeId)) {
    throw new Error(`Unexpected persisted Panorama Canvas: ${JSON.stringify(panoramaDocument)}`)
  }
  console.log(`Desktop Settings, Open Project, 3D Plugin, and Panorama Viewer smoke passed (${summary.projectId}, canvas-main)`)
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
