import { join } from "node:path"
import { app, BrowserWindow } from "electron"

function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#f4f4ef",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
    return
  }

  void window.loadFile(join(import.meta.dirname, "../renderer/index.html"))
}

void app.whenReady().then(() => {
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return
  app.quit()
})
