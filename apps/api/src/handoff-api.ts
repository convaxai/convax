import {
  parseId128V2,
  parseProjectIdV2,
  parseProjectSharingHandoffProposalV3,
} from "@convax/collaboration"
import { PayloadPolicyErrorV2, readControlMetadataJsonV2 } from "./payload-policy"
import type { ProjectSharingHandoffServiceV3 } from "./handoff-service"

function response(status: number, body: Readonly<Record<string, unknown>>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

function match(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts.length !== 5 || parts[0] !== "api" || parts[1] !== "v3" || parts[2] !== "projects") return null
  if (parts[4] !== "handoffs" && parts[4] !== "handoff-recovery") return null
  return Object.freeze({ projectId: parseProjectIdV2(parts[3]), action: parts[4] as "handoffs" | "handoff-recovery" })
}

/** Dedicated V3 control edge; no frame, Yjs, checkpoint, or Project bytes enter it. */
export function createProjectSharingHandoffApiV3Handler(
  handoffs: Pick<ProjectSharingHandoffServiceV3, "submit" | "recover">,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let matched
    try { matched = match(new URL(request.url)) } catch { return response(404, { format: "convax.api-error/3", code: "endpoint-not-found" }) }
    if (!matched) return response(404, { format: "convax.api-error/3", code: "endpoint-not-found" })
    if (request.method !== "POST") return response(405, { format: "convax.api-error/3", code: "method-not-allowed" })
    let body: unknown
    try { body = await readControlMetadataJsonV2(request) } catch (error) {
      if (error instanceof PayloadPolicyErrorV2) {
        return response(error.code === "body-too-large" ? 413 : error.code === "invalid-content-type" ? 415 : 400, {
          format: "convax.api-error/3",
          code: error.code,
        })
      }
      throw error
    }
    try {
      if (matched.action === "handoffs") {
        const proposal = parseProjectSharingHandoffProposalV3(body)
        if (proposal.core.projectId !== matched.projectId) return response(400, { format: "convax.api-error/3", code: "project-scope-mismatch" })
        const result = await handoffs.submit(proposal)
        const status = result.status === "committed" ? 200 : result.status === "pending" ? 202 : result.status === "equivocation" ? 409 : 403
        return response(status, { format: "convax.project-sharing-handoff-response/3", ...result })
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "handoffId") {
        return response(400, { format: "convax.api-error/3", code: "invalid-control-metadata" })
      }
      const result = await handoffs.recover({ projectId: matched.projectId, handoffId: parseId128V2((body as Record<string, unknown>).handoffId) })
      return response(result.status === "committed" ? 200 : 202, { format: "convax.project-sharing-handoff-recovery-response/3", ...result })
    } catch {
      return response(400, { format: "convax.api-error/3", code: "invalid-control-metadata" })
    }
  }
}
