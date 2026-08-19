import { join } from "node:path"

export function desktopDshRuntime(input: {
  applicationDirectory: string
  isPackaged: boolean
  resourcesDirectory: string
}) {
  const root = input.isPackaged
    ? join(input.resourcesDirectory, "dsh-runtime")
    : join(input.applicationDirectory, ".packaging", "runtime", "dsh")
  return {
    moduleDirectory: join(root, "node_modules"),
    utilityEntry: join(root, "dsh-project-utility.js"),
  } as const
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
