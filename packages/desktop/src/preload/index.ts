import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("convax", {
  platform: process.platform,
})

