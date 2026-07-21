import {
  CanvasResourcePartialFailureError,
  type CanvasApplicationService,
  type CanvasDocumentClient,
  type CanvasResourceBusinessService,
  type CanvasResourcePreparationResult,
  type CanvasResourceSource,
} from "@convax/canvas/application"
import type { CanvasPoint } from "@convax/canvas/core"
import {
  getProjectResourceReference,
  markProjectCanvasResourcesStale,
  requireProjectResourceReference,
} from "@convax/project/canvas"
import type { ProjectCanvasResourceHydrator, ProjectCanvasResourcePreparation } from "@convax/project/node"
import { ProjectTextFileConflictError, type ProjectTextFileCompareAndReplacePort } from "@convax/project-files"
import { ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  canvasResourcePartialFailureKind,
  canvasTextResourceConflictKind,
  type CanvasResourcePartialFailureResponse,
} from "../canvas-resource-private-contract"
import {
  canvasResourceHydrateStaleIpcChannel,
  canvasResourceIpcChannel,
  canvasTextResourceIpcChannel,
} from "../desktop-protocol"
import {
  canvasDocumentIpcChannels,
  type CanvasRendererCommandRequest,
} from "../canvas-document-contracts"

const commandIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

type CanvasDocumentHydrator = Pick<ProjectCanvasResourceHydrator, "hydrate"> &
  Partial<Pick<ProjectCanvasResourceHydrator, "hydrateStale">>

interface CanvasDocumentIpcOptions {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  resolveActiveCanvas?: (event: IpcMainInvokeEvent) => Promise<ActiveCanvasScope | null>
}

export function registerCanvasDocumentIpc(
  documents: CanvasDocumentClient,
  applicationOrHydrator: Pick<CanvasApplicationService, "execute"> | CanvasDocumentHydrator,
  hydratorOrOptions: CanvasDocumentHydrator | CanvasDocumentIpcOptions,
  maybeOptions?: CanvasDocumentIpcOptions,
) {
  const application = "execute" in applicationOrHydrator ? applicationOrHydrator : undefined
  const hydrator =
    "hydrate" in applicationOrHydrator
      ? applicationOrHydrator
      : "hydrate" in hydratorOrOptions
        ? hydratorOrOptions
        : undefined
  const options = maybeOptions ?? (hydratorOrOptions as CanvasDocumentIpcOptions)
  const disposers: Array<() => void> = []
  ipcMain.handle(canvasDocumentIpcChannels.load, (event, input) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    return Promise.resolve(documents.load(input)).then(async (result) => {
      if (!result.document || !hydrator) return result
      return {
        ...result,
        document: await hydrator.hydrate({ document: result.document, projectId: input.scopeId }),
      }
    })
  })
  disposers.push(() => ipcMain.removeHandler(canvasDocumentIpcChannels.load))
  if (application) {
    ipcMain.handle(canvasDocumentIpcChannels.execute, (event, input: CanvasRendererCommandRequest) => {
      if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
      const request = requireRendererCommandRequest(input)
      return Promise.resolve(
        application.execute({
          canvasId: request.ref.canvasId,
          envelope: {
            actor: { id: `desktop:renderer:${event.sender.id}`, kind: "renderer" },
            command: structuredClone(request.command),
            commandId: request.commandId,
            expectedRevision: request.expectedRevision,
          },
          scopeId: request.ref.scopeId,
        }),
      ).then(async (result) =>
        hydrator
          ? {
              ...result,
              document: await hydrator.hydrate({
                document: result.document,
                projectId: request.ref.scopeId,
              }),
            }
          : result,
      )
    })
    disposers.push(() => ipcMain.removeHandler(canvasDocumentIpcChannels.execute))
  }
  if (hydrator?.hydrateStale && options.resolveActiveCanvas) {
    const hydrateStale = hydrator.hydrateStale.bind(hydrator)
    const resolveActiveCanvas = options.resolveActiveCanvas
    ipcMain.handle(canvasResourceHydrateStaleIpcChannel, async (event, value: unknown) => {
      if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
      const input = requireCanvasResourceHydrateStaleRequest(value)
      const active = await resolveActiveCanvas(event)
      if (!active || active.canvasId !== input.canvasId || active.revision !== input.revision) {
        throw new Error("Canvas resource refresh does not match the invoking window's live Workbench scope")
      }
      const loaded = await documents.load({ canvasId: active.canvasId, scopeId: active.projectId })
      if (!loaded.document || loaded.document.revision !== active.revision) {
        throw new Error("Canvas resource refresh does not match the invoking window's live Workbench scope")
      }
      const hydrated = await hydrateStale({
        document: markProjectCanvasResourcesStale(loaded.document),
        projectId: active.projectId,
      })
      const current = await resolveActiveCanvas(event)
      if (!sameActiveCanvasScope(active, current)) {
        throw new Error("Canvas resource refresh does not match the invoking window's live Workbench scope")
      }
      return hydrated
    })
    disposers.push(() => ipcMain.removeHandler(canvasResourceHydrateStaleIpcChannel))
  }
  return () => disposers.forEach((dispose) => dispose())
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

function requireCanvasResourceHydrateStaleRequest(value: unknown) {
  if (!isRecord(value)) throw new Error("Canvas resource refresh request must be an object")
  for (const key of Object.keys(value)) {
    if (key !== "canvasId" && key !== "revision") {
      throw new Error(`Canvas resource refresh request contains unsupported field: ${key}`)
    }
  }
  const canvasId = requireNonEmptyString(value.canvasId, "Canvas resource refresh canvas id")
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error("Canvas resource refresh revision must be a non-negative integer")
  }
  return { canvasId, revision: value.revision as number }
}

interface ActiveCanvasScope {
  canvasId: string
  projectId: string
  revision: number
}

interface CanvasTextResourceMainRequest {
  content: string
  contentRevision: string
  nodeId: string
}

export function registerCanvasTextResourceIpc(
  files: ProjectTextFileCompareAndReplacePort,
  documents: Pick<CanvasDocumentClient, "load">,
  options: {
    isTrustedSender(event: IpcMainInvokeEvent): boolean
    resolveActiveCanvas(event: IpcMainInvokeEvent): Promise<ActiveCanvasScope | null>
  },
) {
  ipcMain.handle(canvasTextResourceIpcChannel, async (event, value: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    try {
      const input = requireCanvasTextResourceMainRequest(value)
      const active = await options.resolveActiveCanvas(event)
      if (!active) throw new CanvasTextResourceRequestError("Canvas text resource request has no live Workbench scope")
      const loaded = await documents.load({ canvasId: active.canvasId, scopeId: active.projectId })
      const document = loaded.document
      if (!document) throw new CanvasTextResourceRequestError("Canvas text resource document was not found")
      if (document.revision !== active.revision) {
        throw new CanvasTextResourceRequestError(
          "Canvas text resource request does not match the invoking window's live Workbench scope",
        )
      }
      const matches = document.nodes.filter((node) => node.id === input.nodeId)
      const node = matches.length === 1 ? matches[0] : undefined
      const reference = node ? getProjectResourceReference(node.data.metadata) : null
      if (
        !node ||
        node.data.kind !== "text" ||
        reference?.kind !== "project-file" ||
        !isEditableProjectTextPath(reference.path)
      ) {
        throw new CanvasTextResourceRequestError("Canvas text resource is not editable")
      }

      const current = await options.resolveActiveCanvas(event)
      if (!sameActiveCanvasScope(active, current)) {
        throw new CanvasTextResourceRequestError(
          "Canvas text resource request does not match the invoking window's live Workbench scope",
        )
      }

      return await files.compareAndReplaceTextFile({
        content: input.content,
        expectedRevision: input.contentRevision,
        path: reference.path,
        projectId: active.projectId,
      })
    } catch (error) {
      if (error instanceof ProjectTextFileConflictError) {
        return { actualRevision: error.actualRevision, kind: canvasTextResourceConflictKind }
      }
      if (error instanceof CanvasTextResourceRequestError) throw error
      throw new Error("Could not save the Canvas text resource")
    }
  })
  return () => ipcMain.removeHandler(canvasTextResourceIpcChannel)
}

class CanvasTextResourceRequestError extends Error {}

function requireCanvasTextResourceMainRequest(value: unknown): CanvasTextResourceMainRequest {
  if (!isRecord(value)) throw new CanvasTextResourceRequestError("Canvas text resource request must be an object")
  for (const key of Object.keys(value)) {
    if (key !== "content" && key !== "contentRevision" && key !== "nodeId") {
      throw new CanvasTextResourceRequestError(`Canvas text resource request contains unsupported field: ${key}`)
    }
  }
  const content = requireString(value.content, "Canvas text content")
  if (Buffer.byteLength(content, "utf8") > 16 * 1024 * 1024) {
    throw new CanvasTextResourceRequestError("Canvas text content is too large")
  }
  const contentRevision = requireString(value.contentRevision, "Canvas text content revision")
  if (!/^[a-f0-9]{64}$/.test(contentRevision)) {
    throw new CanvasTextResourceRequestError("Canvas text content revision is invalid")
  }
  const nodeId = requireNonEmptyString(value.nodeId, "Canvas text node id")
  if (nodeId.length > 256) throw new CanvasTextResourceRequestError("Canvas text node id is too long")
  return { content, contentRevision, nodeId }
}

function isEditableProjectTextPath(value: string) {
  const lower = value.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".txt")
}

function sameActiveCanvasScope(left: ActiveCanvasScope, right: ActiveCanvasScope | null) {
  return Boolean(
    right && left.canvasId === right.canvasId && left.projectId === right.projectId && left.revision === right.revision,
  )
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
