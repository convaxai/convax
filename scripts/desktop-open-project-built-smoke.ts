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

async function evaluatePluginFrame(mainDebugger: string, pluginId: string, expression: string) {
  const electronRequireBase = path.join(desktopRoot, "package.json")
  return evaluateStable(
    mainDebugger,
    `(async () => {
    const createRequire = process.getBuiltinModule("module").createRequire
    const electron = createRequire(${JSON.stringify(electronRequireBase)})("electron")
    const deadline = Date.now() + ${timeoutMs}
    while (Date.now() < deadline) {
      const frame = electron.BrowserWindow.getAllWindows()
        .filter((candidate) => !candidate.isDestroyed())
        .flatMap((candidate) => candidate.webContents.mainFrame.framesInSubtree)
        .find((candidate) => !candidate.detached
          && candidate.url.startsWith(${JSON.stringify(`convax-plugin://${pluginId}/`)}))
      if (frame) return frame.executeJavaScript(${JSON.stringify(expression)}, true)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(${JSON.stringify(`Timed out waiting for ${pluginId} WebFrameMain`)})
  })()`,
  )
}

async function evaluatePluginFrames(mainDebugger: string, pluginId: string, expression: string, expectedCount = 1) {
  const electronRequireBase = path.join(desktopRoot, "package.json")
  return evaluateStable(
    mainDebugger,
    `(async () => {
    const createRequire = process.getBuiltinModule("module").createRequire
    const electron = createRequire(${JSON.stringify(electronRequireBase)})("electron")
    const deadline = Date.now() + ${timeoutMs}
    while (Date.now() < deadline) {
      const frames = electron.BrowserWindow.getAllWindows()
        .filter((candidate) => !candidate.isDestroyed())
        .flatMap((candidate) => candidate.webContents.mainFrame.framesInSubtree)
        .filter((candidate) => !candidate.detached
          && candidate.url.startsWith(${JSON.stringify(`convax-plugin://${pluginId}/`)}))
      if (frames.length >= ${expectedCount}) {
        return Promise.all(frames.map((frame) => frame.executeJavaScript(${JSON.stringify(expression)}, true)))
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(${JSON.stringify(`Timed out waiting for ${pluginId} WebFrameMain instances`)})
  })()`,
  )
}

async function sendPluginMouseInput(mainDebugger: string, pluginId: string, events: Array<Record<string, unknown>>) {
  const electronRequireBase = path.join(desktopRoot, "package.json")
  return evaluateStable(
    mainDebugger,
    `(async () => {
    const createRequire = process.getBuiltinModule("module").createRequire
    const electron = createRequire(${JSON.stringify(electronRequireBase)})("electron")
    const target = electron.BrowserWindow.getAllWindows()
      .filter((candidate) => !candidate.isDestroyed())
      .find((candidate) => candidate.webContents.mainFrame.framesInSubtree.some(
        (frame) => !frame.detached
          && frame.url.startsWith(${JSON.stringify(`convax-plugin://${pluginId}/`)}),
    ))
    if (!target) throw new Error(${JSON.stringify(`Could not find the ${pluginId} BrowserWindow`)})
    target.focus()
    target.webContents.focus()
    for (const event of ${JSON.stringify(events)}) {
      target.webContents.sendInputEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 35))
    }
    return true
  })()`,
  )
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
if (
  panoramaFixture.byteLength < 100_000 ||
  panoramaFixture.byteLength > 16 * 1024 * 1024 ||
  panoramaFixture[0] !== 0xff ||
  panoramaFixture[1] !== 0xd8 ||
  panoramaFixture[2] !== 0xff
) {
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
const seededDirectorPluginRoot = path.join(userDataRoot, "plugins", "storyai-3d-director-desk")
await fs.mkdir(path.dirname(seededDirectorPluginRoot), { recursive: true })
await fs.cp(path.join(desktopRoot, "resources", "plugins", "storyai-3d-director-desk"), seededDirectorPluginRoot, {
  recursive: true,
})
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
    const buttonContainingText = (text) => [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes(text))
    const preloadDeadline = Date.now() + ${timeoutMs}
    while (!window.convax) {
      if (Date.now() >= preloadDeadline) throw new Error("The preload bridge did not become ready")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await waitFor(() => buttonWithText("Open project"), "the empty Project surface")
    if (buttonWithText("Skill & Plugin") || buttonWithText("技能与插件")) {
      throw new Error("The empty Project surface exposed global capabilities")
    }
    const initialPlugins = await window.convax.plugins.listPlugins()
    const catalogPlugin = initialPlugins.catalog.find((plugin) => plugin.id === "storyai-3d-director-desk")
    const installedDirector = initialPlugins.installed.find((plugin) => plugin.id === "storyai-3d-director-desk")
    if (!catalogPlugin
      || !catalogPlugin.installed
      || catalogPlugin.installedVersion !== "0.0.1-convax.2"
      || catalogPlugin.version !== "0.0.1-convax.2"
      || catalogPlugin.updateAvailable
      || installedDirector?.trustedBuiltin !== true) {
      throw new Error("The exact legacy-marker-free built-in Plugin was not claimed at startup")
    }

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
    const directorPluginCard = await waitFor(
      () => [...document.querySelectorAll("article")]
        .find((article) => article.textContent?.includes("3D Director Desk")),
      "the installed 3D Director Plugin card",
    ).catch(() => {
      throw new Error("The Plugin management surface did not render the built-in catalog: " + document.body.innerText)
    })
    if (
      [...directorPluginCard.querySelectorAll("button")].some((button) => button.textContent?.includes("更新插件"))
    ) {
      throw new Error("The claimed current 3D Director Plugin incorrectly offered an update")
    }
    const storedLanguage = JSON.parse(localStorage.getItem("convax.desktop.app-language.v1") ?? "null")
    if (storedLanguage?.language !== "zh-CN") throw new Error("The global language preference was not persisted")
    const backToApp = await waitFor(() => buttonWithText("返回应用"), "the Settings return action")
    backToApp.click()
    await waitFor(() => !document.querySelector('[data-settings-view="true"]'), "Settings to close")

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
      return pluginState?.schemaVersion === 2
        && pluginState.directorProject?.version === 1
        && pluginState.presentation?.viewport?.directorView
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
      pluginNodeId: savedDocument.nodes[0]?.id,
      pluginStateVersion: pluginState?.schemaVersion,
      projectId,
    }
  })()`,
  )

  const summary = result as {
    activeCanvasId?: string
    canvasCount?: number
    documentId?: string
    frameSandbox?: string | null
    frameUrl?: string | null
    language?: string
    pluginNodeKind?: string
    pluginNodeId?: string
    pluginStateVersion?: number
    projectId?: string
  }
  if (
    summary.activeCanvasId !== "canvas-main" ||
    summary.canvasCount !== 1 ||
    summary.documentId !== "canvas-main" ||
    summary.frameSandbox !== "allow-scripts" ||
    !summary.frameUrl?.startsWith("convax-plugin://storyai-3d-director-desk/") ||
    summary.language !== "zh-CN" ||
    summary.pluginNodeKind !== "plugin.storyai-3d-director-desk" ||
    !summary.pluginNodeId ||
    summary.pluginStateVersion !== 2
  ) {
    throw new Error(`Unexpected Open Project result: ${JSON.stringify(summary)}`)
  }

  const directorFrameGeometry = (await evaluatePluginFrame(
    mainDebugger,
    "storyai-3d-director-desk",
    `(() => {
      const canvas = document.querySelector("canvas")
      if (!canvas) throw new Error("The 3D Director WebGL canvas is missing")
      const bounds = canvas.getBoundingClientRect()
      const sampleX = bounds.left + bounds.width * 0.54
      const sampleY = bounds.top + bounds.height * 0.72
      const hit = document.elementFromPoint(sampleX, sampleY)
      return {
        canvas: { height: bounds.height, left: bounds.left, top: bounds.top, width: bounds.width },
        hit: hit ? hit.tagName + "." + String(hit.className ?? "") : null,
        signature: [...document.querySelectorAll(".viewport-gizmo-hit-button")]
          .map((button) => [
            button.getAttribute("aria-label"),
            button.style.left,
            button.style.top,
            button.style.zIndex,
          ]),
        viewport: { height: window.innerHeight, width: window.innerWidth },
      }
    })()`,
  )) as {
    canvas?: { height?: number; left?: number; top?: number; width?: number }
    hit?: string | null
    signature?: string[][]
    viewport?: { height?: number; width?: number }
  }
  const directorOuterGeometry = (await evaluateStable(
    rendererDebugger,
    `(() => {
      const frame = document.querySelector('iframe[title="3D Director Desk plugin"]')
      if (!frame) throw new Error("The outer 3D Director frame is missing")
      const bounds = frame.getBoundingClientRect()
      return { height: bounds.height, left: bounds.left, top: bounds.top, width: bounds.width }
    })()`,
  )) as { height?: number; left?: number; top?: number; width?: number }
  const canvasHeight = Number(directorFrameGeometry.canvas?.height)
  const canvasLeft = Number(directorFrameGeometry.canvas?.left)
  const canvasTop = Number(directorFrameGeometry.canvas?.top)
  const canvasWidth = Number(directorFrameGeometry.canvas?.width)
  const frameViewportHeight = Number(directorFrameGeometry.viewport?.height)
  const frameViewportWidth = Number(directorFrameGeometry.viewport?.width)
  const outerHeight = Number(directorOuterGeometry.height)
  const outerLeft = Number(directorOuterGeometry.left)
  const outerTop = Number(directorOuterGeometry.top)
  const outerWidth = Number(directorOuterGeometry.width)
  const dimensionValues = [canvasHeight, canvasWidth, frameViewportHeight, frameViewportWidth, outerHeight, outerWidth]
  const coordinateValues = [canvasLeft, canvasTop, outerLeft, outerTop]
  if (
    dimensionValues.some((value) => !Number.isFinite(value) || value <= 0) ||
    coordinateValues.some((value) => !Number.isFinite(value)) ||
    !directorFrameGeometry.signature?.length
  ) {
    throw new Error(
      `Unexpected 3D Director frame geometry: ${JSON.stringify({ directorFrameGeometry, directorOuterGeometry })}`,
    )
  }
  const projectIntoOuterFrame = (localX: number, localY: number) => ({
    x: Math.round(outerLeft + (localX / frameViewportWidth) * outerWidth),
    y: Math.round(outerTop + (localY / frameViewportHeight) * outerHeight),
  })
  const orbitStart = projectIntoOuterFrame(canvasLeft + canvasWidth * 0.54, canvasTop + canvasHeight * 0.72)
  await sendPluginMouseInput(mainDebugger, "storyai-3d-director-desk", [
    { button: "left", clickCount: 1, type: "mouseDown", ...orbitStart },
    { button: "left", clickCount: 1, type: "mouseUp", ...orbitStart },
  ])
  await Bun.sleep(150)
  const focusedPluginInteraction = (await evaluateStable(
    rendererDebugger,
    `(() => {
      const frame = document.querySelector('iframe[title="3D Director Desk plugin"]')
      const node = frame?.closest(".react-flow__node")
      return frame ? {
        activeElement: document.activeElement?.tagName,
        dragging: node?.classList.contains("dragging"),
        pointerEvents: getComputedStyle(frame).pointerEvents,
        selected: node?.classList.contains("selected"),
        tabIndex: frame.tabIndex,
      } : null
    })()`,
  )) as {
    activeElement?: string
    dragging?: boolean
    pointerEvents?: string
    selected?: boolean
    tabIndex?: number
  } | null
  if (
    !focusedPluginInteraction?.selected ||
    focusedPluginInteraction.dragging ||
    focusedPluginInteraction.pointerEvents !== "auto" ||
    focusedPluginInteraction.tabIndex !== 0
  ) {
    throw new Error(
      `The 3D Plugin did not become interactive after pointer release: ${JSON.stringify({
        directorFrameGeometry,
        directorOuterGeometry,
        focusedPluginInteraction,
        orbitStart,
      })}`,
    )
  }
  const orbitSignature = (await evaluatePluginFrame(
    mainDebugger,
    "storyai-3d-director-desk",
    `(async () => {
      const canvas = document.querySelector("canvas")
      if (!canvas) throw new Error("The 3D Director WebGL canvas is missing")
      const bounds = canvas.getBoundingClientRect()
      const dispatch = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons,
        cancelable: true,
        clientX: x,
        clientY: y,
        isPrimary: true,
        pointerId: 7,
        pointerType: "mouse",
      }))
      const start = { x: bounds.left + bounds.width * 0.54, y: bounds.top + bounds.height * 0.72 }
      const middle = { x: bounds.left + bounds.width * 0.61, y: bounds.top + bounds.height * 0.68 }
      const end = { x: bounds.left + bounds.width * 0.68, y: bounds.top + bounds.height * 0.64 }
      dispatch("pointerdown", start.x, start.y, 1)
      dispatch("pointermove", middle.x, middle.y, 1)
      dispatch("pointermove", end.x, end.y, 1)
      dispatch("pointerup", end.x, end.y, 0)
      const deadline = Date.now() + ${timeoutMs}
      const defaultSignature = ${JSON.stringify(JSON.stringify(directorFrameGeometry.signature))}
      let previousSignature = defaultSignature
      let stableSamples = 0
      while (Date.now() < deadline) {
        const signature = [...document.querySelectorAll(".viewport-gizmo-hit-button")]
          .map((button) => [
            button.getAttribute("aria-label"),
            button.style.left,
            button.style.top,
            button.style.zIndex,
          ])
        const serialized = JSON.stringify(signature)
        if (serialized !== defaultSignature) {
          stableSamples = serialized === previousSignature ? stableSamples + 1 : 0
          if (stableSamples >= 8) return signature
        }
        previousSignature = serialized
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("Timed out waiting for the OrbitControls pointer gesture")
    })()`,
  )) as string[][]
  if (!orbitSignature.length) throw new Error("The OrbitControls pointer gesture did not change the director view")

  const directorInteraction = (await evaluatePluginFrame(
    mainDebugger,
    "storyai-3d-director-desk",
    `(async () => {
      const waitFor = async (read, label) => {
        const deadline = Date.now() + ${timeoutMs}
        while (Date.now() < deadline) {
          const value = read()
          if (value) return value
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error("Timed out waiting for " + label)
      }
      const signature = ${JSON.stringify(orbitSignature)}
      const role = await waitFor(
        () => [...document.querySelectorAll('[role="treeitem"]')]
          .find((item) => item.getAttribute("aria-label") === "角色01"),
        "the default director role",
      )
      role.click()
      const rotationHandle = await waitFor(
        () => document.querySelector('button[aria-label="角色旋转 Y 拖动调整"]'),
        "the role rotation drag handle",
      )
      rotationHandle.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        cancelable: true,
        clientX: 100,
      }))
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        buttons: 1,
        cancelable: true,
        clientX: 130,
      }))
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        buttons: 0,
        cancelable: true,
        clientX: 130,
      }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return waitFor(() => {
        const rotation = document.querySelector('input[aria-label="角色旋转 Y"]')
        const rotationY = Number(rotation?.value)
        return Number.isFinite(rotationY)
          && rotationY !== 0
          ? { rotationY, signature }
          : null
      }, "the visible role rotation change")
    })()`,
  )) as { rotationY?: number; signature?: string[][] }
  if (!Number.isFinite(directorInteraction.rotationY) || !directorInteraction.signature?.length) {
    throw new Error(`Unexpected 3D Director interaction: ${JSON.stringify(directorInteraction)}`)
  }

  const savedDirectorState = (await evaluateStable(
    rendererDebugger,
    `(async () => {
    const deadline = Date.now() + ${timeoutMs}
    while (Date.now() < deadline) {
      const loaded = await window.convax.canvas.documents.load({
        canvasId: ${JSON.stringify(summary.activeCanvasId)},
        scopeId: ${JSON.stringify(summary.projectId)},
      })
      const node = loaded.document?.nodes.find((candidate) => candidate.id === ${JSON.stringify(summary.pluginNodeId)})
      const state = node?.data.metadata?.convaxPluginState
      const role = state?.directorProject?.objects?.find((candidate) => candidate.id === "char_default_a")
      const rotationY = role?.transform?.rotation?.[1]
      const directorView = state?.presentation?.viewport?.directorView
      if (state?.schemaVersion === 2 && Number.isFinite(rotationY) && rotationY !== 0 && directorView) {
        return {
          directorView,
          identityVersion: node.data.metadata?.convaxPlugin?.version,
          revision: loaded.document.revision,
          rotationY,
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error("Timed out waiting for edited 3D Director node state")
  })()`,
  )) as {
    directorView?: unknown
    identityVersion?: string
    revision?: number
    rotationY?: number
  }
  if (
    !Number.isFinite(savedDirectorState.rotationY) ||
    Math.abs(savedDirectorState.rotationY! - directorInteraction.rotationY!) > 0.000001 ||
    !savedDirectorState.directorView ||
    savedDirectorState.identityVersion !== "0.0.1-convax.2"
  ) {
    throw new Error(`Unexpected saved 3D Director state: ${JSON.stringify(savedDirectorState)}`)
  }

  const persistedDocument = JSON.parse(
    await fs.readFile(path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"), "utf8"),
  ) as {
    edges?: unknown[]
    id?: string
    nodes?: Array<{
      data?: {
        kind?: string
        metadata?: {
          convaxPlugin?: { version?: string }
          convaxPluginState?: {
            directorProject?: {
              objects?: Array<{ id?: string; transform?: { rotation?: number[] } }>
              version?: number
            }
            presentation?: { viewport?: { directorView?: unknown } }
            schemaVersion?: number
          }
        }
      }
    }>
  }
  const persistedDirectorState = persistedDocument.nodes?.[0]?.data?.metadata?.convaxPluginState
  const persistedRole = persistedDirectorState?.directorProject?.objects?.find(
    (object) => object.id === "char_default_a",
  )
  const persistedRotationY = persistedRole?.transform?.rotation?.[1]
  if (
    persistedDocument.id !== "canvas-main" ||
    persistedDocument.nodes?.length !== 1 ||
    persistedDocument.nodes[0]?.data?.kind !== "plugin.storyai-3d-director-desk" ||
    persistedDocument.nodes[0]?.data?.metadata?.convaxPluginState?.schemaVersion !== 2 ||
    persistedDocument.nodes[0]?.data?.metadata?.convaxPluginState?.directorProject?.version !== 1 ||
    !persistedDocument.nodes[0]?.data?.metadata?.convaxPluginState?.presentation?.viewport?.directorView ||
    !Number.isFinite(persistedRotationY) ||
    Math.abs(persistedRotationY! - directorInteraction.rotationY!) > 0.000001 ||
    JSON.stringify(persistedDirectorState?.presentation?.viewport?.directorView) !==
      JSON.stringify(savedDirectorState.directorView) ||
    persistedDocument.nodes[0]?.data?.metadata?.convaxPlugin?.version !== "0.0.1-convax.2" ||
    persistedDocument.edges?.length !== 0
  ) {
    throw new Error(`Unexpected persisted Canvas: ${JSON.stringify(persistedDocument)}`)
  }

  // Match the recorded failure: finish an Orbit gesture and click the host-owned
  // Duplicate action immediately, without polling for persistence first.
  const duplicateViewSignature = (await evaluatePluginFrame(
    mainDebugger,
    "storyai-3d-director-desk",
    `(async () => {
      const canvas = document.querySelector("canvas")
      if (!canvas) throw new Error("The 3D Director WebGL canvas is missing")
      const bounds = canvas.getBoundingClientRect()
      const dispatch = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons,
        cancelable: true,
        clientX: x,
        clientY: y,
        isPrimary: true,
        pointerId: 11,
        pointerType: "mouse",
      }))
      const start = { x: bounds.left + bounds.width * 0.62, y: bounds.top + bounds.height * 0.62 }
      const middle = { x: bounds.left + bounds.width * 0.48, y: bounds.top + bounds.height * 0.66 }
      const end = { x: bounds.left + bounds.width * 0.39, y: bounds.top + bounds.height * 0.7 }
      dispatch("pointerdown", start.x, start.y, 1)
      dispatch("pointermove", middle.x, middle.y, 1)
      dispatch("pointermove", end.x, end.y, 1)
      dispatch("pointerup", end.x, end.y, 0)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return [...document.querySelectorAll(".viewport-gizmo-hit-button")]
        .map((button) => [
          button.getAttribute("aria-label"),
          button.style.left,
          button.style.top,
          button.style.zIndex,
        ])
    })()`,
  )) as string[][]
  if (!duplicateViewSignature.length) throw new Error("The final Orbit gesture did not expose a viewport signature")

  const duplicatedDirector = (await evaluateStable(
    rendererDebugger,
    `(async () => {
      const deadline = Date.now() + ${timeoutMs}
      const frame = document.querySelector('iframe[title="3D Director Desk plugin"]')
      if (!frame) throw new Error("The selected 3D Director frame is missing")
      const duplicate = [...document.querySelectorAll('button[aria-label="Duplicate"]')]
        .find((button) => button.getBoundingClientRect().width > 0)
      if (!duplicate) throw new Error("The selected 3D Director node has no Duplicate action")
      duplicate.click()
      const previousView = ${JSON.stringify(JSON.stringify(savedDirectorState.directorView))}
      while (Date.now() < deadline) {
        const loaded = await window.convax.canvas.documents.load({
          canvasId: ${JSON.stringify(summary.activeCanvasId)},
          scopeId: ${JSON.stringify(summary.projectId)},
        })
        const nodes = loaded.document?.nodes.filter(
          (candidate) => candidate.data.kind === "plugin.storyai-3d-director-desk",
        ) ?? []
        const original = nodes.find((candidate) => candidate.id === ${JSON.stringify(summary.pluginNodeId)})
        const copy = nodes.find((candidate) => candidate.id !== ${JSON.stringify(summary.pluginNodeId)})
        const originalState = original?.data.metadata?.convaxPluginState
        const copyState = copy?.data.metadata?.convaxPluginState
        const originalView = originalState?.presentation?.viewport?.directorView
        const copyView = copyState?.presentation?.viewport?.directorView
        if (nodes.length === 2
          && originalState?.schemaVersion === 2
          && copyState?.schemaVersion === 2
          && originalView
          && copyView
          && JSON.stringify(originalView) !== previousView
          && JSON.stringify(copyView) === JSON.stringify(originalView)
          && JSON.stringify(copyState.directorProject) === JSON.stringify(originalState.directorProject)) {
          return { copyNodeId: copy.id, directorView: originalView, nodeCount: nodes.length }
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("Immediate Duplicate did not clone the final 3D Director state")
    })()`,
  )) as { copyNodeId?: string; directorView?: unknown; nodeCount?: number }
  if (!duplicatedDirector.copyNodeId || !duplicatedDirector.directorView || duplicatedDirector.nodeCount !== 2) {
    throw new Error(`Unexpected duplicated 3D Director state: ${JSON.stringify(duplicatedDirector)}`)
  }

  const panoramaSeed = await evaluateStable(
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
    await waitFor(
      () => {
        const menu = document.querySelector('[data-slot="context-menu-content"]')
        if (menu) return menu
        canvasPane.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: paneBounds.left + paneBounds.width * 0.72,
          clientY: paneBounds.top + paneBounds.height * 0.58,
        }))
        return null
      },
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
  })()`,
  )
  const seed = panoramaSeed as {
    panoramaNodeId?: string
    projectId?: string
    selectedCanvasId?: string
    sourceNodeId?: string
  }
  if (!seed.panoramaNodeId || !seed.projectId || !seed.selectedCanvasId || !seed.sourceNodeId) {
    throw new Error(`Unexpected Panorama seed result: ${JSON.stringify(seed)}`)
  }

  await evaluateStable(
    rendererDebugger,
    `(() => {
    window.setTimeout(() => window.location.reload(), 0)
    return true
  })()`,
  )
  await Bun.sleep(300)
  const reloadedRendererDebugger = await waitForTarget(
    rendererPort,
    (target) => target.type === "page" && target.url === builtRendererUrl,
  )
  const panoramaResult = await evaluateStable(
    reloadedRendererDebugger,
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
    const preloadDeadline = Date.now() + ${timeoutMs}
    while (!window.convax) {
      if (Date.now() >= preloadDeadline) throw new Error("The preload bridge did not recover after reload")
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
  })()`,
  )
  const panoramaSummary = panoramaResult as {
    frameAllow?: string | null
    frameAllowFullscreen?: boolean
    frameSandbox?: string | null
    frameUrl?: string | null
    panoramaNodeId?: string
    selectedSourceNodeId?: string
    stateSchemaVersion?: number
  }
  if (
    panoramaSummary.frameSandbox !== "allow-scripts" ||
    !panoramaSummary.frameAllow?.includes("fullscreen *") ||
    panoramaSummary.frameAllowFullscreen !== true ||
    !panoramaSummary.frameUrl?.startsWith("convax-plugin://panorama-viewer/") ||
    panoramaSummary.panoramaNodeId !== seed.panoramaNodeId ||
    panoramaSummary.selectedSourceNodeId !== seed.sourceNodeId ||
    panoramaSummary.stateSchemaVersion !== 1
  ) {
    throw new Error(`Unexpected Panorama Viewer result: ${JSON.stringify(panoramaSummary)}`)
  }

  const reloadedDirectors = (await evaluatePluginFrames(
    mainDebugger,
    "storyai-3d-director-desk",
    `(async () => {
      const deadline = Date.now() + ${timeoutMs}
      const expectedRotationY = ${JSON.stringify(directorInteraction.rotationY)}
      let last = null
      let previousSignature = ""
      let stableSamples = 0
      while (Date.now() < deadline) {
        const role = [...document.querySelectorAll('[role="treeitem"]')]
          .find((item) => item.getAttribute("aria-label") === "角色01")
        role?.click()
        const rotation = document.querySelector('input[aria-label="角色旋转 Y"]')
        const signature = [...document.querySelectorAll(".viewport-gizmo-hit-button")]
          .map((button) => [
            button.getAttribute("aria-label"),
            button.style.left,
            button.style.top,
            button.style.zIndex,
          ])
        const rotationY = Number(rotation?.value)
        last = { rotationY, signature }
        const serialized = JSON.stringify(signature)
        if (Math.abs(rotationY - expectedRotationY) <= 0.000001 && signature.length) {
          stableSamples = serialized === previousSignature ? stableSamples + 1 : 0
          if (stableSamples >= 8) return { rotationY, signature }
        }
        previousSignature = serialized
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return { ...last, timedOut: true }
    })()`,
    2,
  )) as Array<{ rotationY?: number; signature?: string[][]; timedOut?: boolean }>
  // Duplicate clones the durable camera snapshot, not OrbitControls' transient damping velocity.
  // The source can therefore settle past the copy before reload; both restored views must remain
  // non-default and newer than the earlier gesture, but they are not required to stay identical.
  const defaultDirectorSignature = JSON.stringify(directorFrameGeometry.signature)
  const earlierDirectorSignature = JSON.stringify(directorInteraction.signature)
  if (
    reloadedDirectors.length !== 2 ||
    reloadedDirectors.some(
      (director) =>
        !Number.isFinite(director.rotationY) ||
        Math.abs(director.rotationY! - directorInteraction.rotationY!) > 0.000001 ||
        !director.signature?.length ||
        [defaultDirectorSignature, earlierDirectorSignature].includes(JSON.stringify(director.signature)),
    )
  ) {
    throw new Error(`Unexpected reloaded 3D Director UI: ${JSON.stringify(reloadedDirectors)}`)
  }

  const panoramaDocument = JSON.parse(
    await fs.readFile(path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"), "utf8"),
  ) as {
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
  if (
    persistedPanorama?.data?.kind !== "plugin.panorama-viewer" ||
    persistedPanorama.data.metadata?.convaxPluginState?.schemaVersion !== 1 ||
    persistedPanorama.data.metadata?.convaxPluginState?.selectedSourceNodeId !== seed.sourceNodeId ||
    !panoramaDocument.edges?.some(
      (edge) =>
        edge.id === "smoke-panorama-edge" && edge.source === seed.sourceNodeId && edge.target === seed.panoramaNodeId,
    )
  ) {
    throw new Error(`Unexpected persisted Panorama Canvas: ${JSON.stringify(panoramaDocument)}`)
  }
  console.log(
    `Desktop Settings, installed Skill showcase/detail, Open Project, 3D Plugin, and Panorama Viewer smoke passed (${summary.projectId}, canvas-main)`,
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
