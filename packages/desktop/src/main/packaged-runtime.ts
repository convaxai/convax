import { join } from "node:path"

export function desktopOpenCodeBinaryDirectory(input: { isPackaged: boolean; resourcesDirectory: string }) {
  return input.isPackaged ? join(input.resourcesDirectory, "opencode", "bin") : undefined
}
