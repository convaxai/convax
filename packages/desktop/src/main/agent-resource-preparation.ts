import type { AgentResource, AgentRuntimeResource } from "@convax/agent-runtime"
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

function validateSkillResource(resource: AgentResource): AgentRuntimeResource {
  if (resource.kind !== "skill" || !resource.name.trim()) throw new Error("Agent skill reference is invalid")
  return { kind: "skill", name: resource.name.trim() }
}

function validateCanvasId(canvasId: string) {
  const value = canvasId.trim()
  if (!value || value.length > 256 || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error("Agent canvas reference is invalid")
  }
  return value
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

export async function prepareAgentResources(
  manager: AgentProjectResolver,
  canvasSnapshots: AgentCanvasSnapshotResolver | undefined,
  projectId: string,
  resources: AgentResource[] | undefined,
): Promise<AgentRuntimeResource[]> {
  return Promise.all((resources ?? []).map(async (resource): Promise<AgentRuntimeResource> => {
    if (resource.kind === "skill") return validateSkillResource(resource)
    if (resource.kind === "canvas") {
      if (!canvasSnapshots) throw new Error("Canvas snapshots are unavailable")
      const canvasId = validateCanvasId(resource.canvasId)
      const snapshot = await canvasSnapshots.resolveCanvasSnapshot({ canvasId, projectId })
      if (typeof snapshot.content !== "string" || !snapshot.content.trim()) {
        throw new Error("Canvas snapshot is empty")
      }
      return {
        canvasId,
        content: snapshot.content,
        kind: "canvas",
        mime: "application/json",
        name: resource.name ?? snapshot.name,
      }
    }

    validateProjectPath(resource.path)
    await manager.resolveEntryPath({ path: resource.path, projectId })
    return {
      kind: resource.kind,
      mime: resource.mime,
      name: resource.name,
      path: resource.path,
    }
  }))
}
