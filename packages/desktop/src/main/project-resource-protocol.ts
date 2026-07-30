import { requireProjectResourceReference, type ProjectResourceReference } from "@convax/project/canvas"
import type { ProjectResourceReadResult } from "@convax/project/node"

type ProtocolReference = Exclude<ProjectResourceReference, { kind: "project-directory" }>

export interface ProjectResourceProtocolInput {
  contentRevision?: string
  projectId: string
  reference: ProtocolReference
}

export function projectResourceAccessControlAllowOrigin(request: Request, trustedRendererUrl: string) {
  const expected = new URL(trustedRendererUrl)
  const requestOrigin = request.headers.get("origin")
  if (expected.origin !== "null") return requestOrigin === expected.origin ? expected.origin : undefined
  const requestReferrer = request.referrer || request.headers.get("referer")
  if (requestOrigin !== "null" || !requestReferrer) return undefined
  try {
    const referrer = new URL(requestReferrer)
    return referrer.protocol === expected.protocol &&
      referrer.host === expected.host &&
      referrer.pathname === expected.pathname
      ? "null"
      : undefined
  } catch {
    return undefined
  }
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
  if (url.protocol !== "convax-asset:" || url.username || url.password || url.port || url.hash || !url.hostname) {
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

export function createProjectResourceProtocolResponse(input: {
  accessControlAllowOrigin?: string
  cacheControl: string
  request: Request
  resource: ProjectResourceReadResult
}) {
  if (input.request.method !== "GET" && input.request.method !== "HEAD") {
    return new Response("Method not allowed", { headers: { Allow: "GET, HEAD" }, status: 405 })
  }
  if (input.resource.status === "range-not-satisfiable") {
    const headers = protocolResponseHeaders(input)
    headers.set("Content-Range", `bytes */${input.resource.size}`)
    return new Response(null, {
      headers,
      status: 416,
    })
  }
  const headers = protocolResponseHeaders(input)
  headers.set("Content-Length", String(input.resource.contentLength))
  if (input.resource.contentRange) {
    headers.set(
      "Content-Range",
      `bytes ${input.resource.contentRange.start}-${input.resource.contentRange.end}/${input.resource.size}`,
    )
  }
  return new Response(input.request.method === "HEAD" ? null : input.resource.body, {
    headers,
    status: input.resource.contentRange ? 206 : 200,
    statusText: input.resource.contentRange ? "Partial Content" : "OK",
  })
}

function protocolResponseHeaders(input: {
  accessControlAllowOrigin?: string
  cacheControl: string
  resource: ProjectResourceReadResult
}) {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": input.cacheControl,
    "Content-Type": input.resource.mediaType,
    "X-Content-Type-Options": "nosniff",
  })
  if (input.accessControlAllowOrigin) {
    headers.set("Access-Control-Allow-Origin", input.accessControlAllowOrigin)
    headers.set("Vary", "Origin")
  }
  return headers
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
