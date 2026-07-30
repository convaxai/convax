import {
  requireProjectResourceReference,
  type ProjectResourceReference,
} from "@convax/project/canvas"
import type { ProjectManagedAssetStore } from "@convax/project/node"
import { parseSingleHttpByteRange } from "./http-byte-range"

type ProtocolReference = Exclude<ProjectResourceReference, { kind: "project-directory" }>

export interface ProjectResourceProtocolInput {
  contentRevision?: string
  projectId: string
  reference: ProtocolReference
}

export function createProjectResourceUrl(input: ProjectResourceProtocolInput) {
  const projectId = requireProjectId(input.projectId)
  const reference = requireProtocolReference(input.reference)
  const url = new URL(`convax-asset://${projectId}/${reference.kind}`)
  if (reference.kind === "project-file") {
    if (!isSha256(input.contentRevision)) throw new Error("Project file content revision is invalid")
    url.searchParams.set("path", reference.path)
    url.searchParams.set("revision", input.contentRevision)
  } else {
    if (input.contentRevision !== undefined) throw new Error("Managed asset URLs use their content digest")
    url.searchParams.set("sha256", reference.sha256)
    url.searchParams.set("name", reference.name)
    if (reference.mediaType) url.searchParams.set("mediaType", reference.mediaType)
  }
  return url.href
}

export function parseProjectResourceUrl(value: string): ProjectResourceProtocolInput {
  const url = new URL(value)
  if (
    url.protocol !== "convax-asset:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !url.hostname
  ) {
    throw new Error("Project resource URL is invalid")
  }
  const projectId = requireProjectId(url.hostname)
  if (url.pathname === "/project-file") {
    requireExactSearchParams(url, ["path", "revision"])
    const contentRevision = url.searchParams.get("revision")
    if (!isSha256(contentRevision)) throw new Error("Project file content revision is invalid")
    const reference = requireProtocolReference({
      kind: "project-file",
      path: url.searchParams.get("path"),
    })
    return { contentRevision, projectId, reference }
  }
  if (url.pathname === "/managed-asset") {
    requireExactSearchParams(url, ["sha256", "name"], ["mediaType"])
    const mediaType = url.searchParams.get("mediaType")
    const reference = requireProtocolReference({
      kind: "managed-asset",
      ...(mediaType === null ? {} : { mediaType }),
      name: url.searchParams.get("name"),
      sha256: url.searchParams.get("sha256"),
    })
    return { projectId, reference }
  }
  throw new Error("Project resource URL kind is invalid")
}

export async function resolveProjectResourceProtocolPath(
  value: string,
  files: { resolveEntryPath(input: { path?: string; projectId: string }): Promise<string> },
  assets: Pick<ProjectManagedAssetStore, "resolve">,
) {
  const parsed = parseProjectResourceUrl(value)
  if (parsed.reference.kind === "project-file") {
    return {
      absolutePath: await files.resolveEntryPath({ path: parsed.reference.path, projectId: parsed.projectId }),
      contentRevision: parsed.contentRevision!,
      kind: "project-file" as const,
    }
  }
  return {
    absolutePath: await assets.resolve({ projectId: parsed.projectId, reference: parsed.reference }),
    kind: "managed-asset" as const,
  }
}

export function createProjectResourceProtocolResponse(input: {
  cacheControl: string
  request: Request
  response: Response
  size: number
}) {
  if (input.request.method !== "GET" && input.request.method !== "HEAD") {
    return new Response("Method not allowed", { headers: { Allow: "GET, HEAD" }, status: 405 })
  }
  const range = parseSingleHttpByteRange(input.request.headers.get("range"), input.size)
  if (range === "unsatisfiable") {
    return new Response(null, {
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": input.cacheControl,
        "Content-Range": `bytes */${input.size}`,
      },
      status: 416,
    })
  }
  const headers = new Headers(input.response.headers)
  headers.set("Accept-Ranges", "bytes")
  headers.set("Cache-Control", input.cacheControl)
  if (range) {
    headers.set("Content-Length", String(range.end - range.start + 1))
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${input.size}`)
  } else {
    headers.set("Content-Length", String(input.size))
    headers.delete("Content-Range")
  }
  return new Response(input.request.method === "HEAD" ? null : input.response.body, {
    headers,
    status: range ? 206 : input.response.status,
    statusText: range ? "Partial Content" : input.response.statusText,
  })
}

function requireProtocolReference(value: unknown): ProtocolReference {
  const reference = requireProjectResourceReference(value)
  if (reference.kind === "project-directory") throw new Error("Project directories do not have asset URLs")
  return reference
}

function requireProjectId(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(value)) throw new Error("Project resource URL project id is invalid")
  return value
}

function requireExactSearchParams(url: URL, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional])
  const keys = [...url.searchParams.keys()]
  if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) {
    throw new Error("Project resource URL query is invalid")
  }
  if (required.some((key) => !url.searchParams.has(key))) throw new Error("Project resource URL query is incomplete")
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}
