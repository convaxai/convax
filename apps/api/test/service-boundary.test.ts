import { describe, expect, test } from "bun:test"
import { createCollaborationApiV2Handler } from "../src"

const handler = createCollaborationApiV2Handler()
const base = "https://api.example.test/api/v2/projects/project-a"

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

describe("collaboration API payload-zero boundary", () => {
  test("fails closed when deployment control adapters are absent", async () => {
    const response = await handler(
      new Request(`${base}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "convax.session-proof", coreDigest: "metadata-only" }),
      }),
    )
    expect(response.status).toBe(503)
    expect(await body(response)).toEqual({
      format: "convax.api-error",
      code: "control-adapters-unavailable",
      integrationStatus: "current-contract-selected",
    })
  })

  test("rejects retired edit admission, ordering and operation lookup endpoints", async () => {
    for (const segment of ["admissions", "actor-counter-abandonments", "edit-order", "operation-lookup", "mmr"]) {
      const response = await handler(new Request(`${base}/${segment}`, { method: "POST" }))
      expect(response.status).toBe(404)
      expect(await body(response)).toMatchObject({ code: "endpoint-not-found" })
    }
  })

  test("rejects frame, Yjs, typed-intent and blob payload keys on every ordinary control route", async () => {
    for (const forbidden of [
      { causalFrame: "bytes" },
      { nested: { yjsUpdate: [1, 2, 3] } },
      { typedIntent: { kind: "canvas.node.create" } },
      { blobBytes: "base64" },
      { serverEditSequence: "1" },
    ]) {
      const response = await handler(
        new Request(`${base}/checkpoint-certificates`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(forbidden),
        }),
      )
      expect(response.status).toBe(400)
      expect(await body(response)).toMatchObject({ code: "edit-payload-forbidden" })
    }
  })

  test("rejects binary bodies and does not expose the isolated attester on the ordinary router", async () => {
    const binary = await handler(
      new Request(`${base}/checkpoint-certificates`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([1, 2, 3]),
      }),
    )
    expect(binary.status).toBe(415)
    expect(await body(binary)).toMatchObject({ code: "invalid-content-type" })

    const attester = await handler(
      new Request("https://api.example.test/api/v2/attester/checkpoints", { method: "POST" }),
    )
    expect(attester.status).toBe(404)
  })

  test("streams the exact 64 KiB ordinary-body limit and rejects plus one", async () => {
    const exactBody = JSON.stringify({ padding: "x".repeat(65_522) })
    expect(new TextEncoder().encode(exactBody)).toHaveLength(65_536)
    const exact = await handler(
      new Request(`${base}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: exactBody,
      }),
    )
    expect(exact.status).toBe(503)

    const plusOne = await handler(
      new Request(`${base}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `${exactBody} `,
      }),
    )
    expect(plusOne.status).toBe(413)
    expect(await body(plusOne)).toMatchObject({ code: "body-too-large" })
  })
})
