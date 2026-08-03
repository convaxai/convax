import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = await mkdtemp(join(tmpdir(), "convax-peerjs-main-probe-"))
try {
  const outputPath = join(directory, "result.json")
  const electron = join(import.meta.dirname, "../node_modules/.bin/electron")
  const app = join(import.meta.dirname, "peerjs-electron-main-probe")
  const child = Bun.spawn([electron, app, outputPath], { stdout: "inherit", stderr: "inherit" })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Electron Main WebRTC probe exited ${exitCode}`)
  const result = JSON.parse(await readFile(outputPath, "utf8")) as Record<string, unknown>
  if (typeof result.electronVersion !== "string" || result.rtcPeerConnection !== "undefined") {
    throw new Error(`Electron Main WebRTC boundary changed: ${JSON.stringify(result)}`)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await rm(directory, { force: true, recursive: true })
}
