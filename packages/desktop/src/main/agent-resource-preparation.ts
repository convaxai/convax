import type { AgentResource, AgentRuntimeResource } from "@convax/agent-runtime"
import type { CanvasDocument } from "@convax/canvas/core"
import { canonicalize as canonicalizeConvaxUri, parse as parseConvaxUri } from "@convax/uri"
import { isAbsolute, win32 } from "node:path"

export interface AgentProjectResolver {
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
}

export interface AgentCanvasSnapshot {
  /** Disposable, pathless Canvas-owned projection used as a read-only snapshot. */
  document: CanvasDocument
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

/** Parse a full Canvas or one Canvas-node resource URI owned by the desktop host. */
export function parseAgentCanvasResourceUri(value: string): AgentCanvasResourceReference {
  const input = value.trim()
  let uri: ReturnType<typeof parseConvaxUri>
  try {
    uri = parseConvaxUri(input)
  } catch {
    throw new Error("Agent structured resource URI is invalid")
  }
  const segments = uri.pathSegments
  if (
    uri.scheme !== "convax" ||
    uri.authority !== "canvas" ||
    uri.query ||
    uri.fragment ||
    (segments.length !== 1 && segments.length !== 3) ||
    (segments.length === 3 && segments[1] !== "node") ||
    segments.some((segment) => segment.includes("/") && segment !== segments.at(-1))
  ) {
    throw new Error("Agent structured resource URI is invalid")
  }
  const canvasId = validateCanvasId(segments[0]!)
  const nodeId = segments.length === 3 ? validateCanvasNodeId(segments[2]!) : undefined
  return {
    canvasId,
    ...(nodeId ? { nodeId } : {}),
    uri: canonicalizeConvaxUri(
      nodeId
        ? `convax://canvas/${encodeURIComponent(canvasId)}/node/${encodeURIComponent(nodeId)}`
        : `convax://canvas/${encodeURIComponent(canvasId)}`,
    ),
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
  const document = structuredClone(snapshot.document)
  if (document.id !== reference.canvasId) throw new Error(`Canvas snapshot is invalid: ${reference.canvasId}`)
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
