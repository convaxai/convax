import { contextBridge, ipcRenderer } from "electron"

import type { PetIpcChannels, PetOverlayClient, PetRendererSnapshot } from "../pet-contracts"

// Electron's sandboxed preload require cannot load emitted relative chunks.
const petIpcChannels = {
  drag: "pet:drag",
  navigate: "pet:navigate",
  setExpanded: "pet:set-expanded",
  snapshot: "pet:snapshot",
} as const satisfies Pick<PetIpcChannels, "drag" | "navigate" | "setExpanded" | "snapshot">

const petOverlayClient = {
  drag: (input) => ipcRenderer.send(petIpcChannels.drag, input),
  navigate: (input) => ipcRenderer.invoke(petIpcChannels.navigate, input),
  onSnapshot(listener) {
    const handleSnapshot = (_event: Electron.IpcRendererEvent, snapshot: PetRendererSnapshot) => listener(snapshot)
    ipcRenderer.on(petIpcChannels.snapshot, handleSnapshot)
    return () => ipcRenderer.removeListener(petIpcChannels.snapshot, handleSnapshot)
  },
  setExpanded: (input) => ipcRenderer.invoke(petIpcChannels.setExpanded, input),
} satisfies PetOverlayClient

contextBridge.exposeInMainWorld("convaxPet", petOverlayClient)
