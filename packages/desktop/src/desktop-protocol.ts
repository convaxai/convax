export const desktopProtocolChannel = "desktop:protocol-version"
export const desktopProtocolVersion = "convax.desktop-ipc/3"

export interface DesktopProtocolClient {
  readonly version: string
  getVersion(): Promise<string>
}

export type DesktopProtocolCompatibility =
  | {
      actualVersion: string
      expectedVersion: string
      status: "compatible"
    }
  | {
      error?: string
      expectedVersion: string
      status: "missing"
    }
  | {
      actualVersion: string
      component: "main" | "preload"
      expectedVersion: string
      status: "mismatch"
    }

export async function checkDesktopProtocol(
  client: DesktopProtocolClient | null | undefined,
  expectedVersion = desktopProtocolVersion,
): Promise<DesktopProtocolCompatibility> {
  if (!client || typeof client.getVersion !== "function") {
    return { expectedVersion, status: "missing" }
  }
  if (typeof client.version !== "string") {
    return { expectedVersion, status: "missing" }
  }
  if (client.version !== expectedVersion) {
    return {
      actualVersion: client.version,
      component: "preload",
      expectedVersion,
      status: "mismatch",
    }
  }

  let actualVersion: string
  try {
    actualVersion = await client.getVersion()
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      expectedVersion,
      status: "missing",
    }
  }

  if (actualVersion !== expectedVersion) {
    return { actualVersion, component: "main", expectedVersion, status: "mismatch" }
  }
  return { actualVersion, expectedVersion, status: "compatible" }
}
