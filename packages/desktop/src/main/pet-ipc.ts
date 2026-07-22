import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron"

import {
  petIpcChannels,
  type PetActivitySnapshot,
  type PetActivityTarget,
  type PetDragInput,
  type PetInventoryItem,
  type PetInventorySnapshot,
  type PetNavigationRequest,
  type PetNavigationTarget,
} from "../pet-contracts"

interface PetManagementPort {
  deleteCustom(id: string): Promise<void>
  importCustom(sourcePath: string): Promise<PetInventoryItem>
  listPets(): Promise<PetInventorySnapshot>
  select(id: string): Promise<void>
  setAwake(awake: boolean): Promise<void>
  subscribe(listener: () => void): () => void
}

interface PetActivityNavigationPort {
  getSnapshot(): PetActivitySnapshot
  markSeen(activityId: string, expectedRevision: number): Promise<void>
  resolveActivity(activityId: string): PetActivityTarget | null
}

interface PetOverlayWindowPort {
  moveBy(delta: { x: number; y: number }, completed: boolean): Promise<void>
  setExpanded(expanded: boolean): Promise<void>
}

interface PetMainWindow {
  webContents: { send(channel: string, target?: PetNavigationTarget): void }
}

export interface RegisterPetIpcOptions {
  getMainWindow(): PetMainWindow | null
  isTrustedMainSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean
  isTrustedPetSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean
  selectCustomPetFile(): Promise<string | null>
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  return value as Record<string, unknown>
}

function exactInput(value: unknown, keys: readonly string[], label: string) {
  const input = record(value, label)
  if (Object.keys(input).length !== keys.length || keys.some((key) => !(key in input))) {
    throw new Error(`${label} is invalid`)
  }
  return input
}

function activityRequest(value: unknown): PetNavigationRequest {
  const input = exactInput(value, ["activityId"], "Pet activity request")
  if (typeof input.activityId !== "string" || input.activityId.length < 1 || input.activityId.length > 128) {
    throw new Error("Pet activity id is invalid")
  }
  return { activityId: input.activityId }
}

function dragInput(value: unknown): PetDragInput {
  const input = exactInput(value, ["dx", "dy", "phase"], "Pet drag request")
  if (
    typeof input.dx !== "number" ||
    typeof input.dy !== "number" ||
    !Number.isFinite(input.dx) ||
    !Number.isFinite(input.dy) ||
    Math.abs(input.dx) > 512 ||
    Math.abs(input.dy) > 512
  ) {
    throw new Error("Pet drag delta must be finite and bounded")
  }
  if (input.phase !== "move" && input.phase !== "end") throw new Error("Pet drag phase is invalid")
  return { dx: input.dx, dy: input.dy, phase: input.phase }
}

export function registerPetIpc(
  controller: PetManagementPort,
  activity: PetActivityNavigationPort,
  overlay: PetOverlayWindowPort,
  options: RegisterPetIpcOptions,
) {
  const disposers: Array<() => void> = []
  const handle = <Input, Result>(
    channel: string,
    trusted: (event: IpcMainInvokeEvent) => boolean,
    operation: (input: Input) => Promise<Result> | Result,
  ) => {
    ipcMain.handle(channel, async (event, input: Input) => {
      if (!trusted(event)) throw new Error("Pet IPC request came from an untrusted renderer")
      return await operation(input)
    })
    disposers.push(() => ipcMain.removeHandler(channel))
  }

  handle<undefined, PetInventorySnapshot>(petIpcChannels.list, options.isTrustedMainSender, () => controller.listPets())
  handle<unknown, void>(petIpcChannels.select, options.isTrustedMainSender, async (value) => {
    const input = exactInput(value, ["id"], "Pet selection request")
    if (typeof input.id !== "string" || input.id.length < 1 || input.id.length > 160) {
      throw new Error("Pet selection id is invalid")
    }
    await controller.select(input.id)
  })
  handle<unknown, void>(petIpcChannels.setAwake, options.isTrustedMainSender, async (value) => {
    const input = exactInput(value, ["awake"], "Pet wake request")
    if (typeof input.awake !== "boolean") throw new Error("Pet wake request is invalid")
    await controller.setAwake(input.awake)
  })
  handle<undefined, PetInventoryItem | null>(petIpcChannels.importCustom, options.isTrustedMainSender, async () => {
    const source = await options.selectCustomPetFile()
    return source ? controller.importCustom(source) : null
  })
  handle<unknown, void>(petIpcChannels.deleteCustom, options.isTrustedMainSender, async (value) => {
    const input = exactInput(value, ["id"], "Custom pet deletion request")
    if (typeof input.id !== "string") throw new Error("Custom pet deletion request is invalid")
    await controller.deleteCustom(input.id)
  })
  handle<unknown, void>(petIpcChannels.markDisplayed, options.isTrustedMainSender, async (value) => {
    const { activityId } = activityRequest(value)
    if (!activity.resolveActivity(activityId)) throw new Error("Pet activity is no longer available")
    await activity.markSeen(activityId, activity.getSnapshot().revision)
  })
  handle<unknown, void>(petIpcChannels.navigate, options.isTrustedPetSender, async (value) => {
    const { activityId } = activityRequest(value)
    const target = activity.resolveActivity(activityId)
    if (!target) throw new Error("Pet activity is no longer available")
    const mainWindow = options.getMainWindow()
    if (!mainWindow) throw new Error("Convax main window is not available")
    mainWindow.webContents.send(petIpcChannels.navigate, { activityId, ...target })
  })
  handle<unknown, void>(petIpcChannels.setExpanded, options.isTrustedPetSender, async (value) => {
    const input = exactInput(value, ["expanded"], "Pet tray request")
    if (typeof input.expanded !== "boolean") throw new Error("Pet tray request is invalid")
    await overlay.setExpanded(input.expanded)
  })

  const dragHandler = (event: IpcMainEvent, value: unknown) => {
    if (!options.isTrustedPetSender(event)) throw new Error("Pet IPC request came from an untrusted renderer")
    const input = dragInput(value)
    void overlay.moveBy({ x: input.dx, y: input.dy }, input.phase === "end").catch(() => undefined)
  }
  ipcMain.on(petIpcChannels.drag, dragHandler)
  disposers.push(() => ipcMain.removeListener(petIpcChannels.drag, dragHandler))

  const disposeChanged = controller.subscribe(() => {
    options.getMainWindow()?.webContents.send(petIpcChannels.changed)
  })
  disposers.push(disposeChanged)

  return () => {
    disposers.splice(0).reverse().forEach((dispose) => dispose())
  }
}
