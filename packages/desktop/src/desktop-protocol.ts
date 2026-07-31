import type { CanvasResourceSource } from "@convax/canvas/application"
import type { CanvasDocument, CanvasPoint } from "@convax/canvas/core"
import type { CanvasTextResourceService } from "@convax/canvas"

export const desktopProtocolChannel = "desktop:protocol-version"
export const desktopProtocolVersion = "convax.desktop-ipc/30"
export const canvasResourceIpcChannel = "canvas:resource-add"
export const canvasResourceHydrateStaleIpcChannel = "canvas:resource-hydrate-stale"
export const canvasResourceLocalFileRegisterIpcChannel = "canvas:resource-local-file-register"
export const canvasResourceReadConnectedImageIpcChannel = "canvas:resource-read-connected-image"
export const canvasResourceRelinkIpcChannel = "canvas:resource-relink"
export const canvasResourceSaveEditableCopyIpcChannel = "canvas:resource-save-editable-copy"
export const canvasTextResourceIpcChannel = "canvas:text-resource-save"

export type CanvasTextResourceClient = CanvasTextResourceService

export interface CanvasResourceAddResult {
  createdNodeIds: readonly string[]
  revision: number
  warnings: readonly string[]
}

export interface CanvasResourceAddInput {
  anchor: CanvasPoint
  canvasId: string
  commandId: string
  expectedRevision: number
  localFiles?: readonly {
    mediaType?: string
    name: string
    sourceId: string
    sourceToken: string
  }[]
  projectId: string
  relation?: {
    anchorNodeIds: readonly string[]
    direction?: "from-anchor" | "to-anchor"
    mode: "connect" | "none"
  }
  sources: readonly CanvasResourceSource[]
}

export interface CanvasResourceRelinkInput {
  canvasId: string
  commandId: string
  expectedRevision: number
  nodeId: string
  source:
    | { kind: "host-directory" | "host-file"; path: string }
    | { kind: "local-file"; mediaType?: string; name: string; sourceToken: string }
}

export interface CanvasResourceSaveEditableCopyInput {
  canvasId: string
  commandId: string
  expectedRevision: number
  nodeId: string
}

export interface CanvasResourceRelinkResult {
  revision: number
  warnings: readonly string[]
}

export interface CanvasConnectedImageReadInput {
  canvasId: string
  expectedRevision: number
  nodeId: string
  ownerNodeId: string
}

export interface CanvasConnectedImageReadResult {
  dataUrl: string
  mimeType: "image/jpeg" | "image/png" | "image/webp"
  name: string
  size: number
}

export interface CanvasResourceClient {
  add(input: CanvasResourceAddInput): Promise<CanvasResourceAddResult>
  createLocalFileToken(file: File): string
  hydrateStale(input: { canvasId: string; revision: number }): Promise<CanvasDocument>
  readConnectedImage(input: CanvasConnectedImageReadInput): Promise<CanvasConnectedImageReadResult>
  relink(input: CanvasResourceRelinkInput): Promise<CanvasResourceRelinkResult>
  saveEditableCopy(input: CanvasResourceSaveEditableCopyInput): Promise<CanvasResourceRelinkResult>
}

export interface DesktopProtocolClient {
  readonly version: string
  getVersion(): Promise<string>
}

export type DesktopProtocolCompatibility =
  | {
      actualVersion: string
      expectedVersion: string
      status: "compatible"
    }
  | {
      error?: string
      expectedVersion: string
      status: "missing"
    }
  | {
      actualVersion: string
      component: "main" | "preload"
      expectedVersion: string
      status: "mismatch"
    }

export async function checkDesktopProtocol(
  client: DesktopProtocolClient | null | undefined,
  expectedVersion = desktopProtocolVersion,
): Promise<DesktopProtocolCompatibility> {
  if (!client || typeof client.getVersion !== "function") {
    return { expectedVersion, status: "missing" }
  }
  if (typeof client.version !== "string") {
    return { expectedVersion, status: "missing" }
  }
  if (client.version !== expectedVersion) {
    return {
      actualVersion: client.version,
      component: "preload",
      expectedVersion,
      status: "mismatch",
    }
  }

  let actualVersion: string
  try {
    actualVersion = await client.getVersion()
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      expectedVersion,
      status: "missing",
    }
  }

  if (actualVersion !== expectedVersion) {
    return { actualVersion, component: "main", expectedVersion, status: "mismatch" }
  }
  return { actualVersion, expectedVersion, status: "compatible" }
}
