import {
  CanvasCommandIdConflictError,
  CanvasResourcePartialFailureError,
  type CanvasApplicationService,
  type CanvasDocumentClient,
  type CanvasResourceBusinessService,
  type CanvasResourcePreparationResult,
  type CanvasResourceSource,
} from "@convax/canvas/application"
import {
  getIncomingConnectedCanvasFileNodeIds,
  isCanvasEmptyImageNodeData,
  type CanvasNode,
  type CanvasPoint,
} from "@convax/canvas/core"
import {
  getProjectResourceReference,
  markProjectCanvasResourcesStale,
  projectResourceBindingsKey,
  requireProjectResourceReference,
} from "@convax/project/canvas"
import type { ProjectResourceReference } from "@convax/project/canvas"
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
  canvasResourceLocalFileRegisterIpcChannel,
  canvasResourceReadConnectedImageIpcChannel,
  canvasResourceRelinkIpcChannel,
  canvasResourceSaveEditableCopyIpcChannel,
  canvasTextResourceIpcChannel,
} from "../desktop-protocol"
import { canvasDocumentIpcChannels, type CanvasRendererCommandRequest } from "../canvas-document-contracts"

const commandIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

type CanvasDocumentHydrator = Pick<ProjectCanvasResourceHydrator, "hydrate"> &
  Partial<Pick<ProjectCanvasResourceHydrator, "hydrateStale">>

interface CanvasDocumentIpcOptions {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  prepareProjectCanvasAccess?: (projectId: string) => () => void
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
  ipcMain.handle(canvasDocumentIpcChannels.load, async (event, input) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    const completeProjectCanvasAccess = options.prepareProjectCanvasAccess?.(input.scopeId)
    const result = await documents.load(input)
    completeProjectCanvasAccess?.()
    if (!result.document || !hydrator) return result
    return {
      ...result,
      document: await hydrator.hydrate({ document: result.document, projectId: input.scopeId }),
    }
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

interface CanvasResourceMutationExecution {
  fingerprint: string
  result: Promise<unknown>
}

function executeCanvasResourceMutation<Result>(
  executions: Map<string, CanvasResourceMutationExecution>,
  active: ActiveCanvasScope,
  commandId: string,
  fingerprintValue: unknown,
  operation: () => Promise<Result>,
): Promise<Result> {
  const key = JSON.stringify([active.projectId, active.canvasId, "desktop:renderer", commandId])
  const fingerprint = JSON.stringify(fingerprintValue)
  const existing = executions.get(key)
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return Promise.reject(new CanvasCommandIdConflictError(commandId))
    }
    return existing.result as Promise<Result>
  }
  const result = operation()
  const execution = { fingerprint, result }
  executions.set(key, execution)
  if (executions.size > 1_000) executions.delete(executions.keys().next().value ?? "")
  void result.catch(() => {
    if (executions.get(key) === execution) executions.delete(key)
  })
  return result
}

function mergeCanvasResourcePreparation(
  first: CanvasResourcePreparationResult | undefined,
  second: CanvasResourcePreparationResult,
): CanvasResourcePreparationResult {
  if (!first) return second
  const retained = new Map<string, { label: string }>()
  for (const item of [...(first.retainedOnFailure ?? []), ...(second.retainedOnFailure ?? [])]) {
    if (!retained.has(item.label)) retained.set(item.label, item)
  }
  return {
    items: [...first.items, ...second.items],
    ...(retained.size === 0 ? {} : { retainedOnFailure: [...retained.values()] }),
    warnings: [...(first.warnings ?? []), ...(second.warnings ?? [])],
  }
}

type CanvasResourcePort = Pick<CanvasResourceBusinessService, "addPreparedResources" | "addResources"> &
  Partial<Pick<CanvasResourceBusinessService, "relinkPreparedResource">>
type CanvasLocalFilePreparationPort = Pick<ProjectCanvasResourcePreparation, "withAdmittedLocalFiles"> &
  Partial<Pick<ProjectCanvasResourcePreparation, "prepare" | "prepareManagedTextEditableCopy">>

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
  parentId?: string
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
  preparation: CanvasLocalFilePreparationPort,
  options: {
    documents?: Pick<CanvasDocumentClient, "load">
    images?: Pick<ProjectCanvasResourceHydrator, "readImage">
    isTrustedSender(event: IpcMainInvokeEvent): boolean
    resolveActiveCanvas(event: IpcMainInvokeEvent): Promise<{
      canvasId: string
      projectId: string
      revision: number
    } | null>
  },
) {
  const localFileTokens = new Map<string, { expiresAt: number; sourcePath: string }>()
  const mutationExecutions = new Map<string, CanvasResourceMutationExecution>()
  const localFileTokenKey = (event: IpcMainInvokeEvent, token: string) => `${event.sender.id}:${token}`
  const pruneLocalFileTokens = () => {
    const now = Date.now()
    for (const [key, token] of localFileTokens) {
      if (token.expiresAt < now) localFileTokens.delete(key)
    }
    while (localFileTokens.size >= 1_000) {
      const oldest = localFileTokens.keys().next().value
      if (!oldest) break
      localFileTokens.delete(oldest)
    }
  }

  ipcMain.handle(canvasResourceLocalFileRegisterIpcChannel, (event, value: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    const input = requireCanvasResourceLocalFileRegistration(value)
    pruneLocalFileTokens()
    const key = localFileTokenKey(event, input.sourceToken)
    if (localFileTokens.has(key)) throw new Error("Local file authorization is duplicated")
    localFileTokens.set(key, { expiresAt: Date.now() + 60_000, sourcePath: input.sourcePath })
  })

  ipcMain.handle(canvasResourceIpcChannel, async (event, value: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    const input = requireCanvasResourceMainRequest(value)
    const active = await options.resolveActiveCanvas(event)
    if (!active || active.projectId !== input.projectId || active.canvasId !== input.canvasId) {
      throw new Error("Canvas resource request does not match the invoking window's live Workbench scope")
    }
    return executeCanvasResourceMutation(
      mutationExecutions,
      active,
      input.commandId,
      { input, kind: "add" },
      async () => {
        const request = {
          actor: { id: "desktop:renderer", kind: "ui" as const },
          anchor: input.anchor,
          canvasId: active.canvasId,
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          relation: input.relation,
          scopeId: active.projectId,
          sources: input.sources,
        }
        let sourcePrepared: CanvasResourcePreparationResult | undefined
        let result
        try {
          if (input.externalFiles.length > 0 && input.sources.length > 0) {
            if (!preparation.prepare) throw new Error("Canvas resource source preparation is unavailable")
            sourcePrepared = await preparation.prepare({
              canvasId: active.canvasId,
              scopeId: active.projectId,
              sources: input.sources,
            })
          }
          result = input.externalFiles.length
            ? await preparation.withAdmittedLocalFiles(
                { files: input.externalFiles, projectId: active.projectId },
                (localPrepared: CanvasResourcePreparationResult) =>
                  resources.addPreparedResources(
                    sourcePrepared ? { ...request, sources: [] } : request,
                    mergeCanvasResourcePreparation(sourcePrepared, localPrepared),
                  ),
              )
            : await resources.addResources(request)
        } catch (error) {
          const failure =
            error instanceof CanvasResourcePartialFailureError || !sourcePrepared?.retainedOnFailure
              ? error
              : new CanvasResourcePartialFailureError(error, sourcePrepared.retainedOnFailure)
          if (failure instanceof CanvasResourcePartialFailureError) {
            const response = canvasResourcePartialFailureResponse(failure)
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
      },
    )
  })

  ipcMain.handle(canvasResourceRelinkIpcChannel, async (event, value: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    const input = requireCanvasResourceRelinkMainRequest(value)
    const relinkPreparedResource = resources.relinkPreparedResource?.bind(resources)
    if (!relinkPreparedResource) throw new Error("Canvas resource relink service is unavailable")
    const active = await requireActiveRelinkScope(event, input, options)
    return executeCanvasResourceMutation(
      mutationExecutions,
      active,
      input.commandId,
      { input, kind: "relink" },
      async () => {
        requireRelinkRevision(active, input)
        const live =
          input.source.kind === "local-file"
            ? await loadLiveRelinkNode(active, input.nodeId, options.documents, { allowEmptyImage: true })
            : await loadLiveRelinkNode(active, input.nodeId, options.documents)
        const request = canvasRelinkBusinessRequest(active, input)
        try {
          let result
          if (input.source.kind === "local-file") {
            const key = localFileTokenKey(event, input.source.sourceToken)
            pruneLocalFileTokens()
            const token = localFileTokens.get(key)
            if (!token || token.expiresAt < Date.now()) {
              throw new Error("Local file authorization has expired or is invalid")
            }
            localFileTokens.delete(key)
            result = await preparation.withAdmittedLocalFiles(
              {
                files: [
                  {
                    ...(input.source.mediaType === undefined ? {} : { mediaType: input.source.mediaType }),
                    name: input.source.name,
                    sourceId: "relink",
                    sourcePath: token.sourcePath,
                  },
                ],
                projectId: active.projectId,
              },
              async (prepared) => {
                requireCompatibleRelinkPreparation(live.node, prepared)
                await recheckLiveRelinkScope(event, active, input.nodeId, live.reference, options)
                return relinkPreparedResource(request, prepared)
              },
            )
          } else {
            if (!preparation.prepare) throw new Error("Canvas resource relink preparation is unavailable")
            const prepared = await preparation.prepare({
              canvasId: active.canvasId,
              scopeId: active.projectId,
              sources: [{ ...input.source, sourceId: "relink" }],
            })
            requireCompatibleRelinkPreparation(live.node, prepared)
            await recheckLiveRelinkScope(event, active, input.nodeId, live.reference, options)
            result = await relinkPreparedResource(request, prepared)
          }
          return { revision: result.document.revision, warnings: result.warnings }
        } catch (error) {
          if (error instanceof CanvasResourcePartialFailureError) {
            const response = canvasResourcePartialFailureResponse(error)
            if (response) return response
          }
          if (input.source.kind === "local-file") {
            throw new Error("Could not relink the selected local file", { cause: error })
          }
          throw error
        }
      },
    )
  })

  ipcMain.handle(canvasResourceSaveEditableCopyIpcChannel, async (event, value: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    const input = requireCanvasResourceEditableCopyRequest(value)
    const prepareManagedTextEditableCopy = preparation.prepareManagedTextEditableCopy
    const relinkPreparedResource = resources.relinkPreparedResource?.bind(resources)
    if (!prepareManagedTextEditableCopy || !relinkPreparedResource) {
      throw new Error("Canvas editable-copy service is unavailable")
    }
    const active = await requireActiveRelinkScope(event, input, options)
    return executeCanvasResourceMutation(
      mutationExecutions,
      active,
      input.commandId,
      { input, kind: "editable-copy" },
      async () => {
        requireRelinkRevision(active, input)
        const live = await loadLiveRelinkNode(active, input.nodeId, options.documents)
        if (
          live.node.data.kind !== "text" ||
          live.reference.kind !== "managed-asset" ||
          !managedTextExtension(live.reference.name)
        ) {
          throw new Error("Canvas resource does not support an editable copy")
        }
        let prepared: CanvasResourcePreparationResult | undefined
        try {
          prepared = await prepareManagedTextEditableCopy({
            projectId: active.projectId,
            reference: live.reference,
            sourceId: "editable-copy",
          })
          requireCompatibleRelinkPreparation(live.node, prepared)
          await recheckLiveRelinkScope(event, active, input.nodeId, live.reference, options)
          const result = await relinkPreparedResource(canvasRelinkBusinessRequest(active, input), prepared)
          return { revision: result.document.revision, warnings: result.warnings }
        } catch (error) {
          const failure =
            error instanceof CanvasResourcePartialFailureError || !prepared?.retainedOnFailure
              ? error
              : new CanvasResourcePartialFailureError(error, prepared.retainedOnFailure)
          if (failure instanceof CanvasResourcePartialFailureError) {
            const response = canvasResourcePartialFailureResponse(failure)
            if (response) return response
          }
          throw new Error("Could not save an editable copy of the Canvas text resource", { cause: error })
        }
      },
    )
  })

  ipcMain.handle(canvasResourceReadConnectedImageIpcChannel, async (event, value: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    try {
      const input = requireConnectedImageReadRequest(value)
      const active = await options.resolveActiveCanvas(event)
      if (!active || active.canvasId !== input.canvasId || active.revision !== input.expectedRevision) {
        throw new CanvasConnectedImageRequestError(
          "Connected Canvas image request does not match the invoking window's live Workbench scope",
        )
      }
      if (!options.images) throw new Error("Connected Canvas image reader is unavailable")
      const authority = await loadConnectedImageAuthority(active, input, options.documents)
      const first = requireConnectedImageRead(
        await options.images.readImage({
          maximumBytes: maximumConnectedImageBytes,
          projectId: active.projectId,
          reference: authority.reference,
        }),
      )
      await recheckConnectedImageAuthority(event, active, input, authority.reference, options)
      const second = requireConnectedImageRead(
        await options.images.readImage({
          maximumBytes: maximumConnectedImageBytes,
          projectId: active.projectId,
          reference: authority.reference,
        }),
      )
      await recheckConnectedImageAuthority(event, active, input, authority.reference, options)
      if (
        first.contentDigest !== second.contentDigest ||
        first.mimeType !== second.mimeType ||
        first.name !== second.name ||
        first.size !== second.size
      ) {
        throw new CanvasConnectedImageRequestError("Connected Canvas image changed while it was being read")
      }
      return {
        dataUrl: `data:${first.mimeType};base64,${Buffer.from(first.bytes).toString("base64")}`,
        mimeType: first.mimeType,
        name: first.name,
        size: first.size,
      }
    } catch (error) {
      if (error instanceof CanvasConnectedImageRequestError) throw error
      throw new Error("Could not read the connected Canvas image")
    }
  })

  return () => {
    localFileTokens.clear()
    mutationExecutions.clear()
    ipcMain.removeHandler(canvasResourceIpcChannel)
    ipcMain.removeHandler(canvasResourceLocalFileRegisterIpcChannel)
    ipcMain.removeHandler(canvasResourceReadConnectedImageIpcChannel)
    ipcMain.removeHandler(canvasResourceRelinkIpcChannel)
    ipcMain.removeHandler(canvasResourceSaveEditableCopyIpcChannel)
  }
}

const maximumConnectedImageBytes = 16 * 1024 * 1024
const connectedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])

interface CanvasConnectedImageReadRequest {
  canvasId: string
  expectedRevision: number
  nodeId: string
  ownerNodeId: string
}

class CanvasConnectedImageRequestError extends Error {}

function requireConnectedImageReadRequest(value: unknown): CanvasConnectedImageReadRequest {
  if (!isRecord(value)) throw new CanvasConnectedImageRequestError("Connected Canvas image request must be an object")
  for (const key of Object.keys(value)) {
    if (key !== "canvasId" && key !== "expectedRevision" && key !== "nodeId" && key !== "ownerNodeId") {
      throw new CanvasConnectedImageRequestError(`Connected Canvas image request contains unsupported field: ${key}`)
    }
  }
  const canvasId = requireBoundedNodeId(value.canvasId, "Connected Canvas image canvas id")
  const nodeId = requireBoundedNodeId(value.nodeId, "Connected Canvas image node id")
  const ownerNodeId = requireBoundedNodeId(value.ownerNodeId, "Connected Canvas image owner node id")
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
    throw new CanvasConnectedImageRequestError("Connected Canvas image revision must be a non-negative integer")
  }
  return { canvasId, expectedRevision: value.expectedRevision as number, nodeId, ownerNodeId }
}

function requireBoundedNodeId(value: unknown, label: string) {
  const id = requireNonEmptyString(value, label)
  if (id.length > 2_048 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new CanvasConnectedImageRequestError(`${label} is invalid`)
  }
  return id
}

async function loadConnectedImageAuthority(
  active: ActiveCanvasScope,
  input: CanvasConnectedImageReadRequest,
  documents: Pick<CanvasDocumentClient, "load"> | undefined,
) {
  if (!documents) throw new Error("Connected Canvas image document service is unavailable")
  const loaded = await documents.load({ canvasId: active.canvasId, scopeId: active.projectId })
  const document = loaded.document
  if (!document || document.revision !== active.revision) {
    throw new CanvasConnectedImageRequestError(
      "Connected Canvas image request does not match the invoking window's live Workbench scope",
    )
  }
  const ownerMatches = document.nodes.filter((node) => node.id === input.ownerNodeId)
  if (ownerMatches.length !== 1) throw new CanvasConnectedImageRequestError("Canvas Plugin owner node was not found")
  if (!getIncomingConnectedCanvasFileNodeIds(document, input.ownerNodeId).includes(input.nodeId)) {
    throw new CanvasConnectedImageRequestError("Canvas image is not directly connected to the Plugin node")
  }
  const imageMatches = document.nodes.filter((node) => node.id === input.nodeId)
  const image = imageMatches.length === 1 ? imageMatches[0] : undefined
  if (!image || image.type !== "file" || image.data.kind !== "image") {
    throw new CanvasConnectedImageRequestError("Connected Canvas node is not an image")
  }
  const reference = getProjectResourceReference(image.data.metadata)
  if (!reference || reference.kind === "project-directory") {
    throw new CanvasConnectedImageRequestError("Connected Canvas image requires a typed Project file reference")
  }
  return { reference }
}

async function recheckConnectedImageAuthority(
  event: IpcMainInvokeEvent,
  active: ActiveCanvasScope,
  input: CanvasConnectedImageReadRequest,
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>,
  options: Parameters<typeof registerCanvasResourceIpc>[2],
) {
  const current = await options.resolveActiveCanvas(event)
  if (!sameActiveCanvasScope(active, current)) {
    throw new CanvasConnectedImageRequestError(
      "Connected Canvas image request does not match the invoking window's live Workbench scope",
    )
  }
  const live = await loadConnectedImageAuthority(active, input, options.documents)
  if (JSON.stringify(live.reference) !== JSON.stringify(reference)) {
    throw new CanvasConnectedImageRequestError("Connected Canvas image source changed while it was being read")
  }
}

function requireConnectedImageRead(value: Awaited<ReturnType<ProjectCanvasResourceHydrator["readImage"]>>) {
  if (
    !value ||
    !(value.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size > maximumConnectedImageBytes ||
    value.bytes.byteLength !== value.size ||
    typeof value.contentDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.contentDigest) ||
    typeof value.mimeType !== "string" ||
    !connectedImageMimeTypes.has(value.mimeType) ||
    typeof value.name !== "string" ||
    !value.name ||
    value.name.length > 255
  ) {
    throw new Error("Connected Canvas image reader returned an invalid result")
  }
  return value
}

interface CanvasResourceRelinkGuard {
  canvasId: string
  commandId: string
  expectedRevision: number
  nodeId: string
}

type CanvasResourceRelinkMainRequest = CanvasResourceRelinkGuard & {
  source:
    | { kind: "host-directory" | "host-file"; path: string }
    | { kind: "local-file"; mediaType?: string; name: string; sourceToken: string }
}

function requireCanvasResourceRelinkGuard(value: unknown, allowedKeys: readonly string[]): CanvasResourceRelinkGuard {
  if (!isRecord(value)) throw new Error("Canvas resource relink request must be an object")
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new Error(`Canvas resource relink request contains unsupported field: ${key}`)
  }
  const canvasId = requireNonEmptyString(value.canvasId, "Canvas id")
  const commandId = requireNonEmptyString(value.commandId, "Canvas command id")
  const nodeId = requireNonEmptyString(value.nodeId, "Canvas node id")
  const expectedRevision = value.expectedRevision
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Expected Canvas revision must be a non-negative integer")
  }
  return { canvasId, commandId, expectedRevision, nodeId }
}

function requireCanvasResourceRelinkMainRequest(value: unknown): CanvasResourceRelinkMainRequest {
  const guard = requireCanvasResourceRelinkGuard(value, [
    "canvasId",
    "commandId",
    "expectedRevision",
    "nodeId",
    "source",
  ])
  if (!isRecord(value) || !isRecord(value.source)) throw new Error("Canvas resource relink source must be an object")
  const source = value.source
  if (source.kind === "host-file" || source.kind === "host-directory") {
    requireExactKeys(source, ["kind", "path"], "Canvas resource relink source")
    return { ...guard, source: { kind: source.kind, path: requireNonEmptyString(source.path, "Project source path") } }
  }
  if (source.kind === "local-file") {
    requireExactKeys(source, ["kind", "mediaType", "name", "sourceToken"], "Canvas resource relink source")
    return {
      ...guard,
      source: {
        kind: "local-file",
        ...(source.mediaType === undefined
          ? {}
          : { mediaType: requireString(source.mediaType, "Local file media type") }),
        name: requireNonEmptyString(source.name, "Local file name"),
        sourceToken: requireLocalFileToken(source.sourceToken),
      },
    }
  }
  throw new Error("Canvas resource relink source is invalid")
}

function requireCanvasResourceEditableCopyRequest(value: unknown): CanvasResourceRelinkGuard {
  return requireCanvasResourceRelinkGuard(value, ["canvasId", "commandId", "expectedRevision", "nodeId"])
}

function requireCanvasResourceLocalFileRegistration(value: unknown) {
  if (!isRecord(value)) throw new Error("Local file registration must be an object")
  requireExactKeys(value, ["sourcePath", "sourceToken"], "Local file registration")
  const sourcePath = requireNonEmptyString(value.sourcePath, "Local file source path")
  if (sourcePath.length > 32_768 || sourcePath.includes("\0")) throw new Error("Local file source path is invalid")
  return { sourcePath, sourceToken: requireLocalFileToken(value.sourceToken) }
}

function requireLocalFileToken(value: unknown) {
  const token = requireNonEmptyString(value, "Local file authorization")
  if (!/^canvas-resource_[A-Za-z0-9-]{1,128}$/.test(token)) throw new Error("Local file authorization is invalid")
  return token
}

function requireExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains unsupported field: ${key}`)
  }
}

async function requireActiveRelinkScope(
  event: IpcMainInvokeEvent,
  input: CanvasResourceRelinkGuard,
  options: Parameters<typeof registerCanvasResourceIpc>[2],
): Promise<ActiveCanvasScope> {
  const active = await options.resolveActiveCanvas(event)
  if (!active || active.canvasId !== input.canvasId) {
    throw new Error("Canvas resource relink does not match the invoking window's live Workbench scope")
  }
  return active
}

function requireRelinkRevision(active: ActiveCanvasScope, input: CanvasResourceRelinkGuard) {
  if (active.revision !== input.expectedRevision) {
    throw new Error("Canvas resource relink does not match the invoking window's live Workbench scope")
  }
}

async function loadLiveRelinkNode(
  active: ActiveCanvasScope,
  nodeId: string,
  documents: Pick<CanvasDocumentClient, "load"> | undefined,
): Promise<{ node: CanvasNode; reference: ProjectResourceReference }>
async function loadLiveRelinkNode(
  active: ActiveCanvasScope,
  nodeId: string,
  documents: Pick<CanvasDocumentClient, "load"> | undefined,
  options: { allowEmptyImage: true },
): Promise<{ node: CanvasNode; reference: ProjectResourceReference | null }>
async function loadLiveRelinkNode(
  active: ActiveCanvasScope,
  nodeId: string,
  documents: Pick<CanvasDocumentClient, "load"> | undefined,
  options?: { allowEmptyImage: true },
) {
  if (!documents) throw new Error("Canvas resource relink document service is unavailable")
  const loaded = await documents.load({ canvasId: active.canvasId, scopeId: active.projectId })
  if (!loaded.document || loaded.document.revision !== active.revision) {
    throw new Error("Canvas resource relink does not match the invoking window's live Workbench scope")
  }
  const matches = loaded.document.nodes.filter((node) => node.id === nodeId)
  const node = matches.length === 1 ? matches[0] : undefined
  const reference = node ? getProjectResourceReference(node.data.metadata) : null
  if (!node) throw new Error(`Canvas node was not found: ${nodeId}`)
  if (!reference && (!options?.allowEmptyImage || node.type !== "file" || !isCanvasEmptyImageNodeData(node.data))) {
    throw new Error("Canvas resource reference is invalid")
  }
  return { node, reference }
}

async function recheckLiveRelinkScope(
  event: IpcMainInvokeEvent,
  active: ActiveCanvasScope,
  nodeId: string,
  reference: ProjectResourceReference | null,
  options: Parameters<typeof registerCanvasResourceIpc>[2],
) {
  const current = await options.resolveActiveCanvas(event)
  if (!sameActiveCanvasScope(active, current)) {
    throw new Error("Canvas resource relink does not match the invoking window's live Workbench scope")
  }
  const live =
    reference === null
      ? await loadLiveRelinkNode(active, nodeId, options.documents, { allowEmptyImage: true })
      : await loadLiveRelinkNode(active, nodeId, options.documents)
  if (JSON.stringify(live.reference) !== JSON.stringify(reference)) {
    throw new Error("Canvas resource changed while it was being relinked")
  }
}

function canvasRelinkBusinessRequest(active: ActiveCanvasScope, input: CanvasResourceRelinkGuard) {
  return {
    actor: { id: "desktop:renderer", kind: "ui" as const },
    canvasId: active.canvasId,
    commandId: input.commandId,
    expectedRevision: input.expectedRevision,
    metadataKeysToRemove: [projectResourceBindingsKey],
    nodeId: input.nodeId,
    scopeId: active.projectId,
  }
}

function requireCompatibleRelinkPreparation(node: CanvasNode, prepared: CanvasResourcePreparationResult) {
  if (prepared.items.length !== 1) throw new Error("Canvas relink preparation must contain exactly one resource")
  const item = prepared.items[0]
  const reference = getProjectResourceReference(item.metadata)
  if (!reference) throw new Error("Canvas relink preparation has an invalid Project resource reference")
  if (item.kind !== node.data.kind) {
    throw new Error(`Canvas ${node.data.kind} node cannot be relinked to a ${item.kind} resource`)
  }
  if (node.data.kind === "folder") {
    if (reference.kind !== "project-directory") throw new Error("Canvas folder relink requires a Project directory")
    return
  }
  if (reference.kind === "project-directory") throw new Error("Canvas content relink cannot use a Project directory")
  if (node.data.kind === "text") {
    const name = reference.kind === "project-file" ? reference.path : reference.name
    if (!managedTextExtension(name)) throw new Error("Canvas text relink requires Markdown or plain text")
  }
}

function managedTextExtension(value: string) {
  const lower = value.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".txt")
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
  if (
    components.length !== 2 ||
    components[0] !== "Notes" ||
    !fileName ||
    (!fileName.endsWith(".md") && !fileName.endsWith(".txt"))
  ) {
    throw new Error("Retained resource must be a single-level Notes text file")
  }
  if (fileName.length <= ".txt".length) throw new Error("Retained Notes file name is required")
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
    ...(value.parentId === undefined
      ? {}
      : { parentId: requireNonEmptyString(value.parentId, "Canvas resource parent id") }),
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
