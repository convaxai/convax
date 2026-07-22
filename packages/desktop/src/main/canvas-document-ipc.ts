import type { CanvasApplicationService, CanvasDocumentClient } from "@convax/canvas/application"
import { ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  canvasDocumentIpcChannels,
  type CanvasRendererCommandRequest,
} from "../canvas-document-contracts"

const commandIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

export function registerCanvasDocumentIpc(
  documents: Pick<CanvasDocumentClient, "load">,
  application: Pick<CanvasApplicationService, "execute">,
  options: { isTrustedSender: (event: IpcMainInvokeEvent) => boolean },
) {
  ipcMain.handle(canvasDocumentIpcChannels.load, (event, input) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    return documents.load(input)
  })
  ipcMain.handle(canvasDocumentIpcChannels.execute, (event, input: CanvasRendererCommandRequest) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    const request = requireRendererCommandRequest(input)
    return application.execute({
      canvasId: request.ref.canvasId,
      envelope: {
        actor: { id: `desktop:renderer:${event.sender.id}`, kind: "renderer" },
        command: structuredClone(request.command),
        commandId: request.commandId,
        expectedRevision: request.expectedRevision,
      },
      scopeId: request.ref.scopeId,
    })
  })
  return () => {
    ipcMain.removeHandler(canvasDocumentIpcChannels.execute)
    ipcMain.removeHandler(canvasDocumentIpcChannels.load)
  }
}

function requireRendererCommandRequest(value: unknown): CanvasRendererCommandRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Canvas command request is invalid")
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 4 || keys.some((key) => !["command", "commandId", "expectedRevision", "ref"].includes(key))) {
    throw new Error("Canvas command request contains unsupported fields")
  }
  if (typeof record.commandId !== "string" || !commandIdPattern.test(record.commandId)) {
    throw new Error("Canvas command id is invalid")
  }
  if (!Number.isSafeInteger(record.expectedRevision) || (record.expectedRevision as number) < 0) {
    throw new Error("Canvas expected revision is invalid")
  }
  if (!record.command || typeof record.command !== "object" || Array.isArray(record.command)) {
    throw new Error("Canvas command is invalid")
  }
  if (!record.ref || typeof record.ref !== "object" || Array.isArray(record.ref)) {
    throw new Error("Canvas command reference is invalid")
  }
  const ref = record.ref as Record<string, unknown>
  if (
    Object.keys(ref).length !== 2 ||
    typeof ref.canvasId !== "string" ||
    !ref.canvasId ||
    typeof ref.scopeId !== "string" ||
    !ref.scopeId
  ) {
    throw new Error("Canvas command reference is invalid")
  }
  return value as CanvasRendererCommandRequest
}
