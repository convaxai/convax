import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { NodeProjectManager } from "@convax/project/node"
import { app, BrowserWindow, net, protocol, shell } from "electron"
import { registerProjectIpc } from "./project-ipc"

const trustedWebContents = new Set<number>()
type CloseGate = "approved" | "flushing" | "idle"

let quitGate: CloseGate = "idle"
const rendererUrl = process.env.ELECTRON_RENDERER_URL
const trustedRendererUrl = rendererUrl ?? pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href

if (!app.isPackaged && process.env.CONVAX_USER_DATA_DIR) {
  app.setPath("userData", resolve(process.env.CONVAX_USER_DATA_DIR))
}

function isTrustedRendererUrl(value: string) {
  try {
    const actual = new URL(value)
    const expected = new URL(trustedRendererUrl)
    return actual.protocol === expected.protocol
      && actual.host === expected.host
      && actual.pathname === expected.pathname
  } catch {
    return false
  }
}

function createWindow(projectManager: NodeProjectManager) {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#f7f8f7",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const webContentsId = window.webContents.id
  trustedWebContents.add(webContentsId)
  window.once("closed", () => trustedWebContents.delete(webContentsId))
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  let closeGate: CloseGate = "idle"
  window.webContents.on("will-prevent-unload", () => {
    closeGate = "idle"
    quitGate = "idle"
  })
  window.on("close", (event) => {
    if (quitGate === "approved" || closeGate === "approved") return
    event.preventDefault()
    if (closeGate === "flushing" || quitGate === "flushing") return
    closeGate = "flushing"
    void projectManager.flushPendingWrites().then(
      () => {
        closeGate = "approved"
        window.close()
      },
      (error) => {
        closeGate = "idle"
        console.error("Convax window stayed open because project files could not be saved", error)
      },
    )
  })

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
    return
  }

  void window.loadURL(trustedRendererUrl)
}

function startApplication() {
  protocol.registerSchemesAsPrivileged([{
    scheme: "convax-asset",
    privileges: { corsEnabled: true, secure: true, standard: true, stream: true, supportFetchAPI: true },
  }])
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  void app.whenReady().then(async () => {
    const projectManager = new NodeProjectManager({
      registryFile: join(app.getPath("userData"), "projects.json"),
      trash: (targetPath: string) => shell.trashItem(targetPath),
    })
    const disposeProjectIpc = await registerProjectIpc(projectManager, {
      isTrustedSender: (event) => trustedWebContents.has(event.sender.id)
        && Boolean(event.senderFrame && isTrustedRendererUrl(event.senderFrame.url)),
    })
    protocol.handle("convax-asset", async (request) => {
      try {
        const url = new URL(request.url)
        const relativePath = url.searchParams.get("path")
        if (!url.hostname || !relativePath) return new Response("Asset was not found", { status: 404 })
        const absolutePath = await projectManager.resolveEntryPath({ path: relativePath, projectId: url.hostname })
        return net.fetch(pathToFileURL(absolutePath).href, { headers: request.headers })
      } catch {
        return new Response("Asset was not found", { status: 404 })
      }
    })
    app.once("will-quit", () => protocol.unhandle("convax-asset"))
    app.once("will-quit", disposeProjectIpc)
    app.on("before-quit", (event) => {
      if (quitGate === "approved") return
      event.preventDefault()
      if (quitGate === "flushing") return
      quitGate = "flushing"
      void projectManager.flushPendingWrites().then(
        () => {
          quitGate = "approved"
          app.quit()
        },
        (error) => {
          quitGate = "idle"
          console.error("Convax stayed open because project files could not be saved", error)
        },
      )
    })

    createWindow(projectManager)

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length > 0) return
      createWindow(projectManager)
    })
  })
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
}

const allowMultipleInstances = !app.isPackaged && process.env.CONVAX_ALLOW_MULTIPLE_INSTANCES === "1"

if (allowMultipleInstances || app.requestSingleInstanceLock()) startApplication()
else app.quit()
