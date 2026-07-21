import {
  CanvasResourcePartialFailureError,
  type CanvasApplicationService,
  type CanvasDocumentClient,
  type CanvasResourceBusinessService,
  type CanvasResourcePreparationResult,
  type CanvasResourceSource,
} from "@convax/canvas/application"
import type { CanvasPoint } from "@convax/canvas/core"
import { requireProjectResourceReference } from "@convax/project/canvas"
import type { ProjectCanvasResourcePreparation } from "@convax/project/node"
import { ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  canvasResourcePartialFailureKind,
  type CanvasResourcePartialFailureResponse,
} from "../canvas-resource-private-contract"
import { canvasResourceIpcChannel } from "../desktop-protocol"
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

type CanvasResourcePort = Pick<CanvasResourceBusinessService, "addPreparedResources" | "addResources">
type CanvasExternalPreparationPort = Pick<ProjectCanvasResourcePreparation, "withAdmittedExternalFiles">

interface CanvasResourceMainRequest {
  anchor: CanvasPoint
  canvasId: string
  commandId: string
  expectedRevision: number
  externalFiles: readonly {
    mediaType?: string
    name: string
    sourceId: string
    sourcePath: string
  }[]
  projectId: string
  relation?: {
    anchorNodeIds: readonly string[]
    direction?: "from-anchor" | "to-anchor"
    mode: "connect" | "none"
  }
  sources: readonly CanvasResourceSource[]
}

export function registerCanvasResourceIpc(
  resources: CanvasResourcePort,
  preparation: CanvasExternalPreparationPort,
  options: {
    isTrustedSender(event: IpcMainInvokeEvent): boolean
    resolveActiveCanvas(event: IpcMainInvokeEvent): Promise<{
      canvasId: string
      projectId: string
      revision: number
    } | null>
  },
) {
  ipcMain.handle(canvasResourceIpcChannel, async (event, value: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    const input = requireCanvasResourceMainRequest(value)
    const active = await options.resolveActiveCanvas(event)
    if (!active || active.projectId !== input.projectId || active.canvasId !== input.canvasId) {
      throw new Error("Canvas resource request does not match the invoking window's live Workbench scope")
    }
    const request = {
      actor: { id: "desktop:renderer", kind: "ui" as const },
      anchor: input.anchor,
      canvasId: active.canvasId,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      relation: input.relation,
      scopeId: active.projectId,
      sources: input.sources,
    }
    let result
    try {
      result = input.externalFiles.length
        ? await preparation.withAdmittedExternalFiles(
            { files: input.externalFiles, projectId: active.projectId },
            (prepared: CanvasResourcePreparationResult) => resources.addPreparedResources(request, prepared),
          )
        : await resources.addResources(request)
    } catch (error) {
      if (error instanceof CanvasResourcePartialFailureError) {
        const response = canvasResourcePartialFailureResponse(error)
        if (response) return response
        // oxlint-disable-next-line eslint/preserve-caught-error -- Native error details must not cross IPC.
        throw new Error("Could not add the selected resources to the Canvas")
      }
      if (input.externalFiles.length > 0) {
        // oxlint-disable-next-line eslint/preserve-caught-error -- Native error details must not cross IPC.
        throw new Error("Could not add the selected local files to the Canvas")
      }
      throw error
    }
    return {
      createdNodeIds: result.createdNodeIds,
      revision: result.document.revision,
      warnings: result.warnings,
    }
  })
  return () => ipcMain.removeHandler(canvasResourceIpcChannel)
}

function canvasResourcePartialFailureResponse(
  error: CanvasResourcePartialFailureError,
): CanvasResourcePartialFailureResponse | null {
  try {
    return {
      kind: canvasResourcePartialFailureKind,
      retainedLabels: error.retainedOnFailure.map(({ label }) => requireSafeRetainedNoteLabel(label)),
    }
  } catch {
    return null
  }
}

function requireSafeRetainedNoteLabel(label: string) {
  const reference = requireProjectResourceReference({ kind: "project-file", path: label })
  if (reference.kind !== "project-file") throw new Error("Retained resource must be a Project file")
  const components = reference.path.split("/")
  const fileName = components[1]
  if (components.length !== 2 || components[0] !== "Notes" || !fileName || !fileName.endsWith(".md")) {
    throw new Error("Retained resource must be a single-level Notes Markdown file")
  }
  if (fileName.length <= ".md".length) throw new Error("Retained Notes file name is required")
  return reference.path
}

function requireCanvasResourceMainRequest(value: unknown): CanvasResourceMainRequest {
  if (!isRecord(value)) throw new Error("Canvas resource request must be an object")
  const projectId = requireNonEmptyString(value.projectId, "Project id")
  const canvasId = requireNonEmptyString(value.canvasId, "Canvas id")
  const commandId = requireNonEmptyString(value.commandId, "Canvas command id")
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
    throw new Error("Expected Canvas revision must be a non-negative integer")
  }
  if (!isRecord(value.anchor) || !Number.isFinite(value.anchor.x) || !Number.isFinite(value.anchor.y)) {
    throw new Error("Canvas resource anchor is invalid")
  }
  if (!Array.isArray(value.sources) || !Array.isArray(value.externalFiles)) {
    throw new Error("Canvas resource sources must be arrays")
  }
  const sourceIds = new Set<string>()
  for (const source of value.sources) {
    if (!isRecord(source)) throw new Error("Canvas resource source is invalid")
    addUniqueCanvasResourceSourceId(sourceIds, requireNonEmptyString(source.sourceId, "Canvas resource source id"))
  }
  const externalFiles = value.externalFiles.map((item) => {
    if (!isRecord(item)) throw new Error("External Canvas resource is invalid")
    const sourceId = requireNonEmptyString(item.sourceId, "External source id")
    addUniqueCanvasResourceSourceId(sourceIds, sourceId)
    return {
      ...(item.mediaType === undefined ? {} : { mediaType: requireString(item.mediaType, "External media type") }),
      name: requireNonEmptyString(item.name, "External file name"),
      sourceId,
      sourcePath: requireNonEmptyString(item.sourcePath, "External source path"),
    }
  })
  return {
    anchor: { x: value.anchor.x as number, y: value.anchor.y as number },
    canvasId,
    commandId,
    expectedRevision: value.expectedRevision as number,
    externalFiles,
    projectId,
    relation: requireCanvasResourceRelation(value.relation),
    sources: value.sources as CanvasResourceSource[],
  }
}

function addUniqueCanvasResourceSourceId(sourceIds: Set<string>, sourceId: string) {
  if (sourceIds.has(sourceId)) throw new Error(`Canvas resource source id is duplicated: ${sourceId}`)
  sourceIds.add(sourceId)
}

function requireCanvasResourceRelation(value: unknown): CanvasResourceMainRequest["relation"] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("Canvas resource relation must be an object")
  for (const key of Object.keys(value)) {
    if (key !== "anchorNodeIds" && key !== "direction" && key !== "mode") {
      throw new Error(`Canvas resource relation contains an unsupported field: ${key}`)
    }
  }
  if (!Array.isArray(value.anchorNodeIds)) {
    throw new Error("Canvas resource relation anchor node ids must be an array")
  }
  const anchorNodeIds = value.anchorNodeIds.map((id) =>
    requireNonEmptyString(id, "Canvas resource relation anchor node id"),
  )
  if (new Set(anchorNodeIds).size !== anchorNodeIds.length) {
    throw new Error("Canvas resource relation anchor node ids must be unique")
  }
  if (value.mode !== "connect" && value.mode !== "none") {
    throw new Error("Canvas resource relation mode must be connect or none")
  }
  if (value.direction !== undefined && value.direction !== "from-anchor" && value.direction !== "to-anchor") {
    throw new Error("Canvas resource relation direction must be from-anchor or to-anchor")
  }
  return {
    anchorNodeIds,
    ...(value.direction === undefined ? {} : { direction: value.direction }),
    mode: value.mode,
  }
}

function requireNonEmptyString(value: unknown, label: string) {
  const string = requireString(value, label)
  if (!string.trim()) throw new Error(`${label} is required`)
  return string
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
