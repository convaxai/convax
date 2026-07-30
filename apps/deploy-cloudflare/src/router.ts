export interface FetchBinding {
  fetch(request: Request): Promise<Response>
}

export interface RouteBindings {
  assets: FetchBinding
  api?: FetchBinding
}

export function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/")
}

function apiUnavailableResponse() {
  return Response.json(
    {
      error: "api_unavailable",
      message: "The Convax API service has not been deployed yet.",
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
      },
    },
  )
}

export async function routeRequest(request: Request, bindings: RouteBindings) {
  const url = new URL(request.url)

  if (!isApiPath(url.pathname)) return await bindings.assets.fetch(request)
  if (!bindings.api) return apiUnavailableResponse()

  return await bindings.api.fetch(request)
}
