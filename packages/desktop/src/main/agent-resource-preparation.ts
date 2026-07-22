import type { AgentResource, AgentRuntimeResource } from "@convax/agent-runtime"
import { parseCanvasDocument } from "@convax/canvas/core"
import { isAbsolute, win32 } from "node:path"

export interface AgentProjectResolver {
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
}

export interface AgentCanvasSnapshot {
  /** A serialized, read-only Canvas document. */
  content: string
  name?: string
}

export interface AgentCanvasSnapshotResolver {
  resolveCanvasSnapshot(input: { canvasId: string; projectId: string }): Promise<AgentCanvasSnapshot>
}

export interface AgentCanvasResourceReference {
  canvasId: string
  nodeId?: string
  uri: string
}

function validateSkillResource(resource: AgentResource): AgentRuntimeResource {
  if (resource.kind !== "skill" || !resource.name.trim()) throw new Error("Agent skill reference is invalid")
  return { kind: "skill", name: resource.name.trim() }
}

function validateCanvasId(canvasId: string) {
  const value = canvasId.trim()
  if (!value || value.length > 256 || value === "." || value === ".." || /[\\/\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Agent canvas reference is invalid")
  }
  return value
}

function validateCanvasNodeId(nodeId: string) {
  const value = nodeId
  if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Agent Canvas node reference is invalid")
  }
  return value
}

function decodeResourceSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error("Agent structured resource URI is invalid")
  }
}

/** Parse a full Canvas or one Canvas-node resource URI owned by the desktop host. */
export function parseAgentCanvasResourceUri(value: string): AgentCanvasResourceReference {
  const input = value.trim()
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("Agent structured resource URI is invalid")
  }
  const segments = url.pathname.split("/")
  if (
    url.protocol !== "convax:" ||
    url.hostname !== "canvas" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (segments.length !== 2 && segments.length !== 4) ||
    segments[0] !== "" ||
    (segments.length === 4 && segments[2] !== "node")
  ) {
    throw new Error("Agent structured resource URI is invalid")
  }
  const canvasId = validateCanvasId(decodeResourceSegment(segments[1]!))
  const nodeId = segments.length === 4 ? validateCanvasNodeId(decodeResourceSegment(segments[3]!)) : undefined
  return {
    canvasId,
    ...(nodeId ? { nodeId } : {}),
    uri: nodeId
      ? `convax://canvas/${encodeURIComponent(canvasId)}/node/${encodeURIComponent(nodeId)}`
      : `convax://canvas/${encodeURIComponent(canvasId)}`,
  }
}

export function parseAgentCanvasNodeResourceUri(value: string) {
  const reference = parseAgentCanvasResourceUri(value)
  if (!reference.nodeId) throw new Error("Agent Canvas node reference is invalid")
  return reference as AgentCanvasResourceReference & { nodeId: string }
}

function validateProjectPath(path: string) {
  if (!path || path.includes("\0") || isAbsolute(path) || win32.isAbsolute(path)) {
    throw new Error("Agent project reference is invalid")
  }
  const segments = path.replaceAll("\\", "/").split("/")
  if (segments.some((segment) => segment.toLowerCase() === ".convax")) {
    throw new Error("Convax private storage cannot be attached as a project file")
  }
}

async function prepareStructuredResource(
  resource: Extract<AgentResource, { kind: "resource" }>,
  canvasSnapshots: AgentCanvasSnapshotResolver | undefined,
  projectId: string,
): Promise<Extract<AgentRuntimeResource, { kind: "resource" }>> {
  if (!canvasSnapshots) throw new Error("Canvas node resources are unavailable")
  const reference = parseAgentCanvasResourceUri(resource.uri)
  const snapshot = await canvasSnapshots.resolveCanvasSnapshot({ canvasId: reference.canvasId, projectId })
  let document: ReturnType<typeof parseCanvasDocument>
  try {
    document = parseCanvasDocument(JSON.parse(snapshot.content), reference.canvasId)
  } catch {
    document = null
  }
  if (!document) throw new Error(`Canvas snapshot is invalid: ${reference.canvasId}`)
  const requestedName = resource.name?.trim()
  const node = reference.nodeId ? document.nodes.find((candidate) => candidate.id === reference.nodeId) : undefined
  if (reference.nodeId && !node) throw new Error(`Canvas node was not found: ${reference.nodeId}`)
  const children =
    node?.data.kind === "group" ? document.nodes.filter((candidate) => candidate.parentId === node.id) : undefined
  const includedNodeIds = new Set([node?.id, ...(children ?? []).map((child) => child.id)].filter(Boolean))
  const edges = node
    ? document.edges.filter((edge) => includedNodeIds.has(edge.source) || includedNodeIds.has(edge.target))
    : undefined
  const nodeLabel = node?.data.label.trim()
  const content = node
    ? {
        canvas: {
          id: document.id,
          name: snapshot.name,
          revision: document.revision,
        },
        ...(children ? { children } : {}),
        edges,
        node,
        type: "convax.canvas-node",
        version: 1,
      }
    : {
        canvas: document,
        name: snapshot.name,
        type: "convax.canvas",
        version: 1,
      }
  return {
    clientName: "convax",
    content: JSON.stringify(content, null, 2),
    kind: "resource",
    mime: "application/json",
    name: requestedName || nodeLabel || snapshot.name || document.metadata.title || reference.canvasId,
    uri: reference.uri,
  }
}

export async function prepareAgentResources(
  manager: AgentProjectResolver,
  canvasSnapshots: AgentCanvasSnapshotResolver | undefined,
  projectId: string,
  resources: AgentResource[] | undefined,
): Promise<AgentRuntimeResource[]> {
  return Promise.all(
    (resources ?? []).map(async (resource): Promise<AgentRuntimeResource> => {
      if (resource.kind === "skill") return validateSkillResource(resource)
      if (resource.kind === "resource") {
        return prepareStructuredResource(resource, canvasSnapshots, projectId)
      }
      validateProjectPath(resource.path)
      await manager.resolveEntryPath({ path: resource.path, projectId })
      return {
        kind: resource.kind,
        mime: resource.mime,
        name: resource.name,
        path: resource.path,
      }
    }),
  )
}
