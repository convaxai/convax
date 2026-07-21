import type { CanvasResourceSource } from "@convax/canvas/application"
import type { CanvasPoint } from "@convax/canvas/core"

export const desktopProtocolChannel = "desktop:protocol-version"
export const desktopProtocolVersion = "convax.desktop-ipc/18"
export const canvasResourceIpcChannel = "canvas:resource-add"

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

export interface CanvasResourceClient {
  add(input: CanvasResourceAddInput): Promise<CanvasResourceAddResult>
  createLocalFileToken(file: File): string
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
