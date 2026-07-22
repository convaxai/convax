import { join } from "node:path"

export function desktopOpenCodeBinaryDirectory(input: { isPackaged: boolean; resourcesDirectory: string }) {
  return input.isPackaged ? join(input.resourcesDirectory, "opencode", "bin") : undefined
}

export function desktopBunRuntime(input: {
  isPackaged: boolean
  platform?: NodeJS.Platform
  resourcesDirectory: string
}) {
  const command = input.isPackaged
    ? join(
        input.resourcesDirectory,
        "opencode",
        "bin",
        (input.platform ?? process.platform) === "win32" ? "opencode.exe" : "opencode",
      )
    : "bun"
  return { command, env: { BUN_BE_BUN: "1" } } as const
}
