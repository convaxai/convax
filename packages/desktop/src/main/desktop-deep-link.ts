export const desktopDeepLinkScheme = "convax"

const authorizationIdPattern = /^[A-Za-z0-9_-]{16,128}$/

export interface DesktopServiceAuthorizationDeepLink {
  authorizationId: string
  kind: "service-authorization-complete"
}

/**
 * Accepts only a bounded activation hint. OAuth codes, PKCE material, tokens
 * and plugin-selected actions are deliberately not part of this protocol.
 */
export function parseDesktopDeepLink(value: string): DesktopServiceAuthorizationDeepLink | undefined {
  if (!value || value.length > 512 || value !== value.trim()) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (
    url.protocol !== `${desktopDeepLinkScheme}:` ||
    url.hostname !== "service-authorization" ||
    url.pathname !== "/complete" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return undefined
  }
  const entries = [...url.searchParams.entries()]
  if (entries.length !== 1 || entries[0]?.[0] !== "authorization_id" || !authorizationIdPattern.test(entries[0][1])) {
    return undefined
  }
  return {
    authorizationId: entries[0][1],
    kind: "service-authorization-complete",
  }
}

export function findDesktopDeepLink(arguments_: readonly string[]) {
  for (const value of arguments_) {
    const parsed = parseDesktopDeepLink(value)
    if (parsed) return parsed
  }
  return undefined
}
