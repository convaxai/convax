#!/usr/bin/env node
import { resolve } from "node:path"
import { appendPluginApiHistory, checkPluginApiHistory, generatePluginApiArtifacts } from "./generator"

const packageRoot = process.cwd()
const outputDirectory = resolve(packageRoot, "generated")
const historyDirectory = resolve(packageRoot, "history")
const args = process.argv.slice(2)
const command = args[0]?.startsWith("--") ? "generate" : (args[0] ?? "generate")
const check = args.includes("--check")
const unknown = args.filter((arg, index) => !(index === 0 && !arg.startsWith("--")) && arg !== "--check")
if (unknown.length > 0) throw new TypeError(`Unknown argument: ${unknown[0]}`)

switch (command) {
  case "generate": {
    const result = await generatePluginApiArtifacts({ outputDirectory, historyDirectory, check })
    if (check && result.changed.length > 0) {
      throw new Error(`Generated Plugin API artifacts are stale:\n${result.changed.join("\n")}`)
    }
    break
  }
  case "compat":
    if (check) throw new TypeError("compat does not accept --check")
    await checkPluginApiHistory(historyDirectory)
    break
  case "history:append":
    if (check) throw new TypeError("history:append does not accept --check")
    await appendPluginApiHistory(historyDirectory)
    break
  default:
    throw new TypeError(`Unknown command: ${command}`)
}
