import { join } from "node:path"

export function desktopOpenCodeBinaryDirectory(input: { isPackaged: boolean; resourcesDirectory: string }) {
  return input.isPackaged ? join(input.resourcesDirectory, "opencode", "bin") : undefined
}

export function desktopBunRuntime(input: {
  applicationDirectory?: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  resourcesDirectory: string
}) {
  const command = input.isPackaged
    ? join(input.resourcesDirectory, "bun", "bin", (input.platform ?? process.platform) === "win32" ? "bun.exe" : "bun")
    : join(
        input.applicationDirectory ?? process.cwd(),
        ".packaging",
        "runtime",
        "bun",
        "bin",
        (input.platform ?? process.platform) === "win32" ? "bun.exe" : "bun",
      )
  return { command, env: {} } as const
}
