import { describe, expect, test } from "bun:test"
import { isApiPath, routeRequest, type FetchBinding } from "./router"

function responseBinding(body: string, status = 200): FetchBinding {
  return {
    async fetch() {
      return new Response(body, { status })
    },
  }
}

describe("Cloudflare request routing", () => {
  test("reserves only the exact API path family", () => {
    expect(isApiPath("/api")).toBe(true)
    expect(isApiPath("/api/")).toBe(true)
    expect(isApiPath("/api/projects")).toBe(true)
    expect(isApiPath("/apiary")).toBe(false)
    expect(isApiPath("/API")).toBe(false)
  })

  test("serves Web assets outside the API path", async () => {
    const response = await routeRequest(new Request("https://convax.microvoid.io/product"), {
      assets: responseBinding("web"),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("web")
  })

  test("fails closed while the API service is not configured", async () => {
    const response = await routeRequest(new Request("https://convax.microvoid.io/api/projects"), {
      assets: responseBinding("web"),
    })

    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.text()).toBe(
      JSON.stringify({
        error: "api_unavailable",
        message: "The Convax API service has not been deployed yet.",
      }),
    )
  })

  test("forwards API requests without rewriting the path", async () => {
    let receivedUrl = ""
    const api: FetchBinding = {
      async fetch(request) {
        receivedUrl = request.url
        return Response.json({ ok: true })
      },
    }

    const response = await routeRequest(new Request("https://convax.microvoid.io/api/projects?limit=10"), {
      assets: responseBinding("web"),
      api,
    })

    expect(response.status).toBe(200)
    expect(receivedUrl).toBe("https://convax.microvoid.io/api/projects?limit=10")
  })
})
