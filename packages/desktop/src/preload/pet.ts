import { contextBridge, ipcRenderer } from "electron"

import { petIpcChannels, type PetOverlayClient, type PetRendererSnapshot } from "../pet-contracts"

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
